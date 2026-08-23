-- Seven RH — corrige un écart entre l'interface et les policies RLS (revue de code du 23/08/2026) :
-- l'application autorise depuis toujours un manager/RH/Directeur à déposer une demande de congé, de
-- télétravail ou une note de frais POUR UN AUTRE SALARIÉ (voir employeeFieldForRequest, app.js : le
-- sélecteur n'est verrouillé que pour le rôle Salarié), et la permission saisirMaladie n'a même de
-- sens que dans ce cadre — un salarié ne se déclare pas lui-même en arrêt maladie.
--
-- Or leave_requests_insert / telework_requests_insert / expenses_insert (0002_rls_policies.sql,
-- jamais redéfinies depuis) exigeaient toutes `employee_id = current_employee_id()`. Toute demande
-- saisie pour un tiers était donc REFUSÉE par Postgres : elle restait dans le cache local optimiste,
-- s'affichait normalement à l'écran, puis disparaissait au rechargement suivant, sans autre trace
-- qu'un toast d'échec de synchronisation.
--
-- Le périmètre retenu ici reproduit exactement celui que l'interface propose déjà
-- (getVisibleEmployeeIdsForCurrentUser), à une exception assumée près : la Comptabilité, qui a une
-- visibilité entreprise entière par son RÔLE mais n'a aucune permission de gestion des absences,
-- ne peut saisir que pour elle-même. Le sélecteur de l'interface est restreint en conséquence
-- (voir employeeFieldForRequest) plutôt que d'élargir ici le droit d'écriture.

-- ---------------------------------------------------------------------------
-- Congés : soi-même, son équipe (manager), ou gestion des absences (RH/Directeur)
-- ---------------------------------------------------------------------------
drop policy if exists leave_requests_insert on leave_requests;
create policy leave_requests_insert on leave_requests for insert
  with check (
    company_id = current_company_id()
    and (
      (employee_id = current_employee_id() and has_permission('creerDemandeAbsence'))
      or is_manager_of(employee_id)
      or has_permission('validerAbsence')
      or has_permission('saisirMaladie')
    )
  );

-- ---------------------------------------------------------------------------
-- Télétravail : même règle, sans saisirMaladie (sans objet ici)
-- ---------------------------------------------------------------------------
drop policy if exists telework_requests_insert on telework_requests;
create policy telework_requests_insert on telework_requests for insert
  with check (
    company_id = current_company_id()
    and (
      (employee_id = current_employee_id() and has_permission('creerDemandeAbsence'))
      or is_manager_of(employee_id)
      or has_permission('validerAbsence')
    )
  );

-- ---------------------------------------------------------------------------
-- Notes de frais : même forme que expenses_update (0002) — le manager n'agit sur
-- son équipe qu'avec controlerNoteFrais, validerNoteFrais reste le passe-droit RH.
-- ---------------------------------------------------------------------------
drop policy if exists expenses_insert on expenses;
create policy expenses_insert on expenses for insert
  with check (
    company_id = current_company_id()
    and (
      (employee_id = current_employee_id() and has_permission('creerNoteFrais'))
      or (is_manager_of(employee_id) and has_permission('controlerNoteFrais'))
      or has_permission('validerNoteFrais')
    )
  );

-- ---------------------------------------------------------------------------
-- Justificatifs (Storage) : même correction, sinon le fichier joint à une demande
-- saisie pour un tiers est refusé alors que la demande, elle, passe désormais.
-- L'échec était d'autant plus discret que l'upload est en "best effort" côté client
-- (uploadJustificatifBestEffort, app.js). Lecture inchangée (justificatifs_select).
-- ---------------------------------------------------------------------------
drop policy if exists justificatifs_insert on storage.objects;
create policy justificatifs_insert on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'justificatifs'
    and (storage.foldername(name))[1] = current_company_id()
    and (
      (storage.foldername(name))[2] = current_employee_id()
      or is_manager_of((storage.foldername(name))[2])
      or has_permission('validerAbsence')
      or has_permission('saisirMaladie')
      or has_permission('validerNoteFrais')
    )
  );

-- ---------------------------------------------------------------------------
-- Purge du journal d'anti-spam des candidatures (revue du 23/08/2026)
-- ---------------------------------------------------------------------------
-- candidature_submit_log (0029) n'était jamais purgé : une salve de spam y laissait des lignes à
-- vie, alors que seule la dernière heure est consultée. La suppression se fait ici pour l'IP
-- courante uniquement, à l'intérieur du verrou consultatif déjà pris — elle utilise l'index
-- (ip, created_at), ne coûte rien, et ne peut pas entrer en concurrence avec un autre appel de la
-- même IP. Reste le cas des IP qui ne reviennent jamais : leurs lignes ne sont pas nettoyées par
-- ce chemin ; une purge planifiée (pg_cron, "delete ... where created_at < now() - interval
-- '1 day'") serait le complément naturel si le volume le justifie un jour.
create or replace function check_candidature_rate_limit(p_ip text, p_company_id text, p_limit int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  perform pg_advisory_xact_lock(hashtext(p_ip));

  delete from candidature_submit_log
    where ip = p_ip and created_at < now() - interval '1 hour';

  select count(*) into v_count from candidature_submit_log where ip = p_ip and created_at >= now() - interval '1 hour';
  if v_count >= p_limit then
    return false;
  end if;
  insert into candidature_submit_log (ip, company_id) values (p_ip, p_company_id);
  return true;
end;
$$;
