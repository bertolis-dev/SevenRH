/**
 * Seven RH — retour Betty du 16/09/2026 : "tu vas mettre pour choisir pour chaque module le nombre
 * de personnes qui l'auront" — le champ d'effectif dédié n'existait jusqu'ici que pour Notes de
 * frais (facturé par déclarant, jamais tout l'effectif) ; généralisé à tous les modules du
 * simulateur public (landing page). Interaction réelle (querySelectorAll/clics) non reproductible
 * dans ce bac à sable minimal (voir load-app-js.js) — vérifiée manuellement dans le navigateur,
 * comme toute la partie interactive de la landing page ; ce test porte sur le HTML produit.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function runChampParModule() {
  const { sandbox, renderLandingScreen, LANDING_ALACARTE_MODULES } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  sandbox.window.location = { hash: '' };

  renderLandingScreen();
  const html = sandbox.document.getElementById('landing-root').innerHTML;

  // Chaque module du tableau — pas seulement Notes de frais — doit avoir son propre champ d'effectif.
  LANDING_ALACARTE_MODULES.forEach(m => {
    assert.ok(html.includes(`id="alacarte-count-${m.key}"`), `le module "${m.key}" doit avoir son propre champ d'effectif, pas seulement Notes de frais`);
  });

  // Le libellé de Notes de frais (déclarants) reste tel quel, jamais remplacé par le libellé générique.
  assert.ok(html.includes('Combien de salariés déposent des notes de frais ?'), 'le libellé spécifique à Notes de frais doit être préservé');
  // Un module "salarié" (pas déclarant) prend le libellé générique, avec son propre nom dedans.
  assert.ok(html.includes('Combien de salariés auront "Entretiens" ?'), 'un module facturé par salarié doit avoir le libellé générique, nommant le module concerné');

  console.log('OK — simulateur-tarifs-par-module-16-09.test.js (chaque module a son propre champ d\'effectif, plus seulement Notes de frais)');
}

async function runCalculNePlusLimiteAuDeclarant() {
  // §vérification statique : computeAlacarteTotal ne doit plus distinguer par unite (déclarant vs
  // salarié) — les deux lisent désormais le même champ d'effectif par module. Le comportement
  // interactif réel (changer un champ, voir le total se recalculer) est vérifié dans le navigateur ;
  // ici, on vérifie que le code source ne contient plus l'ancienne branche spécifique au déclarant.
  const fs = require('fs');
  const path = require('path');
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const fnStart = appSource.indexOf('function computeAlacarteTotal()');
  const fnBody = appSource.slice(fnStart, fnStart + 900);
  assert.ok(!fnBody.includes("dataset.moduleUnite === 'déclarant'"), 'computeAlacarteTotal ne doit plus traiter "déclarant" comme un cas particulier : tous les modules lisent leur propre champ d\'effectif de la même façon');
  assert.ok(fnBody.includes('alacarte-count-'), 'le total doit toujours lire le champ d\'effectif par module, pour tous les modules');

  console.log('OK — simulateur-tarifs-par-module-16-09.test.js (calcul unifié : plus de branche spéciale pour "déclarant")');
}

runChampParModule()
  .then(runCalculNePlusLimiteAuDeclarant)
  .catch((err) => {
    console.error('ÉCHEC — simulateur-tarifs-par-module-16-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
