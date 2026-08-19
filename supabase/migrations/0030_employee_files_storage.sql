-- Seven RH — stockage réel des fichiers salarié (D1+D9, audit fiabilité du 19/08/2026) : les
-- documents du coffre-fort RH (table `documents`) et les justificatifs de congé/note de frais
-- (jsonb `data.justificatif` de `leave_requests`/`expenses`) étaient jusqu'ici embarqués en base64
-- directement dans Postgres (voir l'ancien commentaire de documentToRow, supabase-client.js) :
-- fonctionnel mais coûteux (taille de ligne, pas de CDN) et, pour les documents, carrément PAS
-- synchronisé du tout (fichier_path resta toujours null — voir le commentaire "Note Phase 1" déjà
-- présent dans 0001_init_schema.sql, qui anticipait cette migration). Reprend le même patron que
-- `candidatures-files` (0024_candidatures.sql) et `company-logos` (0025/0026) : bucket privé,
-- chemin "<company_id>/<employee_id>/<record_id>-...", URL signée à la demande (jamais publique).
--
-- Deux buckets séparés plutôt qu'un seul : les règles de lecture diffèrent légèrement (un manager
-- peut lire les justificatifs de son équipe pour valider une demande, mais n'a aucune raison de
-- lire les documents RH d'un salarié qu'il ne gère pas au sens strict du coffre-fort).

insert into storage.buckets (id, name, public)
values ('employee-documents', 'employee-documents', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('justificatifs', 'justificatifs', false)
on conflict (id) do nothing;

-- employee-documents : écriture réservée à RH/Directeur (même permission que documents_write,
-- 0002_rls_policies.sql) ; lecture par le salarié concerné ou par voirSalaries — même règle que
-- documents_select.
create policy employee_documents_select on storage.objects for select
  to authenticated
  using (
    bucket_id = 'employee-documents'
    and (storage.foldername(name))[1] = current_company_id()
    and ((storage.foldername(name))[2] = current_employee_id() or has_permission('voirSalaries'))
  );

create policy employee_documents_insert on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'employee-documents'
    and (storage.foldername(name))[1] = current_company_id()
    and has_permission('gererUtilisateurs')
  );

create policy employee_documents_update on storage.objects for update
  to authenticated
  using (
    bucket_id = 'employee-documents'
    and (storage.foldername(name))[1] = current_company_id()
    and has_permission('gererUtilisateurs')
  );

create policy employee_documents_delete on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'employee-documents'
    and (storage.foldername(name))[1] = current_company_id()
    and has_permission('gererUtilisateurs')
  );

-- justificatifs (congés + notes de frais) : chaque salarié ne peut écrire QUE dans son propre
-- dossier (même règle que leave_requests_insert/expenses_insert : employee_id = soi-même) ; lecture
-- par le salarié, un manager de son équipe (validation) ou voirSalaries — même règle que
-- leave_requests_select/expenses_select. Pas de policy update/delete : une fois déposé, un
-- justificatif n'est jamais réécrit (cohérent avec l'esprit "coffre-fort" déjà appliqué aux
-- documents RH).
create policy justificatifs_select on storage.objects for select
  to authenticated
  using (
    bucket_id = 'justificatifs'
    and (storage.foldername(name))[1] = current_company_id()
    and (
      (storage.foldername(name))[2] = current_employee_id()
      or has_permission('voirSalaries')
      or is_manager_of((storage.foldername(name))[2])
    )
  );

create policy justificatifs_insert on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'justificatifs'
    and (storage.foldername(name))[1] = current_company_id()
    and (storage.foldername(name))[2] = current_employee_id()
  );
