-- (painel: inclui também as linhas sem conta (variante G) e a marca ex_convidado;
--  o cliente faz a análise A/B só com A e B)
-- =====================================================================
-- Sobe+ — grupos equilibrados + sem conta = coletivo
--  * Contas: A (coletivo) ou B (pessoal), atribuídas por minimização:
--    vai para o grupo com MENOS participantes com subida válida
--    (empate: menos contas atribuídas; empate: ao acaso). Assim há tantos
--    dados de um grupo como do outro.
--  * Sem conta (G): vê sempre o progresso coletivo; fica fora da análise A/B.
--  * Quem usou sem conta e depois criou conta fica marcado (ex_convidado),
--    porque já viu o coletivo; o painel permite excluí-lo da análise.
-- =====================================================================

alter table public.contas add column ex_convidado boolean not null default false;

drop function if exists public.criar_conta(text, text);

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
  return jsonb_build_object('ok', true, 'user_id', v_id, 'utilizador', v_u, 'codigo_recuperacao', v_codigo);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'erro', 'utilizador_existe', 'sugestoes', privado.sugerir_nomes(v_u));
end
$$;

-- Escolhe A ou B por minimização (ver cabeçalho).
create or replace function privado.escolher_variante() returns char(1)
language plpgsql volatile set search_path = '' as $$
declare
  v_a_part int; v_b_part int; v_a int; v_b int;
begin
  perform pg_advisory_xact_lock(hashtext('sobe_variante'));
  select count(distinct s.user_id) filter (where p.variante = 'A'),
         count(distinct s.user_id) filter (where p.variante = 'B')
    into v_a_part, v_b_part
  from public.scans s join public.participantes p on p.user_id = s.user_id
  where s.resultado = 'valida' and p.variante in ('A', 'B');
  select count(*) filter (where variante = 'A'), count(*) filter (where variante = 'B')
    into v_a, v_b
  from public.participantes;
  if v_a_part <> v_b_part then
    return case when v_a_part < v_b_part then 'A' else 'B' end;
  elsif v_a <> v_b then
    return case when v_a < v_b then 'A' else 'B' end;
  else
    return case when random() < 0.5 then 'A' else 'B' end;
  end if;
end
$$;

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

  -- Variante fixa no 1.º scan: contas -> A/B equilibrado; sem conta -> G.
  if not exists (select 1 from public.participantes where user_id = p_user_id) then
    insert into public.participantes (user_id, variante)
    values (p_user_id, case when v_conta then privado.escolher_variante() else 'G' end)
    on conflict (user_id) do nothing;
  end if;

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


