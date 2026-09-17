-- Seven RH — retour Betty du 17/09/2026 (point 3, lettre "quatre points constatés en utilisant la
-- fiche salarié") : "les matricules sont mélangés" — une entreprise peut avoir des salariés au
-- format ancien (ex. SRH-0001) et au nouveau format AAAA-NNNN (0040_matricule_atomique.sql) côte à
-- côte, jamais harmonisés puisque cette migration corrigeait UNIQUEMENT les vrais doublons, pas le
-- format des matricules existants déjà uniques (voir son commentaire d'en-tête, point "Ce que cette
-- migration NE fait PAS").
--
-- ⚠️ Renumériser TOUS les matricules d'une entreprise en une fois est une opération sensible : ces
-- numéros apparaissent déjà sur des documents émis (bulletins de paie, attestations, exports envoyés
-- au comptable...). Cette migration ne fait qu'ajouter la CAPACITÉ technique de renumériser (une
-- fonction serveur dédiée, réservée à RH/Propriétaire, avec trace complète dans le journal d'audit
-- ancien → nouveau) — le bouton correspondant côté écran (app.js), lui, affiche un avertissement
-- explicite avant tout déclenchement et ne l'exécute jamais automatiquement.
--
-- Obstacle technique à lever : employees_matricule_immutable (0040) bloque par construction TOUTE
-- modification d'un matricule déjà attribué — protection volontaire contre une régression accidentelle
-- (ex. un futur correctif qui recalculerait le matricule à chaque sauvegarde). Plutôt que de
-- supprimer cette protection, le trigger apprend à reconnaître un unique contexte d'exception : la
-- fonction renumber_company_matricules ci-dessous, via un paramètre de session local à sa propre
-- transaction (set_config(..., is_local => true) — jamais persistant, jamais visible d'une autre
-- session/requête). Aucun autre chemin de code, y compris une simple UPDATE manuelle depuis le
-- tableau de bord Supabase, ne peut donc changer un matricule déjà attribué.

-- ---------------------------------------------------------------------------
-- 1. Le trigger d'immuabilité laisse passer UNIQUEMENT l'exception ci-dessous, jamais d'autre cas.
-- ---------------------------------------------------------------------------
create or replace function prevent_matricule_change()
returns trigger
language plpgsql
as $$
begin
  if old.matricule is not null and old.matricule <> '' and new.matricule is distinct from old.matricule
     and coalesce(current_setting('sevenrh.allow_matricule_renumbering', true), 'off') <> 'on' then
    raise exception 'Le matricule ne peut pas être modifié une fois attribué (%).', old.matricule;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Renumérotation complète, par ordre chronologique d'embauche (comme une création normale, voir
--    assign_matricule_number/0040) : repart d'une séquence à zéro par année pour cette seule
--    entreprise, jamais les autres (matricule_counters est déjà scindé par company_id). Le séparateur
--    (tiret ou non) est fourni par le client (settings.matriculeAvecTiret, purement cosmétique, voir
--    formatMatricule côté data.js) plutôt que réinventé ici.
-- ---------------------------------------------------------------------------
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
begin
  if current_company_id() is distinct from p_company_id then
    raise exception 'Non autorisé.';
  end if;
  v_role := current_role_name();
  if v_role is null or v_role not in ('rh', 'proprietaire') then
    raise exception 'Non autorisé.';
  end if;

  -- Local à CETTE transaction uniquement (is_local => true) : redevient 'off' dès le retour de la
  -- fonction, jamais laissé actif pour une requête suivante sur la même connexion poolée.
  perform set_config('sevenrh.allow_matricule_renumbering', 'on', true);

  delete from matricule_counters where company_id = p_company_id;

  for r in
    select e.id, e.matricule as ancien,
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

    if r.ancien is distinct from v_new_matricule then
      update employees set matricule = v_new_matricule where id = r.id;
      insert into audit_log (id, company_id, date, action, entite, cible, details)
        values (gen_random_uuid()::text, p_company_id, now(), 'Modification', 'Salarié', r.id,
          'Matricule renuméroté (harmonisation manuelle du format, demandée depuis Paramètres) : '
            || coalesce(nullif(r.ancien, ''), '(aucun)') || ' -> ' || v_new_matricule);
    end if;

    employee_id := r.id;
    ancien_matricule := r.ancien;
    nouveau_matricule := v_new_matricule;
    return next;
  end loop;
end;
$$;

revoke all on function renumber_company_matricules(text, boolean) from public, anon, authenticated;
grant execute on function renumber_company_matricules(text, boolean) to authenticated;

insert into schema_migrations (version) values ('0058_renumerotation_matricules') on conflict do nothing;
