-- Seven RH — audit de sécurité du 09/10/2026 : un RH pouvait devenir Propriétaire.
--
-- Constat (vérifié dans 0033 et 0002) :
--  (a) guard_employee_role_change laissait modifier permissions_overrides à quiconque a
--      gererUtilisateurs (accordé au RH par défaut), y compris sur SA PROPRE ligne ou sur celle du
--      Propriétaire : un RH pouvait s'octroyer gererAbonnements ou retirer ses droits au Propriétaire.
--      L'écran, lui, exige gererPermissions (Propriétaire seul par défaut) et refuse son propre compte.
--  (b) archiver le Propriétaire (archiverSalarie, accordé au RH) puis insérer une ligne
--      'proprietaire' : l'INSERT sur employees n'était gardé que par creerSalarie.
-- La base s'aligne sur l'écran : ce que l'interface interdit, un appel API direct l'interdit aussi.
-- (La réinitialisation du mot de passe du Propriétaire est refusée côté Edge Function
-- manage-employee-account, à redéployer avec cette migration.)
--
-- Le contournement transactionnel app.role_transfer_in_progress (transfer_proprietaire) est conservé.

begin;

create or replace function guard_employee_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  acting_role text := current_role_name();
  nb_proprietaires int;
  transfer_bypass boolean := coalesce(current_setting('app.role_transfer_in_progress', true), '') = 'true';
begin
  if NEW.role is distinct from OLD.role and not transfer_bypass then
    if NEW.id = current_employee_id() then
      raise exception 'Impossible de changer son propre rôle.';
    end if;
    if not has_permission('gererUtilisateurs') then
      raise exception 'Non autorisé à changer le rôle d''un salarié.';
    end if;
    if (NEW.role = 'proprietaire' or OLD.role = 'proprietaire') and acting_role is distinct from 'proprietaire' then
      raise exception 'Seul le Propriétaire peut attribuer ou retirer ce statut.';
    end if;
    if OLD.role = 'proprietaire' and NEW.role is distinct from 'proprietaire' then
      select count(*) into nb_proprietaires from employees
        where company_id = OLD.company_id and role = 'proprietaire' and not archive;
      if nb_proprietaires <= 1 then
        raise exception 'Impossible : ce salarié est le Propriétaire de l''entreprise — utilisez le transfert de propriété.';
      end if;
    end if;
  end if;

  -- Permissions individuelles : même droit que l'écran (gererPermissions), jamais sur son propre
  -- compte, et la ligne du Propriétaire n'est modifiable que par le Propriétaire.
  if NEW.permissions_overrides is distinct from OLD.permissions_overrides and not transfer_bypass then
    if not has_permission('gererPermissions') then
      raise exception 'Non autorisé à modifier les permissions individuelles d''un salarié.';
    end if;
    if NEW.id = current_employee_id() then
      raise exception 'Impossible de modifier ses propres permissions.';
    end if;
    if OLD.role = 'proprietaire' and acting_role is distinct from 'proprietaire' then
      raise exception 'Seul le Propriétaire peut modifier les permissions du Propriétaire.';
    end if;
  end if;

  -- Archiver le Propriétaire ouvrait la voie à l'insertion d'un second Propriétaire.
  if NEW.archive is distinct from OLD.archive and OLD.role = 'proprietaire' and not transfer_bypass
     and acting_role is distinct from 'proprietaire' then
    raise exception 'Seul le Propriétaire peut archiver ou réactiver le Propriétaire.';
  end if;

  return NEW;
end;
$$;

drop policy if exists employees_insert on employees;
create policy employees_insert on employees for insert
  with check (
    company_id = current_company_id()
    and has_permission('creerSalarie')
    and (role <> 'proprietaire' or current_role_name() = 'proprietaire')
    and (permissions_overrides = '{}'::jsonb or has_permission('gererPermissions'))
  );

insert into schema_migrations (version) values ('0065_garde_escalade_privileges') on conflict do nothing;

commit;
