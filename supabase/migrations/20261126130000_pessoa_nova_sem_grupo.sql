-- =====================================================================
-- Sobe+ — registar subida de uma pessoa nova sem grupo (painel)
--  * Para quem subiu mas não tem conta nem ID: cria um participante novo
--    "sem grupo" (G, fora da comparação A/B) com essa subida (manual = true).
--  * Só dia, hora, piso de partida e de chegada (mesmas regras do registo à mão).
--  * Apagar a subida de uma pessoa destas que fica sem leituras apaga também a pessoa.
-- =====================================================================

create or replace function public.painel_registar_sem_grupo(
  p_password text, p_dia date, p_hora time, p_origem smallint, p_destino smallint,
  p_incluir_fora boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_erro   text := privado.verificar_painel(p_password);
  v_todos  boolean := coalesce(p_incluir_fora, false);
  v_quando timestamptz;
  v_user   uuid := gen_random_uuid();
  v_id     bigint;
  v_pid    text;
begin
  if v_erro is not null then
    return jsonb_build_object('ok', false, 'erro', v_erro);
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

  insert into public.participantes (user_id, variante) values (v_user, 'G');
  insert into public.scans
    (user_id, token, piso, variante, criado_em, resultado, piso_origem, andares, segundos, no_estudo, manual)
  values
    (v_user, 'manual', p_destino, 'G', v_quando, 'valida', p_origem, p_destino - p_origem, null,
     privado.no_estudo(v_quando), true)
  returning id into v_id;

  -- ID anónimo da pessoa nova, com a mesma numeração do painel.
  with s as (
    select sc.user_id, sc.criado_em from public.scans sc
    join public.participantes p on p.user_id = sc.user_id
    where (sc.no_estudo or v_todos)
  ),
  ids as (
    select user_id, 'P' || lpad(row_number() over (order by min(criado_em), user_id)::text, 3, '0') as id
    from s group by user_id
  )
  select id into v_pid from ids where user_id = v_user;

  return jsonb_build_object('ok', true, 'id', v_id, 'variante', 'G', 'participante', v_pid,
                            'andares', p_destino - p_origem, 'no_estudo', privado.no_estudo(v_quando));
end
$$;


-- Apaga uma subida registada à mão (só essas; as do QR nunca). Se era de uma pessoa
-- sem grupo e sem conta que fica sem leituras, apaga também essa pessoa.
create or replace function public.painel_apagar_subida(p_password text, p_id bigint) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_erro text := privado.verificar_painel(p_password);
  v_user uuid;
begin
  if v_erro is not null then
    return jsonb_build_object('ok', false, 'erro', v_erro);
  end if;
  delete from public.scans where id = p_id and manual returning user_id into v_user;
  if v_user is null then
    return jsonb_build_object('ok', false);
  end if;
  delete from public.participantes p
  where p.user_id = v_user and p.variante = 'G'
    and not exists (select 1 from public.contas c where c.user_id = v_user)
    and not exists (select 1 from public.scans s where s.user_id = v_user);
  return jsonb_build_object('ok', true);
end
$$;

revoke execute on all functions in schema privado from public, anon, authenticated;
revoke execute on function public.painel_registar_sem_grupo(text, date, time, smallint, smallint, boolean) from public;
revoke execute on function public.painel_apagar_subida(text, bigint) from public;
grant execute on function public.painel_registar_sem_grupo(text, date, time, smallint, smallint, boolean) to anon, authenticated;
grant execute on function public.painel_apagar_subida(text, bigint) to anon, authenticated;
