// Seven RH — fonction "bertolis-tickets" : seul point d'accès cross-entreprises aux tickets
// support, utilisé par la console BERTOLIS. Contrairement à billing/manage-employee-account, la
// console BERTOLIS n'a PAS de compte Supabase Auth (choix explicite pour cette itération — voir
// 0017_support_tickets.sql) : elle ne peut donc pas passer par has_permission()/current_company_id()
// avec un jeton d'appelant. La sécurité repose ici entièrement sur un secret partagé (en-tête
// x-bertolis-secret comparé à BERTOLIS_TICKETS_SECRET), vérifié AVANT tout accès service-role.
//
// Compromis assumé : ce secret, une fois codé dans data.js, est visible dans le bundle JS public
// (GitHub Pages). C'est le prix du choix "pas de vrai compte Supabase Auth pour BERTOLIS" — à
// revoir si le nombre de clients grandit. En attendant, chaque action est journalisée dans
// l'audit_log DE L'ENTREPRISE CONCERNÉE (jamais un journal BERTOLIS séparé), pour rester visible par
// le client — même principe que updateCompanyAbonnementStatut (data.js).

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-bertolis-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BERTOLIS_TICKETS_SECRET = Deno.env.get("BERTOLIS_TICKETS_SECRET")!;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

async function logToCompanyAuditLog(supabaseAdmin: any, companyId: string, cible: string, details: string) {
  await supabaseAdmin.from("audit_log").insert({
    company_id: companyId,
    action: "Modification",
    entite: "Ticket support",
    cible,
    details,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const secret = req.headers.get("x-bertolis-secret");
  if (!secret || secret !== BERTOLIS_TICKETS_SECRET) {
    return jsonResponse({ error: "Non autorisé." }, 401);
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Corps de requête invalide." }, 400);
  }

  try {
    if (body.action === "list") {
      // Filtre par défaut sur statut != 'ferme' et plafond fixe — cette requête scanne TOUTES les
      // entreprises, sans jamais laisser un jeu de données non borné (voir support_tickets_statut_created_idx).
      const statutFilter = typeof body.statut === "string" ? body.statut : null;
      let query = supabaseAdmin
        .from("support_tickets")
        .select("*, companies(raison_sociale)")
        .order("created_at", { ascending: false })
        .limit(200);
      query = statutFilter ? query.eq("statut", statutFilter) : query.neq("statut", "ferme");
      const { data, error } = await query;
      if (error) throw error;
      return jsonResponse({ tickets: data });
    }

    if (body.action === "updateStatus") {
      const { ticketId, statut } = body;
      // "livre" (§0018) s'ajoute au parcours — whitelist en dur à synchroniser avec la contrainte
      // SQL support_tickets_statut_check si elle évolue à nouveau.
      if (!ticketId || !["ouvert", "en_cours", "resolu", "livre", "ferme"].includes(statut)) {
        return jsonResponse({ error: "Requête invalide." }, 400);
      }
      const { data: ticket, error: fetchErr } = await supabaseAdmin
        .from("support_tickets")
        .select("id, company_id, titre")
        .eq("id", ticketId)
        .maybeSingle();
      if (fetchErr || !ticket) return jsonResponse({ error: "Ticket introuvable." }, 404);

      // update_ticket_statut (0018_ticket_suivi_livraison.sql) : alimente aussi l'historique
      // horodaté et la date de livraison auto — jamais un simple `.update({statut})`.
      const { error: rpcErr } = await supabaseAdmin.rpc("update_ticket_statut", {
        p_ticket_id: ticketId,
        p_statut: statut,
        p_auteur: "Support BERTOLIS",
      });
      if (rpcErr) throw rpcErr;

      await logToCompanyAuditLog(supabaseAdmin, ticket.company_id, ticket.titre, `Statut changé en « ${statut} » par BERTOLIS`);
      return jsonResponse({ success: true });
    }

    if (body.action === "applyAiSuggestion") {
      // Action manuelle explicite (bouton "Appliquer la suggestion", jamais automatique) : copie la
      // suggestion déjà stockée dans data.aiAnalysis vers les vrais champs categorie/priorite —
      // jamais l'inverse, et jamais déclenché par analyze-ticket lui-même.
      const { ticketId } = body;
      if (!ticketId) return jsonResponse({ error: "Requête invalide." }, 400);

      const { data: ticket, error: fetchErr } = await supabaseAdmin
        .from("support_tickets")
        .select("id, company_id, titre, data")
        .eq("id", ticketId)
        .maybeSingle();
      if (fetchErr || !ticket) return jsonResponse({ error: "Ticket introuvable." }, 404);
      const ai = ticket.data?.aiAnalysis;
      if (!ai) return jsonResponse({ error: "Aucune suggestion IA sur ce ticket." }, 400);

      const patch: Record<string, unknown> = {};
      if (ai.categorieSuggeree) patch.categorie = ai.categorieSuggeree;
      if (ai.prioriteSuggeree && ["basse", "normale", "haute"].includes(ai.prioriteSuggeree)) patch.priorite = ai.prioriteSuggeree;
      const { error: updateErr } = await supabaseAdmin.from("support_tickets").update(patch).eq("id", ticketId);
      if (updateErr) throw updateErr;

      await logToCompanyAuditLog(supabaseAdmin, ticket.company_id, ticket.titre, "Suggestion IA appliquée par BERTOLIS");
      return jsonResponse({ success: true });
    }

    if (body.action === "addComment") {
      const { ticketId, texte } = body;
      if (!ticketId || typeof texte !== "string" || !texte.trim()) {
        return jsonResponse({ error: "Requête invalide." }, 400);
      }
      const { data: ticket, error: fetchErr } = await supabaseAdmin
        .from("support_tickets")
        .select("id, company_id, titre")
        .eq("id", ticketId)
        .maybeSingle();
      if (fetchErr || !ticket) return jsonResponse({ error: "Ticket introuvable." }, 404);

      // "auteur" n'est jamais pris depuis la requête : fixé en dur ici pour qu'un détenteur du
      // secret ne puisse pas usurper un autre nom dans le fil de discussion.
      const { error: rpcErr } = await supabaseAdmin.rpc("append_ticket_comment", {
        p_ticket_id: ticketId,
        p_auteur: "Support BERTOLIS",
        p_texte: texte.trim(),
      });
      if (rpcErr) throw rpcErr;

      await logToCompanyAuditLog(supabaseAdmin, ticket.company_id, ticket.titre, "Réponse ajoutée par BERTOLIS");
      return jsonResponse({ success: true });
    }

    return jsonResponse({ error: "Action inconnue." }, 400);
  } catch (err) {
    console.error("bertolis-tickets error:", err);
    return jsonResponse({ error: "Erreur : " + (err as Error).message }, 500);
  }
});
