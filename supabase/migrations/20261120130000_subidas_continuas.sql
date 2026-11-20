-- =====================================================================
-- Sobe+ — subidas contínuas ("continua")
-- Os cartazes intermédios dizem "Lê aqui ao chegar e antes de continuar a subir".
-- Quem lê o QR em cada piso numa subida contínua tinha os pisos seguintes
-- travados pelo intervalo de 5 min ("cooldown") e perdia andares.
-- Agora: uma leitura num piso mais alto, dentro dos tempos, logo a seguir a uma
-- leitura 'valida' ou 'continua', é 'continua' — soma andares e metros à MESMA
-- subida (não conta como subida nova, para não favorecer quem lê mais QR).
-- O intervalo de 5 min continua a aplicar-se a subidas novas.
-- As leituras 'cooldown' já gravadas que eram continuações são corrigidas.
-- =====================================================================

alter table public.scans drop constraint scans_resultado_check;
alter table public.scans add constraint scans_resultado_check check (resultado in
  ('inicio', 'valida', 'continua', 'rapido', 'lento', 'descer', 'cooldown', 'repetido'));

create or replace function privado.lancos(p_user_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_object_agg(l::text, n), '{}'::jsonb)
  from (
    select g as l, count(*) as n
    from public.scans s
    cross join lateral generate_series(s.piso_origem::int, s.piso::int - 1) as g
    where s.resultado in ('valida', 'continua')
      and (p_user_id is null or s.user_id = p_user_id)
    group by g
  ) x
$$;

create or replace function privado.pessoal(p_user_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'subidas', count(*) filter (where resultado = 'valida'),
    'andares', coalesce(sum(andares), 0),
    'lancos',  privado.lancos(p_user_id))
  from public.scans
  where user_id = p_user_id and resultado in ('valida', 'continua')
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
  v_ult_res    text;
  v_total      integer;
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
    select piso, criado_em, resultado into v_ult_piso, v_ult_tempo, v_ult_res
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
      elsif v_ult_res in ('valida', 'continua') then
        -- Continua a subir logo a seguir a uma subida válida: mesma subida, mais andares.
        v_res := 'continua';
      else
        -- Intervalo de 5 min contado a partir do FIM da última subida (válida ou continuação).
        select max(criado_em) into v_ult_valida
        from public.scans where user_id = p_user_id and resultado in ('valida', 'continua');
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

  -- Andares da subida em curso (a válida + as continuações seguintes).
  if v_res in ('valida', 'continua') then
    select coalesce(sum(andares), 0) into v_total from public.scans
    where user_id = p_user_id and resultado in ('valida', 'continua')
      and criado_em >= (select max(criado_em) from public.scans
                        where user_id = p_user_id and resultado = 'valida');
  end if;

  v_out := jsonb_build_object(
    'ok',                    true,
    'andares_subida',        v_total,
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
  if v_res in ('valida', 'continua') then
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


create or replace function public.progresso_coletivo() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'subidas', count(*) filter (where resultado = 'valida'),
    'andares', coalesce(sum(andares), 0),
    'pessoas', count(distinct user_id) filter (where resultado = 'valida'),
    'lancos',  privado.lancos(null),
    'hoje',    privado.dia_local(now()),
    'dias',    (select coalesce(jsonb_agg(jsonb_build_object('d', d, 'n', n) order by d), '[]'::jsonb)
                from (select privado.dia_local(s2.criado_em) as d, count(*) as n
                      from public.scans s2
                      where s2.resultado = 'valida' and s2.criado_em > now() - interval '15 days'
                      group by 1) x))
  from public.scans
  where resultado in ('valida', 'continua')
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
           coalesce(sum(s.andares) filter (where s.resultado in ('valida', 'continua')), 0) as andares,
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


-- Corrige as leituras já gravadas: 'cooldown' que eram continuação de uma subida válida.
-- (Uma leitura só chegava a 'cooldown' depois de passar nos tempos, por isso basta ver
--  se a leitura anterior — sem contar repetidos — foi 'valida' ou 'continua'.)
do $$
declare
  r record;
  v_ant text;
begin
  for r in select id, user_id, criado_em from public.scans where resultado = 'cooldown' order by criado_em loop
    select resultado into v_ant from public.scans
    where user_id = r.user_id and criado_em < r.criado_em and resultado <> 'repetido'
    order by criado_em desc limit 1;
    if v_ant in ('valida', 'continua') then
      update public.scans set resultado = 'continua' where id = r.id;
    end if;
  end loop;
end
$$;

revoke execute on all functions in schema privado from public, anon, authenticated;
grant execute on function public.registar_scan(uuid, text)       to anon, authenticated;
grant execute on function public.progresso_coletivo()            to anon, authenticated;
grant execute on function public.painel(text, boolean)           to anon, authenticated;
