-- Seven RH — audit du 09/10/2026 : l'accusé de lecture des documents (et la diffusion à plusieurs
-- salariés) ne survivait pas au rechargement, et un salarié ne pouvait pas confirmer sa lecture.
--
-- Constat (vérifié) : la table documents n'avait aucune colonne pour accuseLectureRequis /
-- accuseLectureAt / accuseLecturePar / diffusionId (documentFromRow/ToRow ne les lisaient pas), donc
-- tout état d'accusé repartait à zéro à chaque rechargement ; et documents_write (0002) exige
-- gererUtilisateurs, si bien que l'écriture du salarié lui-même était refusée sans erreur visible.
--
-- Correctif : 4 colonnes + une fonction dédiée qui ne permet au salarié QUE d'accuser réception de
-- SES PROPRES documents réclamant un accusé, jamais de modifier autre chose (pas de policy UPDATE
-- élargie : RLS ne restreint pas par colonne).

begin;

alter table documents add column if not exists accuse_lecture_requis boolean not null default false;
alter table documents add column if not exists accuse_lecture_at timestamptz;
alter table documents add column if not exists accuse_lecture_par text;
alter table documents add column if not exists diffusion_id text;

create or replace function accuser_lecture_document(p_document_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  nb int;
begin
  update documents
     set accuse_lecture_at = now(),
         accuse_lecture_par = current_employee_id()
   where id = p_document_id
     and company_id = current_company_id()
     and employee_id = current_employee_id()
     and accuse_lecture_requis
     and accuse_lecture_at is null;
  get diagnostics nb = row_count;
  if nb = 0 then
    raise exception 'Aucun accusé de lecture à enregistrer pour ce document.';
  end if;
end;
$$;

revoke all on function accuser_lecture_document(text) from public, anon;
grant execute on function accuser_lecture_document(text) to authenticated;

insert into schema_migrations (version) values ('0066_documents_accuse_lecture') on conflict do nothing;

commit;

notify pgrst, 'reload schema';
