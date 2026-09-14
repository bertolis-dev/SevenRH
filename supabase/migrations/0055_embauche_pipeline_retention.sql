-- Seven RH — retour Betty du 14/09/2026 (revue concurrentielle, module Embauche, 8→16).
--
-- Point 1 ("suivi par étapes réel") : le statut des candidatures reste un pipeline SIMPLE (pas un
-- ATS complet, voir 0024_candidatures.sql) mais gagne deux étapes intermédiaires entre le dépôt et
-- la décision finale — set_candidature_statut est la SEULE porte d'écriture du statut (SECURITY
-- DEFINER, cf. commentaire 0024), donc étendre la liste ici suffit à tout le client (aucune policy
-- UPDATE à toucher).
create or replace function set_candidature_statut(p_id uuid, p_statut text, p_employee_id text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id text;
begin
  select company_id into v_company_id from candidatures where id = p_id;
  if v_company_id is null or v_company_id <> current_company_id() then
    raise exception 'Candidature introuvable.';
  end if;
  if not has_permission('creerSalarie') then
    raise exception 'Permission refusée.';
  end if;
  if p_statut not in ('nouvelle', 'entretien', 'offre', 'embauchee', 'archivee') then
    raise exception 'Statut invalide.';
  end if;
  update candidatures set statut = p_statut, employee_id = p_employee_id, updated_at = now() where id = p_id;
end;
$$;

-- Point 3 ("conformité") : rien ne limitait jusqu'ici la durée de conservation d'une candidature
-- résolue (embauchée ou archivée) — un CV/une lettre de motivation restaient indéfiniment en base,
-- en violation de la même obligation RGPD de durée de conservation limitée déjà traitée pour les
-- salariés partis (anonymize_departed_employees, 0049_retention_anonymisation.sql). Recommandation
-- CNIL usuelle pour une candidature spontanée non retenue : 2 ans — settings.
-- dureeConservationCandidaturesAnnees (data.js), modifiable par entreprise, même défaut que l'ordre
-- de grandeur CNIL mais PAS une valeur officielle unique, à faire confirmer par votre juriste/DPO.
--
-- Contrairement à anonymize_employee (qui garde nom/prénom/date de naissance pour le registre du
-- personnel), une candidature n'a AUCUNE obligation légale équivalente à conserver son identité une
-- fois résolue : anonymisation complète des champs identifiants ici.
--
-- Limite connue, à signaler à Betty : ceci vide uniquement les RÉFÉRENCES aux fichiers (cv_path/
-- lettre_path mis à NULL) — les fichiers eux-mêmes dans le bucket "candidatures-files" ne sont PAS
-- supprimés par cette fonction (une suppression réelle de fichier passe par l'API Storage, pas par
-- une simple requête SQL sur storage.objects) : à nettoyer manuellement depuis le Dashboard Supabase
-- (Storage > candidatures-files) si une garantie de suppression physique est nécessaire, ou par une
-- Edge Function dédiée si le besoin se confirme.
create or replace function anonymize_candidature(p_candidature_id uuid)
returns void
language plpgsql
as $$
begin
  update candidatures
  set
    nom = 'Candidature archivée',
    prenom = '',
    email = 'anonymise-' || id || '@archive.local',
    telephone = '',
    lettre_texte = '',
    cv_path = null,
    lettre_path = null,
    updated_at = now()
  where id = p_candidature_id;
end;
$$;

-- Même patron que anonymize_departed_employees : parcourt toutes les entreprises, sélectionne les
-- candidatures RÉSOLUES (embauchee/archivee, jamais "nouvelle"/"entretien"/"offre" — toujours en
-- cours de traitement) dont la dernière mise à jour dépasse la durée de conservation de leur
-- entreprise, pas déjà anonymisées (email encore "normal", jamais celui généré ci-dessus). Appelée
-- quotidiennement par pg_cron — à programmer manuellement depuis le Dashboard Supabase (Database >
-- Cron Jobs > New Job) avec la commande `select anonymize_stale_candidatures();`, comme
-- anonymize_departed_employees.
create or replace function anonymize_stale_candidatures()
returns integer
language plpgsql
as $$
declare
  v_count integer := 0;
  v_candidature_id uuid;
begin
  for v_candidature_id in
    select c.id
    from candidatures c
    left join settings s on s.company_id = c.company_id
    where c.statut in ('embauchee', 'archivee')
      and c.email not like 'anonymise-%@archive.local'
      and c.updated_at
        + (coalesce((s.data->>'dureeConservationCandidaturesAnnees')::integer, 2) || ' years')::interval
        <= now()
  loop
    perform anonymize_candidature(v_candidature_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Fonctions de maintenance interne uniquement, jamais appelables via l'API cliente (anon/
-- authenticated) — même raison que 0049 (leçon de 0039/0041 sur "revoke ... from public" seul qui
-- ne suffit pas).
revoke all on function anonymize_candidature(uuid) from public, anon, authenticated;
revoke all on function anonymize_stale_candidatures() from public, anon, authenticated;

insert into schema_migrations (version) values ('0055_embauche_pipeline_retention') on conflict do nothing;
