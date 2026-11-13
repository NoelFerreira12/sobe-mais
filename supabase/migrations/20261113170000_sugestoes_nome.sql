-- =====================================================================
-- Sobe+ — alcunhas únicas: quando o nome já existe, sugere alternativas livres.
-- (A unicidade já é garantida por contas.utilizador UNIQUE, sempre em minúsculas.)
-- =====================================================================

create or replace function privado.sugerir_nomes(p_base text) returns jsonb
language plpgsql volatile set search_path = '' as $$
declare
  v_base  text := left(regexp_replace(lower(coalesce(p_base, '')), '[^a-z0-9._-]', '', 'g'), 20);
  v_lista text[] := '{}';
  v_cand  text;
  i       int := 0;
begin
  if length(v_base) < 3 then v_base := rpad(v_base, 3, '_'); end if;
  while coalesce(array_length(v_lista, 1), 0) < 3 and i < 40 loop
    i := i + 1;
    v_cand := case
      when i = 1 then v_base || '.uma'
      when i = 2 then v_base || '_' || (10 + floor(random() * 90))::int
      else v_base || (2 + floor(random() * (case when i < 15 then 98 else 9998 end)))::int
    end;
    if length(v_cand) <= 24 and v_cand ~ '^[a-z0-9._-]{3,24}$'
       and not v_cand = any(v_lista)
       and not exists (select 1 from public.contas where utilizador = v_cand) then
      v_lista := v_lista || v_cand;
    end if;
  end loop;
  return to_jsonb(v_lista);
end
$$;

create or replace function public.criar_conta(p_utilizador text, p_password text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_u      text := lower(trim(coalesce(p_utilizador, '')));
  v_id     uuid;
  v_codigo text := privado.novo_codigo();
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
  insert into public.contas (utilizador, password_hash, recuperacao_hash)
  values (v_u,
          extensions.crypt(p_password, extensions.gen_salt('bf', 8)),
          extensions.crypt(privado.normalizar_codigo(v_codigo), extensions.gen_salt('bf', 8)))
  returning user_id into v_id;
  return jsonb_build_object('ok', true, 'user_id', v_id, 'utilizador', v_u, 'codigo_recuperacao', v_codigo);
exception when unique_violation then
  -- Duas pessoas a criar o mesmo nome ao mesmo tempo: só uma ganha.
  return jsonb_build_object('ok', false, 'erro', 'utilizador_existe', 'sugestoes', privado.sugerir_nomes(v_u));
end
$$;

revoke execute on all functions in schema privado from public, anon, authenticated;
grant execute on function public.criar_conta(text, text) to anon, authenticated;
