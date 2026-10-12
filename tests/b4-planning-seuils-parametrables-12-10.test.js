/**
 * Seven RH — brief du 12/10/2026, B4 : alertes NON bloquantes du planning (durée maximale quotidienne
 * et hebdomadaire, repos insuffisant, travail le dimanche) avec seuils PARAMÉTRABLES. Les seuils légaux
 * existaient mais codés en dur ; l'alerte dimanche n'existait pas (désactivée par défaut : la règle du
 * repos dominical admet de nombreuses dérogations, à valider — docs/regles-a-valider.md).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

const shift = (jour, debut, fin, pause = 30, emp = 'e1') => ({ id: `${jour}${debut}`, employeeId: emp, weekday: jour, heureDebut: debut, heureFin: fin, pauseMinutes: pause });
const types = (v) => v.map(x => x.type);

function setup() {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  const rh = api.DB.getEmployees().find(e => e.role === 'rh');
  api.DB._currentEmployeeId = rh.id;
  return api;
}

function runLesSeuilsParDefautRestentLesSeuilsLegaux() {
  const api = setup();
  const s = api.settingsRepository.getSettings();
  assert.strictEqual(s.planningDureeMaxQuotidienneHeures, 10);
  assert.strictEqual(s.planningDureeMaxHebdomadaireHeures, 48);
  assert.strictEqual(s.planningReposQuotidienHeures, 11);
  assert.strictEqual(s.planningReposHebdomadaireHeures, 35);
  assert.strictEqual(s.planningAlerteDimanche, false, 'l\'alerte dimanche est désactivée par défaut');
  const { verifierControlesLegauxPlanning } = api.sandbox;
  const longue = [shift('Lun', '08:00', '19:30', 30)]; // 11 h travaillées
  assert.ok(types(verifierControlesLegauxPlanning('e1', longue)).includes('duree-max-quotidienne'), 'sans seuils fournis : seuil légal de 10 h');
  console.log('OK — b4-planning-seuils-parametrables-12-10.test.js (valeurs par défaut = seuils légaux, appel historique inchangé)');
}

function runUnSeuilPersonnaliseChangeLeResultat() {
  const api = setup();
  const { verifierControlesLegauxPlanning, seuilsPlanningDepuisReglages } = api.sandbox;
  const longue = [shift('Lun', '08:00', '19:30', 30)]; // 11 h
  const relevé = seuilsPlanningDepuisReglages({ ...api.settingsRepository.getSettings(), planningDureeMaxQuotidienneHeures: 12 });
  assert.ok(!types(verifierControlesLegauxPlanning('e1', longue, relevé)).includes('duree-max-quotidienne'), 'avec 12 h autorisées, 11 h ne déclenchent plus l\'alerte');
  const abaisse = seuilsPlanningDepuisReglages({ ...api.settingsRepository.getSettings(), planningDureeMaxQuotidienneHeures: 7 });
  const normale = [shift('Lun', '09:00', '17:00', 30)]; // 7,5 h
  const v = verifierControlesLegauxPlanning('e1', normale, abaisse);
  assert.ok(types(v).includes('duree-max-quotidienne'), 'avec 7 h seulement, 7,5 h déclenchent l\'alerte');
  assert.ok(/7 h/.test(v.find(x => x.type === 'duree-max-quotidienne').message), 'le message cite le seuil réglé, pas un 10 h figé');

  const hebdo = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'].map(j => shift(j, '08:00', '17:00', 30)); // 5 x 8,5 = 42,5 h
  assert.ok(!types(verifierControlesLegauxPlanning('e1', hebdo)).includes('duree-max-hebdomadaire'));
  const hebdoAbaisse = seuilsPlanningDepuisReglages({ ...api.settingsRepository.getSettings(), planningDureeMaxHebdomadaireHeures: 40 });
  assert.ok(types(verifierControlesLegauxPlanning('e1', hebdo, hebdoAbaisse)).includes('duree-max-hebdomadaire'), 'seuil hebdomadaire abaissé à 40 h');

  const repos = [shift('Lun', '09:00', '22:00', 30), shift('Mar', '08:00', '12:00', 0)]; // repos 10 h
  assert.ok(types(verifierControlesLegauxPlanning('e1', repos)).includes('repos-quotidien'), '10 h de repos < 11 h légales');
  const reposRelache = seuilsPlanningDepuisReglages({ ...api.settingsRepository.getSettings(), planningReposQuotidienHeures: 9 });
  assert.ok(!types(verifierControlesLegauxPlanning('e1', repos, reposRelache)).includes('repos-quotidien'), 'seuil de repos relevé par convention à 9 h');
  console.log('OK — b4-planning-seuils-parametrables-12-10.test.js (durée quotidienne, hebdomadaire et repos suivent les seuils réglés ; messages à jour)');
}

function runLAlerteDimancheEstOptionnelle() {
  const api = setup();
  const { verifierControlesLegauxPlanning, seuilsPlanningDepuisReglages } = api.sandbox;
  const avecDimanche = [shift('Sam', '09:00', '13:00', 0), shift('Dim', '09:00', '13:00', 0)];
  assert.ok(!types(verifierControlesLegauxPlanning('e1', avecDimanche)).includes('dimanche'), 'désactivée par défaut : aucune alerte');
  const actif = seuilsPlanningDepuisReglages({ ...api.settingsRepository.getSettings(), planningAlerteDimanche: true });
  const v = verifierControlesLegauxPlanning('e1', avecDimanche, actif);
  assert.ok(types(v).includes('dimanche'), 'activée : un quart le dimanche est signalé');
  assert.ok(/dérogation/i.test(v.find(x => x.type === 'dimanche').message), 'le message rappelle que des dérogations existent (alerte, jamais un blocage)');
  assert.ok(!types(verifierControlesLegauxPlanning('e1', [shift('Lun', '09:00', '13:00', 0)], actif)).includes('dimanche'), 'pas de quart le dimanche : pas d\'alerte');
  console.log('OK — b4-planning-seuils-parametrables-12-10.test.js (alerte dimanche optionnelle, désactivée par défaut)');
}

function runLesReglagesSontDansParametresPlanning() {
  const api = setup();
  const html = api.renderParametresPlanningTeletravail();
  ['f-plan-max-jour', 'f-plan-max-semaine', 'f-plan-repos-jour', 'f-plan-repos-semaine', 'f-plan-alerte-dimanche'].forEach(id => {
    assert.ok(html.includes(`id="${id}"`), `le champ ${id} doit exister dans Paramètres > Planning`);
  });
  assert.ok(/à faire valider|à valider/i.test(html), 'la carte rappelle que ces seuils sont à valider selon la convention');
  console.log('OK — b4-planning-seuils-parametrables-12-10.test.js (seuils et alerte dimanche réglables dans Paramètres > Planning)');
}

try {
  runLesSeuilsParDefautRestentLesSeuilsLegaux();
  runUnSeuilPersonnaliseChangeLeResultat();
  runLAlerteDimancheEstOptionnelle();
  runLesReglagesSontDansParametresPlanning();
} catch (err) {
  console.error('ÉCHEC — b4-planning-seuils-parametrables-12-10.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
