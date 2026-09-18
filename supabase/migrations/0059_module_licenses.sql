-- Seven RH — retour Betty du 18/09/2026 (point 8, "les abonnements : des licences réellement
-- attribuées") : quand une entreprise à la carte souscrit un module avec une quantité (ex. 3 licences
-- de Notes de frais), rien ne limitait jusqu'ici qui peut réellement s'en servir — hasModule()
-- (app.js) ne vérifie que la présence du module dans l'abonnement, jamais combien de postes ont été
-- achetés, et cette vérification n'existe QUE côté client. Une entreprise avec 3 licences facturées
-- pouvait donc voir ses 10 salariés utiliser le module : on facture 3, on en consomme 10.
--
-- Cette migration ajoute :
--   1. Une table module_licenses : l'attribution nominative elle-même (qui a un siège), séparée de
--      subscription_modules (0023, qui ne contient que la quantité ACHETÉE, écrite uniquement par
--      Stripe/le service-role — jamais mélanger les deux, sous peine de voir l'attribution effacée
--      au prochain resynchronisation Stripe). Gérée par le client, réservée à qui a le droit de
--      gérer l'abonnement (gererAbonnements).
--   2. has_module_license(employee_id, module_key) : vérifie à la fois que le module est souscrit
--      ET que ce salarié précis y a un siège attribué — Propriétaire/RH exemptés (l'administration
--      d'un module qu'on paie ne devrait jamais dépendre d'un siège personnel, choix délibéré, à
--      revoir si Betty préfère la version plus stricte évoquée dans notre échange).
--   3. Le VRAI verrou, appliqué aux policies d'INSERT de leave_requests/telework_requests/expenses
--      (jamais seulement à l'écran, cf. "un module masqué à l'écran mais accessible par ailleurs ne
--      serait pas une licence, ce serait une politesse") : le salarié PROPRIÉTAIRE de la ligne créée
--      (employee_id, que ce soit lui-même ou quelqu'un qui saisit pour lui) doit être licencié pour
--      le module concerné. hasModule() (app.js) continue de gérer l'affichage ; ceci garantit que
--      l'affichage ne peut plus jamais mentir.

-- ---------------------------------------------------------------------------
-- 1. Attribution nominative
-- ---------------------------------------------------------------------------
create table module_licenses (
  company_id text not null references companies(id) on delete cascade,
  module_key text not null,
  employee_id text not null references employees(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by text,
  primary key (company_id, module_key, employee_id)
);

alter table module_licenses enable row level security;

create policy module_licenses_select on module_licenses for select
  using (company_id = current_company_id());

create policy module_licenses_insert on module_licenses for insert
  with check (company_id = current_company_id() and has_permission('gererAbonnements'));

create policy module_licenses_delete on module_licenses for delete
  using (company_id = current_company_id() and has_permission('gererAbonnements'));

grant select, insert, delete on module_licenses to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Module souscrit ET salarié licencié (ou exempté)
-- ---------------------------------------------------------------------------
create or replace function has_module_license(p_employee_id text, p_module_key text)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  v_company_id text;
  v_role text;
begin
  select company_id, role into v_company_id, v_role from employees where id = p_employee_id;
  if v_company_id is null then return false; end if;

  -- Hors offre à la carte (essai/essentiel/professionnel/premium) : tous les modules inclus dans
  -- l'offre elle-même, aucune notion de siège nominatif — même repli que hasModule() côté client.
  if not exists (select 1 from subscriptions where company_id = v_company_id and offre = 'a_la_carte') then
    return true;
  end if;

  if not exists (select 1 from subscription_modules where company_id = v_company_id and module_key = p_module_key) then
    return false;
  end if;

  if v_role in ('rh', 'proprietaire') then return true; end if;

  return exists (
    select 1 from module_licenses
    where company_id = v_company_id and module_key = p_module_key and employee_id = p_employee_id
  );
end;
$$;

revoke all on function has_module_license(text, text) from public, anon;
grant execute on function has_module_license(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Le verrou réel — reprend exactement la forme de 0032_demandes_pour_autrui.sql (dernière version
--    en date de ces policies), en ajoutant la seule condition de licence.
-- ---------------------------------------------------------------------------
drop policy if exists leave_requests_insert on leave_requests;
create policy leave_requests_insert on leave_requests for insert
  with check (
    company_id = current_company_id()
    and has_module_license(employee_id, 'conges')
    and (
      (employee_id = current_employee_id() and has_permission('creerDemandeAbsence'))
      or is_manager_of(employee_id)
      or has_permission('validerAbsence')
      or has_permission('saisirMaladie')
    )
  );

drop policy if exists telework_requests_insert on telework_requests;
create policy telework_requests_insert on telework_requests for insert
  with check (
    company_id = current_company_id()
    and has_module_license(employee_id, 'planning')
    and (
      (employee_id = current_employee_id() and has_permission('creerDemandeAbsence'))
      or is_manager_of(employee_id)
      or has_permission('validerAbsence')
    )
  );

drop policy if exists expenses_insert on expenses;
create policy expenses_insert on expenses for insert
  with check (
    company_id = current_company_id()
    and has_module_license(employee_id, 'frais')
    and (
      (employee_id = current_employee_id() and has_permission('creerNoteFrais'))
      or (is_manager_of(employee_id) and has_permission('controlerNoteFrais'))
      or has_permission('validerNoteFrais')
    )
  );

insert into schema_migrations (version) values ('0059_module_licenses') on conflict do nothing;
