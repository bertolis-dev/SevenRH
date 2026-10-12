/**
 * Seven RH — brief du 12/10/2026, C1 (justificatif) : le justificatif doit être obligatoire pour soumettre une
 * note de frais. Constat : réglable seulement catégorie par catégorie, FACULTATIF par défaut. Corrigé : un réglage
 * général « justificatif obligatoire pour toute note » (activé par défaut) ; désactivé, les règles par catégorie
 * (obligatoire, ou au-delà d'un seuil) s'appliquent comme avant.
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

function runLeJustificatifEstObligatoireParDefaut() {
  const api = setup();
  const reglages = api.settingsRepository.getSettings();
  assert.strictEqual(reglages.justificatifNoteFraisObligatoire, true, 'défaut : obligatoire pour toute note');
  const { isJustificatifObligatoireForExpense } = api.sandbox;
  const categorie = reglages.categoriesFrais[0];
  assert.strictEqual(isJustificatifObligatoireForExpense(categorie, 5, reglages), true, 'même pour 5 € : justificatif obligatoire');
  assert.strictEqual(isJustificatifObligatoireForExpense('Catégorie inconnue', 5, reglages), true, 'même pour une catégorie sans configuration');
  console.log('OK — c1a-justificatif-obligatoire-12-10.test.js (justificatif obligatoire pour toute note par défaut)');
}

function runDesactiveLesReglesParCategorieReprennent() {
  const api = setup();
  const reglages = { ...api.settingsRepository.getSettings(), justificatifNoteFraisObligatoire: false };
  const { isJustificatifObligatoireForExpense } = api.sandbox;
  reglages.categoriesFraisConfig = { Repas: { plafond: null, justificatifObligatoire: false, seuilJustificatif: 25 }, Hôtel: { plafond: null, justificatifObligatoire: true, seuilJustificatif: null } };
  assert.strictEqual(isJustificatifObligatoireForExpense('Repas', 20, reglages), false, 'sous le seuil : facultatif');
  assert.strictEqual(isJustificatifObligatoireForExpense('Repas', 30, reglages), true, 'au-delà du seuil : obligatoire');
  assert.strictEqual(isJustificatifObligatoireForExpense('Hôtel', 10, reglages), true, 'catégorie marquée obligatoire');
  assert.strictEqual(isJustificatifObligatoireForExpense('Inconnue', 10, reglages), false, 'sans configuration et sans règle générale : facultatif (ancien comportement)');
  console.log('OK — c1a-justificatif-obligatoire-12-10.test.js (règle générale désactivée : règles par catégorie inchangées)');
}

function runLeReglageEstDansParametresNotesDeFrais() {
  const api = setup();
  const html = api.renderParametresNotesFrais();
  assert.ok(html.includes('id="f-justificatif-obligatoire"'), 'case « Justificatif obligatoire pour toute note »');
  assert.ok(html.includes('checked') && /Justificatif obligatoire pour toute note/.test(html));
  console.log('OK — c1a-justificatif-obligatoire-12-10.test.js (réglage dans Paramètres > Notes de frais)');
}

function runLaSoumissionEstBloqueeSansJustificatif() {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const i = app.indexOf('async function submitExpenseForm');
  const corps = app.slice(i, i + 9000);
  assert.ok(/isJustificatifObligatoireForExpense\(categorie, montantTTC, settings\) && !state\.pendingAttachment/.test(corps), 'la soumission refuse une note sans justificatif quand il est obligatoire');
  console.log('OK — c1a-justificatif-obligatoire-12-10.test.js (soumission bloquée sans justificatif)');
}

try {
  runLeJustificatifEstObligatoireParDefaut();
  runDesactiveLesReglesParCategorieReprennent();
  runLeReglageEstDansParametresNotesDeFrais();
  runLaSoumissionEstBloqueeSansJustificatif();
} catch (err) {
  console.error('ÉCHEC — c1a-justificatif-obligatoire-12-10.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
