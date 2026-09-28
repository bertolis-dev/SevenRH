/**
 * Seven RH — retour Betty du 28/09/2026 ("pouvoir changer la date des checklists, qu'elles se
 * mettent automatique à la date du jour mais qu'on puisse les changer") : dateFait (onboarding/
 * offboarding) se posait déjà automatiquement à aujourd'hui en cochant une étape, mais restait un
 * simple texte figé ensuite, jamais modifiable après coup (ex. l'étape a réellement eu lieu la
 * veille, ou l'utilisateur a coché par erreur au mauvais moment).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function setup() {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  const rh = api.DB.getEmployees().find(e => e.role === 'rh');
  api.DB._currentEmployeeId = rh.id;
  return api;
}

function runCocherPoseLaDateDuJourToujoursModifiableEnsuite() {
  const { renderChecklistCard } = setup();
  const checklist = [{ label: 'Signer le contrat', fait: true, dateFait: '2026-09-20' }, { label: 'Créer le compte email', fait: false, dateFait: '' }];
  const html = renderChecklistCard('Checklist d\'intégration', 'onboardingChecklist', checklist);

  assert.ok(html.includes('class="input checklist-date"'), 'une étape faite doit afficher un champ date modifiable, jamais un texte figé');
  assert.ok(html.includes('value="2026-09-20"'), 'le champ date doit reprendre la date déjà enregistrée');
  // Une étape non faite n'a pas de date à modifier (pas encore réalisée) : pas de champ date pour elle.
  const parts = html.split('checklist-item');
  assert.ok(!parts[2].includes('checklist-date'), 'une étape non faite ne doit jamais afficher de champ date');

  console.log('OK — checklist-date-modifiable-28-09.test.js (étape faite : champ date modifiable, reprenant la date déjà enregistrée)');
}

function run() {
  runCocherPoseLaDateDuJourToujoursModifiableEnsuite();
}

try {
  run();
} catch (err) {
  console.error('ÉCHEC — checklist-date-modifiable-28-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
