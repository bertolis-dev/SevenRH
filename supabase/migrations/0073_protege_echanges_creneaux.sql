-- Seven RH — protège les échanges de créneaux contre l'écrasement par un administrateur (suite de 0072, 14/10/2026).
--
-- Constat : les propositions d'échange (data->'shiftSwapRequests') sont maintenant écrites par echange_shift_action (0072), mais
-- elles vivent dans le même bloc companies.data que les réglages. Un administrateur dont la page est restée ouverte envoie, à chaque
-- enregistrement d'un réglage, SA copie du bloc entier : toute proposition faite depuis son chargement disparaissait, et un quart
-- déjà validé retournait à son ancien titulaire. Même remède que pour les pointages (0070) :
--   1. les demandes d'échange du SERVEUR l'emportent (c'est echange_shift_action qui les modifie) ; celles que le client envoie en
--      plus sont ajoutées ;
--   2. pour une demande que le serveur a déjà VALIDÉE alors que le client la croit encore ouverte ou l'ignore, le quart concerné
--      est réaffecté au repreneur dans les quarts envoyés (si le client sait qu'elle est validée, ses quarts font foi : un
--      administrateur a pu les modifier ensuite).
-- Le reste de save_company_profile est inchangé par rapport à 0070.

begin;

create or replace function save_company_profile(p_raison_sociale text, p_data jsonb, p_inclure_pointages boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company text := current_company_id();
  v_serveur jsonb;
  v_client jsonb;
  v_fusion jsonb;
  v_demandes_serveur jsonb;
  v_demandes_client jsonb;
  v_demandes jsonb;
  v_quarts jsonb;
  v_data jsonb;
begin
  if v_company is null then
    raise exception 'Non authentifié.';
  end if;
  if not has_permission('gererParametres') then
    raise exception 'Permission refusée.';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'Données invalides.';
  end if;

  select coalesce(data->'pointages', '[]'::jsonb), coalesce(data->'shiftSwapRequests', '[]'::jsonb)
    into v_serveur, v_demandes_serveur
    from companies where id = v_company for update;

  if p_inclure_pointages and jsonb_typeof(p_data->'pointages') = 'array' then
    v_client := p_data->'pointages';
    -- Fusion par identifiant : les pointages du serveur absents de la liste de l'appelant sont conservés, ceux
    -- qu'il envoie remplacent le même identifiant.
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_fusion from (
      select e as x from jsonb_array_elements(v_serveur) e
       where not exists (select 1 from jsonb_array_elements(v_client) c where c->>'id' = e->>'id')
      union all
      select c from jsonb_array_elements(v_client) c
    ) t;
  else
    v_fusion := v_serveur;
  end if;

  v_data := jsonb_set(p_data, '{pointages}', v_fusion);

  -- Demandes d'échange de créneaux : le serveur fait foi.
  v_demandes_client := case when jsonb_typeof(p_data->'shiftSwapRequests') = 'array' then p_data->'shiftSwapRequests' else '[]'::jsonb end;
  select coalesce(jsonb_agg(x order by ord), '[]'::jsonb) into v_demandes from (
    select e as x, ord from jsonb_array_elements(v_demandes_serveur) with ordinality as t(e, ord)
    union all
    select c, 1000000 + ord from jsonb_array_elements(v_demandes_client) with ordinality as u(c, ord)
     where not exists (select 1 from jsonb_array_elements(v_demandes_serveur) s where s->>'id' = c->>'id')
  ) m;
  v_data := jsonb_set(v_data, '{shiftSwapRequests}', v_demandes);

  -- Quart déjà réaffecté par une validation que le client ne connaît pas encore : on ne le remet pas à l'ancien titulaire.
  if jsonb_typeof(p_data->'shifts') = 'array' then
    v_quarts := p_data->'shifts';
    select coalesce(jsonb_agg(
             case when exists (
                    select 1 from jsonb_array_elements(v_demandes_serveur) s
                     where s->>'statut' = 'validé' and s->>'shiftId' = q->>'id'
                       and coalesce((select c->>'statut' from jsonb_array_elements(v_demandes_client) c where c->>'id' = s->>'id' limit 1), '') <> 'validé'
                  )
                  then q || jsonb_build_object('employeeId', (select s->>'destinataireId' from jsonb_array_elements(v_demandes_serveur) s
                                                              where s->>'statut' = 'validé' and s->>'shiftId' = q->>'id' limit 1))
                  else q end
             order by ord), '[]'::jsonb)
      into v_quarts from jsonb_array_elements(v_quarts) with ordinality as t(q, ord);
    v_data := jsonb_set(v_data, '{shifts}', v_quarts);
  end if;

  update companies
     set raison_sociale = coalesce(p_raison_sociale, raison_sociale),
         data = v_data
   where id = v_company;
end;
$$;

revoke all on function save_company_profile(text, jsonb, boolean) from public, anon;
grant execute on function save_company_profile(text, jsonb, boolean) to authenticated;

insert into schema_migrations (version) values ('0073_protege_echanges_creneaux') on conflict do nothing;

commit;
