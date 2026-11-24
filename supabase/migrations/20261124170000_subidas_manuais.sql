-- =====================================================================
-- Sobe+ — subidas registadas à mão (pelo docente, no painel)
-- Quem subiu mas se esqueceu de ler o QR pode pedir ao docente para registar a
-- subida. Fica uma leitura 'valida' com manual = true (token 'manual', sem segundos):
--  * conta para a pessoa e para a meta coletiva, como uma subida normal;
--  * o painel pode fazer a análise com e sem estas subidas (p_incluir_manuais);
--  * só por alcunha (contas), nunca no futuro, até 14 dias atrás, sem duplicar.
-- =====================================================================

alter table public.scans add column if not exists manual boolean not null default false;


create or replace function public.painel_registar_subida(
  p_password text, p_utilizador text, p_dia date, p_hora time, p_origem smallint, p_destino smallint) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_erro   text := privado.verificar_painel(p_password);
  v_u      text := lower(trim(coalesce(p_utilizador, '')));
  v_quando timestamptz;
  v_user   uuid;
  v_var    char(1);
  v_id     bigint;
begin
  if v_erro is not null then
    return jsonb_build_object('ok', false, 'erro', v_erro);
  end if;
  select c.user_id, p.variante into v_user, v_var
  from public.contas c join public.participantes p on p.user_id = c.user_id
  where c.utilizador = v_u;
  if v_user is null or v_var is null then
    return jsonb_build_object('ok', false, 'erro', 'sem_alcunha');
  end if;
  if p_origem is null or p_destino is null or p_destino <= p_origem
     or not exists (select 1 from public.pisos where piso = p_origem)
     or not exists (select 1 from public.pisos where piso = p_destino) then
    return jsonb_build_object('ok', false, 'erro', 'pisos');
  end if;
  if p_dia is null or p_hora is null then
    return jsonb_build_object('ok', false, 'erro', 'quando');
  end if;
  v_quando := (p_dia + p_hora) at time zone privado.cfg('fuso');
  if v_quando > now() or v_quando < now() - interval '14 days' then
    return jsonb_build_object('ok', false, 'erro', 'quando');
  end if;
  -- Não duplicar: já há uma subida desta pessoa (QR ou à mão) 10 min à volta dessa hora.
  if exists (select 1 from public.scans
             where user_id = v_user and resultado in ('valida', 'continua')
               and criado_em between v_quando - interval '10 minutes' and v_quando + interval '10 minutes') then
    return jsonb_build_object('ok', false, 'erro', 'duplicada');
  end if;
  insert into public.scans
    (user_id, token, piso, variante, criado_em, resultado, piso_origem, andares, segundos, no_estudo, manual)
  values
    (v_user, 'manual', p_destino, v_var, v_quando, 'valida', p_origem, p_destino - p_origem, null,
     privado.no_estudo(v_quando), true)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'variante', v_var, 'andares', p_destino - p_origem,
                            'no_estudo', privado.no_estudo(v_quando));
end
$$;


-- Apaga uma subida registada à mão (só essas; as do QR nunca).
create or replace function public.painel_apagar_subida(p_password text, p_id bigint) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_erro text := privado.verificar_painel(p_password);
begin
  if v_erro is not null then
    return jsonb_build_object('ok', false, 'erro', v_erro);
  end if;
  delete from public.scans where id = p_id and manual;
  return jsonb_build_object('ok', found);
end
$$;


