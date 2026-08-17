#!/usr/bin/env bash
# Nexus RH — création des Produits/Prix Stripe pour la tarification à la carte (7 modules x 2
# périodicités = 14 Price à créer). À exécuter UNE FOIS en mode test (clé sk_test_...), à vérifier
# dans le Dashboard Stripe, puis UNE FOIS en mode live (clé sk_live_...) une fois satisfait.
#
# Chaque Price est "tiered"/"volume" : le tarif appliqué à TOUTE la quantité dépend du palier dans
# lequel elle tombe (0-24 salariés : plein tarif, 25-49 : -5%, 50-99 : -10%, 100+ : -15%) — voir
# ALACARTE_VOLUME_TIERS dans app.js. Chaque Price porte metadata.module=<clé> : c'est cette
# métadonnée, pas un mapping codé en dur, que billing/index.ts et stripe-webhook/index.ts utilisent
# pour savoir quel module facture quoi.
#
# Usage :
#   STRIPE_SECRET_KEY=sk_test_xxx ./stripe-setup-modules.sh
#
# Le script affiche la réponse brute de Stripe pour chaque Price créé : notez le champ "id"
# (price_...) de chacun, puis reportez les 14 valeurs dans MODULES (billing/index.ts) ET dans
# MODULES (stripe-webhook/index.ts n'en a pas besoin — seul billing/index.ts crée des Checkout
# Sessions).

set -euo pipefail

if [ -z "${STRIPE_SECRET_KEY:-}" ]; then
  echo "Erreur : définissez STRIPE_SECRET_KEY avant de lancer ce script." >&2
  echo "Exemple : STRIPE_SECRET_KEY=sk_test_xxx ./stripe-setup-modules.sh" >&2
  exit 1
fi

create_price() {
  local module_key="$1" label="$2" interval="$3" t1="$4" t2="$5" t3="$6" t4="$7"
  echo "--- $label ($interval) ---"
  curl -s https://api.stripe.com/v1/prices \
    -u "${STRIPE_SECRET_KEY}:" \
    -d "currency=eur" \
    -d "billing_scheme=tiered" \
    -d "tiers_mode=volume" \
    -d "nickname=${label} (${interval})" \
    -d "product_data[name]=Nexus RH — ${label}" \
    -d "recurring[interval]=${interval}" \
    -d "recurring[usage_type]=licensed" \
    -d "metadata[module]=${module_key}" \
    -d "tiers[0][up_to]=24"    -d "tiers[0][unit_amount]=${t1}" \
    -d "tiers[1][up_to]=49"    -d "tiers[1][unit_amount]=${t2}" \
    -d "tiers[2][up_to]=99"    -d "tiers[2][unit_amount]=${t3}" \
    -d "tiers[3][up_to]=inf"   -d "tiers[3][unit_amount]=${t4}"
  echo
}

# module_key | label | mois:t1 t2 t3 t4 (centimes) | an:t1 t2 t3 t4 (centimes, = mois x10, 2 mois offerts)
create_price conges       "Congés, absences et calendrier"                 month 290 276 261 247
create_price conges       "Congés, absences et calendrier"                 year  2900 2760 2610 2470

create_price planning     "Planning, télétravail"                          month 210 200 189 179
create_price planning     "Planning, télétravail"                          year  2100 2000 1890 1790

create_price frais        "Notes de frais"                                 month 520 494 468 442
create_price frais        "Notes de frais"                                 year  5200 4940 4680 4420

create_price tickets      "Tickets restaurant"                             month 95  90  86  81
create_price tickets      "Tickets restaurant"                             year  950 900 860 810

create_price rh           "Module RH (salariés, paie, documents, organigramme)" month 650 618 585 553
create_price rh           "Module RH (salariés, paie, documents, organigramme)" year  6500 6180 5850 5530

create_price remuneration "Rémunération"                                   month 150 143 135 128
create_price remuneration "Rémunération"                                   year  1500 1430 1350 1280

create_price entretiens   "Entretiens"                                     month 190 181 171 162
create_price entretiens   "Entretiens"                                     year  1900 1810 1710 1620

echo "Terminé. Reportez chaque \"id\": \"price_...\" (module + périodicité) dans MODULES, en haut de supabase/functions/billing/index.ts."
