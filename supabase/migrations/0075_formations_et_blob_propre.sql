-- Seven RH — module Formation (retour du 21/10/2026) et nettoyage du bloc entreprise.
--
-- 1. Table formations : demandes de formation d'un salarié (financée par l'entreprise ou via le CPF), décidées par son manager ou un
--    compte ayant « gererEntretiens » (RH, propriétaire) : même répartition des droits que les entretiens, dont les besoins de
--    formation sont déjà issus. Un déclencheur verrouille ce que chacun peut changer (le salarié ne peut pas se donner son propre accord).
-- 2. Nettoyage : jusqu'ici le site recopiait dans companies.data (lisible par tout salarié via l'API) les entretiens, les tickets support,
--    les idées et les licences de modules, qui ont pourtant leurs propres tables protégées. Le site ne les y envoie plus ; ce déclencheur
--    les retire de toute écriture, et le rattrapage purge ce qui s'y trouve déjà.

begin;

-- ---------------------------------------------------------------------------
-- 1. Table et droits
-- ---------------------------------------------------------------------------
create table if not exists formations (
  id text primary key default gen_random_uuid()::text,
  company_id text not null references companies(id) on delete cascade,
  employee_id text not null references employees(id) on delete cascade,
  intitule text not null,
  organisme text,
  financement text not null default 'entreprise' check (financement in ('entreprise', 'cpf')),
  pendant_temps_travail boolean not null default true,
  date_debut date,
  date_fin date,
  duree_heures numeric check (duree_heures is null or duree_heures >= 0),
  cout_estime numeric check (cout_estime is null or cout_estime >= 0),
  lien text,
  motif text,
  statut text not null default 'demandee' check (statut in ('demandee', 'acceptee', 'refusee', 'realisee', 'annulee')),
  decision_par text,
  decision_date timestamptz,
  decision_motif text,
  historique jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists formations_company_employee_idx on formations (company_id, employee_id);

alter table formations enable row level security;

drop policy if exists formations_select on formations;
create policy formations_select on formations for select
  using (
    company_id = current_company_id()
    and (employee_id = current_employee_id() or is_manager_of(employee_id) or has_permission('gererEntretiens'))
  );

-- Un salarié ne crée qu'une demande à son nom, au statut « demandée », sans décision ; RH/propriétaire peuvent saisir pour un salarié.
drop policy if exists formations_insert on formations;
create policy formations_insert on formations for insert
  with check (
    company_id = current_company_id()
    and (
      has_permission('gererEntretiens')
      or (employee_id = current_employee_id() and statut = 'demandee' and decision_par is null and decision_date is null)
    )
  );

drop policy if exists formations_update on formations;
create policy formations_update on formations for update
  using (
    company_id = current_company_id()
    and (employee_id = current_employee_id() or is_manager_of(employee_id) or has_permission('gererEntretiens'))
  )
  with check (company_id = current_company_id());

drop policy if exists formations_delete on formations;
create policy formations_delete on formations for delete
  using (
    company_id = current_company_id()
    and (has_permission('gererEntretiens') or (employee_id = current_employee_id() and statut = 'demandee'))
  );

-- ---------------------------------------------------------------------------
-- 2. Garde : qui peut changer quoi
-- ---------------------------------------------------------------------------
create or replace function formations_garde()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  moi text := current_employee_id();
  est_decideur boolean;
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    return new;
  end if;
  -- Hors utilisateur connecté (éditeur SQL, maintenance) : aucune restriction.
  if auth.uid() is null then
    return new;
  end if;

  if new.employee_id is distinct from old.employee_id or new.company_id is distinct from old.company_id then
    raise exception 'Une demande de formation ne change ni de salarié ni d''entreprise.';
  end if;

  est_decideur := has_permission('gererEntretiens') or is_manager_of(old.employee_id);

  if not est_decideur then
    -- Le salarié seul : il corrige sa demande tant qu'elle n'est pas décidée, ou l'annule ; jamais de décision.
    if new.decision_par is distinct from old.decision_par
       or new.decision_date is distinct from old.decision_date
       or new.decision_motif is distinct from old.decision_motif then
      raise exception 'Seul le manager ou le RH peut décider d''une demande de formation.';
    end if;
    if new.statut is distinct from old.statut and not (new.statut = 'annulee' and old.statut in ('demandee', 'acceptee')) then
      raise exception 'Vous pouvez seulement annuler votre demande.';
    end if;
    if old.statut <> 'demandee' and (
         new.intitule is distinct from old.intitule or new.organisme is distinct from old.organisme
         or new.financement is distinct from old.financement or new.date_debut is distinct from old.date_debut
         or new.date_fin is distinct from old.date_fin or new.cout_estime is distinct from old.cout_estime
         or new.duree_heures is distinct from old.duree_heures) then
      raise exception 'Cette demande a déjà été traitée : elle ne peut plus être modifiée.';
    end if;
    return new;
  end if;

  -- Décideur : jamais sur sa propre demande (sauf propriétaire, comme pour les congés), et la décision est signée par le serveur.
  if new.statut is distinct from old.statut and new.statut in ('acceptee', 'refusee', 'realisee') then
    if old.employee_id = moi and current_role_name() is distinct from 'proprietaire' then
      raise exception 'Vous ne pouvez pas décider de votre propre demande de formation.';
    end if;
    if new.statut in ('acceptee', 'refusee') then
      new.decision_par := moi;
      new.decision_date := now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists formations_garde_trg on formations;
create trigger formations_garde_trg
  before insert or update on formations
  for each row execute function formations_garde();

-- ---------------------------------------------------------------------------
-- 3. Bloc entreprise : plus de données qui ont leur propre table
-- ---------------------------------------------------------------------------
create or replace function companies_retirer_donnees_de_tables()
returns trigger
language plpgsql
as $$
begin
  if new.data is not null and jsonb_typeof(new.data) = 'object' then
    new.data := new.data - 'supportTickets' - 'entretiens' - 'idees' - 'moduleLicenses' - 'formations';
  end if;
  return new;
end;
$$;

drop trigger if exists companies_retirer_donnees_trg on companies;
create trigger companies_retirer_donnees_trg
  before insert or update of data on companies
  for each row execute function companies_retirer_donnees_de_tables();

-- Rattrapage : purge ce qui a déjà été recopié dans le bloc.
update companies set data = data
 where data ?| array['supportTickets', 'entretiens', 'idees', 'moduleLicenses', 'formations'];

notify pgrst, 'reload schema';

insert into schema_migrations (version) values ('0075_formations_et_blob_propre') on conflict do nothing;

commit;
