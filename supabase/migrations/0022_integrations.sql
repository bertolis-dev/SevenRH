-- Seven RH — Intégration Slack (proposition issue de l'analyse concurrentielle du 14/08/2026).
--
-- Le webhook Slack est un SECRET (quiconque le détient peut poster dans le canal de l'entreprise) —
-- contrairement au reste de `settings` (settings_select ouvert à toute l'entreprise, 0002_rls_
-- policies.sql), il ne doit être lisible QUE par qui a gererParametres. D'où une table dédiée plutôt
-- que d'ajouter une clé dans settings.data, qui aurait exposé le webhook à n'importe quel salarié
-- via une requête directe (RLS, pas juste l'UI, est la vraie frontière de sécurité de cette app).

create table company_integrations (
  company_id text primary key references companies(id) on delete cascade,
  slack_webhook_url text,
  updated_at timestamptz not null default now()
);

alter table company_integrations enable row level security;

create policy company_integrations_select on company_integrations for select
  using (company_id = current_company_id() and has_permission('gererParametres'));
create policy company_integrations_upsert on company_integrations for insert
  with check (company_id = current_company_id() and has_permission('gererParametres'));
create policy company_integrations_update on company_integrations for update
  using (company_id = current_company_id() and has_permission('gererParametres'))
  with check (company_id = current_company_id() and has_permission('gererParametres'));
