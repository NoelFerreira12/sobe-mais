-- =====================================================================
-- Sobe+ — schema inicial
-- Tabelas privadas (RLS sem políticas + revoke); a anon key só chama RPC.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- Funções auxiliares ficam num schema não exposto pela API.
create schema if not exists privado;
revoke all on schema privado from public;
revoke all on schema privado from anon, authenticated;

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------
create table public.config (
  chave     text primary key,
  valor     text not null,
  descricao text
);

insert into public.config (chave, valor, descricao) values
  ('min_seg_por_andar',      '12',               'Tempo mínimo (s) por andar subido'),
  ('max_seg_por_andar',      '180',              'Tempo máximo (s) por andar subido'),
  ('cooldown_seg',           '300',              'Depois de uma subida válida, novas subidas só contam passado este tempo (s)'),
  ('sessao_max_seg',         '3600',             'Se o scan anterior tiver mais do que isto (s), começa-se de novo'),
  ('repetido_seg',           '30',               'Ler o mesmo QR outra vez dentro deste tempo (s) conta como repetição'),
  ('rate_min_intervalo_seg', '2',                'Intervalo mínimo (s) entre scans do mesmo ID'),
  ('rate_max_hora',          '60',               'Máximo de scans por ID por hora'),
  ('estudo_inicio',          '2026-11-16',       '1.º dia do estudo (inclusive, hora da Madeira)'),
  ('estudo_fim',             '2026-12-08',       'Último dia do estudo (inclusive, hora da Madeira)'),
  ('fuso',                   'Atlantic/Madeira', 'Fuso horário usado para dias e semanas');

create table public.pisos (
  piso   smallint primary key check (piso between -3 and 3),
  codigo text not null unique,
  -- token aleatório (16 caracteres URL-safe); nunca fica no repositório
  token  text not null unique
         default translate(encode(extensions.gen_random_bytes(12), 'base64'), '+/=', '-_')
);

insert into public.pisos (piso, codigo) values
  (-3, 'SM-M3'), (-2, 'SM-M2'), (-1, 'SM-M1'), (0, 'SM-00'),
  ( 1, 'SM-P1'), ( 2, 'SM-P2'), ( 3, 'SM-P3');

create table public.participantes (
  user_id      uuid primary key,
  variante     char(1) not null check (variante in ('A', 'B')),
  meta_semanal smallint check (meta_semanal between 1 and 14),
  criado_em    timestamptz not null default now()
);

create table public.scans (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.participantes (user_id) on delete cascade,
  token       text not null,
  piso        smallint not null references public.pisos (piso),
  variante    char(1) not null,
  criado_em   timestamptz not null default now(),
  resultado   text not null check (resultado in
                ('inicio', 'valida', 'rapido', 'lento', 'descer', 'cooldown', 'repetido')),
  piso_origem smallint,
  andares     smallint,
  segundos    integer,
  no_estudo   boolean not null
);

create index scans_user_tempo on public.scans (user_id, criado_em desc);
create index scans_validas    on public.scans (criado_em) where resultado = 'valida';
create index scans_estudo     on public.scans (criado_em) where no_estudo;

create table public.painel_tentativas (
  id        bigint generated always as identity primary key,
  criado_em timestamptz not null default now(),
  ok        boolean not null
);

alter table public.config            enable row level security;
alter table public.pisos             enable row level security;
alter table public.participantes     enable row level security;
alter table public.scans             enable row level security;
alter table public.painel_tentativas enable row level security;
-- Sem políticas: anon/authenticated não leem nem escrevem diretamente.

-- ---------------------------------------------------------------------
-- Auxiliares (schema privado)
-- ---------------------------------------------------------------------
create or replace function privado.cfg(p_chave text) returns text
language sql stable set search_path = '' as $$
  select valor from public.config where chave = p_chave
$$;

create or replace function privado.cfg_num(p_chave text) returns numeric
language sql stable set search_path = '' as $$
  select valor::numeric from public.config where chave = p_chave
$$;

create or replace function privado.dia_local(p_t timestamptz) returns date
language sql stable set search_path = '' as $$
  select (p_t at time zone privado.cfg('fuso'))::date
$$;

