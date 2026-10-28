-- Test local de la migration 0076 (voir LISEZMOI.md). Prérequis : 0001 à 0075 + 01_seed.sql ; ce fichier applique 0076 lui-même.
-- Les résultats attendus sont entre parenthèses.
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_encoding = 'UTF8';

insert into leave_types(id, company_id, nom, categorie, actif) values ('T1','C1','Conges payes','conge',true) on conflict do nothing;
delete from leave_requests where id like 'L_%';
delete from telework_requests where id like 'W_%';
delete from settings where company_id = 'C1';
insert into leave_requests(id, company_id, employee_id, type_id, date_debut, date_fin, statut) values
  ('L_RH','C1','E2','T1','2026-03-02','2026-03-03','Validé'), ('L_SAL','C1','E4','T1','2026-03-02','2026-03-03','Validé');
insert into telework_requests(id, company_id, employee_id, date_debut, date_fin, statut) values ('W_RH','C1','E2','2026-03-02','2026-03-03','Validé');

\i C:/Users/tomto/OneDrive/BERTOLIS/supabase/migrations/0076_mise_en_service_serveur.sql

\echo === 1. mode inactif : le RH ne peut pas modifier ni supprimer ses propres demandes
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
update leave_requests set date_fin='2026-03-04' where id='L_RH';
update telework_requests set date_fin='2026-03-04' where id='W_RH';
delete from leave_requests where id='L_RH';
commit;
select 'conge date_fin (attendu 2026-03-03) : ' || (select date_fin from leave_requests where id='L_RH') || ' / teletravail (attendu 2026-03-03) : ' || (select date_fin from telework_requests where id='W_RH') || ' / conge encore la (attendu 1) : ' || (select count(*) from leave_requests where id='L_RH');

\echo === 2. un RH ne peut pas activer le mode lui-meme (la valeur est ignoree sans erreur)
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
insert into settings(company_id, data) values ('C1', '{"miseEnServiceJusquau":"2099-12-31","autre":"x"}'::jsonb)
  on conflict (company_id) do update set data = excluded.data;
commit;
select 'reglage du RH (attendu : mode vide, autre=x) : ' || coalesce(data->>'miseEnServiceJusquau', 'vide') || ' / autre=' || (data->>'autre') from settings where company_id='C1';
select 'mode actif cote serveur (attendu f) : ' || (select mise_en_service_active() from (select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002', true)) x);

\echo === 3. le proprietaire active le mode pour 30 jours
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
update settings set data = data || jsonb_build_object('miseEnServiceJusquau', to_char(current_date + 30, 'YYYY-MM-DD')) where company_id='C1';
commit;
select 'mode ecrit par le proprietaire (attendu une date) : ' || (data->>'miseEnServiceJusquau') from settings where company_id='C1';

\echo === 4. mode actif : le RH corrige et supprime ses propres demandes
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
update leave_requests set date_fin='2026-03-04' where id='L_RH';
update telework_requests set date_fin='2026-03-04' where id='W_RH';
commit;
select 'conge date_fin (attendu 2026-03-04) : ' || date_fin || ' / teletravail (attendu 2026-03-04) : ' || (select date_fin from telework_requests where id='W_RH') from leave_requests where id='L_RH';
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
delete from leave_requests where id='L_RH';
delete from telework_requests where id='W_RH';
commit;
select 'conge supprime (attendu 0) : ' || count(*) || ' / teletravail supprime (attendu 0) : ' || (select count(*) from telework_requests where id='W_RH') from leave_requests where id='L_RH';

\echo === 5. mode actif : un simple salarie ne gagne aucun droit
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
update leave_requests set date_fin='2026-03-09' where id='L_SAL';
delete from leave_requests where id='L_SAL';
commit;
select 'demande du salarie (attendu 1 ligne, date_fin 2026-03-03) : ' || count(*) || ' / ' || min(date_fin) from leave_requests where id='L_SAL';

\echo === 6. un RH ne peut ni prolonger ni couper le mode (valeur conservee)
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
update settings set data = data || '{"miseEnServiceJusquau":"2099-12-31"}'::jsonb where company_id='C1';
commit;
select 'apres tentative de prolongation (attendu : meme date qu en 3) : ' || (data->>'miseEnServiceJusquau') from settings where company_id='C1';
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
update settings set data = data - 'miseEnServiceJusquau' where company_id='C1';
commit;
select 'apres tentative de coupure (attendu : meme date) : ' || coalesce(data->>'miseEnServiceJusquau', 'vide') from settings where company_id='C1';

\echo === 7. le proprietaire ne peut pas depasser 90 jours
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
update settings set data = data || jsonb_build_object('miseEnServiceJusquau', to_char(current_date + 200, 'YYYY-MM-DD')) where company_id='C1';
commit;
select 'apres tentative a 200 jours (attendu : toujours la date de 30 jours) : ' || (data->>'miseEnServiceJusquau') from settings where company_id='C1';

\echo === 8. le proprietaire arrete le mode, le RH perd aussitot ses droits
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
update settings set data = data - 'miseEnServiceJusquau' where company_id='C1';
commit;
insert into leave_requests(id, company_id, employee_id, type_id, date_debut, date_fin, statut) values ('L_RH2','C1','E2','T1','2026-04-01','2026-04-02','Validé');
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
update leave_requests set date_fin='2026-04-03' where id='L_RH2';
commit;
select 'RH apres arret (attendu 2026-04-02) : ' || date_fin from leave_requests where id='L_RH2';

\echo === 9. une date passee n active rien
update settings set data = data || '{"miseEnServiceJusquau":"2020-01-01"}'::jsonb where company_id='C1';
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
update leave_requests set date_fin='2026-04-03' where id='L_RH2';
commit;
select 'RH avec date passee (attendu 2026-04-02) : ' || date_fin from leave_requests where id='L_RH2';

delete from leave_requests where id like 'L_%';
delete from telework_requests where id like 'W_%';
delete from settings where company_id = 'C1';
