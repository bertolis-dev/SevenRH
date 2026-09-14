-- Seven RH — retour Betty du 14/09/2026 (revue concurrentielle, Entretiens) : colonnes additives
-- (toutes nullables, aucun backfill nécessaire) pour les trames paramétrables, la préparation
-- croisée, les objectifs reconduits, la validation bilatérale et le besoin de formation exprimé.
-- Les campagnes elles-mêmes (nom, population, échéance) vivent dans le blob "profil entreprise"
-- (company.entretienCampagnes, voir DB.lancerCampagneEntretiens, data.js) comme les modèles de
-- semaine ou les dossiers de frais — seule la référence campagne_id est stockée ici, sans contrainte
-- de clé étrangère (la campagne n'est pas une table).

alter table entretiens add column if not exists trame_id text;
alter table entretiens add column if not exists reponses_auto_evaluation jsonb not null default '{}'::jsonb;
alter table entretiens add column if not exists reponses_retour_manager jsonb not null default '{}'::jsonb;
alter table entretiens add column if not exists besoins_formation text;
alter table entretiens add column if not exists validation_employe jsonb;
alter table entretiens add column if not exists validation_manager jsonb;
alter table entretiens add column if not exists campagne_id text;

insert into schema_migrations (version) values ('0054_entretiens_campagne_trame') on conflict do nothing;

notify pgrst, 'reload schema';