drop function if exists public.painel(text, boolean);
create or replace function public.painel(p_password text, p_incluir_fora boolean default false,
                                         p_incluir_manuais boolean default true) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_erro    text := privado.verificar_painel(p_password);
  v_todos   boolean := coalesce(p_incluir_fora, false);
  v_manuais boolean := coalesce(p_incluir_manuais, true);
  v_fuso    text := privado.cfg('fuso');
  v_ini     date := privado.cfg('estudo_inicio')::date;
  v_fim     date := privado.cfg('estudo_fim')::date;
  v_hoje    date := privado.dia_local(now());
  v_d0      date;
  v_d1      date;
  v_nsem    int;
  v_fim_ts  timestamptz;
  v_part    jsonb;
  v_diario  jsonb;
  v_conv    jsonb;
  v_qual    jsonb;
  v_man     jsonb;
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
    select sc.user_id, sc.criado_em, sc.resultado, sc.andares, sc.manual,
           privado.dia_local(sc.criado_em) as dia,
           -- floor: dias antes do início ficam na "semana 0" (fora das semanas do estudo)
           floor((privado.dia_local(sc.criado_em) - v_ini) / 7.0)::int + 1 as semana
    from public.scans sc
    where (sc.no_estudo or v_todos) and (v_manuais or not sc.manual)
  ),
  pp as (
    select s.user_id, p.variante, p.meta_semanal, coalesce(c.ex_convidado, false) as ex_convidado,
           (c.user_id is not null) as tem_conta,
           min(s.criado_em) as primeiro,
           count(*) as n_scans,
           count(*) filter (where s.resultado = 'valida') as subidas,
           count(*) filter (where s.resultado = 'valida' and s.manual) as manuais,
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
           'manuais',          x.manuais,
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
    where (no_estudo or v_todos) and (v_manuais or not manual) and resultado = 'valida'
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
  where (no_estudo or v_todos) and (v_manuais or not manual) and variante = 'G';

  -- Qualidade dos dados: resultados por grupo e contas atribuídas a cada grupo.
  select jsonb_build_object(
           'resultados', coalesce((select jsonb_object_agg(variante, r) from (
              select variante, jsonb_object_agg(resultado, n) as r from (
                select variante, resultado, count(*) as n from public.scans
                where (no_estudo or v_todos) and (v_manuais or not manual) group by 1, 2) y group by variante) z), '{}'::jsonb),
           'contas_por_grupo', coalesce((select jsonb_object_agg(variante, n) from (
              select p.variante, count(*) as n from public.participantes p
              join public.contas c on c.user_id = p.user_id group by 1) w), '{}'::jsonb),
           'contas_sem_leituras', (select count(*) from public.contas c
              where not exists (select 1 from public.scans s where s.user_id = c.user_id)))
    into v_qual;

  -- Todas as subidas registadas à mão (para as poder rever ou apagar), com o pseudónimo do painel.
  with s as (
    select sc.user_id, sc.criado_em from public.scans sc
    join public.participantes p on p.user_id = sc.user_id
    where (sc.no_estudo or v_todos) and (v_manuais or not sc.manual)
  ),
  ids as (
    select user_id, 'P' || lpad(row_number() over (order by min(criado_em), user_id)::text, 3, '0') as id
    from s group by user_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',          m.id,
           'participante', ids.id,
           'variante',    m.variante,
           'dia',         privado.dia_local(m.criado_em),
           'hora',        to_char(m.criado_em at time zone v_fuso, 'HH24:MI'),
           'piso_origem', m.piso_origem,
           'piso',        m.piso,
           'no_estudo',   m.no_estudo
         ) order by m.criado_em desc), '[]'::jsonb)
    into v_man
  from public.scans m left join ids on ids.user_id = m.user_id
  where m.manual;

  return jsonb_build_object(
    'ok',                true,
    'qualidade',         v_qual,
    'inclui_fora',       v_todos,
    'inclui_manuais',    v_manuais,
    'manuais',           v_man,
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


drop function if exists public.painel_leituras(text, boolean);
create or replace function public.painel_leituras(p_password text, p_incluir_fora boolean default false,
                                                  p_incluir_manuais boolean default true) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_erro    text := privado.verificar_painel(p_password);
  v_todos   boolean := coalesce(p_incluir_fora, false);
  v_manuais boolean := coalesce(p_incluir_manuais, true);
  v_fuso    text := privado.cfg('fuso');
  v_out     jsonb;
begin
  if v_erro is not null then
    return jsonb_build_object('ok', false, 'erro', v_erro);
  end if;
  -- Mesma numeração do painel: ordem do 1.º scan considerado.
  with s as (
    select sc.* from public.scans sc
    join public.participantes p on p.user_id = sc.user_id
    where (sc.no_estudo or v_todos) and (v_manuais or not sc.manual)
  ),
  ids as (
    select user_id, 'P' || lpad(row_number() over (order by min(criado_em), user_id)::text, 3, '0') as id
    from s group by user_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'participante', ids.id,
           'variante',     s.variante,
           'data',         privado.dia_local(s.criado_em),
           'hora',         to_char(s.criado_em at time zone v_fuso, 'HH24:MI:SS'),
           'piso_origem',  s.piso_origem,
           'piso',         s.piso,
           'resultado',    s.resultado,
           'segundos',     s.segundos,
           'andares',      s.andares,
           'no_estudo',    s.no_estudo,
           'manual',       s.manual
         ) order by s.criado_em), '[]'::jsonb)
    into v_out
  from s join ids using (user_id);
  return jsonb_build_object('ok', true, 'leituras', v_out);
end
$$;


revoke execute on all functions in schema privado from public, anon, authenticated;
revoke execute on function public.painel_registar_subida(text, text, date, time, smallint, smallint) from public;
revoke execute on function public.painel_apagar_subida(text, bigint) from public;
revoke execute on function public.painel(text, boolean, boolean) from public;
revoke execute on function public.painel_leituras(text, boolean, boolean) from public;
grant execute on function public.painel_registar_subida(text, text, date, time, smallint, smallint) to anon, authenticated;
grant execute on function public.painel_apagar_subida(text, bigint) to anon, authenticated;
grant execute on function public.painel(text, boolean, boolean) to anon, authenticated;
grant execute on function public.painel_leituras(text, boolean, boolean) to anon, authenticated;
