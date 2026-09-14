-- Seven RH — retour Betty du 14/09/2026 ("embauche tu peux augmenté") : les deux derniers points
-- du module Embauche qui restaient écartés par choix de conception (planification des créneaux
-- d'entretien, évaluation structurée des candidats) — voir 0024/0055_embauche_pipeline_retention.
--
-- Périmètre volontairement limité au suivi CÔTÉ RH : proposer des créneaux et noter lequel le
-- candidat a confirmé (communication par téléphone/email, comme aujourd'hui), plus une évaluation
-- structurée après entretien. Un vrai choix self-service candidat (le candidat clique lui-même son
-- créneau) demanderait un compte candidat ou une nouvelle fonction Edge publique dédiée avec son
-- propre token — un cran au-dessus, hors de ce point.
--
-- candidatures n'a pas de colonne jsonb libre comme employees.data/leave_requests.data/expenses.data
-- (voir 0024 : "périmètre volontairement minimal", aucune policy INSERT/UPDATE publique). On
-- l'ajoute ici pour les mêmes raisons qu'ailleurs, réservée à ces deux points — jamais un
-- fourre-tout de plus qui inviterait à y glisser autre chose sans réflexion.
alter table candidatures add column if not exists data jsonb not null default '{}'::jsonb;
-- data: { creneauxProposes: [{id, date, heureDebut, heureFin}], creneauChoisiId, evaluations: [{id, evaluateurId, evaluateurNom, date, criteres: [{label, note}], commentaire}] }

-- Seule porte d'écriture pour ces deux points, même raisonnement que set_candidature_statut
-- (0024) : jamais de policy UPDATE générique sur candidatures. Fusion superficielle (jsonb ||) :
-- chaque appelant ne renvoie QUE les clés qu'il modifie (creneauxProposes, creneauChoisiId ou
-- evaluations), jamais tout l'objet — même patron read-modify-write que le reste de l'application
-- côté client, la fonction ne fait que fusionner ce qu'on lui donne.
create or replace function set_candidature_data(p_id uuid, p_patch jsonb)
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
  update candidatures set data = data || p_patch, updated_at = now() where id = p_id;
end;
$$;

revoke all on function set_candidature_data(uuid, jsonb) from public, anon;
grant execute on function set_candidature_data(uuid, jsonb) to authenticated;

insert into schema_migrations (version) values ('0056_candidature_creneaux_evaluations') on conflict do nothing;
