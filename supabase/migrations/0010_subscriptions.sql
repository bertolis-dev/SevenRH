-- Seven RH — abonnement Stripe réel (voir le plan de facturation)
--
-- L'abonnement (offre/statut/dates) vivait jusqu'ici DANS la colonne jsonb companies.data, que
-- n'importe quel utilisateur gererParametres peut réécrire en entier (companies_update, 0002) —
-- une fois un vrai paiement en jeu, ça permettrait de s'auto-attribuer "premium actif" par un
-- simple appel REST, en contournant Stripe. On sort donc l'abonnement vers sa propre table, dont
-- AUCUNE policy INSERT/UPDATE/DELETE n'est accordée à `authenticated` — refusée par défaut par
-- RLS, donc seule la clé service-role (utilisée par les fonctions serveur billing/stripe-webhook)
-- peut y écrire. Plus robuste qu'une restriction colonne par colonne (déjà tentée et annulée pour
-- leave_requests/telework_requests/expenses, voir 0007/0008) : aucun risque d'oubli si une future
-- colonne est ajoutée à cette table.

create table subscriptions (
  company_id text primary key references companies(id) on delete cascade,
  offre text not null default 'essai',
  periodicite text,
  statut text not null default 'actif',
  date_debut date not null default current_date,
  date_renouvellement date,
  nombre_salaries_max integer,
  stripe_customer_id text,
  stripe_subscription_id text,
  updated_at timestamptz not null default now()
);

alter table subscriptions enable row level security;

create policy subscriptions_select on subscriptions for select
  using (company_id = current_company_id());

grant select on subscriptions to authenticated;

-- Reprise des entreprises existantes : copie l'abonnement actuel (stocké dans data->'abonnement')
-- pour ne perdre aucun état déjà en place (ex. "Seven RH Demo Test").
insert into subscriptions (company_id, offre, periodicite, statut, date_debut, date_renouvellement, nombre_salaries_max)
select
  id,
  coalesce(data->'abonnement'->>'offre', 'essai'),
  data->'abonnement'->>'periodicite',
  coalesce(data->'abonnement'->>'statut', 'actif'),
  coalesce((data->'abonnement'->>'dateDebut')::date, current_date),
  nullif(data->'abonnement'->>'dateRenouvellement', '')::date,
  (data->'abonnement'->>'nombreSalariesMax')::integer
from companies
where not exists (select 1 from subscriptions s where s.company_id = companies.id);

-- Empêche toute confusion future : abonnement ne doit plus jamais être lu depuis data (la table
-- ci-dessus est désormais la seule source de vérité) — retiré du blob pour que personne ne se fie
-- par erreur à une copie devenue obsolète dès qu'un paiement Stripe met subscriptions à jour.
update companies set data = data - 'abonnement' where data ? 'abonnement';

-- Événements Stripe déjà traités (idempotence des webhooks — Stripe peut renvoyer le même
-- événement plusieurs fois en cas de retry réseau).
create table processed_stripe_events (
  event_id text primary key,
  processed_at timestamptz not null default now()
);

alter table processed_stripe_events enable row level security;
-- Aucune policy pour `authenticated` : cette table n'est utilisée que par le webhook (service-role,
-- qui contourne RLS) — un client normal ne doit jamais pouvoir la lire ni l'écrire.
