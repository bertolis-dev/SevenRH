-- Seven RH — vérification des migrations réellement appliquées (demandé plusieurs fois par Betty).
-- À coller dans Supabase → SQL Editor → Run, à tout moment, sans repasser par une conversation avec
-- l'assistant. Trois blocs : (A) la vérification de sécurité la plus critique en premier (0039/0041),
-- (B) la liste fiable à 100 % des migrations suivies automatiquement depuis 0042, (C) un état des
-- lieux au mieux des fichiers 0001 à 0041 (avant ce suivi automatique).
--
-- Limite honnête : ce script vérifie des FAITS observables dans le schéma actuel (table/colonne/
-- fonction/policy/privilège présent ou non) — jamais le contenu exact d'une fonction déjà existante
-- avant une mise à jour "create or replace" (impossible de distinguer, par simple existence, la
-- version 0007 de la version 0009 d'une même policy si l'une remplace l'autre). Ces cas sont notés
-- "non disambiguable" ci-dessous plutôt que de vous donner une fausse certitude.

-- =========================================================================
-- (A) — LE PLUS URGENT : ces 3 migrations corrigent une vraie fuite de sécurité (incident du
-- 26-27/08/2026, voir 0039/0041) où n'importe qui avec la clé anon publique du site pouvait
-- appeler ces fonctions SANS AUTHENTIFICATION. 0039 s'est révélé INEFFICACE en production (Supabase
-- accorde EXECUTE à anon/authenticated par un mécanisme qui contourne "revoke ... from public") —
-- seul 0041 corrige vraiment. Si `anon_peut_executer` vaut `true` pour une seule ligne ci-dessous,
-- c'est une vulnérabilité active en ce moment sur nexus-rh.com, à traiter avant tout le reste.
select
  p.proname as fonction,
  pg_get_function_identity_arguments(p.oid) as parametres,
  has_function_privilege('anon', p.oid, 'execute') as anon_peut_executer,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated_peut_executer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'has_permission_for', 'has_eligible_validator_for_step',
    'resolve_workflow_with_fallback', 'resolve_validator_employee_ids_for_step',
    'check_notify_request_email_rate_limit', 'check_candidature_rate_limit',
    'assign_matricule_number'
  )
order by p.proname;

-- Résultat attendu (0041 bien appliquée) :
--   has_permission_for                        anon=false authenticated=false
--   has_eligible_validator_for_step            anon=false authenticated=false
--   resolve_workflow_with_fallback             anon=false authenticated=true
--   resolve_validator_employee_ids_for_step    anon=false authenticated=true
--   check_notify_request_email_rate_limit      anon=false authenticated=false
--   check_candidature_rate_limit               anon=false authenticated=false
--   assign_matricule_number                    anon=false authenticated=true

