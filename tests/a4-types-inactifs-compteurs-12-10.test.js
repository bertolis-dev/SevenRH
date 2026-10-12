/**
 * Seven RH — brief du 12/10/2026, A4 : un type de congé « non actif » (RTT par défaut) affichait quand
 * même des jours acquis dans le Tableau des compteurs. Il reste visible (grisé, « non activé », décision
 * QA du 27/08) mais ses chiffres sont neutralisés (« — »), et les anomalies de la préparation de paie ne
 * portent plus sur un type que personne n'utilise.
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

function runLeTableauNeutraliseLesTypesInactifs() {
  const api = setup();
  const rtt = api.DB.getLeaveTypes().find(t => /rtt/i.test(t.nom));
  assert.ok(rtt, 'préalable : le jeu de démo a un type RTT');
  assert.strictEqual(rtt.actif, false, 'préalable : le RTT est inactif par défaut');
  api.leaveTypeRepository.updateLeaveType(rtt.id, { nombreAnnuel: 10, acquisition: 'Mensuelle' });

  const html = api.sandbox.renderTableauCompteurs();
  const colonnesRtt = html.split('<td ').filter(c => c.includes(`data-label="${rtt.nom}"`) && c.includes('tc-inactif') && !c.includes('Total'));
  assert.ok(colonnesRtt.length > 0, 'les cellules du type inactif existent (la colonne reste visible)');
  colonnesRtt.forEach(c => {
    assert.ok(!/acquis/.test(c), 'aucun jour acquis n\'est affiché pour un type non activé');
    assert.ok(c.includes('—'), 'la cellule affiche un tiret');
  });
  assert.ok(html.includes('non activé'), 'la mention « non activé » reste affichée');
  console.log('OK — a4-types-inactifs-compteurs-12-10.test.js (Tableau des compteurs : type inactif grisé, chiffres remplacés par « — »)');
}

function runUnTypeActifAffichetoujoursSesJours() {
  const api = setup();
  const cp = api.DB.getLeaveTypes().find(t => /congés payés/i.test(t.nom));
  assert.ok(cp && cp.actif, 'préalable : les congés payés sont actifs');
  const html = api.sandbox.renderTableauCompteurs();
  const cellules = html.split('<td ').filter(c => c.includes(`data-label="${cp.nom}"`) && !c.includes('Total'));
  assert.ok(cellules.some(c => /acquis/.test(c)), 'un type actif continue d\'afficher acquis / pris');
  console.log('OK — a4-types-inactifs-compteurs-12-10.test.js (type actif inchangé)');
}

function runLesAnomaliesDePaieIgnorentLesTypesInactifs() {
  const api = setup();
  const salarie = api.DB.getEmployees().find(e => e.role === 'salarie');
  const rtt = api.DB.getLeaveTypes().find(t => /rtt/i.test(t.nom));
  api.leaveTypeRepository.updateLeaveType(rtt.id, { actif: false, nombreAnnuel: 0, acquisition: 'Annuelle' });
  const now = new Date();
  const debut = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-02`;
  api.DB.saveLeaveRequests([{ id: 'r-a4', employeeId: salarie.id, typeId: rtt.id, dateDebut: debut, dateFin: debut, nbJours: 3, statut: 'Validé', workflow: [], etapeIndex: -1, historique: [] }]);
  const anomalies = api.sandbox.getPaieAnomalies(now.getFullYear(), now.getMonth());
  assert.ok(!anomalies.some(a => a.type === 'compteur_negatif' && a.employee.id === salarie.id && /RTT/i.test(a.message)), 'un solde négatif sur un type inactif ne bloque pas la paie');
  api.leaveTypeRepository.updateLeaveType(rtt.id, { actif: true });
  const avecActif = api.sandbox.getPaieAnomalies(now.getFullYear(), now.getMonth());
  assert.ok(avecActif.some(a => a.type === 'compteur_negatif' && a.employee.id === salarie.id && /RTT/i.test(a.message)), 'le même solde négatif sur un type ACTIF reste bien signalé');
  console.log('OK — a4-types-inactifs-compteurs-12-10.test.js (anomalies de paie : types inactifs ignorés, types actifs toujours contrôlés)');
}

try {
  runLeTableauNeutraliseLesTypesInactifs();
  runUnTypeActifAffichetoujoursSesJours();
  runLesAnomaliesDePaieIgnorentLesTypesInactifs();
} catch (err) {
  console.error('ÉCHEC — a4-types-inactifs-compteurs-12-10.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
