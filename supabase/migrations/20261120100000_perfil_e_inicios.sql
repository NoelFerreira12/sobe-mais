-- =====================================================================
-- Sobe+ — perfil sempre completo + inícios mais claros
--  * O grupo (A/B) passa a ser atribuído quando a conta é criada (ou ao entrar,
--    para contas antigas sem grupo). Assim o perfil mostra logo a meta, a rota
--    e o histórico, sem ser preciso ler um QR primeiro.
--  * Uma leitura só serve de ponto de partida durante a janela máxima de uma
--    subida (max_seg_por_andar × n.º de lanços, 18 min por defeito). Depois disso,
--    qualquer leitura é um início novo, mesmo num piso mais baixo.
--  * estado_utilizador devolve os dados do grupo para o perfil:
--    A e sem conta -> coletivo; B -> pessoal (B nunca recebe números coletivos).
--  * progresso_coletivo devolve também as subidas da UMa por dia (14 dias).
-- =====================================================================

update public.config
   set descricao = 'Não usado: a janela é max_seg_por_andar × n.º de lanços'
 where chave = 'sessao_max_seg';

-- Garante que o ID tem participante; contas recebem A/B equilibrado, sem conta = G.
create or replace function privado.garantir_participante(p_user_id uuid) returns char(1)
language plpgsql volatile set search_path = '' as $$
declare
  v_var char(1);
begin
  select variante into v_var from public.participantes where user_id = p_user_id;
  if v_var is not null then return v_var; end if;
  insert into public.participantes (user_id, variante)
  values (p_user_id, case when exists (select 1 from public.contas where user_id = p_user_id)
                          then privado.escolher_variante() else 'G' end)
  on conflict (user_id) do nothing;
  select variante into v_var from public.participantes where user_id = p_user_id;
  return v_var;
end
$$;

create or replace function public.progresso_coletivo() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'subidas', count(*),
    'andares', coalesce(sum(andares), 0),
    'pessoas', count(distinct user_id),
    'lancos',  privado.lancos(null),
    'hoje',    privado.dia_local(now()),
    'dias',    (select coalesce(jsonb_agg(jsonb_build_object('d', d, 'n', n) order by d), '[]'::jsonb)
                from (select privado.dia_local(s2.criado_em) as d, count(*) as n
                      from public.scans s2
                      where s2.resultado = 'valida' and s2.criado_em > now() - interval '15 days'
                      group by 1) x))
  from public.scans
  where resultado = 'valida'
$$;

create or replace function public.estado_utilizador(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_nome      text;
  v_var       char(1);
  v_meta      smallint;
  v_dias      jsonb;
  v_ult_piso  smallint;
  v_ult_tempo timestamptz;
  v_ult_res   text;
  v_janela    numeric := privado.cfg_num('max_seg_por_andar')
                         * (select max(piso) - min(piso) from public.pisos);
  v_grupo     jsonb;
begin
  select utilizador into v_nome from public.contas where user_id = p_user_id;
  select variante, meta_semanal into v_var, v_meta from public.participantes where user_id = p_user_id;

  -- Dados do grupo para o perfil. B: só pessoal. A e sem conta: coletivo.
  v_grupo := case
    when v_var = 'B' then jsonb_build_object('pessoal', privado.pessoal(p_user_id))
    when v_var in ('A', 'G') or v_nome is null then jsonb_build_object('coletivo', public.progresso_coletivo())
    else '{}'::jsonb end;

  if v_var is null then
    return jsonb_build_object('existe', false, 'conta', v_nome is not null, 'utilizador', v_nome,
                              'hoje', privado.dia_local(now()), 'dias', '[]'::jsonb) || v_grupo;
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
    'conta',        v_nome is not null,
    'utilizador',   v_nome,
    'meta_semanal', v_meta,
    'dias',         v_dias,
    'hoje',         privado.dia_local(now()),
    'janela_seg',   v_janela,
    'ultimo_scan',  case when v_ult_tempo is null then null else jsonb_build_object(
                      'piso', v_ult_piso,
                      'resultado', v_ult_res,
                      'segundos_desde', floor(extract(epoch from now() - v_ult_tempo))) end) || v_grupo;
end
$$;

