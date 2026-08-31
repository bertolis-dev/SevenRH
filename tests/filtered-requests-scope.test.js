/**
 * Seven RH — correctif audit du 31/08/2026 (reuse) : getFilteredLeaveRequests/
 * getFilteredTeleworkRequests/getFilteredExpenses partagent désormais un seul pipeline
 * (scopeToVisibleEmployees + applyStateFilters) au lieu de trois copies indépendantes. Ce test
 * vérifie que la portée manager (le point le plus sensible à la sécurité) et les filtres d'état
 * fonctionnent identiquement après la factorisation, sur les 3 écrans.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function push(DB, key, row) {
  const company = DB.getCurrentCompany();
  company[key].push(row);
  DB.saveCurrentCompany(company);
}

async function run() {
  const { sandbox, DB, state, getFilteredLeaveRequests, getFilteredTeleworkRequests, getFilteredExpenses } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();

  const employees = DB.getEmployees();
  const manager = employees.find(e => e.role === 'manager');
  const rh = employees.find(e => e.role === 'rh');
  const teamMember = employees.find(e => (e.managerIds || []).includes(manager.id));
  const outsider = employees.find(e => e.id !== manager.id && !(e.managerIds || []).includes(manager.id) && e.id !== teamMember.id);
  assert.ok(manager && teamMember && outsider, 'le jeu de données de démo doit fournir un manager, un membre de son équipe et un salarié hors équipe');

  const congeType = DB.getLeaveTypes().find(t => t.categorie === 'conge');

  push(DB, 'leaveRequests', { id: 'lr-team', employeeId: teamMember.id, typeId: congeType.id, dateDebut: '2027-01-01', dateFin: '2027-01-02', statut: 'Validé', workflow: [], etapeIndex: -1, historique: [] });
  push(DB, 'leaveRequests', { id: 'lr-outsider', employeeId: outsider.id, typeId: congeType.id, dateDebut: '2027-01-01', dateFin: '2027-01-02', statut: 'Validé', workflow: [], etapeIndex: -1, historique: [] });

  push(DB, 'teleworkRequests', { id: 'tw-team', employeeId: teamMember.id, dateDebut: '2027-01-05', dateFin: '2027-01-05', statut: 'Validé', workflow: [], etapeIndex: -1, historique: [] });
  push(DB, 'teleworkRequests', { id: 'tw-outsider', employeeId: outsider.id, dateDebut: '2027-01-05', dateFin: '2027-01-05', statut: 'Validé', workflow: [], etapeIndex: -1, historique: [] });

  push(DB, 'expenses', { id: 'exp-team', employeeId: teamMember.id, categorie: 'Transport', montantTTC: 10, statut: 'Validé', workflow: [], etapeIndex: -1, historique: [], dateCreation: new Date().toISOString() });
  push(DB, 'expenses', { id: 'exp-outsider', employeeId: outsider.id, categorie: 'Transport', montantTTC: 10, statut: 'Validé', workflow: [], etapeIndex: -1, historique: [], dateCreation: new Date().toISOString() });

  // ---- Portée manager : ne voit que son équipe, sur les 3 écrans ----
  DB._currentEmployeeId = manager.id;
  state.congesFilters = { employeeId: '', typeId: '', statut: '' };
  state.teletravailFilters = { employeeId: '', statut: '' };
  state.fraisFilters = { employeeId: '', categorie: '', statut: '' };

  const conges = getFilteredLeaveRequests('conge');
  assert.ok(conges.some(r => r.id === 'lr-team'), 'le manager doit voir la demande de son équipe');
  assert.ok(!conges.some(r => r.id === 'lr-outsider'), 'le manager ne doit pas voir la demande hors équipe');

  const teletravail = getFilteredTeleworkRequests();
  assert.ok(teletravail.some(r => r.id === 'tw-team'), 'le manager doit voir le télétravail de son équipe');
  assert.ok(!teletravail.some(r => r.id === 'tw-outsider'), 'le manager ne doit pas voir le télétravail hors équipe');

  const expenses = getFilteredExpenses();
  assert.ok(expenses.some(e => e.id === 'exp-team'), 'le manager doit voir la note de frais de son équipe');
  assert.ok(!expenses.some(e => e.id === 'exp-outsider'), 'le manager ne doit pas voir la note de frais hors équipe');

  // ---- RH : voit tout le monde (portée non restreinte) ----
  DB._currentEmployeeId = rh.id;
  assert.ok(getFilteredLeaveRequests('conge').some(r => r.id === 'lr-outsider'), 'RH doit voir toutes les demandes, y compris hors équipe du manager');
  assert.ok(getFilteredTeleworkRequests().some(r => r.id === 'tw-outsider'), 'RH doit voir tout le télétravail');
  assert.ok(getFilteredExpenses().some(e => e.id === 'exp-outsider'), 'RH doit voir toutes les notes de frais');

  // ---- Filtre d'état appliqué en plus de la portée (statut) ----
  DB._currentEmployeeId = manager.id;
  state.congesFilters.statut = 'Refusé';
  assert.strictEqual(getFilteredLeaveRequests('conge').length, 0, 'un filtre statut ne correspondant à aucune demande doit vider la liste (scope + filtre combinés)');
  state.congesFilters.statut = '';

  console.log('OK — filtered-requests-scope.test.js (portée manager + filtres d\'état, 3 écrans, après factorisation)');
}

run().catch((err) => {
  console.error('ÉCHEC — filtered-requests-scope.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
