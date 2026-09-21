-- Seven RH — retour Betty du 22/09/2026 : "on a fait des tests dans les candidatures reçues et je
-- ne peux pas les supprimer. Ce serait bien de pouvoir supprimer les candidatures reçues."
--
-- La table candidatures (0024) n'a qu'une policy SELECT : aucune suppression n'était possible, ni
-- depuis l'écran ni autrement. "Archivée" déplaçait la carte dans une colonne, sans jamais rien
-- retirer. Une candidature de test restait donc à vie dans le tableau de recrutement.
--
-- Même patron que set_candidature_statut / set_candidature_data : une fonction dédiée en SECURITY
-- DEFINER plutôt qu'une policy DELETE générique, pour que la vérification d'entreprise et de
-- permission vive dans la fonction et qu'aucun appel .delete() direct ne puisse la contourner.
--
-- Les fichiers déposés (CV, lettre) vivent dans le stockage, pas dans la table : la fonction rend
-- leurs chemins à l'appelant, qui les supprime ensuite avec sa propre session (voir
-- supprimerCandidature, supabase-client.js). Les rendre plutôt que les effacer ici évite de donner
-- à cette fonction un accès en écriture au stockage, qu'elle n'a aucune autre raison d'avoir.
--
-- Au passage, c'est la bonne façon d'honorer une demande d'effacement d'un candidat (RGPD, art.
-- 17) : jusqu'ici, seule l'anonymisation automatique après le délai de conservation retirait ses
-- données, sans aucun moyen d'agir à sa demande.

create or replace function delete_candidature(p_id uuid)
returns table(cv_path text, lettre_path text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id text;
  v_cv text;
  v_lettre text;
begin
  select c.company_id, c.cv_path, c.lettre_path
    into v_company_id, v_cv, v_lettre
    from candidatures c where c.id = p_id;

  if v_company_id is null or v_company_id <> current_company_id() then
    raise exception 'Candidature introuvable.';
  end if;
  -- Même droit que pour l'embaucher ou l'archiver (set_candidature_statut) : qui peut créer un
  -- salarié depuis une candidature peut aussi retirer celle-ci.
  if not has_permission('creerSalarie') then
    raise exception 'Permission refusée.';
  end if;

  delete from candidatures where id = p_id;

  cv_path := v_cv;
  lettre_path := v_lettre;
  return next;
end;
$$;

revoke all on function delete_candidature(uuid) from public, anon;
grant execute on function delete_candidature(uuid) to authenticated;

insert into schema_migrations (version) values ('0063_supprimer_candidature') on conflict do nothing;
