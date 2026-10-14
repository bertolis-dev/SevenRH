-- Seven RH — la rémunération n'est plus lisible par l'API que par qui a le droit (point en attente de la revue du 13/10/2026).
--
-- Constat : le salaire, son historique, les primes, la part variable et les avantages en nature (sur la fiche, dans chaque
-- contrat, dans les avenants) vivaient dans employees.data, que lit toute personne pouvant lire la fiche (le RH, le manager
-- pour son équipe). L'écran les masquait déjà, mais un appel direct à l'API les renvoyait. Les propositions de révision
-- salariale (companies.data) étaient lisibles par toute l'entreprise.
--
-- Remède, côté serveur, sans que l'écriture du site change :
--   1. deux tables à part, lisibles seulement avec « voirInfosFinancieres » (et, pour un salarié, sa propre ligne) :
--      employee_remuneration (une ligne par salarié) et company_remuneration (les campagnes de révision salariale) ;
--   2. des déclencheurs qui, à CHAQUE écriture d'une fiche ou du bloc entreprise, sortent ces données du JSON public et les
--      rangent dans ces tables, SI l'auteur de l'écriture a le droit « voirInfosFinancieres » (ou s'il n'y a pas
--      d'utilisateur connecté : éditeur SQL, migration). Sinon les valeurs envoyées sont ignorées (un compte sans ce droit
--      ne peut ni lire ni modifier les salaires) et la valeur déjà enregistrée reste intacte ;
--   3. un rattrapage qui range tout de suite ce qui existe déjà.
-- Le site lit ensuite ces tables en plus de la fiche (supabase-client.js) ; un ancien site resté ouvert perd simplement
-- l'affichage des salaires jusqu'au rechargement.

