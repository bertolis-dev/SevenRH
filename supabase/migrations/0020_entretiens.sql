-- Seven RH — Module entretiens annuels (proposition issue de l'analyse concurrentielle du 14/08/2026 :
-- Nexus suivait déjà les DATES d'entretien professionnel/bilan (employees.date_dernier_entretien_
-- professionnel) mais pas le CONTENU — une simple alerte d'échéance, jamais un vrai formulaire.
--
-- Nouvelle entité au même niveau que leave_requests/expenses/support_tickets (même patron de table +
-- RLS), comme anticipé dans le commentaire "§14 : Modules futurs" de data.js. Workflow à 3 étapes,
-- volontairement PLUS SIMPLE que le moteur de validation congés/télétravail (advanceWorkflow) : ici
-- ce n'est pas une validation hiérarchique configurable mais une séquence fixe de remplissage
-- (salarié remplit son auto-évaluation, puis son manager ajoute son retour, puis RH clôture) — forcer
-- le moteur générique aurait ajouté de la complexité sans bénéfice réel pour ce cas.

create table entretiens (
  id text primary key default gen_random_uuid()::text,
  company_id text not null references companies(id) on delete cascade,
  employee_id text not null references employees(id) on delete cascade,
  type text not null default 'professionnel' check (type in ('professionnel', 'bilan')),
  date_prevue date not null,
  date_realisee date,
  statut text not null default 'a_planifier' check (statut in ('a_planifier', 'auto_evaluation_faite', 'cloture')),
  objectifs text,        -- fixés par RH/manager à la planification, visibles par le salarié
  auto_evaluation text,  -- rempli par le salarié
  retour_manager text,   -- rempli par le manager
  historique jsonb not null default '[]'::jsonb, -- [{date, action}], même forme que leave_requests.data.historique
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index entretiens_company_employee_idx on entretiens (company_id, employee_id);

alter table entretiens enable row level security;

-- select : le salarié concerné, son manager (is_manager_of), ou RH/Directeur (gererEntretiens) —
-- même triplet que leave_requests/expenses, l'entretien restant une donnée RH sensible non ouverte
-- à voirSalaries (contrairement aux congés, un entretien n'est pas "public" au sein de l'entreprise).
create policy entretiens_select on entretiens for select
  using (
    company_id = current_company_id()
    and (employee_id = current_employee_id() or is_manager_of(employee_id) or has_permission('gererEntretiens'))
  );

-- insert : seul RH/Directeur planifie un entretien (le salarié ne crée pas sa propre convocation).
create policy entretiens_insert on entretiens for insert
  with check (company_id = current_company_id() and has_permission('gererEntretiens'));

-- update : RLS autorise la ligne (salarié concerné / son manager / RH) ; c'est app.js qui restreint
-- QUELLE colonne chaque rôle peut effectivement remplir dans l'UI (auto_evaluation pour le salarié,
-- retour_manager pour le manager, tout pour RH) — même répartition RLS-ligne / UI-colonne que le
-- reste de l'app (voir append_ticket_comment pour un exemple de granularité plus fine si besoin un jour).
create policy entretiens_update on entretiens for update
  using (
    company_id = current_company_id()
    and (employee_id = current_employee_id() or is_manager_of(employee_id) or has_permission('gererEntretiens'))
  );
-- Pas de policy delete : un entretien clôturé reste dans l'historique du salarié, jamais supprimé.

-- Ajout de gererEntretiens à has_permission() (rh + directeur) — copie du corps de la fonction
-- (0002_rls_policies.sql, déjà réécrite par 0017/0018/0019) avec le nouveau droit inséré.
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
    when 'directeur' then '["voirPropreFiche","modifierPropresCoordonnees","voirSalaries","voirEquipe","creerSalarie","modifierSalarie","archiverSalarie","supprimerSalarie","voirInfosContractuelles","voirInfosFinancieres","voirCompteurs","modifierCompteurs","creerDemandeAbsence","validerAbsence","refuserAbsence","annulerAbsence","saisirMaladie","prolongerMaladie","voirCalendrierGeneral","voirCalendrierEquipe","creerNoteFrais","validerNoteFrais","controlerNoteFrais","marquerNoteRemboursee","calculerTicketsRestaurant","corrigerTicketsRestaurant","exporterPaie","gererParametres","gererUtilisateurs","gererPermissions","voirJournalAudit","gererAbonnements","gererTickets","gererEntretiens"]'::jsonb
    when 'rh' then '["voirPropreFiche","modifierPropresCoordonnees","voirCompteurs","creerDemandeAbsence","creerNoteFrais","voirCalendrierGeneral","voirSalaries","voirCalendrierEquipe","creerSalarie","modifierSalarie","archiverSalarie","voirInfosContractuelles","modifierCompteurs","validerAbsence","refuserAbsence","annulerAbsence","saisirMaladie","prolongerMaladie","validerNoteFrais","calculerTicketsRestaurant","corrigerTicketsRestaurant","exporterPaie","gererParametres","gererUtilisateurs","voirJournalAudit","gererTickets","gererEntretiens"]'::jsonb
    when 'comptabilite' then '["voirPropreFiche","modifierPropresCoordonnees","voirCompteurs","creerDemandeAbsence","creerNoteFrais","voirCalendrierGeneral","controlerNoteFrais","marquerNoteRemboursee","calculerTicketsRestaurant"]'::jsonb
    when 'manager' then '["voirPropreFiche","modifierPropresCoordonnees","voirCompteurs","creerDemandeAbsence","creerNoteFrais","voirCalendrierGeneral","voirEquipe","voirCalendrierEquipe","controlerNoteFrais"]'::jsonb
    else '["voirPropreFiche","modifierPropresCoordonnees","voirCompteurs","creerDemandeAbsence","creerNoteFrais","voirCalendrierGeneral"]'::jsonb
  end;

  return default_perms ? permission_key;
end;
$$;
