-- Seven RH — retour Betty du 13/09/2026 ("le QR de pointage ne marche jamais, même sur le même
-- appareil/compte") : cause réelle enfin identifiée après deux correctifs infructueux sur le
-- TIMING (cache client périmé, puis course d'écriture) — le vrai problème n'a jamais été un
-- problème de timing. etablissements_write (0002_rls_policies.sql) exige la permission
-- gererParametres pour TOUTE écriture sur la table etablissements. Or le bouton "QR de pointage" de
-- l'écran Pointeuse (§retour Betty du 11/09/2026, "pour le directeur et les manageurs un bouton qr
-- code") est explicitement montré aux MANAGERS — qui n'ont PAS gererParametres par défaut
-- (DEFAULT_ROLE_PERMISSIONS, data.js). Un manager qui régénère son QR voit donc l'écriture vers
-- Supabase silencieusement rejetée par RLS (le cache local, lui, se met à jour sans broncher) :
-- le jeton affiché dans le QR n'atteint JAMAIS le serveur, et la vérification en direct ajoutée le
-- même jour (voir get_expense_totals_for_employee... non, voir enregistrerPointage, data.js) le
-- rejette alors pour de bon, sur n'importe quel appareil, indéfiniment.
--
-- Plutôt que d'élargir etablissements_write (qui protège aussi nom/adresse/statut actif, à raison
-- réservés à RH/Propriétaire) : une fonction dédiée, qui ne touche QUE le jeton de pointage, avec
-- sa propre vérification de rôle (manager/rh/proprietaire — exactement le même critère que
-- l'affichage du bouton côté client, jamais plus large).
create or replace function regenerate_pointage_token(p_etablissement_id text, p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role into v_role from employees where id = current_employee_id();
  if v_role is null or v_role not in ('manager', 'rh', 'proprietaire') then
    raise exception 'Non autorisé.';
  end if;
  update etablissements
  set data = jsonb_set(coalesce(data, '{}'::jsonb), '{pointageToken}', to_jsonb(p_token))
  where id = p_etablissement_id and company_id = current_company_id();
end;
$$;

revoke all on function regenerate_pointage_token(text, text) from public, anon, authenticated;
grant execute on function regenerate_pointage_token(text, text) to authenticated;

insert into schema_migrations (version) values ('0050_regenerate_pointage_token_rpc') on conflict do nothing;