create or replace function privado.no_estudo(p_t timestamptz) returns boolean
language sql stable set search_path = '' as $$
  select privado.dia_local(p_t) between privado.cfg('estudo_inicio')::date
                                    and privado.cfg('estudo_fim')::date
$$;

-- N.º de vezes que cada lanço foi subido (chave = piso de baixo do lanço).
-- p_user_id null => todos. Os metros calculam-se no cliente com a altura atual.
create or replace function privado.lancos(p_user_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_object_agg(l::text, n), '{}'::jsonb)
  from (
    select g as l, count(*) as n
    from public.scans s
    cross join lateral generate_series(s.piso_origem::int, s.piso::int - 1) as g
    where s.resultado = 'valida'
      and (p_user_id is null or s.user_id = p_user_id)
    group by g
  ) x
$$;

create or replace function privado.pessoal(p_user_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'subidas', count(*),
    'andares', coalesce(sum(andares), 0),
    'lancos',  privado.lancos(p_user_id))
  from public.scans
  where user_id = p_user_id and resultado = 'valida'
$$;

-- Devolve null se a password estiver certa; senão o código do erro.
create or replace function privado.verificar_painel(p_password text) returns text
language plpgsql volatile set search_path = '' as $$
declare
  v_hash text := privado.cfg('painel_hash');
begin
  if (select count(*) from public.painel_tentativas
      where not ok and criado_em > now() - interval '15 minutes') >= 20 then
    return 'bloqueado';
  end if;
  if v_hash is null or p_password is null
     or extensions.crypt(p_password, v_hash) <> v_hash then
    insert into public.painel_tentativas (ok) values (false);
    return 'password';
  end if;
  insert into public.painel_tentativas (ok) values (true);
  return null;
end
$$;

-- ---------------------------------------------------------------------
-- RPC públicas
-- ---------------------------------------------------------------------

-- Progresso coletivo (só usado pela variante A e pelo keep-alive).
create or replace function public.progresso_coletivo() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'subidas', count(*),
    'andares', coalesce(sum(andares), 0),
    'pessoas', count(distinct user_id),
    'lancos',  privado.lancos(null))
  from public.scans
  where resultado = 'valida'
$$;

-- Estado comum às duas variantes (sem números coletivos).
create or replace function public.estado_utilizador(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_meta      smallint;
  v_dias      jsonb;
  v_ult_piso  smallint;
  v_ult_tempo timestamptz;
  v_ult_res   text;
begin
  select meta_semanal into v_meta from public.participantes where user_id = p_user_id;
  if not found then
    return jsonb_build_object('existe', false, 'hoje', privado.dia_local(now()));
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
    'meta_semanal', v_meta,
    'dias',         v_dias,
    'hoje',         privado.dia_local(now()),
    'ultimo_scan',  case when v_ult_tempo is null then null else jsonb_build_object(
                      'piso', v_ult_piso,
                      'resultado', v_ult_res,
                      'segundos_desde', floor(extract(epoch from now() - v_ult_tempo))) end);
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

  -- 1.º scan: variante A/B ao acaso (50/50); nunca muda depois.
  insert into public.participantes (user_id, variante)
  values (p_user_id, case when random() < 0.5 then 'A' else 'B' end)
  on conflict (user_id) do nothing;

  -- Bloqueia o participante para serializar scans simultâneos do mesmo ID.
  select variante into v_var from public.participantes where user_id = p_user_id for update;

  -- Rate limit
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

  -- Regras da subida
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

create or replace function public.definir_meta(p_user_id uuid, p_meta integer) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_meta is not null and (p_meta < 1 or p_meta > 14) then
    return jsonb_build_object('ok', false, 'erro', 'meta_invalida');
  end if;
  update public.participantes set meta_semanal = p_meta where user_id = p_user_id;
  if not found then
    return jsonb_build_object('ok', false, 'erro', 'sem_participante');
  end if;
  return jsonb_build_object('ok', true, 'meta_semanal', p_meta);
end
$$;

