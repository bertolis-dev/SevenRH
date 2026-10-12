/**
 * Seven RH — brief du 12/10/2026, C1 (HT / TVA / TTC) : séparer HT, TVA et TTC avec le taux de TVA. Constat : le
 * taux existe et le détail d'une note les montre, mais le formulaire de saisie n'affichait rien en direct (le
 * salarié ne voyait pas ce que son TTC et son taux donnent). Corrigé : une ligne « HT … · TVA … (taux) » se met à
 * jour pendant la saisie.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAppJs } = require('./load-app-js');

function setup() {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  const rh = api.DB.getEmployees().find(e => e.role === 'rh');
  api.DB._currentEmployeeId = rh.id;
  return api;
}

function runLaVentilationEstCoherente() {
  const { ventilationTvaNote } = loadAppJs().sandbox;
  const v = ventilationTvaNote(120, 20);
  assert.strictEqual(v.ttc, 120);
  assert.strictEqual(v.ht, 100);
  assert.strictEqual(v.tva, 20);
  assert.strictEqual(round(v.ht + v.tva), v.ttc, 'HT + TVA = TTC, au centime');
  const v2 = ventilationTvaNote(10, 5.5);
  assert.strictEqual(round(v2.ht + v2.tva), 10, 'jamais d\'écart d\'arrondi entre HT, TVA et TTC');
  const sansTva = ventilationTvaNote(50, 0);
  assert.strictEqual(sansTva.tva, 0);
  assert.strictEqual(sansTva.ht, 50);
  assert.ok(/HT/.test(v.texte) && /TVA/.test(v.texte) && /20/.test(v.texte), 'texte lisible avec le taux');
  assert.strictEqual(ventilationTvaNote('', 20).texte, '', 'rien à afficher tant qu\'aucun montant n\'est saisi');
  assert.strictEqual(ventilationTvaNote('abc', 20).texte, '', 'une saisie invalide n\'affiche rien');
  console.log('OK — c1c-ventilation-ht-tva-12-10.test.js (HT + TVA = TTC au centime, texte avec le taux, saisie vide ou invalide ignorée)');
}

function round(n) { return Math.round(n * 100) / 100; }

function runLeFormulaireAfficheLaVentilationEnDirect() {
  const api = setup();
  api.sandbox.openExpenseModal();
  const html = api.sandbox.document.getElementById('modal-root').innerHTML;
  assert.ok(html.includes('id="expense-ht-tva-hint"'), 'la ligne de ventilation existe dans le formulaire');
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.ok(/getElementById\('f-montantTTC'\)\.addEventListener\('input', updateExpenseTvaHint\)/.test(app), 'mise à jour à chaque saisie du montant');
  assert.ok(/getElementById\('f-tauxTVA'\)\.addEventListener\('change', updateExpenseTvaHint\)/.test(app), 'et au changement de taux');
  console.log('OK — c1c-ventilation-ht-tva-12-10.test.js (formulaire : ligne HT/TVA/TTC mise à jour en direct)');
}

try {
  runLaVentilationEstCoherente();
  runLeFormulaireAfficheLaVentilationEnDirect();
} catch (err) {
  console.error('ÉCHEC — c1c-ventilation-ht-tva-12-10.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
