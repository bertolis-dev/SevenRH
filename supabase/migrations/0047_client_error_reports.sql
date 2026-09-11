-- Seven RH — remontée des erreurs client à BERTOLIS (§retour Betty du 11/09/2026, point 2 :
-- "nous ne voyons toujours pas les erreurs de nos clients"). reportClientError (app.js) journalisait
-- déjà chaque erreur dans l'audit_log DE L'ENTREPRISE CLIENTE elle-même — personne chez BERTOLIS ni
-- chez le client ne consultait ce journal pour ça ("c'est comme cela que j'ai découvert trois des
-- problèmes que je t'ai signalés ce mois-ci"). Cette table est la copie destinée à BERTOLIS, lue
-- par la console via l'Edge Function bertolis-tickets (actions listErrors/markErrorReviewed,
-- service-role, même secret partagé que les tickets support — pas de nouveau secret à configurer) :
-- jamais de lecture croisée entre entreprises depuis le client lui-même.
create table client_error_reports (
  id text primary key default gen_random_uuid()::text,
  company_id text not null references companies(id) on delete cascade,
  employee_id text references employees(id) on delete set null,
  version text,
  contexte text not null,
  message text not null,
  stack text,
  revu_par_bertolis boolean not null default false,
  created_at timestamptz not null default now()
);

create index client_error_reports_created_idx on client_error_reports (created_at desc);
create index client_error_reports_company_idx on client_error_reports (company_id);

alter table client_error_reports enable row level security;

-- Insertion ouverte à tout salarié authentifié pour SA PROPRE entreprise (une erreur peut survenir
-- pour n'importe quel rôle, pas seulement RH/Propriétaire) — jamais bloquant pour l'utilisateur si
-- ça échoue, voir reportClientErrorToBertolis (supabase-client.js), même philosophie que la
-- journalisation locale déjà en place dans reportClientError (app.js).
create policy client_error_reports_insert on client_error_reports for insert
  to authenticated
  with check (
    company_id = current_company_id()
    and (employee_id is null or employee_id = current_employee_id())
  );

-- Lecture par l'entreprise elle-même limitée à RH/Propriétaire (même permission que Paramètres) —
-- pas nécessaire pour la console BERTOLIS (accès service-role, hors RLS) mais évite qu'un
-- signalement reste invisible du client si RH veut vérifier ce qui a été transmis.
create policy client_error_reports_select on client_error_reports for select
  to authenticated
  using (company_id = current_company_id() and has_permission('gererParametres'));

insert into schema_migrations (version) values ('0047_client_error_reports') on conflict do nothing;
