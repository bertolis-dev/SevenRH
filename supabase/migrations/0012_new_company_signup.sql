-- Seven RH — auto-inscription d'une nouvelle entreprise (libre-service), restreinte jusqu'à
-- souscription d'une offre payante. Voir le plan associé pour le contexte complet.
--
-- Jusqu'ici, s'inscrire (renderSignupView / DB.signUp) ne pouvait que REJOINDRE une entreprise déjà
-- existante (trigger link_new_auth_user_to_employee, 0007) : aucun chemin ne créait une toute
-- nouvelle entreprise depuis un compte qui vient d'être créé. Cette migration ajoute ce chemin, via
-- une fonction security definer appelée en RPC (pas une Edge Function : l'appelant est directement
-- l'utilisateur qui s'inscrit, une transaction SQL classique garantit l'atomicité entreprise +
-- établissement + salarié + abonnement sans état à moitié créé si une étape échoue).

-- 1. Le trigger existant doit ignorer ce nouveau cas : signUp() le déclenche TOUJOURS en premier
--    (synchrone, même transaction que l'insertion dans auth.users) — sans ce garde-fou, il tenterait
--    de rattacher la personne à une entreprise existante par domaine d'email avant même que
--    create_company_self_service() ci-dessous ne s'exécute.
create or replace function link_new_auth_user_to_employee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  linked_id text;
  target_company_id text;
  meta_nom text;
  meta_prenom text;
  new_domain text;
begin
  if new.raw_user_meta_data->>'intent' = 'creer_entreprise' then
    return new;
  end if;

  update employees
  set auth_user_id = new.id
  where lower(email) = lower(new.email) and auth_user_id is null
  returning id into linked_id;

  if linked_id is not null then
    return new;
  end if;

  meta_nom := coalesce(new.raw_user_meta_data->>'nom', '');
  meta_prenom := coalesce(new.raw_user_meta_data->>'prenom', '');
  new_domain := lower(split_part(new.email, '@', 2));

  select id into target_company_id from companies order by created_at asc limit 1;

  if target_company_id is not null and meta_nom <> '' and meta_prenom <> ''
     and exists (
       select 1 from employees e
       where e.company_id = target_company_id
         and lower(split_part(e.email, '@', 2)) = new_domain
     )
  then
    insert into employees (company_id, auth_user_id, email, role, nom, prenom)
    values (target_company_id, new.id, new.email, 'salarie', meta_nom, meta_prenom);
  end if;

  return new;
end;
$$;

-- 2. Création de l'entreprise elle-même. Les infos (raison sociale, nom/prénom de l'administrateur)
--    sont lues depuis les métadonnées du compte (raw_user_meta_data) plutôt que passées en
--    paramètre : elles survivent ainsi à un éventuel délai de confirmation d'email (l'appel RPC peut
--    alors être retenté plus tard, une fois la session disponible, sans que le site ait besoin de
--    re-persister ces informations lui-même entre-temps, voir authRepository côté client).
--    Ne sème PAS les types de congés / vacances scolaires ici : ce sont de vraies listes JS
--    (seedLeaveTypes/seedSchoolHolidays, data.js) — les dupliquer en SQL créerait un risque de
--    désynchronisation ; le site les sème via les repositories normaux juste après, une fois la
--    fiche salarié créée (donc current_company_id() disponible pour ces appels-là).
create or replace function create_company_self_service()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  caller_email text;
  meta_raison_sociale text;
  meta_nom text;
  meta_prenom text;
  new_company_id text;
  new_etab_id text;
begin
  if caller_id is null then
    raise exception 'Non authentifié.';
  end if;

  if exists (select 1 from employees where auth_user_id = caller_id) then
    raise exception 'Ce compte est déjà associé à une entreprise.';
  end if;

  select email, raw_user_meta_data->>'raisonSociale', raw_user_meta_data->>'nom', raw_user_meta_data->>'prenom'
    into caller_email, meta_raison_sociale, meta_nom, meta_prenom
    from auth.users where id = caller_id;

  if coalesce(meta_raison_sociale, '') = '' or coalesce(meta_nom, '') = '' or coalesce(meta_prenom, '') = '' then
    raise exception 'Informations manquantes pour créer l''entreprise.';
  end if;

  insert into companies (raison_sociale, data)
    values (meta_raison_sociale, jsonb_build_object('matriculeSeq', 1))
    returning id into new_company_id;

  insert into etablissements (company_id, nom, principal, actif)
    values (new_company_id, 'Siège', true, true)
    returning id into new_etab_id;

  insert into employees (company_id, auth_user_id, email, role, nom, prenom, etablissement_id, matricule)
    values (new_company_id, caller_id, caller_email, 'directeur', meta_nom, meta_prenom, new_etab_id, 'SRH-0001');

  insert into subscriptions (company_id, offre, statut, nombre_salaries_max)
    values (new_company_id, 'essai', 'non_souscrit', 1);

  return new_company_id;
end;
$$;

revoke all on function create_company_self_service() from public;
grant execute on function create_company_self_service() to authenticated;
