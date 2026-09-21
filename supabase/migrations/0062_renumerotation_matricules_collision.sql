-- Seven RH — retour Betty du 22/09/2026 : "Renumérotation impossible (duplicate key value violates
-- unique constraint employees_company_matricule_unique). Aucun matricule n'a été modifié."
--
-- La migration 0058 est bien installée et la fonction s'exécute : le défaut est dans la fonction
-- elle-même. Elle réattribue les matricules UN PAR UN, avec un UPDATE par salarié. Or
-- employees_company_matricule_unique (0040) est un index unique PARTIEL, vérifié immédiatement à
-- chaque ligne : il suffit que le nouveau matricule d'un salarié soit, à cet instant précis, encore
-- porté par un salarié pas encore traité pour que la transaction entière échoue.
--
-- Cas réel chez Seven Sept, deux salariés embauchés la même année :
--   A, embauché en mars, porte 2022-0002
--   B, embauché en mai,  porte 2022-0001
-- Traités par ordre d'embauche, A doit devenir 2022-0001, que B détient encore. Collision.
-- Ce n'est pas un cas limite : dès que l'ordre chronologique ne coïncide pas avec l'ordre des
-- numéros déjà attribués, la renumérotation échoue. C'est exactement la situation qu'elle cherche à
-- corriger (formats mélangés « SRH-0001 » et « 2022-0002 »), donc l'échec est la règle plutôt que
-- l'exception, et le bouton n'a jamais pu fonctionner chez un client réel.
--
-- Un index unique PARTIEL ne peut pas être différé (seule une CONTRAINTE non partielle accepte
-- DEFERRABLE) : la parade est de procéder en deux temps dans la même transaction. D'abord une
-- valeur temporaire unique par construction et impossible à confondre avec un vrai matricule,
-- ensuite la valeur définitive. L'état intermédiaire ne survit pas à la fonction, et un échec
-- quelconque annule tout, puisque l'ensemble tient dans une seule transaction.
--
-- Le reste de 0058 est conservé à l'identique : mêmes contrôles d'autorisation, même ordre
-- chronologique d'embauche, même journalisation ancien vers nouveau, même exception au trigger
-- d'immuabilité, même valeur de retour pour le client (DB.renumberMatricules, data.js).

create or replace function renumber_company_matricules(p_company_id text, p_avec_tiret boolean)
returns table(employee_id text, ancien_matricule text, nouveau_matricule text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  r record;
  v_year int;
  v_seq int;
  v_new_matricule text;
  v_ancien text;
  v_anciens jsonb;
begin
  if current_company_id() is distinct from p_company_id then
    raise exception 'Non autorisé.';
  end if;
  v_role := current_role_name();
  if v_role is null or v_role not in ('rh', 'proprietaire') then
    raise exception 'Non autorisé.';
  end if;

  -- Local à CETTE transaction uniquement (is_local => true), comme dans 0058 : redevient 'off' dès
  -- le retour de la fonction, jamais laissé actif pour une requête suivante sur une connexion poolée.
  perform set_config('sevenrh.allow_matricule_renumbering', 'on', true);

  -- Les matricules d'origine sont relevés AVANT d'être libérés : le journal d'audit et la valeur
  -- rendue au client doivent montrer le vrai point de départ, jamais la valeur temporaire.
  select coalesce(jsonb_object_agg(e.id, coalesce(e.matricule, '')), '{}'::jsonb)
    into v_anciens
    from employees e
    where e.company_id = p_company_id;

  -- Temps 1 : libérer tous les matricules en place. L'id du salarié est déjà unique (clé primaire),
  -- et le préfixe '~renum~' ne peut correspondre à aucun matricule réel (formatMatricule, data.js,
  -- ne produit que des chiffres et un éventuel tiret). Plus aucune collision possible au temps 2,
  -- quel que soit l'ordre de traitement.
  update employees
    set matricule = '~renum~' || id
    where company_id = p_company_id
      and matricule is not null
      and matricule <> '';

  delete from matricule_counters where company_id = p_company_id;

  -- Temps 2 : attribution définitive, par ordre chronologique d'embauche, comme une création
  -- normale (assign_matricule_number, 0040).
  for r in
    select e.id,
      coalesce(nullif(e.data->>'dateEmbauche', ''), to_char(e.created_at, 'YYYY-MM-DD')) as hire_date_text
    from employees e
    where e.company_id = p_company_id
    order by
      coalesce(nullif(e.data->>'dateEmbauche', ''), to_char(e.created_at, 'YYYY-MM-DD')) asc,
      e.created_at asc
  loop
    v_year := coalesce((substring(r.hire_date_text from '^\d{4}'))::int, extract(year from now())::int);
    v_seq := assign_matricule_number(p_company_id, v_year);
    v_new_matricule := case
      when p_avec_tiret then v_year::text || '-' || lpad(v_seq::text, 4, '0')
      else v_year::text || lpad(v_seq::text, 4, '0')
    end;
    v_ancien := coalesce(v_anciens ->> r.id, '');

    -- Toujours mis à jour : la colonne porte la valeur temporaire à ce stade, jamais l'ancienne.
    update employees set matricule = v_new_matricule where id = r.id;

    -- Journalisé seulement si le matricule change RÉELLEMENT par rapport à son point de départ,
    -- pour ne pas noyer le journal d'un changement qui n'en est pas un.
    if v_ancien is distinct from v_new_matricule then
      insert into audit_log (id, company_id, date, action, entite, cible, details)
        values (gen_random_uuid()::text, p_company_id, now(), 'Modification', 'Salarié', r.id,
          'Matricule renuméroté (harmonisation manuelle du format, demandée depuis Paramètres) : '
            || coalesce(nullif(v_ancien, ''), '(aucun)') || ' -> ' || v_new_matricule);
    end if;

    employee_id := r.id;
    ancien_matricule := v_ancien;
    nouveau_matricule := v_new_matricule;
    return next;
  end loop;
end;
$$;

revoke all on function renumber_company_matricules(text, boolean) from public, anon, authenticated;
grant execute on function renumber_company_matricules(text, boolean) to authenticated;

insert into schema_migrations (version) values ('0062_renumerotation_matricules_collision') on conflict do nothing;
