-- =====================================================================
-- Sobe+ — registar subida esquecida também para quem não tem alcunha
--  * p_utilizador aceita a alcunha OU o ID anónimo do painel (P001, P002…).
--    Assim dá para registar subidas de quem está "sem grupo" (G, usou sem conta).
--  * O ID é calculado como no painel (mesma ordem e o mesmo p_incluir_fora).
--  * Conta que ainda não tem grupo (criada mas nunca usada): recebe o grupo
--    agora, como aconteceria na 1.ª leitura (privado.garantir_participante).
-- =====================================================================

drop function if exists public.painel_registar_subida(text, text, date, time, smallint, smallint);

create or replace function public.painel_registar_subida(
  p_password text, p_utilizador text, p_dia date, p_hora time, p_origem smallint, p_destino smallint,
  p_incluir_fora boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_erro   text := privado.verificar_painel(p_password);
  v_u      text := lower(trim(coalesce(p_utilizador, '')));
  v_todos  boolean := coalesce(p_incluir_fora, false);
  v_quando timestamptz;
  v_user   uuid;
  v_var    char(1);
  v_id     bigint;
begin
  if v_erro is not null then
    return jsonb_build_object('ok', false, 'erro', v_erro);
  end if;

  -- 1) alcunha
  select c.user_id into v_user from public.contas c where c.utilizador = v_u;
  if v_user is not null then
    v_var := privado.garantir_participante(v_user);
  -- 2) ID anónimo do painel (P001…), com a mesma numeração do painel
  elsif v_u ~ '^p[0-9]{1,6}$' then
    with s as (
      select sc.user_id, sc.criado_em from public.scans sc
      join public.participantes p on p.user_id = sc.user_id
      where (sc.no_estudo or v_todos)
    ),
    ids as (
      select user_id, row_number() over (order by min(criado_em), user_id) as rn
      from s group by user_id
    )
    select ids.user_id, p.variante into v_user, v_var
    from ids join public.participantes p on p.user_id = ids.user_id
    where ids.rn = substr(v_u, 2)::bigint;
  end if;

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

revoke execute on all functions in schema privado from public, anon, authenticated;
revoke execute on function public.painel_registar_subida(text, text, date, time, smallint, smallint, boolean) from public;
grant execute on function public.painel_registar_subida(text, text, date, time, smallint, smallint, boolean) to anon, authenticated;
