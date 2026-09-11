-- Seven RH — retour Betty du 11/09/2026 (point 1, étape 2) : hydrateCurrentCompany ne rapatrie plus
-- désormais qu'une fenêtre glissante de notes de frais (~40 mois, voir HYDRATION_WINDOW_MONTHS,
-- supabase-client.js) — la fiche salarié "Notes de frais" (renderEmployeeFraisCard, app.js)
-- affichait jusqu'ici un total/nombre TOUTE PÉRIODE calculé sur ce cache local, qui deviendrait
-- silencieusement FAUX (sous-évalué) pour un salarié dont l'historique dépasse la fenêtre. Cette
-- fonction calcule le vrai total côté serveur, sans jamais rapatrier les lignes elles-mêmes.
--
-- PAS security definer, volontairement : elle tourne avec les privilèges de l'appelant, donc la
-- policy RLS existante sur expenses (expenses_select, 0002_rls_policies.sql : soi-même, ou
-- voirSalaries, ou manager) s'applique normalement — un salarié anonyme (sans session) ou qui n'a
-- pas le droit de voir ce salarié obtient un total à zéro, jamais une fuite. Revoke/grant explicites
-- ci-dessous par simple bonne hygiène (voir la leçon de 0039/0041 sur ce même sujet), même si le
-- comportement resterait sûr sans, contrairement aux fonctions security definer de 0039/0041.
create or replace function get_expense_totals_for_employee(p_employee_id text)
returns table(total_count integer, total_montant numeric, en_attente_count integer)
language sql
stable
as $$
  select
    count(*)::integer as total_count,
    coalesce(sum(montant_ttc), 0) as total_montant,
    count(*) filter (where statut = 'En attente')::integer as en_attente_count
  from expenses
  where employee_id = p_employee_id;
$$;

revoke all on function get_expense_totals_for_employee(text) from public, anon, authenticated;
grant execute on function get_expense_totals_for_employee(text) to authenticated;

insert into schema_migrations (version) values ('0048_expense_totals_rpc') on conflict do nothing;
