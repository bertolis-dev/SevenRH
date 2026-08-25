// Seven RH — fonction "process-stale-tickets" : clôture automatique des tickets support restés
// "resolu"/"livre" sans réaction du salarié (audit du 23/08/2026, §6.8 : "clôture automatique après
// 7 jours d'inactivité, avec une relance avant de fermer").
//
// Appelée une fois par jour par pg_cron (voir instructions de déploiement — pas par le site, qui
// n'a aucune tâche de fond persistante). Deux passes indépendantes à chaque appel :
//   1. Tickets resolu/livre, jamais relancés, inactifs depuis 4 jours -> un commentaire + un email
//      de relance, et on marque relance_fermeture_envoyee_at (0036_tickets_traitement_auto.sql).
//   2. Tickets resolu/livre, déjà relancés depuis 3 jours (donc 7 jours d'inactivité au total) ->
//      clôture (statut ferme) + email expliquant la réouverture possible.
// Un ticket avec la moindre activité entre-temps (commentaire, changement de statut) sort de ces
// deux listes de lui-même : append_ticket_comment/update_ticket_statut remettent
// relance_fermeture_envoyee_at à NULL dès qu'il y a un mouvement (0036).
//
// Sécurité : même secret partagé que bertolis-tickets (BERTOLIS_TICKETS_SECRET) plutôt qu'un
// nouveau à configurer en plus — cette fonction n'a pas de notion d'entreprise appelante (elle scanne
// toutes les entreprises par nature), un vrai jeton utilisateur n'aurait ici aucun sens.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-bertolis-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BERTOLIS_TICKETS_SECRET = Deno.env.get("BERTOLIS_TICKETS_SECRET")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;

