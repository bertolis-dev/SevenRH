// Seven RH — fonction "candidature-submit" : SEULE fonction de toute l'application accessible sans
// aucune authentification par conception. La personne qui scanne le QR code "Embauche" (voir
// renderEmbauche, app.js) n'a et n'aura jamais de compte — elle dépose un CV (+ une lettre de
// motivation, fichier ou texte libre) qui doit arriver jusqu'à l'entreprise ciblée par le QR.
//
// IMPORTANT côté configuration Supabase : cette fonction doit être créée avec la vérification JWT
// DÉSACTIVÉE ("Enforce JWT verification" décoché) — comme stripe-webhook, mais pour une raison
// différente : ici c'est un visiteur public sans le moindre jeton, pas un service externe signé.
//
// Sécurité : company_id vient du QR (donc du visiteur, non fiable en soi) — vérifié contre une
// vraie entreprise existante avant toute écriture ; un company_id invalide échoue proprement sans
// rien créer. Toute écriture passe par la clé service-role : `candidatures` n'a AUCUNE policy
// INSERT pour anon/authenticated (voir 0024_candidatures.sql) — ce visiteur ne pourrait de toute
// façon pas écrire directement même avec la clé anon, seule cette fonction le peut.
//
// Secret Supabase requis : RESEND_API_KEY (voir resend.com — même compte que candidature-reject).
//
// Limite connue acceptée pour cette v1 (formulaire public sans compte) : aucun CAPTCHA/anti-spam.
// Les limites de taille/type de fichier ci-dessous sont le seul filet de sécurité basique.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  // supabase-js (functions.invoke) envoie aussi les en-têtes "apikey"/"authorization"/"x-client-info"
  // même pour un appel public sans session (jeton anon par défaut) — sans les autoriser ici, le
  // navigateur bloque la requête au stade du preflight CORS, avant même qu'elle ne parte (même
  // piège déjà rencontré et corrigé sur notify-slack/index.ts).
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 Mo — large pour un CV/lettre en PDF, limite un abus grossier.
const ALLOWED_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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

/** Valide taille/type AVANT toute écriture en base — appelée avant l'insert de `candidatures`
 * (voir Deno.serve ci-dessous) pour qu'un fichier invalide échoue proprement sans laisser de ligne
 * orpheline (statut "nouvelle", jamais de cv_path) qu'un visiteur malveillant pourrait répéter en
 * boucle pour polluer la liste "Candidatures reçues" d'une entreprise (aucun CAPTCHA/anti-spam ici,
 * voir limite connue en tête de fichier — mais au moins pas de ligne fantôme à chaque tentative). */
function assertValidFile(kind: "cv" | "lettre", file: File) {
  if (file.size > MAX_FILE_BYTES) throw new Error(`Fichier "${kind}" trop volumineux (5 Mo maximum).`);
  if (!ALLOWED_TYPES[file.type]) throw new Error(`Format de fichier "${kind}" non accepté (PDF, PNG ou JPEG uniquement).`);
}

async function uploadFile(companyId: string, candidatureId: string, kind: "cv" | "lettre", file: File): Promise<string> {
  const ext = ALLOWED_TYPES[file.type];
  const path = `${companyId}/${candidatureId}/${kind}.${ext}`;
  const { error } = await supabaseAdmin.storage.from("candidatures-files").upload(path, file, { contentType: file.type });
  if (error) throw error;
  return path;
}

/** Relaie vers Slack si l'entreprise a configuré un webhook (Paramètres → Intégrations) — même
 * logique que notify-slack/index.ts, réécrite ici plutôt qu'appelée : notify-slack exige un jeton
 * Supabase de l'appelant pour résoudre current_company_id(), qu'un visiteur public n'a jamais. */
async function notifySlackNewCandidature(companyId: string, nom: string, prenom: string) {
  const { data: integration } = await supabaseAdmin
    .from("company_integrations")
    .select("slack_webhook_url")
    .eq("company_id", companyId)
    .maybeSingle();
  if (!integration?.slack_webhook_url) return;
  try {
    await fetch(integration.slack_webhook_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `🧑‍💼 *Nouvelle candidature*\n${prenom} ${nom} — voir l'onglet Embauche` }),
    });
  } catch {
    // Une notification Slack ratée ne doit jamais faire échouer le dépôt de candidature lui-même.
  }
}

