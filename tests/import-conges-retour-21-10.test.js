/**
 * Seven RH — retour d'une utilisatrice qui reprend ses congés et RTT dans Nexus (21/10/2026) :
 *  - les dates Excel importées reculaient d'un jour (SheetJS rend minuit LOCAL, le site lisait les composantes UTC) ;
 *  - un espace en fin d'en-tête faisait ignorer toute la colonne, sans aucun avertissement ;
 *  - la valeur importée comme « solde initial » était en réalité un ajustement ajouté au calcul de Nexus ;
 *  - un ajustement de -0,07 jour était refusé par le champ (pas de 0,5).
 */
const assert = require('assert');
const path = require('path');
const XLSX = require(path.join(__dirname, '..', 'xlsx.full.min.js'));
const { loadAppJs } = require('./load-app-js');

function setup() {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  const rh = api.DB.getEmployees().find(e => e.role === 'rh');
  api.DB._currentEmployeeId = rh.id;
  return api;
}

function runLesDatesExcelNeReculentPlus() {
  const { dateCelluleExcelEnFR } = loadAppJs().sandbox;
  assert.strictEqual(dateCelluleExcelEnFR(new Date(2026, 9, 2)), '02/10/2026', 'minuit LOCAL (ce que rend SheetJS) : le 2 reste le 2');
  assert.strictEqual(dateCelluleExcelEnFR(new Date(Date.UTC(2026, 9, 2))), '02/10/2026', 'minuit UTC : le 2 reste le 2');
  assert.strictEqual(dateCelluleExcelEnFR(new Date(2026, 0, 1)), '01/01/2026', 'début d\'année');
  assert.strictEqual(dateCelluleExcelEnFR(new Date(2026, 11, 31)), '31/12/2026', 'fin d\'année');
  assert.strictEqual(dateCelluleExcelEnFR(new Date(2024, 1, 29)), '29/02/2024', '29 février');

  // lecture réelle d'un fichier Excel dans le fuseau de cette machine
  const ws = XLSX.utils.aoa_to_sheet([['Date'], [46297], [46023]]); // 02/10/2026 et 01/01/2026
  ws['A2'].z = 'dd/mm/yyyy'; ws['A3'].z = 'dd/mm/yyyy';
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'S');
  const lu = XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer', cellDates: true });
  const lignes = XLSX.utils.sheet_to_json(lu.Sheets.S, { header: 1, raw: true, defval: '' }).slice(1).map(r => r[0]);
  assert.strictEqual(dateCelluleExcelEnFR(lignes[0]), '02/10/2026', 'vraie cellule Excel du 02/10/2026');
  assert.strictEqual(dateCelluleExcelEnFR(lignes[1]), '01/01/2026', 'vraie cellule Excel du 01/01/2026');

  const src = require('fs').readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.ok(!/cell\.getUTCDate\(\)/.test(src), 'plus aucune lecture UTC brute des dates Excel dans app.js');
  console.log('OK — import-conges-retour-21-10.test.js (dates Excel : le jour saisi est le jour importé, minuit local ou UTC)');
}

function runUnEspaceEnFinDEnteteNEstPlusFatal() {
  const api = setup();
  const { guessSoldesColumnMapping, guessAbsencesColumnMapping, guessEmployeeColumnMapping, normaliserEnteteImport } = api.sandbox;
  assert.strictEqual(normaliserEnteteImport('  Congés payés   2026-2027 '), normaliserEnteteImport('Congés payés 2026-2027'));
  const types = [{ id: 'lt1', nom: 'Congés payés 2026-2027' }, { id: 'lt2', nom: 'RTT' }];
  const m = guessSoldesColumnMapping(['Matricule ', 'Congés payés 2026-2027 ', ' RTT', 'Remarque'], types);
  assert.ok(m.identifiant && m.identifiant.index === 0, 'identifiant reconnu malgré l\'espace');
  assert.deepStrictEqual(Array.from(m.typeColumns, c => c.typeId), ['lt1', 'lt2'], 'les deux colonnes de solde reconnues malgré les espaces');
  assert.deepStrictEqual(Array.from(m.ignorees), ['Remarque'], 'les colonnes non reconnues sont signalées');
  const a = guessAbsencesColumnMapping(['Matricule', 'Type ', 'Date début ', 'Date fin  '], types);
  assert.deepStrictEqual([a.type, a.dateDebut, a.dateFin], [1, 2, 3], 'import des absences : mêmes tolérances');
  const e = guessEmployeeColumnMapping(['Nom ', 'Prénom ', 'Email ']);
  assert.ok(e.nom === 0 && e.prenom === 1, 'import des salariés : mêmes tolérances');
  console.log('OK — import-conges-retour-21-10.test.js (espaces en trop dans les en-têtes : colonnes reconnues, colonnes ignorées signalées)');
}

