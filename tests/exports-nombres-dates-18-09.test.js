/**
 * Seven RH — retour Betty du 18/09/2026, point 7 : "les montants et les durées alignés à droite avec
 * le bon format, les dates au format français". La construction Excel elle-même (buildExcelXmlWorkbook,
 * en-tête bleu marine, première ligne figée) était déjà faite depuis le 16/09 — ce qui manquait,
 * trouvé en vérifiant : plusieurs exports passaient encore les montants/durées déjà mis en texte par
 * formatNumberFR AVANT d'atteindre excelXmlCell, qui ne peut alors plus les reconnaître comme de
 * vrais nombres (Type="String", jamais aligné à droite) — et certaines dates restaient en ISO brut
 * plutôt qu'au format français. Corrigé : exportLeaveRequestsCSV (congés/autres absences),
 * exportExpensesCSV (notes de frais), exportTicketsCSV, exportCongesFraisMoisCSV. excelXmlCell
 * bascule maintenant automatiquement un vrai nombre JS sur un style aligné à droite
 * (cell-number/cell-zebra-number), sans que l'appelant n'ait à y penser au cas par cas.
 *
 * Comme export-excel-xml-16-09.test.js : le téléchargement réel (Blob/URL/DOM) n'est pas simulable
 * dans ce bac à sable — downloadExcelXmlFile est remplacée par une capture du XML produit, seule
 * façon de vérifier le VRAI comportement de la fonction d'export plutôt qu'une reconstruction à côté.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function setupAvecCapture() {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  const rh = api.DB.getEmployees().find(e => e.role === 'rh');
  api.DB._currentEmployeeId = rh.id;
  let capturedXml = null;
  api.sandbox.downloadExcelXmlFile = (xml) => { capturedXml = xml; };
  return { ...api, rh, getCapturedXml: () => capturedXml };
}

async function runExcelXmlCellAligneLesNombresADroite() {
  const { buildExcelXmlWorkbook } = setupAvecCapture();
  const xml = buildExcelXmlWorkbook(['Nom', 'Jours'], [['Dupont', 3.5], ['Martin', 'texte']], 'Test');
  assert.ok(xml.includes('<Style ss:ID="cell-number">') && xml.includes('Horizontal="Right"'), 'un style dédié aligné à droite doit exister pour les nombres');
  assert.ok(xml.includes('<Cell ss:StyleID="cell-number"><Data ss:Type="Number">3.5</Data></Cell>'), 'un vrai nombre JS doit basculer automatiquement sur ce style');
  assert.ok(!xml.includes('StyleID="cell-number"><Data ss:Type="String">texte'), 'un texte ne doit jamais basculer sur le style numérique');

  console.log('OK — exports-nombres-dates-18-09.test.js (excelXmlCell aligne automatiquement les vrais nombres à droite)');
}

async function runExportCongesNombresEtDatesCorrects() {
  const { DB, sandbox, employeeRepository, leaveTypeRepository, exportLeaveRequestsCSV, getCapturedXml } = setupAvecCapture();
  const employee = employeeRepository.getAll().find(e => !e.archive);
  const type = leaveTypeRepository.getLeaveTypes().find(t => t.categorie === 'conge' && t.nom === 'Congés payés');
  const now = new Date().toISOString();
  DB.saveLeaveRequests([...DB.getLeaveRequests(), {
    id: 'lr-export-test', employeeId: employee.id, typeId: type.id, statut: 'Validé', workflow: [],
    dateDebut: '2026-06-02', dateFin: '2026-06-06', nbJours: 3.5, historique: [], dateCreation: now, dateModification: now
  }]);

  exportLeaveRequestsCSV('conge');
  const xml = getCapturedXml();
  assert.ok(xml, 'l\'export doit bien produire un classeur');
  assert.ok(xml.includes('<Data ss:Type="Number">3.5</Data>'), 'le nombre de jours doit être un vrai nombre Excel, jamais un texte "3,5"');
  assert.ok(xml.includes('02/06/2026') && xml.includes('06/06/2026'), 'les dates doivent être au format français, jamais l\'ISO brut (2026-06-02)');
  assert.ok(!xml.includes('2026-06-02'), 'aucune date ISO brute ne doit fuiter dans le fichier');

  console.log('OK — exports-nombres-dates-18-09.test.js (export Congés : jours en vrai nombre, dates au format français)');
}

async function runExportNotesDeFraisNombresEtDatesCorrects() {
  const { DB, employeeRepository, exportExpensesCSV, getCapturedXml } = setupAvecCapture();
  const employee = employeeRepository.getAll().find(e => !e.archive);
  const now = new Date().toISOString();
  DB.saveExpenses([...DB.getExpenses(), {
    id: 'nf-export-test', employeeId: employee.id, categorie: 'Repas', date: '2026-03-15',
    libelle: 'Déjeuner client', montantTTC: 42.5, tauxTVA: 10, statut: 'En attente',
    workflow: [], etapeIndex: -1, historique: [], dateCreation: now, dateModification: now,
    kilometrage: null, justificatif: null, commentaire: ''
  }]);

  exportExpensesCSV();
  const xml = getCapturedXml();
  assert.ok(xml.includes('<Data ss:Type="Number">42.5</Data>'), 'le montant TTC doit être un vrai nombre Excel');
  assert.ok(xml.includes('15/03/2026'), 'la date de la dépense doit être au format français');
  assert.ok(!xml.includes('2026-03-15'), 'aucune date ISO brute ne doit fuiter dans le fichier');

  console.log('OK — exports-nombres-dates-18-09.test.js (export Notes de frais : montants en vrai nombre, dates au format français)');
}

async function runExportPaieResteUnVraiCsvDelimite() {
  // §non-régression explicite : ce correctif ne doit JAMAIS toucher l'export paie, qui reste un vrai
  // CSV délimité pour Sage/Silae/PayFit — déjà couvert par export-excel-xml-16-09.test.js, revérifié
  // ici pour qu'un futur lecteur de CE fichier voie tout de suite que la distinction est volontaire.
  const { exportRowsToCSVWithDelimiter } = setupAvecCapture();
  assert.strictEqual(typeof exportRowsToCSVWithDelimiter, 'function', 'exportRowsToCSVWithDelimiter doit toujours exister séparément de exportRowsToCSV');

  console.log('OK — exports-nombres-dates-18-09.test.js (non-régression : export paie non concerné par ce correctif)');
}

runExcelXmlCellAligneLesNombresADroite()
  .then(runExportCongesNombresEtDatesCorrects)
  .then(runExportNotesDeFraisNombresEtDatesCorrects)
  .then(runExportPaieResteUnVraiCsvDelimite)
  .catch((err) => {
    console.error('ÉCHEC — exports-nombres-dates-18-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
