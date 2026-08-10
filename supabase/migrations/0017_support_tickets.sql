-- Seven RH — Phase 2 du sprint amélioration RH : système de tickets support envoyés à BERTOLIS.
-- Contrairement aux autres nouveautés du sprint (catégories de salariés, fermetures), les tickets
-- doivent être lisibles PAR BERTOLIS À TRAVERS TOUTES LES ENTREPRISES CLIENTES — un blob `settings`
-- (scopé à une seule entreprise) ne s'y prête pas ; on utilise donc une vraie table, même patron que
-- leave_requests/expenses/documents (0001_init_schema.sql).
--
-- IMPORTANT — la console BERTOLIS garde volontairement son login local actuel (mot de passe en
-- clair côté client, voir data.js) plutôt qu'un vrai compte Supabase Auth (choix explicite de
-- l'éditeur pour cette itération). Elle ne peut donc pas passer par les policies RLS ci-dessous
-- (qui exigent un vrai auth.uid()) pour son accès cross-entreprises : cet accès passe par l'Edge
-- Function bertolis-tickets, gardée par un secret partagé et un client service-role qui bypass RLS.
-- Ces policies RLS ne couvrent donc que l'accès normal d'un salarié authentifié à SA entreprise.

create table support_tickets (
  id text primary key default gen_random_uuid()::text,
  company_id text not null references companies(id) on delete cascade,
  employee_id text not null references employees(id) on delete cascade,
  route text,
  titre text not null,
  description text,
  categorie text,
  priorite text not null default 'normale' check (priorite in ('basse', 'normale', 'haute')),
  statut text not null default 'ouvert' check (statut in ('ouvert', 'en_cours', 'resolu', 'ferme')),
  data jsonb not null default '{}'::jsonb, -- contexte structuré, pieceJointe {nom,dataUrl}, comments [{auteur,texte,date}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index support_tickets_company_employee_idx on support_tickets (company_id, employee_id);
-- Sert la requête `list` de la Edge Function BERTOLIS, qui scanne toutes les entreprises sans
-- filtre company_id — un index séparé du composite ci-dessus, qui ne l'aiderait pas.
create index support_tickets_statut_created_idx on support_tickets (statut, created_at desc);

alter table support_tickets enable row level security;

create policy support_tickets_select on support_tickets for select
  using (
    company_id = current_company_id()
    and (employee_id = current_employee_id() or has_permission('gererTickets'))
  );
create policy support_tickets_insert on support_tickets for insert
  with check (company_id = current_company_id() and employee_id = current_employee_id());
create policy support_tickets_update on support_tickets for update
  using (
    company_id = current_company_id()
    and (employee_id = current_employee_id() or has_permission('gererTickets'))
  );
-- Pas de policy delete : un ticket n'est jamais supprimé, seulement fermé (comme leave_requests).

-- Ajout du droit gererTickets à has_permission() — copie du corps de la fonction (0002_rls_policies.sql)
-- avec le nouveau droit inséré pour rh/directeur, comme voirJournalAudit. Toute évolution future du
-- catalogue de permissions dans data.js doit être répercutée ici à la main (limitation déjà documentée
-- dans 0002_rls_policies.sql).
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
    when 'directeur' then '["voirPropreFiche","modifierPropresCoordonnees","voirSalaries","voirEquipe","creerSalarie","modifierSalarie","archiverSalarie","supprimerSalarie","voirInfosContractuelles","voirInfosFinancieres","voirCompteurs","modifierCompteurs","creerDemandeAbsence","validerAbsence","refuserAbsence","annulerAbsence","saisirMaladie","prolongerMaladie","voirCalendrierGeneral","voirCalendrierEquipe","creerNoteFrais","validerNoteFrais","controlerNoteFrais","marquerNoteRemboursee","calculerTicketsRestaurant","corrigerTicketsRestaurant","exporterPaie","gererParametres","gererUtilisateurs","gererPermissions","voirJournalAudit","gererAbonnements","gererTickets"]'::jsonb
    when 'rh' then '["voirPropreFiche","modifierPropresCoordonnees","voirCompteurs","creerDemandeAbsence","creerNoteFrais","voirCalendrierGeneral","voirSalaries","voirCalendrierEquipe","creerSalarie","modifierSalarie","archiverSalarie","voirInfosContractuelles","modifierCompteurs","validerAbsence","refuserAbsence","annulerAbsence","saisirMaladie","prolongerMaladie","validerNoteFrais","calculerTicketsRestaurant","corrigerTicketsRestaurant","exporterPaie","gererParametres","gererUtilisateurs","voirJournalAudit","gererTickets"]'::jsonb
    when 'comptabilite' then '["voirPropreFiche","modifierPropresCoordonnees","voirCompteurs","creerDemandeAbsence","creerNoteFrais","voirCalendrierGeneral","controlerNoteFrais","marquerNoteRemboursee","calculerTicketsRestaurant"]'::jsonb
    when 'manager' then '["voirPropreFiche","modifierPropresCoordonnees","voirCompteurs","creerDemandeAbsence","creerNoteFrais","voirCalendrierGeneral","voirEquipe","voirCalendrierEquipe","controlerNoteFrais"]'::jsonb
    else '["voirPropreFiche","modifierPropresCoordonnees","voirCompteurs","creerDemandeAbsence","creerNoteFrais","voirCalendrierGeneral"]'::jsonb
  end;

  return default_perms ? permission_key;
end;
$$;

-- Append atomique d'un commentaire — un fil de support est un échange rapide à deux parties
-- (salarié ↔ BERTOLIS), le cas le plus défavorable pour un "lire-modifier-réécrire toute la ligne"
-- (contrairement à leave_requests.data.historique, écrit typiquement par une seule partie à la
-- fois). `security invoker` (par défaut) : appelée par un salarié authentifié, l'update interne
-- reste soumis à la policy support_tickets_update ci-dessus ; appelée par la Edge Function via un
-- client service-role, RLS est bypassée (le secret de la fonction fait alors office de garde-fou).
create or replace function append_ticket_comment(p_ticket_id text, p_auteur text, p_texte text)
returns void
language sql
as $$
  update support_tickets
  set data = jsonb_set(
        data,
        '{comments}',
        coalesce(data->'comments', '[]'::jsonb) || jsonb_build_array(
          jsonb_build_object('auteur', p_auteur, 'texte', p_texte, 'date', now())
        )
      ),
      updated_at = now()
  where id = p_ticket_id;
$$;
