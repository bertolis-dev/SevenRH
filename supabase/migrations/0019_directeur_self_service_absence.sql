-- Seven RH — le Directeur n'a personne au-dessus de lui dans la hiérarchie pour valider ses propres
-- congés/absences/télétravail : demande explicite du client, "le directeur doit pouvoir accepter ses
-- congés tout seul". Séparation des tâches maintenue pour tous les autres rôles (RH inclus), et pour
-- les notes de frais même pour le Directeur (circuit financier volontairement laissé séparé, non
-- concerné par cette demande) — voir canSelfServiceAsDirecteur() (app.js), reflété ici côté RLS pour
-- que la policy serveur ne rejette plus silencieusement l'écriture optimiste du client.

drop policy if exists leave_requests_update on leave_requests;
create policy leave_requests_update on leave_requests for update
  using (
    company_id = current_company_id()
    and (employee_id != current_employee_id() or current_role_name() = 'directeur')
    and (
      is_manager_of(employee_id)
      or has_permission('validerAbsence') or has_permission('refuserAbsence') or has_permission('annulerAbsence')
    )
  );

drop policy if exists telework_requests_update on telework_requests;
create policy telework_requests_update on telework_requests for update
  using (
    company_id = current_company_id()
    and (employee_id != current_employee_id() or current_role_name() = 'directeur')
    and (
      is_manager_of(employee_id)
      or has_permission('validerAbsence') or has_permission('refuserAbsence') or has_permission('annulerAbsence')
    )
  );
