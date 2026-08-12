// Seven RH — fonction "billing" : tout ce que le SITE appelle lui-même (avec le jeton de connexion
// du salarié), à la différence de stripe-webhook (appelée par Stripe, jamais par le site).
// Trois actions dans une seule fonction pour limiter le nombre de déploiements Supabase à faire
// à la main : "checkout" (créer un abonnement), "portal" (gérer/annuler via Stripe), "confirm"
// (juste après le retour de Stripe, pour un affichage immédiat sans attendre le webhook).
//
// Sécurité : la vérification du droit de gérer l'abonnement (permission gererAbonnements) se fait
// en appelant has_permission() EN TANT QUE L'APPELANT (client Supabase créé avec son propre jeton,
// pas la clé service-role) — has_permission() lit auth.uid() côté Postgres, donc ce jeton suffit à
// obtenir la vraie réponse pour ce salarié précis, sans dupliquer la logique de permissions.
// Toute écriture dans `subscriptions` passe ensuite par un client service-role séparé (seule façon
// d'y écrire, voir migration 0010).
//
// Note : la logique "upsertSubscriptionFromStripeSubscription" ci-dessous est dupliquée à
// l'identique dans stripe-webhook/index.ts plutôt que partagée via un fichier _shared/ — ce projet
// déploie les fonctions en collant le code directement dans le tableau de bord Supabase (pas de
// CLI), où le support d'un fichier partagé entre deux fonctions créées séparément n'est pas
// garanti. Si vous modifiez cette logique, répercutez le changement dans les deux fichiers.

import Stripe from "npm:stripe@14";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  // supabase-js (functions.invoke) envoie aussi un en-tête "apikey" en plus du jeton de
  // l'utilisateur — sans l'autoriser ici, le navigateur bloque la requête avant même qu'elle ne
  // parte (erreur "Failed to fetch", aucune trace côté serveur).
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Prix Stripe (mode PRODUCTION — voir git blame pour les anciens Price ID de test) →
// offre/périodicité Seven RH. Les Price ID ne sont pas sensibles, donc pas besoin d'en faire un
// secret Supabase.
const PRICE_IDS: Record<string, { mensuel: string; annuel: string }> = {
  essentiel: { mensuel: "price_1TzGUpCAcL94JssKUQXchzW2", annuel: "price_1TzGUqCAcL94JssKhPj74tfu" },
  professionnel: { mensuel: "price_1TzGUlCAcL94JssKETzTuocx", annuel: "price_1TzGUlCAcL94JssKpkRCtXfD" },
  premium: { mensuel: "price_1TzGUkCAcL94JssKziG5RV4C", annuel: "price_1TzGUlCAcL94JssKD3XSdpN0" },
};

// Plafond de salariés par offre — reflète OFFRES_BERTOLIS (data.js) pour cette même offre.
const SEATS_MAX: Record<string, number | null> = { essentiel: 10, professionnel: 25, premium: null };

const PRICE_TO_PLAN = new Map<string, { offre: string; periodicite: string }>();
for (const [offre, prices] of Object.entries(PRICE_IDS)) {
  PRICE_TO_PLAN.set(prices.mensuel, { offre, periodicite: "mensuel" });
  PRICE_TO_PLAN.set(prices.annuel, { offre, periodicite: "annuel" });
}

function statutFromStripeStatus(stripeStatus: string): string {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return "actif";
    case "past_due":
    case "unpaid":
      return "impaye";
    case "canceled":
    case "incomplete_expired":
      return "resilie";
    case "paused":
      return "suspendu";
    default:
      return "actif";
  }
}

