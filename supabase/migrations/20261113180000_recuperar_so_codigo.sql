-- =====================================================================
-- Sobe+ — recuperar a conta só com o código (para quem esquece a alcunha)
-- O código tem 12 caracteres aleatórios de 31 símbolos (~2^59 combinações),
-- por isso pode ser guardado com SHA-256 e procurado diretamente.
-- Mudar a palavra-passe de uma conta exige SEMPRE o código dessa conta.
-- =====================================================================

alter table public.contas add column recuperacao_sha text unique;

create or replace function privado.sha_codigo(p text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(privado.normalizar_codigo(p), 'sha256'), 'hex')
$$;

-- ---------------------------------------------------------------------
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
  insert into public.contas (utilizador, password_hash, recuperacao_sha)
  values (v_u, extensions.crypt(p_password, extensions.gen_salt('bf', 8)), privado.sha_codigo(v_codigo))
  returning user_id into v_id;
  return jsonb_build_object('ok', true, 'user_id', v_id, 'utilizador', v_u, 'codigo_recuperacao', v_codigo);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'erro', 'utilizador_existe', 'sugestoes', privado.sugerir_nomes(v_u));
end
$$;

-- p_utilizador é opcional: sem ele, a conta é encontrada pelo código.
create or replace function public.recuperar_conta(p_utilizador text, p_codigo text, p_nova_password text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_u      text := lower(trim(coalesce(p_utilizador, '')));
  v_chave  text;
  v_id     uuid;
  v_nome   text;
  v_sha    text;
  v_bcrypt text;
  v_ok     boolean := false;
  v_codigo text;
  v_limite int;
begin
  -- Tentativas falhadas: por alcunha, ou num balde global quando se usa só o código.
  v_chave  := case when v_u = '' then '*codigo*' else left(v_u, 64) end;
  v_limite := case when v_u = '' then 30 else 10 end;
  if (select count(*) from public.login_tentativas
      where utilizador = v_chave and not ok and criado_em > now() - interval '15 minutes') >= v_limite then
    return jsonb_build_object('ok', false, 'erro', 'bloqueado');
  end if;
  if p_nova_password is null or length(p_nova_password) < 6 or length(p_nova_password) > 72 then
    return jsonb_build_object('ok', false, 'erro', 'password_curta');
  end if;
  if length(privado.normalizar_codigo(p_codigo)) <> 12 then
    insert into public.login_tentativas (utilizador, ok) values (v_chave, false);
    return jsonb_build_object('ok', false, 'erro', 'codigo_errado');
  end if;

  if v_u = '' then
    select user_id, utilizador into v_id, v_nome
    from public.contas where recuperacao_sha = privado.sha_codigo(p_codigo);
    v_ok := v_id is not null;
  else
    select user_id, utilizador, recuperacao_sha, recuperacao_hash into v_id, v_nome, v_sha, v_bcrypt
    from public.contas where utilizador = v_u;
    v_ok := v_id is not null and (
      v_sha = privado.sha_codigo(p_codigo)
      or (v_bcrypt is not null and extensions.crypt(privado.normalizar_codigo(p_codigo), v_bcrypt) = v_bcrypt));
  end if;

  if not v_ok then
    insert into public.login_tentativas (utilizador, ok) values (v_chave, false);
    return jsonb_build_object('ok', false, 'erro', 'codigo_errado');
  end if;

  v_codigo := privado.novo_codigo();
  update public.contas
     set password_hash    = extensions.crypt(p_nova_password, extensions.gen_salt('bf', 8)),
         recuperacao_sha  = privado.sha_codigo(v_codigo),
         recuperacao_hash = null
   where user_id = v_id;
  insert into public.login_tentativas (utilizador, ok) values (v_nome, true);
  return jsonb_build_object('ok', true, 'user_id', v_id, 'utilizador', v_nome, 'codigo_recuperacao', v_codigo);
end
$$;

create or replace function public.novo_codigo_recuperacao(p_user_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_codigo text := privado.novo_codigo();
  v_nome   text;
begin
  update public.contas
     set recuperacao_sha = privado.sha_codigo(v_codigo), recuperacao_hash = null
   where user_id = p_user_id
  returning utilizador into v_nome;
  if v_nome is null then
    return jsonb_build_object('ok', false, 'erro', 'sem_conta');
  end if;
  return jsonb_build_object('ok', true, 'utilizador', v_nome, 'codigo_recuperacao', v_codigo);
end
$$;

revoke execute on all functions in schema privado from public, anon, authenticated;
grant execute on function public.criar_conta(text, text)                to anon, authenticated;
grant execute on function public.recuperar_conta(text, text, text)      to anon, authenticated;
grant execute on function public.novo_codigo_recuperacao(uuid)          to anon, authenticated;
