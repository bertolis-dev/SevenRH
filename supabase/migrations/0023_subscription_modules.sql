-- Seven RH — modules actifs de l'abonnement à la carte (voir la tarification à la carte du
-- 14/08/2026, jusqu'ici seulement un estimateur front-end sur le site, jamais reliée à Stripe).
--
-- Une entreprise à la carte peut avoir plusieurs modules actifs simultanément (contrairement à
-- l'ancien système à 3 paliers, un seul `offre` par entreprise) — chaque ligne ici correspond à un
-- "subscription item" Stripe réel (voir stripe_subscription_item_id, utilisé par l'action "resync"
-- de billing/index.ts pour mettre à jour la quantité facturée sans recréer l'abonnement).
--
-- Comme `subscriptions` (migration 0010) : AUCUNE policy INSERT/UPDATE/DELETE pour `authenticated`
-- — seule la clé service-role (billing/stripe-webhook) écrit ici, jamais un client directement, pour
-- la même raison (empêcher un salarié de s'auto-attribuer un module non payé via un appel REST).
create table subscription_modules (
  company_id text not null references companies(id) on delete cascade,
  module_key text not null,
  quantite integer not null default 1,
  stripe_subscription_item_id text,
  updated_at timestamptz not null default now(),
  primary key (company_id, module_key)
);

alter table subscription_modules enable row level security;

create policy subscription_modules_select on subscription_modules for select
  using (company_id = current_company_id());

grant select on subscription_modules to authenticated;
