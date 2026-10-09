-- Seven RH — audit du 09/10/2026 : le pointage d'un salarié ou d'un manager n'atteignait jamais le
-- serveur.
--
-- Constat (vérifié) : les pointages vivent dans le blob companies.data (data.js, savePointages ->
-- _pushCompanyDataBlob -> syncCompanyProfile, un simple UPDATE sans .select()), et companies_update
-- (0002) exige gererParametres. Pour qui ne l'a pas (salarié, manager, comptable : exactement ceux qui
-- scannent le QR), l'UPDATE est filtré par RLS sans la moindre erreur : le pointage restait dans le
-- navigateur, disparaissait au rechargement, et le manager ne le voyait jamais. Les essais faits par
-- le Propriétaire (qui a gererParametres) ne pouvaient pas le révéler.
--
-- Correctif : une fonction dédiée qui n'écrit QUE le pointage du salarié appelant, après avoir
-- revérifié le code du QR côté serveur (verifier_pointage_code) — sans cette revérification, ouvrir
-- cette écriture à tout salarié lui permettrait de se pointer à distance sans scanner. L'ajout/le
-- remplacement du pointage se fait en une seule instruction sur le blob (jamais lire puis réécrire
-- tout le blob depuis un cache client, qui effacerait les pointages des autres).

begin;

create or replace function enregistrer_pointage(p_etablissement_id text, p_code text, p_pointage jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp text := current_employee_id();
  v_company text := current_company_id();
begin
  if v_emp is null or v_company is null then
    raise exception 'Non authentifié.';
  end if;
  if not verifier_pointage_code(p_etablissement_id, p_code) then
    raise exception 'QR code invalide ou expiré.';
  end if;
  if p_pointage is null or p_pointage->>'id' is null then
    raise exception 'Pointage invalide.';
  end if;
  if p_pointage->>'employeeId' is distinct from v_emp then
    raise exception 'Un pointage ne peut être enregistré que pour soi-même.';
  end if;
  -- Jamais remplacer le pointage de quelqu'un d'autre en réutilisant son identifiant.
  if exists (
    select 1 from companies c, jsonb_array_elements(coalesce(c.data->'pointages', '[]'::jsonb)) e
     where c.id = v_company and e->>'id' = p_pointage->>'id' and e->>'employeeId' is distinct from v_emp
  ) then
    raise exception 'Pointage invalide.';
  end if;

  update companies
     set data = jsonb_set(
       coalesce(data, '{}'::jsonb),
       '{pointages}',
       coalesce((
         select jsonb_agg(e)
           from jsonb_array_elements(coalesce(data->'pointages', '[]'::jsonb)) e
          where e->>'id' is distinct from p_pointage->>'id'
       ), '[]'::jsonb) || jsonb_build_array(p_pointage)
     )
   where id = v_company;
end;
$$;

revoke all on function enregistrer_pointage(text, text, jsonb) from public, anon;
grant execute on function enregistrer_pointage(text, text, jsonb) to authenticated;

insert into schema_migrations (version) values ('0068_pointage_enregistrer_rpc') on conflict do nothing;

commit;
