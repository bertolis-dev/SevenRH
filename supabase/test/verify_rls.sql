-- Seven RH — vérification des policies RLS (Phase 2), à exécuter APRÈS avoir :
--   1. exécuté supabase/test/seed_test_data.sql
--   2. créé les 6 utilisateurs Supabase Auth (Authentication > Add user, mêmes emails)
--   3. exécuté la requête de liaison (auth_user_id) donnée en bas de seed_test_data.sql
--
-- Principe : `set local role authenticated` + `set local request.jwt.claims` simulent un appel
-- API authentifié comme un utilisateur précis, exactement comme le ferait PostgREST — donc ces
-- requêtes testent les VRAIES policies, pas une approximation.
--
-- Remplacer <UUID_NICOLAS> etc. par les auth_user_id réels (visibles dans Authentication > Users,
-- ou via : select email, auth_user_id from employees;)

-- Test 1 — Nicolas (manager) doit voir Sarah et Léa (son équipe) mais PAS Thomas (hors équipe) :
set local role authenticated;
set local request.jwt.claims to '{"sub": "<UUID_NICOLAS>"}';
select email, role from employees; -- attendu : Nicolas, Sarah, Léa (pas Julien/Camille/Thomas)
reset role;

-- Test 2 — Sarah (salariée) ne doit voir qu'elle-même :
set local role authenticated;
set local request.jwt.claims to '{"sub": "<UUID_SARAH>"}';
select email, role from employees; -- attendu : uniquement Sarah
reset role;

-- Test 3 — Camille (RH) doit tout voir :
set local role authenticated;
set local request.jwt.claims to '{"sub": "<UUID_CAMILLE>"}';
select email, role from employees; -- attendu : les 6
reset role;

-- Test 4 — séparation des tâches : Nicolas ne doit PAS pouvoir "valider" une demande de congé
-- posée par... Nicolas lui-même (employee_id = current_employee_id() est explicitement exclu).
-- (nécessite qu'une ligne leave_requests existe pour Nicolas ; sinon 0 ligne affectée = attendu aussi)
set local role authenticated;
set local request.jwt.claims to '{"sub": "<UUID_NICOLAS>"}';
update leave_requests set etape_index = -1 where employee_id = (select id from employees where email = 'nicolas.girard@sevenrh.fr');
-- attendu : "UPDATE 0" (aucune ligne modifiée, même s'il existe une demande de Nicolas)
reset role;
