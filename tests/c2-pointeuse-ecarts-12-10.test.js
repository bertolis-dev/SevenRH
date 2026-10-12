/**
 * Seven RH — brief du 12/10/2026, C2 : pointeuse, comparaison du pointé au planning et liste des écarts du jour
 * (retard, absence, dépassement). Constat : écarts sur les 7 derniers jours seulement (aujourd'hui exclu),
 * tolérance de 10 min codée en dur, pas de départ anticipé, et un salarié en congé avec un quart planifié sortait
 * en « oubli ». Corrigé : écarts du jour en cours, départ anticipé, congés/absences/télétravail/fermetures exclus,
 * tolérance réglable.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

const shift = { id: 's1', employeeId: 'e1', weekday: 'Lun', heureDebut: '09:00', heureFin: '17:00', pauseMinutes: 30 };
const types = (liste) => Array.from(liste, e => e.type); // tableau du contexte de test, pas du bac à sable (deepStrictEqual compare les prototypes)

function runLesTypesDEcartsDesJoursPasses() {
  const { calculerEcartsPointageJour } = loadAppJs().sandbox;
  const f = (pointages, tolerance, options) => calculerEcartsPointageJour('e1', '2026-10-05', 'Lun', [shift], pointages, tolerance, options);
  assert.deepStrictEqual(types(f([])), ['oubli']);
  assert.deepStrictEqual(types(f([{ heureArrivee: '09:30', heureDepart: '17:00' }])), ['retard']);
  assert.deepStrictEqual(types(f([{ heureArrivee: '09:00', heureDepart: '17:40' }])), ['depassement']);
  assert.deepStrictEqual(types(f([{ heureArrivee: '09:00', heureDepart: '15:30' }])), ['depart-anticipe'], 'départ avant la fin du quart, au-delà de la tolérance');
  assert.deepStrictEqual(types(f([{ heureArrivee: '09:05', heureDepart: '16:55' }])), [], 'dans la tolérance : aucun écart');
  assert.deepStrictEqual(types(f([{ heureArrivee: '09:15', heureDepart: '16:50' }], 20)), [], 'tolérance de 20 min : 15 min de retard ne comptent pas');
  assert.deepStrictEqual(types(f([{ heureArrivee: '09:15', heureDepart: '16:50' }], 5)), ['retard', 'depart-anticipe'], 'tolérance abaissée à 5 min');
  console.log('OK — c2-pointeuse-ecarts-12-10.test.js (oubli, retard, dépassement, départ anticipé ; tolérance réglable)');
}

function runLesEcartsDuJourEnCours() {
  const { calculerEcartsPointageJour } = loadAppJs().sandbox;
  const aujourdhui = (pointages, maintenant) => calculerEcartsPointageJour('e1', '2026-10-05', 'Lun', [shift], pointages, 10, { enCours: true, maintenant });
  assert.deepStrictEqual(types(aujourdhui([], '08:30')), [], 'le quart n\'a pas commencé : rien à signaler');
  assert.deepStrictEqual(types(aujourdhui([], '09:08')), [], 'dans la tolérance : rien');
  const absence = aujourdhui([], '09:40');
  assert.deepStrictEqual(types(absence), ['absence'], 'quart commencé depuis plus que la tolérance, aucun pointage : absence en direct (pas « oubli »)');
  assert.ok(/40|pas encore pointé/i.test(absence[0].message));
  assert.deepStrictEqual(types(aujourdhui([{ heureArrivee: '09:30' }], '09:40')), ['retard'], 'arrivé en retard, toujours présent');
  assert.deepStrictEqual(types(aujourdhui([{ heureArrivee: '09:00' }], '16:30')), [], 'présent, quart pas fini : rien');
  assert.deepStrictEqual(types(aujourdhui([{ heureArrivee: '09:00' }], '17:30')), ['depassement'], 'toujours pointé présent après la fin du quart + tolérance');
  assert.deepStrictEqual(types(aujourdhui([{ heureArrivee: '09:00', heureDepart: '12:00' }], '12:30')), ['depart-anticipe'], 'parti en cours de quart');
  console.log('OK — c2-pointeuse-ecarts-12-10.test.js (jour en cours : absence et retard en direct, dépassement, départ anticipé)');
}

function runUnJourDAbsenceNEstPasUnEcart() {
  const { calculerEcartsPointageJour } = loadAppJs().sandbox;
  const sansEcart = calculerEcartsPointageJour('e1', '2026-10-05', 'Lun', [shift], [], 10, { absentCeJour: true });
  assert.strictEqual(sansEcart.length, 0, 'un salarié en congé / télétravail / jour férié n\'est jamais en « oubli »');
  console.log('OK — c2-pointeuse-ecarts-12-10.test.js (congé, télétravail ou fermeture : aucun écart)');
}

function setup() {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  const rh = api.DB.getEmployees().find(e => e.role === 'rh');
  api.DB._currentEmployeeId = rh.id;
  return api;
}

function runLEcranListeLesEcartsDAujourdHuiEtExclutLesCongesValides() {
  const api = setup();
  const maintenant = new Date();
  if (maintenant.getHours() === 0 && maintenant.getMinutes() < 2) { console.log('OK — c2-pointeuse-ecarts-12-10.test.js (écran : test sauté à minuit pile)'); return; }
  const salarie = api.DB.getEmployees().find(e => e.role === 'salarie');
  const jour = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'][(maintenant.getDay() + 6) % 7];
  api.DB.saveShifts([{ id: 's-c2', employeeId: salarie.id, weekday: jour, heureDebut: '00:00', heureFin: '23:59', pauseMinutes: 0 }]);
  api.DB.saveSettings({ ...api.settingsRepository.getSettings(), pointageToleranceMinutes: 0 });
  api.DB.savePointages([]);

  const html = api.sandbox.renderEcartsPointageCard([salarie]);
  assert.ok(/aujourd'hui/i.test(html), 'la carte annonce qu\'elle inclut aujourd\'hui');
  assert.ok(/Absent|Pas encore pointé/i.test(html), 'l\'absence du jour en cours est listée');

  const iso = `${maintenant.getFullYear()}-${String(maintenant.getMonth() + 1).padStart(2, '0')}-${String(maintenant.getDate()).padStart(2, '0')}`;
  const types = api.DB.getLeaveTypes();
  api.DB.saveLeaveRequests([{ id: 'r-c2', employeeId: salarie.id, typeId: types[0].id, dateDebut: iso, dateFin: iso, nbJours: 1, statut: 'Validé', workflow: [], etapeIndex: -1, historique: [] }]);
  const htmlConge = api.sandbox.renderEcartsPointageCard([salarie]);
  assert.ok(!new RegExp(`${api.sandbox.formatDate(iso)}[^<]*${salarie.nom}[^<]*Pas encore pointé`, 'i').test(htmlConge), 'le congé validé d\'aujourd\'hui excuse l\'absence');
  console.log('OK — c2-pointeuse-ecarts-12-10.test.js (écran : écarts du jour listés, congé validé exclu)');
}

function runLaToleranceEstUnReglage() {
  const api = setup();
  assert.strictEqual(api.settingsRepository.getSettings().pointageToleranceMinutes, 10, 'défaut : 10 min (à valider)');
  assert.ok(api.renderParametresPlanningTeletravail().includes('id="f-pointage-tolerance"'), 'le réglage est dans Paramètres > Planning');
  console.log('OK — c2-pointeuse-ecarts-12-10.test.js (tolérance du pointage réglable, 10 min par défaut)');
}

try {
  runLesTypesDEcartsDesJoursPasses();
  runLesEcartsDuJourEnCours();
  runUnJourDAbsenceNEstPasUnEcart();
  runLEcranListeLesEcartsDAujourdHuiEtExclutLesCongesValides();
  runLaToleranceEstUnReglage();
} catch (err) {
  console.error('ÉCHEC — c2-pointeuse-ecarts-12-10.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
