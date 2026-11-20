-- Seven RH — Connecteurs de prestataires de titres-restaurant (retour du 20/11/2026).
--
-- Premier prestataire : Swile (https://integrations.swile.co/docs/fr/). Ce que fait le connecteur :
--   1. synchroniser les salariés (création, mise à jour, inscription au produit titres-restaurant, retrait au départ) ;
--   2. envoyer la commande mensuelle (le nombre de titres par salarié) par email au contact de commande du prestataire.
-- L'API Swile ne reçoit pas de commande : l'envoi se fait par email, avec le fichier de commande en pièce jointe.
--
-- Sécurité : la clé d'API du prestataire n'est JAMAIS lisible depuis le navigateur. Elle est écrite par une fonction réservée
-- à « gererParametres » (enregistrer_secret_connecteur) et lue uniquement par la fonction serveur « connecteur-tickets »
-- (clé service-role). La table des secrets n'a aucune politique : aucun salarié, RH compris, ne peut la lire.
--
-- À EXÉCUTER à la main dans Supabase > SQL Editor, puis à déployer : supabase/functions/connecteur-tickets/index.ts.

begin;

-- ---------------------------------------------------------------------------
-- 1. Réglages du connecteur (sans secret)
-- ---------------------------------------------------------------------------
create table if not exists connecteurs_tickets (
  company_id text not null references companies(id) on delete cascade,
  fournisseur text not null check (fournisseur in ('swile')),
  actif boolean not null default false,
  client_id text,
  produit_id text,
  synchro_auto boolean not null default true,
  commande_email text,
  commande_copie_email text,
  dernier_sync_at timestamptz,
  dernier_sync_resume jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, fournisseur)
);

alter table connecteurs_tickets enable row level security;

drop policy if exists connecteurs_tickets_select on connecteurs_tickets;
create policy connecteurs_tickets_select on connecteurs_tickets for select
  using (company_id = current_company_id() and (has_permission('gererParametres') or has_permission('calculerTicketsRestaurant')));

drop policy if exists connecteurs_tickets_insert on connecteurs_tickets;
create policy connecteurs_tickets_insert on connecteurs_tickets for insert
  with check (company_id = current_company_id() and has_permission('gererParametres'));

drop policy if exists connecteurs_tickets_update on connecteurs_tickets;
create policy connecteurs_tickets_update on connecteurs_tickets for update
  using (company_id = current_company_id() and has_permission('gererParametres'))
  with check (company_id = current_company_id());

drop policy if exists connecteurs_tickets_delete on connecteurs_tickets;
create policy connecteurs_tickets_delete on connecteurs_tickets for delete
  using (company_id = current_company_id() and has_permission('gererParametres'));

create or replace function connecteurs_tickets_garde()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and auth.uid() is not null then
    -- Le résultat de la dernière synchronisation n'est écrit que par la fonction serveur, jamais par le navigateur.
    new.dernier_sync_at := old.dernier_sync_at;
    new.dernier_sync_resume := old.dernier_sync_resume;
    new.company_id := old.company_id;
    new.fournisseur := old.fournisseur;
  end if;
  return new;
end;
$$;

drop trigger if exists connecteurs_tickets_garde_trg on connecteurs_tickets;
create trigger connecteurs_tickets_garde_trg
  before insert or update on connecteurs_tickets
  for each row execute function connecteurs_tickets_garde();

-- ---------------------------------------------------------------------------
-- 2. Secrets : aucune politique = aucun accès depuis le navigateur
-- ---------------------------------------------------------------------------
create table if not exists connecteurs_tickets_secrets (
  company_id text not null references companies(id) on delete cascade,
  fournisseur text not null check (fournisseur in ('swile')),
  client_secret text not null,
  updated_at timestamptz not null default now(),
  primary key (company_id, fournisseur)
);

alter table connecteurs_tickets_secrets enable row level security;
revoke all on connecteurs_tickets_secrets from public, anon, authenticated;

