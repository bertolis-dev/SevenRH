-- Seven RH — vérification des policies RLS (Phase 2), prêt à coller tel quel dans le SQL Editor
-- (les UUID ci-dessous sont déjà ceux des 6 comptes de test créés).
--
-- Principe : `set local role authenticated` + `set local request.jwt.claims` simulent un appel
-- API authentifié comme un utilisateur précis, exactement comme le ferait PostgREST — donc ces
-- requêtes testent les VRAIES policies, pas une approximation.

-- Fixture (exécutée en tant que postgres, donc pas soumise au RLS) : un type de congé + une
-- demande de Nicolas, pour pouvoir tester la séparation des tâches au test 4.
insert into leave_types (company_id, nom, categorie)
select company_id, 'Congés payés', 'conge' from employees where email = 'nicolas.girard@sevenrh.fr';

insert into leave_requests (company_id, employee_id, type_id, date_debut, date_fin)
select e.company_id, e.id, lt.id, '2026-08-03', '2026-08-07'
from employees e, leave_types lt
where e.email = 'nicolas.girard@sevenrh.fr' and lt.company_id = e.company_id;

-- ---------------------------------------------------------------------------
-- Test 1 — Nicolas (manager) doit voir Nicolas + Sarah + Léa (son équipe), PAS Julien/Camille/Thomas
set local role authenticated;
set local request.jwt.claims to '{"sub": "97f1a332-4dac-469a-a7fc-efe871a08e0e"}';
select email, role from employees order by email; -- attendu : lea.dubois, nicolas.girard, sarah.benali (3 lignes)
reset role;

-- Test 2 — Sarah (salariée) ne doit voir qu'elle-même
set local role authenticated;
set local request.jwt.claims to '{"sub": "629978b6-5a30-4e3d-8fdb-eafdf17f4444"}';
select email, role from employees; -- attendu : uniquement sarah.benali (1 ligne)
reset role;

-- Test 3 — Camille (RH) doit tout voir
set local role authenticated;
set local request.jwt.claims to '{"sub": "301aaf6c-027d-4a16-a2f9-6fb6a27f7243"}';
select email, role from employees order by email; -- attendu : les 6
reset role;

-- Test 4a — séparation des tâches : Nicolas NE DOIT PAS pouvoir modifier SA PROPRE demande
set local role authenticated;
set local request.jwt.claims to '{"sub": "97f1a332-4dac-469a-a7fc-efe871a08e0e"}';
update leave_requests set etape_index = 0
where employee_id = (select id from employees where email = 'nicolas.girard@sevenrh.fr');
-- attendu : "Success. No rows returned" / 0 ligne modifiée
reset role;

-- Test 4b — Camille (RH, bypass company-wide) DOIT pouvoir modifier la demande de Nicolas
set local role authenticated;
set local request.jwt.claims to '{"sub": "301aaf6c-027d-4a16-a2f9-6fb6a27f7243"}';
update leave_requests set etape_index = 0
where employee_id = (select id from employees where email = 'nicolas.girard@sevenrh.fr');
-- attendu : 1 ligne modifiée
reset role;

-- Test 5 — Thomas (comptabilité) ne doit PAS voir les salariés qu'il ne gère pas (pas de
-- voirSalaries/voirEquipe dans son rôle) : il ne doit voir QUE lui-même.
set local role authenticated;
set local request.jwt.claims to '{"sub": "f10e35b7-6c6a-44d2-b6f8-efabe440207c"}';
select email, role from employees; -- attendu : uniquement thomas.petit (1 ligne)
reset role;
