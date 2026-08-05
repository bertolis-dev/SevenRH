-- Seven RH — retrait du parcours d'inscription "Créer un compte" (rattachement par correspondance
-- de domaine d'email, migration 0006/0007). Chaque compte de connexion est désormais créé
-- explicitement par un Directeur/RH depuis la fiche du salarié (voir la fonction Edge
-- "manage-employee-account"), ou par la création d'une nouvelle entreprise (migration 0012,
-- intent='creer_entreprise', déjà géré séparément).
--
-- Le trigger sur auth.users continue de s'exécuter pour CES DEUX autres cas (ils insèrent aussi
-- dans auth.users), mais ni l'un ni l'autre n'a plus besoin de sa logique de rattachement par
-- domaine — chacun gère déjà lui-même le lien employees.auth_user_id (create_company_self_service
-- pour le premier, un UPDATE direct dans manage-employee-account pour le second). La fonction
-- devient donc un simple passe-plat, plutôt que d'ajouter encore un nouveau marqueur "intent" à une
-- logique qui n'a plus aucun appelant légitime.
create or replace function link_new_auth_user_to_employee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  return new;
end;
$$;
