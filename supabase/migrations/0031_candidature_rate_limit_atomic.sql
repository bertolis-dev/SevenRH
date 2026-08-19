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

-- Appelée uniquement par candidature-submit (clé service-role, qui bypass déjà tous les grants) —
-- aucun grant à `authenticated`/`anon`, même raisonnement que set_candidature_statut.
