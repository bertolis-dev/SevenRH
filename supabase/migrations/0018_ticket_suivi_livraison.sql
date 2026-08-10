-- Seven RH — suivi de livraison des tickets support (§sprint calendrier/demi-journée/tickets/IA).
-- Ajoute un 5e statut "livre" (Livré) au parcours existant ouvert→en_cours→resolu→ferme, avec une
-- date de livraison horodatée automatiquement, et un historique de changements de statut — sur le
-- même principe que leave_requests.data.historique (0001_init_schema.sql), jamais utilisé jusqu'ici
-- sur les tickets. Correspondance des libellés côté app.js (TICKET_STATUT_LABELS) :
--   ouvert = "Nouvelle demande", en_cours = "En cours" (inchangé), resolu = "Terminé" (renommé),
--   livre = "Livré" (nouveau), ferme = "Fermé" (clôture hors parcours normal, ex. doublon/annulé).

alter table support_tickets drop constraint support_tickets_statut_check;
alter table support_tickets add constraint support_tickets_statut_check
  check (statut in ('ouvert', 'en_cours', 'resolu', 'livre', 'ferme'));

alter table support_tickets add column date_livraison timestamptz;

-- Append atomique du statut + historique horodaté — même logique qu'append_ticket_comment
-- (0017_support_tickets.sql) : un seul `update`, jamais de lire-modifier-réécrire côté client/Edge
-- Function, pour ne jamais écraser un commentaire ajouté presque au même moment par l'autre partie.
-- `security invoker` : appelée par un salarié authentifié (ex. réouverture de son propre ticket),
-- l'update interne reste soumis à la policy support_tickets_update ; appelée par bertolis-tickets via
-- un client service-role, RLS est bypassée (le secret de la fonction fait alors office de garde-fou).
create or replace function update_ticket_statut(p_ticket_id text, p_statut text, p_auteur text)
returns void
language sql
as $$
  update support_tickets
  set statut = p_statut,
      date_livraison = case when p_statut = 'livre' then coalesce(date_livraison, now()) else null end,
      data = jsonb_set(
        data,
        '{historique}',
        coalesce(data->'historique', '[]'::jsonb) || jsonb_build_array(
          jsonb_build_object('date', now(), 'action', 'Statut changé en « ' || p_statut || ' »', 'auteur', p_auteur)
        )
      ),
      updated_at = now()
  where id = p_ticket_id;
$$;

-- Écrit la suggestion IA (§4, analyse automatique par Claude) — jamais les champs `categorie`/
-- `priorite` eux-mêmes (jamais silencieuse, voir analyze-ticket/index.ts) : une clé séparée
-- `data.aiAnalysis`, affichée distinctement côté app.js. `jsonb_set` atomique pour la même raison
-- que ci-dessus (l'analyse arrive en tâche de fond, en parallèle possible d'un premier commentaire).
create or replace function update_ticket_ai_analysis(p_ticket_id text, p_analysis jsonb)
returns void
language sql
as $$
  update support_tickets
  set data = jsonb_set(data, '{aiAnalysis}', p_analysis),
      updated_at = now()
  where id = p_ticket_id;
$$;
