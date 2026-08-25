-- Seven RH — traitement automatique des tickets support (audit du 23/08/2026, §6.8).
--
-- "Ce que nous demandons : un brouillon de réponse généré par l'IA, une clôture automatique après
-- 7 jours d'inactivité sur un ticket terminé/livré (avec une relance avant de fermer), et la
-- possibilité de rouvrir." Découpage :
--   1. Le brouillon de réponse (reponseSuggeree) est ajouté à l'analyse IA existante
--      (analyze-ticket/index.ts) — jamais envoyé seul, une action BERTOLIS explicite reste
--      nécessaire (même principe que categorieSuggeree/prioriteSuggeree, jamais automatique).
--   2. La relance + clôture automatique après inactivité est gérée par la nouvelle Edge Function
--      process-stale-tickets, appelée quotidiennement par pg_cron (voir instructions de
--      déploiement) — colonne de suivi ajoutée ci-dessous.
--   3. La réouverture existait déjà pour un salarié via le bouton "Rouvrir" (resolu/livre
--      uniquement, app.js:renderTicketDetail) ; on l'étend ici à un ticket FERMÉ automatiquement :
--      tout nouveau commentaire sur un ticket fermé le rouvre implicitement (une réponse à un
--      ticket fermé est de fait une demande de réouverture).

alter table support_tickets add column if not exists relance_fermeture_envoyee_at timestamptz;

-- §6.8 : une nouvelle réponse (salarié ou BERTOLIS) relance le délai de clôture automatique (le
-- silence de 7 jours redémarre), et rouvre un ticket déjà fermé.
create or replace function append_ticket_comment(p_ticket_id text, p_auteur text, p_texte text)
returns void
language sql
as $$
  update support_tickets
  set data = jsonb_set(
        data,
        '{comments}',
        coalesce(data->'comments', '[]'::jsonb) || jsonb_build_array(
          jsonb_build_object('auteur', p_auteur, 'texte', p_texte, 'date', now())
        )
      ),
      statut = case when statut = 'ferme' then 'en_cours' else statut end,
      relance_fermeture_envoyee_at = null,
      updated_at = now()
  where id = p_ticket_id;
$$;

-- Inchangée dans son comportement existant (historique, date_livraison) — ajoute seulement la
-- remise à zéro du compteur de relance dès qu'on quitte resolu/livre (repris manuellement, donc
-- plus besoin d'une clôture automatique programmée).
create or replace function update_ticket_statut(p_ticket_id text, p_statut text, p_auteur text)
returns void
language sql
as $$
  update support_tickets
  set statut = p_statut,
      date_livraison = case when p_statut = 'livre' then coalesce(date_livraison, now()) else null end,
      relance_fermeture_envoyee_at = case when p_statut in ('resolu', 'livre') then relance_fermeture_envoyee_at else null end,
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
