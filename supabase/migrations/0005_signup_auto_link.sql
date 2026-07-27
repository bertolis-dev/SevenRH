-- Seven RH — liaison automatique d'un nouveau compte Supabase Auth à sa fiche salarié existante.
--
-- Problème résolu : quand un salarié crée son compte de connexion (bouton "Créer mon compte"), il
-- faut relier auth.users.id à employees.auth_user_id — mais au moment du signup, l'utilisateur n'a
-- encore ni session correspondant à son id (current_employee_id() renvoie NULL) ni permission
-- modifierSalarie : impossible de satisfaire la policy employees_update normalement (poule/œuf).
--
-- Solution standard Supabase : un trigger AFTER INSERT ON auth.users, en SECURITY DEFINER (donc
-- hors RLS), qui relie automatiquement le nouveau compte à la fiche salarié dont l'email correspond
-- ET qui n'est pas déjà reliée (auth_user_id is null) — pour ne jamais écraser une liaison existante
-- ni relier n'importe qui à une fiche déjà prise.

create or replace function link_new_auth_user_to_employee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update employees
  set auth_user_id = new.id
  where lower(email) = lower(new.email) and auth_user_id is null;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function link_new_auth_user_to_employee();
