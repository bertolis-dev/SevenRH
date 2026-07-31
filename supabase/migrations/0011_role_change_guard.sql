-- Seven RH — verrou serveur sur le changement de rôle d'un salarié
--
-- 0002_rls_policies.sql documentait déjà ce trou (voir son commentaire sur employees_update) :
-- la policy autorise un salarié à modifier SA PROPRE ligne (id = current_employee_id()), sans
-- aucune restriction par colonne — donc n'importe qui pouvait en théorie se PATCHer soi-même
-- role='directeur' via un appel REST direct, en contournant entièrement l'UI. Le nouveau bouton
-- "Changer le rôle" (côté app, DB.changerRoleSalarie) fait ses propres vérifications, mais elles
-- sont uniquement côté client — comme toujours dans ce projet, la vraie barrière doit vivre côté
-- serveur. Plutôt qu'une restriction de colonnes via GRANT (déjà tentée et annulée pour d'autres
-- tables, voir 0007/0008 — trop cassant), un trigger BEFORE UPDATE : il peut comparer l'ancienne
-- et la nouvelle valeur directement (OLD/NEW), ce qu'une simple policy RLS ne permet pas.

create or replace function guard_employee_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  acting_role text := current_role_name();
  nb_directeurs int;
begin
  if NEW.role is distinct from OLD.role then
    if NEW.id = current_employee_id() then
      raise exception 'Impossible de changer son propre rôle.';
    end if;
    if not has_permission('gererUtilisateurs') then
      raise exception 'Non autorisé à changer le rôle d''un salarié.';
    end if;
    -- Seul un Directeur peut attribuer OU retirer le rôle Directeur — sinon un RH avec
    -- gererUtilisateurs (accordé par défaut) pourrait se créer un compte Directeur ou en démettre un.
    if (NEW.role = 'directeur' or OLD.role = 'directeur') and acting_role is distinct from 'directeur' then
      raise exception 'Seul un Directeur peut attribuer ou retirer le rôle Directeur.';
    end if;
    -- Jamais retirer le dernier Directeur de l'entreprise : plus personne ne pourrait alors gérer
    -- ce que seul ce rôle couvre (accorder gererAbonnements, modifier sa propre fiche, etc.).
    if OLD.role = 'directeur' and NEW.role is distinct from 'directeur' then
      select count(*) into nb_directeurs from employees
        where company_id = OLD.company_id and role = 'directeur' and not archive;
      if nb_directeurs <= 1 then
        raise exception 'Impossible : ce salarié est le dernier Directeur de l''entreprise.';
      end if;
    end if;
  end if;

  if NEW.permissions_overrides is distinct from OLD.permissions_overrides and not has_permission('gererUtilisateurs') then
    raise exception 'Non autorisé à modifier les permissions individuelles d''un salarié.';
  end if;

  return NEW;
end;
$$;

drop trigger if exists employees_role_change_guard on employees;
create trigger employees_role_change_guard
  before update on employees
  for each row
  execute function guard_employee_role_change();