const RELANCE_APRES_JOURS = 4;
const FERMETURE_APRES_RELANCE_JOURS = 3; // + 4 ci-dessus = 7 jours d'inactivité au total

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function ticketEmailShell(titleHtml: string, bodyHtml: string): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:32px 0;">
      <tr><td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
          <tr><td style="background-color:#1c2b4a;padding:20px 32px;">
            <span style="color:#ffffff;font-size:20px;font-weight:bold;">Nexus RH</span>
          </td></tr>
          <tr><td style="padding:32px;color:#1f2937;">
            <h1 style="font-size:18px;margin:0 0 16px;color:#1c2b4a;">${titleHtml}</h1>
            ${bodyHtml}
          </td></tr>
        </table>
      </td></tr>
    </table>
  `;
}

async function sendEmail(email: string, subject: string, html: string) {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "Nexus RH <B.bertolis@nexus-rh.com>", to: email, subject, html }),
    });
    if (!res.ok) console.error("process-stale-tickets sendEmail Resend error:", await res.text());
  } catch (err) {
    console.error("process-stale-tickets sendEmail error:", err);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const secret = req.headers.get("x-bertolis-secret");
  if (!secret || secret !== BERTOLIS_TICKETS_SECRET) {
    return jsonResponse({ error: "Non autorisé." }, 401);
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const nowIso = new Date().toISOString();
  const relanceSeuil = new Date(Date.now() - RELANCE_APRES_JOURS * 86400000).toISOString();
  const fermetureSeuil = new Date(Date.now() - FERMETURE_APRES_RELANCE_JOURS * 86400000).toISOString();

  let relances = 0;
  let fermetures = 0;

  try {
    // ---- Passe 1 : relance avant fermeture ----
    const { data: aRelancer, error: relanceErr } = await supabaseAdmin
      .from("support_tickets")
      .select("id, company_id, employee_id, titre")
      .in("statut", ["resolu", "livre"])
      .is("relance_fermeture_envoyee_at", null)
      .lt("updated_at", relanceSeuil);
    if (relanceErr) throw relanceErr;

    for (const ticket of aRelancer || []) {
      const texte = "Ce ticket est marqué comme terminé depuis plusieurs jours et n'a plus reçu de réponse. "
        + "Sans nouvelle de votre part, il sera automatiquement fermé dans 3 jours. "
        + "Répondez simplement à ce message si vous avez encore besoin d'aide.";
      const { error: commentErr } = await supabaseAdmin.rpc("append_ticket_comment", {
        p_ticket_id: ticket.id,
        p_auteur: "Support BERTOLIS (automatique)",
        p_texte: texte,
      });
      if (commentErr) { console.error("append_ticket_comment error:", commentErr); continue; }

      // La ligne ci-dessus vient de remettre relance_fermeture_envoyee_at à NULL (comportement
      // normal d'append_ticket_comment, 0036) : on la pose donc APRÈS, dans un second appel distinct.
      await supabaseAdmin.from("support_tickets").update({ relance_fermeture_envoyee_at: nowIso }).eq("id", ticket.id);

      const { data: employee } = await supabaseAdmin.from("employees").select("prenom, email").eq("id", ticket.employee_id).maybeSingle();
      if (employee?.email) {
        await sendEmail(employee.email, `Toujours besoin d'aide ? : ${ticket.titre}`, ticketEmailShell(
          "Votre ticket va bientôt être clôturé",
          `<p style="font-size:14px;line-height:1.5;margin:0 0 12px;">Bonjour ${escapeHtml(employee.prenom || "")},</p>
           <p style="font-size:14px;line-height:1.5;margin:0 0 12px;">Votre demande <strong>"${escapeHtml(ticket.titre)}"</strong> est marquée comme terminée depuis plusieurs jours.</p>
           <p style="font-size:14px;line-height:1.5;margin:0 0 20px;">Si tout est résolu, vous n'avez rien à faire : le ticket sera fermé automatiquement dans 3 jours. Si vous avez encore besoin d'aide, répondez simplement depuis "Mes tickets" dans l'application.</p>`
        ));
      }
      await supabaseAdmin.from("audit_log").insert({
        company_id: ticket.company_id, action: "Modification", entite: "Ticket support", cible: ticket.titre,
        details: "Relance automatique avant clôture (7 jours d'inactivité)",
      });
      relances++;
    }

    // ---- Passe 2 : clôture après relance restée sans réponse ----
    const { data: aFermer, error: fermerErr } = await supabaseAdmin
      .from("support_tickets")
      .select("id, company_id, employee_id, titre")
      .in("statut", ["resolu", "livre"])
      .not("relance_fermeture_envoyee_at", "is", null)
      .lt("relance_fermeture_envoyee_at", fermetureSeuil);
    if (fermerErr) throw fermerErr;

    for (const ticket of aFermer || []) {
      const { error: rpcErr } = await supabaseAdmin.rpc("update_ticket_statut", {
        p_ticket_id: ticket.id, p_statut: "ferme", p_auteur: "Support BERTOLIS (automatique)",
      });
      if (rpcErr) { console.error("update_ticket_statut error:", rpcErr); continue; }

      const { data: employee } = await supabaseAdmin.from("employees").select("prenom, email").eq("id", ticket.employee_id).maybeSingle();
      if (employee?.email) {
        await sendEmail(employee.email, `Ticket clôturé : ${ticket.titre}`, ticketEmailShell(
          "Votre ticket a été clôturé",
          `<p style="font-size:14px;line-height:1.5;margin:0 0 12px;">Bonjour ${escapeHtml(employee.prenom || "")},</p>
           <p style="font-size:14px;line-height:1.5;margin:0 0 20px;">Votre demande <strong>"${escapeHtml(ticket.titre)}"</strong> a été clôturée automatiquement, restée sans réponse après la relance. Vous pouvez la rouvrir à tout moment en répondant depuis "Mes tickets" dans l'application.</p>`
        ));
      }
      await supabaseAdmin.from("audit_log").insert({
        company_id: ticket.company_id, action: "Modification", entite: "Ticket support", cible: ticket.titre,
        details: "Clôture automatique (7 jours d'inactivité, relance restée sans réponse)",
      });
      fermetures++;
    }

    return jsonResponse({ success: true, relances, fermetures });
  } catch (err) {
    console.error("process-stale-tickets error:", err);
    return jsonResponse({ error: "Erreur : " + (err as Error).message }, 500);
  }
});
