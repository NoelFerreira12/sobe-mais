-- =====================================================================
-- Sobe+ — equilíbrio A/B pelo n.º de contas atribuídas a cada grupo.
-- (A versão anterior usava "participantes com subida válida", que enviava
--  todas as contas novas para o mesmo grupo enquanto ainda não tinham
--  feito a primeira subida — p.ex. no arranque do estudo.)
-- Regra: vai para o grupo com MENOS contas; empate -> ao acaso.
-- =====================================================================

create or replace function privado.escolher_variante() returns char(1)
language plpgsql volatile set search_path = '' as $$
declare
  v_a int; v_b int;
begin
  -- serializa atribuições simultâneas para o equilíbrio ser exato
  perform pg_advisory_xact_lock(hashtext('sobe_variante'));
  select count(*) filter (where variante = 'A'), count(*) filter (where variante = 'B')
    into v_a, v_b
  from public.participantes;
  if v_a < v_b then return 'A';
  elsif v_b < v_a then return 'B';
  else return case when random() < 0.5 then 'A' else 'B' end;
  end if;
end
$$;

revoke execute on all functions in schema privado from public, anon, authenticated;
