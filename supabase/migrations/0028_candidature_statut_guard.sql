-- Seven RH — corrige set_candidature_statut (0024_candidatures.sql) : la fonction acceptait de
-- réécrire le statut/employee_id d'une candidature déjà traitée sans jamais regarder son statut
-- actuel. Deux RH ouvrant la même candidature "nouvelle" et cliquant tous les deux "Embaucher"
-- avant de rafraîchir créaient chacun un salarié, le second appel écrasant silencieusement
-- l'employee_id posé par le premier — la candidature ne pointait plus alors que vers UN seul des
-- deux salariés créés, l'autre restant orphelin sans lien retour. Même chose pour "Pas intéressé"
-- (candidature-reject) après un "Embaucher" déjà effectué ailleurs.
--
-- Correction : passer de 'nouvelle' à 'embauchee'/'archivee' n'est plus autorisé QUE si le statut
-- actuel est encore 'nouvelle' — un repassage explicite à 'nouvelle' (aucun bouton ne le fait
-- aujourd'hui, mais la fonction l'acceptait) reste permis depuis n'importe quel statut, pour ne pas
-- bloquer une correction manuelle future.
create or replace function set_candidature_statut(p_id uuid, p_statut text, p_employee_id text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id text;
  v_statut_actuel text;
begin
  select company_id, statut into v_company_id, v_statut_actuel from candidatures where id = p_id;
  if v_company_id is null or v_company_id <> current_company_id() then
    raise exception 'Candidature introuvable.';
  end if;
  if not has_permission('creerSalarie') then
    raise exception 'Permission refusée.';
  end if;
  if p_statut not in ('nouvelle', 'embauchee', 'archivee') then
    raise exception 'Statut invalide.';
  end if;
  if p_statut in ('embauchee', 'archivee') and v_statut_actuel <> 'nouvelle' then
    raise exception 'Cette candidature a déjà été traitée.';
  end if;
  update candidatures set statut = p_statut, employee_id = p_employee_id, updated_at = now() where id = p_id;
end;
$$;
