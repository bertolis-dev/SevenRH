-- Seven RH — retour Betty du 19/09/2026 (revue de la livraison licences, point 1, "le plus important
-- des quatre") : module_licenses_insert (0059_module_licenses.sql) ne vérifiait que l'entreprise et
-- la permission gererAbonnements, JAMAIS la quantité réellement achetée (subscription_modules.
-- quantite, écrite uniquement par Stripe/le service-role) contre le nombre d'attributions déjà
-- enregistrées. L'écran (licenseSummaryForModule, app.js) désactive bien la case à cocher une fois
-- la capacité atteinte, mais ce n'est qu'un confort d'affichage : rien n'empêchait un appel direct
-- à supabase.from('module_licenses').insert(...) de dépasser le nombre de sièges facturés — et
-- c'est précisément le titulaire du compte (permission gererAbonnements) qui a intérêt à le faire.
--
-- Cette policy remplace donc l'ancienne pour ajouter la seule condition manquante : le nombre de
-- lignes déjà attribuées pour (company_id, module_key) doit rester strictement inférieur à la
-- quantité souscrite. Hors offre à la carte (aucune ligne subscription_modules pour ce module), le
-- coalesce à 0 refuse toute attribution — cohérent avec has_module_license(), qui n'a de toute façon
-- jamais besoin de module_licenses hors offre à la carte.
drop policy if exists module_licenses_insert on module_licenses;
create policy module_licenses_insert on module_licenses for insert
  with check (
    company_id = current_company_id()
    and has_permission('gererAbonnements')
    and (
      select count(*) from module_licenses ml
      where ml.company_id = module_licenses.company_id and ml.module_key = module_licenses.module_key
    ) < coalesce((
      select sm.quantite from subscription_modules sm
      where sm.company_id = module_licenses.company_id and sm.module_key = module_licenses.module_key
    ), 0)
  );

insert into schema_migrations (version) values ('0061_module_licenses_cap') on conflict do nothing;
