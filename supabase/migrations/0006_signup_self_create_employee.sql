-- Seven RH — création complète en libre-service : si aucune fiche salarié n'existe pour l'email,
-- le trigger en crée une nouvelle (rôle "salarie" par défaut, modifiable ensuite par RH/Directeur)
-- au lieu d'exiger qu'elle existe déjà. Remplace le trigger de 0005 (lier seulement) par une
-- version qui lie SI une fiche existe, sinon crée.
--
-- nom/prénom transmis via les métadonnées du compte Supabase Auth (options.data au signUp côté
-- client, voir supabase-client.js) — accessibles ici via new.raw_user_meta_data, hors RLS puisque
-- ce trigger est security definer.
--
-- Hypothèse : un déploiement = une seule entreprise (cohérent avec la suppression du sélecteur
-- d'entreprise avant connexion, Phase 3) — la nouvelle fiche rejoint la seule entreprise existante.

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
begin
  update employees
  set auth_user_id = new.id
  where lower(email) = lower(new.email) and auth_user_id is null
  returning id into linked_id;

  if linked_id is not null then
    return new;
  end if;

  meta_nom := coalesce(new.raw_user_meta_data->>'nom', '');
  meta_prenom := coalesce(new.raw_user_meta_data->>'prenom', '');

  select id into target_company_id from companies limit 1;

  if target_company_id is not null and meta_nom <> '' and meta_prenom <> '' then
    insert into employees (company_id, auth_user_id, email, role, nom, prenom)
    values (target_company_id, new.id, new.email, 'salarie', meta_nom, meta_prenom);
  end if;

  return new;
end;
$$;
