-- Seven RH — correctif d'une régression critique (retour QA du 26/08/2026, point 1) : les demandes
-- de congés/télétravail/notes de frais créées par un salarié ou un manager s'auto-validaient.
--
-- Cause exacte : hasEligibleValidatorForStep/resolveValidatorEmployeeIdsForStep (data.js, §correctif
-- audit du 23/08/2026 pour 2.3 et §7.4) s'appuyaient sur DB.getEmployees(), qui n'est que le CACHE
-- LOCAL de l'auteur de la demande — lui-même filtré par la policy employees_select
-- (0002_rls_policies.sql) : un salarié n'y voit que sa propre fiche, un manager que son équipe. Pour
-- ces deux rôles, RH et Propriétaire n'apparaissent JAMAIS dans ce cache. resolveWorkflowWithFallback
-- en concluait donc "aucun validateur nulle part dans l'entreprise" pour toute étape, vidait le
-- circuit ; le repli sur RH puis Propriétaire échouait pour la même raison (même cache) ; le circuit
-- ressortait vide ; et addLeaveRequest/addTeleworkRequest/addExpense (data.js) statuaient alors
-- `computeInitialWorkflowStatus(workflow) || 'Validé'` (ou même 'Remboursé' pour les notes de
-- frais) — la demande s'auto-validait, sans qu'aucun validateur ne soit informé.
--
-- Correctif : la question "existe-t-il un validateur pour cette étape dans l'entreprise" ne peut
-- être répondue de façon fiable QUE côté serveur, où la visibilité sur les salariés est complète et
-- indépendante de qui pose la question. Les fonctions ci-dessous tournent en security definer (même
-- principe que has_permission) et ne renvoient JAMAIS de fiche salarié — seulement un booléen ou une
-- liste d'identifiants, donc aucune fuite de données au-delà de ce qui existait déjà. Côté client
-- (data.js), si cet appel échoue ou est indisponible (hors ligne, mode démo sans Supabase), le
-- circuit d'ORIGINE est conservé tel quel plutôt que réduit à vide : une demande qui reste "En
-- attente" à tort est un désagrément, une demande auto-validée à tort est une faute.

-- Même logique que has_permission() (0033_role_proprietaire.sql, dernière version en vigueur), mais
-- évaluée pour un salarié ARBITRAIRE plutôt que l'appelant (auth.uid()) — nécessaire ici puisqu'on
-- évalue les droits d'AUTRES salariés que celui qui appelle la fonction.
create or replace function has_permission_for(p_employee_id text, permission_key text)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  emp employees%rowtype;
  default_perms jsonb;
begin
  select * into emp from employees where id = p_employee_id;
  if emp.id is null then return false; end if;

  if emp.permissions_overrides ? permission_key then
    return (emp.permissions_overrides ->> permission_key)::boolean;
  end if;

  default_perms := case emp.role
    when 'proprietaire' then '["voirPropreFiche","modifierPropresCoordonnees","voirSalaries","voirEquipe","creerSalarie","modifierSalarie","archiverSalarie","supprimerSalarie","voirInfosContractuelles","voirInfosFinancieres","voirCompteurs","modifierCompteurs","creerDemandeAbsence","validerAbsence","refuserAbsence","annulerAbsence","saisirMaladie","prolongerMaladie","voirCalendrierGeneral","voirCalendrierEquipe","creerNoteFrais","validerNoteFrais","controlerNoteFrais","marquerNoteRemboursee","calculerTicketsRestaurant","corrigerTicketsRestaurant","exporterPaie","gererParametres","gererUtilisateurs","gererPermissions","voirJournalAudit","gererAbonnements","gererTickets","gererEntretiens","gererIdees"]'::jsonb
    when 'rh' then '["voirPropreFiche","modifierPropresCoordonnees","voirCompteurs","creerDemandeAbsence","creerNoteFrais","voirCalendrierGeneral","voirSalaries","voirCalendrierEquipe","creerSalarie","modifierSalarie","archiverSalarie","voirInfosContractuelles","modifierCompteurs","validerAbsence","refuserAbsence","annulerAbsence","saisirMaladie","prolongerMaladie","validerNoteFrais","calculerTicketsRestaurant","corrigerTicketsRestaurant","exporterPaie","gererParametres","gererUtilisateurs","voirJournalAudit","gererTickets","gererEntretiens","gererIdees"]'::jsonb
    when 'comptabilite' then '["voirPropreFiche","modifierPropresCoordonnees","voirCompteurs","creerDemandeAbsence","creerNoteFrais","voirCalendrierGeneral","controlerNoteFrais","marquerNoteRemboursee","calculerTicketsRestaurant"]'::jsonb
    when 'manager' then '["voirPropreFiche","modifierPropresCoordonnees","voirCompteurs","creerDemandeAbsence","creerNoteFrais","voirCalendrierGeneral","voirEquipe","voirCalendrierEquipe","controlerNoteFrais"]'::jsonb
    else '["voirPropreFiche","modifierPropresCoordonnees","voirCompteurs","creerDemandeAbsence","creerNoteFrais","voirCalendrierGeneral"]'::jsonb
  end;

  return default_perms ? permission_key;
