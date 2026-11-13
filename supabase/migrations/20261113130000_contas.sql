-- =====================================================================
-- Sobe+ — contas (login com nome de utilizador + palavra-passe, sem email)
-- Cada participante tem de ter conta. O user_id (UUID) continua a ser o
-- identificador anónimo usado nos scans; o nome de utilizador nunca sai
-- para o painel.
-- =====================================================================

create table public.contas (
  user_id       uuid primary key default gen_random_uuid(),
  utilizador    text not null unique check (utilizador ~ '^[a-z0-9._-]{3,24}$'),
  password_hash text not null,
  criado_em     timestamptz not null default now()
);

create table public.login_tentativas (
  id         bigint generated always as identity primary key,
  utilizador text not null,
  criado_em  timestamptz not null default now(),
  ok         boolean not null
);
create index login_tentativas_u on public.login_tentativas (utilizador, criado_em desc);

alter table public.contas           enable row level security;
alter table public.login_tentativas enable row level security;

-- Todos os participantes têm conta (apagar a conta apaga participante e scans).
alter table public.participantes
  add constraint participantes_conta_fk
  foreign key (user_id) references public.contas (user_id) on delete cascade;

-- ---------------------------------------------------------------------
create or replace function public.criar_conta(p_utilizador text, p_password text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_u  text := lower(trim(coalesce(p_utilizador, '')));
  v_id uuid;
begin
  if v_u !~ '^[a-z0-9._-]{3,24}$' then
    return jsonb_build_object('ok', false, 'erro', 'utilizador_invalido');
  end if;
  if p_password is null or length(p_password) < 6 or length(p_password) > 72 then
    return jsonb_build_object('ok', false, 'erro', 'password_curta');
  end if;
  if (select count(*) from public.contas where criado_em > now() - interval '1 hour') >= 300 then
    return jsonb_build_object('ok', false, 'erro', 'muitas_contas');
  end if;
  if exists (select 1 from public.contas where utilizador = v_u) then
    return jsonb_build_object('ok', false, 'erro', 'utilizador_existe');
  end if;
  insert into public.contas (utilizador, password_hash)
  values (v_u, extensions.crypt(p_password, extensions.gen_salt('bf', 8)))
  returning user_id into v_id;
  return jsonb_build_object('ok', true, 'user_id', v_id, 'utilizador', v_u);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'erro', 'utilizador_existe');
end
$$;

create or replace function public.entrar(p_utilizador text, p_password text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_u    text := lower(trim(coalesce(p_utilizador, '')));
  v_id   uuid;
  v_hash text;
begin
  if (select count(*) from public.login_tentativas
      where utilizador = v_u and not ok and criado_em > now() - interval '15 minutes') >= 10 then
    return jsonb_build_object('ok', false, 'erro', 'bloqueado');
  end if;
  select user_id, password_hash into v_id, v_hash from public.contas where utilizador = v_u;
  if v_id is null or p_password is null
     or extensions.crypt(p_password, v_hash) is distinct from v_hash then
    insert into public.login_tentativas (utilizador, ok) values (left(v_u, 64), false);
    return jsonb_build_object('ok', false, 'erro', 'credenciais');
  end if;
  insert into public.login_tentativas (utilizador, ok) values (v_u, true);
  return jsonb_build_object('ok', true, 'user_id', v_id, 'utilizador', v_u);
end
$$;

-- ---------------------------------------------------------------------
-- estado_utilizador: passa a indicar se a conta existe e o nome.
create or replace function public.estado_utilizador(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_nome      text;
  v_meta      smallint;
  v_dias      jsonb;
  v_ult_piso  smallint;
  v_ult_tempo timestamptz;
  v_ult_res   text;
begin
  select utilizador into v_nome from public.contas where user_id = p_user_id;
  if v_nome is null then
    return jsonb_build_object('existe', false, 'conta', false, 'hoje', privado.dia_local(now()));
  end if;

  select meta_semanal into v_meta from public.participantes where user_id = p_user_id;
  if not found then
    return jsonb_build_object('existe', false, 'conta', true, 'utilizador', v_nome,
                              'hoje', privado.dia_local(now()));
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('d', d, 'n', n) order by d), '[]'::jsonb)
    into v_dias
  from (
    select privado.dia_local(criado_em) as d, count(*) as n
    from public.scans
    where user_id = p_user_id and resultado = 'valida'
    group by 1
  ) x;

  select piso, criado_em, resultado into v_ult_piso, v_ult_tempo, v_ult_res
  from public.scans
  where user_id = p_user_id and resultado <> 'repetido'
  order by criado_em desc
  limit 1;

  return jsonb_build_object(
    'existe',       true,
    'conta',        true,
    'utilizador',   v_nome,
    'meta_semanal', v_meta,
    'dias',         v_dias,
    'hoje',         privado.dia_local(now()),
    'ultimo_scan',  case when v_ult_tempo is null then null else jsonb_build_object(
                      'piso', v_ult_piso,
                      'resultado', v_ult_res,
                      'segundos_desde', floor(extract(epoch from now() - v_ult_tempo))) end);
end
$$;