create or replace function public.painel(p_password text, p_incluir_fora boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_erro   text := privado.verificar_painel(p_password);
  v_todos  boolean := coalesce(p_incluir_fora, false);
  v_fuso   text := privado.cfg('fuso');
  v_ini    date := privado.cfg('estudo_inicio')::date;
  v_fim    date := privado.cfg('estudo_fim')::date;
  v_hoje   date := privado.dia_local(now());
  v_d0     date;
  v_d1     date;
  v_nsem   int;
  v_fim_ts timestamptz;
  v_part   jsonb;
  v_diario jsonb;
  v_conv   jsonb;
begin
  if v_erro is not null then
    return jsonb_build_object('ok', false, 'erro', v_erro);
  end if;

  v_nsem   := ceil((v_fim - v_ini + 1) / 7.0);
  v_fim_ts := ((v_fim + 1)::timestamp at time zone v_fuso);
  v_d0     := case when v_todos
                then least(v_ini, coalesce((select privado.dia_local(min(criado_em)) from public.scans), v_ini))
                else v_ini end;
  v_d1     := case when v_todos then greatest(v_hoje, v_d0) else least(v_hoje, v_fim) end;

  with s as (
    select sc.user_id, sc.criado_em, sc.resultado, sc.andares,
           privado.dia_local(sc.criado_em) as dia,
           -- floor: dias antes do início ficam na "semana 0" (fora das semanas do estudo)
           floor((privado.dia_local(sc.criado_em) - v_ini) / 7.0)::int + 1 as semana
    from public.scans sc
    where (sc.no_estudo or v_todos)
  ),
  pp as (
    select s.user_id, p.variante, p.meta_semanal, coalesce(c.ex_convidado, false) as ex_convidado,
           min(s.criado_em) as primeiro,
           count(*) as n_scans,
           count(*) filter (where s.resultado = 'valida') as subidas,
           coalesce(sum(s.andares) filter (where s.resultado = 'valida'), 0) as andares,
           count(distinct s.dia) filter (where s.resultado = 'valida') as dias
    from s join public.participantes p on p.user_id = s.user_id
    left join public.contas c on c.user_id = s.user_id
    group by s.user_id, p.variante, p.meta_semanal, c.ex_convidado
  ),
  x as (
    select pp.*, row_number() over (order by primeiro, user_id) as rn from pp
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',               'P' || lpad(x.rn::text, 3, '0'),
           'variante',         x.variante,
           'primeiro_dia',     privado.dia_local(x.primeiro),
           'n_scans',          x.n_scans,
           'subidas',          x.subidas,
           'andares',          x.andares,
           'dias',             x.dias,
           'subidas_7d',       (select count(*) from s
                                where s.user_id = x.user_id and s.resultado = 'valida'
                                  and s.criado_em < x.primeiro + interval '7 days'),
           'semanas_expostas', round(greatest(1, extract(epoch from (least(now(), v_fim_ts) - x.primeiro))
                                                 / 604800.0)::numeric, 2),
           'por_semana',       (select jsonb_agg(
                                  (select count(*) from s
                                   where s.user_id = x.user_id and s.resultado = 'valida'
                                     and s.semana = k) order by k)
                                from generate_series(1, v_nsem) k),
           'meta_semanal',     x.meta_semanal,
           'ex_convidado',     x.ex_convidado
         ) order by x.rn), '[]'::jsonb)
    into v_part
  from x;

  with dd as (
    select d::date as dia
    from generate_series(v_d0::timestamp, v_d1::timestamp, interval '1 day') d
  ),
  v as (
    select privado.dia_local(criado_em) as dia, variante,
           count(*) as n, count(distinct user_id) as p
    from public.scans
    where (no_estudo or v_todos) and resultado = 'valida'
    group by 1, 2
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'dia', dd.dia,
           'A', coalesce(a.n, 0), 'B', coalesce(b.n, 0), 'G', coalesce(g.n, 0),
           'A_pessoas', coalesce(a.p, 0), 'B_pessoas', coalesce(b.p, 0), 'G_pessoas', coalesce(g.p, 0)
         ) order by dd.dia), '[]'::jsonb)
    into v_diario
  from dd
  left join v a on a.dia = dd.dia and a.variante = 'A'
  left join v b on b.dia = dd.dia and b.variante = 'B'
  left join v g on g.dia = dd.dia and g.variante = 'G';

  select jsonb_build_object(
           'ids',        count(distinct user_id),
           'com_subida', count(distinct user_id) filter (where resultado = 'valida'),
           'subidas',    count(*) filter (where resultado = 'valida'),
           'andares',    coalesce(sum(andares) filter (where resultado = 'valida'), 0))
    into v_conv
  from public.scans
  where (no_estudo or v_todos) and variante = 'G';

  return jsonb_build_object(
    'ok',                true,
    'inclui_fora',       v_todos,
    'gerado_em',         now(),
    'estudo',            jsonb_build_object('inicio', v_ini, 'fim', v_fim, 'hoje', v_hoje, 'semanas', v_nsem),
    'regras',            jsonb_build_object(
                           'min_seg_por_andar', privado.cfg_num('min_seg_por_andar'),
                           'max_seg_por_andar', privado.cfg_num('max_seg_por_andar'),
                           'cooldown_seg',      privado.cfg_num('cooldown_seg')),
    'participantes',     v_part,
    'diario',            v_diario,
    'convidados',        v_conv,
    'contas',            (select count(*) from public.contas),
    'scans_fora_estudo', (select count(*) from public.scans where not no_estudo));
end
$$;

revoke execute on function public.painel(text, boolean) from public, anon, authenticated;
grant  execute on function public.painel(text, boolean) to anon, authenticated;

revoke execute on all functions in schema privado from public, anon, authenticated;
revoke execute on function public.criar_conta(text, text, uuid) from public, anon, authenticated;
grant  execute on function public.criar_conta(text, text, uuid) to anon, authenticated;
grant  execute on function public.registar_scan(uuid, text)     to anon, authenticated;
