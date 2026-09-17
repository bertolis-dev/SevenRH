/**
 * Seven RH — audit "millimètre par millimètre" (retour Betty du 17/09/2026) : "Préparation de paie"
 * (NAV_ITEMS 'export-paie') n'exige que le module RH — mais getPaieRows/getPaieAnomalies calculaient
 * congés/RTT/maladie/télétravail/notes de frais/tickets restaurant SANS AUCUNE vérification de
 * module, avec de VRAIES données personnelles (jours réels, montants réels, anomalies nominatives),
 * pas seulement un bouton ou un libellé d'aperçu comme les autres correctifs de cet audit. Une
 * entreprise abonnée à RH seul (ex. pour le coffre-fort documents) voyait donc les congés/télétravail/
 * frais/tickets de tout le monde, jusque dans le fichier CSV envoyé au logiciel de paie.
 *
 * Coupé à la source (comme buildCalendarSharedData, même jour) : leaveRequests/teleworkRequests/
 * expenses redeviennent [] si le module correspondant n'est pas souscrit, avant tout calcul —
 * congesPayesJours/rttJours/maladieJours/teletravailJours/notesRembourser en découlent
 * automatiquement. tickets reste un cas à part (module indépendant), zéroté explicitement.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

// Dates fixes plutôt que "maintenant" (comme frais-fixes-07-09.test.js) : 5/6/7 janvier 2026 tombent
// un lundi/mardi/mercredi, jamais un week-end qui ferait dépendre le résultat du jour d'exécution.
const YEAR = 2026;
const MONTH = 0; // janvier

function seedFullMonthData(DB) {
  const company = DB.getCurrentCompany();
  const salarie = DB.getEmployees().find(e => e.role === 'salarie');
  const now = new Date().toISOString();
  const conge = leaveTypeIdCongesPayes(DB);
  company.leaveRequests.push({
    id: 'test-paie-conge', employeeId: salarie.id, typeId: conge, statut: 'Validé',
    dateDebut: '2026-01-05', dateFin: '2026-01-05', demiJournee: null,
    workflow: [], etapeIndex: -1, historique: [], dateCreation: now, dateModification: now
  });
  company.teleworkRequests.push({
    id: 'test-paie-tt', employeeId: salarie.id, statut: 'Validé',
    dateDebut: '2026-01-06', dateFin: '2026-01-06',
    workflow: [], etapeIndex: -1, historique: [], dateCreation: now, dateModification: now
  });
  company.expenses.push({
    id: 'test-paie-frais', employeeId: salarie.id, categorie: 'Repas', date: '2026-01-07',
    libelle: 'Déjeuner test', montantTTC: 33.33, tauxTVA: 10, statut: 'Remboursé',
    workflow: [], etapeIndex: -1,
    historique: [
      { date: '2026-01-07T10:00:00.000Z', action: 'Note créée' },
      { date: '2026-01-07T10:00:00.000Z', action: 'Remboursé' }
    ],
    dateCreation: '2026-01-07T10:00:00.000Z', dateModification: '2026-01-07T10:00:00.000Z',
    kilometrage: null, justificatif: null, commentaire: ''
  });
  DB.saveCurrentCompany(company);
  return { salarie, year: YEAR, month: MONTH };
}

function leaveTypeIdCongesPayes(DB) {
  const type = DB.getLeaveTypes().find(t => t.nom === 'Congés payés');
  return type ? type.id : DB.getLeaveTypes()[0].id;
}

function setup(modules) {
  const { DB, sandbox, getPaieRows, getPaieAnomalies, renderExportPaiePreparationTab, renderExportPaieExportTab } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const company = DB.getCurrentCompany();
  company.abonnement.offre = 'a_la_carte';
  company.abonnement.modules = modules.map(key => ({ key }));
  DB.saveCurrentCompany(company);
  const { salarie, year, month } = seedFullMonthData(DB);
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;
  return { DB, getPaieRows, getPaieAnomalies, renderExportPaiePreparationTab, renderExportPaieExportTab, salarie, year, month };
}

function runGetPaieRowsCoupeALaSourceSansModules() {
  const { getPaieRows, salarie, year, month } = setup(['rh', 'remuneration']); // ni congés, ni planning, ni frais, ni tickets
  const row = getPaieRows(year, month).find(r => r.employee.id === salarie.id);
  assert.ok(row, 'la fiche de ce salarié doit exister dans le récapitulatif (module RH seul suffit à atteindre cet écran)');
  assert.strictEqual(row.congesPayesJours, 0, 'sans le module congés, un vrai congé posé ne doit jamais apparaître dans le récapitulatif de paie');
  assert.strictEqual(row.rttJours, 0);
  assert.strictEqual(row.maladieJours, 0);
  assert.strictEqual(row.teletravailJours, 0, 'sans le module planning, un vrai télétravail posé ne doit jamais apparaître');
  assert.strictEqual(row.notesRembourser, 0, 'sans le module frais, une vraie note remboursée ne doit jamais apparaître');
  assert.strictEqual(row.tickets.nbTickets, 0, 'sans le module tickets, aucun ticket ne doit être calculé');
  assert.deepStrictEqual(row.congesParType.length, 0);

  console.log('OK — export-paie-cloisonnement-17-09.test.js (getPaieRows coupe congés/planning/frais/tickets à la source sans leurs modules)');
}

function runGetPaieRowsControlePositifTousModules() {
  const { getPaieRows, salarie, year, month } = setup(['rh', 'conges', 'planning', 'frais', 'tickets', 'remuneration']);
  const row = getPaieRows(year, month).find(r => r.employee.id === salarie.id);
  assert.ok(row.congesPayesJours > 0, 'contrôle positif : avec le module congés, le vrai congé posé doit remonter');
  assert.ok(row.teletravailJours > 0, 'contrôle positif : avec le module planning, le vrai télétravail doit remonter');
  assert.ok(row.notesRembourser > 0, 'contrôle positif : avec le module frais, la vraie note remboursée doit remonter');

  console.log('OK — export-paie-cloisonnement-17-09.test.js (contrôle positif : les 3 réapparaissent avec leurs modules respectifs)');
}

function runAnomaliesCoupeesSansModules() {
  const { DB, getPaieAnomalies, salarie, year, month } = setup(['rh', 'remuneration']);
  // Solde négatif délibéré (compteur_negatif) : ne doit jamais remonter sans le module congés.
  const company = DB.getCurrentCompany();
  const type = company.leaveTypes.find(t => t.nom === 'Congés payés');
  company.leaveRequests.push({
    id: 'test-paie-solde-negatif', employeeId: salarie.id, typeId: type.id, statut: 'Validé',
    dateDebut: `${year}-01-01`, dateFin: `${year}-01-31`, demiJournee: null,
    workflow: [], etapeIndex: -1, historique: [], dateCreation: new Date().toISOString(), dateModification: new Date().toISOString()
  });
  DB.saveCurrentCompany(company);

  const anomalies = getPaieAnomalies(year, month);
  const anomaliesDuSalarie = anomalies.filter(a => a.employee.id === salarie.id);
  assert.deepStrictEqual(anomaliesDuSalarie.filter(a => a.type === 'compteur_negatif').length, 0, 'sans le module congés, aucune anomalie de solde de congés ne doit être calculée, même avec un vrai solde négatif en base');
  assert.deepStrictEqual(anomaliesDuSalarie.filter(a => a.type === 'absence_incoherente').length, 0);
  assert.deepStrictEqual(anomaliesDuSalarie.filter(a => a.type === 'justificatif_manquant').length, 0);

  console.log('OK — export-paie-cloisonnement-17-09.test.js (getPaieAnomalies : aucune anomalie congés/planning sans leurs modules)');
}

function runColonnesTableauPreparationCacheesSansModules() {
  const { getPaieRows, renderExportPaiePreparationTab, year, month } = setup(['rh', 'remuneration']);
  const rows = getPaieRows(year, month);
  const html = renderExportPaiePreparationTab(rows);
  assert.ok(!html.includes('Congés payés') && !html.includes('>RTT<') && !html.includes('>Maladie<'), 'sans le module congés, ces 3 colonnes ne doivent même pas apparaître dans l\'entête du tableau');
  assert.ok(!html.includes('>Télétravail<'), 'sans le module planning, la colonne Télétravail ne doit pas apparaître');
  assert.ok(!html.includes('Notes de frais'), 'sans le module frais, la colonne ne doit pas apparaître');
  assert.ok(!html.includes('Tickets restaurant'), 'sans le module tickets, la colonne ne doit pas apparaître');

  console.log('OK — export-paie-cloisonnement-17-09.test.js (tableau "Préparation" : colonnes masquées sans leurs modules)');
}

function runColonnesExportCsvCacheesMemeEnPersonnalise() {
  const { DB, getPaieRows, renderExportPaieExportTab, year, month } = setup(['rh', 'remuneration']);
  const company = DB.getCurrentCompany();
  company.settings.exportPaieModele = 'personnalise';
  company.settings.exportPaieColonnes = { conges: true, teletravail: true, tickets: true, frais: true }; // tout coché malgré tout
  DB.saveCurrentCompany(company);

  const rows = getPaieRows(year, month);
  const html = renderExportPaieExportTab(rows);
  assert.ok(!html.includes('>Télétravail<'), 'même cochée en "personnalisé", une colonne dont le module n\'est pas souscrit ne doit jamais apparaître dans le fichier envoyé au logiciel de paie');
  assert.ok(!html.includes('Frais à rembourser'));
  assert.ok(!html.includes('Tickets resto'));

  console.log('OK — export-paie-cloisonnement-17-09.test.js (export CSV : le module prime toujours sur la personnalisation)');
}

try {
  runGetPaieRowsCoupeALaSourceSansModules();
  runGetPaieRowsControlePositifTousModules();
  runAnomaliesCoupeesSansModules();
  runColonnesTableauPreparationCacheesSansModules();
  runColonnesExportCsvCacheesMemeEnPersonnalise();
} catch (err) {
  console.error('ÉCHEC — export-paie-cloisonnement-17-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
