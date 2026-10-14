-- Test local de la migration 0074 (voir LISEZMOI.md). Prérequis : 0001 à 0074 appliquées, puis 01_seed.sql, puis
-- pre_0074_salaires.sql AVANT d'appliquer 0074 (ce fichier garnit E4 de salaires dans la fiche, les contrats et les avenants).
-- Chaque ligne affichée indique le résultat ATTENDU entre parenthèses quand il n'est pas évident.
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_encoding = 'UTF8';
\echo === LECTURE (RLS) : employee_remuneration vue par chaque compte
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000005';
select 'B (salarie) voit (attendu E5 seul) : ' || coalesce(string_agg(employee_id, ','), 'rien') from employee_remuneration; commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select 'M3 manager de A et B voit (attendu rien) : ' || coalesce(string_agg(employee_id, ','), 'rien') from employee_remuneration; commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select 'RH sans droit financier voit (attendu rien) : ' || coalesce(string_agg(employee_id, ','), 'rien') from employee_remuneration;
select 'RH voit les campagnes (attendu 0) : ' || count(*) from company_remuneration; commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select 'Proprietaire voit (attendu E1,E4,E5) : ' || string_agg(employee_id, ',' order by employee_id) from employee_remuneration;
select 'Proprietaire voit les campagnes (attendu 1) : ' || count(*) from company_remuneration; commit;
\echo === LECTURE de employees.data par le RH et le manager : plus aucun salaire
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select 'RH lit E4 : salaire=' || coalesce(data->>'salaireBrutMensuel','absent') || ' (attendu absent), contrats avec salaire=' || (select count(*) from jsonb_array_elements(data->'contrats') c where c ? 'salaireBrutMensuel') || ' (attendu 0)' from employees where id='E4'; commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select 'M3 lit E4 : salaire=' || coalesce(data->>'salaireBrutMensuel','absent') || ' (attendu absent)' from employees where id='E4'; commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select 'RH lit les campagnes dans companies.data (attendu false) : ' || (data ? 'campagnesRevisionSalariale') from companies where id='C1'; commit;
\echo === ECRITURE par le RH sans droit financier : tente de changer le salaire de E4, un contrat et le poste
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
update employees set data = data || '{"salaireBrutMensuel":99999,"poste":"Chef","contrats":[{"id":"c1","salaireBrutMensuel":1}]}'::jsonb where id='E4'; commit;
select 'salaire stocke E4 (attendu 2500) : ' || (data->>'salaireBrutMensuel') from employee_remuneration where employee_id='E4';
select 'contrat c1 stocke (attendu 2400) : ' || (data->'contrats'->'c1'->>'salaireBrutMensuel') from employee_remuneration where employee_id='E4';
select 'poste public E4 (attendu Chef) : ' || (data->>'poste') || ' / salaire public : ' || coalesce(data->>'salaireBrutMensuel','absent') from employees where id='E4';
\echo === ECRITURE par E4 lui-meme : tente de se donner une augmentation
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
update employees set data = data || '{"salaireBrutMensuel":50000}'::jsonb where id='E4'; commit;
select 'salaire stocke E4 (attendu 2500) : ' || (data->>'salaireBrutMensuel') from employee_remuneration where employee_id='E4';
\echo === ECRITURE par le proprietaire : nouveau salaire et nouveaux contrats pour E4
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
update employees set data = data || '{"salaireBrutMensuel":2800,"contrats":[{"id":"c1","salaireBrutMensuel":2800,"nombreMoisSalaire":12},{"id":"c3","salaireBrutMensuel":2900}]}'::jsonb where id='E4'; commit;
select 'salaire E4 (attendu 2800) : ' || (data->>'salaireBrutMensuel') || ' | contrats stockes (attendu c1,c3) : ' || (select string_agg(k, ',' order by k) from jsonb_object_keys(data->'contrats') k) || ' | c1 (attendu 2800) = ' || (data->'contrats'->'c1'->>'salaireBrutMensuel') from employee_remuneration where employee_id='E4';
select 'primes conservees car cle absente de l ecriture (attendu Prime) : ' || (data->'primesRecurrentes'->0->>'libelle') from employee_remuneration where employee_id='E4';
\echo === INSERT d un salarie : par le proprietaire (stocke) puis par le RH (ignore)
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
insert into employees(id,company_id,email,role,nom,prenom,data) values ('E7','C1','n7@x','salarie','N','N7','{"salaireBrutMensuel":3100}'); commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
insert into employees(id,company_id,email,role,nom,prenom,data) values ('E8','C1','n8@x','salarie','N','N8','{"salaireBrutMensuel":3200,"poste":"X"}'); commit;
select 'E7 stocke (attendu 3100) : ' || coalesce((select data->>'salaireBrutMensuel' from employee_remuneration where employee_id='E7'), 'rien') || ' | E8 stocke (attendu rien) : ' || coalesce((select data->>'salaireBrutMensuel' from employee_remuneration where employee_id='E8'), 'rien') || ' | E8 public : ' || (select data::text from employees where id='E8');
\echo === ECRITURE DIRECTE dans la table de remuneration par un utilisateur (attendu : permission refusee)
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
update employee_remuneration set data = '{}' where employee_id='E4'; commit;
\echo === CAMPAGNES : le RH enregistre un bloc sans campagnes, puis tente d en injecter
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select save_company_profile(null, '{"reglage":"x"}'::jsonb); commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select save_company_profile(null, '{"campagnesRevisionSalariale":[{"id":"fake"}]}'::jsonb); commit;
select 'campagnes stockees (attendu Révision 2026) : ' || (data->'campagnesRevisionSalariale'->0->>'nom') from company_remuneration;
select 'campagnes dans companies.data (attendu false) : ' || (data ? 'campagnesRevisionSalariale') from companies where id='C1';
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select save_company_profile(null, '{"campagnesRevisionSalariale":[{"id":"cr2","nom":"Nouvelle"}]}'::jsonb); commit;
select 'campagnes apres le proprietaire (attendu Nouvelle) : ' || (data->'campagnesRevisionSalariale'->0->>'nom') from company_remuneration;
\echo === SUPPRESSION d un salarie : sa remuneration disparait
delete from employees where id='E7';
select 'ligne E7 restante (attendu 0) : ' || count(*) from employee_remuneration where employee_id='E7';
