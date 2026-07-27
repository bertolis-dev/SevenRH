-- Seven RH — corrections trouvées par le second passage d'audit RLS
--
-- 1. audit_log n'avait aucune policy DELETE : DB.clearAuditLog() échouait silencieusement côté
--    serveur (0 ligne supprimée, aucune erreur) — le journal semblait vidé localement mais
--    persistait indéfiniment dans Supabase.
create policy audit_log_delete on audit_log for delete
  using (company_id = current_company_id() and has_permission('voirJournalAudit'));

-- 2. leave_requests_delete/telework_requests_delete/expenses_delete (0007) n'excluaient pas le
--    demandeur lui-même — contrairement à toutes les autres policies de ce projet (update, la
--    fonction canManageRequestFor côté JS...), qui appliquent systématiquement la séparation des
--    tâches "personne ne gère sa propre demande, même RH/Directeur". Un administrateur pouvait
--    donc supprimer sa PROPRE demande de congé/télétravail/note de frais.
--
--    expenses_delete avait un problème plus grave : contrairement à expenses_update (qui exige
--    is_manager_of(employee_id) ET controlerNoteFrais pour un manager), la policy DELETE traitait
--    controlerNoteFrais comme un droit "bypass" company-wide — n'importe quel manager pouvait
--    supprimer la note de frais de N'IMPORTE QUEL salarié de l'entreprise, pas seulement de son
--    équipe.

drop policy if exists leave_requests_delete on leave_requests;
create policy leave_requests_delete on leave_requests for delete
  using (
    company_id = current_company_id()
    and employee_id != current_employee_id()
    and (has_permission('gererUtilisateurs') or has_permission('gererParametres')
         or has_permission('validerAbsence') or has_permission('refuserAbsence') or has_permission('annulerAbsence'))
  );

drop policy if exists telework_requests_delete on telework_requests;
create policy telework_requests_delete on telework_requests for delete
  using (
    company_id = current_company_id()
    and employee_id != current_employee_id()
    and (has_permission('gererUtilisateurs') or has_permission('gererParametres')
         or has_permission('validerAbsence') or has_permission('refuserAbsence') or has_permission('annulerAbsence'))
  );

drop policy if exists expenses_delete on expenses;
create policy expenses_delete on expenses for delete
  using (
    company_id = current_company_id()
    and employee_id != current_employee_id()
    and (has_permission('gererUtilisateurs') or has_permission('gererParametres')
         or has_permission('validerNoteFrais')
         or (is_manager_of(employee_id) and has_permission('controlerNoteFrais')))
  );
