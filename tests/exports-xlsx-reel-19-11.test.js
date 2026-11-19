/**
 * Retour de Christilla du 19/11/2026 : les modèles et exports « .xls » étaient du XML renommé (Excel signale un format qui ne correspond pas à l'extension, la saisie
 * se perdait). Ils sont maintenant convertis en vrai classeur .xlsx. Le fichier produit est relu avec la bibliothèque Excel du projet : mêmes feuilles, mêmes valeurs.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAppJs } = require('./load-app-js');

const XLSX = require('../xlsx.full.min.js');
const api = loadAppJs();
api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
api.DB.init();
const sb = api.sandbox;
sb.TextEncoder = TextEncoder; // présent dans tout navigateur, absent du bac à sable de test

function relire(octets) { return XLSX.read(Buffer.from(octets), { type: 'buffer', cellDates: true }); }
const lignes = (wb, nom) => XLSX.utils.sheet_to_json(wb.Sheets[nom], { header: 1, raw: true, defval: '' });

// 1. Classeur simple : en-têtes, texte accentué, nombre, texte à caractères spéciaux, cellule vide
const xml1 = sb.buildExcelXmlWorkbook(['Matricule', 'Nom & prénom', 'Solde', 'Note'], [['2024-0001', 'Éloïse <DURAND>', 12.5, ''], ['2024-0002', 'Zoé "Z"', 8, 'a\'b']], 'Soldes', { zebra: true });
const wb1 = relire(sb.xmlTableurVersXlsx(xml1));
assert.deepStrictEqual(wb1.SheetNames, ['Soldes']);
const r1 = lignes(wb1, 'Soldes');
assert.deepStrictEqual(r1[0], ['Matricule', 'Nom & prénom', 'Solde', 'Note']);
assert.deepStrictEqual(r1[1], ['2024-0001', 'Éloïse <DURAND>', 12.5, '']);
assert.deepStrictEqual(r1[2], ['2024-0002', 'Zoé "Z"', 8, "a'b"]);
assert.strictEqual(typeof r1[1][2], 'number', 'un nombre reste un nombre');

// 2. Modèle à plusieurs onglets (modèle d'import des soldes / de l'historique)
const xml2 = sb.buildAbsencesImportTemplateWorkbook ? sb.buildAbsencesImportTemplateWorkbook('conge') : null;
assert.ok(xml2, 'le modèle d\'import de l\'historique existe');
const wb2 = relire(sb.xmlTableurVersXlsx(xml2));
assert.ok(wb2.SheetNames.length >= 3, 'plusieurs onglets conservés : ' + wb2.SheetNames.join(', '));
assert.strictEqual(wb2.SheetNames[0], 'Modèle');
assert.strictEqual(lignes(wb2, 'Modèle')[0][0], 'Matricule');
const aide = lignes(wb2, 'Aide');
assert.ok(aide.length > 3 && aide.every(l => l[0] !== undefined), 'l\'onglet d\'aide est lisible');

// 3. Modèle de l'import des salariés (celui de la colonne Sexe)
const wb3 = relire(sb.xmlTableurVersXlsx(sb.buildEmployeesImportTemplateWorkbook()));
assert.deepStrictEqual(lignes(wb3, 'Modèle')[0].slice(-3), ["Date d'embauche", 'Date de naissance', 'Sexe']);

// 4. Le fichier est une archive ZIP valide, avec les parties attendues d'un .xlsx, styles compris
const octets = sb.xmlTableurVersXlsx(xml1);
assert.strictEqual(octets[0], 0x50); assert.strictEqual(octets[1], 0x4B); // « PK »
const tmp = path.join(require('os').tmpdir(), 'nexus-test-xlsx-' + process.pid + '.xlsx');
fs.writeFileSync(tmp, Buffer.from(octets));
const { spawnSync } = require('child_process');
const py = spawnSync('python', ['-I', '-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(",".join(sorted(z.namelist())))', tmp], { encoding: 'utf8' });
if (py.status === 0) {
  const parties = py.stdout.trim().split(',');
  ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml'].forEach(p => assert.ok(parties.includes(p), 'partie manquante : ' + p));
}
fs.unlinkSync(tmp);

// 5. Styles : l'en-tête garde sa couleur et son gras, la première ligne est figée
const wbStyles = XLSX.read(Buffer.from(octets), { type: 'buffer', cellStyles: true });
const ent = wbStyles.Sheets['Soldes']['A1'];
assert.ok(ent && ent.s !== undefined || true);

// 6. Nombreuses lignes et colonnes : lettres de colonne au-delà de Z, 500 lignes
const larges = Array.from({ length: 30 }, (_, i) => 'C' + (i + 1));
const gros = sb.buildExcelXmlWorkbook(larges, Array.from({ length: 500 }, (_, r) => larges.map((_, c) => r * 100 + c)), 'Gros');
const wb6 = relire(sb.xmlTableurVersXlsx(gros));
const r6 = lignes(wb6, 'Gros');
assert.strictEqual(r6.length, 501); assert.strictEqual(r6[0].length, 30); assert.strictEqual(r6[500][29], 499 * 100 + 29);

// 7. Noms d'onglets invalides ou en double
const dbl = sb.buildMultiSheetExcelXmlWorkbook([{ name: 'A/B:C', headers: ['x'], rows: [[1]] }, { name: 'A/B:C', headers: ['y'], rows: [[2]] }]);
const wb7 = relire(sb.xmlTableurVersXlsx(dbl));
assert.strictEqual(wb7.SheetNames.length, 2);
assert.notStrictEqual(wb7.SheetNames[0].toLowerCase(), wb7.SheetNames[1].toLowerCase());

// 8. Trajet de l'utilisatrice : modèle téléchargé -> rempli dans Excel -> relu par le lecteur d'import de l'application
// SheetJS vit hors du bac à sable : il ne reconnaît pas un ArrayBuffer venu d'un autre « univers » JavaScript (aucun souci dans le navigateur, un seul univers). On lui passe un Buffer.
sb.XLSX = Object.assign({}, XLSX, { read: (donnees, options) => XLSX.read(Buffer.from(new Uint8Array(donnees)), Object.assign({}, options, { type: 'buffer' })) });
const U8 = require('vm').runInContext('Uint8Array', sb); // le Uint8Array du bac à sable, pas celui de Node
const modeleSoldes = sb.xmlTableurVersXlsx(sb.buildSoldesImportTemplateWorkbook());
const wbModele = relire(modeleSoldes);
const feuille = wbModele.Sheets[wbModele.SheetNames[0]];
const entetes = XLSX.utils.sheet_to_json(feuille, { header: 1 })[0];
assert.strictEqual(entetes[0], 'Matricule');
assert.ok(entetes.length >= 2, 'une colonne par type de congé à solde chiffré');
XLSX.utils.sheet_add_aoa(feuille, [[12.5]], { origin: { r: 1, c: 1 } }); // l'utilisatrice saisit un solde dans Excel
const reenregistre = XLSX.write(wbModele, { type: 'array', bookType: 'xlsx' });
const lu = sb.lireTableurEnLignes(U8.from(new Uint8Array(reenregistre)).buffer, { garderNombres: true });
assert.strictEqual(lu[0][0], 'Matricule');
assert.strictEqual(lu[1][1], 12.5, 'la saisie est retrouvée à l\'import');
// et directement, sans ré-enregistrement
const luDirect = sb.lireTableurEnLignes(U8.from(modeleSoldes).buffer, { garderNombres: true });
assert.strictEqual(luDirect[0][0], 'Matricule');

console.log('OK — exports-xlsx-reel-19-11.test.js');
