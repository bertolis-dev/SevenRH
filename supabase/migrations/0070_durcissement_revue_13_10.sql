-- Seven RH — revue de sécurité du 13/10/2026. Cinq défauts confirmés dans le code SQL existant, dont deux
-- introduits par 0068 (pointage) et 0065 (escalade de privilèges).
--
-- 1. enregistrer_pointage (0068) : verifier_pointage_code renvoie NULL (et non false) quand le code est NULL ;
--    « if not NULL » ne levait rien — n'importe quel salarié pouvait donc se pointer à distance avec un code
--    NULL, exactement ce que 0068 devait empêcher. Contrôle désormais strict, et contenu du pointage validé
--    (établissement de l'entreprise, date du jour ±1, heures au format HH:MM, taille bornée, champs connus
--    seulement, régularisation existante conservée).
-- 2. employees.auth_user_id n'était protégé par aucun trigger : un RH (modifierSalarie) pouvait rattacher son
--    compte de connexion à la fiche du Propriétaire et en prendre la place malgré 0065. Toute modification de
--    auth_user_id par une session authentifiée est maintenant annulée (les fonctions serveur sans session —
--    Edge Function manage-employee-account, triggers d'inscription — ne sont pas concernées). Cela supprime aussi
--    un effet de bord existant : un upsert depuis un cache périmé pouvait remettre auth_user_id à NULL.
--    manager_ids ne se modifie plus sans modifierSalarie (un salarié pouvait se désigner son propre manager) : valeur conservée.
-- 3. Les pointages vivent dans le blob companies.data : toute écriture de ce blob par un administrateur depuis un
--    cache périmé effaçait les pointages enregistrés entre-temps par les salariés. save_company_profile écrit le
--    blob en conservant les pointages du serveur (fusion par identifiant quand l'appelant en modifie).
-- 4. is_manager_of (0057) et delegations_recues (0069) levaient une exception sur une donnée mal formée
--    (data.delegations qui n'est pas un tableau, date invalide) : un salarié pouvait empoisonner sa propre fiche
--    et faire échouer le chargement de ses collègues. Tolérant désormais.
-- 5. set_candidature_statut (0055) avait perdu le garde-fou de 0028 : double « Embaucher », « Avancer » périmé qui
--    repasse une candidature embauchée en « entretien » et efface son employee_id.

begin;

-- ---------------------------------------------------------------------------
-- Utilitaire : conversion de date tolérante (NULL au lieu d'une exception).
-- ---------------------------------------------------------------------------
create or replace function safe_date(p text)
returns date
language plpgsql
immutable
set search_path = public
as $$
begin
  return p::date;
exception when others then
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Pointage
-- ---------------------------------------------------------------------------
create or replace function enregistrer_pointage(p_etablissement_id text, p_code text, p_pointage jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp text := current_employee_id();
  v_company text := current_company_id();
  v_aujourdhui date := (now() at time zone 'Europe/Paris')::date;
  v_date date;
  v_existant jsonb;
  v_final jsonb;
begin
  if v_emp is null or v_company is null then
    raise exception 'Non authentifié.';
  end if;
  if p_code is null or coalesce(verifier_pointage_code(p_etablissement_id, p_code), false) is not true then
    raise exception 'QR code invalide ou expiré.';
  end if;
  if p_pointage is null or jsonb_typeof(p_pointage) <> 'object' or length(p_pointage::text) > 1000 then
    raise exception 'Pointage invalide.';
  end if;
  if coalesce(p_pointage->>'id', '') = '' or length(p_pointage->>'id') > 100 then
    raise exception 'Pointage invalide.';
  end if;
  if p_pointage->>'employeeId' is distinct from v_emp then
    raise exception 'Un pointage ne peut être enregistré que pour soi-même.';
  end if;
  if not exists (select 1 from etablissements where id = p_pointage->>'etablissementId' and company_id = v_company) then
    raise exception 'Pointage invalide.';
  end if;
  v_date := safe_date(p_pointage->>'date');
  if v_date is null or p_pointage->>'date' !~ '^\d{4}-\d{2}-\d{2}$' or v_date < v_aujourdhui - 1 or v_date > v_aujourdhui + 1 then
    raise exception 'Pointage invalide.';
  end if;
  if coalesce(p_pointage->>'heureArrivee', '') !~ '^([01]\d|2[0-3]):[0-5]\d$' then
    raise exception 'Pointage invalide.';
  end if;
  if coalesce(p_pointage->>'heureDepart', '') <> '' and p_pointage->>'heureDepart' !~ '^([01]\d|2[0-3]):[0-5]\d$' then
    raise exception 'Pointage invalide.';
  end if;

  select e into v_existant
    from companies c, jsonb_array_elements(coalesce(c.data->'pointages', '[]'::jsonb)) e
   where c.id = v_company and e->>'id' = p_pointage->>'id'
   limit 1;
  -- Jamais remplacer le pointage de quelqu'un d'autre en réutilisant son identifiant.
  if v_existant is not null and v_existant->>'employeeId' is distinct from v_emp then
    raise exception 'Pointage invalide.';
  end if;

  v_final := jsonb_build_object(
    'id', p_pointage->>'id',
    'employeeId', v_emp,
    'etablissementId', p_pointage->>'etablissementId',
    'date', p_pointage->>'date',
    'heureArrivee', p_pointage->>'heureArrivee',
    'heureDepart', nullif(p_pointage->>'heureDepart', ''),
    -- Une régularisation posée par un manager/RH ne peut pas être effacée par le salarié.
    'regularisation', coalesce(v_existant->'regularisation', 'null'::jsonb)
  );

  update companies
     set data = jsonb_set(
       coalesce(data, '{}'::jsonb),
       '{pointages}',
       coalesce((
         select jsonb_agg(e)
           from jsonb_array_elements(coalesce(data->'pointages', '[]'::jsonb)) e
          where e->>'id' is distinct from p_pointage->>'id'
       ), '[]'::jsonb) || jsonb_build_array(v_final)
     )
   where id = v_company;
end;
$$;

revoke all on function enregistrer_pointage(text, text, jsonb) from public, anon;
grant execute on function enregistrer_pointage(text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Écriture du blob de l'entreprise sans écraser les pointages du serveur
-- ---------------------------------------------------------------------------
create or replace function save_company_profile(p_raison_sociale text, p_data jsonb, p_inclure_pointages boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company text := current_company_id();
  v_serveur jsonb;
  v_client jsonb;
  v_fusion jsonb;
begin
  if v_company is null then
    raise exception 'Non authentifié.';
  end if;
  if not has_permission('gererParametres') then
    raise exception 'Permission refusée.';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'Données invalides.';
  end if;

  select coalesce(data->'pointages', '[]'::jsonb) into v_serveur from companies where id = v_company for update;
  if p_inclure_pointages and jsonb_typeof(p_data->'pointages') = 'array' then
    v_client := p_data->'pointages';
    -- Fusion par identifiant : les pointages du serveur absents de la liste de l'appelant sont conservés, ceux
    -- qu'il envoie remplacent le même identifiant.
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_fusion from (
      select e as x from jsonb_array_elements(v_serveur) e
       where not exists (select 1 from jsonb_array_elements(v_client) c where c->>'id' = e->>'id')
      union all
      select c from jsonb_array_elements(v_client) c
    ) t;
  else
    v_fusion := v_serveur;
  end if;

  update companies
     set raison_sociale = coalesce(p_raison_sociale, raison_sociale),
         data = jsonb_set(p_data, '{pointages}', v_fusion)
   where id = v_company;
end;
$$;

revoke all on function save_company_profile(text, jsonb, boolean) from public, anon;
grant execute on function save_company_profile(text, jsonb, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Garde de la table employees : auth_user_id figé, manager_ids réservé à modifierSalarie
--    (reprend la définition de 0065 et ajoute ces deux règles)
-- ---------------------------------------------------------------------------
create or replace function guard_employee_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  acting_role text := current_role_name();
  nb_proprietaires int;
  transfer_bypass boolean := coalesce(current_setting('app.role_transfer_in_progress', true), '') = 'true';
begin
  -- Le compte de connexion rattaché à une fiche ne change jamais depuis une session authentifiée (prise de
  -- contrôle du compte du Propriétaire par un RH). Annulé silencieusement plutôt que refusé : un upsert depuis un
  -- cache périmé renvoie l'ancienne valeur, ce n'est pas une tentative d'attaque.
  if NEW.auth_user_id is distinct from OLD.auth_user_id and auth.uid() is not null then
    NEW.auth_user_id := OLD.auth_user_id;
  end if;

  -- Idem pour le rattachement hiérarchique sans le droit modifierSalarie : valeur précédente conservée.
  if NEW.manager_ids is distinct from OLD.manager_ids and not transfer_bypass and auth.uid() is not null
     and not has_permission('modifierSalarie') then
    NEW.manager_ids := OLD.manager_ids;
  end if;

  if NEW.role is distinct from OLD.role and not transfer_bypass then
    if NEW.id = current_employee_id() then
      raise exception 'Impossible de changer son propre rôle.';
    end if;
    if not has_permission('gererUtilisateurs') then
      raise exception 'Non autorisé à changer le rôle d''un salarié.';
    end if;
    if (NEW.role = 'proprietaire' or OLD.role = 'proprietaire') and acting_role is distinct from 'proprietaire' then
      raise exception 'Seul le Propriétaire peut attribuer ou retirer ce statut.';
    end if;
    if OLD.role = 'proprietaire' and NEW.role is distinct from 'proprietaire' then
      select count(*) into nb_proprietaires from employees
        where company_id = OLD.company_id and role = 'proprietaire' and not archive;
      if nb_proprietaires <= 1 then
        raise exception 'Impossible : ce salarié est le Propriétaire de l''entreprise — utilisez le transfert de propriété.';
      end if;
    end if;
  end if;

  if NEW.permissions_overrides is distinct from OLD.permissions_overrides and not transfer_bypass then
    if not has_permission('gererPermissions') then
      raise exception 'Non autorisé à modifier les permissions individuelles d''un salarié.';
    end if;
    if NEW.id = current_employee_id() then
      raise exception 'Impossible de modifier ses propres permissions.';
    end if;
    if OLD.role = 'proprietaire' and acting_role is distinct from 'proprietaire' then
      raise exception 'Seul le Propriétaire peut modifier les permissions du Propriétaire.';
    end if;
  end if;

  if NEW.archive is distinct from OLD.archive and OLD.role = 'proprietaire' and not transfer_bypass
     and acting_role is distinct from 'proprietaire' then
    raise exception 'Seul le Propriétaire peut archiver ou réactiver le Propriétaire.';
  end if;

  return NEW;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Délégations : tolérant aux données mal formées
-- ---------------------------------------------------------------------------
create or replace function is_manager_of(target_employee_id text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from employees target
    where target.id = target_employee_id
      and (
        current_employee_id() = any(target.manager_ids)
        or exists (
          select 1
          from employees mgr
          cross join lateral jsonb_array_elements(
            case when jsonb_typeof(mgr.data->'delegations') = 'array' then mgr.data->'delegations' else '[]'::jsonb end
          ) as d
          where mgr.id = any(target.manager_ids)
            and d->>'delegataireId' = current_employee_id()
            and safe_date(d->>'dateDebut') <= current_date
            and safe_date(d->>'dateFin') >= current_date
        )
      )
  );
$$;

create or replace function delegations_recues()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object('delegantId', e.id, 'dateDebut', d->>'dateDebut', 'dateFin', d->>'dateFin')),
    '[]'::jsonb
  )
  from employees e
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(e.data->'delegations') = 'array' then e.data->'delegations' else '[]'::jsonb end
  ) d
  where e.company_id = current_company_id()
    and not e.archive
    and current_employee_id() is not null
    and d->>'delegataireId' = current_employee_id()
    and safe_date(d->>'dateDebut') is not null
    and safe_date(d->>'dateFin') is not null;
$$;

-- ---------------------------------------------------------------------------
-- 5. Candidatures : le statut ne revient plus en arrière et une candidature traitée l'est une fois
-- ---------------------------------------------------------------------------
create or replace function set_candidature_statut(p_id uuid, p_statut text, p_employee_id text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id text;
  v_statut_actuel text;
begin
  select company_id, statut into v_company_id, v_statut_actuel from candidatures where id = p_id;
  if v_company_id is null or v_company_id <> current_company_id() then
    raise exception 'Candidature introuvable.';
  end if;
  if not has_permission('creerSalarie') then
    raise exception 'Permission refusée.';
  end if;
  if p_statut not in ('nouvelle', 'entretien', 'offre', 'embauchee', 'archivee') then
    raise exception 'Statut invalide.';
  end if;
  -- Embaucher ou archiver n'est possible que depuis une candidature encore en cours (nouvelle, entretien, offre).
  if p_statut in ('embauchee', 'archivee') and v_statut_actuel not in ('nouvelle', 'entretien', 'offre') then
    raise exception 'Cette candidature a déjà été traitée.';
  end if;
  -- Un « Avancer » périmé ne repasse jamais une candidature embauchée ou archivée en cours de pipeline
  -- (ce qui effaçait aussi son employee_id).
  if p_statut in ('entretien', 'offre') and v_statut_actuel in ('embauchee', 'archivee') then
    raise exception 'Cette candidature a déjà été traitée.';
  end if;
  update candidatures set statut = p_statut, employee_id = p_employee_id, updated_at = now() where id = p_id;
end;
$$;

insert into schema_migrations (version) values ('0070_durcissement_revue_13_10') on conflict do nothing;

commit;

notify pgrst, 'reload schema';
