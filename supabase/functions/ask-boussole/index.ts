// Seven RH — "Boussole" (roadmap différenciation #2, 01/09/2026) : "agent conversationnel qui
// interroge EXCLUSIVEMENT la base Nexus de l'entreprise (pas de LLM ouvert)". Contrairement à un
// chatbot généraliste, cette fonction ne donne à Claude AUCUN accès direct à la base de données —
// elle relaie une question en langage naturel + un instantané de données déjà calculées et scopées
// à l'entreprise de l'appelant (préparé côté client, voir buildBoussoleContext dans app.js), et
// contraint la réponse à n'utiliser QUE ces données (jamais une connaissance générale, jamais une
// autre entreprise). Aucune écriture, aucun outil, une seule requête synchrone question -> réponse.
//
// Pourquoi le contexte est préparé CÔTÉ CLIENT plutôt que refait ici (contrairement à analyze-ticket,
// qui relit toujours le contenu sensible depuis la base) : le calcul des soldes de congés (acquisition,
// report, proratisation temps partiel, convention collective...) est une logique déjà complexe et
// plusieurs fois auditée dans data.js (getLeaveBalance) — la RÉIMPLÉMENTER ici en Deno créerait une
// deuxième version, inévitablement divergente. Le risque de sécurité d'un instantané fourni par le
// client est nul ici : la réponse ne sert jamais qu'à LA MÊME personne qui l'a soumis (jamais montrée
// à un tiers, contrairement à un ticket support relu par BERTOLIS) — au pire, un client qui mentirait
// sur ses propres données n'obtiendrait qu'une réponse fausse à lui-même, jamais une fuite vers
// quelqu'un d'autre. L'authentification reste vérifiée (companyId) pour éviter un usage anonyme qui
// consommerait le quota Anthropic de l'entreprise sans y être rattaché.
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

// Garde-fous de coût/abus, volontairement simples pour ce pilote (pas de quota par entreprise
// persisté — à revoir si l'usage réel le justifie) : une question trop longue ou un contexte
// disproportionné ne devraient de toute façon jamais survenir dans un usage normal de l'écran
// Boussole (voir buildBoussoleContext, app.js) — ces limites protègent contre un appel direct à
// l'API (devtools/script) qui tenterait d'envoyer un payload anormalement gros.
const MAX_QUESTION_LENGTH = 500;
const MAX_CONTEXT_JSON_LENGTH = 200_000;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Non authentifié." }, 401);

  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Corps de requête invalide." }, 400);
  }
  const { question, contextData } = body;
  if (!question || typeof question !== "string" || !question.trim()) return jsonResponse({ error: "Question manquante." }, 400);
  if (question.length > MAX_QUESTION_LENGTH) return jsonResponse({ error: "Question trop longue." }, 400);
  const contextJson = JSON.stringify(contextData ?? {});
  if (contextJson.length > MAX_CONTEXT_JSON_LENGTH) return jsonResponse({ error: "Contexte trop volumineux." }, 400);

  if (!ANTHROPIC_API_KEY) return jsonResponse({ error: "La Boussole n'est pas encore configurée (ANTHROPIC_API_KEY absente)." }, 503);

  // Confirme uniquement qu'il s'agit d'un compte authentifié réel rattaché à une entreprise — la
  // valeur elle-même n'est jamais utilisée pour re-filtrer contextData (voir le commentaire en tête
  // de fichier sur pourquoi ce n'est pas nécessaire ici).
  const { data: companyId, error: companyErr } = await supabaseUser.rpc("current_company_id");
  if (companyErr || !companyId) return jsonResponse({ error: "Entreprise introuvable pour ce compte." }, 400);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: "Tu es la Boussole, l'assistant de données RH interne de Nexus (un logiciel SIRH). "
          + "Tu réponds UNIQUEMENT à partir des données JSON fournies dans le message, jamais à partir de connaissances générales, "
          + "et jamais en inventant un salarié, un chiffre ou une règle absente des données. "
          + "Si la question ne peut pas être répondue avec les données fournies (donnée absente, hors périmètre RH), dis-le explicitement "
          + "plutôt que de deviner. Réponds toujours en français, de façon concise et directe (pas de longue introduction), "
          + "en citant les noms et chiffres exacts tirés des données quand c'est pertinent.",
        messages: [{
          role: "user",
          content: `Données de l'entreprise (JSON) :\n${contextJson}\n\nQuestion : ${question.trim()}`,
        }],
      }),
    });
    clearTimeout(timeout);

    if (!response.ok) {
      console.error("Anthropic API error:", response.status, await response.text());
      return jsonResponse({ error: "La Boussole est indisponible pour le moment." }, 502);
    }

    const result = await response.json();
    const textBlock = (result.content || []).find((block: any) => block.type === "text");
    if (!textBlock) {
      console.error("Anthropic response missing text block:", JSON.stringify(result));
      return jsonResponse({ error: "Réponse inattendue de la Boussole." }, 502);
    }

    return jsonResponse({ success: true, answer: textBlock.text });
  } catch (err) {
    console.error("ask-boussole error:", err);
    return jsonResponse({ error: "Erreur lors de l'appel à la Boussole : " + (err as Error).message }, 500);
  }
});