-- =========================================================================
-- (B) — Migrations suivies automatiquement depuis le 27/08/2026 (chaque fichier à partir de
-- 0042_schema_migrations_tracking.sql s'enregistre lui-même ici) : cette liste est fiable à 100 %.
select version, applied_at from schema_migrations order by version;

-- =========================================================================
-- (C) — Migrations 0001 à 0041 (avant le suivi automatique) : vérifiées par un signe distinctif
-- observable dans le schéma actuel. "true" = le signe est présent ; pour les lignes marquées
-- [non disambiguable], une valeur "true" prouve qu'AU MOINS une version a tourné, pas laquelle.
select '0001_init_schema : table leave_requests' as migration, exists(select 1 from information_schema.tables where table_schema='public' and table_name='leave_requests') as present
union all
select '0002_rls_policies : policy employees_select', exists(select 1 from pg_policies where schemaname='public' and tablename='employees' and policyname='employees_select')
union all
select '0004_calendar_views : vue leave_requests_calendar', exists(select 1 from information_schema.views where table_schema='public' and table_name='leave_requests_calendar')
union all
select '0005_signup_auto_link : trigger on_auth_user_created', exists(select 1 from pg_trigger where tgname='on_auth_user_created')
union all
select '0006_signup_self_create_employee [non disambiguable, redéfinit une fonction sans nouvel objet]', null
union all
select '0007+0009_security_fixes (policies) : policy expenses_delete [non disambiguable entre les deux versions]', exists(select 1 from pg_policies where schemaname='public' and tablename='expenses' and policyname='expenses_delete')
union all
select '0008_revert_column_grant_restriction [non vérifiable par schéma, revert de grant]', null
union all
select '0010_subscriptions : table subscriptions', exists(select 1 from information_schema.tables where table_schema='public' and table_name='subscriptions')
union all
select '0011_role_change_guard : trigger employees_role_change_guard', exists(select 1 from pg_trigger where tgname='employees_role_change_guard')
union all
select '0012+0033_new_company_signup [non disambiguable, fonction redéfinie par 0033]', exists(select 1 from pg_proc where proname='create_company_self_service')
union all
select '0013_email_domain_check : ANOMALIE si true (devrait avoir été retirée par 0015)', exists(select 1 from pg_proc where proname='email_domain_has_existing_company')
union all
select '0016_auth_user_delete_set_null : ON DELETE SET NULL sur employees.auth_user_id', exists(select 1 from pg_constraint where conname='employees_auth_user_id_fkey' and confdeltype='n')
union all
select '0017_support_tickets : table support_tickets', exists(select 1 from information_schema.tables where table_schema='public' and table_name='support_tickets')
union all
select '0018_ticket_suivi_livraison : colonne date_livraison', exists(select 1 from information_schema.columns where table_schema='public' and table_name='support_tickets' and column_name='date_livraison')
union all
select '0020_entretiens : table entretiens', exists(select 1 from information_schema.tables where table_schema='public' and table_name='entretiens')
union all
select '0021_idees : table idees', exists(select 1 from information_schema.tables where table_schema='public' and table_name='idees')
union all
select '0022_integrations : table company_integrations', exists(select 1 from information_schema.tables where table_schema='public' and table_name='company_integrations')
union all
select '0023_subscription_modules : table subscription_modules', exists(select 1 from information_schema.tables where table_schema='public' and table_name='subscription_modules')
union all
select '0024_candidatures : table candidatures', exists(select 1 from information_schema.tables where table_schema='public' and table_name='candidatures')
union all
select '0025+0026_company_logo : policy company_logos_select', exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='company_logos_select')
union all
select '0027_candidature_postes : colonne candidatures.postes', exists(select 1 from information_schema.columns where table_schema='public' and table_name='candidatures' and column_name='postes')
union all
select '0029_candidature_rate_limit : table candidature_submit_log', exists(select 1 from information_schema.tables where table_schema='public' and table_name='candidature_submit_log')
union all
select '0030_employee_files_storage : policy employee_documents_select', exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='employee_documents_select')
union all
select '0033_role_proprietaire : index employees_one_proprietaire_per_company', exists(select 1 from pg_indexes where schemaname='public' and indexname='employees_one_proprietaire_per_company')
union all
select '0034_ical_tokens : table ical_tokens', exists(select 1 from information_schema.tables where table_schema='public' and table_name='ical_tokens')
union all
select '0035_teams_googlechat_integrations : colonne teams_webhook_url', exists(select 1 from information_schema.columns where table_schema='public' and table_name='company_integrations' and column_name='teams_webhook_url')
union all
select '0036_tickets_traitement_auto : colonne relance_fermeture_envoyee_at', exists(select 1 from information_schema.columns where table_schema='public' and table_name='support_tickets' and column_name='relance_fermeture_envoyee_at')
union all
select '0037_workflow_resolution_serveur : fonction resolve_workflow_with_fallback', exists(select 1 from pg_proc where proname='resolve_workflow_with_fallback')
union all
select '0038_notify_request_email_hardening : table notify_request_email_log', exists(select 1 from information_schema.tables where table_schema='public' and table_name='notify_request_email_log')
union all
select '0039/0041 : VOIR LE BLOC (A) CI-DESSUS — la seule vérification fiable pour ces deux-là', null
union all
select '0040_matricule_atomique : table matricule_counters', exists(select 1 from information_schema.tables where table_schema='public' and table_name='matricule_counters')
order by 1;