-- Painel do docente: só dados agregados (por participante pseudonimizado e por dia).
create or replace function public.painel(p_password text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_erro   text := privado.verificar_painel(p_password);
  v_fuso   text := privado.cfg('fuso');
  v_ini    date := privado.cfg('estudo_inicio')::date;
  v_fim    date := privado.cfg('estudo_fim')::date;
  v_hoje   date := privado.dia_local(now());
  v_nsem   int;
  v_fim_ts timestamptz;
  v_part   jsonb;
  v_diario jsonb;
begin
  if v_erro is not null then
    return jsonb_build_object('ok', false, 'erro', v_erro);
  end if;

  v_nsem   := ceil((v_fim - v_ini + 1) / 7.0);
  v_fim_ts := ((v_fim + 1)::timestamp at time zone v_fuso);

  with s as (
    select sc.user_id, sc.criado_em, sc.resultado, sc.andares,
           privado.dia_local(sc.criado_em) as dia,
           (privado.dia_local(sc.criado_em) - v_ini) / 7 + 1 as semana
    from public.scans sc
    where sc.no_estudo
  ),
  pp as (
    select s.user_id, p.variante, p.meta_semanal,
           min(s.criado_em) as primeiro,
           count(*) as n_scans,
           count(*) filter (where s.resultado = 'valida') as subidas,
           coalesce(sum(s.andares) filter (where s.resultado = 'valida'), 0) as andares,
           count(distinct s.dia) filter (where s.resultado = 'valida') as dias
    from s join public.participantes p on p.user_id = s.user_id
    group by s.user_id, p.variante, p.meta_semanal
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
           'meta_semanal',     x.meta_semanal
         ) order by x.rn), '[]'::jsonb)
    into v_part
  from x;

  with dd as (
    select d::date as dia
    from generate_series(v_ini::timestamp, least(v_hoje, v_fim)::timestamp, interval '1 day') d
  ),
  v as (
    select privado.dia_local(criado_em) as dia, variante,
           count(*) as n, count(distinct user_id) as p
    from public.scans
    where no_estudo and resultado = 'valida'
    group by 1, 2
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'dia', dd.dia,
           'A', coalesce(a.n, 0), 'B', coalesce(b.n, 0),
           'A_pessoas', coalesce(a.p, 0), 'B_pessoas', coalesce(b.p, 0)
         ) order by dd.dia), '[]'::jsonb)
    into v_diario
  from dd
  left join v a on a.dia = dd.dia and a.variante = 'A'
  left join v b on b.dia = dd.dia and b.variante = 'B';

  return jsonb_build_object(
    'ok',             true,
    'gerado_em',      now(),
    'estudo',         jsonb_build_object('inicio', v_ini, 'fim', v_fim, 'hoje', v_hoje, 'semanas', v_nsem),
    'regras',         jsonb_build_object(
                        'min_seg_por_andar', privado.cfg_num('min_seg_por_andar'),
                        'max_seg_por_andar', privado.cfg_num('max_seg_por_andar'),
                        'cooldown_seg',      privado.cfg_num('cooldown_seg')),
    'participantes',  v_part,
    'diario',         v_diario,
    'scans_fora_estudo', (select count(*) from public.scans where not no_estudo));
end
$$;

-- Tokens dos pisos para gerar QR/cartazes (protegido pela password do painel).
create or replace function public.pisos_qr(p_password text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_erro text := privado.verificar_painel(p_password);
begin
  if v_erro is not null then
    return jsonb_build_object('ok', false, 'erro', v_erro);
  end if;
  return jsonb_build_object('ok', true, 'pisos',
    (select jsonb_agg(jsonb_build_object('piso', piso, 'codigo', codigo, 'token', token) order by piso)
     from public.pisos));
end
$$;

-- ---------------------------------------------------------------------
-- Permissões: anon/authenticated só executam as RPC públicas.
-- ---------------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public  from public, anon, authenticated;
revoke execute on all functions in schema privado from public, anon, authenticated;

grant execute on function public.registar_scan(uuid, text)     to anon, authenticated;
grant execute on function public.estado_utilizador(uuid)       to anon, authenticated;
grant execute on function public.progresso_coletivo()          to anon, authenticated;
grant execute on function public.definir_meta(uuid, integer)   to anon, authenticated;
grant execute on function public.painel(text)                  to anon, authenticated;
grant execute on function public.pisos_qr(text)                to anon, authenticated;