end;
$$;

-- Reproduit exactement la logique client de hasEligibleValidatorForStep (data.js), mais avec une
-- visibilité complète sur l'entreprise, indépendante de l'appelant.
create or replace function has_eligible_validator_for_step(p_employee_id text, p_role text, p_domain text)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  v_requester employees%rowtype;
  v_validate_permission text;
begin
  select * into v_requester from employees where id = p_employee_id;
  if v_requester.id is null then return false; end if;
  v_validate_permission := case when p_domain = 'frais' then 'validerNoteFrais' else 'validerAbsence' end;

  if exists (
    select 1 from employees e
    where e.company_id = v_requester.company_id and e.id != p_employee_id and not e.archive
      and has_permission_for(e.id, v_validate_permission)
  ) then
    return true;
  end if;

  if p_role = 'manager' then
    return exists (
      select 1 from employees mgr
      where mgr.id = any(v_requester.manager_ids)
        and mgr.company_id = v_requester.company_id and not mgr.archive and mgr.role = 'manager'
    );
  end if;

  return exists (
    select 1 from employees e
    where e.company_id = v_requester.company_id and e.id != p_employee_id and not e.archive and e.role = p_role
  );
end;
$$;

-- Reproduit resolveWorkflowWithFallback (data.js) : retire les étapes qu'aucun salarié actuel ne
-- peut jamais franchir, et si la chaîne entière se retrouve vide, retombe sur RH puis Propriétaire
-- (le premier qui existe). `escalated` signale que la chaîne d'origine a dû être réajustée.
create or replace function resolve_workflow_with_fallback(p_employee_id text, p_workflow text[], p_domain text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_raw text[] := coalesce(p_workflow, '{}'::text[]);
  v_result text[] := '{}';
  v_role text;
  v_escalated boolean;
  v_requester employees%rowtype;
begin
  select * into v_requester from employees where id = p_employee_id;
  if v_requester.id is null then
    return jsonb_build_object('workflow', to_jsonb(v_raw), 'escalated', false);
  end if;

  foreach v_role in array v_raw loop
    if has_eligible_validator_for_step(p_employee_id, v_role, p_domain) then
      v_result := array_append(v_result, v_role);
    end if;
  end loop;

  v_escalated := coalesce(array_length(v_result, 1), 0) is distinct from coalesce(array_length(v_raw, 1), 0);

  if coalesce(array_length(v_result, 1), 0) = 0 and coalesce(array_length(v_raw, 1), 0) > 0 then
    if exists (select 1 from employees e where e.company_id = v_requester.company_id and e.role = 'rh' and not e.archive) then
      v_result := array_append(v_result, 'rh');
    elsif exists (select 1 from employees e where e.company_id = v_requester.company_id and e.role = 'proprietaire' and not e.archive) then
      v_result := array_append(v_result, 'proprietaire');
    end if;
    v_escalated := true;
  end if;

  return jsonb_build_object('workflow', to_jsonb(v_result), 'escalated', v_escalated);
end;
$$;

-- Reproduit resolveValidatorEmployeeIdsForStep (data.js, §7.4) : identifiants des salariés éligibles
-- à agir sur l'étape en cours (pour cibler les emails de notification/relance), avec la même
-- visibilité complète côté serveur. Ne renvoie que des identifiants, jamais les fiches elles-mêmes.
create or replace function resolve_validator_employee_ids_for_step(p_employee_id text, p_role text)
returns text[]
language plpgsql stable security definer set search_path = public
as $$
declare
  v_requester employees%rowtype;
  v_result text[] := '{}';
begin
  select * into v_requester from employees where id = p_employee_id;
  if v_requester.id is null then return v_result; end if;

  if p_role = 'manager' then
    select coalesce(array_agg(distinct e.id), '{}') into v_result
    from employees e
    where e.id = any(v_requester.manager_ids) and e.company_id = v_requester.company_id and not e.archive;
  else
    select coalesce(array_agg(distinct e.id), '{}') into v_result
    from employees e
    where e.company_id = v_requester.company_id and e.id != p_employee_id and not e.archive and e.role = p_role;
  end if;

  select coalesce(array_agg(distinct e.id), '{}') || v_result into v_result
  from employees e
  where e.company_id = v_requester.company_id and e.id != p_employee_id and not e.archive
    and (has_permission_for(e.id, 'validerAbsence') or has_permission_for(e.id, 'validerNoteFrais'));

  return (select array_agg(distinct x) from unnest(v_result) x);
end;
$$;
