-- Seven RH — durée de conservation + anonymisation des salariés partis (§retour Betty du
-- 11/09/2026, point 4.3) : rien ne purgeait ni n'anonymisait jusqu'ici les données personnelles
-- d'un salarié parti, en violation de l'obligation de durée de conservation limitée (RGPD) — et ça
-- alimente aussi la croissance illimitée du volume par ailleurs traitée au point 1. Anonymisation
-- (jamais suppression, demande explicite de Betty) : seules les données personnelles IDENTIFIANTES
-- sont retirées (nom, prénom, email, téléphone, adresse, date/lieu de naissance, nationalité,
-- numéro de sécurité sociale, photo, civilité, genre) ; les dates, le poste/service, le matricule et
-- les compteurs/historiques financiers restent en place pour que les rapports d'entreprise
-- (masse salariale, effectifs historiques...) restent exploitables après le départ d'un salarié —
-- c'est un compromis assumé entre anonymisation stricte et utilité des rapports, PAS une
-- anonymisation complète au sens le plus strict (un très petit effectif combiné à d'autres données
-- publiques pourrait en théorie ré-identifier quelqu'un) : à faire valider par votre juriste/DPO.
--
-- Durée par défaut : settings.dureeConservationSalariesPartisAnnees (data.js, 5 ans par défaut,
-- modifiable par entreprise depuis Paramètres > Listes > Salariés) — lue depuis la table settings.
--
-- anonymize_employee : logique d'anonymisation d'UNE fiche, réutilisable indépendamment du critère
-- de sélection (utile si un jour Betty veut l'appeler manuellement sur une fiche précise, ex. sur
-- demande RGPD explicite d'un ex-salarié).
create or replace function anonymize_employee(p_employee_id text)
returns void
language plpgsql
as $$
begin
  update employees
  set
    nom = 'Salarié archivé',
    prenom = '',
    email = 'anonymise-' || id || '@archive.local',
    data = data || jsonb_build_object(
      'photo', null,
      'civilite', '',
      'telephone', '',
      'adresse', jsonb_build_object('rue', '', 'codePostal', '', 'ville', ''),
      'dateNaissance', '',
      'lieuNaissance', '',
      'nationalite', '',
      'numeroSecu', '',
      'genre', '',
      'anonymise', true,
      'dateAnonymisation', to_char(now(), 'YYYY-MM-DD')
    ),
    updated_at = now()
  where id = p_employee_id;
end;
$$;

-- anonymize_departed_employees : parcourt TOUTES les entreprises, sélectionne les salariés archivés
-- dont le départ dépasse la durée de conservation de LEUR entreprise, pas encore anonymisés.
-- Retourne le nombre de fiches traitées (utile pour vérifier depuis les logs pg_cron que le job
-- tourne bien). Appelée quotidiennement par pg_cron — MÊME PATRON que process-stale-tickets (voir
-- son commentaire, supabase/functions/process-stale-tickets) mais en SQL pur ici (pas d'email à
-- envoyer, pas besoin d'une Edge Function) : à programmer manuellement depuis le Dashboard Supabase
-- (Database > Cron Jobs > New Job) avec la commande `select anonymize_departed_employees();`,
-- exactement comme process-stale-tickets a dû l'être en son temps (aucun cron.schedule() commis
-- dans ce dépôt jusqu'ici pour cette raison : la configuration se fait à la main sur le Dashboard).
create or replace function anonymize_departed_employees()
returns integer
language plpgsql
as $$
declare
  v_count integer := 0;
  v_employee_id text;
begin
  for v_employee_id in
    select e.id
    from employees e
    left join settings s on s.company_id = e.company_id
    where e.archive = true
      and coalesce(e.data->>'dateDepart', '') != ''
      and (e.data->>'anonymise') is distinct from 'true'
      and (e.data->>'dateDepart')::date
        + (coalesce((s.data->>'dureeConservationSalariesPartisAnnees')::integer, 5) || ' years')::interval
        <= now()
  loop
    perform anonymize_employee(v_employee_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Fonctions de maintenance interne uniquement, jamais appelables via l'API cliente (anon/
-- authenticated) — voir la leçon de 0039/0041 sur "revoke ... from public" seul qui ne suffit pas.
revoke all on function anonymize_employee(text) from public, anon, authenticated;
revoke all on function anonymize_departed_employees() from public, anon, authenticated;

insert into schema_migrations (version) values ('0049_retention_anonymisation') on conflict do nothing;
