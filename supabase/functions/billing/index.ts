// Seven RH — fonction "billing" : tout ce que le SITE appelle lui-même (avec le jeton de connexion
// du salarié), à la différence de stripe-webhook (appelée par Stripe, jamais par le site).
// Actions : "checkout" (souscrire à un ensemble de modules), "resync" (réaligner les quantités
// facturées sur l'effectif réel, à la demande — voir Paramètres → Abonnement), "portal" (gérer/
// annuler via Stripe), "confirm" (juste après le retour de Stripe, pour un affichage immédiat sans
// attendre le webhook).
//
// Sécurité : la vérification du droit de gérer l'abonnement (permission gererAbonnements) se fait
// en appelant has_permission() EN TANT QUE L'APPELANT (client Supabase créé avec son propre jeton,
// pas la clé service-role) — has_permission() lit auth.uid() côté Postgres, donc ce jeton suffit à
// obtenir la vraie réponse pour ce salarié précis, sans dupliquer la logique de permissions.
// Toute écriture dans `subscriptions`/`subscription_modules` passe ensuite par un client
// service-role séparé (seule façon d'y écrire, voir migrations 0010/0023).
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

// Ancien système à 3 paliers (offre unique par entreprise) — conservé UNIQUEMENT pour les
// abonnements déjà souscrits avant le passage à la carte (14/08/2026) : aucune migration forcée,
// un abonnement essentiel/professionnel/premium déjà actif continue de fonctionner tel quel (voir
// PRICE_TO_PLAN plus bas). Tout nouveau "checkout" passe désormais par MODULES ci-dessous.
const PRICE_IDS: Record<string, { mensuel: string; annuel: string }> = {
  essentiel: { mensuel: "price_1TzGXFCAcL94JssKcYV67hON", annuel: "price_1TzGXFCAcL94JssKSGtncWWL" },
  professionnel: { mensuel: "price_1TzGXpCAcL94JssKm7eW7z2S", annuel: "price_1TzGXpCAcL94JssKszqeXYG7" },
  premium: { mensuel: "price_1TzGYOCAcL94JssKIR4YmNJS", annuel: "price_1TzGYOCAcL94JssKmwB7qudN" },
};
const SEATS_MAX: Record<string, number | null> = { essentiel: 10, professionnel: 25, premium: null };
const PRICE_TO_PLAN = new Map<string, { offre: string; periodicite: string }>();
for (const [offre, prices] of Object.entries(PRICE_IDS)) {
  PRICE_TO_PLAN.set(prices.mensuel, { offre, periodicite: "mensuel" });
  PRICE_TO_PLAN.set(prices.annuel, { offre, periodicite: "annuel" });
}

// Modules à la carte (voir LANDING_ALACARTE_MODULES, app.js) — un Price Stripe par module et par
// périodicité, avec une tarification "tiered"/"volume" reproduisant ALACARTE_VOLUME_TIERS
// (0-24/25-49/50-99/100+ salariés). Chaque Price porte metadata.module=<clé> côté Stripe : c'est ce
// tag, pas cette table, qui fait foi pour reconstruire subscription_modules depuis
// stripeSubscription.items (voir upsertSubscriptionFromStripeSubscription) — cette table ne sert
// qu'à savoir QUEL Price appeler au moment du "checkout".
// TODO (une fois le script de configuration Stripe exécuté, voir stripe-setup-modules.sh) :
// remplacer chaque "price_TODO_*" par le vrai Price ID imprimé par le script.
const MODULES: Record<string, { unite: "salarie" | "declarant"; priceIds: { mensuel: string; annuel: string } }> = {
  conges: { unite: "salarie", priceIds: { mensuel: "price_TODO_CONGES_MENSUEL", annuel: "price_TODO_CONGES_ANNUEL" } },
  planning: { unite: "salarie", priceIds: { mensuel: "price_TODO_PLANNING_MENSUEL", annuel: "price_TODO_PLANNING_ANNUEL" } },
  frais: { unite: "declarant", priceIds: { mensuel: "price_TODO_FRAIS_MENSUEL", annuel: "price_TODO_FRAIS_ANNUEL" } },
  tickets: { unite: "salarie", priceIds: { mensuel: "price_TODO_TICKETS_MENSUEL", annuel: "price_TODO_TICKETS_ANNUEL" } },
  rh: { unite: "salarie", priceIds: { mensuel: "price_TODO_RH_MENSUEL", annuel: "price_TODO_RH_ANNUEL" } },
  remuneration: { unite: "salarie", priceIds: { mensuel: "price_TODO_REMUNERATION_MENSUEL", annuel: "price_TODO_REMUNERATION_ANNUEL" } },
  entretiens: { unite: "salarie", priceIds: { mensuel: "price_TODO_ENTRETIENS_MENSUEL", annuel: "price_TODO_ENTRETIENS_ANNUEL" } },
};

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
  const items = stripeSubscription.items?.data ?? [];
  // Un abonnement à la carte se reconnaît par ses Price : au moins un porte metadata.module (posé
  // manuellement sur chaque Price lors de sa création, voir MODULES ci-dessus) — jamais par une
  // valeur qu'on aurait nous-mêmes stockée à l'avance, pour rester fidèle à ce que Stripe facture
  // réellement à cet instant.
  const moduleItems = items.filter((it: any) => it.price?.metadata?.module);
  const isAlaCarte = moduleItems.length > 0;
  const dateRenouvellement = stripeSubscription.current_period_end
    ? new Date(stripeSubscription.current_period_end * 1000).toISOString().slice(0, 10)
    : null;

  const patch: Record<string, unknown> = {
    statut: statutFromStripeStatus(stripeSubscription.status),
    date_renouvellement: dateRenouvellement,
    stripe_subscription_id: stripeSubscription.id,
    updated_at: new Date().toISOString(),
  };
  if (isAlaCarte) {
    patch.offre = "a_la_carte";
    patch.periodicite = moduleItems[0].price?.recurring?.interval === "year" ? "annuel" : "mensuel";
    // Pas de plafond de salariés en à la carte : la facturation suit l'effectif réel (voir
    // "resync" plus bas), rien à bloquer côté ajout de salarié.
    patch.nombre_salaries_max = null;
  } else {
    const priceId = items[0]?.price?.id;
    const plan = priceId ? PRICE_TO_PLAN.get(priceId) : undefined;
    if (plan) {
      patch.offre = plan.offre;
      patch.periodicite = plan.periodicite;
      patch.nombre_salaries_max = SEATS_MAX[plan.offre] ?? null;
    }
  }
  if (stripeCustomerId) patch.stripe_customer_id = stripeCustomerId;

  const { error } = await supabaseAdmin.from("subscriptions").update(patch).eq("company_id", companyId);
  if (error) throw error;

  // subscription_modules est un simple miroir de ce que Stripe dit avoir maintenant — on le
  // reconstruit entièrement (delete puis insert) à chaque fois plutôt que d'essayer de calculer un
  // diff, pour ne jamais laisser un module fantôme après un downgrade/changement de modules.
  const { error: delErr } = await supabaseAdmin.from("subscription_modules").delete().eq("company_id", companyId);
  if (delErr) throw delErr;
  if (isAlaCarte) {
    const rows = moduleItems.map((it: any) => ({
      company_id: companyId,
      module_key: it.price.metadata.module,
      quantite: it.quantity,
      stripe_subscription_item_id: it.id,
    }));
    const { error: insErr } = await supabaseAdmin.from("subscription_modules").insert(rows);
    if (insErr) throw insErr;
  }
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

