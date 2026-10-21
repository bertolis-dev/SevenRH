/**
 * Seven RH — retour du 21/10/2026 : « un petit module de prise en main pour les entreprises qui arrivent sur Nexus : les étapes et
 * les paramétrages à suivre, dans l'ordre, pour bien renseigner les données de départ (salariés, types de congés, soldes, historique) ».
 * Écran « Prise en main » : parcours en 8 étapes avec schéma, état « fait / à faire » calculé sur les vraies données, bouton qui
 * mène à l'écran concerné, et l'explication du calcul d'un solde (le point qui a manqué à la première utilisatrice).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function setup() {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  api.DB._currentEmployeeId = api.DB.getEmployees().find(e => e.role === 'rh').id;
  return api;
}

function run() {
  const api = setup();
  const { DB, sandbox } = api;
  const etapes = sandbox.getEtapesPriseEnMain();
  assert.deepStrictEqual(Array.from(etapes, e => e.key), ['entreprise', 'salaries', 'types', 'historique', 'soldes', 'verification', 'mise-en-service', 'comptes'], 'les 8 étapes, dans l\'ordre');
  etapes.forEach(e => {
    assert.ok(e.titre && e.pourquoi && e.ou, `${e.key} : titre, raison et emplacement renseignés`);
    assert.ok(e.action && e.action.view && e.action.label, `${e.key} : bouton vers l'écran concerné`);
    assert.strictEqual(typeof e.fait, 'boolean');
  });
  assert.strictEqual(etapes.find(e => e.key === 'historique').fait, false, 'rien d\'importé : étape à faire');
  assert.strictEqual(etapes.find(e => e.key === 'soldes').fait, false, 'aucun solde ajusté : étape à faire');

  // les étapes passent à « fait » d'après les vraies données
  const salarie = DB.getEmployees().find(e => e.role === 'salarie');
  const cp = DB.getLeaveTypes().find(t => t.nom === 'Congés payés');
  DB.ajusterCompteurConge(salarie.id, cp.id, 5, 'test');
  DB.importerAbsenceHistorique({ employeeId: salarie.id, typeId: cp.id, dateDebut: '2026-03-02', dateFin: '2026-03-03', nbJours: 2 });
  const apres = sandbox.getEtapesPriseEnMain();
  assert.strictEqual(apres.find(e => e.key === 'soldes').fait, true, 'un compteur ajusté : soldes faits');
  assert.strictEqual(apres.find(e => e.key === 'historique').fait, true, 'une absence importée : historique fait');

  // étapes à cocher à la main : mémorisées dans les réglages
  assert.strictEqual(apres.find(e => e.key === 'verification').fait, false);
  sandbox.marquerEtapePriseEnMain('verification', true);
  assert.strictEqual(sandbox.getEtapesPriseEnMain().find(e => e.key === 'verification').fait, true);
  sandbox.marquerEtapePriseEnMain('verification', false);
  assert.strictEqual(sandbox.getEtapesPriseEnMain().find(e => e.key === 'verification').fait, false);

  const html = sandbox.renderPriseEnMain();
  assert.ok(/Prise en main/.test(html) && html.includes('<svg'), 'titre et schéma');
  etapes.forEach(e => assert.ok(html.includes(`data-pem-aller="${e.key}"`), `bouton ${e.key}`));
  assert.ok(/Comment Nexus calcule un solde/.test(html) && /acquis/i.test(html) && /ajustement/i.test(html), 'explication du calcul du solde');
  assert.ok(/solde à avoir aujourd/i.test(html), 'rappel du mode « solde cible » de l\'import');
  assert.ok(/Demi-journée début/.test(html), 'rappel des colonnes demi-journée de l\'historique');
  assert.ok(!html.includes('undefined') && !html.includes('NaN'));

  // l'entrée de menu existe, réservée à ceux qui paramètrent
  const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8');
  const ligne = source.split(String.fromCharCode(10)).find(l => /key: 'prise-en-main'/.test(l) && /label:/.test(l));
  assert.ok(ligne, 'entrée de menu « Prise en main »');
  assert.ok(!/roles: [[^]]*'salarie'/.test(ligne), 'pas pour un simple salarié');
  console.log('OK — prise-en-main-21-10.test.js (8 étapes ordonnées, état calculé sur les données, schéma, explication du solde, entrée de menu)');
}

try { run(); } catch (err) { console.error('ÉCHEC — prise-en-main-21-10.test.js'); console.error(err.stack || err.message); process.exitCode = 1; }
