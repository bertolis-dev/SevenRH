-- Seven RH — correctif de sécurité URGENT (vérification live du 27/08/2026, en marge de la
-- migration 0040 sur les matricules) : 0039_revoke_public_execute.sql (qui devait déjà corriger ce
-- type de faille suite à l'incident B.1) NE FONCTIONNE PAS EN PRODUCTION. Vérifié en direct via curl
-- avec la seule clé anon publique (embarquée dans le JS servi sur GitHub Pages, donc accessible à
-- QUICONQUE sans aucune authentification) :
--   - has_permission_for, has_eligible_validator_for_step : jamais censées être appelables par
--     personne directement — répondent normalement à la clé anon.
--   - resolve_workflow_with_fallback, resolve_validator_employee_ids_for_step : censées nécessiter
--     authenticated — répondent normalement à la clé anon (énumération de valideurs par n'importe qui).
--   - check_notify_request_email_rate_limit : censée nécessiter service_role uniquement — répond à
--     la clé anon, ATTEINT L'INSERT dans notify_request_email_log (écriture, pas juste lecture).
--   - assign_matricule_number (0040, ce jour) : censée nécessiter authenticated — répond à la clé
--     anon, atteint l'INSERT dans matricule_counters.
--
-- Cause racine (diagnostic, pas vérifiable directement sans accès à pg_default_acl) : ces migrations
-- ne faisaient que `revoke all on function X from PUBLIC`. Or Supabase configure par défaut des
-- privilèges par défaut (ALTER DEFAULT PRIVILEGES) qui accordent EXECUTE À anon/authenticated
-- DIRECTEMENT (pas via leur appartenance au pseudo-rôle PUBLIC) pour toute NOUVELLE fonction créée
-- dans le schéma public. Revoke ... FROM PUBLIC ne touche jamais un grant explicite fait séparément
-- à anon/authenticated — d'où l'échec silencieux de 0039 malgré son intention correcte.
--
-- Correctif : revoke EXPLICITE depuis anon ET authenticated (jamais seulement "from public") sur
-- chaque fonction concernée, puis re-grant précis. Complété par un ajustement des privilèges par
-- défaut pour que les PROCHAINES fonctions créées par ce rôle n'héritent plus du même trou —
-- mesure best-effort (dépend du rôle exact utilisé par l'éditeur SQL Supabase, non vérifiable
-- directement) : la vraie garantie reste la discipline de revoke explicite sur CHAQUE nouvelle
-- fonction security definer, désormais "from public, anon, authenticated" et non plus "from public"
-- seul (voir aussi 0040, à corriger par ce fichier).

revoke all on function has_permission_for(text, text) from public, anon, authenticated;

revoke all on function has_eligible_validator_for_step(text, text, text) from public, anon, authenticated;

revoke all on function resolve_workflow_with_fallback(text, text[], text) from public, anon, authenticated;
grant execute on function resolve_workflow_with_fallback(text, text[], text) to authenticated;

revoke all on function resolve_validator_employee_ids_for_step(text, text) from public, anon, authenticated;
grant execute on function resolve_validator_employee_ids_for_step(text, text) to authenticated, service_role;

revoke all on function check_notify_request_email_rate_limit(text, int) from public, anon, authenticated;
grant execute on function check_notify_request_email_rate_limit(text, int) to service_role;

revoke all on function check_candidature_rate_limit(text, text, int) from public, anon, authenticated;
grant execute on function check_candidature_rate_limit(text, text, int) to service_role;

-- Même trou pour la fonction créée aujourd'hui (0040) — corrigé ici plutôt que de réécrire 0040 déjà
-- potentiellement exécutée en production.
revoke all on function assign_matricule_number(text, int) from public, anon, authenticated;
grant execute on function assign_matricule_number(text, int) to authenticated;

-- Best-effort pour les PROCHAINES fonctions créées via l'éditeur SQL Supabase (généralement le rôle
-- postgres) — voir l'en-tête de ce fichier : ne remplace jamais un revoke explicite sur chaque
-- nouvelle fonction, seulement un filet de sécurité supplémentaire.
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
