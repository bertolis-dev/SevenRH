-- Seven RH — Phase 2 : policies RLS (isolation par entreprise + permissions + équipes)
--
-- Reconstruit côté serveur ce qui n'existait jusqu'ici QUE côté UI (app.js) :
--   - hasPermission()/DEFAULT_ROLE_PERMISSIONS (data.js:50-127)
--   - canActOnRequestFor/canManageRequestFor (app.js:3905-3937) : un manager n'agit que sur son
--     équipe ; RH/Directeur ont un accès "bypass" (company-wide), pas lié à une équipe précise ;
--     un salarié ne peut jamais valider/refuser/annuler sa propre demande (séparation des tâches).
--
-- ⚠️ IMPORTANT — ces fonctions dépendent de employees.auth_user_id, qui n'est rempli qu'à la
-- Phase 3 (authentification réelle). Tant que cette phase n'est pas faite, current_employee()
-- renvoie toujours NULL pour tout le monde → ces policies bloquent tout accès (comportement sûr
-- par défaut, mais impossible à vérifier complètement avant la Phase 3). NE PAS considérer cette
-- phase comme testée avant d'avoir de vrais utilisateurs Supabase Auth liés à des salariés.
--
-- Le catalogue de permissions par rôle est recopié depuis DEFAULT_ROLE_PERMISSIONS (data.js) —
-- c'est une SPEC transcrite en SQL, pas du code partagé : toute évolution des permissions dans
-- data.js doit être répercutée ici à la main (voir le risque documenté dans le plan de migration).

-- ---------------------------------------------------------------------------
-- Fonctions utilitaires (security definer : peuvent lire employees malgré le RLS de cette table)
-- ---------------------------------------------------------------------------

create or replace function current_employee_id()
returns text
language sql stable security definer set search_path = public
as $$
  select id from employees where auth_user_id = auth.uid() limit 1;
$$;

create or replace function current_company_id()
returns text
language sql stable security definer set search_path = public
as $$
  select company_id from employees where auth_user_id = auth.uid() limit 1;
$$;

create or replace function current_role_name()
returns text
language sql stable security definer set search_path = public
as $$
  select role from employees where auth_user_id = auth.uid() limit 1;
$$;

-- Reflète hasPermission() : une surcharge individuelle (permissions_overrides) prime toujours
-- sur le défaut du rôle.
create or replace function has_permission(permission_key text)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  emp employees%rowtype;
  default_perms jsonb;
begin
  select * into emp from employees where auth_user_id = auth.uid() limit 1;
  if emp.id is null then return false; end if;

  if emp.permissions_overrides ? permission_key then
    return (emp.permissions_overrides ->> permission_key)::boolean;
  end if;

  default_perms := case emp.role
    when 'directeur' then '["voirPropreFiche","modifierPropresCoordonnees","voirSalaries","voirEquipe","creerSalarie","modifierSalarie","archiverSalarie","supprimerSalarie","voirInfosContractuelles","voirInfosFinancieres","voirCompteurs","modifierCompteurs","creerDemandeAbsence","validerAbsence","refuserAbsence","annulerAbsence","saisirMaladie","prolongerMaladie","voirCalendrierGeneral","voirCalendrierEquipe","creerNoteFrais","validerNoteFrais","controlerNoteFrais","marquerNoteRemboursee","calculerTicketsRestaurant","corrigerTicketsRestaurant","exporterPaie","gererParametres","gererUtilisateurs","gererPermissions","voirJournalAudit","gererAbonnements"]'::jsonb
    when 'rh' then '["voirPropreFiche","modifierPropresCoordonnees","voirCompteurs","creerDemandeAbsence","creerNoteFrais","voirCalendrierGeneral","voirSalaries","voirCalendrierEquipe","creerSalarie","modifierSalarie","archiverSalarie","voirInfosContractuelles","modifierCompteurs","validerAbsence","refuserAbsence","annulerAbsence","saisirMaladie","prolongerMaladie","validerNoteFrais","calculerTicketsRestaurant","corrigerTicketsRestaurant","exporterPaie","gererParametres","gererUtilisateurs","voirJournalAudit"]'::jsonb
    when 'comptabilite' then '["voirPropreFiche","modifierPropresCoordonnees","voirCompteurs","creerDemandeAbsence","creerNoteFrais","voirCalendrierGeneral","controlerNoteFrais","marquerNoteRemboursee","calculerTicketsRestaurant"]'::jsonb
    when 'manager' then '["voirPropreFiche","modifierPropresCoordonnees","voirCompteurs","creerDemandeAbsence","creerNoteFrais","voirCalendrierGeneral","voirEquipe","voirCalendrierEquipe","controlerNoteFrais"]'::jsonb
    else '["voirPropreFiche","modifierPropresCoordonnees","voirCompteurs","creerDemandeAbsence","creerNoteFrais","voirCalendrierGeneral"]'::jsonb
  end;

  return default_perms ? permission_key;
