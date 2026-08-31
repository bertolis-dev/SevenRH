-- Seven RH — refonte "historique d'activité par fiche" (01/09/2026) : le journal d'audit
-- (audit_log) ne conservait jamais QUI avait fait une action, seulement quoi/quand/sur quoi
-- (logAudit(action, entite, cible, details), data.js). Impossible jusqu'ici d'afficher "modifié le
-- 12/08 par..." sur une fiche salarié faute de la donnée elle-même.
--
-- Colonne nullable : les entrées déjà en base (avant ce correctif) restent lisibles, simplement
-- sans auteur connu (affiché tel quel côté app, jamais une valeur inventée). Aucun changement RLS
-- nécessaire : les policies existantes sur audit_log s'appliquent déjà à toute nouvelle colonne.

alter table audit_log add column if not exists auteur text;

insert into schema_migrations (version) values ('0044_audit_log_auteur') on conflict do nothing;
