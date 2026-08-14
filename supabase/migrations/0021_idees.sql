-- Seven RH — Boîte à idées interne (proposition issue de l'analyse concurrentielle du 14/08/2026,
-- inspirée d'Eurécia). Contrairement aux entretiens (0020, donnée RH privée), une idée est un
-- contenu PARTAGÉ par toute l'entreprise dès sa création — le seul canal de communication ascendante
-- de Nexus aujourd'hui était un ticket support (privé, un seul destinataire RH). Select ouvert à
-- toute l'entreprise, comme un vrai tableau collectif.
--
-- Aucune policy UPDATE générique : contrairement aux entretiens (où RLS-ligne + UI-colonne suffit
-- car seuls 3 acteurs bien identifiés écrivent), une idée est modifiée par VOTE (potentiellement
-- tout le monde) ET par changement de statut (RH/Directeur seulement) — deux permissions très
-- différentes sur les MÊMES lignes. Plutôt qu'une policy update permissive (n'importe qui pourrait
-- alors changer le statut directement via un update brut, contournant gererIdees), les deux
-- mutations passent par des fonctions SQL dédiées (toggle_idee_vote / set_idee_statut), chacune
-- vérifiant elle-même ce qu'elle autorise — même esprit que update_ticket_statut (0018).

create table idees (
  id text primary key default gen_random_uuid()::text,
  company_id text not null references companies(id) on delete cascade,
  employee_id text not null references employees(id) on delete cascade, -- auteur
  titre text not null,
  description text,
  statut text not null default 'nouvelle' check (statut in ('nouvelle', 'etudiee', 'retenue', 'refusee')),
  votes jsonb not null default '[]'::jsonb, -- [employee_id, ...] — un vote par salarié, jamais de doublon (voir toggle_idee_vote)
  historique jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idees_company_idx on idees (company_id);

alter table idees enable row level security;

-- select : toute l'entreprise voit toutes les idées — c'est un tableau collectif, pas une donnée
-- personnelle (contrairement à entretiens_select, volontairement plus restrictif).
create policy idees_select on idees for select
  using (company_id = current_company_id());

-- insert : chacun propose sa propre idée (jamais au nom d'un autre salarié).
create policy idees_insert on idees for insert
  with check (company_id = current_company_id() and employee_id = current_employee_id());

-- Pas de policy update/delete : voir le commentaire en tête de fichier — tout passe par les deux
-- fonctions ci-dessous.

-- Vote/dévote atomique — jamais un lire-modifier-réécrire côté client (qui écraserait le vote d'un
-- autre salarié posé entre-temps). security definer + vérification interne du company_id (au lieu
-- de compter sur une policy RLS, puisqu'il n'y en a pas ici) pour empêcher de voter sur une idée
-- d'une autre entreprise en devinant son id.
create or replace function toggle_idee_vote(p_idee_id text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  emp_id text := current_employee_id();
  current_votes jsonb;
  new_votes jsonb;
begin
  if emp_id is null then raise exception 'Non authentifié'; end if;

  select votes into current_votes from idees where id = p_idee_id and company_id = current_company_id();
  if current_votes is null then raise exception 'Idée introuvable'; end if;

  if current_votes ? emp_id then
    select coalesce(jsonb_agg(v), '[]'::jsonb) into new_votes from jsonb_array_elements_text(current_votes) v where v != emp_id;
  else
    new_votes := current_votes || to_jsonb(emp_id);
  end if;

  update idees set votes = new_votes, updated_at = now() where id = p_idee_id;
  return new_votes;
end;
$$;

-- Changement de statut — réservé à gererIdees (RH/Directeur), vérifié À L'INTÉRIEUR de la fonction
-- puisqu'il n'y a pas de policy RLS pour appuyer cette restriction (voir commentaire en tête de
-- fichier). Même schéma que update_ticket_statut (0018_ticket_suivi_livraison.sql).
create or replace function set_idee_statut(p_idee_id text, p_statut text, p_auteur text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not has_permission('gererIdees') then raise exception 'Permission refusée'; end if;

  update idees
  set statut = p_statut,
      historique = historique || jsonb_build_array(jsonb_build_object('date', now(), 'action', 'Statut changé en « ' || p_statut || ' »', 'auteur', p_auteur)),
      updated_at = now()
  where id = p_idee_id and company_id = current_company_id();
end;
$$;

-- Ajout de gererIdees à has_permission() (rh + directeur) — copie du corps de la fonction, avec le
-- nouveau droit inséré (base : 0020_entretiens.sql, la version la plus récente).
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
    when 'directeur' then '["voirPropreFiche","modifierPropresCoordonnees","voirSalaries","voirEquipe","creerSalarie","modifierSalarie","archiverSalarie","supprimerSalarie","voirInfosContractuelles","voirInfosFinancieres","voirCompteurs","modifierCompteurs","creerDemandeAbsence","validerAbsence","refuserAbsence","annulerAbsence","saisirMaladie","prolongerMaladie","voirCalendrierGeneral","voirCalendrierEquipe","creerNoteFrais","validerNoteFrais","controlerNoteFrais","marquerNoteRemboursee","calculerTicketsRestaurant","corrigerTicketsRestaurant","exporterPaie","gererParametres","gererUtilisateurs","gererPermissions","voirJournalAudit","gererAbonnements","gererTickets","gererEntretiens","gererIdees"]'::jsonb
    when 'rh' then '["voirPropreFiche","modifierPropresCoordonnees","voirCompteurs","creerDemandeAbsence","creerNoteFrais","voirCalendrierGeneral","voirSalaries","voirCalendrierEquipe","creerSalarie","modifierSalarie","archiverSalarie","voirInfosContractuelles","modifierCompteurs","validerAbsence","refuserAbsence","annulerAbsence","saisirMaladie","prolongerMaladie","validerNoteFrais","calculerTicketsRestaurant","corrigerTicketsRestaurant","exporterPaie","gererParametres","gererUtilisateurs","voirJournalAudit","gererTickets","gererEntretiens","gererIdees"]'::jsonb
    when 'comptabilite' then '["voirPropreFiche","modifierPropresCoordonnees","voirCompteurs","creerDemandeAbsence","creerNoteFrais","voirCalendrierGeneral","controlerNoteFrais","marquerNoteRemboursee","calculerTicketsRestaurant"]'::jsonb
    when 'manager' then '["voirPropreFiche","modifierPropresCoordonnees","voirCompteurs","creerDemandeAbsence","creerNoteFrais","voirCalendrierGeneral","voirEquipe","voirCalendrierEquipe","controlerNoteFrais"]'::jsonb
    else '["voirPropreFiche","modifierPropresCoordonnees","voirCompteurs","creerDemandeAbsence","creerNoteFrais","voirCalendrierGeneral"]'::jsonb
  end;

  return default_perms ? permission_key;
end;
$$;
