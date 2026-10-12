/**
 * Seven RH — brief du 12/10/2026, A1 : total d'heures du planning « incohérent » (21,50 h et 22,50 h pour
 * 3 créneaux identiques 09:00-17:00). Cause établie : computeShiftHeures déduit bien la pause de CHAQUE
 * créneau, mais la pause est un champ libre par créneau (valeurs différentes) et le total n'indiquait
 * jamais la pause déduite. Correctifs : pause par défaut paramétrable (30 min proposées), règle
 * affichée sous le total, tous les créneaux d'un même jour affichés (la grille n'en montrait qu'un
 * alors que le total les additionnait tous).
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

function runLeCalculEstUniformeEtExplique() {
  const { computeShiftHeures } = loadAppJs().sandbox;
  const creneau = (pause) => ({ heureDebut: '09:00', heureFin: '17:00', pauseMinutes: pause });
  const total = (pauses) => pauses.reduce((s, p) => s + computeShiftHeures(creneau(p)), 0);
  assert.strictEqual(total([30, 30, 30]), 22.5, '3 créneaux identiques avec la même pause : même total pour tous');
  assert.strictEqual(total([30, 60, 60]), 21.5, 'l\'écart de la capture (21,50 h) vient bien de pauses différentes');
  console.log('OK — a1-planning-pauses-12-10.test.js (le total dépend uniquement de la pause saisie par créneau, rien d\'autre)');
}

function runLaPauseParDefautEstUnReglage() {
  const api = setup();
  const settings = api.settingsRepository.getSettings();
  assert.strictEqual(settings.pauseParDefautMinutes, 30, 'valeur proposée : 30 min (à valider, voir docs/regles-a-valider.md)');
  api.settingsRepository.saveSettings({ ...settings, pauseParDefautMinutes: 45 });
  assert.strictEqual(api.sandbox.makeEmptyShiftDraft().pauseMinutes, 45, 'un nouveau créneau reprend la pause par défaut de l\'entreprise');
  assert.ok(api.renderParametresPlanningTeletravail().includes('id="f-pause-defaut"'), 'le réglage est dans Paramètres > Planning');
  console.log('OK — a1-planning-pauses-12-10.test.js (pause par défaut paramétrable, reprise par les nouveaux créneaux)');
}

function runLeResumeDeLaPauseEstAffichable() {
  const { resumePausesDeduites } = loadAppJs().sandbox;
  assert.strictEqual(resumePausesDeduites([]), '');
  assert.strictEqual(resumePausesDeduites([{ pauseMinutes: 30 }, { pauseMinutes: 30 }]), 'pause déduite : 30 min par créneau');
  assert.strictEqual(resumePausesDeduites([{ pauseMinutes: 30 }, { pauseMinutes: 60 }]), 'pauses déduites : de 30 à 60 min selon les créneaux');
  assert.strictEqual(resumePausesDeduites([{ pauseMinutes: 0 }]), 'aucune pause déduite');
  console.log('OK — a1-planning-pauses-12-10.test.js (règle affichée : « pause déduite : 30 min par créneau »)');
}

function runLaGrilleAfficheLaRegleEtTousLesCreneauxDuJour() {
  const api = setup();
  const salarie = api.DB.getEmployees().find(e => e.role === 'salarie');
  api.DB.saveShifts([]);
  api.DB.addShift({ employeeId: salarie.id, weekday: 'Lun', heureDebut: '09:00', heureFin: '12:00', pauseMinutes: 0 });
  api.DB.addShift({ employeeId: salarie.id, weekday: 'Lun', heureDebut: '14:00', heureFin: '18:00', pauseMinutes: 0 });
  api.DB.addShift({ employeeId: salarie.id, weekday: 'Mar', heureDebut: '09:00', heureFin: '17:00', pauseMinutes: 30 });

  const html = api.sandbox.renderPlanningPostes();
  const ligne = html.split('<tr>').find(l => l.includes(salarie.nom)) || '';
  assert.ok(ligne.includes('09:00-12:00') && ligne.includes('14:00-18:00'), 'les deux créneaux du lundi sont affichés (la grille n\'en montrait qu\'un)');
  assert.ok(/pauses? déduites?/.test(ligne), 'le total indique la règle de pause appliquée');
  const heures = api.sandbox.computeShiftHeures;
  const attendu = 3 + 4 + heures({ heureDebut: '09:00', heureFin: '17:00', pauseMinutes: 30 });
  assert.ok(ligne.includes(api.sandbox.formatNumberFR(attendu) + ' h'), 'le total affiché correspond à la somme de TOUS les créneaux visibles');
  console.log('OK — a1-planning-pauses-12-10.test.js (planning : tous les créneaux du jour visibles, pause déduite affichée, total cohérent)');
}

try {
  runLeCalculEstUniformeEtExplique();
  runLaPauseParDefautEstUnReglage();
  runLeResumeDeLaPauseEstAffichable();
  runLaGrilleAfficheLaRegleEtTousLesCreneauxDuJour();
} catch (err) {
  console.error('ÉCHEC — a1-planning-pauses-12-10.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
