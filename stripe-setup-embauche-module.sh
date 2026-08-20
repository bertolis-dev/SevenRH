#!/usr/bin/env bash
# Nexus RH — crée UNIQUEMENT les 2 Price Stripe du nouveau module "Embauche" (mensuel + annuel),
# extrait de stripe-setup-modules.sh pour éviter tout risque de relancer les 7 modules déjà créés en
# production le 17/08/2026 (une clé d'idempotence Stripe n'est garantie que ~24h — la relancer
# plusieurs jours après pourrait recréer des Price en double pour les modules déjà existants).
#
# Usage :
#   STRIPE_SECRET_KEY=sk_live_xxx ./stripe-setup-embauche-module.sh
#
# Une fois lancé : notez les deux "id": "price_..." affichés (mensuel et annuel), puis remplacez
# les deux placeholders price_REMPLACER_MENSUEL_EMBAUCHE / price_REMPLACER_ANNUEL_EMBAUCHE dans
# supabase/functions/billing/index.ts (déjà mis à jour côté code, juste ces 2 valeurs à coller), puis
# redéployez cette fonction (copier/coller dans le Dashboard Supabase, comme d'habitude).

set -euo pipefail

if [ -z "${STRIPE_SECRET_KEY:-}" ]; then
  echo "Erreur : définissez STRIPE_SECRET_KEY avant de lancer ce script." >&2
  echo "Exemple : STRIPE_SECRET_KEY=sk_live_xxx ./stripe-setup-embauche-module.sh" >&2
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

# Mêmes paliers que "Entretiens" (même prix de base, 1,90 €/salarié/mois) : plein tarif jusqu'à 24
# salariés, -5 % dès 25, -10 % dès 50, -15 % dès 100 (voir ALACARTE_VOLUME_TIERS, app.js).
create_price embauche "Embauche" month 190 181 171 162
create_price embauche "Embauche" year  1900 1810 1710 1620

echo "Terminé. Reportez les 2 \"id\": \"price_...\" ci-dessus dans MODULES.embauche (supabase/functions/billing/index.ts), puis redéployez la fonction."
