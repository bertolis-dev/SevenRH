-- Seven RH — retour du 16/11/2026 : la RH doit pouvoir modifier et supprimer SES PROPRES congés et RTT.
--
-- Avant : seules le propriétaire (modification) et le mode « mise en service » (modification et suppression, voir 0076) autorisaient un compte à
-- toucher à sa propre demande. Une personne RH qui voulait corriger ou supprimer un de ses congés était refusée par le serveur.
--
-- Après : un compte au rôle RH ou propriétaire peut modifier et supprimer ses propres demandes de congé et de télétravail (même domaine « absence »),
-- avec les mêmes droits de gestion qu'avant (gererUtilisateurs / gererParametres / validerAbsence / refuserAbsence / annulerAbsence pour la suppression ;
-- gérer l'équipe ou valider / refuser / annuler pour la modification).
--
-- Inchangé : personne ne VALIDE ni ne REFUSE sa propre demande sauf le propriétaire (c'est une règle de l'écran et du circuit de validation, pas
-- de ces politiques), et le mode « mise en service » continue de servir aux compteurs. Les autres rôles ne peuvent toujours pas toucher à leurs propres
-- demandes en dehors de ce mode.
--
-- À exécuter une fois dans l'éditeur SQL de Supabase.

begin;

-- Congés
drop policy if exists leave_requests_update on leave_requests;
create policy leave_requests_update on leave_requests for update
  using (
    company_id = current_company_id()
    and (employee_id != current_employee_id() or current_role_name() in ('proprietaire', 'rh') or mise_en_service_active())
    and (
      is_manager_of(employee_id)
      or has_permission('validerAbsence') or has_permission('refuserAbsence') or has_permission('annulerAbsence')
    )
  );

drop policy if exists leave_requests_delete on leave_requests;
create policy leave_requests_delete on leave_requests for delete
  using (
    company_id = current_company_id()
    and (employee_id != current_employee_id() or current_role_name() in ('proprietaire', 'rh') or mise_en_service_active())
    and (has_permission('gererUtilisateurs') or has_permission('gererParametres')
         or has_permission('validerAbsence') or has_permission('refuserAbsence') or has_permission('annulerAbsence'))
  );

-- Télétravail (même domaine « absence » que les congés)
drop policy if exists telework_requests_update on telework_requests;
create policy telework_requests_update on telework_requests for update
  using (
    company_id = current_company_id()
    and (employee_id != current_employee_id() or current_role_name() in ('proprietaire', 'rh') or mise_en_service_active())
    and (
      is_manager_of(employee_id)
      or has_permission('validerAbsence') or has_permission('refuserAbsence') or has_permission('annulerAbsence')
    )
  );

drop policy if exists telework_requests_delete on telework_requests;
create policy telework_requests_delete on telework_requests for delete
  using (
    company_id = current_company_id()
    and (employee_id != current_employee_id() or current_role_name() in ('proprietaire', 'rh') or mise_en_service_active())
    and (has_permission('gererUtilisateurs') or has_permission('gererParametres')
         or has_permission('validerAbsence') or has_permission('refuserAbsence') or has_permission('annulerAbsence'))
  );

notify pgrst, 'reload schema';

insert into schema_migrations (version) values ('0077_rh_corrige_ses_conges') on conflict do nothing;

commit;
