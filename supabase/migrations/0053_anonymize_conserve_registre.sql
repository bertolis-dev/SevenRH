-- Seven RH — retour Betty du 14/09/2026 (Module RH point 6, "registre du personnel toujours à
-- jour") : anonymize_employee (0049_retention_anonymisation.sql) effaçait nom/prénom/date de
-- naissance/nationalité/civilité d'un salarié parti après la durée de conservation configurée. Le
-- registre unique du personnel (Code du travail, art. L1221-13 et D1221-23) doit pourtant présenter
-- exactement ces mentions pour CHAQUE salarié ayant travaillé dans l'entreprise, y compris parti
-- depuis longtemps — l'anonymisation RGPD, pensée pour les coordonnées et informations personnelles
-- (email, téléphone, adresse, numéro de sécurité sociale, photo), effaçait donc par erreur des
-- mentions que la loi impose de garder disponibles.
--
-- Décision de Betty : le registre prime sur ces champs précis, l'anonymisation RGPD reste appliquée
-- à tout le reste (coordonnées, identifiants). Nom/prénom d'un ex-salarié ne sont donc plus jamais
-- effacés par ce mécanisme — seule une demande RGPD explicite et individuelle (droit à l'effacement,
-- hors du champ de cette fonction automatique) pourrait un jour justifier de les retirer aussi.

create or replace function anonymize_employee(p_employee_id text)
returns void
language plpgsql
as $$
begin
  update employees
  set
    email = 'anonymise-' || id || '@archive.local',
    data = data || jsonb_build_object(
      'photo', null,
      'telephone', '',
      'adresse', jsonb_build_object('rue', '', 'codePostal', '', 'ville', ''),
      'lieuNaissance', '',
      'numeroSecu', '',
      'anonymise', true,
      'dateAnonymisation', to_char(now(), 'YYYY-MM-DD')
    ),
    updated_at = now()
  where id = p_employee_id;
end;
$$;

revoke all on function anonymize_employee(text) from public, anon, authenticated;

insert into schema_migrations (version) values ('0053_anonymize_conserve_registre') on conflict do nothing;