-- Écriture seule (jamais de lecture) : remplace le secret, ou le crée.
create or replace function enregistrer_secret_connecteur(p_fournisseur text, p_client_secret text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cid text := current_company_id();
begin
  if cid is null then raise exception 'Non authentifié'; end if;
  if not has_permission('gererParametres') then raise exception 'Permission refusée'; end if;
  if p_fournisseur not in ('swile') then raise exception 'Prestataire inconnu'; end if;
  if p_client_secret is null or length(btrim(p_client_secret)) < 8 then raise exception 'Clé secrète invalide'; end if;
  insert into connecteurs_tickets_secrets (company_id, fournisseur, client_secret, updated_at)
  values (cid, p_fournisseur, btrim(p_client_secret), now())
  on conflict (company_id, fournisseur) do update set client_secret = excluded.client_secret, updated_at = now();
end;
$$;

revoke all on function enregistrer_secret_connecteur(text, text) from public, anon;
grant execute on function enregistrer_secret_connecteur(text, text) to authenticated;

-- Le navigateur doit pouvoir savoir qu'une clé est enregistrée, sans jamais la lire.
create or replace function secret_connecteur_present(p_fournisseur text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from connecteurs_tickets_secrets
    where company_id = current_company_id() and fournisseur = p_fournisseur
  ) and (has_permission('gererParametres') or has_permission('calculerTicketsRestaurant'));
$$;

revoke all on function secret_connecteur_present(text) from public, anon;
grant execute on function secret_connecteur_present(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Correspondance salarié Nexus <-> salarié chez le prestataire (écrite par la fonction serveur seule)
-- ---------------------------------------------------------------------------
create table if not exists connecteurs_tickets_salaries (
  company_id text not null references companies(id) on delete cascade,
  fournisseur text not null check (fournisseur in ('swile')),
  employee_id text not null references employees(id) on delete cascade,
  externe_id text,
  statut text not null default 'a_synchroniser' check (statut in ('a_synchroniser', 'synchronise', 'retire', 'erreur', 'ignore')),
  erreur text,
  synchro_le timestamptz not null default now(),
  primary key (company_id, fournisseur, employee_id)
);

alter table connecteurs_tickets_salaries enable row level security;

drop policy if exists connecteurs_tickets_salaries_select on connecteurs_tickets_salaries;
create policy connecteurs_tickets_salaries_select on connecteurs_tickets_salaries for select
  using (company_id = current_company_id() and (has_permission('gererParametres') or has_permission('calculerTicketsRestaurant')));

-- ---------------------------------------------------------------------------
-- 4. Historique des commandes mensuelles envoyées (écrit par la fonction serveur seule)
-- ---------------------------------------------------------------------------
create table if not exists commandes_tickets (
  id text primary key default gen_random_uuid()::text,
  company_id text not null references companies(id) on delete cascade,
  fournisseur text not null check (fournisseur in ('swile')),
  periode text not null check (periode ~ '^\d{4}-\d{2}$'),
  envoyee_par text references employees(id) on delete set null,
  envoyee_le timestamptz not null default now(),
  destinataire text not null,
  nombre_salaries integer not null default 0,
  nombre_titres integer not null default 0,
  statut text not null default 'envoyee' check (statut in ('envoyee', 'erreur')),
  erreur text
);

create index if not exists commandes_tickets_company_periode_idx on commandes_tickets (company_id, periode);

alter table commandes_tickets enable row level security;

drop policy if exists commandes_tickets_select on commandes_tickets;
create policy commandes_tickets_select on commandes_tickets for select
  using (company_id = current_company_id() and (has_permission('calculerTicketsRestaurant') or has_permission('gererParametres')));

notify pgrst, 'reload schema';

insert into schema_migrations (version) values ('0078_connecteurs_tickets_restaurant') on conflict do nothing;

commit;
