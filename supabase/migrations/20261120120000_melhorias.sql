-- =====================================================================
-- Sobe+ — melhorias sem impacto no teste A/B
--  * painel: cartão de qualidade dos dados (resultados por grupo, contas por grupo)
--  * painel_leituras: uma linha por leitura (pseudónimos iguais aos do painel)
--  * meus_dados: a pessoa descarrega os seus dados (RGPD: acesso/portabilidade)
-- =====================================================================

-- Uma linha por leitura, para análise fina (hora do dia, tempos, rejeições).
create or replace function public.painel_leituras(p_password text, p_incluir_fora boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_erro  text := privado.verificar_painel(p_password);
  v_todos boolean := coalesce(p_incluir_fora, false);
  v_fuso  text := privado.cfg('fuso');
  v_out   jsonb;
begin
  if v_erro is not null then
    return jsonb_build_object('ok', false, 'erro', v_erro);
  end if;
  -- Mesma numeração do painel: ordem do 1.º scan considerado.
  with s as (
    select sc.* from public.scans sc where sc.no_estudo or v_todos
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
           'no_estudo',    s.no_estudo
         ) order by s.criado_em), '[]'::jsonb)
    into v_out
  from s join ids using (user_id);
  return jsonb_build_object('ok', true, 'leituras', v_out);
end
$$;

-- Os dados da própria pessoa (o ID anónimo funciona como chave, tal como no resto da app).
create or replace function public.meus_dados(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_fuso text := privado.cfg('fuso');
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'erro', 'pedido_invalido');
  end if;
  return jsonb_build_object(
    'ok', true,
    'gerado_em', now(),
    'conta', (select jsonb_build_object('alcunha', utilizador, 'criada_em', criado_em,
                                        'usou_sem_conta_antes', ex_convidado)
              from public.contas where user_id = p_user_id),
    'participacao', (select jsonb_build_object(
                       'grupo', case variante when 'A' then 'coletivo' when 'B' then 'pessoal' else 'sem conta (coletivo)' end,
                       'meta_semanal', meta_semanal, 'desde', criado_em)
                     from public.participantes where user_id = p_user_id),
    'leituras', (select coalesce(jsonb_agg(jsonb_build_object(
                    'data_hora', to_char(criado_em at time zone v_fuso, 'YYYY-MM-DD HH24:MI:SS'),
                    'piso', piso, 'piso_origem', piso_origem, 'resultado', resultado,
                    'segundos', segundos, 'andares', andares) order by criado_em), '[]'::jsonb)
                 from public.scans where user_id = p_user_id),
    'nota', 'A palavra-passe e o código de recuperação estão guardados cifrados e não são exportados.');
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
revoke execute on function public.painel_leituras(text, boolean) from public, anon, authenticated;
revoke execute on function public.meus_dados(uuid)               from public, anon, authenticated;
grant  execute on function public.painel_leituras(text, boolean) to anon, authenticated;
grant  execute on function public.meus_dados(uuid)               to anon, authenticated;
grant  execute on function public.painel(text, boolean)          to anon, authenticated;
