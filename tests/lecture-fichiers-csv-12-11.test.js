/**
 * Seven RH — vérification du 12/11/2026 : la lecture d'un CSV par SheetJS est « à l'américaine » (03/08/2026 = 8 mars, « 12,5 » = 125, « 0,5 » = 5, accents UTF-8 cassés).
 * lireTableurEnLignes décode et lit les CSV en texte brut ; les vrais classeurs Excel gardent dates et nombres.
 */
const assert = require('assert');
const path = require('path');
const { loadAppJs } = require('./load-app-js');
const XLSX = require(path.join(__dirname, '..', 'xlsx.full.min.js'));

function run() {
  const api = loadAppJs();
  api.sandbox.XLSX = XLSX;
  api.sandbox.TextDecoder = TextDecoder;
  api.sandbox.Uint8Array = Uint8Array;
  const lire = (octets, opts) => api.lireTableurEnLignes(Uint8Array.from(octets).buffer, opts);
  const utf8 = (t, bom) => [...(bom ? [0xEF, 0xBB, 0xBF] : []), ...Buffer.from(t, 'utf8')];
  const win1252 = (t) => [...Buffer.from(t, 'latin1')];

  const csv = 'Matricule;Date;Solde;Nom\nA1;03/08/2026;12,5;Léa\nA2;14/08/2026;1,25;Zoé\nA3;10/08/26;0,5;Éric\n';
  for (const [nom, octets] of [['UTF-8', utf8(csv)], ['UTF-8 avec BOM', utf8(csv, true)], ['Windows-1252 (Excel français)', win1252(csv)]]) {
    const rows = lire(octets);
    assert.deepStrictEqual(rows[0], ['Matricule', 'Date', 'Solde', 'Nom'], `${nom} : en-têtes sans caractère parasite`);
    assert.deepStrictEqual(rows[1], ['A1', '03/08/2026', '12,5', 'Léa'], `${nom} : date, décimale et accents intacts`);
    assert.deepStrictEqual(rows[2], ['A2', '14/08/2026', '1,25', 'Zoé']);
    assert.deepStrictEqual(rows[3], ['A3', '10/08/26', '0,5', 'Éric']);
  }

  // Classeur Excel : une vraie date reste la bonne date, un vrai nombre reste un nombre (ou un texte si on le demande)
  const ws = XLSX.utils.aoa_to_sheet([['Matricule', 'Date', 'Solde'], ['A', new Date(2026, 7, 3), 12.5]], { cellDates: true });
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'S');
  const xlsx = [...XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })];
  assert.deepStrictEqual(lire(xlsx, { garderNombres: true })[1], ['A', '03/08/2026', 12.5], 'xlsx : date 3 août, solde 12,5 en nombre');
  assert.deepStrictEqual(lire(xlsx)[1], ['A', '03/08/2026', '12.5'], 'xlsx : nombre rendu en texte si garderNombres est faux');

  // Aperçu d'import absences : un CSV à la française donne les bonnes dates et bien une demi-journée de 0,5 jour
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  const sal = api.employeeRepository.getAll().find(e => !e.archive);
  const cp = api.leaveTypeRepository.getLeaveTypes().find(t => t.nom === 'Congés payés');
  const csvAbs = 'Matricule;Type;Date début;Date fin;Demi-journée;Nombre de jours\n' + [sal.matricule, cp.nom, '03/08/2026', '', 'Après-midi', '0,5'].join(';') + '\n';
  const rows = lire(win1252(csvAbs));
  const apercu = api.buildAbsencesPreviewRows(rows.slice(1), api.guessAbsencesColumnMapping(rows[0]), 'conge');
  assert.strictEqual(apercu[0].status, 'ok', apercu[0].message);
  assert.deepStrictEqual([apercu[0].dateDebut, apercu[0].nbJours, apercu[0].demiJournee], ['2026-08-03', 0.5, 'apres-midi']);

  console.log('OK — lecture-fichiers-csv-12-11.test.js (CSV : dates JJ/MM, décimales françaises, accents ; xlsx inchangé)');
}

run();
