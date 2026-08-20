#!/usr/bin/env bash
# Nexus RH — création des Produits/Prix Stripe pour la tarification à la carte (7 modules x 2
# périodicités = 14 Price à créer). À exécuter UNE FOIS en mode test (clé sk_test_...), à vérifier
# dans le Dashboard Stripe, puis UNE FOIS en mode live (clé sk_live_...) une fois satisfait.
#
# Déjà exécuté en production le 17/08/2026 pour ces 7 modules — NE PAS RELANCER tel quel (la clé
# d'idempotence Stripe n'est garantie que ~24h, un nouveau lancement plusieurs jours après pourrait
# créer des Price en double). Pour un 8ᵉ module ajouté depuis ("embauche", 20/08/2026), voir le
# script séparé stripe-setup-embauche-module.sh — volontairement PAS ajouté ici, justement pour
# éviter ce risque.
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
  local module_key="$1" ascii_label="$2" interval="$3" t1="$4" t2="$5" t3="$6" t4="$7"
  echo "--- $ascii_label ($interval) ---"
  # ascii_label (pas d'accents) plutôt que le libellé français exact : sur ce Git Bash Windows, un
  # nom de produit accentué (Congés, Rémunération...) fait échouer TOUTE la requête avec une erreur
  # Stripe générique — reproductible même avec --data-urlencode, donc pas un simple problème
  # d'encodage HTTP mais de corruption des octets multi-byte avant même que curl les reçoive
  # (locale du shell). Le nom Stripe n'a qu'un usage interne (Dashboard) et n'a pas besoin de
  # reprendre l'accentuation exacte de l'app — seule metadata.module (toujours ASCII) compte pour
  # la logique métier (billing/index.ts, stripe-webhook/index.ts).
  # Idempotency-Key : un ré-essai après un échec ne doit jamais créer un second Price identique.
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

# module_key | ascii_label (nom Stripe, sans accent) | mois:t1 t2 t3 t4 (centimes) | an:t1 t2 t3 t4 (centimes, = mois x10)
create_price conges       "Conges, absences et calendrier"                 month 290 276 261 247
create_price conges       "Conges, absences et calendrier"                 year  2900 2760 2610 2470

create_price planning     "Planning, teletravail"                          month 210 200 189 179
create_price planning     "Planning, teletravail"                          year  2100 2000 1890 1790

create_price frais        "Notes de frais"                                 month 520 494 468 442
create_price frais        "Notes de frais"                                 year  5200 4940 4680 4420

create_price tickets      "Tickets restaurant"                             month 95  90  86  81
create_price tickets      "Tickets restaurant"                             year  950 900 860 810

create_price rh           "Module RH (salaries, paie, documents, organigramme)" month 650 618 585 553
create_price rh           "Module RH (salaries, paie, documents, organigramme)" year  6500 6180 5850 5530

create_price remuneration "Remuneration"                                   month 150 143 135 128
create_price remuneration "Remuneration"                                   year  1500 1430 1350 1280

create_price entretiens   "Entretiens"                                     month 190 181 171 162
create_price entretiens   "Entretiens"                                     year  1900 1810 1710 1620

echo "Terminé. Reportez chaque \"id\": \"price_...\" (module + périodicité) dans MODULES, en haut de supabase/functions/billing/index.ts."