function runLeSoldeCibleEstCalcule() {
  const api = setup();
  const { DB, sandbox, employeeRepository } = api;
  const salarie = DB.getEmployees().find(e => e.role === 'salarie');
  employeeRepository.update(salarie.id, { dateEmbauche: '2020-01-01' });
  const cp = DB.getLeaveTypes().find(t => t.nom === 'Congés payés');
  const mapping = { identifiant: { field: 'matricule', index: 0 }, typeColumns: [{ typeId: cp.id, typeNom: cp.nom, index: 1 }], ignorees: [] };
  const base = sandbox.getLeaveBalance(DB.getEmployeeById(salarie.id), cp, DB.getLeaveRequests(), DB.getLeaveTypes());
  const sansAjustement = Math.round((base.disponible - base.ajustement) * 100) / 100;

  // mode « solde cible » : la valeur du fichier est le solde RÉEL à obtenir
  let apercu = sandbox.buildSoldesPreviewRows([[salarie.matricule, '25']], mapping, 'cible');
  assert.strictEqual(apercu[0].status, 'ok', apercu[0].message);
  assert.strictEqual(apercu[0].soldes[0].apres, 25, 'l\'aperçu annonce le solde qui en résultera');
  assert.strictEqual(apercu[0].soldes[0].avant, base.disponible, 'et le solde actuel');
  sandbox.importSoldesRows(apercu);
  const apres = sandbox.getLeaveBalance(DB.getEmployeeById(salarie.id), cp, DB.getLeaveRequests(), DB.getLeaveTypes());
  assert.strictEqual(apres.disponible, 25, 'après l\'import, le solde affiché est exactement celui du fichier (reste de 0,07 compris)');
  assert.strictEqual(Math.round((25 - sansAjustement) * 100) / 100, apres.ajustement, 'l\'ajustement stocké est la différence avec le calcul de Nexus');

  // mode « ajustement » (comportement d'avant) : la valeur s'ajoute au calcul
  apercu = sandbox.buildSoldesPreviewRows([[salarie.matricule, '5']], mapping, 'ajustement');
  assert.strictEqual(apercu[0].soldes[0].apres, Math.round((sansAjustement + 5) * 100) / 100, 'ajustement : calcul de Nexus + 5');
  sandbox.importSoldesRows(apercu);
  const apres2 = sandbox.getLeaveBalance(DB.getEmployeeById(salarie.id), cp, DB.getLeaveRequests(), DB.getLeaveTypes());
  assert.strictEqual(apres2.disponible, Math.round((sansAjustement + 5) * 100) / 100);

  // virgule française et petits décimaux acceptés ; texte refusé
  ['0,07', '-0,07', '12,5', ' 25 '].forEach(v => assert.strictEqual(sandbox.buildSoldesPreviewRows([[salarie.matricule, v]], mapping, 'ajustement')[0].status, 'ok', `« ${v} » est un nombre`));
  assert.strictEqual(sandbox.buildSoldesPreviewRows([[salarie.matricule, 'abc']], mapping, 'cible')[0].status, 'error');
  console.log('OK — import-conges-retour-21-10.test.js (solde cible : l\'ajustement est calculé, l\'aperçu annonce le solde obtenu ; ajustement conservé en option)');
}

function runLAjustementManuelAccepteLesCentiemes() {
  const api = setup();
  const { DB, sandbox } = api;
  const salarie = DB.getEmployees().find(e => e.role === 'salarie');
  const cp = DB.getLeaveTypes().find(t => t.nom === 'Congés payés');
  sandbox.openAjusterCompteurModal(salarie.id, cp.id);
  const html = sandbox.document.getElementById('modal-root').innerHTML;
  assert.ok(/id="f-montant"[^>]*step="0\.01"/.test(html), 'le champ accepte -0,07 (le pas de 0,5 refusait la valeur)');
  assert.ok(!/step="0\.5"/.test(html));
  assert.ok(/id="f-mode-ajustement"/.test(html) && /Solde (souhaité|cible)/.test(html), 'choix ajustement / solde cible');
  assert.ok(/Solde actuel/.test(html), 'le solde actuel est rappelé');
  console.log('OK — import-conges-retour-21-10.test.js (ajustement manuel : centièmes acceptés, solde cible proposé)');
}

try {
  runLesDatesExcelNeReculentPlus();
  runUnEspaceEnFinDEnteteNEstPlusFatal();
  runLeSoldeCibleEstCalcule();
  runLAjustementManuelAccepteLesCentiemes();
} catch (err) {
  console.error('ÉCHEC — import-conges-retour-21-10.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
