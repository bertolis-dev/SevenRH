// Seven RH — fonction "candidature-reject" : le RH/Directeur clique "Pas intéressé" sur une
// candidature (voir openRejectCandidatureModal, app.js), écrit un message, cette fonction l'envoie
// PAR EMAIL au candidat puis archive la candidature — jamais un archivage silencieux.
//
// Sécurité : contrairement à candidature-submit (public, JWT désactivé), cette fonction EXIGE une
// session valide ("Enforce JWT verification" activé, comme le reste de l'app) — has_permission()
// est vérifiée via le jeton de l'appelant, jamais supposée côté client.
//
// Secret Supabase requis : RESEND_API_KEY (voir resend.com — même compte que candidature-submit).
// Le domaine d'envoi (nexus-rh.com) doit être vérifié sur Resend pour pouvoir écrire à n'importe
// quelle adresse candidate (pas seulement celle du compte Resend).

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

/** Nom affiché = celui de l'entreprise (demande du 17/08/2026 : le candidat ne doit jamais voir
 * "Nexus RH" comme expéditeur) — seule l'ADRESSE reste sur le domaine vérifié Resend, jamais le
 * nom. Guillemets retirés de raisonSociale pour ne pas casser l'en-tête "Nom <email>". */
function buildFromAddress(raisonSociale: string): string {
  const safeName = raisonSociale.replace(/"/g, "").trim() || "Nexus RH";
  return `"${safeName}" <candidatures@nexus-rh.com>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Non authentifié." }, 401);

  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Corps de requête invalide." }, 400);
  }

  const candidatureId = String(body?.candidatureId || "");
  const message = String(body?.message || "").trim();
  if (!candidatureId || !message) {
    return jsonResponse({ error: "Message manquant." }, 400);
  }

  const { data: companyId, error: companyErr } = await supabaseUser.rpc("current_company_id");
  if (companyErr || !companyId) return jsonResponse({ error: "Entreprise introuvable pour ce compte." }, 400);

  const { data: canManage } = await supabaseUser.rpc("has_permission", { permission_key: "creerSalarie" });
  if (!canManage) return jsonResponse({ error: "Vous n'avez pas le droit de gérer les candidatures." }, 403);

  // Lecture via service-role (candidatures n'a pas de policy SELECT pour l'appelant en dehors de
  // celle déjà vérifiée ci-dessus manuellement) — mais on vérifie nous-mêmes que la candidature
  // appartient bien À CETTE entreprise avant d'envoyer quoi que ce soit, jamais confiance dans
  // l'ID seul.
  const { data: candidature } = await supabaseAdmin
    .from("candidatures")
    .select("id, company_id, nom, prenom, email")
    .eq("id", candidatureId)
    .maybeSingle();
  if (!candidature || candidature.company_id !== companyId) {
    return jsonResponse({ error: "Candidature introuvable." }, 404);
  }

  const { data: company } = await supabaseAdmin.from("companies").select("raison_sociale, data").eq("id", companyId).maybeSingle();
  const raisonSociale = company?.raison_sociale || "l'entreprise";
  const logo = company?.data?.logo || null;

  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      ${logo ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(raisonSociale)}" style="max-height: 48px; margin-bottom: 16px;">` : ""}
      <p style="white-space: pre-wrap;">${escapeHtml(message)}</p>
    </div>
  `;

  try {
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: buildFromAddress(raisonSociale),
        to: candidature.email,
        subject: `Votre candidature chez ${raisonSociale}`,
        html,
      }),
    });
    if (!emailRes.ok) {
      const errText = await emailRes.text();
      throw new Error(`Resend: ${errText}`);
    }
  } catch (err) {
    console.error("candidature-reject email error:", err);
    return jsonResponse({ error: "Impossible d'envoyer l'email au candidat." }, 500);
  }

  // Email parti avec succès seulement à ce stade — passe par le jeton de l'appelant (pas
  // service-role) pour que set_candidature_statut revérifie tout lui-même, jamais dupliqué ici.
  const { error: statutErr } = await supabaseUser.rpc("set_candidature_statut", {
    p_id: candidatureId,
    p_statut: "archivee",
    p_employee_id: null,
  });
  if (statutErr) {
    console.error("candidature-reject set_candidature_statut error:", statutErr);
    return jsonResponse({ error: "Email envoyé, mais la candidature n'a pas pu être archivée." }, 500);
  }

  return jsonResponse({ success: true });
});
