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

async function runSalariesUtiliseLeGenerateurColore() {
  const { buildExcelXmlWorkbook } = loadAppJs();
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

  const employeesFnStart = appSource.indexOf('function exportEmployeesExcel(');
  const employeesFnBody = appSource.slice(employeesFnStart, employeesFnStart + 900);
  assert.ok(employeesFnBody.includes('buildExcelXmlWorkbook'), 'exportEmployeesExcel (liste des salariés) doit générer son fichier via buildExcelXmlWorkbook, plus via XLSX/SheetJS qui ne permet aucune couleur en version gratuite');
  assert.ok(employeesFnBody.includes('zebra: true'), 'exportEmployeesExcel doit activer le fond alterné (zebra), demandé par Betty ("rajoute de la couleurs")');

  // §retour Betty du 16/09/2026 : "rajoute de la couleurs sur le exporter excel des salariés" —
  // vérifie la construction du XML elle-même (fond alterné + couleurs de marque navy/or).
  const headers = ['Nom', 'Statut'];
  const rows = [['Dupont', 'Actif'], ['Martin', 'Actif'], ['Bernard', 'Actif']];
  const xml = buildExcelXmlWorkbook(headers, rows, 'Salariés', { zebra: true });

  assert.ok(xml.includes('StyleID="cell-zebra"'), 'une ligne sur deux doit porter le style "cell-zebra" (fond alterné)');
  assert.ok(xml.includes('#17284D') && xml.includes('#C99A54'), 'les couleurs utilisées doivent être celles de la marque (bleu marine + or, voir --landing-navy-700/--landing-gold-500 dans style.css), jamais une couleur arbitraire par colonne');
  // La 1ère ligne de données (Dupont) ne doit PAS être zébrée, la 2e (Martin) doit l'être.
  const dupontIndex = xml.indexOf('>Dupont<');
  const dupontCellStart = xml.lastIndexOf('<Cell', dupontIndex);
  assert.ok(!xml.slice(dupontCellStart, dupontIndex).includes('cell-zebra'), 'la première ligne de données garde le fond normal (pas zébrée)');
  const martinIndex = xml.indexOf('>Martin<');
  const martinCellStart = xml.lastIndexOf('<Cell', martinIndex);
  assert.ok(xml.slice(martinCellStart, martinIndex).includes('cell-zebra'), 'la deuxième ligne de données doit porter le fond alterné');

  // Sans l'option zebra (les 6 autres exports CSV→Excel), le comportement doit rester inchangé.
  const xmlSansZebra = buildExcelXmlWorkbook(headers, rows, 'Congés');
  assert.ok(!xmlSansZebra.includes('StyleID="cell-zebra"'), 'sans l\'option zebra, aucune cellule ne doit utiliser le style zébré (les autres exports Excel restent inchangés)');

  console.log('OK — export-excel-xml-16-09.test.js (export Salariés : fond alterné et couleurs de marque, autres exports Excel inchangés)');
}

async function runCalendrierRessembleAUnCalendrier() {
  const { buildCalendarExcelXmlWorkbook } = loadAppJs();
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

  const calendarFnStart = appSource.indexOf('function exportAbsenceCalendarExcel(');
  const calendarFnBody = appSource.slice(calendarFnStart, calendarFnStart + 3200);
  assert.ok(calendarFnBody.includes('buildCalendarExcelXmlWorkbook'), 'exportAbsenceCalendarExcel doit générer son fichier via buildCalendarExcelXmlWorkbook (bordures/week-ends), plus via XLSX/SheetJS qui ne permet aucune mise en forme en version gratuite');
  assert.ok(calendarFnBody.includes('WEEKDAY_LABELS'), 'chaque en-tête de jour doit aussi porter le jour de la semaine (ex. "1 Lun"), pour ressembler à un vrai calendrier');

  // §retour Betty du 16/09/2026 : "ressemble plus a un calendrier avec des cases et plus jolie" —
  // vérifie la construction du XML elle-même (bordures 4 côtés = "cases", week-ends grisés).
  const headers = ['Salarié', 'Service', '1 Lun', '2 Mar', '3 Mer', '4 Jeu', '5 Ven', '6 Sam', '7 Dim'];
  const rows = [['Dupont Marie', 'Commercial', '', '', 'Congés payés', '', '', '', '']];
  const weekendColumnIndexes = new Set([7, 8]); // "6 Sam" et "7 Dim", à l'index 7 et 8 dans headers
  const xml = buildCalendarExcelXmlWorkbook(headers, rows, 'Calendrier', weekendColumnIndexes);

  assert.ok(xml.includes('ss:Position="Left"') && xml.includes('ss:Position="Right"') && xml.includes('ss:Position="Top"') && xml.includes('ss:Position="Bottom"'), 'chaque cellule doit avoir une bordure sur ses 4 côtés, pour ressembler à de vraies cases plutôt qu\'à un simple filet sous chaque ligne');
  assert.ok(xml.includes('StyleID="header-weekend"'), 'les en-têtes samedi/dimanche doivent avoir un style distinct');
  assert.ok(xml.includes('StyleID="cell-weekend"'), 'les cellules samedi/dimanche doivent avoir un fond distinct (grisé), comme sur un vrai calendrier');
  // "6 Sam" (en-tête week-end) ne doit pas apparaître avec le style "header" normal.
  const samCellIndex = xml.indexOf('<Data ss:Type="String">6 Sam</Data>');
  const samCellStart = xml.lastIndexOf('<Cell', samCellIndex);
  assert.ok(xml.slice(samCellStart, samCellIndex).includes('header-weekend'), '"6 Sam" doit porter le style week-end, pas le style de semaine');

  console.log('OK — export-excel-xml-16-09.test.js (export calendrier : cases bordées sur les 4 côtés, week-ends distingués)');
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
  .then(runSalariesUtiliseLeGenerateurColore)
  .then(runCalendrierRessembleAUnCalendrier)
  .then(runExportPaieResteDuVraiCSV)
  .catch((err) => {
    console.error('ÉCHEC — export-excel-xml-16-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