async function getHeadcount(supabaseAdmin: any, companyId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from("employees")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("archive", false);
  return Math.max(1, count ?? 1);
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
  const returnBase: string = (body && body.returnBase) || req.headers.get("origin") || "https://nexus-rh.com/";
  const base = returnBase.endsWith("/") ? returnBase : returnBase + "/";

  try {
    if (body.action === "checkout") {
      const { modules, periodicite } = body;
      if (periodicite !== "mensuel" && periodicite !== "annuel") {
        return jsonResponse({ error: "Périodicité invalide." }, 400);
      }
      if (!Array.isArray(modules) || modules.length === 0) {
        return jsonResponse({ error: "Sélectionnez au moins un module." }, 400);
      }

      const effectif = await getHeadcount(supabaseAdmin, companyId);
      const lineItems: { price: string; quantity: number }[] = [];
      for (const m of modules) {
        const moduleDef = MODULES[m?.key];
        if (!moduleDef) return jsonResponse({ error: `Module inconnu : ${m?.key}` }, 400);
        const priceId = moduleDef.priceIds[periodicite as "mensuel" | "annuel"];
        // "déclarant" (Notes de frais) : quantité choisie par le client (combien de salariés
        // déposent vraiment des notes de frais), jamais l'effectif total — mais toujours plafonnée
        // à l'effectif réel, jamais fiée aveuglément à ce qu'envoie le navigateur.
        const quantite = moduleDef.unite === "declarant"
          ? Math.min(effectif, Math.max(1, parseInt(m.declarants, 10) || 1))
          : effectif;
        lineItems.push({ price: priceId, quantity: quantite });
      }

      let stripeCustomerId = sub?.stripe_customer_id as string | undefined;
      if (!stripeCustomerId) {
        const customer = await stripe.customers.create({ metadata: { company_id: companyId } });
        stripeCustomerId = customer.id;
        await supabaseAdmin.from("subscriptions").update({ stripe_customer_id: stripeCustomerId }).eq("company_id", companyId);
      }

      const session = await stripe.checkout.sessions.create({
        customer: stripeCustomerId,
        mode: "subscription",
        line_items: lineItems,
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

    if (body.action === "resync") {
      // Réaligne les quantités facturées sur l'effectif réel — déclenché à la demande par le
      // client (bouton "Actualiser mon abonnement"), pas automatiquement à chaque embauche/départ
      // (choix v1 : plus simple et plus sûr, pas d'appel Stripe caché derrière une simple action RH).
      if (!sub?.offre || sub.offre !== "a_la_carte" || !sub.stripe_subscription_id) {
        return jsonResponse({ error: "Aucun abonnement à la carte actif pour cette entreprise." }, 400);
      }
      const stripeSubscription = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
      const effectif = await getHeadcount(supabaseAdmin, companyId);
      const declarantOverrides: Record<string, unknown> = (body && body.declarants) || {};

      for (const item of stripeSubscription.items.data as any[]) {
        const key = item.price?.metadata?.module;
        const moduleDef = key ? MODULES[key] : undefined;
        if (!moduleDef) continue;
        let newQuantite = item.quantity;
        if (moduleDef.unite === "salarie") {
          newQuantite = effectif;
        } else if (moduleDef.unite === "declarant" && declarantOverrides[key] != null) {
          newQuantite = Math.min(effectif, Math.max(1, parseInt(String(declarantOverrides[key]), 10) || 1));
        }
        if (newQuantite !== item.quantity) {
          await stripe.subscriptionItems.update(item.id, { quantity: newQuantite, proration_behavior: "create_prorations" });
        }
      }

      const refreshed = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
      await upsertSubscriptionFromStripeSubscription(supabaseAdmin, companyId, refreshed);
      return jsonResponse({ ok: true });
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
