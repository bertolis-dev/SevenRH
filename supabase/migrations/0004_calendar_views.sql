-- Seven RH — vues restreintes pour "Calendrier général" (voirCalendrierGeneral, accordé à TOUS
-- les rôles par défaut, y compris salarié — voir DEFAULT_ROLE_PERMISSIONS dans data.js).
--
-- Problème résolu : les policies RLS de leave_requests/telework_requests (Phase 2) limitent
-- normalement chacun à ses propres demandes / celles de son équipe / tout si RH-Directeur — c'est
-- la bonne sécurité pour les détails sensibles (commentaire, justificatif, historique). Mais le
-- calendrier général doit montrer "qui est absent quand" à toute l'entreprise, quel que soit le rôle.
--
-- Solution : une vue par table, qui n'expose QUE les champs nécessaires au calendrier (jamais le
-- commentaire/justificatif/historique), filtrée par entreprise. Les vues sont volontairement créées
-- SANS security_invoker (comportement par défaut) : elles s'exécutent avec les privilèges du
-- propriétaire (qui contourne le RLS restrictif de la table de base), et c'est le WHERE explicite
-- ci-dessous qui fait tout le travail d'isolation par entreprise à la place.

create view leave_requests_calendar as
select id, company_id, employee_id, type_id, date_debut, date_fin, statut, (data->>'demiJournee') as demi_journee
from leave_requests
where company_id = current_company_id();

grant select on leave_requests_calendar to authenticated;

create view telework_requests_calendar as
select id, company_id, employee_id, date_debut, date_fin, statut
from telework_requests
where company_id = current_company_id();

grant select on telework_requests_calendar to authenticated;
