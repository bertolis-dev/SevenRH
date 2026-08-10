// Seven RH — fonction "analyze-ticket" : analyse automatique d'un ticket support par l'API Claude
// (Anthropic) juste après sa création, pour aider BERTOLIS à trier/prioriser (§sprint analyse
// automatique). Appelée par le site en tâche de fond, EN PARALLÈLE de notify-bertolis-ticket — voir
// DB.addSupportTicket (data.js). Un échec ici (clé absente, API indisponible, quota dépassé) ne
// bloque jamais la création du ticket : celui-ci existe déjà avant que cette fonction soit appelée.
//
// Sécurité : comme notify-bertolis-ticket, has_permission()/current_company_id() sont appelées AVEC
// LE JETON DE L'APPELANT pour vérifier que le ticket appartient bien à SON entreprise ; le contenu
// analysé (titre/description) est relu depuis la base via le client service-role, jamais pris tel
// quel dans le corps de la requête.
//
// Important — la suggestion de l'IA n'écrase JAMAIS categorie/priorite du ticket : elle est stockée
// à part (data.aiAnalysis, via update_ticket_ai_analysis) et affichée distinctement côté app.js. Le
// seul chemin pour l'appliquer aux vrais champs est un clic explicite côté BERTOLIS (action
// applyAiSuggestion de bertolis-tickets/index.ts).

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

// Catégories/priorités reconnues par l'app (TICKET_CATEGORIES, app.js ; contrainte SQL sur priorite,
// 0017_support_tickets.sql) — la suggestion de l'IA est contrainte à ces valeurs plutôt que du texte
// libre, pour qu'un éventuel clic "Appliquer la suggestion" reste toujours une valeur valide.
const CATEGORIES = ["Anomalie", "Question", "Suggestion", "Autre"];
const PRIORITES = ["basse", "normale", "haute"];

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
  const { ticketId } = body;
  if (!ticketId) return jsonResponse({ error: "ticketId manquant." }, 400);

  if (!ANTHROPIC_API_KEY) {
    // Pas configurée : échec propre, jamais une exception — le ticket existe déjà, rien à bloquer.
    return jsonResponse({ error: "Analyse IA non configurée (ANTHROPIC_API_KEY absente)." }, 503);
  }

  const { data: companyId, error: companyErr } = await supabaseUser.rpc("current_company_id");
  if (companyErr || !companyId) return jsonResponse({ error: "Entreprise introuvable pour ce compte." }, 400);

  const { data: ticket, error: ticketErr } = await supabaseAdmin
    .from("support_tickets")
    .select("id, titre, description, categorie, priorite")
    .eq("id", ticketId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (ticketErr || !ticket) return jsonResponse({ error: "Ticket introuvable." }, 404);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

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
        max_tokens: 512,
        messages: [{
          role: "user",
          content: `Voici un ticket support envoyé par un salarié à l'éditeur d'un logiciel RH.\n\nTitre : ${ticket.titre}\nDescription : ${ticket.description || "(aucune description)"}\nCatégorie choisie par le salarié : ${ticket.categorie || "(non précisée)"}\nPriorité choisie par le salarié : ${ticket.priorite}\n\nAnalyse ce ticket pour aider le support à le trier.`,
        }],
        tools: [{
          name: "analyser_ticket",
          description: "Enregistre l'analyse structurée d'un ticket support.",
          input_schema: {
            type: "object",
            properties: {
              categorieSuggeree: { type: "string", enum: CATEGORIES, description: "Catégorie la plus probable pour ce ticket." },
              prioriteSuggeree: { type: "string", enum: PRIORITES, description: "Niveau de priorité suggéré au vu du contenu." },
              resume: { type: "string", description: "Résumé court (1-2 phrases) de la demande, en français." },
              pointsCles: { type: "array", items: { type: "string" }, description: "2 à 4 informations importantes extraites du ticket (identifiants, étapes de reproduction, urgence...)." },
            },
            required: ["categorieSuggeree", "prioriteSuggeree", "resume"],
          },
        }],
        tool_choice: { type: "tool", name: "analyser_ticket" },
      }),
    });
    clearTimeout(timeout);

    if (!response.ok) {
      console.error("Anthropic API error:", response.status, await response.text());
      return jsonResponse({ error: "Analyse IA indisponible." }, 502);
    }

    const result = await response.json();
    const toolUse = (result.content || []).find((block: any) => block.type === "tool_use");
    if (!toolUse) {
      console.error("Anthropic response missing tool_use block:", JSON.stringify(result));
      return jsonResponse({ error: "Réponse IA inattendue." }, 502);
    }

    const analysis = {
      categorieSuggeree: toolUse.input.categorieSuggeree,
      prioriteSuggeree: toolUse.input.prioriteSuggeree,
      resume: toolUse.input.resume,
      pointsCles: Array.isArray(toolUse.input.pointsCles) ? toolUse.input.pointsCles : [],
      genereLe: new Date().toISOString(),
    };

    const { error: rpcErr } = await supabaseAdmin.rpc("update_ticket_ai_analysis", {
      p_ticket_id: ticketId,
      p_analysis: analysis,
    });
    if (rpcErr) throw rpcErr;

    return jsonResponse({ success: true, analysis });
  } catch (err) {
    console.error("analyze-ticket error:", err);
    return jsonResponse({ error: "Erreur lors de l'analyse : " + (err as Error).message }, 500);
  }
});