-- ---------------------------------------------------------------------
-- registar_scan: igual à versão inicial, mas exige conta.
create or replace function public.registar_scan(p_user_id uuid, p_token text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_agora      timestamptz := now();
  v_min        numeric := privado.cfg_num('min_seg_por_andar');
  v_max        numeric := privado.cfg_num('max_seg_por_andar');
  v_cooldown   numeric := privado.cfg_num('cooldown_seg');
  v_sessao     numeric := privado.cfg_num('sessao_max_seg');
  v_repetido   numeric := privado.cfg_num('repetido_seg');
  v_rate_min   numeric := privado.cfg_num('rate_min_intervalo_seg');
  v_rate_hora  numeric := privado.cfg_num('rate_max_hora');
  v_no_estudo  boolean := privado.no_estudo(now());
  v_piso       smallint;
  v_var        char(1);
  v_uq_tempo   timestamptz;
  v_uq_token   text;
  v_ult_piso   smallint;
  v_ult_tempo  timestamptz;
  v_ult_valida timestamptz;
  v_seg        numeric;
  v_andares    smallint;
  v_origem     smallint;
  v_res        text;
  v_cd_rest    integer;
  v_out        jsonb;
begin
  if p_user_id is null or p_token is null or length(p_token) > 64 then
    return jsonb_build_object('ok', false, 'erro', 'pedido_invalido');
  end if;

  if not exists (select 1 from public.contas where user_id = p_user_id) then
    return jsonb_build_object('ok', false, 'erro', 'sem_conta');
  end if;

  select piso into v_piso from public.pisos where token = p_token;
  if v_piso is null then
    return jsonb_build_object('ok', false, 'erro', 'qr_invalido');
  end if;

  -- 1.º scan: variante A/B ao acaso (50/50); nunca muda depois.
  insert into public.participantes (user_id, variante)
  values (p_user_id, case when random() < 0.5 then 'A' else 'B' end)
  on conflict (user_id) do nothing;

  select variante into v_var from public.participantes where user_id = p_user_id for update;

  select criado_em, token into v_uq_tempo, v_uq_token
  from public.scans where user_id = p_user_id
  order by criado_em desc limit 1;

  if v_uq_tempo is not null and extract(epoch from v_agora - v_uq_tempo) < v_rate_min then
    return jsonb_build_object('ok', false, 'erro', 'muito_seguido');
  end if;
  if (select count(*) from public.scans
      where user_id = p_user_id and criado_em > v_agora - interval '1 hour') >= v_rate_hora then
    return jsonb_build_object('ok', false, 'erro', 'limite');
  end if;

  if v_uq_token = p_token and extract(epoch from v_agora - v_uq_tempo) < v_repetido then
    v_res := 'repetido';
  else
    select piso, criado_em into v_ult_piso, v_ult_tempo
    from public.scans
    where user_id = p_user_id and resultado <> 'repetido'
    order by criado_em desc limit 1;

    v_seg := extract(epoch from v_agora - v_ult_tempo);

    if v_ult_tempo is null or v_seg > v_sessao or v_piso = v_ult_piso then
      v_res := 'inicio';
    else
      v_origem  := v_ult_piso;
      v_andares := v_piso - v_ult_piso;
      if v_andares < 0 then
        v_res := 'descer';
      elsif v_seg < v_min * v_andares then
        v_res := 'rapido';
      elsif v_seg > v_max * v_andares then
        v_res := 'lento';
      else
        select max(criado_em) into v_ult_valida
        from public.scans where user_id = p_user_id and resultado = 'valida';
        if v_ult_valida is not null
           and extract(epoch from v_agora - v_ult_valida) < v_cooldown then
          v_res := 'cooldown';
          v_cd_rest := ceil(v_cooldown - extract(epoch from v_agora - v_ult_valida));
        else
          v_res := 'valida';
        end if;
      end if;
    end if;
  end if;

  insert into public.scans
    (user_id, token, piso, variante, criado_em, resultado, piso_origem, andares, segundos, no_estudo)
  values
    (p_user_id, p_token, v_piso, v_var, v_agora, v_res, v_origem, v_andares,
     case when v_origem is null then null else round(v_seg)::int end, v_no_estudo);

  v_out := jsonb_build_object(
    'ok',                    true,
    'resultado',             v_res,
    'piso',                  v_piso,
    'piso_origem',           v_origem,
    'andares',               v_andares,
    'segundos',              case when v_origem is null then null else round(v_seg)::int end,
    'min_seg',               case when v_andares > 0 then v_min * v_andares end,
    'max_seg',               case when v_andares > 0 then v_max * v_andares end,
    'cooldown_restante_seg', v_cd_rest,
    'no_estudo',             v_no_estudo,
    'estado',                public.estado_utilizador(p_user_id));

  -- A ÚNICA diferença entre variantes: o ecrã depois de uma subida válida.
  -- A = objetivo coletivo; B = objetivo individual.
  if v_res = 'valida' then
    if v_var = 'A' then
      v_out := v_out || jsonb_build_object('coletivo', public.progresso_coletivo());
    else
      v_out := v_out || jsonb_build_object('pessoal', privado.pessoal(p_user_id));
    end if;
  end if;

  return v_out;
end
$$;

-- ---------------------------------------------------------------------
revoke all on public.contas, public.login_tentativas from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on function public.criar_conta(text, text) from public, anon, authenticated;
revoke execute on function public.entrar(text, text)      from public, anon, authenticated;
grant  execute on function public.criar_conta(text, text) to anon, authenticated;
grant  execute on function public.entrar(text, text)      to anon, authenticated;
grant  execute on function public.registar_scan(uuid, text) to anon, authenticated;
grant  execute on function public.estado_utilizador(uuid)   to anon, authenticated;
