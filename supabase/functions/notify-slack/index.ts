// Seven RH — fonction "notify-slack" : relaie une notification (congé/télétravail/note de frais en
// attente) vers les intégrations chat configurées par l'entreprise (Paramètres → Intégrations).
// Appelée en tâche de fond juste après la création d'une demande (data.js) — un échec ou une
// absence de webhook ne doit jamais empêcher la création de la demande côté salarié.
//
// §correctif audit du 23/08/2026 (§6.9) : "Ajouter Microsoft Teams et Google Chat aux
// intégrations. Même principe que le webhook Slack existant." — étendue ici plutôt que dupliquée
// en deux nouvelles fonctions, pour ne pas demander une troisième/quatrième fonction Edge à
// déployer manuellement pour la même chose. Le nom "notify-slack" reste (renommer une fonction
// Edge existante exige d'en déployer une nouvelle sous un autre nom, pas juste un rename) —
// gardé tel quel côté appelant (window.SupabaseSync.notifySlack) pour la même raison ; ne
// reflète plus tout à fait ce qu'elle fait, documenté ici plutôt que caché.
//
// Chaque plateforme est envoyée indépendamment des deux autres : l'échec ou l'absence de
// configuration d'une plateforme ne doit jamais empêcher l'envoi aux deux autres.
//
// Sécurité : le webhook (company_integrations) n'est accessible qu'via le client
// service-role ici — un salarié ordinaire (sans gererParametres) ne pourrait pas le lire directement
// via l'app (RLS, voir 0022_integrations.sql), mais DOIT pouvoir déclencher CETTE notification en
// créant une simple demande de congé. current_company_id() est appelée AVEC LE JETON DE L'APPELANT
// pour s'assurer qu'on ne notifie jamais le canal d'une autre entreprise.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

/** Slack et Google Chat acceptent tous les deux le même format minimal {"text": "..."}. */
async function postSimpleText(url: string, text: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) console.error("chat webhook error:", await res.text());
    return res.ok;
  } catch (err) {
    console.error("chat webhook send error:", err);
    return false;
  }
}

/** Un webhook Teams "Workflows" (successeur des connecteurs Office 365, retirés) attend une carte
 * adaptative, pas un simple objet {"text": ...} — sinon le message n'apparaît jamais dans le canal
 * bien que la requête HTTP réponde 200/202. */
async function postTeamsAdaptiveCard(url: string, title: string, text: string): Promise<boolean> {
  const body = {
    type: "message",
    attachments: [{
      contentType: "application/vnd.microsoft.card.adaptive",
      content: {
        type: "AdaptiveCard",
        $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
        version: "1.4",
        body: [
          { type: "TextBlock", text: title, weight: "Bolder", size: "Medium", wrap: true },
          { type: "TextBlock", text, wrap: true },
        ],
      },
    }],
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.error("Teams webhook error:", await res.text());
    return res.ok;
  } catch (err) {
    console.error("Teams webhook send error:", err);
    return false;
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
  const { icon, title, message } = body;
  if (!title || !message) return jsonResponse({ error: "title/message manquant." }, 400);

  const { data: companyId, error: companyErr } = await supabaseUser.rpc("current_company_id");
  if (companyErr || !companyId) return jsonResponse({ error: "Entreprise introuvable pour ce compte." }, 400);

  const { data: integration } = await supabaseAdmin
    .from("company_integrations")
    .select("slack_webhook_url, teams_webhook_url, google_chat_webhook_url")
    .eq("company_id", companyId)
    .maybeSingle();

  if (!integration?.slack_webhook_url && !integration?.teams_webhook_url && !integration?.google_chat_webhook_url) {
    return jsonResponse({ success: true, skipped: true });
  }

  const simpleText = `${icon || "🔔"} *${title}*\n${message}`;
  const results = await Promise.all([
    integration.slack_webhook_url ? postSimpleText(integration.slack_webhook_url, simpleText) : null,
    integration.google_chat_webhook_url ? postSimpleText(integration.google_chat_webhook_url, simpleText) : null,
    integration.teams_webhook_url ? postTeamsAdaptiveCard(integration.teams_webhook_url, `${icon || "🔔"} ${title}`, message) : null,
  ]);

  return jsonResponse({ success: true, sent: results.filter((r) => r === true).length });
});
