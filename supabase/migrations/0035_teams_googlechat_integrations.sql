-- Seven RH — intégrations Microsoft Teams et Google Chat (audit du 23/08/2026, §6.9).
--
-- "Ajouter Microsoft Teams et Google Chat aux intégrations. Même principe que le webhook Slack
-- existant." Deux colonnes de plus sur la même table (0022_integrations.sql), mêmes policies RLS
-- (lisibles/modifiables uniquement par qui a gererParametres) — aucune nouvelle table nécessaire,
-- ces deux webhooks sont des secrets de la même nature que slack_webhook_url.

alter table company_integrations add column if not exists teams_webhook_url text;
alter table company_integrations add column if not exists google_chat_webhook_url text;
