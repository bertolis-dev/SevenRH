-- Seven RH — Phase 1 : schéma initial (migration Supabase)
-- Une table par groupe d'entité de data.js (makeEmptyXxx), chacune scopée par company_id.
-- Les champs peu structurés/jamais interrogés seuls (adresse, historique, contrat détaillé...)
-- restent en colonne jsonb `data`, pour ne pas exploser certaines tables en 150 colonnes.
--
-- IMPORTANT — sécurité : RLS (Row Level Security) est activé sur chaque table dès cette phase,
-- SANS AUCUNE POLICY. Résultat : personne (y compris avec la clé anon) ne peut rien lire/écrire
-- via l'API tant que la Phase 2 (policies RLS) n'a pas été faite. C'est un état volontairement
-- "tout fermé" plutôt que "tout ouvert" par défaut.

create extension if not exists pgcrypto;

create table companies (
  id uuid primary key default gen_random_uuid(),
  raison_sociale text not null,
  data jsonb not null default '{}'::jsonb, -- logo, siret, tva, adresse, telephone, email, conventionCollective, matriculeSeq, abonnement
  created_at timestamptz not null default now()
);

create table employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  auth_user_id uuid references auth.users(id), -- rempli en Phase 3 (authentification réelle)
  email text not null,
  role text not null check (role in ('salarie','manager','rh','comptabilite','directeur')),
  matricule text,
  nom text not null,
  prenom text not null,
  manager_ids uuid[] not null default '{}',
  etablissement_id uuid,
  service text,
  equipe text,
  archive boolean not null default false,
  permissions_overrides jsonb not null default '{}'::jsonb,
  data jsonb not null default '{}'::jsonb, -- adresse, contrat, horaires, compteurs, ticketsAjustements, variablesPaie, typesAbsenceDesactives...
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, email)
);

create table etablissements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  nom text not null,
  principal boolean not null default false,
  actif boolean not null default true,
  data jsonb not null default '{}'::jsonb, -- codeInterne, adresse, codePostal, ville, pays, email, telephone, responsableId
  created_at timestamptz not null default now()
);

create table services (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  nom text not null,
  equipes jsonb not null default '[]'::jsonb, -- reste imbriqué : jamais interrogé indépendamment de son service
  created_at timestamptz not null default now()
);

create table leave_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  nom text not null,
  categorie text not null default 'autre' check (categorie in ('conge','autre')),
  actif boolean not null default true,
  ordre integer not null default 0,
  data jsonb not null default '{}'::jsonb, -- icone, couleur, description, nombreAnnuel, illimite, acquisition, paye, workflow, saisiParSalarie, visibleSalarie, visibleRH, autoriserDemiJournee, autoriserPlusieursDemandes, deduireCompteur, deduireRTT, deduireCP, exportPaie
  created_at timestamptz not null default now()
);

create table leave_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  type_id uuid not null references leave_types(id),
  date_debut date not null,
  date_fin date not null,
  statut text not null default 'En attente' check (statut in ('En attente','Validé','Refusé','Annulé')),
  etape_index integer not null default -1,
  data jsonb not null default '{}'::jsonb, -- demiJournee, nbJours, commentaire, justificatif, workflow, historique, prolongations, regularisations
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table telework_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  date_debut date not null,
  date_fin date not null,
  statut text not null default 'En attente' check (statut in ('En attente','Validé','Refusé','Annulé')),
  etape_index integer not null default -1,
  data jsonb not null default '{}'::jsonb, -- nbJours, commentaire, workflow, historique
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  statut text not null default 'En attente' check (statut in ('En attente','Remboursé','Refusé','Annulé')),
  etape_index integer not null default -1,
  montant_ttc numeric(10,2) not null default 0,
  data jsonb not null default '{}'::jsonb, -- categorie, date, libelle, tauxTVA, kilometrage, justificatif, commentaire, workflow, historique
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Note Phase 1 (voir plan) : fichier.dataUrl (base64) migre vers Supabase Storage ; cette table
-- ne stocke que le chemin du fichier, plus son contenu encodé.
create table documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  categorie text,
  nom text,
  date_expiration date,
  fichier_path text,
  created_at timestamptz not null default now()
);

create table drafts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  owner_id uuid not null references employees(id) on delete cascade,
  type text not null,
  champs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  data jsonb not null default '{}'::jsonb, -- contenu, cible, luPar, archivePar
  created_at timestamptz not null default now()
);

create table favorites (
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid not null references employees(id) on delete cascade,
  favorite_employee_id uuid not null references employees(id) on delete cascade,
  primary key (company_id, user_id, favorite_employee_id)
);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  date timestamptz not null default now(),
  action text,
  entite text,
  cible text,
  details text
);

create table school_holidays (
  company_id uuid primary key references companies(id) on delete cascade,
  data jsonb not null default '{}'::jsonb
);

create table settings (
  company_id uuid primary key references companies(id) on delete cascade,
  data jsonb not null default '{}'::jsonb
);

-- Index pour les requêtes les plus fréquentes (filtrage par entreprise / par salarié)
create index on employees (company_id);
create index on leave_requests (company_id, employee_id);
create index on telework_requests (company_id, employee_id);
create index on expenses (company_id, employee_id);
create index on documents (company_id, employee_id);
create index on notifications (company_id);
create index on audit_log (company_id);

-- RLS activé partout, sans policy pour l'instant (voir Phase 2) : accès entièrement fermé via l'API.
alter table companies enable row level security;
alter table employees enable row level security;
alter table etablissements enable row level security;
alter table services enable row level security;
alter table leave_types enable row level security;
alter table leave_requests enable row level security;
alter table telework_requests enable row level security;
alter table expenses enable row level security;
alter table documents enable row level security;
alter table drafts enable row level security;
alter table notifications enable row level security;
alter table favorites enable row level security;
alter table audit_log enable row level security;
alter table school_holidays enable row level security;
alter table settings enable row level security;
