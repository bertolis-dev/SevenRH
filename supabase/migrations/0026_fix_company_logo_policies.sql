-- Seven RH — correctif des policies storage du logo d'entreprise (0025_company_logo.sql) :
-- l'upload échouait avec "new row violates row-level security policy". Deux changements :
--
-- 1. `like current_company_id() || '/%'` remplace `(storage.foldername(name))[1] = ...` — motif
--    canonique de la documentation Supabase elle-même pour restreindre par préfixe de chemin, plus
--    robuste que l'indexation de tableau (storage.foldername) pour ce cas simple à un seul niveau.
-- 2. Ajout d'une policy SELECT et DELETE sur ce même préfixe : l'upload avec upsert=true fait un
--    UPSERT réel côté Storage, qui a besoin de LIRE (et potentiellement remplacer) la ligne
--    existante — la policy INSERT seule ne suffisait pas dès qu'un logo avait déjà été uploadé une
--    fois pour cette entreprise.
-- Filet de sécurité : chaque table créée dans ce projet a explicitement reçu un GRANT en plus de sa
-- policy RLS (voir "grant select on candidatures to authenticated" etc., migrations précédentes) —
-- storage.objects étant un objet système, ce grant est normalement déjà en place par défaut, mais
-- on le repose ici sans risque au cas où il aurait manqué pour ce projet précis.
grant select, insert, update, delete on storage.objects to authenticated;

drop policy if exists company_logos_insert on storage.objects;
drop policy if exists company_logos_update on storage.objects;

create policy company_logos_select on storage.objects for select
  to authenticated
  using (bucket_id = 'company-logos' and name like current_company_id() || '/%');

create policy company_logos_insert on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'company-logos'
    and name like current_company_id() || '/%'
    and has_permission('gererParametres')
  );

create policy company_logos_update on storage.objects for update
  to authenticated
  using (bucket_id = 'company-logos' and name like current_company_id() || '/%' and has_permission('gererParametres'))
  with check (bucket_id = 'company-logos' and name like current_company_id() || '/%' and has_permission('gererParametres'));

create policy company_logos_delete on storage.objects for delete
  to authenticated
  using (bucket_id = 'company-logos' and name like current_company_id() || '/%' and has_permission('gererParametres'));

-- Même correctif préventif sur candidatures-files (0024_candidatures.sql) : exactement le même
-- motif storage.foldername(), donc probablement la même fragilité, avant qu'un CV/lettre ne soit
-- effectivement consulté depuis l'écran Embauche.
drop policy if exists candidatures_files_select on storage.objects;

create policy candidatures_files_select on storage.objects for select
  to authenticated
  using (
    bucket_id = 'candidatures-files'
    and name like current_company_id() || '/%'
    and has_permission('creerSalarie')
  );
