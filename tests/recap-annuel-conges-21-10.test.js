/**
 * Seven RH — retour du 21/10/2026 : « un récap CP/RTT par salarié et par année, sous forme de tableau, pour pointer facilement ».
 * Pour un type de congé et une année : jours pris mois par mois (validés), en attente, et le solde à la fin de l'année (ou
 * aujourd'hui pour l'année en cours). Onglet du Tableau des compteurs, exportable en Excel.
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
  const cp = DB.getLeaveTypes().find(t => t.nom === 'Congés payés');
  const rtt = DB.getLeaveTypes().find(t => t.nom === 'RTT');
  const salarie = DB.getEmployees().find(e => e.role === 'salarie');
  const base = { employeeId: salarie.id, typeId: cp.id, etapeIndex: -1, workflow: [], historique: [] };
  const demandes = [
    { ...base, id: 'd1', dateDebut: '2026-03-02', dateFin: '2026-03-03', demiJournee: null, statut: 'Validé' },                    // 2 j en mars
    { ...base, id: 'd2', dateDebut: '2026-03-30', dateFin: '2026-04-02', demiJournee: null, statut: 'Validé' },                    // 2 j en mars (lun 30, mar 31), 2 j en avril
    { ...base, id: 'd3', dateDebut: '2026-07-13', dateFin: '2026-07-13', demiJournee: 'matin', statut: 'Validé' },                 // 0,5 j en juillet
    { ...base, id: 'd4', dateDebut: '2026-08-10', dateFin: '2026-08-11', demiJournee: null, statut: 'En attente' },                // en attente (août)
    { ...base, id: 'd5', dateDebut: '2026-05-04', dateFin: '2026-05-05', demiJournee: null, statut: 'Refusé' },                    // ignoré
    { ...base, id: 'd6', dateDebut: '2025-12-22', dateFin: '2025-12-23', demiJournee: null, statut: 'Validé' },                    // autre année : ignoré
    { ...base, id: 'd7', typeId: rtt.id, dateDebut: '2026-06-01', dateFin: '2026-06-01', demiJournee: null, statut: 'Validé' }      // autre type : ignoré
  ];

  const recap = sandbox.construireRecapAnnuelConges({
    annee: 2026, employees: [DB.getEmployeeById(salarie.id)], leaveType: cp, requests: demandes, leaveTypes: DB.getLeaveTypes(), settings: DB.getSettings(), maintenant: new Date(2027, 0, 15)
  });
  const ligne = recap.lignes[0];
  assert.strictEqual(ligne.mois.length, 12);
  assert.strictEqual(ligne.mois[2], 4, 'mars : d1 (2 j) + les 2 jours de d2 qui tombent en mars');
  assert.strictEqual(ligne.mois[3], 2, 'avril : les 2 jours de d2 restants');
  assert.strictEqual(ligne.mois[6], 0.5, 'demi-journée en juillet');
  assert.strictEqual(ligne.mois[7], 0, 'août : rien de validé');
  assert.strictEqual(ligne.enAttente, 2, 'les jours en attente sont comptés à part');
  assert.strictEqual(ligne.totalPris, 2 + 4 + 0.5, 'total pris dans l\'année : validés seulement, autres années et types exclus');
  assert.ok(ligne.solde && typeof ligne.solde.disponible === 'number', 'solde de fin d\'année présent');
  assert.strictEqual(recap.totauxMois[2], 4, 'total des colonnes par mois');
  assert.strictEqual(recap.totalPris, ligne.totalPris);

  // année en cours : le solde est celui d'aujourd'hui ; année future : aucun solde
  const courante = sandbox.construireRecapAnnuelConges({ annee: new Date().getFullYear(), employees: [DB.getEmployeeById(salarie.id)], leaveType: cp, requests: [], leaveTypes: DB.getLeaveTypes(), settings: DB.getSettings(), maintenant: new Date() });
  assert.ok(courante.lignes[0].solde);
  const future = sandbox.construireRecapAnnuelConges({ annee: new Date().getFullYear() + 2, employees: [DB.getEmployeeById(salarie.id)], leaveType: cp, requests: [], leaveTypes: DB.getLeaveTypes(), settings: DB.getSettings(), maintenant: new Date() });
  assert.strictEqual(future.lignes[0].solde, null, 'pas de solde pour une année pas encore commencée');
  console.log('OK — recap-annuel-conges-21-10.test.js (jours pris par mois, découpage à cheval sur deux mois, demi-journées, en attente à part, autres années/types exclus)');
}

function runUi() {
  const api = setup();
  const { DB, sandbox } = api;
  api.state.tableauCompteursVue = 'annuel';
  api.state.tableauCompteursAnnee = 2026;
  const html = sandbox.renderTableauCompteurs();
  assert.ok(html.includes('data-tc-vue="soldes"') && html.includes('data-tc-vue="annuel"'), 'deux onglets : soldes à ce jour / récapitulatif annuel');
  assert.ok(html.includes('id="tc-annee-prev"') && html.includes('id="tc-annee-next"') && html.includes('2026'), 'navigation d\'année');
  assert.ok(html.includes('id="tc-type-annuel"'), 'choix du type (congés payés, RTT...)');
  ['Janv', 'Févr', 'Mars', 'Déc'].forEach(m => assert.ok(html.includes(m), `colonne ${m}`));
  assert.ok(html.includes('id="btn-export-recap-annuel"'), 'export Excel');
  api.state.tableauCompteursVue = 'soldes';
  const soldes = sandbox.renderTableauCompteurs();
  assert.ok(soldes.includes('data-tc-vue="annuel"') && soldes.includes('btn-export-tableau-compteurs'), 'la vue d\'origine reste, avec l\'onglet en plus');
  console.log('OK — recap-annuel-conges-21-10.test.js (interface : onglets, année, type, mois, export)');
}

try { run(); runUi(); } catch (err) { console.error('ÉCHEC — recap-annuel-conges-21-10.test.js'); console.error(err.stack || err.message); process.exitCode = 1; }
