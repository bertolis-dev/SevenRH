// Seven RH — fonction "notify-bertolis-ticket" : envoie un email à BERTOLIS quand un salarié crée
// un ticket support, pour ne plus dépendre d'une consultation manuelle de la console (voir
// bertolis-tickets/index.ts pour la lecture cross-entreprises), ET une confirmation au salarié
// auteur (demande du 19/08/2026 — jusqu'ici, seul BERTOLIS était notifié, le salarié n'avait aucune
// preuve que son ticket était bien parti). Appelée par le site juste après DB.addSupportTicket
// (data.js), en tâche de fond — un échec d'envoi n'empêche jamais la création du ticket côté
// salarié, et un échec de L'UNE des deux confirmations n'empêche jamais l'autre (voir
// sendTicketConfirmationEmail, jamais de throw).
//
// Sécurité : comme billing/manage-employee-account, has_permission()/current_company_id() sont
// appelées AVEC LE JETON DE L'APPELANT pour vérifier que le ticket appartient bien à SON entreprise
// avant d'en réutiliser le contenu dans l'email — un salarié ne peut pas déclencher un email pour le
// ticket de quelqu'un d'autre. Le contenu de l'email (titre/description/auteur) est relu depuis la
// base via le client service-role plutôt que fait confiance au corps de la requête, pour éviter
// qu'un email falsifié ne soit envoyé avec un contenu différent de ce qui est réellement enregistré.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const BERTOLIS_NOTIFY_EMAIL = Deno.env.get("BERTOLIS_NOTIFY_EMAIL")!;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Confirmation envoyée AU SALARIÉ auteur du ticket — jamais bloquante : un échec d'envoi ne doit
 * jamais faire échouer la création du ticket (déjà enregistrée en base) ni la notification BERTOLIS
 * ci-dessous, juste être journalisé (même principe que sendConfirmationEmail, candidature-submit). */
async function sendTicketConfirmationEmail(email: string, prenom: string, titre: string) {
  const html = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:32px 0;">
      <tr><td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
          <tr><td style="background-color:#1c2b4a;padding:20px 32px;">
            <span style="color:#ffffff;font-size:20px;font-weight:bold;">Nexus RH</span>
          </td></tr>
          <tr><td style="padding:32px;color:#1f2937;">
            <h1 style="font-size:18px;margin:0 0 16px;color:#1c2b4a;">Ticket reçu</h1>
            <p style="font-size:14px;line-height:1.5;margin:0 0 12px;">Bonjour ${escapeHtml(prenom)},</p>
            <p style="font-size:14px;line-height:1.5;margin:0 0 12px;">Votre demande <strong>"${escapeHtml(titre)}"</strong> a bien été reçue et transmise au support.</p>
            <p style="font-size:13px;color:#6b7280;margin:0;">Vous pourrez suivre son avancement et voir la réponse depuis "Mes tickets" dans l'application.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  `;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Nexus RH <B.bertolis@nexus-rh.com>",
        to: email,
        subject: `Ticket reçu : ${titre}`,
        html,
      }),
    });
    if (!res.ok) console.error("sendTicketConfirmationEmail Resend error:", await res.text());
  } catch (err) {
    console.error("sendTicketConfirmationEmail error:", err);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Non authentifié." }, 401);

  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Corps de requête invalide." }, 400);
  }
  const { ticketId } = body;
  if (!ticketId) return jsonResponse({ error: "ticketId manquant." }, 400);

  const { data: companyId, error: companyErr } = await supabaseUser.rpc("current_company_id");
  if (companyErr || !companyId) return jsonResponse({ error: "Entreprise introuvable pour ce compte." }, 400);

  const { data: ticket, error: ticketErr } = await supabaseAdmin
    .from("support_tickets")
    .select("id, employee_id, titre, description, categorie, priorite")
    .eq("id", ticketId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (ticketErr || !ticket) return jsonResponse({ error: "Ticket introuvable." }, 404);

  const [{ data: employee }, { data: company }] = await Promise.all([
    supabaseAdmin.from("employees").select("prenom, nom, email").eq("id", ticket.employee_id).maybeSingle(),
    supabaseAdmin.from("companies").select("raison_sociale").eq("id", companyId).maybeSingle(),
  ]);

  const auteur = employee ? `${employee.prenom} ${employee.nom} (${employee.email})` : "Salarié inconnu";

  const html = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:32px 0;">
      <tr><td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
          <tr><td style="background-color:#1c2b4a;padding:20px 32px;">
            <span style="color:#ffffff;font-size:20px;font-weight:bold;">Nexus RH</span>
          </td></tr>
          <tr><td style="padding:32px;color:#1f2937;">
            <h1 style="font-size:18px;margin:0 0 16px;color:#1c2b4a;">Nouveau ticket support</h1>
            <p style="font-size:14px;line-height:1.5;margin:0 0 8px;"><strong>Entreprise :</strong> ${escapeHtml(company?.raison_sociale || "—")}</p>
            <p style="font-size:14px;line-height:1.5;margin:0 0 8px;"><strong>Auteur :</strong> ${escapeHtml(auteur)}</p>
            <p style="font-size:14px;line-height:1.5;margin:0 0 8px;"><strong>Catégorie :</strong> ${escapeHtml(ticket.categorie || "—")} · <strong>Priorité :</strong> ${escapeHtml(ticket.priorite)}</p>
            <p style="font-size:15px;line-height:1.5;margin:16px 0 8px;"><strong>${escapeHtml(ticket.titre)}</strong></p>
            <p style="font-size:14px;line-height:1.5;margin:0 0 20px;white-space:pre-wrap;">${escapeHtml(ticket.description || "(aucune description)")}</p>
            <p style="font-size:13px;color:#6b7280;margin:0;">Réponds-y depuis la console BERTOLIS, onglet "Tickets support".</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  `;

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Nexus RH <B.bertolis@nexus-rh.com>",
      to: [BERTOLIS_NOTIFY_EMAIL],
      subject: `Nouveau ticket support : ${ticket.titre}`,
      html,
    }),
  });

  // La confirmation au salarié ne dépend pas du succès de l'email BERTOLIS ci-dessus (deux
  // destinataires indépendants) — envoyée même si l'email BERTOLIS a échoué, jamais l'inverse.
  if (employee?.email) {
    await sendTicketConfirmationEmail(employee.email, employee.prenom || "", ticket.titre);
  }

  if (!resendRes.ok) {
    console.error("Resend error:", await resendRes.text());
    return jsonResponse({ error: "Échec de l'envoi de l'email." }, 500);
  }

  return jsonResponse({ success: true });
});
