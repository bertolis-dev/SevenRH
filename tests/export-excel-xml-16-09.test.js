/**
 * Seven RH — retour Betty du 16/09/2026 : "pour les exportation sur excel fais des tableaux plus
 * propre bien espacé" — les exports CSV destinés uniquement à être lus/imprimés dans Excel (congés,
 * notes de frais, tickets restaurant, journal d'audit...) produisaient un CSV brut : colonnes à leur
 * largeur par défaut, aucune mise en évidence de l'en-tête. Remplacé par un classeur au format XML
 * natif Excel (SpreadsheetML, .xls) avec colonnes déjà larges, en-tête distinct et bordures légères
 * — SEUL exportRowsToCSV change : exportRowsToCSVWithDelimiter (export paie, voir EXPORT_PAIE_MODELES)
 * doit rester un vrai CSV délimité, réimporté par des logiciels de paie tiers (Sage, Silae...).
 * Le déclenchement réel du téléchargement (Blob/URL/DOM) n'est pas simulable dans ce bac à sable
 * minimal (voir load-app-js.js) — ces tests portent sur la construction du XML elle-même, pure et
 * testable sans DOM.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAppJs } = require('./load-app-js');

async function runStructureClasseur() {
  const { buildExcelXmlWorkbook } = loadAppJs();
  const headers = ['Nom', 'Montant'];
  const rows = [['Dupont', 150.5], ['Martin', 42]];
  const xml = buildExcelXmlWorkbook(headers, rows, 'Feuille1');

  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'le fichier doit commencer par la déclaration XML, sans BOM avant');
  assert.ok(xml.includes('ss:Name="Feuille1"'), 'le nom de la feuille doit être repris');
  assert.strictEqual((xml.match(/<Column /g) || []).length, headers.length, 'une largeur de colonne par colonne, pour un tableau bien espacé');
  assert.ok(xml.includes('StyleID="header"'), 'l\'en-tête doit avoir un style dédié (mis en évidence)');
  assert.ok(xml.includes('<Data ss:Type="String">Nom</Data>'), 'en-tête "Nom" présent');
  assert.ok(xml.includes('<Data ss:Type="String">Dupont</Data>'), 'valeur texte présente');
  assert.ok(xml.includes('<Data ss:Type="Number">150.5</Data>'), 'un nombre JS doit être typé Number, pas String (alignement/tri corrects dans Excel)');

  console.log('OK — export-excel-xml-16-09.test.js (classeur Excel : colonnes espacées, en-tête distinct)');
}

async function runLargeursColonnesSuiventLeContenu() {
  const { excelColumnWidths } = loadAppJs();
  const headers = ['Court', 'Une colonne avec un contenu bien plus long que les autres'];
  const rows = [['a', 'x'], ['bb', 'y']];
  const widths = excelColumnWidths(headers, rows);
  assert.strictEqual(widths.length, 2);
  assert.ok(widths[1] > widths[0], 'une colonne au contenu plus long doit être plus large, pour rester lisible sans troncature');
  assert.ok(widths[0] >= 70, 'même une colonne courte garde une largeur minimale confortable');

  console.log('OK — export-excel-xml-16-09.test.js (largeur de colonne proportionnelle au contenu, jamais trop étroite)');
}

async function runEchappementEtProtectionFormule() {
  const { excelXmlCell, excelXmlEscape } = loadAppJs();

  assert.strictEqual(excelXmlEscape('Dupont & Fils <SAS>'), 'Dupont &amp; Fils &lt;SAS&gt;', 'les caractères spéciaux XML doivent être échappés (& < >), sinon fichier invalide');

  // Même protection anti-injection de formule que l'export CSV existant (neutralizeCsvFormulaInjection).
  const celluleFormule = excelXmlCell('=SOMME(A1:A99)');
  assert.ok(celluleFormule.includes("&#39;=SOMME") || celluleFormule.includes("'=SOMME"), 'une valeur commençant par "=" doit rester neutralisée en texte, jamais exécutable comme formule à l\'ouverture');

  const celluleMontantNegatif = excelXmlCell('-150,50');
  assert.ok(!celluleMontantNegatif.includes("'-150"), 'un montant négatif bien formé ne doit pas être neutralisé (ce n\'est pas une formule)');

  console.log('OK — export-excel-xml-16-09.test.js (échappement XML et protection anti-formule préservés)');
}

async function runExportPaieResteDuVraiCSV() {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const fnStart = appSource.indexOf('function exportRowsToCSVWithDelimiter(');
  const fnBody = appSource.slice(fnStart, fnStart + 300);
  assert.ok(fnBody.includes('downloadTextFile'), 'exportRowsToCSVWithDelimiter (utilisée par l\'export paie, réimporté par Sage/Silae/PayFit...) doit rester un vrai CSV délimité, jamais le format XML Excel');

  const exportStart = appSource.indexOf('function exportRowsToCSV(');
  const exportBody = appSource.slice(exportStart, exportStart + 300);
  assert.ok(exportBody.includes('downloadExcelXmlFile'), 'exportRowsToCSV (congés, notes de frais, tickets, audit...) doit produire le classeur Excel formaté');
  assert.ok(exportBody.includes(".xls"), 'le fichier généré doit porter l\'extension .xls, cohérente avec son contenu réel');

  console.log('OK — export-excel-xml-16-09.test.js (export paie non affecté, reste un CSV délimité pour les logiciels tiers)');
}

runStructureClasseur()
  .then(runLargeursColonnesSuiventLeContenu)
  .then(runEchappementEtProtectionFormule)
  .then(runExportPaieResteDuVraiCSV)
  .catch((err) => {
    console.error('ÉCHEC — export-excel-xml-16-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
