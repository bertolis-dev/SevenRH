-- Seven RH — retour Betty du 18/09/2026 (point 9, ménage) : "rien n'empêche actuellement un
-- Propriétaire de supprimer sa propre fiche". Vérifié : employees_delete (0002_rls_policies.sql)
-- ne vérifie que company_id + has_permission('supprimerSalarie') — comme seul le rôle Propriétaire a
-- cette permission par défaut, RIEN ne l'empêchait de supprimer SA PROPRE ligne via un appel API
-- direct, même après le garde-fou ajouté côté client (canDeleteEmployeeRecord, app.js). Une telle
-- suppression serait irréversible et laisserait l'entreprise sans Propriétaire.
drop policy if exists employees_delete on employees;
create policy employees_delete on employees for delete
  using (company_id = current_company_id() and has_permission('supprimerSalarie') and id <> current_employee_id());

insert into schema_migrations (version) values ('0060_interdire_auto_suppression_salarie') on conflict do nothing;
