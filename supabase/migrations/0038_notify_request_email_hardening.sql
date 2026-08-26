-- Seven RH — durcissement de notify-request-email (retour QA du 26/08/2026, point 5.2) :
-- "n'importe quel salarié connecté peut appeler notify-request-email et déclencher un email à ses
-- collègues, au nom de l'entreprise, avec son logo, et un contenu dont il fournit une partie
-- (employeeName, typeLabel, periode, motif). Rien ne vérifie qu'il est concerné par la demande dont
-- il parle, ni combien d'appels il passe."
--
-- Ce fichier ajoute la limite de débit (même patron que candidature-submit, 0031) ; le rattachement
-- à une VRAIE demande existante (et la dérivation du contenu de l'email depuis cette demande plutôt
-- que depuis des chaînes fournies par l'appelant) est fait côté fonction Edge (notify-request-
-- email/index.ts, réécrite), en réutilisant resolve_validator_employee_ids_for_step (0037) pour
-- vérifier que l'appelant est bien concerné (auteur ou validateur éligible) avant tout envoi.

create table notify_request_email_log (
  id bigint generated always as identity primary key,
  employee_id text not null references employees(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index notify_request_email_log_employee_created_idx on notify_request_email_log (employee_id, created_at desc);
-- Table entièrement fermée (même patron que settings/ical_tokens) : aucune policy, seule la
-- fonction security definer ci-dessous (ou un client service-role) peut y lire/écrire.
alter table notify_request_email_log enable row level security;

-- Comptage ET insertion dans une seule transaction serveur, sérialisée par un verrou consultatif
-- PAR SALARIÉ (même raisonnement que check_candidature_rate_limit, 0031 : sans lock, un burst de
-- requêtes concurrentes du même salarié pourrait dépasser p_limit avant qu'aucune n'ait inséré sa
-- propre ligne).
create or replace function check_notify_request_email_rate_limit(p_employee_id text, p_limit int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  perform pg_advisory_xact_lock(hashtext(p_employee_id));
  select count(*) into v_count from notify_request_email_log where employee_id = p_employee_id and created_at >= now() - interval '1 hour';
  if v_count >= p_limit then
    return false;
  end if;
  insert into notify_request_email_log (employee_id) values (p_employee_id);
  return true;
end;
$$;

-- Pas de RLS/grant à authenticated : appelée uniquement par notify-request-email via le client
-- service-role, même raisonnement que check_candidature_rate_limit.
