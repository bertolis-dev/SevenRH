// Seven RH — fonction "notify-request-email" : notifications par email sur le cycle de vie d'une
// demande de congé/télétravail/note de frais (audit du 23/08/2026, §7.4). Appelée en tâche de fond
// (data.js/app.js) après création, validation, refus, ou relance d'une demande — un échec ou une
// absence d'email ne doit jamais empêcher l'action elle-même (même principe que notify-slack).
//
// Secret Supabase requis : RESEND_API_KEY (même compte que candidature-submit/candidature-reject).
//
// §correctif retour QA du 26/08/2026 (point 5.2) : "n'importe quel salarié connecté peut appeler
// cette fonction et déclencher un email à ses collègues, au nom de l'entreprise, avec un contenu
// dont il fournit une partie (employeeName, typeLabel, periode, motif) — rien ne vérifie qu'il est
// concerné par la demande dont il parle, ni combien d'appels il passe." Deux garde-fous ajoutés :
//   1. L'appelant fournit désormais un requestId + domain, JAMAIS le contenu de l'email lui-même —
//      cette fonction relit la VRAIE demande depuis la base (client service-role) et en dérive tout
//      le contenu (nom du salarié, type, période, motif) ; elle vérifie aussi que l'appelant est
//      bien CONCERNÉ par cette demande (son auteur, ou un validateur éligible pour l'étape en
//      cours — resolve_validator_employee_ids_for_step, 0037) avant d'envoyer quoi que ce soit.
//   2. Limite de débit par salarié appelant (check_notify_request_email_rate_limit, 0038), même
//      patron que candidature-submit — un compte compromis ne peut plus servir d'outil
//      d'hameçonnage interne à grande échelle.
//
// Sécurité (inchangé) : current_company_id() est appelé AVEC LE JETON DE L'APPELANT pour connaître
// SA VRAIE entreprise ; les destinataires restent filtrés au serveur pour n'inclure que des
// salariés de cette même entreprise.

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

const RATE_LIMIT_PAR_HEURE = 30; // largement au-dessus d'un usage normal (une poignée de demandes/jour/salarié)

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