/** Confirmation envoyée AU CANDIDAT (demande du 17/08/2026), brandée avec le nom + logo de
 * l'entreprise ciblée par le QR — jamais bloquante : un échec d'envoi ne doit jamais faire échouer
 * le dépôt de candidature lui-même (déjà enregistré en base à ce stade), juste être journalisé. */
async function sendConfirmationEmail(candidateEmail: string, candidateName: string, raisonSociale: string, logo: string | null) {
  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      ${logo ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(raisonSociale)}" style="max-height: 48px; margin-bottom: 16px;">` : ""}
      <h2 style="margin: 0 0 12px;">Candidature reçue</h2>
      <p>Bonjour ${escapeHtml(candidateName)},</p>
      <p>Votre candidature chez <strong>${escapeHtml(raisonSociale)}</strong> a bien été reçue. L'équipe l'examinera et reviendra vers vous.</p>
    </div>
  `;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: buildFromAddress(raisonSociale),
        to: candidateEmail,
        subject: `Candidature reçue — ${raisonSociale}`,
        html,
      }),
    });
  } catch (err) {
    console.error("sendConfirmationEmail error:", err);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "Méthode non autorisée." }, 405);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonResponse({ error: "Corps de requête invalide." }, 400);
  }

  const companyId = String(form.get("company_id") || "").trim();
  const nom = String(form.get("nom") || "").trim();
  const prenom = String(form.get("prenom") || "").trim();
  const email = String(form.get("email") || "").trim();
  const telephone = String(form.get("telephone") || "").trim();
  const lettreTexte = String(form.get("lettre_texte") || "").trim();
  const cv = form.get("cv");
  const lettre = form.get("lettre");
  let postes: string[] = [];
  try {
    const raw = form.get("postes");
    if (typeof raw === "string" && raw) postes = JSON.parse(raw).filter((p: unknown) => typeof p === "string");
  } catch {
    postes = [];
  }

  if (!companyId || !nom || !email) {
    return jsonResponse({ error: "Le nom et l'email sont obligatoires." }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse({ error: "Adresse email invalide." }, 400);
  }
  if (!(cv instanceof File) || cv.size === 0) {
    return jsonResponse({ error: "Le CV est obligatoire." }, 400);
  }

  try {
    assertValidFile("cv", cv);
    if (lettre instanceof File && lettre.size > 0) assertValidFile("lettre", lettre);
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 400);
  }

  const { data: company } = await supabaseAdmin.from("companies").select("id, raison_sociale, data").eq("id", companyId).maybeSingle();
  if (!company) return jsonResponse({ error: "Lien de candidature invalide." }, 404);

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("candidatures")
    .insert({ company_id: companyId, nom, prenom, email, telephone, lettre_texte: lettreTexte || null, postes })
    .select("id")
    .single();
  if (insertErr) {
    console.error("candidature-submit insert error:", insertErr);
    return jsonResponse({ error: "Erreur lors de l'envoi : " + insertErr.message }, 500);
  }

  try {
    const patch: Record<string, string> = {};
    patch.cv_path = await uploadFile(companyId, inserted.id, "cv", cv);
    if (lettre instanceof File && lettre.size > 0) {
      patch.lettre_path = await uploadFile(companyId, inserted.id, "lettre", lettre);
    }

    const { error: updateErr } = await supabaseAdmin.from("candidatures").update(patch).eq("id", inserted.id);
    if (updateErr) throw updateErr;

    await notifySlackNewCandidature(companyId, nom, prenom);
    await sendConfirmationEmail(email, `${prenom} ${nom}`.trim(), company.raison_sociale, company.data?.logo || null);

    return jsonResponse({ success: true });
  } catch (err) {
    // Le fichier a été validé plus haut (assertValidFile) : un échec ici est un problème de stockage/
    // réseau, pas une donnée invalide côté visiteur — on retire la ligne orpheline plutôt que de la
    // laisser polluer la liste "Candidatures reçues" de l'entreprise avec une candidature sans cv_path.
    console.error("candidature-submit upload/update error:", err);
    await supabaseAdmin.from("candidatures").delete().eq("id", inserted.id);
    return jsonResponse({ error: "Erreur lors de l'envoi : " + (err as Error).message }, 500);
  }
});
