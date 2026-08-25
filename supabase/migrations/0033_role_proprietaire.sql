-- Seven RH — remplace le rôle "directeur" par un rôle "proprietaire" (audit du 23/08/2026, §5).
--
-- Contexte : "directeur" cumulait trois choses sans rapport entre elles — toutes les permissions
-- sans exception, la gestion de l'abonnement/facturation, et une dérogation pour valider ses
-- propres congés. Dans beaucoup d'entreprises il existe plusieurs "directeurs" (communication,
-- commercial...) qui n'ont pourtant aucune raison de porter ce rôle. "Propriétaire" (unique par
-- entreprise, transférable) décrit ce que ce rôle EST réellement, sans décorer un rôle "Directeur"
-- vide de permissions propres à la place (explicitement écarté par le client).
--
-- ⚠️ AVANT D'EXÉCUTER : cette migration modifie le modèle d'autorisation de TOUTES les entreprises
-- existantes. Vérifiez d'abord qu'aucune entreprise n'a un nombre de "directeur" actifs différent
-- de 1 (l'invariant que role_change_guard, 0011, est censé garantir depuis toujours — cette requête
-- ne devrait renvoyer AUCUNE ligne) :
--
--   select company_id, count(*) from employees
--   where role = 'directeur' and not archive
--   group by company_id having count(*) <> 1;
--
-- Si cette requête renvoie une ligne, NE LANCEZ PAS cette migration — dites-le-moi, il faut
-- d'abord comprendre pourquoi avant de créer la contrainte d'unicité plus bas (elle échouerait,
-- ce qui est le comportement voulu — mais mieux vaut le savoir avant qu'au milieu d'une migration).
--
-- BEGIN/COMMIT explicites (au lieu de compter sur le comportement par défaut du SQL Editor) : tout
-- ce fichier doit s'appliquer en un seul bloc, ou pas du tout — jamais un état intermédiaire où,
-- par exemple, les données seraient migrées vers 'proprietaire' mais has_permission() vérifierait
-- encore 'directeur'. Aucune instruction ci-dessous n'est incompatible avec une transaction
-- (pas de CREATE INDEX CONCURRENTLY).

begin;

-- ---------------------------------------------------------------------------
-- 0. §correctif après premier essai en base (erreur : "Non autorisé à changer le rôle d'un
--    salarié", levée par guard_employee_role_change ligne 11) : ce trigger (0011) est TOUJOURS EN
--    VIGUEUR à ce stade tant qu'on ne l'a pas réécrit — sa réécriture doit donc précéder l'UPDATE
--    de masse de l'étape 1, pas la suivre comme dans la version précédente de ce fichier — il
--    exige has_permission('gererUtilisateurs'), qui vaut toujours faux ici : le SQL Editor
--    n'a aucune session authentifiée (auth.uid() est NULL), donc aucun salarié "appelant" trouvé.
--    Deux corrections, dans cet ordre précis :
--      (a) réécrire le trigger MAINTENANT, avant toute mise à jour de rôle, pour qu'il connaisse
--          déjà le contournement transactionnel app.role_transfer_in_progress ;
--      (b) activer ce contournement pour TOUTE la transaction (set_config(..., is_local=true))
--          avant la première mise à jour de rôle — jamais une valeur globale/persistante, elle
--          retombe seule à la fin de cette transaction (COMMIT ou ROLLBACK).
-- ---------------------------------------------------------------------------
create or replace function guard_employee_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  acting_role text := current_role_name();
  nb_proprietaires int;
  transfer_bypass boolean := coalesce(current_setting('app.role_transfer_in_progress', true), '') = 'true';
begin
  if NEW.role is distinct from OLD.role and not transfer_bypass then
    if NEW.id = current_employee_id() then
      raise exception 'Impossible de changer son propre rôle.';
    end if;
    if not has_permission('gererUtilisateurs') then
      raise exception 'Non autorisé à changer le rôle d''un salarié.';
    end if;
    -- Seul le Propriétaire peut attribuer OU retirer le rôle Propriétaire — sinon un RH avec
    -- gererUtilisateurs (accordé par défaut) pourrait s'attribuer le statut ou en démettre le titulaire.
    if (NEW.role = 'proprietaire' or OLD.role = 'proprietaire') and acting_role is distinct from 'proprietaire' then
      raise exception 'Seul le Propriétaire peut attribuer ou retirer ce statut.';
    end if;
    -- Jamais retirer le dernier Propriétaire de l'entreprise (hors transfert explicite ci-dessus,
    -- qui repasse par transfer_proprietaire() et bascule les deux rôles dans le même ordre sûr).
    if OLD.role = 'proprietaire' and NEW.role is distinct from 'proprietaire' then
      select count(*) into nb_proprietaires from employees
        where company_id = OLD.company_id and role = 'proprietaire' and not archive;
      if nb_proprietaires <= 1 then
        raise exception 'Impossible : ce salarié est le Propriétaire de l''entreprise — utilisez le transfert de propriété.';
      end if;
    end if;
  end if;

  if NEW.permissions_overrides is distinct from OLD.permissions_overrides and not has_permission('gererUtilisateurs') then
    raise exception 'Non autorisé à modifier les permissions individuelles d''un salarié.';
  end if;

  return NEW;
