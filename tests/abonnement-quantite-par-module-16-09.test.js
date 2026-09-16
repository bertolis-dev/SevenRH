/**
 * Seven RH — retour Betty du 16/09/2026 : après avoir généralisé le champ "nombre de salariés par
 * module" sur le simulateur public (voir simulateur-tarifs-par-module-16-09.test.js), elle précise
 * que c'est l'écran RÉEL Paramètres → Abonnement (facturation Stripe) qui doit l'avoir, pas
 * seulement le simulateur de la page publique : "j'ai pas de quoi changer le nombre de personnes
 * pour tous les modules". Jusqu'ici, seul Notes de frais (unité "déclarant") permettait de choisir
 * une quantité différente de l'effectif total ; généralisé à tous les modules, à la fois dans le
 * compositeur (souscription/modification) et dans le tableau de l'abonnement déjà actif.
 * Interaction réelle (clics, appels à billingRepository/Stripe) non reproductible dans ce bac à
 * sable minimal (voir load-app-js.js) — vérifiée manuellement dans le navigateur ; ces tests
 * portent sur le HTML produit et sur la logique serveur (vérification statique du code source).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAppJs } = require('./load-app-js');

async function runComposeurChampParModule() {
  const { renderAbonnementAlaCarteComposer, LANDING_ALACARTE_MODULES } = loadAppJs();

  const html = renderAbonnementAlaCarteComposer(12);

  LANDING_ALACARTE_MODULES.forEach(m => {
    assert.ok(html.includes(`id="abo-alacarte-count-${m.key}"`), `le module "${m.key}" doit avoir son propre champ d'effectif dans le compositeur d'abonnement, pas seulement Notes de frais`);
  });
  assert.ok(html.includes('Combien de salariés déposent des notes de frais ?'), 'le libellé spécifique à Notes de frais doit être préservé');
  assert.ok(html.includes('Combien de salariés auront "Entretiens" ?'), 'un module facturé par salarié doit avoir le libellé générique, nommant le module concerné');
  assert.ok(!html.includes('sauf Notes de frais'), 'le texte d\'introduction ne doit plus présenter Notes de frais comme une exception');

  console.log('OK — abonnement-quantite-par-module-16-09.test.js (compositeur : chaque module a son propre champ d\'effectif)');
}

async function runTableauActifChampParModule() {
  const { renderAbonnementAlaCarteActif } = loadAppJs();

  const abo = {
    statut: 'actif',
    periodicite: 'mensuel',
    dateDebut: '2026-01-01',
    dateRenouvellement: '2026-10-01',
    modules: [
      { key: 'conges', quantite: 5 },
      { key: 'frais', quantite: 2 },
      { key: 'entretiens', quantite: 3 },
    ],
  };

  const html = renderAbonnementAlaCarteActif(abo, 12, 'success');

  abo.modules.forEach(m => {
    assert.ok(html.includes(`id="abo-quantite-${m.key}"`), `le module actif "${m.key}" doit avoir son propre champ de mise à jour de quantité`);
    assert.ok(html.includes(`data-update-module-quantite="${m.key}"`), `le module actif "${m.key}" doit avoir son propre bouton "Mettre à jour"`);
  });

  console.log('OK — abonnement-quantite-par-module-16-09.test.js (tableau actif : chaque module a son propre champ de mise à jour)');
}

async function runEffectifDesaligneSurDepassementSeulement() {
  const { renderAbonnementAlaCarteActif } = loadAppJs();

  // Une quantité volontairement RÉDUITE (5 sur 12) pour un module "salarié" ne doit plus déclencher
  // l'alerte "facturation désalignée" — c'est un choix délibéré, pas un effectif qui a dérivé.
  const aboReduit = { statut: 'actif', periodicite: 'mensuel', modules: [{ key: 'conges', quantite: 5 }] };
  const htmlReduit = renderAbonnementAlaCarteActif(aboReduit, 12, 'success');
  assert.ok(!htmlReduit.includes('ne correspond plus à votre effectif actuel'), 'une quantité réduite volontairement ne doit pas déclencher l\'alerte de désalignement');

  // Une quantité qui DÉPASSE l'effectif réel (ex. un salarié parti, jamais réactualisé) reste une
  // vraie anomalie à signaler.
  const aboDepasse = { statut: 'actif', periodicite: 'mensuel', modules: [{ key: 'conges', quantite: 12 }] };
  const htmlDepasse = renderAbonnementAlaCarteActif(aboDepasse, 8, 'success');
  assert.ok(htmlDepasse.includes('ne correspond plus à votre effectif actuel'), 'une quantité facturée supérieure à l\'effectif réel doit rester signalée');

  console.log('OK — abonnement-quantite-par-module-16-09.test.js (alerte de désalignement limitée au dépassement de l\'effectif réel)');
}

async function runCalculTotalNePlusLimiteAuDeclarant() {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const fnStart = appSource.indexOf('function computeAbonnementAlacarteTotal(');
  const fnBody = appSource.slice(fnStart, fnStart + 700);
  assert.ok(!fnBody.includes("moduleUnite === 'déclarant'"), 'computeAbonnementAlacarteTotal ne doit plus traiter "déclarant" comme un cas particulier');
  assert.ok(fnBody.includes('abo-alacarte-count-'), 'le total doit toujours lire le champ d\'effectif par module, pour tous les modules');

  console.log('OK — abonnement-quantite-par-module-16-09.test.js (calcul du total unifié, plus de branche spéciale pour "déclarant")');
}

async function runFonctionServeurQuantiteGeneralisee() {
  const billingSource = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'billing', 'index.ts'), 'utf8');

  assert.ok(!billingSource.includes('unite === "declarant"'), 'la fonction billing ne doit plus réserver le choix de quantité au module "déclarant" — checkout/update-modules doivent lire m.quantite pour tous les modules');
  assert.ok(!billingSource.includes('unite === "salarie"'), 'la fonction billing ne doit plus forcer automatiquement les modules "salarié" à l\'effectif total — la quantité choisie par le client doit être respectée pour tous les modules');
  assert.ok(billingSource.includes('parseInt(m.quantite'), 'checkout/update-modules doivent lire une quantité par module (m.quantite), plus seulement m.declarants');
  assert.ok(billingSource.includes('body.quantites'), 'resync doit accepter des quantités par module sous le nom générique "quantites", plus seulement "declarants"');

  console.log('OK — abonnement-quantite-par-module-16-09.test.js (fonction serveur billing : quantité par module généralisée, plus de forçage automatique à l\'effectif)');
}

runComposeurChampParModule()
  .then(runTableauActifChampParModule)
  .then(runEffectifDesaligneSurDepassementSeulement)
  .then(runCalculTotalNePlusLimiteAuDeclarant)
  .then(runFonctionServeurQuantiteGeneralisee)
  .catch((err) => {
    console.error('ÉCHEC — abonnement-quantite-par-module-16-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