async function upsertSubscriptionFromStripeSubscription(
  supabaseAdmin: any,
  companyId: string,
  stripeSubscription: any,
  stripeCustomerId?: string
) {
  const priceId = stripeSubscription.items?.data?.[0]?.price?.id;
  const plan = priceId ? PRICE_TO_PLAN.get(priceId) : undefined;
  const dateRenouvellement = stripeSubscription.current_period_end
    ? new Date(stripeSubscription.current_period_end * 1000).toISOString().slice(0, 10)
    : null;

  const patch: Record<string, unknown> = {
    statut: statutFromStripeStatus(stripeSubscription.status),
    date_renouvellement: dateRenouvellement,
    stripe_subscription_id: stripeSubscription.id,
    updated_at: new Date().toISOString(),
  };
  if (plan) {
    patch.offre = plan.offre;
    patch.periodicite = plan.periodicite;
    patch.nombre_salaries_max = SEATS_MAX[plan.offre] ?? null;
  }
  if (stripeCustomerId) patch.stripe_customer_id = stripeCustomerId;

  const { error } = await supabaseAdmin.from("subscriptions").update(patch).eq("company_id", companyId);
  if (error) throw error;
}

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { httpClient: Stripe.createFetchHttpClient() });
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Non authentifié." }, 401);

  // Client "au nom de l'appelant" — has_permission()/current_company_id() lisent auth.uid() via
  // ce jeton, exactement comme le ferait une requête normale du site.
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

  const { data: companyId, error: companyErr } = await supabaseUser.rpc("current_company_id");
  if (companyErr || !companyId) return jsonResponse({ error: "Entreprise introuvable pour ce compte." }, 400);

  const { data: canManage, error: permErr } = await supabaseUser.rpc("has_permission", {
    permission_key: "gererAbonnements",
  });
  if (permErr || !canManage) {
    return jsonResponse({ error: "Vous n'avez pas le droit de gérer l'abonnement de cette entreprise." }, 403);
  }

  const { data: sub } = await supabaseAdmin
    .from("subscriptions")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();

  // Le site n'est pas forcément servi à la racine d'un domaine (ex. GitHub Pages :
  // https://<compte>.github.io/SevenRH/) — se fier au seul en-tête "origin" (juste schéma+hôte,
  // sans le sous-dossier) renverrait Stripe vers une page inexistante. Le site envoie donc sa
  // propre URL de base (window.location.origin + pathname) ; l'en-tête origin ne sert plus que de
  // filet de sécurité si returnBase manque pour une raison quelconque.
  const returnBase: string = (body && body.returnBase) || req.headers.get("origin") || "https://melodic-conkies-6a8bdd.netlify.app/";
  const base = returnBase.endsWith("/") ? returnBase : returnBase + "/";

  try {
    if (body.action === "checkout") {
      const { offre, periodicite } = body;
      const priceId = PRICE_IDS[offre]?.[periodicite];
      if (!priceId) return jsonResponse({ error: "Offre ou périodicité inconnue." }, 400);

      let stripeCustomerId = sub?.stripe_customer_id as string | undefined;
      if (!stripeCustomerId) {
        const customer = await stripe.customers.create({ metadata: { company_id: companyId } });
        stripeCustomerId = customer.id;
        await supabaseAdmin.from("subscriptions").update({ stripe_customer_id: stripeCustomerId }).eq("company_id", companyId);
      }

      const session = await stripe.checkout.sessions.create({
        customer: stripeCustomerId,
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        subscription_data: { metadata: { company_id: companyId } },
        metadata: { company_id: companyId },
        // §12 sprint amélioration : code de réduction — délégué entièrement à Stripe (Coupons +
        // Codes promotionnels, configurés dans le Dashboard Stripe, pas en dur ici) plutôt qu'un
        // contrôle fait maison côté frontend. Stripe affiche son propre champ "Code promo" sur la
        // page de paiement hébergée et valide/applique le code lui-même.
        allow_promotion_codes: true,
        // Un code promo à 100% (ex. SEVENSEPT, réduction à vie) ramène le montant dû à 0 € : sans ce
        // réglage, Stripe demande quand même une carte par défaut pour tout abonnement. "if_required"
        // ne la demande que si le montant réellement facturé n'est pas nul.
        payment_method_collection: "if_required",
        success_url: `${base}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${base}?checkout=cancel`,
      });
      return jsonResponse({ url: session.url });
    }

    if (body.action === "portal") {
      if (!sub?.stripe_customer_id) {
        return jsonResponse({ error: "Aucun abonnement payant en cours pour cette entreprise." }, 400);
      }
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: sub.stripe_customer_id,
        return_url: base,
      });
      return jsonResponse({ url: portalSession.url });
    }

    if (body.action === "confirm") {
      const { sessionId } = body;
      if (!sessionId) return jsonResponse({ error: "sessionId manquant." }, 400);

      const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });
      // L'ID d'entreprise vient du jeton de l'appelant (companyId ci-dessus), jamais du contenu
      // envoyé par le navigateur — on vérifie juste que la session Stripe récupérée correspond
      // bien à SA propre entreprise, pour qu'on ne puisse pas confirmer l'abonnement de quelqu'un
      // d'autre en devinant un session_id.
      if (session.metadata?.company_id !== companyId) {
        return jsonResponse({ error: "Cette session de paiement ne correspond pas à votre entreprise." }, 403);
      }
      if (session.subscription && typeof session.subscription === "object") {
        await upsertSubscriptionFromStripeSubscription(
          supabaseAdmin,
          companyId,
          session.subscription,
          typeof session.customer === "string" ? session.customer : session.customer?.id
        );
      }
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: "Action inconnue." }, 400);
  } catch (err) {
    console.error("billing error:", err);
    return jsonResponse({ error: "Erreur Stripe : " + (err as Error).message }, 500);
  }
});
