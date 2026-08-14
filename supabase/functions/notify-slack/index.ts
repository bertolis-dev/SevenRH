// Seven RH — fonction "notify-slack" : relaie une notification (congé/télétravail/note de frais en
// attente) vers le webhook Slack de l'entreprise, si configuré (Paramètres → Intégrations). Appelée
// en tâche de fond juste après la création d'une demande (data.js) — un échec ou une absence de
// webhook ne doit jamais empêcher la création de la demande côté salarié.
//
// Sécurité : le webhook (company_integrations.slack_webhook_url) n'est accessible qu'via le client
// service-role ici — un salarié ordinaire (sans gererParametres) ne pourrait pas le lire directement
// via l'app (RLS, voir 0022_integrations.sql), mais DOIT pouvoir déclencher CETTE notification en
// créant une simple demande de congé. current_company_id() est appelée AVEC LE JETON DE L'APPELANT
// pour s'assurer qu'on ne notifie jamais le canal Slack d'une autre entreprise.

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
    .select("slack_webhook_url")
    .eq("company_id", companyId)
    .maybeSingle();

  // Pas de webhook configuré : succès silencieux, pas une erreur (voir en-tête de fichier).
  if (!integration?.slack_webhook_url) return jsonResponse({ success: true, skipped: true });

  const slackRes = await fetch(integration.slack_webhook_url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: `${icon || "🔔"} *${title}*\n${message}` }),
  });

  if (!slackRes.ok) {
    console.error("Slack webhook error:", await slackRes.text());
    return jsonResponse({ error: "Échec de l'envoi à Slack." }, 500);
  }

  return jsonResponse({ success: true });
});