begin;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists employee_remuneration (
  employee_id text primary key references employees(id) on delete cascade deferrable initially deferred,
  company_id text not null references companies(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists company_remuneration (
  company_id text primary key references companies(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table employee_remuneration enable row level security;
alter table company_remuneration enable row level security;

-- Lecture seule pour les utilisateurs : toute écriture passe par les déclencheurs ci-dessous (security definer).
revoke all on employee_remuneration from anon, authenticated;
revoke all on company_remuneration from anon, authenticated;
grant select on employee_remuneration to authenticated;
grant select on company_remuneration to authenticated;

drop policy if exists employee_remuneration_select on employee_remuneration;
create policy employee_remuneration_select on employee_remuneration for select
  using (
    company_id = current_company_id()
    and (employee_id = current_employee_id() or has_permission('voirInfosFinancieres'))
  );

drop policy if exists company_remuneration_select on company_remuneration;
create policy company_remuneration_select on company_remuneration for select
  using (company_id = current_company_id() and has_permission('voirInfosFinancieres'));

-- ---------------------------------------------------------------------------
-- 2. Séparation d'une fiche : retourne (v_public, v_prive)
-- ---------------------------------------------------------------------------
-- v_prive = { <clé de fiche>: valeur, ..., "contrats": { <id de contrat>: {clés de rémunération} },
--             "avenants": { <id d'avenant>: nouvelleValeur } }
create or replace function remuneration_separer(p_data jsonb, out v_public jsonb, out v_prive jsonb)
language plpgsql
immutable
as $$
declare
  cles_fiche text[] := array['salaireBrutMensuel', 'historiqueSalaire', 'nombreMoisSalaire', 'primesRecurrentes', 'partVariable', 'avantagesNature'];
  cles_contrat text[] := array['salaireBrutMensuel', 'nombreMoisSalaire', 'primesRecurrentes', 'partVariable', 'avantagesNature'];
  k text;
  c jsonb;
  a jsonb;
  cp jsonb;
  par_contrat jsonb := '{}'::jsonb;
  par_avenant jsonb := '{}'::jsonb;
  contrats jsonb := '[]'::jsonb;
  avenants jsonb := '[]'::jsonb;
begin
  v_public := coalesce(p_data, '{}'::jsonb);
  v_prive := '{}'::jsonb;
  if jsonb_typeof(v_public) <> 'object' then
    v_public := '{}'::jsonb;
  end if;

  foreach k in array cles_fiche loop
    if v_public ? k then
      v_prive := v_prive || jsonb_build_object(k, v_public->k);
      v_public := v_public - k;
    end if;
  end loop;

  if jsonb_typeof(v_public->'contrats') = 'array' then
    for c in select value from jsonb_array_elements(v_public->'contrats') loop
      if jsonb_typeof(c) = 'object' then
        cp := '{}'::jsonb;
        foreach k in array cles_contrat loop
          if c ? k then
            cp := cp || jsonb_build_object(k, c->k);
            c := c - k;
          end if;
        end loop;
        if cp <> '{}'::jsonb and c->>'id' is not null then
          par_contrat := par_contrat || jsonb_build_object(c->>'id', cp);
        end if;
      end if;
      contrats := contrats || jsonb_build_array(c);
    end loop;
    v_public := jsonb_set(v_public, '{contrats}', contrats);
    if par_contrat <> '{}'::jsonb then
      v_prive := v_prive || jsonb_build_object('contrats', par_contrat);
    end if;
  end if;

  if jsonb_typeof(v_public->'avenants') = 'array' then
    for a in select value from jsonb_array_elements(v_public->'avenants') loop
      if jsonb_typeof(a) = 'object'
         and (a->>'champModifie') = any(cles_fiche)
         and a->>'id' is not null
         and coalesce(jsonb_typeof(a->'nouvelleValeur'), 'null') <> 'null' then
        par_avenant := par_avenant || jsonb_build_object(a->>'id', a->'nouvelleValeur');
        a := a || jsonb_build_object('nouvelleValeur', null);
      end if;
      avenants := avenants || jsonb_build_array(a);
    end loop;
    v_public := jsonb_set(v_public, '{avenants}', avenants);
    if par_avenant <> '{}'::jsonb then
      v_prive := v_prive || jsonb_build_object('avenants', par_avenant);
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Déclencheur sur employees
-- ---------------------------------------------------------------------------
create or replace function employees_separer_remuneration()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sep record;
  existant jsonb;
begin
  if new.data is null then
    return new;
  end if;
  select * into sep from remuneration_separer(new.data);
  new.data := sep.v_public;
  if sep.v_prive = '{}'::jsonb then
    return new;
  end if;
  -- Sans utilisateur connecté (éditeur SQL, migration) : de confiance. Avec un utilisateur : il faut le droit.
  if auth.uid() is not null and not has_permission('voirInfosFinancieres') then
    return new;
  end if;
  select data into existant from employee_remuneration where employee_id = new.id;
  insert into employee_remuneration (employee_id, company_id, data)
  values (new.id, new.company_id, coalesce(existant, '{}'::jsonb) || sep.v_prive)
  on conflict (employee_id) do update set data = excluded.data, updated_at = now();
  return new;
end;
$$;

drop trigger if exists employees_separer_remuneration_trg on employees;
create trigger employees_separer_remuneration_trg
  before insert or update of data on employees
  for each row execute function employees_separer_remuneration();

-- ---------------------------------------------------------------------------
-- 4. Déclencheur sur companies (campagnes de révision salariale)
-- ---------------------------------------------------------------------------
create or replace function companies_separer_remuneration()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  existant jsonb;
begin
  if new.data is null or not (new.data ? 'campagnesRevisionSalariale') then
    return new;
  end if;
  if auth.uid() is null or has_permission('voirInfosFinancieres') then
    select data into existant from company_remuneration where company_id = new.id;
    insert into company_remuneration (company_id, data)
    values (new.id, coalesce(existant, '{}'::jsonb) || jsonb_build_object('campagnesRevisionSalariale', new.data->'campagnesRevisionSalariale'))
    on conflict (company_id) do update set data = excluded.data, updated_at = now();
  end if;
  new.data := new.data - 'campagnesRevisionSalariale';
  return new;
end;
$$;

drop trigger if exists companies_separer_remuneration_trg on companies;
create trigger companies_separer_remuneration_trg
  before update of data on companies
  for each row execute function companies_separer_remuneration();

-- ---------------------------------------------------------------------------
-- 5. Rattrapage : range tout de suite ce qui existe déjà (les déclencheurs s'en chargent, sans utilisateur connecté)
-- ---------------------------------------------------------------------------
update employees set data = data;
update companies set data = data where data ? 'campagnesRevisionSalariale';

notify pgrst, 'reload schema';

insert into schema_migrations (version) values ('0074_remuneration_separee') on conflict do nothing;

commit;
