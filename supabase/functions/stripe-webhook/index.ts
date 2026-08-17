// Seven RH — fonction "stripe-webhook" : appelée directement par Stripe (jamais par le site), donc
// PAS de jeton Supabase à vérifier ici — la vérification vient de la signature Stripe (voir
// STRIPE_WEBHOOK_SECRET). Source de vérité durable pour l'état de l'abonnement, y compris quand
// l'utilisateur ferme l'onglet avant le retour sur le site (billing/confirm ne couvre que le cas
// où il revient bien) et pour tout événement qui n'a pas d'origine "site" (échec de paiement,
// annulation depuis le portail Stripe, etc.).
//
// IMPORTANT côté configuration Supabase : cette fonction doit être créée avec la vérification JWT
// DÉSACTIVÉE ("Enforce JWT verification" décoché) — Stripe n'envoie pas de jeton Supabase, la
// plateforme rejetterait sinon la requête avant même qu'elle n'arrive ici.
//
// Note : la logique "upsertSubscriptionFromStripeSubscription" ci-dessous est dupliquée à
// l'identique dans billing/index.ts (voir le commentaire là-bas pour la raison : déploiement par
// copier-coller dans le tableau de bord Supabase, sans fichier partagé entre fonctions). Si vous
// modifiez cette logique, répercutez le changement dans les deux fichiers.

import Stripe from "npm:stripe@14";
import { createClient } from "npm:@supabase/supabase-js@2";

// Ancien système à 3 paliers — conservé UNIQUEMENT pour les abonnements déjà souscrits avant le
// passage à la carte (14/08/2026), voir le même commentaire dans billing/index.ts. Un abonnement à
// la carte se reconnaît par ses Price (metadata.module posé dessus), jamais par cette table.
const PRICE_TO_PLAN = new Map<string, { offre: string; periodicite: string }>([
  ["price_1TzGXFCAcL94JssKcYV67hON", { offre: "essentiel", periodicite: "mensuel" }],
  ["price_1TzGXFCAcL94JssKSGtncWWL", { offre: "essentiel", periodicite: "annuel" }],
  ["price_1TzGXpCAcL94JssKm7eW7z2S", { offre: "professionnel", periodicite: "mensuel" }],
  ["price_1TzGXpCAcL94JssKszqeXYG7", { offre: "professionnel", periodicite: "annuel" }],
  ["price_1TzGYOCAcL94JssKIR4YmNJS", { offre: "premium", periodicite: "mensuel" }],
  ["price_1TzGYOCAcL94JssKmwB7qudN", { offre: "premium", periodicite: "annuel" }],
]);

// Plafond de salariés par offre — reflète OFFRES_BERTOLIS (data.js) pour cette même offre.
const SEATS_MAX: Record<string, number | null> = { essentiel: 10, professionnel: 25, premium: null };

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
  // manuellement sur chaque Price lors de sa création, voir MODULES dans billing/index.ts) — jamais
  // par une valeur qu'on aurait nous-mêmes stockée à l'avance, pour rester fidèle à ce que Stripe
  // facture réellement à cet instant.
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
    // Pas de plafond de salariés en à la carte : la facturation suit l'effectif réel (voir l'action
    // "resync" de billing/index.ts), rien à bloquer côté ajout de salarié.
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

  // subscription_modules est un simple miroir de ce que Stripe dit avoir maintenant — reconstruit
  // entièrement (delete puis insert) à chaque fois plutôt qu'un diff, pour ne jamais laisser un
  // module fantôme après un downgrade/changement de modules décidé depuis le portail Stripe.
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
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

async function alreadyProcessed(eventId: string): Promise<boolean> {
  // Stripe peut renvoyer le même événement plusieurs fois (retry réseau) — l'insertion échoue si
  // déjà présent (clé primaire), ce qui nous dit directement "déjà traité, ne rien refaire".
  const { error } = await supabaseAdmin.from("processed_stripe_events").insert({ event_id: eventId });
  return !!error;
}

async function companyIdFromSubscription(subscription: any): Promise<string | null> {
  if (subscription.metadata?.company_id) return subscription.metadata.company_id;
  // Filet de sécurité si la métadonnée manquait pour une raison quelconque : retrouve l'entreprise
  // via le stripe_customer_id déjà enregistré lors du premier abonnement.
  const { data } = await supabaseAdmin
    .from("subscriptions")
    .select("company_id")
    .eq("stripe_customer_id", subscription.customer)
    .maybeSingle();
  return data?.company_id || null;
}

Deno.serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature!, WEBHOOK_SECRET);
  } catch (err) {
    console.error("Signature Stripe invalide:", err);
    return new Response("Signature invalide", { status: 400 });
  }

  if (await alreadyProcessed(event.id)) {
    return new Response("Déjà traité", { status: 200 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const companyId = session.metadata?.company_id;
        if (companyId && session.subscription) {
          const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
          await upsertSubscriptionFromStripeSubscription(
            supabaseAdmin,
            companyId,
            subscription,
            typeof session.customer === "string" ? session.customer : undefined
          );
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const companyId = await companyIdFromSubscription(subscription);
        if (companyId) await upsertSubscriptionFromStripeSubscription(supabaseAdmin, companyId, subscription);
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        if (invoice.subscription) {
          const subscription = await stripe.subscriptions.retrieve(invoice.subscription as string);
          const companyId = await companyIdFromSubscription(subscription);
          if (companyId) await upsertSubscriptionFromStripeSubscription(supabaseAdmin, companyId, subscription);
        }
        break;
      }
      default:
        break; // Événement non pertinent pour nous — ignoré volontairement.
    }
  } catch (err) {
    console.error(`Erreur traitement ${event.type}:`, err);
    return new Response("Erreur interne", { status: 500 });
  }

  return new Response("ok", { status: 200 });
});
