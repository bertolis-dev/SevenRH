-- Seven RH — échange de créneaux entre salariés (point laissé en attente par la revue du 13/10/2026, traité le 14/10/2026).
--
-- Constat : les quarts (data->'shifts') et les demandes d'échange (data->'shiftSwapRequests') vivent dans le bloc
-- companies.data, que seul un compte ayant « gererParametres » peut écrire (save_company_profile). Un salarié ne pouvait donc
-- ni proposer ni prendre un créneau, et un manager ne pouvait pas valider : tout était refusé en silence par le serveur.
--
-- Même remède que pour le pointage (0068/0070) : une fonction qui n'écrit QUE ce qui concerne l'appelant, après contrôle.
--   proposer : le salarié propose l'un de SES quarts (une seule proposition ouverte par quart) ;
--   accepter : un AUTRE salarié se propose pour le reprendre (statut « accepté », en attente de validation) ;
--   traiter  : le manager du proposant (ou un compte ayant « modifierSalarie ») valide (le quart passe au repreneur) ou refuse.
-- Rien n'est réaffecté avant la validation.

begin;

create or replace function echange_shift_action(p_action text, p_request_id text, p_shift_id text default null, p_accepter boolean default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp text := current_employee_id();
  v_company text := current_company_id();
  v_data jsonb;
  v_requests jsonb;
  v_shifts jsonb;
  v_req jsonb;
  v_shift jsonb;
  v_maintenant text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if v_emp is null or v_company is null then
    raise exception 'Non authentifié.';
  end if;
  if p_request_id is null or length(trim(p_request_id)) = 0 then
    raise exception 'Demande invalide.';
  end if;

  select coalesce(data, '{}'::jsonb) into v_data from companies where id = v_company for update;
  v_requests := coalesce(v_data->'shiftSwapRequests', '[]'::jsonb);
  v_shifts := coalesce(v_data->'shifts', '[]'::jsonb);

  if p_action = 'proposer' then
    select s into v_shift from jsonb_array_elements(v_shifts) s where s->>'id' = p_shift_id limit 1;
    if v_shift is null then
      raise exception 'Quart introuvable.';
    end if;
    if v_shift->>'employeeId' is distinct from v_emp then
      raise exception 'Vous ne pouvez proposer que vos propres quarts.';
    end if;
    if exists (select 1 from jsonb_array_elements(v_requests) r where r->>'id' = p_request_id) then
      raise exception 'Demande déjà enregistrée.';
    end if;
    if exists (select 1 from jsonb_array_elements(v_requests) r
                where r->>'shiftId' = p_shift_id and coalesce(r->>'statut', '') not in ('refusé', 'validé')) then
      raise exception 'Une proposition est déjà en cours pour ce quart.';
    end if;
    v_req := jsonb_build_object(
      'id', p_request_id, 'shiftId', p_shift_id, 'employeeId', v_emp, 'destinataireId', null,
      'statut', 'proposé', 'dateCreation', v_maintenant, 'dateTraitement', null
    );
    v_requests := v_requests || jsonb_build_array(v_req);

  elsif p_action = 'accepter' then
    select r into v_req from jsonb_array_elements(v_requests) r where r->>'id' = p_request_id limit 1;
    if v_req is null then
      raise exception 'Demande introuvable.';
    end if;
    if v_req->>'statut' is distinct from 'proposé' then
      raise exception 'Ce créneau n''est plus disponible.';
    end if;
    if v_req->>'employeeId' is not distinct from v_emp then
      raise exception 'Vous ne pouvez pas reprendre votre propre quart.';
    end if;
    v_req := v_req || jsonb_build_object('destinataireId', v_emp, 'statut', 'accepté');
    select jsonb_agg(case when r->>'id' = p_request_id then v_req else r end order by ord)
      into v_requests from jsonb_array_elements(v_requests) with ordinality as t(r, ord);

  elsif p_action = 'traiter' then
    if p_accepter is null then
      raise exception 'Décision manquante.';
    end if;
    select r into v_req from jsonb_array_elements(v_requests) r where r->>'id' = p_request_id limit 1;
    if v_req is null then
      raise exception 'Demande introuvable.';
    end if;
    if v_req->>'statut' is distinct from 'accepté' then
      raise exception 'Cette demande n''est pas en attente de validation.';
    end if;
    if not (is_manager_of(v_req->>'employeeId') or has_permission('modifierSalarie')) then
      raise exception 'Permission refusée.';
    end if;
    if p_accepter then
      select jsonb_agg(case when s->>'id' = v_req->>'shiftId' then s || jsonb_build_object('employeeId', v_req->>'destinataireId') else s end order by ord)
        into v_shifts from jsonb_array_elements(v_shifts) with ordinality as t(s, ord);
      v_req := v_req || jsonb_build_object('statut', 'validé', 'dateTraitement', v_maintenant);
    else
      v_req := v_req || jsonb_build_object('statut', 'refusé', 'dateTraitement', v_maintenant);
    end if;
    select jsonb_agg(case when r->>'id' = p_request_id then v_req else r end order by ord)
      into v_requests from jsonb_array_elements(v_requests) with ordinality as t(r, ord);

  else
    raise exception 'Action inconnue.';
  end if;

  update companies
     set data = jsonb_set(jsonb_set(v_data, '{shiftSwapRequests}', coalesce(v_requests, '[]'::jsonb), true), '{shifts}', coalesce(v_shifts, '[]'::jsonb), true)
   where id = v_company;

  return v_req;
end;
$$;

revoke all on function echange_shift_action(text, text, text, boolean) from public, anon;
grant execute on function echange_shift_action(text, text, text, boolean) to authenticated;

insert into schema_migrations (version) values ('0072_echange_creneaux_rpc') on conflict do nothing;

commit;
