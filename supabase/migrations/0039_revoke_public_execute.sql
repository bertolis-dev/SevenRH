-- Seven RH — correctif de sécurité URGENT (retour QA du 26/08/2026, point B.1) : les fonctions
-- security definer créées par 0037/0038 (et, plus anciennement, par 0031) n'étaient protégées par
-- AUCUN `revoke ... from public` — PostgreSQL accorde EXECUTE à PUBLIC par défaut à la création
-- d'une fonction, et PUBLIC inclut `anon`/`authenticated` puisque ce sont des rôles membres de
-- PUBLIC. Résultat concret : n'importe qui disposant de la clé anon (publique par nature, dans le
-- bundle JS servi sur GitHub Pages) pouvait, SANS ÊTRE AUTHENTIFIÉ :
--   - appeler has_permission_for(id, cle) et lire les droits de N'IMPORTE QUEL salarié ;
--   - appeler resolve_validator_employee_ids_for_step(id, role) et énumérer les valideurs d'une
--     entreprise ;
--   - appeler check_notify_request_email_rate_limit(id, limite) et épuiser le quota de
--     notifications d'un salarié pour le faire taire, ou polluer la table de journal ;
--   - appeler check_candidature_rate_limit (0031, même oubli, avec un commentaire qui affirmait à
--     tort que le service-role "bypass déjà tous les grants" — FAUX : BYPASSRLS ne concerne QUE les
--     policies RLS sur les tables, jamais le privilège EXECUTE sur une fonction).
-- 0033/0034 appliquaient déjà la bonne convention (revoke all ... from public, puis grant execute
-- explicite aux seuls rôles qui en ont réellement besoin) — reprise ici pour toutes les fonctions
-- qui l'avaient manquée.
--
-- Principe appliqué : REVOKE sur toutes, puis GRANT EXPLICITE uniquement au(x) rôle(s) qui
-- appellent réellement chaque fonction (authenticated pour un appel direct depuis le client avec sa
-- propre session ; service_role pour un appel depuis une fonction Edge via le client admin — les
-- deux ne se recouvrent pas automatiquement, BYPASSRLS n'accorde aucun privilège EXECUTE implicite).
-- has_permission_for et has_eligible_validator_for_step ne sont JAMAIS appelées directement par du
-- code client — uniquement par d'autres fonctions security definer de ce même fichier, qui héritent
-- des droits de LEUR PROPRE propriétaire pour cet appel interne, quels que soient les grants sur la
-- fonction interne elle-même. Elles restent donc révoquées sans aucun grant de retour.

revoke all on function has_permission_for(text, text) from public;

revoke all on function has_eligible_validator_for_step(text, text, text) from public;

revoke all on function resolve_workflow_with_fallback(text, text[], text) from public;
grant execute on function resolve_workflow_with_fallback(text, text[], text) to authenticated;

revoke all on function resolve_validator_employee_ids_for_step(text, text) from public;
grant execute on function resolve_validator_employee_ids_for_step(text, text) to authenticated, service_role;

revoke all on function check_notify_request_email_rate_limit(text, int) from public;
grant execute on function check_notify_request_email_rate_limit(text, int) to service_role;

-- Même correctif, rétroactif, pour l'oubli plus ancien de 0031 (candidature-submit, jamais appelée
-- qu'avec le client service-role — aucun utilisateur authentifié, encore moins anon, n'a besoin d'y
-- accéder directement).
revoke all on function check_candidature_rate_limit(text, text, int) from public;
grant execute on function check_candidature_rate_limit(text, text, int) to service_role;
