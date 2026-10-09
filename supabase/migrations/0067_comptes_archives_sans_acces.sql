-- Seven RH — audit de sécurité du 09/10/2026 : un salarié archivé (parti de l'entreprise) gardait ses
-- accès. current_employee_id(), current_company_id(), current_role_name() et has_permission() ne
-- regardaient jamais la colonne archive : un manager ou un RH archivé après son départ conservait
-- son compte de connexion ET tous ses droits RLS (lecture des salariés, validation de demandes...).
--
-- Ces quatre fonctions sont le point d'entrée de quasiment toutes les policies : les faire ignorer
-- les comptes archivés suffit à tout couper d'un coup (une policy qui compare company_id à
-- current_company_id() reçoit NULL, donc refuse). Réactiver le salarié (archive = false) rétablit
-- l'accès tel quel. A la connexion, le site affiche déjà « Aucun salarié associé à ce compte ».

begin;

create or replace function current_employee_id()
returns text
language sql stable security definer set search_path = public
as $$
  select id from employees where auth_user_id = auth.uid() and not archive limit 1;
$$;

create or replace function current_company_id()
returns text
language sql stable security definer set search_path = public
as $$
  select company_id from employees where auth_user_id = auth.uid() and not archive limit 1;
$$;

create or replace function current_role_name()
returns text
language sql stable security definer set search_path = public
as $$
  select role from employees where auth_user_id = auth.uid() and not archive limit 1;
$$;

create or replace function has_permission(permission_key text)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  emp employees%rowtype;
  default_perms jsonb;
begin
  select * into emp from employees where auth_user_id = auth.uid() and not archive limit 1;
  if emp.id is null then return false; end if;

  if emp.permissions_overrides ? permission_key then
    return (emp.permissions_overrides ->> permission_key)::boolean;
  end if;

  default_perms := case emp.role
    when 'proprietaire' then '["voirPropreFiche","modifierPropresCoordonnees","voirSalaries","voirEquipe","creerSalarie","modifierSalarie","archiverSalarie","supprimerSalarie","voirInfosContractuelles","voirInfosFinancieres","voirCompteurs","modifierCompteurs","creerDemandeAbsence","validerAbsence","refuserAbsence","annulerAbsence","saisirMaladie","prolongerMaladie","voirCalendrierGeneral","voirCalendrierEquipe","creerNoteFrais","validerNoteFrais","controlerNoteFrais","marquerNoteRemboursee","calculerTicketsRestaurant","corrigerTicketsRestaurant","exporterPaie","gererParametres","gererUtilisateurs","gererPermissions","voirJournalAudit","gererAbonnements","gererTickets","gererEntretiens","gererIdees"]'::jsonb
    when 'rh' then '["voirPropreFiche","modifierPropresCoordonnees","voirCompteurs","creerDemandeAbsence","creerNoteFrais","voirCalendrierGeneral","voirSalaries","voirCalendrierEquipe","creerSalarie","modifierSalarie","archiverSalarie","voirInfosContractuelles","modifierCompteurs","validerAbsence","refuserAbsence","annulerAbsence","saisirMaladie","prolongerMaladie","validerNoteFrais","calculerTicketsRestaurant","corrigerTicketsRestaurant","exporterPaie","gererParametres","gererUtilisateurs","voirJournalAudit","gererTickets","gererEntretiens","gererIdees"]'::jsonb
    when 'comptabilite' then '["voirPropreFiche","modifierPropresCoordonnees","voirCompteurs","creerDemandeAbsence","creerNoteFrais","voirCalendrierGeneral","controlerNoteFrais","marquerNoteRemboursee","calculerTicketsRestaurant"]'::jsonb
    when 'manager' then '["voirPropreFiche","modifierPropresCoordonnees","voirCompteurs","creerDemandeAbsence","creerNoteFrais","voirCalendrierGeneral","voirEquipe","voirCalendrierEquipe","controlerNoteFrais"]'::jsonb
    else '["voirPropreFiche","modifierPropresCoordonnees","voirCompteurs","creerDemandeAbsence","creerNoteFrais","voirCalendrierGeneral"]'::jsonb
  end;

  return default_perms ? permission_key;
end;
$$;

-- ---------------------------------------------------------------------------
-- Suppression des CV/lettres du stockage (audit du 09/10/2026) : le bucket candidatures-files n'avait
-- qu'une policy SELECT (0026), donc le remove() fait après delete_candidature (0063) ne supprimait
-- RIEN, sans erreur — un effacement RGPD laissait les fichiers. Même périmètre que la lecture : le
-- dossier de SON entreprise, et le droit qui permet déjà de supprimer la candidature.
-- ---------------------------------------------------------------------------
drop policy if exists candidatures_files_delete on storage.objects;
create policy candidatures_files_delete on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'candidatures-files'
    and name like current_company_id() || '/%'
    and has_permission('creerSalarie')
  );

insert into schema_migrations (version) values ('0067_comptes_archives_sans_acces') on conflict do nothing;

commit;
