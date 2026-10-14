\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_encoding = 'UTF8';
\echo --- 1. RH sauvegarde un bloc PERIME (sans r9, r1 encore accepte, s1 chez E4) + un reglage modifie
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select save_company_profile('Test', '{"reglage":"nouveau","shifts":[{"id":"s1","employeeId":"E4","weekday":"Lun"},{"id":"s2","employeeId":"E5","weekday":"Mar"}],"shiftSwapRequests":[{"id":"r1","shiftId":"s1","employeeId":"E4","destinataireId":"E5","statut":"accepté"}]}'::jsonb);
commit;
select data->>'reglage' as reglage, (select string_agg(r->>'id'||':'||(r->>'statut'), ',' order by r->>'id') from jsonb_array_elements(data->'shiftSwapRequests') r) as demandes, (select string_agg(q->>'id'||'->'||(q->>'employeeId'), ',' order by q->>'id') from jsonb_array_elements(data->'shifts') q) as quarts from companies where id='C1';
\echo --- 2. RH a jour (connait la validation) qui a volontairement remis s1 chez E4
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select save_company_profile('Test', '{"shifts":[{"id":"s1","employeeId":"E4"},{"id":"s2","employeeId":"E5"}],"shiftSwapRequests":[{"id":"r1","shiftId":"s1","employeeId":"E4","destinataireId":"E5","statut":"validé"},{"id":"r9","shiftId":"s2","employeeId":"E5","destinataireId":null,"statut":"proposé"}]}'::jsonb);
commit;
select (select string_agg(q->>'id'||'->'||(q->>'employeeId'), ',' order by q->>'id') from jsonb_array_elements(data->'shifts') q) as quarts from companies where id='C1';
\echo --- 3. demande nouvelle cote client seul (r7) ajoutee ; bloc sans cle shiftSwapRequests : demandes conservees
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select save_company_profile(null, '{"shiftSwapRequests":[{"id":"r7","shiftId":"s2","employeeId":"E5","statut":"proposé"}]}'::jsonb);
commit;
select (select string_agg(r->>'id', ',' order by r->>'id') from jsonb_array_elements(data->'shiftSwapRequests') r) as demandes from companies where id='C1';
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select save_company_profile(null, '{"autre":1}'::jsonb);
commit;
select (select string_agg(r->>'id', ',' order by r->>'id') from jsonb_array_elements(data->'shiftSwapRequests') r) as demandes, data->'shifts' is null as pas_de_quarts_cote_client, data->>'autre' as autre from companies where id='C1';
\echo --- 4. pointages : fusion inchangee (0070)
update companies set data = jsonb_set(data, '{pointages}', '[{"id":"p1","employeeId":"E4"}]'::jsonb) where id='C1';
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select save_company_profile(null, '{"pointages":[{"id":"p2","employeeId":"E5"}]}'::jsonb, true);
commit;
select (select string_agg(p->>'id', ',' order by p->>'id') from jsonb_array_elements(data->'pointages') p) as pointages_avec_flag from companies where id='C1';
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select save_company_profile(null, '{"pointages":[]}'::jsonb, false);
commit;
select (select string_agg(p->>'id', ',' order by p->>'id') from jsonb_array_elements(data->'pointages') p) as pointages_sans_flag from companies where id='C1';
