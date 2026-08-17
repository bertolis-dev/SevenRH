-- Seven RH — postes souhaités par le candidat (demande du 17/08/2026), choisis parmi
-- settings.postesOuverts (géré depuis l'écran Embauche) au moment du dépôt.
alter table candidatures add column if not exists postes jsonb not null default '[]'::jsonb;

-- get_company_public_info (0025_company_logo.sql) doit maintenant aussi exposer les postes
-- ouverts au visiteur public (page de candidature) — recréée avec une colonne en plus. `settings`
-- est déjà company-wide readable pour authenticated (0002_rls_policies.sql) mais PAS pour un
-- visiteur sans compte : cette fonction reste le seul chemin public, comme pour le nom/logo.
drop function if exists get_company_public_info(text);

create or replace function get_company_public_info(p_company_id text)
returns table(raison_sociale text, logo text, postes_ouverts jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select c.raison_sociale, c.data->>'logo', coalesce(s.data->'postesOuverts', '[]'::jsonb)
  from companies c
  left join settings s on s.company_id = c.id
  where c.id = p_company_id;
$$;

grant execute on function get_company_public_info(text) to anon, authenticated;
