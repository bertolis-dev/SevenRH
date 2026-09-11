-- Seven RH — employee-photos passe en bucket PRIVÉ (§retour Betty du 11/09/2026, point 3).
--
-- 0045 avait rendu ce bucket public par analogie avec company-logos (0025/0026) : le logo est un
-- actif de marque volontairement public, une photo de salarié est une donnée personnelle. Une URL
-- publique Supabase Storage est valable INDÉFINIMENT et contourne entièrement les policies RLS de
-- storage.objects (elles ne s'appliquent qu'au chemin API authentifié, jamais à l'URL publique
-- directe) : un salarié parti qui aurait gardé le lien (historique navigateur, cache, capture)
-- pouvait continuer à voir la photo de ses anciens collègues sans limite de temps. Même défaut que
-- celui déjà corrigé pour employee-documents/justificatifs (0030) : on aligne employee-photos sur
-- le même principe (bucket privé + URL signée de courte durée, voir getEmployeePhotoUrl côté client).
--
-- Les policies RLS de storage.objects posées par 0045 (select/insert/update/delete, toutes scopées à
-- current_company_id()) sont correctes et n'ont pas besoin de changer : elles étaient déjà présentes
-- mais sans effet réel tant que le bucket restait public (le SELECT direct via URL publique les
-- contournait). Passer le bucket en privé les rend enfin opérantes.
update storage.buckets set public = false where id = 'employee-photos';

-- employees.photo contenait jusqu'ici l'URL PUBLIQUE complète renvoyée par getPublicUrl() ; le
-- client bascule sur le CHEMIN de stockage seul ("<company_id>/<employee_id>.<ext>"), résolu en URL
-- signée à l'affichage. On réduit ici les valeurs déjà enregistrées à ce même chemin, sinon les
-- photos déjà téléversées avant cette migration cesseraient de s'afficher (SupabaseSync.
-- getEmployeePhotoUrl recevrait une URL complète au lieu d'un chemin).
update employees
set photo = regexp_replace(photo, '^.*/storage/v1/object/public/employee-photos/', '')
where photo like '%/storage/v1/object/public/employee-photos/%';

insert into schema_migrations (version) values ('0046_employee_photos_private') on conflict do nothing;
