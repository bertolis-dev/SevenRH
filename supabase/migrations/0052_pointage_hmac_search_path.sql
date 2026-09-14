-- Seven RH — retour Betty du 14/09/2026 ("function hmac(text, text, unknown) does not exist") :
-- pgcrypto (qui fournit hmac()) s'installe par défaut dans le schéma "extensions" sur Supabase, pas
-- "public" — et get_pointage_qr_code/verifier_pointage_code (0051_pointage_rotation.sql) avaient
-- `set search_path = public` seul, qui exclut "extensions" et rend hmac() invisible. Correction :
-- ajoute "extensions" au search_path de ces deux fonctions (create or replace, migration additive
-- plutôt que modifier 0051 déjà appliquée — même règle que 0046 corrigeant 0045).

create or replace function get_pointage_qr_code(p_etablissement_id text)
returns text
language plpgsql
security definer
set search_path = public, extensions
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

create or replace function verifier_pointage_code(p_etablissement_id text, p_code text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
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

insert into schema_migrations (version) values ('0052_pointage_hmac_search_path') on conflict do nothing;
