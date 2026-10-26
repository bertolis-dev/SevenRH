-- Test local de la migration 0075 (voir LISEZMOI.md). Prérequis : 0001 à 0074 + 01_seed.sql, puis ce fichier (il applique 0075 lui-même
-- après avoir garni companies.data de clés qui doivent disparaître). Les résultats attendus sont entre parenthèses.
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_encoding = 'UTF8';

update companies set data = data || '{"entretiens":[{"id":"e1","autoEvaluation":"secret"}],"supportTickets":[{"id":"t1"}],"idees":[{"id":"i1"}],"moduleLicenses":{"conges":["E4"]},"reglage":"garde"}'::jsonb where id = 'C1';
\i C:/Users/tomto/OneDrive/BERTOLIS/supabase/migrations/0075_formations_et_blob_propre.sql

\echo === NETTOYAGE du bloc entreprise par le rattrapage
select 'cles restantes (attendu aucune) : ' || count(*) from companies c, jsonb_object_keys(c.data) k where c.id='C1' and k in ('entretiens','supportTickets','idees','moduleLicenses','formations');
select 'autre cle conservee (attendu garde) : ' || (data->>'reglage') from companies where id='C1';
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select save_company_profile(null, '{"reglage":"x","entretiens":[{"id":"e2","autoEvaluation":"secret2"}],"supportTickets":[{"id":"t2"}]}'::jsonb); commit;
select 'apres une ecriture du RH : entretiens dans le bloc (attendu false) : ' || (data ? 'entretiens') || ' / tickets : ' || (data ? 'supportTickets') || ' / reglage : ' || (data->>'reglage') from companies where id='C1';

\echo === CREATION d une demande
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
insert into formations(id, company_id, employee_id, intitule, financement) values ('F1','C1','E4','Excel avance','entreprise'); commit;
select 'F1 creee par A pour lui-meme (attendu demandee) : ' || statut from formations where id='F1';
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
insert into formations(id, company_id, employee_id, intitule) values ('F2','C1','E5','pour un collegue'); commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
insert into formations(id, company_id, employee_id, intitule, statut) values ('F3','C1','E4','deja acceptee','acceptee'); commit;
select 'F2 et F3 creees (attendu 0) : ' || count(*) from formations where id in ('F2','F3');

\echo === LECTURE : qui voit F1
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
select 'A voit (attendu 1) : ' || count(*) from formations; commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000005';
select 'B collegue voit (attendu 0) : ' || count(*) from formations; commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select 'M3 manager de A voit (attendu 1) : ' || count(*) from formations; commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000006';
select 'M2 autre manager voit (attendu 0) : ' || count(*) from formations; commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select 'RH voit (attendu 1) : ' || count(*) from formations; commit;

\echo === LE SALARIE NE SE DONNE PAS D ACCORD
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
update formations set intitule = 'Excel avance (corrige)', cout_estime = 450 where id='F1'; commit;
select 'correction autorisee (attendu corrige) : ' || intitule from formations where id='F1';
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
update formations set statut = 'acceptee' where id='F1'; commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
update formations set decision_par = 'E4', decision_motif = 'ok' where id='F1'; commit;
select 'statut apres les tentatives (attendu demandee) : ' || statut || ' / decision_par : ' || coalesce(decision_par, 'aucun') from formations where id='F1';
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000005';
update formations set statut = 'acceptee' where id='F1'; commit;
select 'un collegue ne peut rien modifier (attendu demandee) : ' || statut from formations where id='F1';

\echo === DECISION du manager : signee par le serveur
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
update formations set statut = 'acceptee', decision_par = 'E5', decision_motif = 'Utile pour le poste' where id='F1'; commit;
select 'statut (attendu acceptee) : ' || statut || ' / decision_par (attendu E3, pas E5) : ' || decision_par || ' / date posee : ' || (decision_date is not null) from formations where id='F1';
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000006';
update formations set statut = 'refusee' where id='F1'; commit;
select 'autre manager sans effet (attendu acceptee) : ' || statut from formations where id='F1';

\echo === APRES ACCEPTATION : A ne modifie plus le contenu, peut annuler
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
update formations set intitule = 'autre chose' where id='F1'; commit;
select 'intitule inchange (attendu Excel avance (corrige)) : ' || intitule from formations where id='F1';
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
update formations set statut = 'annulee' where id='F1'; commit;
select 'annulee par A (attendu annulee) : ' || statut from formations where id='F1';

\echo === DECIDEUR SUR SA PROPRE DEMANDE : RH refuse, proprietaire autorise
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
insert into formations(id, company_id, employee_id, intitule) values ('F4','C1','E2','Formation du RH'); commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
update formations set statut = 'acceptee' where id='F4'; commit;
select 'RH decide pour lui-meme (attendu demandee) : ' || statut from formations where id='F4';
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
insert into formations(id, company_id, employee_id, intitule) values ('F5','C1','E1','Formation du proprietaire'); commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
update formations set statut = 'acceptee' where id='F5'; commit;
select 'proprietaire decide pour lui-meme (attendu acceptee) : ' || statut from formations where id='F5';
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
update formations set statut = 'acceptee' where id='F4'; commit;
select 'le proprietaire decide pour le RH (attendu acceptee) : ' || statut from formations where id='F4';

\echo === SUPPRESSION : A supprime sa demande tant qu elle n est pas traitee
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
insert into formations(id, company_id, employee_id, intitule) values ('F6','C1','E4','a supprimer'); commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
delete from formations where id='F6'; commit;
select 'F6 apres suppression (attendu 0) : ' || count(*) from formations where id='F6';
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
delete from formations where id='F1'; commit;
select 'F1 annulee mais traitee, suppression par A (attendu 1 : refusee) : ' || count(*) from formations where id='F1';
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
delete from formations where id='F1'; commit;
select 'F1 apres suppression par le RH (attendu 0) : ' || count(*) from formations where id='F1';