end;
$$;

select set_config('app.role_transfer_in_progress', 'true', true);

-- ---------------------------------------------------------------------------
-- 1. Contrainte de colonne : élargit l'énumération, migre les données, retire l'ancienne valeur.
-- ---------------------------------------------------------------------------
alter table employees drop constraint if exists employees_role_check;
alter table employees add constraint employees_role_check
  check (role in ('salarie','manager','rh','comptabilite','directeur','proprietaire'));
-- (valeur 'directeur' temporairement acceptée en plus, pour que l'UPDATE ci-dessous puisse
-- s'exécuter sans jamais avoir de ligne qui viole la contrainte entre les deux étapes)

update employees set role = 'proprietaire' where role = 'directeur';

alter table employees drop constraint employees_role_check;
alter table employees add constraint employees_role_check
  check (role in ('salarie','manager','rh','comptabilite','proprietaire'));

-- ---------------------------------------------------------------------------
-- 2. Un seul Propriétaire actif par entreprise — garanti par la base, pas seulement par l'UI ou le
--    trigger ci-dessous (qui reste une défense en profondeur, pas la seule barrière).
-- ---------------------------------------------------------------------------
create unique index if not exists employees_one_proprietaire_per_company
  on employees (company_id) where role = 'proprietaire' and not archive;

-- ---------------------------------------------------------------------------
-- 3. has_permission() — reprend la dernière définition (0021_idees.sql), 'directeur' -> 'proprietaire'.
-- ---------------------------------------------------------------------------
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
-- 4. Transfert de propriété — seul le Propriétaire actuel peut l'appeler, vers un salarié actif de
--    SON entreprise ayant déjà un compte de connexion réel. Bascule l'ancien Propriétaire vers un
--    rôle choisi par lui au moment du transfert (jamais un "Directeur" décoratif implicite).
--    Ordre des deux UPDATE délibéré : rétrograde l'ancien Propriétaire AVANT de promouvoir le
--    nouveau, pour ne jamais avoir deux lignes "proprietaire" simultanées (l'index unique du §2 le
--    refuserait sinon, même transitoirement dans la même transaction).
-- ---------------------------------------------------------------------------
create or replace function transfer_proprietaire(new_proprietaire_id text, role_ancien_proprietaire text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id text := current_employee_id();
  caller_company_id text := current_company_id();
  target employees%rowtype;
begin
  if caller_id is null then
    raise exception 'Non authentifié.';
  end if;
  if current_role_name() is distinct from 'proprietaire' then
    raise exception 'Seul le Propriétaire actuel peut transférer son statut.';
  end if;
  if role_ancien_proprietaire not in ('rh','manager','comptabilite','salarie') then
    raise exception 'Rôle de repli invalide.';
  end if;

  select * into target from employees where id = new_proprietaire_id and company_id = caller_company_id and not archive;
  if target.id is null then
    raise exception 'Salarié introuvable dans votre entreprise.';
  end if;
  if target.id = caller_id then
    raise exception 'Vous êtes déjà Propriétaire.';
  end if;
  if target.auth_user_id is null then
    raise exception 'Ce salarié doit avoir un compte de connexion actif avant de pouvoir devenir Propriétaire.';
  end if;

  perform set_config('app.role_transfer_in_progress', 'true', true);
  update employees set role = role_ancien_proprietaire where id = caller_id;
  update employees set role = 'proprietaire' where id = new_proprietaire_id;

  insert into audit_log (company_id, action, entite, cible, details)
    values (caller_company_id, 'Modification', 'Propriétaire', target.prenom || ' ' || target.nom,
      'Transfert de propriété (ancien Propriétaire repassé à : ' || role_ancien_proprietaire || ')');
end;
$$;

revoke all on function transfer_proprietaire(text, text) from public;
grant execute on function transfer_proprietaire(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Congés/télétravail — dérogation de self-service (0019), 'directeur' -> 'proprietaire'.
-- ---------------------------------------------------------------------------
drop policy if exists leave_requests_update on leave_requests;
create policy leave_requests_update on leave_requests for update
  using (
    company_id = current_company_id()
    and (employee_id != current_employee_id() or current_role_name() = 'proprietaire')
    and (
      is_manager_of(employee_id)
      or has_permission('validerAbsence') or has_permission('refuserAbsence') or has_permission('annulerAbsence')
    )
  );

drop policy if exists telework_requests_update on telework_requests;
create policy telework_requests_update on telework_requests for update
  using (
    company_id = current_company_id()
    and (employee_id != current_employee_id() or current_role_name() = 'proprietaire')
    and (
      is_manager_of(employee_id)
      or has_permission('validerAbsence') or has_permission('refuserAbsence') or has_permission('annulerAbsence')
    )
  );

-- ---------------------------------------------------------------------------
-- 6. Inscription libre-service (0012) — la toute première fiche d'une nouvelle entreprise est
--    désormais créée directement en 'proprietaire', jamais en 'directeur'.
-- ---------------------------------------------------------------------------
create or replace function create_company_self_service()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  caller_email text;
  meta_raison_sociale text;
  meta_nom text;
  meta_prenom text;
  new_company_id text;
  new_etab_id text;
begin
  if caller_id is null then
    raise exception 'Non authentifié.';
  end if;

  if exists (select 1 from employees where auth_user_id = caller_id) then
    raise exception 'Ce compte est déjà associé à une entreprise.';
  end if;

  select email, raw_user_meta_data->>'raisonSociale', raw_user_meta_data->>'nom', raw_user_meta_data->>'prenom'
    into caller_email, meta_raison_sociale, meta_nom, meta_prenom
    from auth.users where id = caller_id;

  if coalesce(meta_raison_sociale, '') = '' or coalesce(meta_nom, '') = '' or coalesce(meta_prenom, '') = '' then
    raise exception 'Informations manquantes pour créer l''entreprise.';
  end if;

  insert into companies (raison_sociale, data)
    values (meta_raison_sociale, jsonb_build_object('matriculeSeq', 1))
    returning id into new_company_id;

  insert into etablissements (company_id, nom, principal, actif)
    values (new_company_id, 'Siège', true, true)
    returning id into new_etab_id;

  insert into employees (company_id, auth_user_id, email, role, nom, prenom, etablissement_id, matricule)
    values (new_company_id, caller_id, caller_email, 'proprietaire', meta_nom, meta_prenom, new_etab_id, 'SRH-0001');

  insert into subscriptions (company_id, offre, statut, nombre_salaries_max)
    values (new_company_id, 'essai', 'non_souscrit', 1);

  return new_company_id;
end;
$$;

revoke all on function create_company_self_service() from public;

-- ---------------------------------------------------------------------------
-- 7. Seven Sept — désigne explicitement Betty Aubert comme Propriétaire (demande du 23/08/2026).
--    Écrit pour être rejouable sans risque : ne fait rien si elle l'est déjà, échoue avec un message
--    clair si son compte n'existe pas encore sous cet email exact — à corriger à la main plutôt que
--    de deviner un autre compte.
-- ---------------------------------------------------------------------------
do $$
declare
  betty_id text;
  betty_company_id text;
  current_owner_id text;
begin
  select id, company_id into betty_id, betty_company_id
    from employees where lower(email) = lower('baubert@sevensept.com') and not archive limit 1;

  if betty_id is null then
    raise notice 'Betty Aubert introuvable (email baubert@sevensept.com) — étape 8 ignorée, à faire à la main.';
  else
    select id into current_owner_id from employees
      where company_id = betty_company_id and role = 'proprietaire' and not archive limit 1;

    if current_owner_id = betty_id then
      raise notice 'Betty Aubert est déjà Propriétaire de son entreprise — rien à faire.';
    elsif current_owner_id is not null then
      perform set_config('app.role_transfer_in_progress', 'true', true);
      update employees set role = 'rh' where id = current_owner_id;
      update employees set role = 'proprietaire' where id = betty_id;
      raise notice 'Propriété transférée à Betty Aubert (ancien Propriétaire repassé RH).';
    else
      update employees set role = 'proprietaire' where id = betty_id;
      raise notice 'Betty Aubert nommée Propriétaire (aucun Propriétaire existant trouvé).';
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Migration de données : les chaînes de validation ("workflow") sont des tableaux jsonb de
--    noms de rôle stockés en TEXTE LIBRE dans data.workflow (leave_types/leave_requests/
--    telework_requests/expenses) et dans settings.data (workflowFrais/workflowTeletravail/
--    workflowCongesDefault) — indépendants de la contrainte de colonne employees.role migrée au
--    §1. Sans ce correctif, une chaîne déjà enregistrée avec 'directeur' ne correspondrait plus à
--    aucun salarié réel après le §1 (silencieusement — aucune erreur, juste une étape de validation
--    que personne ne peut plus jamais franchir).
-- ---------------------------------------------------------------------------
create or replace function _tmp_workflow_array_directeur_to_proprietaire(arr jsonb)
returns jsonb language sql immutable as $$
  select case
    when arr is null or jsonb_typeof(arr) is distinct from 'array' then arr
    else (select jsonb_agg(case when e = 'directeur' then 'proprietaire' else e end)
          from jsonb_array_elements_text(arr) e)
  end;
$$;

update leave_types set data = jsonb_set(data, '{workflow}', _tmp_workflow_array_directeur_to_proprietaire(data->'workflow'))
  where data->'workflow' @> '["directeur"]'::jsonb;

update leave_requests set data = jsonb_set(data, '{workflow}', _tmp_workflow_array_directeur_to_proprietaire(data->'workflow'))
  where data->'workflow' @> '["directeur"]'::jsonb;

update telework_requests set data = jsonb_set(data, '{workflow}', _tmp_workflow_array_directeur_to_proprietaire(data->'workflow'))
  where data->'workflow' @> '["directeur"]'::jsonb;

update expenses set data = jsonb_set(data, '{workflow}', _tmp_workflow_array_directeur_to_proprietaire(data->'workflow'))
  where data->'workflow' @> '["directeur"]'::jsonb;

update settings set data = jsonb_set(
    jsonb_set(
      jsonb_set(data, '{workflowFrais}', _tmp_workflow_array_directeur_to_proprietaire(data->'workflowFrais')),
      '{workflowTeletravail}', _tmp_workflow_array_directeur_to_proprietaire(data->'workflowTeletravail')
    ),
    '{workflowCongesDefault}', _tmp_workflow_array_directeur_to_proprietaire(data->'workflowCongesDefault')
  )
  where data->'workflowFrais' @> '["directeur"]'::jsonb
     or data->'workflowTeletravail' @> '["directeur"]'::jsonb
     or data->'workflowCongesDefault' @> '["directeur"]'::jsonb;

drop function _tmp_workflow_array_directeur_to_proprietaire(jsonb);

commit;
