-- Seven RH — photo de profil du salarié (§retour Betty du 10/09/2026 : "dans les paramètres on
-- puisse changer la photo de profil pour qu'on puisse voir dans le planning") : employees.photo
-- existe déjà côté client (renderAvatar, makeEmptyEmployee) mais n'avait jamais eu de bucket de
-- stockage ni de bouton d'upload — Paramètres > Mon compte (renderParametresMonCompte, app.js) est
-- le premier appelant, via employeeRepository.uploadMyPhoto (data.js).
--
-- Bucket PUBLIC, même raisonnement que company-logos (0025/0026_company_logo.sql) : un avatar
-- s'affiche dans des dizaines de lignes à la fois (Planning, listes de salariés...) — une URL
-- publique permanente évite un aller-retour réseau par avatar affiché, contrairement à
-- employee-documents/justificatifs (bucket privé, un seul fichier consulté à la fois sur demande
-- explicite, voir 0030_employee_files_storage.sql).
--
-- Chemin "<company_id>/<employee_id>.<ext>" : CHACUN ne peut écrire que SA PROPRE photo (pas de
-- surcharge RH/manager, non demandée par Betty — à ajouter plus tard si besoin) — même motif
-- `like ... || '/%'` que company_logos (0026, plus robuste que storage.foldername() pour un chemin
-- à un seul niveau).
insert into storage.buckets (id, name, public)
values ('employee-photos', 'employee-photos', true)
on conflict (id) do nothing;

create policy employee_photos_select on storage.objects for select
  to authenticated
  using (bucket_id = 'employee-photos' and name like current_company_id() || '/%');

create policy employee_photos_insert on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'employee-photos'
    and name like current_company_id() || '/' || current_employee_id() || '.%'
  );

create policy employee_photos_update on storage.objects for update
  to authenticated
  using (bucket_id = 'employee-photos' and name like current_company_id() || '/' || current_employee_id() || '.%')
  with check (bucket_id = 'employee-photos' and name like current_company_id() || '/' || current_employee_id() || '.%');

create policy employee_photos_delete on storage.objects for delete
  to authenticated
  using (bucket_id = 'employee-photos' and name like current_company_id() || '/' || current_employee_id() || '.%');

insert into schema_migrations (version) values ('0045_employee_photos_storage') on conflict do nothing;