function escapeHtml(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// §correctif QA du 26/08/2026 (point C.2) : filtrait déjà les guillemets/retours à la ligne pour le
// "From", mais pas pour le "subject" construit plus bas avec la même raison sociale — même risque
// résiduel (Resend reçoit du JSON, pas un en-tête brut, donc faible), corrigé aux deux endroits avec
// le même helper plutôt que deux filtres divergents.
function sanitizeHeaderValue(value: string): string {
  return value.replace(/["\r\n]/g, "").trim();
}

function buildFromAddress(raisonSociale: string): string {
  const safeName = sanitizeHeaderValue(raisonSociale) || "Nexus RH";
  return `"${safeName}" <notifications@nexus-rh.com>`;
}

type Template = "a_valider" | "validee" | "refusee" | "relance";
type Domain = "conge" | "teletravail" | "frais";

const TEMPLATE_TITLES: Record<Template, string> = {
  a_valider: "Une demande attend votre validation",
  validee: "Votre demande a été validée",
  refusee: "Votre demande a été refusée",
  relance: "Rappel : une demande attend toujours votre validation",
};

const TABLE_BY_DOMAIN: Record<Domain, string> = {
  conge: "leave_requests",
  teletravail: "telework_requests",
  frais: "expenses",
};

function formatDateFR(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

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

  const { requestId, domain, template, motif } = body;
  const validTemplates: Template[] = ["a_valider", "validee", "refusee", "relance"];
  const validDomains: Domain[] = ["conge", "teletravail", "frais"];
  if (!requestId || !validDomains.includes(domain) || !validTemplates.includes(template)) {
    return jsonResponse({ error: "Paramètres manquants ou invalides." }, 400);
  }

  const { data: companyId, error: companyErr } = await supabaseUser.rpc("current_company_id");
  if (companyErr || !companyId) return jsonResponse({ error: "Entreprise introuvable pour ce compte." }, 400);
  const { data: callerEmployeeId, error: callerErr } = await supabaseUser.rpc("current_employee_id");
  if (callerErr || !callerEmployeeId) return jsonResponse({ error: "Salarié introuvable pour ce compte." }, 400);

  // Limite de débit AVANT toute autre requête coûteuse — un appelant qui la dépasse n'a pas besoin
  // de savoir si sa demande existe ou non.
  const { data: withinLimit, error: rateLimitErr } = await supabaseAdmin.rpc("check_notify_request_email_rate_limit", {
    p_employee_id: callerEmployeeId, p_limit: RATE_LIMIT_PAR_HEURE,
  });
  if (rateLimitErr) return jsonResponse({ error: "Erreur interne." }, 500);
  if (!withinLimit) return jsonResponse({ error: "Trop de notifications envoyées, réessayez plus tard." }, 429);

  const table = TABLE_BY_DOMAIN[domain as Domain];
  const { data: request, error: requestErr } = await supabaseAdmin
    .from(table)
    .select("id, company_id, employee_id, etape_index, data, date_debut, date_fin, montant_ttc")
    .eq("id", requestId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (requestErr || !request) return jsonResponse({ error: "Demande introuvable." }, 404);

  const workflow: string[] = Array.isArray(request.data?.workflow) ? request.data.workflow : [];
  const roleEtapeActuelle = request.etape_index >= 0 ? workflow[request.etape_index] : null;

  // L'appelant doit être CONCERNÉ par cette demande : son auteur (création/relance, qui notifie les
  // validateurs), ou un validateur éligible pour l'étape en cours (validation/refus, qui notifie
  // l'auteur). Jamais un tiers qui ne fait que connaître l'id d'une demande d'un collègue.
  let validatorIds: string[] = [];
  if (roleEtapeActuelle) {
    const { data: ids } = await supabaseAdmin.rpc("resolve_validator_employee_ids_for_step", {
      p_employee_id: request.employee_id, p_role: roleEtapeActuelle,
    });
    validatorIds = Array.isArray(ids) ? ids : [];
  }
  const callerIsAuthor = callerEmployeeId === request.employee_id;
  const callerIsValidator = validatorIds.includes(callerEmployeeId);
  if (!callerIsAuthor && !callerIsValidator) {
    return jsonResponse({ error: "Vous n'êtes pas concerné par cette demande." }, 403);
  }

  const { data: employee } = await supabaseAdmin.from("employees").select("prenom, nom").eq("id", request.employee_id).maybeSingle();
  if (!employee) return jsonResponse({ error: "Salarié introuvable." }, 404);
  const employeeName = `${employee.prenom} ${employee.nom}`;

  // typeLabel/periode dérivés de la VRAIE demande, jamais des chaînes fournies par l'appelant.
  let typeLabel = "Télétravail";
  if (domain === "conge") {
    const { data: leaveType } = await supabaseAdmin.from("leave_types").select("nom").eq("id", (request.data as any).typeId).maybeSingle();
    typeLabel = leaveType?.nom || "Congé";
  } else if (domain === "frais") {
    typeLabel = (request.data as any).libelle || (request.data as any).categorie || "Note de frais";
  }
  const periode = domain === "frais"
    ? formatDateFR((request.data as any).date || request.date_debut)
    : (request.date_debut === request.date_fin ? formatDateFR(request.date_debut) : `${formatDateFR(request.date_debut)} → ${formatDateFR(request.date_fin)}`);

  // Recipients : les validateurs de l'étape en cours pour a_valider/relance (déjà résolus
  // ci-dessus si l'étape existe), le salarié lui-même pour validee/refusee (il vient d'être notifié
  // d'une décision sur SA propre demande).
  const recipientIds = (template === "validee" || template === "refusee") ? [request.employee_id] : validatorIds;
  if (!recipientIds.length) return jsonResponse({ success: true, sent: 0 });

  const { data: company } = await supabaseAdmin.from("companies").select("raison_sociale, data").eq("id", companyId).maybeSingle();
  if (!company) return jsonResponse({ error: "Entreprise introuvable." }, 404);

  const { data: recipients } = await supabaseAdmin
    .from("employees")
    .select("id, email, prenom, nom")
    .eq("company_id", companyId)
    .eq("archive", false)
    .in("id", recipientIds);

  if (!recipients || !recipients.length) return jsonResponse({ success: true, sent: 0 });

  const html = buildEmailHtml(template as Template, company.raison_sociale, company.data?.logo || null, employeeName, typeLabel, periode, motif ? String(motif).slice(0, 500) : undefined);
  const subject = `${TEMPLATE_TITLES[template as Template]} : ${sanitizeHeaderValue(company.raison_sociale)}`;

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
