-- =====================================================================
-- Sobe+ — direito ao apagamento (RGPD): a pessoa apaga a conta e os dados.
--  * Com conta: exige a palavra-passe.
--  * Sem conta: basta o ID anónimo guardado no próprio telemóvel.
-- Apaga participante + scans (cascade) + conta. Os totais coletivos
-- são recalculados a partir dos scans, por isso também deixam de os contar.
-- =====================================================================

create or replace function public.apagar_dados(p_user_id uuid, p_password text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_nome text;
  v_hash text;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'erro', 'pedido_invalido');
  end if;
  select utilizador, password_hash into v_nome, v_hash from public.contas where user_id = p_user_id;
  if v_nome is not null then
    if (select count(*) from public.login_tentativas
        where utilizador = v_nome and not ok and criado_em > now() - interval '15 minutes') >= 10 then
      return jsonb_build_object('ok', false, 'erro', 'bloqueado');
    end if;
    if p_password is null or extensions.crypt(p_password, v_hash) is distinct from v_hash then
      insert into public.login_tentativas (utilizador, ok) values (v_nome, false);
      return jsonb_build_object('ok', false, 'erro', 'credenciais');
    end if;
  end if;
  delete from public.participantes where user_id = p_user_id;   -- apaga também os scans
  delete from public.contas where user_id = p_user_id;
  if v_nome is not null then
    delete from public.login_tentativas where utilizador = v_nome;
  end if;
  return jsonb_build_object('ok', true);
end
$$;

revoke execute on function public.apagar_dados(uuid, text) from public, anon, authenticated;
grant  execute on function public.apagar_dados(uuid, text) to anon, authenticated;
