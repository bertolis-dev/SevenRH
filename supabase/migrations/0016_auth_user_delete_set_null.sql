-- Seven RH — employees.auth_user_id n'avait aucune règle ON DELETE (défaut Postgres : NO ACTION),
-- donc supprimer un compte depuis Authentication → Users échouait ("Failed to delete users") tant
-- qu'un salarié référençait encore ce compte — vécu en essayant de nettoyer un test d'inscription
-- resté bloqué. ON DELETE SET NULL : la fiche salarié survit (utile si c'est un vrai salarié dont on
-- révoque l'accès), seul le lien de connexion est effacé — cohérent avec creerCompteConnexion, qui
-- sait déjà recréer un compte de connexion pour un salarié qui n'en a plus.
alter table employees drop constraint employees_auth_user_id_fkey;
alter table employees add constraint employees_auth_user_id_fkey
  foreign key (auth_user_id) references auth.users(id) on delete set null;
