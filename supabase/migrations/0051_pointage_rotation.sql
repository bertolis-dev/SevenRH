-- Seven RH — retour Betty du 14/09/2026 (revue concurrentielle, Pointeuse QR point 1, "empêcher le
-- pointage à distance") : le QR de pointage était fixe et encodait le secret de l'établissement en
-- clair. En plus d'être figeable par une simple photo, ce secret était lisible par N'IMPORTE QUEL
-- salarié de l'entreprise via etablissements_select (0002_rls_policies.sql, "lecture large" —
-- nécessaire pour d'autres champs de cette table, mais pas pour celui-ci) : un salarié malveillant
-- pouvait lire le jeton directement via l'API, sans même avoir besoin de photographier le QR une
-- seule fois.
--
-- Ce correctif retire le secret de etablissements.data et le déplace dans une table dédiée SANS
-- AUCUNE policy RLS pour authenticated/anon — seules les 3 fonctions security definer ci-dessous
-- peuvent le lire ou l'écrire, jamais un client, quel que soit son rôle. Le QR affiché encode un code
-- dérivé (HMAC du secret + fenêtre de 30 secondes), qui change automatiquement : une photo du QR
-- devient inutilisable après 30 à 60 secondes.

create extension if not exists pgcrypto;

create table pointage_secrets (
  etablissement_id text primary key references etablissements(id) on delete cascade,
  company_id text not null references companies(id) on delete cascade,
  secret text not null,
  updated_at timestamptz not null default now()
);

alter table pointage_secrets enable row level security;
-- Volontairement AUCUNE policy : ni select, ni insert, ni update, ni delete pour authenticated/anon.
-- Seules get_pointage_qr_code/verifier_pointage_code/regenerate_pointage_token (security definer,
-- donc hors RLS) peuvent atteindre cette table.

-- Migration des secrets déjà régénérés (0050) vers la nouvelle table, puis purge du champ historique
-- — il n'a plus aucun rôle depuis ce correctif et sa seule présence constituait la fuite décrite
-- ci-dessus.
insert into pointage_secrets (etablissement_id, company_id, secret)
select id, company_id, data->>'pointageToken' from etablissements
where data->>'pointageToken' is not null
on conflict (etablissement_id) do nothing;

update etablissements set data = data - 'pointageToken' where data ? 'pointageToken';

-- ---------------------------------------------------------------------------------------------
-- regenerate_pointage_token : remplace la version de 0050 pour écrire dans pointage_secrets au lieu
-- de etablissements.data. Même garde-fou de rôle (manager/rh/propriétaire, le même critère que
-- l'affichage du bouton "QR de pointage").
-- ---------------------------------------------------------------------------------------------
create or replace function regenerate_pointage_token(p_etablissement_id text, p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_company_id text;
begin
  select role into v_role from employees where id = current_employee_id();
  if v_role is null or v_role not in ('manager', 'rh', 'proprietaire') then
    raise exception 'Non autorisé.';
  end if;
  select company_id into v_company_id from etablissements
    where id = p_etablissement_id and company_id = current_company_id();
  if v_company_id is null then
    raise exception 'Établissement introuvable.';
  end if;
  insert into pointage_secrets (etablissement_id, company_id, secret, updated_at)
  values (p_etablissement_id, v_company_id, p_token, now())
  on conflict (etablissement_id) do update set secret = excluded.secret, updated_at = now();
end;
$$;

revoke all on function regenerate_pointage_token(text, text) from public, anon, authenticated;
grant execute on function regenerate_pointage_token(text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- get_pointage_qr_code : calcule le code À AFFICHER (fenêtre de 30 secondes courante), réservé aux
-- rôles qui affichent déjà ce QR — le secret lui-même n'est jamais renvoyé, seulement son dérivé.
-- ---------------------------------------------------------------------------------------------
create or replace function get_pointage_qr_code(p_etablissement_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_secret text;
  v_window bigint;
begin
  select role into v_role from employees where id = current_employee_id();
  if v_role is null or v_role not in ('manager', 'rh', 'proprietaire') then
    raise exception 'Non autorisé.';
  end if;
  select secret into v_secret from pointage_secrets
    where etablissement_id = p_etablissement_id and company_id = current_company_id();
  if v_secret is null then
    raise exception 'Jeton non initialisé pour cet établissement : régénérez-le d''abord.';
  end if;
  v_window := floor(extract(epoch from now()) / 30);
  return encode(hmac(p_etablissement_id || ':' || v_window::text, v_secret, 'sha256'), 'hex');
end;
$$;

revoke all on function get_pointage_qr_code(text) from public, anon, authenticated;
grant execute on function get_pointage_qr_code(text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- verifier_pointage_code : vérifie un code scanné contre la fenêtre courante ET la précédente (±30s
-- de tolérance réseau/horloge), ouverte à TOUT salarié authentifié (n'importe qui doit pouvoir
-- pointer) — ne renvoie jamais le secret, seulement vrai/faux. Scopée à current_company_id() : un
-- salarié d'une autre entreprise du même projet Supabase ne peut jamais valider un code sur un
-- établissement qui n'est pas le sien (voir la découverte multi-tenant du 13/09/2026).
-- ---------------------------------------------------------------------------------------------
create or replace function verifier_pointage_code(p_etablissement_id text, p_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_window bigint;
begin
  select secret into v_secret from pointage_secrets
    where etablissement_id = p_etablissement_id and company_id = current_company_id();
  if v_secret is null then
    return false;
  end if;
  v_window := floor(extract(epoch from now()) / 30);
  return p_code = encode(hmac(p_etablissement_id || ':' || v_window::text, v_secret, 'sha256'), 'hex')
      or p_code = encode(hmac(p_etablissement_id || ':' || (v_window - 1)::text, v_secret, 'sha256'), 'hex');
end;
$$;

revoke all on function verifier_pointage_code(text, text) from public, anon, authenticated;
grant execute on function verifier_pointage_code(text, text) to authenticated;

insert into schema_migrations (version) values ('0051_pointage_rotation') on conflict do nothing;