end;
$$;

-- Reflète employee.managerIds : "suis-je manager de ce salarié ?"
create or replace function is_manager_of(target_employee_id text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from employees target
    where target.id = target_employee_id
      and current_employee_id() = any(target.manager_ids)
  );
$$;

-- ---------------------------------------------------------------------------
-- companies — un salarié ne voit/modifie que sa propre entreprise
-- ---------------------------------------------------------------------------
create policy companies_select on companies for select
  using (id = current_company_id());
create policy companies_update on companies for update
  using (id = current_company_id() and has_permission('gererParametres'));

-- ---------------------------------------------------------------------------
-- employees
-- ---------------------------------------------------------------------------
create policy employees_select on employees for select
  using (
    company_id = current_company_id()
    and (id = current_employee_id() or has_permission('voirSalaries') or is_manager_of(id))
  );
create policy employees_insert on employees for insert
  with check (company_id = current_company_id() and has_permission('creerSalarie'));
create policy employees_update on employees for update
  using (
    company_id = current_company_id()
    and (id = current_employee_id() or has_permission('modifierSalarie'))
  );
-- NOTE : RLS ne restreint pas au niveau colonne — un salarié qui modifie "sa" ligne pourrait en
-- théorie modifier n'importe quel champ (dont role/permissionsOverrides) via un appel API direct.
-- Aujourd'hui app.js n'expose que majPropresCoordonnees pour l'auto-modification, mais la policy
-- seule ne l'impose pas côté serveur — à durcir plus tard (ex. policy WITH CHECK comparant les
-- colonnes sensibles à leur valeur précédente, ou passer par une fonction dédiée plutôt qu'un
-- UPDATE direct pour l'auto-modification).
create policy employees_delete on employees for delete
  using (company_id = current_company_id() and has_permission('supprimerSalarie'));

