#!/usr/bin/env bash
# Nexus RH — crée les 2 Price Stripe du nouveau module "Pointeuse QR" (mensuel + annuel), même
# patron que stripe-setup-embauche-module.sh (extrait de stripe-setup-modules.sh pour ne jamais
# risquer de relancer les modules déjà en production — une clé d'idempotence Stripe n'est garantie
# que ~24h).
#
# Usage :
#   STRIPE_SECRET_KEY=sk_live_xxx ./stripe-setup-pointage-module.sh
#
# Une fois lancé : notez les deux "id": "price_..." affichés (mensuel et annuel), puis remplacez
# les deux placeholders price_REMPLACER_MENSUEL_POINTAGE / price_REMPLACER_ANNUEL_POINTAGE dans
# supabase/functions/billing/index.ts (déjà mis à jour côté code, juste ces 2 valeurs à coller),
# puis redéployez cette fonction (copier/coller dans le Dashboard Supabase, comme d'habitude).

set -euo pipefail

if [ -z "${STRIPE_SECRET_KEY:-}" ]; then
  echo "Erreur : définissez STRIPE_SECRET_KEY avant de lancer ce script." >&2
  echo "Exemple : STRIPE_SECRET_KEY=sk_live_xxx ./stripe-setup-pointage-module.sh" >&2
  exit 1
fi

create_price() {
  local module_key="$1" ascii_label="$2" interval="$3" t1="$4" t2="$5" t3="$6" t4="$7"
  echo "--- $ascii_label ($interval) ---"
  local response
  response=$(curl -s https://api.stripe.com/v1/prices \
    -u "${STRIPE_SECRET_KEY}:" \
    -H "Idempotency-Key: nexus-rh-${module_key}-${interval}-v1" \
    --data-urlencode "currency=eur" \
    --data-urlencode "billing_scheme=tiered" \
    --data-urlencode "tiers_mode=volume" \
    --data-urlencode "nickname=${ascii_label} (${interval})" \
    --data-urlencode "product_data[name]=Nexus RH - ${ascii_label}" \
    --data-urlencode "recurring[interval]=${interval}" \
    --data-urlencode "recurring[usage_type]=licensed" \
    --data-urlencode "metadata[module]=${module_key}" \
    --data-urlencode "tiers[0][up_to]=24"    --data-urlencode "tiers[0][unit_amount]=${t1}" \
    --data-urlencode "tiers[1][up_to]=49"    --data-urlencode "tiers[1][unit_amount]=${t2}" \
    --data-urlencode "tiers[2][up_to]=99"    --data-urlencode "tiers[2][unit_amount]=${t3}" \
    --data-urlencode "tiers[3][up_to]=inf"   --data-urlencode "tiers[3][unit_amount]=${t4}")
  echo "$response"
  if echo "$response" | grep -q '"id": *"price_'; then
    echo ">>> OK"
  else
    echo ">>> ECHEC — voir l'erreur ci-dessus"
  fi
  echo
}

# Prix de départ 1,50 €/salarié/mois (voir LANDING_ALACARTE_MODULES, app.js — À CONFIRMER PAR
# BETTY, ajustable ici avant de lancer le script) : mêmes paliers de volume que les autres modules
# (plein tarif jusqu'à 24 salariés, -5 % dès 25, -10 % dès 50, -15 % dès 100).
create_price pointage "Pointeuse QR" month 150 143 135 128
create_price pointage "Pointeuse QR" year  1500 1430 1350 1280

echo "Terminé. Reportez les 2 \"id\": \"price_...\" ci-dessus dans MODULES.pointage (supabase/functions/billing/index.ts), puis redéployez la fonction."
