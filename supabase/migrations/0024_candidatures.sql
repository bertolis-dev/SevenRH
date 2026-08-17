-- Seven RH — candidatures reçues via le QR code "Embauche" (demande du 17/08/2026). Périmètre
-- volontairement minimal : dépôt de CV/lettre + conversion en fiche salarié, PAS un ATS complet
-- (pas de pipeline multi-étapes, pas de scoring) — cohérent avec le fait que le recrutement/ATS
-- complet reste par ailleurs explicitement hors scope de Nexus RH (analyse concurrentielle du
-- 14/08/2026).
--
-- AUCUNE policy INSERT/UPDATE pour anon/authenticated : la personne qui scanne le QR n'a et ne
-- doit jamais avoir de compte — c'est pourtant le seul flux d'écriture de toute l'application
-- accessible sans authentification. Plutôt que d'ouvrir une policy INSERT publique (avec le risque
-- de devoir valider/nettoyer les données côté client, jamais fiable), toute écriture passe par la
-- fonction Edge "candidature-submit" (clé service-role), qui valide l'entreprise cible, les
-- fichiers (taille/type) et l'email avant d'écrire quoi que ce soit — même logique que
-- `subscriptions`/`subscription_modules` (aucune policy pour authenticated non plus), pour une
-- raison différente ici (visiteur public, pas juste "protéger d'un salarié malveillant").
create table candidatures (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references companies(id) on delete cascade,
  nom text not null,
  prenom text not null default '',
  email text not null,
  telephone text not null default '',
  cv_path text,
  lettre_path text,
  lettre_texte text,
  statut text not null default 'nouvelle', -- 'nouvelle' | 'embauchee' | 'archivee'
  employee_id text references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table candidatures enable row level security;

create policy candidatures_select on candidatures for select
  using (company_id = current_company_id() and has_permission('creerSalarie'));

grant select on candidatures to authenticated;

-- Changement de statut (embaucher/archiver) : passe par une fonction dédiée plutôt qu'une policy
-- UPDATE classique — même raisonnement que toggle_idee_vote/set_idee_statut (0021_idees.sql) : la
-- vérification de permission vit dans la fonction elle-même (SECURITY DEFINER), pas dans une policy
-- RLS générique, pour ne jamais laisser un appel .update() direct contourner la règle.
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
  if p_statut not in ('nouvelle', 'embauchee', 'archivee') then
    raise exception 'Statut invalide.';
  end if;
  update candidatures set statut = p_statut, employee_id = p_employee_id, updated_at = now() where id = p_id;
end;
$$;

grant execute on function set_candidature_statut(uuid, text, text) to authenticated;

-- Bucket de stockage des CV/lettres — privé (pas de champ "public" à true) : ce sont des documents
-- personnels (RGPD), jamais accessibles par une URL publique permanente (voir getCandidatureFileUrl,
-- supabase-client.js, qui génère une URL signée de courte durée à la demande).
insert into storage.buckets (id, name, public)
values ('candidatures-files', 'candidatures-files', false)
on conflict (id) do nothing;

-- Chemin de stockage : "<company_id>/<candidature_id>/cv.<ext>" — le premier segment sert de clé de
-- filtrage RLS ci-dessous, exactement comme (storage.foldername(name))[1].
create policy candidatures_files_select on storage.objects for select
  to authenticated
  using (
    bucket_id = 'candidatures-files'
    and (storage.foldername(name))[1] = current_company_id()
    and has_permission('creerSalarie')
  );
