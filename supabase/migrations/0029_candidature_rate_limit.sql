-- Seven RH — limite de débit sur candidature-submit (D16, audit fiabilité du 19/08/2026) : ce
-- formulaire est le seul point d'écriture public sans authentification de toute l'application (voir
-- 0024_candidatures.sql) et envoie un email (Resend, facturé à l'usage) à chaque dépôt réussi — un
-- robot pourrait aujourd'hui créer des candidatures en boucle, avec un fichier jusqu'à 5 Mo, et
-- déclencher un email à chaque fois, sans aucune limite (le commentaire de candidature-submit/
-- index.ts documentait déjà ce compromis comme assumé pour la v1, tant que les QR codes ne
-- circulaient pas encore largement).
--
-- Mitigation volontairement légère : pas de CAPTCHA (friction sur une page publique de recrutement,
-- nouvelle dépendance externe) — juste un honeypot (champ caché, voir candidature-submit/index.ts)
-- et ce journal des tentatives par IP, consulté avant toute écriture.
create table candidature_submit_log (
  id bigint generated always as identity primary key,
  ip text not null,
  company_id text,
  created_at timestamptz not null default now()
);

create index candidature_submit_log_ip_idx on candidature_submit_log (ip, created_at);

alter table candidature_submit_log enable row level security;
-- Aucune policy pour anon/authenticated : lu/écrit uniquement par candidature-submit (clé
-- service-role), jamais directement par un client — même raisonnement que candidatures elle-même
-- (voir 0024_candidatures.sql).
