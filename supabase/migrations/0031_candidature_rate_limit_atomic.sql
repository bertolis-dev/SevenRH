-- Seven RH — corrige une race condition sur la limite de débit de candidature-submit (bug sweep
-- du 19/08/2026) : la version précédente (0029_candidature_rate_limit.sql) comptait puis insérait
-- en deux appels JS séparés, sans aucun verrou — plusieurs requêtes concurrentes depuis la même IP
-- lisent toutes le même comptage "avant" avant qu'aucune n'ait inséré sa propre ligne, donc un
-- petit burst script/curl peut dépasser RATE_LIMIT_MAX_PER_HOUR (5) sans jamais être bloqué. Cette
-- fonction fait le comptage ET l'insertion dans une seule transaction serveur, sérialisée par un
-- verrou consultatif par IP (pg_advisory_xact_lock) — deux requêtes concurrentes de la même IP sont
-- désormais traitées l'une après l'autre, jamais en parallèle sur le même compteur.
create or replace function check_candidature_rate_limit(p_ip text, p_company_id text, p_limit int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  -- hashtext(p_ip) : verrou scoping par IP (pas un verrou global) — deux IP différentes ne se
  -- bloquent jamais entre elles, seules les requêtes concurrentes d'UNE MÊME IP se sérialisent.
  perform pg_advisory_xact_lock(hashtext(p_ip));
  select count(*) into v_count from candidature_submit_log where ip = p_ip and created_at >= now() - interval '1 hour';
  if v_count >= p_limit then
    return false;
  end if;
  insert into candidature_submit_log (ip, company_id) values (p_ip, p_company_id);
  return true;
end;
$$;

-- Appelée uniquement par candidature-submit via le client service-role.
--
-- §correctif de sécurité du 26/08/2026 (retour QA, point B.1) : le commentaire ci-dessus affirmait
-- à tort que le service-role "bypass déjà tous les grants" — FAUX, BYPASSRLS ne concerne QUE les
-- policies RLS sur les tables, jamais le privilège EXECUTE sur une fonction. Cette fonction n'avait
-- donc AUCUN `revoke ... from public`, et PostgreSQL accorde EXECUTE à PUBLIC (donc à `anon`) par
-- défaut à la création — n'importe qui disposant de la clé anon pouvait l'appeler directement, sans
-- authentification, et épuiser/polluer la table de rate-limit. Corrigé rétroactivement par
-- 0039_revoke_public_execute.sql (une nouvelle migration, pas une modification de celle-ci : cette
-- dernière a déjà été exécutée en production).
