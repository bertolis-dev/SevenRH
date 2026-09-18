/**
 * Seven RH — retour Betty du 18/09/2026, point 5 : "Importer l'historique" quitte l'écran Congés &
 * absences (usage quotidien, bouton permanent pour une opération qu'on fait une fois) pour
 * rejoindre Paramètres > Types d'absences (renderCongesTypes), au même endroit que la création des
 * types eux-mêmes — accepté par Betty avec le changement de droits qui l'accompagne (MODIFIER_COMPTEURS,
 * assez répandu, vers canManageParametres/GERER_PARAMETRES, plus restreint).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function setup() {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  return api;
}

async function runBoutonAbsentDeLEcranConges() {
  const { DB, employeeRepository, renderCongesDemandes } = setup();
  const rh = employeeRepository.getAll().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;
  const html = renderCongesDemandes('conge');
  assert.ok(!html.includes('id="btn-import-absences-historique"'), 'le bouton ne doit plus jamais apparaître sur l\'écran Congés & absences, même pour un RH');

  console.log('OK — import-deplace-parametres-18-09.test.js (bouton absent de l\'écran Congés & absences)');
}

async function runBoutonPresentDansParametresTypes() {
  const { renderCongesTypes } = setup();
  const html = renderCongesTypes('conge');
  assert.ok(html.includes('id="btn-import-absences-historique"'), 'le bouton doit apparaître dans Paramètres > Types d\'absences (congés)');

  const htmlAutre = renderCongesTypes('autre');
  assert.ok(htmlAutre.includes('id="btn-import-absences-historique"'), 'et aussi côté Autres absences, même écran réutilisé par catégorie');

  console.log('OK — import-deplace-parametres-18-09.test.js (bouton présent dans Paramètres > Types d\'absences, les deux catégories)');
}

runBoutonAbsentDeLEcranConges()
  .then(runBoutonPresentDansParametresTypes)
  .catch((err) => {
    console.error('ÉCHEC — import-deplace-parametres-18-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
