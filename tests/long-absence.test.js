/**
 * Seven RH — teste le point 7.16 (retour QA du 26/08/2026) : signalement des absences longue durée,
 * volontairement un simple repère pour RH (jamais un calcul automatique d'impact sur l'acquisition
 * de congés payés — voir le commentaire de getEmployeesOnLongAbsence, app.js, sur pourquoi une
 * automatisation ici serait risquée : les règles d'assimilation varient selon le motif exact et la
 * convention collective). Couverture ciblée sur les critères de filtrage, pas sur un calcul métier.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function addLeaveRequest(DB, employeeId, typeId, dateDebut, dateFin) {
  const company = DB.getCurrentCompany();
  company.leaveRequests.push({
    id: `lr-test-${Math.random().toString(36).slice(2)}`,
    employeeId, typeId, dateDebut, dateFin, statut: 'Validé', workflow: [], etapeIndex: -1, historique: [],
    dateCreation: new Date().toISOString(), dateModification: new Date().toISOString(),
  });
  DB.saveCurrentCompany(company);
}

function run() {
  const { sandbox, DB, getEmployeesOnLongAbsence } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const company = DB.getCurrentCompany();
  const employees = DB.getEmployees();
  const salarie = employees.find(e => e.role === 'salarie');
  const manager = employees.find(e => e.role === 'manager');
  const maladieType = DB.getLeaveTypes().find(t => t.categorie === 'autre');
  const congesType = DB.getLeaveTypes().find(t => t.categorie === 'conge');
  assert.ok(salarie && manager && maladieType && congesType, 'jeu de données de démo incomplet');

  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const daysAgo = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return iso(d); };
  const daysFromNow = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return iso(d); };

  // 1. Absence courte (10 jours) de catégorie "autre" — sous le seuil, ne doit PAS apparaître.
  addLeaveRequest(DB, salarie.id, maladieType.id, daysAgo(5), daysFromNow(5));
  // 2. Absence longue (40 jours) EN COURS de catégorie "autre" — doit apparaître.
  addLeaveRequest(DB, manager.id, maladieType.id, daysAgo(20), daysFromNow(20));
  // 3. Congés payés de 40 jours (catégorie "conge", pas "autre") — même durée que #2, mais un
  //    salarié qui prend simplement SES congés payés n'a par définition aucun impact sur SA PROPRE
  //    acquisition — ne doit PAS apparaître.
  const autreEmployee = employees.find(e => e.id !== salarie.id && e.id !== manager.id);
  addLeaveRequest(DB, autreEmployee.id, congesType.id, daysAgo(10), daysFromNow(30));
  // 4. Absence longue TERMINÉE il y a 200 jours (catégorie "autre") — hors de la fenêtre de retour
  //    (60 jours), ne doit PAS apparaître (trop ancienne pour rester pertinente pour RH).
  addLeaveRequest(DB, salarie.id, maladieType.id, daysAgo(250), daysAgo(200));
  // 5. Absence longue (35 jours) TERMINÉE il y a 10 jours (catégorie "autre") — dans la fenêtre de
  //    retour, doit apparaître (marquée "terminée", pas "en cours").
  const cinquiemeEmployee = employees[employees.length - 1];
  addLeaveRequest(DB, cinquiemeEmployee.id, maladieType.id, daysAgo(45), daysAgo(10));

  const results = getEmployeesOnLongAbsence(DB.getEmployees());

  assert.strictEqual(results.some(r => r.employee.id === manager.id && r.enCours === true), true,
    'l\'absence longue EN COURS (#2) doit apparaître, marquée en cours');
  assert.strictEqual(results.some(r => r.employee.id === autreEmployee.id), false,
    'des congés payés (catégorie "conge") ne doivent jamais apparaître, quelle que soit leur durée');
  assert.strictEqual(results.filter(r => r.employee.id === salarie.id).length, 0,
    'l\'absence courte (#1, 10 jours) et l\'absence trop ancienne (#4, terminée il y a 250 jours) ne doivent pas apparaître');
  assert.strictEqual(results.some(r => r.employee.id === cinquiemeEmployee.id && r.enCours === false), true,
    'l\'absence longue TERMINÉE récemment (#5, il y a 10 jours) doit apparaître, marquée terminée (pas en cours)');

  // Portée manager : ne passer qu'une liste restreinte (équipe du manager) doit exclure les autres.
  const managerTeam = [manager, salarie]; // simule getVisibleEmployeeIdsForCurrentUser() d'un manager
  const scopedResults = getEmployeesOnLongAbsence(managerTeam);
  assert.strictEqual(scopedResults.every(r => managerTeam.some(e => e.id === r.employee.id)), true,
    'la portée manager (liste d\'employés restreinte) doit être respectée, jamais élargie à toute l\'entreprise');

  console.log('OK — long-absence.test.js (seuil de durée, catégorie autre uniquement, fenêtre de retour, portée manager)');
}

try {
  run();
} catch (err) {
  console.error('ÉCHEC — long-absence.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
