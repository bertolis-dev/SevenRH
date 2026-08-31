-- Seven RH — "Vitrine Idées" (proposition roadmap différenciation du 31/08/2026) : la Boîte à idées
-- passe d'une simple liste plate à un board par statut (nouvelle / à l'étude / en cours / livrée /
-- non retenue), pour montrer un vrai suivi de bout en bout plutôt qu'un statut "retenue" qui ne
-- disait jamais ce qu'il advenait ensuite de l'idée (exactement le silence reproché aux tickets
-- support avant leur propre suivi de livraison, 0018_ticket_suivi_livraison.sql).
--
-- 'retenue' devient 'en_cours' (une idée acceptée mais pas encore livrée) ; 'livree' est un nouvel
-- état terminal. Les idées déjà marquées 'retenue' migrent vers 'en_cours' — interprétation la plus
-- proche de ce que "retenue" signifiait réellement (accepté, en cours de traitement), plutôt que de
-- les faire disparaître ou de forcer un état "livrée" qui ne serait pas confirmé.

update idees set statut = 'en_cours' where statut = 'retenue';

alter table idees drop constraint idees_statut_check;
alter table idees add constraint idees_statut_check
  check (statut in ('nouvelle', 'etudiee', 'en_cours', 'livree', 'refusee'));

insert into schema_migrations (version) values ('0043_idees_vitrine_statuts') on conflict do nothing;
