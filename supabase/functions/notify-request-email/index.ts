// Seven RH — fonction "notify-request-email" : notifications par email sur le cycle de vie d'une
// demande de congé/télétravail/note de frais (audit du 23/08/2026, §7.4). "Resend n'est branché
// que sur les candidatures et les tickets BERTOLIS. Une demande de congé ne déclenche aucun
// email : le manager ne la découvre que s'il se connecte." Appelée en tâche de fond (data.js/
// app.js) après création, validation, refus, ou relance d'une demande — un échec ou une absence
// d'email ne doit jamais empêcher l'action elle-même (même principe que notify-slack).
//
// Secret Supabase requis : RESEND_API_KEY (même compte que candidature-submit/candidature-reject).
//
// Sécurité : même schéma que notify-slack — current_company_id() est appelé AVEC LE JETON DE
// L'APPELANT pour connaître SA VRAIE entreprise ; les destinataires (recipientEmployeeIds) sont
// ensuite filtrés au serveur pour n'inclure QUE des salariés de cette même entreprise, jamais fait
// confiance à une liste d'ids fournie sans revérification (un appelant malveillant pourrait sinon
// tenter de faire notifier n'importe quel email arbitraire au nom de l'entreprise).

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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildFromAddress(raisonSociale: string): string {
  const safeName = raisonSociale.replace(/"/g, "").trim() || "Nexus RH";
  return `"${safeName}" <notifications@nexus-rh.com>`;
}

type Template = "a_valider" | "validee" | "refusee" | "relance";

const TEMPLATE_TITLES: Record<Template, string> = {
  a_valider: "Une demande attend votre validation",
  validee: "Votre demande a été validée",
  refusee: "Votre demande a été refusée",
  relance: "Rappel : une demande attend toujours votre validation",
};

function buildEmailHtml(template: Template, raisonSociale: string, logo: string | null, employeeName: string, typeLabel: string, periode: string, motif?: string): string {
  const title = TEMPLATE_TITLES[template];
  const motifHtml = template === "refusee" && motif ? `<p><strong>Motif :</strong> ${escapeHtml(motif)}</p>` : "";
  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      ${logo ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(raisonSociale)}" style="max-height: 48px; margin-bottom: 16px;">` : ""}
      <h2 style="margin: 0 0 12px;">${escapeHtml(title)}</h2>
      <p>${escapeHtml(employeeName)} : ${escapeHtml(typeLabel)}</p>
      <p><strong>Période :</strong> ${escapeHtml(periode)}</p>
      ${motifHtml}
      <p style="margin-top: 20px; color: #6b7280; font-size: 13px;">Connectez-vous à Nexus pour voir le détail et agir si besoin.</p>
    </div>
  `;
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

  const { recipientEmployeeIds, template, employeeName, typeLabel, periode, motif } = body;
  const validTemplates: Template[] = ["a_valider", "validee", "refusee", "relance"];
  if (!Array.isArray(recipientEmployeeIds) || !recipientEmployeeIds.length || !validTemplates.includes(template) || !employeeName || !typeLabel || !periode) {
    return jsonResponse({ error: "Paramètres manquants ou invalides." }, 400);
  }

  const { data: companyId, error: companyErr } = await supabaseUser.rpc("current_company_id");
  if (companyErr || !companyId) return jsonResponse({ error: "Entreprise introuvable pour ce compte." }, 400);

  const { data: company } = await supabaseAdmin.from("companies").select("raison_sociale, data").eq("id", companyId).maybeSingle();
  if (!company) return jsonResponse({ error: "Entreprise introuvable." }, 404);

  // Ne notifie QUE des salariés de la MÊME entreprise que l'appelant — jamais fait confiance à la
  // liste d'ids fournie sans la recroiser ici (voir en-tête de fichier).
  const { data: recipients } = await supabaseAdmin
    .from("employees")
    .select("id, email, prenom, nom")
    .eq("company_id", companyId)
    .eq("archive", false)
    .in("id", recipientEmployeeIds);

  if (!recipients || !recipients.length) return jsonResponse({ success: true, sent: 0 });

  const html = buildEmailHtml(template as Template, company.raison_sociale, company.data?.logo || null, employeeName, typeLabel, periode, motif);
  const subject = `${TEMPLATE_TITLES[template as Template]} : ${company.raison_sociale}`;

  let sent = 0;
  for (const recipient of recipients) {
    if (!recipient.email) continue;
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: buildFromAddress(company.raison_sociale), to: recipient.email, subject, html }),
      });
      if (res.ok) sent++;
      else console.error("notify-request-email Resend error:", await res.text());
    } catch (err) {
      console.error("notify-request-email send error:", err);
    }
  }

  return jsonResponse({ success: true, sent });
});
