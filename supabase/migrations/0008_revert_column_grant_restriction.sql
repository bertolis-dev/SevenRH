-- Seven RH — annule la restriction de colonnes ajoutée dans 0007
--
-- La restriction `grant update (statut, etape_index, data)` sur leave_requests/telework_requests/
-- expenses (0007, point 2) empêchait aussi des fonctionnalités LÉGITIMES : `prolongerArretMaladie`
-- modifie `date_fin`, `regulariserDemande` modifie `type_id`/`date_debut`/`date_fin` (data.js) — ce
-- sont de vraies colonnes indexées, pas des sous-champs de `data`. La restriction bloquait donc ces
-- deux fonctionnalités pour tout le monde, y compris RH/Directeur qui les utilisent légitimement.
--
-- On revient à un GRANT complet (comme avant 0007) : le risque qu'un manager habilité à
-- valider/contrôler puisse en théorie modifier d'autres colonnes via un appel API direct devient une
-- limite ACCEPTÉE (documentée), du même ordre que la limite déjà connue sur `employees` (pas de
-- restriction colonne par colonne) — un vrai correctif nécessiterait des fonctions RPC dédiées par
-- action (valider/refuser/prolonger/régulariser) plutôt qu'un UPDATE direct, hors périmètre pour
-- l'instant.

grant update on leave_requests to authenticated;
grant update on telework_requests to authenticated;
grant update on expenses to authenticated;
