-- Seven RH — audit du 09/10/2026 : la délégation de validation d'un manager ne fonctionnait pas côté site
-- pour le remplaçant.
--
-- Constat (vérifié) : le serveur connaît déjà les délégations (is_manager_of, 0057 : le remplaçant peut
-- lire/valider l'équipe déléguée), mais le SITE décide quoi afficher à partir de la fiche du manager
-- délégant (employees.data.delegations) — fiche que le remplaçant ne peut pas lire (employees_select ne
-- l'ouvre ni à soi, ni à voirSalaries, ni à is_manager_of). isManagerOfEmployee ne trouvait donc jamais
-- la délégation : aucun bouton Valider, malgré un droit serveur bien réel.
--
-- Correctif : une fonction qui ne renvoie QUE les délégations adressées à l'appelant (identifiant du
-- délégant et fenêtre de dates), jamais le reste de la fiche du délégant.

begin;

create or replace function delegations_recues()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object('delegantId', e.id, 'dateDebut', d->>'dateDebut', 'dateFin', d->>'dateFin')),
    '[]'::jsonb
  )
  from employees e
  cross join lateral jsonb_array_elements(coalesce(e.data->'delegations', '[]'::jsonb)) d
  where e.company_id = current_company_id()
    and not e.archive
    and current_employee_id() is not null
    and d->>'delegataireId' = current_employee_id();
$$;

revoke all on function delegations_recues() from public, anon;
grant execute on function delegations_recues() to authenticated;

insert into schema_migrations (version) values ('0069_delegations_recues') on conflict do nothing;

commit;
