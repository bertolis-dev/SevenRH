-- Seven RH — logo d'entreprise, affiché en haut de la page publique de candidature (demande du
-- 17/08/2026) en plus du nom. `companies.data->>'logo'` existe déjà côté client (getCompanyProfile/
-- saveCompanyProfile, data.js) mais n'avait jamais eu ni bouton d'upload ni bucket de stockage.
--
-- Bucket PUBLIC (contrairement à candidatures-files, privé) : un logo doit s'afficher sur la page
-- de candidature SANS authentification, et n'a rien de confidentiel — une URL publique permanente
-- est le choix normal ici, pas de policy SELECT à écrire, "public" couvre déjà la lecture.
insert into storage.buckets (id, name, public)
values ('company-logos', 'company-logos', true)
on conflict (id) do nothing;

-- Chemin de stockage : "<company_id>/logo.<ext>" — seule l'écriture est restreinte (à qui gère les
-- paramètres de SA propre entreprise), la lecture est déjà publique via le bucket lui-même.
create policy company_logos_insert on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'company-logos'
    and (storage.foldername(name))[1] = current_company_id()
    and has_permission('gererParametres')
  );

create policy company_logos_update on storage.objects for update
  to authenticated
  using (
    bucket_id = 'company-logos'
    and (storage.foldername(name))[1] = current_company_id()
    and has_permission('gererParametres')
  );

-- Expose UNIQUEMENT le nom et le logo d'une entreprise à un visiteur sans compte (page de
-- candidature, voir renderCandidatureForm/app.js) — jamais le reste (adresse, email, SIRET...), qui
-- reste protégé par les policies normales de `companies`. security definer + language sql (pas de
-- vérification de permission ici par conception : c'est la fonction elle-même qui EST la fenêtre
-- publique volontairement restreinte à ces deux colonnes, comme get_company_name l'aurait fait).
create or replace function get_company_public_info(p_company_id text)
returns table(raison_sociale text, logo text)
language sql
stable
security definer
set search_path = public
as $$
  select raison_sociale, data->>'logo' from companies where id = p_company_id;
$$;

grant execute on function get_company_public_info(text) to anon, authenticated;
