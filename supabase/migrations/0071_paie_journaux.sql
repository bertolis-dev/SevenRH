-- Seven RH — pont Nexus Gestion, phase 2 (14/10/2026) : journal de paie mensuel.
--
-- Nexus RH ne calcule pas la paie. Le brut, les charges et le net viennent du logiciel de paie externe : la personne
-- habilitée les saisit (ou importe le journal CSV/Excel) pour que l'export vers Nexus Gestion puisse remplir son bloc
-- « paie ». Ces totaux sont des données financières sensibles : ils ne vont PAS dans companies.settings ni dans
-- companies.data (lisibles par toute l'entreprise via l'API), mais dans une table à part, réservée à ceux qui ont
-- le droit « voirInfosFinancieres » (propriétaire, directeur ; le RH seulement si ce droit lui a été accordé).
--
-- Une ligne par entreprise et par mois (periode = AAAA-MM) ; data = {brut, charges_salariales, charges_patronales,
-- net_a_payer, date_paiement, detail_par_organisme:[{organisme, montant}]}.

begin;

create table if not exists paie_journaux (
  company_id text not null references companies(id) on delete cascade,
  periode text not null check (periode ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (company_id, periode)
);

alter table paie_journaux enable row level security;

revoke all on paie_journaux from anon;
grant select, insert, update, delete on paie_journaux to authenticated;

create policy paie_journaux_select on paie_journaux for select
  using (company_id = current_company_id() and has_permission('voirInfosFinancieres'));

create policy paie_journaux_insert on paie_journaux for insert
  with check (company_id = current_company_id() and has_permission('voirInfosFinancieres'));

create policy paie_journaux_update on paie_journaux for update
  using (company_id = current_company_id() and has_permission('voirInfosFinancieres'))
  with check (company_id = current_company_id() and has_permission('voirInfosFinancieres'));

create policy paie_journaux_delete on paie_journaux for delete
  using (company_id = current_company_id() and has_permission('voirInfosFinancieres'));

-- Les clients lisent la table directement (API) : on recharge le cache de schéma pour que la table soit visible tout de suite.
notify pgrst, 'reload schema';

insert into schema_migrations (version) values ('0071_paie_journaux') on conflict do nothing;

commit;
