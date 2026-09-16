-- Seven RH — correctif de sécurité/fonctionnel sur la délégation de validation (14/09/2026,
-- cbc405e) : côté client, isManagerOfEmployee (app.js) traite déjà un délégataire comme manager
-- pendant la fenêtre de délégation — l'écran affiche donc bien les boutons Valider/Refuser au bon
-- salarié. Mais l'écriture réelle (validation d'un congé/d'une note de frais) passe par un simple
-- UPDATE Supabase, filtré côté serveur par les policies RLS qui appellent TOUTES la même fonction
-- is_manager_of() (0002_rls_policies.sql) — jamais mise à jour pour connaître les délégations.
--
-- Résultat concret avant ce correctif : un délégataire voit le bouton "Valider" (autorité côté
-- client), clique, l'UPDATE est silencieusement refusé par RLS (0 ligne affectée, pas d'exception
-- levée côté client de la façon dont pushLeaveRequests/pushExpenses gèrent une réponse Supabase) —
-- la demande reste "En attente" côté serveur alors que l'écran peut sembler l'avoir validée jusqu'au
-- prochain rechargement. Même classe de bug que le correctif QR de pointage de ce même sprint
-- (autorité client/serveur qui divergent), mais jamais couverte par le test de la délégation
-- (tests/delegation-validation-14-09.test.js), qui mocke entièrement SupabaseSync et ne passe donc
-- jamais par ce chemin RLS réel.
--
-- is_manager_of() est LE choke-point unique déjà utilisé par toutes les policies concernées
-- (employees, leave_requests, expenses, entretiens, demandes_pour_autrui, storage...) : le corriger
-- une seule fois ici suffit à tout le reste, exactement comme isManagerOfEmployee côté client a été
-- étendu plutôt que dupliqué par domaine.
create or replace function is_manager_of(target_employee_id text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from employees target
    where target.id = target_employee_id
      and (
        current_employee_id() = any(target.manager_ids)
        or exists (
          select 1
          from employees mgr
          cross join lateral jsonb_array_elements(coalesce(mgr.data->'delegations', '[]'::jsonb)) as d
          where mgr.id = any(target.manager_ids)
            and d->>'delegataireId' = current_employee_id()
            and (d->>'dateDebut')::date <= current_date
            and (d->>'dateFin')::date >= current_date
        )
      )
  );
$$;

insert into schema_migrations (version) values ('0057_is_manager_of_delegation') on conflict do nothing;
