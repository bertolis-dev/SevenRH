-- Seven RH — mode « mise en service » (retour du 21/10/2026, point 4), enfin appliqué côté serveur.
--
-- Constat (tour des bugs du 28/10/2026) : le mode, ajouté le 21/10, n'existait que dans l'écran. Il autorisait le RH à corriger ses propres
-- congés, mais les politiques de sécurité de Supabase (leave_requests_update/delete, telework_requests_update/delete) refusaient toujours la
-- modification de sa propre demande : l'écran affichait un succès, puis le changement disparaissait au rechargement. Et rien n'empêchait un
-- RH (qui a le droit gererParametres) d'écrire lui-même la date du mode dans les réglages : seul l'écran réservait l'activation au propriétaire.
--
-- 1. mise_en_service_active() : vrai tant que la date fixée par le propriétaire n'est pas dépassée.
-- 2. Les politiques de modification et de suppression des congés et du télétravail acceptent la propre demande du demandeur pendant ce mode.
-- 3. Un déclencheur sur les réglages : seul le propriétaire peut activer, prolonger ou arrêter le mode (90 jours au plus). Pour tout autre
--    compte, la valeur existante est conservée telle quelle (un réglage enregistré depuis un écran resté ouvert ne casse donc rien).

begin;

create or replace function mise_en_service_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select (s.data->>'miseEnServiceJusquau') ~ '^\d{4}-\d{2}-\d{2}$'
       and (s.data->>'miseEnServiceJusquau') >= to_char(current_date, 'YYYY-MM-DD')
    from settings s
    where s.company_id = current_company_id()
  ), false);
$$;

revoke all on function mise_en_service_active() from public;
grant execute on function mise_en_service_active() to authenticated;

-- Congés
drop policy if exists leave_requests_update on leave_requests;
create policy leave_requests_update on leave_requests for update
  using (
    company_id = current_company_id()
    and (employee_id != current_employee_id() or current_role_name() = 'proprietaire' or mise_en_service_active())
    and (
      is_manager_of(employee_id)
      or has_permission('validerAbsence') or has_permission('refuserAbsence') or has_permission('annulerAbsence')
    )
  );

drop policy if exists leave_requests_delete on leave_requests;
create policy leave_requests_delete on leave_requests for delete
  using (
    company_id = current_company_id()
    and (employee_id != current_employee_id() or mise_en_service_active())
    and (has_permission('gererUtilisateurs') or has_permission('gererParametres')
         or has_permission('validerAbsence') or has_permission('refuserAbsence') or has_permission('annulerAbsence'))
  );

-- Télétravail (même domaine « absence » que les congés)
drop policy if exists telework_requests_update on telework_requests;
create policy telework_requests_update on telework_requests for update
  using (
    company_id = current_company_id()
    and (employee_id != current_employee_id() or current_role_name() = 'proprietaire' or mise_en_service_active())
    and (
      is_manager_of(employee_id)
      or has_permission('validerAbsence') or has_permission('refuserAbsence') or has_permission('annulerAbsence')
    )
  );

drop policy if exists telework_requests_delete on telework_requests;
create policy telework_requests_delete on telework_requests for delete
  using (
    company_id = current_company_id()
    and (employee_id != current_employee_id() or mise_en_service_active())
    and (has_permission('gererUtilisateurs') or has_permission('gererParametres')
         or has_permission('validerAbsence') or has_permission('refuserAbsence') or has_permission('annulerAbsence'))
  );

-- Réglage : seul le propriétaire change la date du mode.
create or replace function settings_garde_mise_en_service()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ancien text := case when tg_op = 'UPDATE' then coalesce(old.data->>'miseEnServiceJusquau', '') else '' end;
  nouveau text := coalesce(new.data->>'miseEnServiceJusquau', '');
begin
  if nouveau = ancien then
    return new;
  end if;
  -- Hors utilisateur connecté (éditeur SQL, maintenance) : aucune restriction.
  if auth.uid() is null then
    return new;
  end if;
  if current_role_name() is distinct from 'proprietaire' then
    -- Autre compte : on conserve la valeur existante, sans erreur (un écran resté ouvert peut renvoyer un ancien réglage).
    if ancien = '' then
      new.data := new.data - 'miseEnServiceJusquau';
    else
      new.data := jsonb_set(new.data, '{miseEnServiceJusquau}', to_jsonb(ancien));
    end if;
    return new;
  end if;
  if nouveau <> '' and (nouveau !~ '^\d{4}-\d{2}-\d{2}$' or nouveau > to_char(current_date + 90, 'YYYY-MM-DD')) then
    raise exception 'Le mode mise en service dure 90 jours au plus.';
  end if;
  return new;
end;
$$;

drop trigger if exists settings_garde_mise_en_service_trg on settings;
create trigger settings_garde_mise_en_service_trg
  before insert or update on settings
  for each row execute function settings_garde_mise_en_service();

notify pgrst, 'reload schema';

insert into schema_migrations (version) values ('0076_mise_en_service_serveur') on conflict do nothing;

commit;