-- ---------------------------------------------------------------------------
-- etablissements / services / leave_types / school_holidays / settings
-- Lecture large (toute l'entreprise), écriture réservée à gererParametres.
-- ---------------------------------------------------------------------------
create policy etablissements_select on etablissements for select
  using (company_id = current_company_id());
create policy etablissements_write on etablissements for all
  using (company_id = current_company_id() and has_permission('gererParametres'))
  with check (company_id = current_company_id() and has_permission('gererParametres'));

create policy services_select on services for select
  using (company_id = current_company_id());
create policy services_write on services for all
  using (company_id = current_company_id() and has_permission('gererParametres'))
  with check (company_id = current_company_id() and has_permission('gererParametres'));

create policy leave_types_select on leave_types for select
  using (company_id = current_company_id());
create policy leave_types_write on leave_types for all
  using (company_id = current_company_id() and has_permission('gererParametres'))
  with check (company_id = current_company_id() and has_permission('gererParametres'));

create policy school_holidays_select on school_holidays for select
  using (company_id = current_company_id());
create policy school_holidays_write on school_holidays for all
  using (company_id = current_company_id() and has_permission('gererParametres'))
  with check (company_id = current_company_id() and has_permission('gererParametres'));

create policy settings_select on settings for select
  using (company_id = current_company_id());
create policy settings_write on settings for all
  using (company_id = current_company_id() and has_permission('gererParametres'))
  with check (company_id = current_company_id() and has_permission('gererParametres'));

-- ---------------------------------------------------------------------------
-- leave_requests / telework_requests — mêmes règles pour les deux
--   select : le salarié voit les siennes ; un manager voit celles de son équipe ; RH/Directeur voient tout.
--   insert : uniquement pour soi-même.
--   update (validation/refus/annulation) : manager sur son équipe (jamais sur sa propre demande —
--     séparation des tâches, cf. canActOnRequestFor) OU RH/Directeur en bypass company-wide.
-- ---------------------------------------------------------------------------
create policy leave_requests_select on leave_requests for select
  using (
    company_id = current_company_id()
    and (employee_id = current_employee_id() or has_permission('voirSalaries') or is_manager_of(employee_id))
  );
create policy leave_requests_insert on leave_requests for insert
  with check (company_id = current_company_id() and employee_id = current_employee_id() and has_permission('creerDemandeAbsence'));
create policy leave_requests_update on leave_requests for update
  using (
    company_id = current_company_id()
    and employee_id != current_employee_id()
    and (
      is_manager_of(employee_id)
      or has_permission('validerAbsence') or has_permission('refuserAbsence') or has_permission('annulerAbsence')
    )
  );

create policy telework_requests_select on telework_requests for select
  using (
    company_id = current_company_id()
    and (employee_id = current_employee_id() or has_permission('voirSalaries') or is_manager_of(employee_id))
  );
create policy telework_requests_insert on telework_requests for insert
  with check (company_id = current_company_id() and employee_id = current_employee_id() and has_permission('creerDemandeAbsence'));
create policy telework_requests_update on telework_requests for update
  using (
    company_id = current_company_id()
    and employee_id != current_employee_id()
    and (
      is_manager_of(employee_id)
      or has_permission('validerAbsence') or has_permission('refuserAbsence') or has_permission('annulerAbsence')
    )
  );

-- ---------------------------------------------------------------------------
-- expenses — validation à 2 niveaux (manager "contrôle", comptabilité/RH "rembourse")
-- ---------------------------------------------------------------------------
create policy expenses_select on expenses for select
  using (
    company_id = current_company_id()
    and (employee_id = current_employee_id() or has_permission('voirSalaries') or is_manager_of(employee_id))
  );
create policy expenses_insert on expenses for insert
  with check (company_id = current_company_id() and employee_id = current_employee_id() and has_permission('creerNoteFrais'));
create policy expenses_update on expenses for update
  using (
    company_id = current_company_id()
    and employee_id != current_employee_id()
    and (
      is_manager_of(employee_id) and has_permission('controlerNoteFrais')
      or has_permission('validerNoteFrais') or has_permission('marquerNoteRemboursee')
    )
  );

-- ---------------------------------------------------------------------------
-- documents — coffre-fort RH : le salarié voit les siens, RH/Directeur voient tout
-- ---------------------------------------------------------------------------
create policy documents_select on documents for select
  using (
    company_id = current_company_id()
    and (employee_id = current_employee_id() or has_permission('voirSalaries'))
  );
create policy documents_write on documents for all
  using (company_id = current_company_id() and has_permission('gererUtilisateurs'))
  with check (company_id = current_company_id() and has_permission('gererUtilisateurs'));

-- ---------------------------------------------------------------------------
-- drafts / favorites — strictement personnels, jamais partagés entre salariés
-- ---------------------------------------------------------------------------
create policy drafts_all on drafts for all
  using (company_id = current_company_id() and owner_id = current_employee_id())
  with check (company_id = current_company_id() and owner_id = current_employee_id());

create policy favorites_all on favorites for all
  using (company_id = current_company_id() and user_id = current_employee_id())
  with check (company_id = current_company_id() and user_id = current_employee_id());

-- ---------------------------------------------------------------------------
-- notifications — ciblage stocké dans data->>'cible' (voir addNotificationsIfNew) ;
-- lecture large ici, le filtrage précis par destinataire reste géré côté application
-- (comme aujourd'hui avec luPar/archivePar), à durcir si besoin dans une phase ultérieure.
-- ---------------------------------------------------------------------------
create policy notifications_select on notifications for select
  using (company_id = current_company_id());
create policy notifications_write on notifications for all
  using (company_id = current_company_id())
  with check (company_id = current_company_id());

-- ---------------------------------------------------------------------------
-- audit_log — lecture réservée à voirJournalAudit ; écriture par tout salarié connecté de
-- l'entreprise (toute action journalisée doit pouvoir écrire, quel que soit son rôle).
-- ---------------------------------------------------------------------------
create policy audit_log_select on audit_log for select
  using (company_id = current_company_id() and has_permission('voirJournalAudit'));
create policy audit_log_insert on audit_log for insert
  with check (company_id = current_company_id());
