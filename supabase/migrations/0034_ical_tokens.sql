-- Seven RH — jetons d'abonnement calendrier iCal (audit du 23/08/2026, §7.19).
--
-- Contexte : "Les absences validées n'apparaissent nulle part dans Outlook ou Google Agenda. Un
-- flux d'abonnement en lecture seule, par salarié et par équipe." Outlook/Google Agenda
-- s'abonnent par une simple requête GET périodique, SANS EN-TÊTE D'AUTHENTIFICATION — le jeton
-- doit donc suffire à lui seul comme preuve d'autorisation dans l'URL elle-même.
--
-- ⚠️ Choix de sécurité important : le jeton vit dans une table DÉDIÉE (ical_tokens), jamais comme
-- colonne sur `employees`. La quasi-totalité de l'application lit déjà `employees` via
-- `select('*')` (hydrateCurrentCompany, supabase-client.js) — un jeton stocké là aurait fui dans le
-- cache local de TOUT manager/RH voyant la liste de ses salariés, permettant à n'importe qui de
-- s'abonner silencieusement au calendrier personnel de n'importe quel collègue. `ical_tokens` reste
-- RLS activé SANS AUCUNE POLICY (comme `settings` en phase 1) : ni anon ni authenticated ne peut la
-- lire ou l'écrire directement, y compris son propre jeton — seule la fonction Edge "calendar-feed"
-- (clé service-role) et la RPC ci-dessous (qui ne renvoie QUE le jeton de l'appelant) y touchent.

begin;

create table ical_tokens (
  employee_id text primary key references employees(id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  created_at timestamptz not null default now()
);

alter table ical_tokens enable row level security;
-- Aucune policy : accès exclusivement via service-role (fonction Edge) et la fonction ci-dessous.

-- Renvoie (en le créant si besoin) le jeton d'abonnement calendrier de L'APPELANT — jamais celui de
-- quelqu'un d'autre, y compris pour un RH/Propriétaire : chacun gère uniquement son propre lien
-- personnel. Le lien "équipe" (scope=equipe côté fonction Edge) réutilise CE MÊME jeton avec un
-- paramètre différent — la fonction Edge vérifie alors elle-même, côté serveur, que le rôle du
-- titulaire du jeton donne bien droit à une vue équipe/entreprise avant de renvoyer quoi que ce
-- soit de plus qu'un calendrier personnel.
create or replace function get_or_create_ical_token()
returns text
language plpgsql security definer set search_path = public
as $$
declare
  emp_id text := current_employee_id();
  existing_token text;
begin
  if emp_id is null then
    raise exception 'Non authentifié.';
  end if;

  select token into existing_token from ical_tokens where employee_id = emp_id;
  if existing_token is not null then
    return existing_token;
  end if;

  insert into ical_tokens (employee_id) values (emp_id)
    on conflict (employee_id) do nothing;
  select token into existing_token from ical_tokens where employee_id = emp_id;
  return existing_token;
end;
$$;

revoke all on function get_or_create_ical_token() from public;
grant execute on function get_or_create_ical_token() to authenticated;

-- Permet de révoquer un lien déjà partagé par erreur (ex. copié dans un message envoyé au mauvais
-- endroit) : en régénère un nouveau, l'ancien devient immédiatement invalide (calendar-feed ne
-- trouve alors plus de correspondance). Toute application existante devra se réabonner avec le
-- nouveau lien — c'est le comportement voulu d'une révocation.
create or replace function regenerate_ical_token()
returns text
language plpgsql security definer set search_path = public
as $$
declare
  emp_id text := current_employee_id();
  new_token text;
begin
  if emp_id is null then
    raise exception 'Non authentifié.';
  end if;

  delete from ical_tokens where employee_id = emp_id;
  insert into ical_tokens (employee_id) values (emp_id);
  select token into new_token from ical_tokens where employee_id = emp_id;
  return new_token;
end;
$$;

revoke all on function regenerate_ical_token() from public;
grant execute on function regenerate_ical_token() to authenticated;

commit;