create or replace function public.definir_meta(p_user_id uuid, p_meta integer) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'erro', 'pedido_invalido');
  end if;
  if p_meta is not null and (p_meta < 1 or p_meta > 14) then
    return jsonb_build_object('ok', false, 'erro', 'meta_invalida');
  end if;
  perform privado.garantir_participante(p_user_id);
  update public.participantes set meta_semanal = p_meta where user_id = p_user_id;
  return jsonb_build_object('ok', true, 'meta_semanal', p_meta);
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
  perform privado.garantir_participante(v_id);   -- contas antigas sem grupo
  return jsonb_build_object('ok', true, 'user_id', v_id, 'utilizador', v_u);
end
$$;

create or replace function public.criar_conta(p_utilizador text, p_password text, p_convidado uuid default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_u      text := lower(trim(coalesce(p_utilizador, '')));
  v_id     uuid;
  v_codigo text := privado.novo_codigo();
  v_ex     boolean;
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
    return jsonb_build_object('ok', false, 'erro', 'utilizador_existe', 'sugestoes', privado.sugerir_nomes(v_u));
  end if;
  -- Este telemóvel já fez subidas válidas sem conta (já viu o coletivo)?
  v_ex := p_convidado is not null and exists (
    select 1 from public.scans s join public.participantes p on p.user_id = s.user_id
    where s.user_id = p_convidado and p.variante = 'G' and s.resultado = 'valida');
  insert into public.contas (utilizador, password_hash, recuperacao_sha, ex_convidado)
  values (v_u, extensions.crypt(p_password, extensions.gen_salt('bf', 8)), privado.sha_codigo(v_codigo), v_ex)
  returning user_id into v_id;
  perform privado.garantir_participante(v_id);   -- grupo A/B atribuído já
  return jsonb_build_object('ok', true, 'user_id', v_id, 'utilizador', v_u, 'codigo_recuperacao', v_codigo);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'erro', 'utilizador_existe', 'sugestoes', privado.sugerir_nomes(v_u));
end
$$;


create or replace function public.registar_scan(p_user_id uuid, p_token text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_agora      timestamptz := now();
  v_min        numeric := privado.cfg_num('min_seg_por_andar');
  v_max        numeric := privado.cfg_num('max_seg_por_andar');
  v_cooldown   numeric := privado.cfg_num('cooldown_seg');
  v_sessao     numeric := privado.cfg_num('max_seg_por_andar') * (select max(piso) - min(piso) from public.pisos);
  v_repetido   numeric := privado.cfg_num('repetido_seg');
  v_rate_min   numeric := privado.cfg_num('rate_min_intervalo_seg');
  v_rate_hora  numeric := privado.cfg_num('rate_max_hora');
  v_no_estudo  boolean := privado.no_estudo(now());
  v_conta      boolean;
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

  select piso into v_piso from public.pisos where token = p_token;
  if v_piso is null then
    return jsonb_build_object('ok', false, 'erro', 'qr_invalido');
  end if;

  v_conta := exists (select 1 from public.contas where user_id = p_user_id);

  -- Grupo fixo: contas -> A/B (normalmente já atribuído ao criar a conta); sem conta -> G.
  perform privado.garantir_participante(p_user_id);

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
    'conta',                 v_conta,
    'estado',                public.estado_utilizador(p_user_id));

  -- Ecrã depois de uma subida válida: A e G (sem conta) = coletivo; B = pessoal.
  if v_res = 'valida' then
    if v_var = 'B' then
      v_out := v_out || jsonb_build_object('pessoal', privado.pessoal(p_user_id));
    else
      v_out := v_out || jsonb_build_object('coletivo', public.progresso_coletivo());
      if v_var = 'G' then
        v_out := v_out || jsonb_build_object('convidado', true);
      end if;
    end if;
  end if;

  return v_out;
end
$$;


revoke execute on all functions in schema privado from public, anon, authenticated;
grant execute on function public.criar_conta(text, text, uuid)  to anon, authenticated;
grant execute on function public.entrar(text, text)             to anon, authenticated;
grant execute on function public.registar_scan(uuid, text)      to anon, authenticated;
grant execute on function public.estado_utilizador(uuid)        to anon, authenticated;
grant execute on function public.definir_meta(uuid, integer)    to anon, authenticated;
grant execute on function public.progresso_coletivo()           to anon, authenticated;
