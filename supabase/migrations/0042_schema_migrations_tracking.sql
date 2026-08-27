-- Seven RH — point 3 (retour QA du 27/08/2026) : "confirme-moi migration par migration lesquelles
-- sont réellement appliquées, et propose une façon de ne plus dépendre de ta mémoire." Rien
-- n'appliquait automatiquement le contenu de supabase/migrations (ci.yml vérifie la syntaxe et lance
-- les tests, jamais la base) — une correction peut donc être livrée/fusionnée sans jamais atteindre
-- la production. Ce fichier ajoute une table de suivi minimale, adaptée à votre façon de déployer
-- (copier-coller dans l'éditeur SQL, pas de CLI) : chaque migration, à partir de celle-ci, se termine
-- par un insert dans cette table — un simple SELECT dit alors instantanément ce qui a tourné.
--
-- Ce fichier NE contient PAS de réensemencement rétroactif des migrations 0001 à 0041 : je peux
-- confirmer avec certitude que 0037 à 0041 sont bien appliquées (fonctions testées en direct ce jour,
-- voir le fil de discussion), mais pas les précédentes sans les revoir une par une avec vous — exactement
-- ce que vous avez demandé à faire ENSEMBLE plutôt que je ne le déclare unilatéralement. Dites-moi
-- quand vous voulez faire cette passe : je vous donnerai un script d'amorçage (insert ... on conflict
-- do nothing pour chaque version confirmée) une fois qu'on aura vérifié le contenu réel de vos tables.

create table if not exists schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

-- Aucune policy RLS nécessaire : cette table n'est jamais lue/écrite par le client (anon ou
-- authenticated), uniquement consultée directement dans l'éditeur SQL Supabase.
alter table schema_migrations enable row level security;

insert into schema_migrations (version) values ('0042_schema_migrations_tracking') on conflict do nothing;
