-- Seven RH — corrige le bug des matricules dupliqués (retour QA du 27/08/2026) : company.matriculeSeq
-- était un compteur EN MÉMOIRE, incrémenté par addEmployee (data.js) mais jamais persisté par
-- saveEmployees (seul saveCompanyProfile le pousse vers Supabase, jamais appelé à la création d'un
-- salarié) — donc réinitialisé à chaque nouvelle session/appareil, produisant des matricules
-- dupliqués dès que deux salariés étaient créés depuis des sessions différentes.
--
-- Priorité annoncée à l'entreprise : corriger la numérotation et garantir l'unicité D'ABORD, le
-- format ensuite (« le format vient après, il ne sert à rien de bien formater des numéros qui se
-- dupliquent »). Cette migration :
--   1. Crée un compteur atomique côté serveur, par (entreprise, année d'embauche) — voir
--      assign_matricule_number ci-dessous, appelé depuis DB.assignMatricule (data.js) à la création
--      d'un salarié. Plus aucun calcul de numérotation côté client.
--   2. Corrige automatiquement les VRAIS doublons déjà présents en base aujourd'hui (garde le
--      salarié le plus ancien de chaque groupe en doublon inchangé, renumérote les autres au nouveau
--      format AAAA-NNNN) — journalisé dans audit_log pour traçabilité.
--   3. Ajoute un index unique (company_id, matricule) : la base elle-même refuse désormais tout
--      nouveau doublon, ce qui n'était garanti par rien jusqu'ici.
--   4. Rend le matricule immuable une fois attribué (trigger) — défense en profondeur, en plus du
--      formulaire d'édition côté client qui ne l'expose plus en écriture.
--
-- Ce que cette migration NE fait PAS : renumériser tout l'historique existant dans le nouveau format
-- AAAA-NNNN (seuls les VRAIS doublons sont corrigés ci-dessous). Les matricules "SRH-NNNN" existants,
-- déjà uniques, restent tels quels — les mélanger avec le nouveau format au sein d'une même
-- entreprise est un compromis accepté (voir aussi le mode « conserver les matricules du fichier » de
-- l'import Excel, qui produit la même situation). Une renumérotation complète volontaire (ex. pour
-- harmoniser l'affichage) resterait une opération séparée, à ne lancer qu'après en avoir informé les
-- clients concernés (les matricules apparaissent sur les bulletins de paie et documents déjà émis).

-- ---------------------------------------------------------------------------
-- 1. Compteur atomique par (entreprise, année d'embauche)
-- ---------------------------------------------------------------------------
create table if not exists matricule_counters (
  company_id text not null references companies(id) on delete cascade,
  year int not null,
  last_number int not null default 0,
  primary key (company_id, year)
);

-- RLS activée sans aucune policy : cette table n'est jamais lue/écrite directement par un client
-- (anon ou authenticated), uniquement via assign_matricule_number ci-dessous (security definer,
-- propriétaire de la fonction = bypass RLS par défaut sur Postgres/Supabase).
alter table matricule_counters enable row level security;

-- Simple compteur mono-ligne : contrairement à check_candidature_rate_limit (0031, qui agrège un
-- COUNT sur plusieurs lignes et a donc besoin d'un verrou consultatif explicite), l'unicité voulue
-- ici tient tout entière dans le UPSERT ci-dessous — le verrou de ligne implicite d'INSERT ... ON
-- CONFLICT suffit à sérialiser les appels concurrents sur la même (company_id, year), sans avoir
-- besoin d'un pg_advisory_xact_lock en plus.
create or replace function assign_matricule_number(p_company_id text, p_year int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number int;
begin
  insert into matricule_counters (company_id, year, last_number)
    values (p_company_id, p_year, 1)
  on conflict (company_id, year) do update set last_number = matricule_counters.last_number + 1
  returning last_number into v_number;
  return v_number;
end;
$$;

revoke all on function assign_matricule_number(text, int) from public;
grant execute on function assign_matricule_number(text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Corrige les VRAIS doublons déjà présents en base (jamais une renumérotation complète — voir
--    l'en-tête de ce fichier). Pour chaque groupe (company_id, matricule) en collision, la ligne la
--    plus ancienne (date d'embauche, ou date de création si absente/invalide) garde son matricule
--    actuel ; les suivantes reçoivent un nouveau matricule au format AAAA-NNNN, journalisé.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_prev_company text := null;
  v_prev_matricule text := null;
  v_year int;
  v_seq int;
  v_new_matricule text;
begin
  for r in
    select e.id, e.company_id, e.matricule, e.created_at,
      coalesce(nullif(e.data->>'dateEmbauche', ''), to_char(e.created_at, 'YYYY-MM-DD')) as hire_date_text
    from employees e
    where e.matricule is not null and e.matricule <> ''
    order by e.company_id, e.matricule,
      coalesce(nullif(e.data->>'dateEmbauche', ''), to_char(e.created_at, 'YYYY-MM-DD')) asc,
      e.created_at asc
  loop
    if r.company_id = v_prev_company and r.matricule = v_prev_matricule then
      -- Doublon réel : cette ligne n'est pas la plus ancienne de son groupe (company_id, matricule).
      v_year := coalesce((substring(r.hire_date_text from '^\d{4}'))::int, extract(year from r.created_at)::int);
      v_seq := assign_matricule_number(r.company_id, v_year);
      v_new_matricule := v_year::text || '-' || lpad(v_seq::text, 4, '0');
      update employees set matricule = v_new_matricule where id = r.id;
      insert into audit_log (id, company_id, date, action, entite, cible, details)
        values (gen_random_uuid()::text, r.company_id, now(), 'Modification', 'Salarié', r.id,
          'Matricule corrigé automatiquement (doublon détecté, migration 0040_matricule_atomique) : '
            || r.matricule || ' -> ' || v_new_matricule);
    end if;
    v_prev_company := r.company_id;
    v_prev_matricule := r.matricule;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Unicité garantie par la base — index partiel : matricule reste nullable pour des lignes
--    historiques/legacy sans matricule (voir supabase/test/seed_test_data.sql, l'ancien trigger de
--    jointure par domaine neutralisé par 0014), jamais bloquant pour ces cas déjà existants.
-- ---------------------------------------------------------------------------
create unique index if not exists employees_company_matricule_unique
  on employees (company_id, matricule)
  where matricule is not null and matricule <> '';

-- ---------------------------------------------------------------------------
-- 4. Immuabilité — défense en profondeur en plus du formulaire d'édition (app.js) qui n'expose plus
--    le matricule en écriture après création. Autorise le passage de vide/NULL vers une valeur (la
--    toute première attribution) mais jamais le remplacement d'une valeur déjà attribuée par une
--    autre — créée APRÈS le correctif de doublons ci-dessus pour ne jamais le bloquer.
-- ---------------------------------------------------------------------------
create or replace function prevent_matricule_change()
returns trigger
language plpgsql
as $$
begin
  if old.matricule is not null and old.matricule <> '' and new.matricule is distinct from old.matricule then
    raise exception 'Le matricule ne peut pas être modifié une fois attribué (%).', old.matricule;
  end if;
  return new;
end;
$$;

drop trigger if exists employees_matricule_immutable on employees;
create trigger employees_matricule_immutable
  before update on employees
  for each row
  execute function prevent_matricule_change();
