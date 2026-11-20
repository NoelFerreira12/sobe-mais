-- =====================================================================
-- Sobe+ — sorteio A/B também para quem usa sem conta
-- Em 20/11, 7 de 11 pessoas escolheram "Continuar sem conta" e ficavam fora do
-- estudo. A partir de agora:
--  * Todos os participantes novos (com ou sem conta) são sorteados A/B na 1.ª
--    leitura (contas: ao criar a conta), equilibrado pelo n.º de pessoas em cada grupo.
--  * Criar conta num telemóvel que já participava sem conta mantém o MESMO ID,
--    grupo e histórico (a mesma pessoa nunca muda de grupo).
--  * Quem ainda não tem grupo (sem conta, antes da 1.ª leitura) não vê números de grupo.
--  * Os participantes antigos "sem conta = coletivo" (G) ficam como estão, fora do A/B.
--  * Painel: cada linha indica tem_conta.
-- =====================================================================

create or replace function privado.garantir_participante(p_user_id uuid) returns char(1)
language plpgsql volatile set search_path = '' as $$
declare
  v_var char(1);
begin
  select variante into v_var from public.participantes where user_id = p_user_id;
  if v_var is not null then return v_var; end if;
  insert into public.participantes (user_id, variante)
  values (p_user_id, privado.escolher_variante())   -- com ou sem conta: A/B equilibrado
  on conflict (user_id) do nothing;
  select variante into v_var from public.participantes where user_id = p_user_id;
  return v_var;
end
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
    when v_var in ('A', 'G') then jsonb_build_object('coletivo', public.progresso_coletivo())
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
  if p_convidado is not null
     and not exists (select 1 from public.contas where user_id = p_convidado)
     and exists (select 1 from public.participantes where user_id = p_convidado and variante in ('A', 'B')) then
    -- Já participava sem conta (com grupo A/B): a conta fica com o MESMO ID, grupo e histórico.
    insert into public.contas (user_id, utilizador, password_hash, recuperacao_sha, ex_convidado)
    values (p_convidado, v_u, extensions.crypt(p_password, extensions.gen_salt('bf', 8)), privado.sha_codigo(v_codigo), false)
    returning user_id into v_id;
  else
    -- Telemóvel antigo "sem conta = coletivo" (G) com subidas válidas: já viu o coletivo.
    v_ex := p_convidado is not null and exists (
      select 1 from public.scans s join public.participantes p on p.user_id = s.user_id
      where s.user_id = p_convidado and p.variante = 'G' and s.resultado = 'valida');
    insert into public.contas (utilizador, password_hash, recuperacao_sha, ex_convidado)
    values (v_u, extensions.crypt(p_password, extensions.gen_salt('bf', 8)), privado.sha_codigo(v_codigo), v_ex)
    returning user_id into v_id;
    perform privado.garantir_participante(v_id);   -- grupo A/B atribuído já
  end if;
  return jsonb_build_object('ok', true, 'user_id', v_id, 'utilizador', v_u, 'codigo_recuperacao', v_codigo);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'erro', 'utilizador_existe', 'sugestoes', privado.sugerir_nomes(v_u));
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
  v_qual   jsonb;
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
           (c.user_id is not null) as tem_conta,
           min(s.criado_em) as primeiro,
           count(*) as n_scans,
           count(*) filter (where s.resultado = 'valida') as subidas,
           coalesce(sum(s.andares) filter (where s.resultado in ('valida', 'continua')), 0) as andares,
           count(distinct s.dia) filter (where s.resultado = 'valida') as dias
    from s join public.participantes p on p.user_id = s.user_id
    left join public.contas c on c.user_id = s.user_id
    group by s.user_id, p.variante, p.meta_semanal, c.ex_convidado, c.user_id
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
           'ex_convidado',     x.ex_convidado,
           'tem_conta',        x.tem_conta
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

  -- Qualidade dos dados: resultados por grupo e contas atribuídas a cada grupo.
  select jsonb_build_object(
           'resultados', coalesce((select jsonb_object_agg(variante, r) from (
              select variante, jsonb_object_agg(resultado, n) as r from (
                select variante, resultado, count(*) as n from public.scans
                where (no_estudo or v_todos) group by 1, 2) y group by variante) z), '{}'::jsonb),
           'contas_por_grupo', coalesce((select jsonb_object_agg(variante, n) from (
              select p.variante, count(*) as n from public.participantes p
              join public.contas c on c.user_id = p.user_id group by 1) w), '{}'::jsonb),
           'contas_sem_leituras', (select count(*) from public.contas c
              where not exists (select 1 from public.scans s where s.user_id = c.user_id)))
    into v_qual;

  return jsonb_build_object(
    'ok',                true,
    'qualidade',         v_qual,
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


revoke execute on all functions in schema privado from public, anon, authenticated;
grant execute on function public.criar_conta(text, text, uuid)  to anon, authenticated;
grant execute on function public.estado_utilizador(uuid)        to anon, authenticated;
grant execute on function public.painel(text, boolean)          to anon, authenticated;
