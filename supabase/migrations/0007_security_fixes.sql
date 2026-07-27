-- Seven RH — corrections de sécurité trouvées par l'audit RLS
--
-- 1. Policies DELETE manquantes sur leave_requests/telework_requests/expenses : data.js
--    (saveLeaveRequests/saveTeleworkRequests/saveExpenses) supprime bien des lignes (nettoyage en
--    cascade quand un salarié ou un type de congé est supprimé), mais aucune policy DELETE
--    n'existait — la suppression échouait silencieusement côté Supabase (0 ligne affectée, aucune
--    erreur remontée), laissant des lignes fantômes.
create policy leave_requests_delete on leave_requests for delete
  using (
    company_id = current_company_id()
    and (has_permission('gererUtilisateurs') or has_permission('gererParametres')
         or has_permission('validerAbsence') or has_permission('refuserAbsence') or has_permission('annulerAbsence'))
  );

create policy telework_requests_delete on telework_requests for delete
  using (
    company_id = current_company_id()
    and (has_permission('gererUtilisateurs') or has_permission('gererParametres')
         or has_permission('validerAbsence') or has_permission('refuserAbsence') or has_permission('annulerAbsence'))
  );

create policy expenses_delete on expenses for delete
  using (
    company_id = current_company_id()
    and (has_permission('gererUtilisateurs') or has_permission('gererParametres')
         or has_permission('validerNoteFrais') or has_permission('controlerNoteFrais'))
  );

-- 2. Les policies UPDATE de ces 3 tables n'avaient pas de WITH CHECK, donc pas de restriction sur
--    QUELS champs peuvent changer une fois la ligne autorisée — un manager habilité à "contrôler"
--    une note de frais pouvait en théorie en réécrire le montant, les dates, etc. via un appel API
--    direct. Restreint via GRANT au niveau colonne (RLS ne peut pas comparer ancien/nouveau par
--    colonne) : seuls statut/etape_index/data (qui contient l'historique, légitimement modifié lors
--    d'une validation) restent modifiables par une mise à jour "normale" ; montant/dates/références
--    deviennent immuables après création.
revoke update on leave_requests from authenticated;
grant update (statut, etape_index, data) on leave_requests to authenticated;

revoke update on telework_requests from authenticated;
grant update (statut, etape_index, data) on telework_requests to authenticated;

revoke update on expenses from authenticated;
grant update (statut, etape_index, data) on expenses to authenticated;

-- 3. Le calendrier général montrait aussi les demandes Refusé/Annulé (fuite d'information mineure :
--    une entreprise entière voyait qu'une demande d'un collègue avait été refusée). Restreint aux
--    statuts pertinents pour "qui est absent" (Validé/En attente).
drop view if exists leave_requests_calendar;
create view leave_requests_calendar as
select id, company_id, employee_id, type_id, date_debut, date_fin, statut, (data->>'demiJournee') as demi_journee
from leave_requests
where company_id = current_company_id() and statut in ('Validé', 'En attente');
grant select on leave_requests_calendar to authenticated;

drop view if exists telework_requests_calendar;
create view telework_requests_calendar as
select id, company_id, employee_id, date_debut, date_fin, statut
from telework_requests
where company_id = current_company_id() and statut in ('Validé', 'En attente');
grant select on telework_requests_calendar to authenticated;

-- 4. La création de compte en libre-service (0006) n'imposait aucune vérification : n'importe qui
--    pouvait s'auto-créer un vrai salarié "salarie" avec accès aux données de l'entreprise. Ajoute
--    une vérification par domaine d'email : la création (pas la simple LIAISON à une fiche déjà
--    créée par RH, qui reste inchangée) n'a lieu que si le domaine de l'email correspond à celui
--    d'au moins un salarié déjà existant dans l'entreprise (heuristique simple, sans nouvelle table
--    de domaines autorisés). Corrige aussi le choix non déterministe de l'entreprise cible si
--    plusieurs lignes existaient dans companies.
create or replace function link_new_auth_user_to_employee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  linked_id text;
  target_company_id text;
  meta_nom text;
  meta_prenom text;
  new_domain text;
begin
  update employees
  set auth_user_id = new.id
  where lower(email) = lower(new.email) and auth_user_id is null
  returning id into linked_id;

  if linked_id is not null then
    return new;
  end if;

  meta_nom := coalesce(new.raw_user_meta_data->>'nom', '');
  meta_prenom := coalesce(new.raw_user_meta_data->>'prenom', '');
  new_domain := lower(split_part(new.email, '@', 2));

  select id into target_company_id from companies order by created_at asc limit 1;

  if target_company_id is not null and meta_nom <> '' and meta_prenom <> ''
     and exists (
       select 1 from employees e
       where e.company_id = target_company_id
         and lower(split_part(e.email, '@', 2)) = new_domain
     )
  then
    insert into employees (company_id, auth_user_id, email, role, nom, prenom)
    values (target_company_id, new.id, new.email, 'salarie', meta_nom, meta_prenom);
  end if;

  return new;
end;
$$;
