/**
 * Seven RH — 12/11/2026 : modèles téléchargeables pour l'import des salariés et des soldes initiaux (comme celui des absences).
 * Salariés : en-têtes seuls (aucune ligne d'exemple qui serait créée par erreur) + aide + services. Soldes : un salarié par ligne, une colonne par type à solde chiffré.
 */
const assert = require('assert');
const path = require('path');
const { loadAppJs } = require('./load-app-js');
const XLSX = require(path.join(__dirname, '..', 'xlsx.full.min.js'));

function run() {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.sandbox.XLSX = XLSX; api.sandbox.TextDecoder = TextDecoder; api.sandbox.Uint8Array = Uint8Array;
  api.DB.init();
  const lireFeuille = (xml, nom) => XLSX.utils.sheet_to_json(XLSX.read(xml, { type: 'string' }).Sheets[nom], { header: 1, defval: '' });

  // --- Salariés ---
  const xmlSal = api.buildEmployeesImportTemplateWorkbook();
  assert.deepStrictEqual(XLSX.read(xmlSal, { type: 'string' }).SheetNames, ['Modèle', 'Aide', 'Services']);
  const entetes = lireFeuille(xmlSal, 'Modèle');
  assert.strictEqual(entetes.length, 1, 'le modèle ne contient que les en-têtes : aucune ligne d\'exemple à supprimer');
  const mapping = api.guessEmployeeColumnMapping(entetes[0]);
  ['matricule', 'nom', 'prenom', 'email', 'telephone', 'poste', 'service', 'equipe', 'typeContrat', 'dateEmbauche', 'dateNaissance']
    .forEach(champ => assert.notStrictEqual(mapping[champ], undefined, `l'en-tête du modèle est reconnu à l'import : ${champ}`));

  // --- Soldes ---
  const xmlSoldes = api.buildSoldesImportTemplateWorkbook();
  const lignes = lireFeuille(xmlSoldes, 'Modèle');
  const types = api.leaveTypeRepository.getLeaveTypes();
  const mapSoldes = api.guessSoldesColumnMapping(lignes[0], types);
  assert.ok(mapSoldes.identifiant && mapSoldes.identifiant.field === 'matricule', 'colonne Matricule reconnue');
  assert.strictEqual(mapSoldes.ignorees.length, 0, 'aucune colonne du modèle n\'est ignorée à l\'import');
  assert.ok(mapSoldes.typeColumns.length >= 1, 'au moins une colonne de type de congé');
  assert.ok(!mapSoldes.typeColumns.some(c => types.find(t => t.id === c.typeId).illimite), 'pas de colonne pour un type illimité');
  const actifs = api.employeeRepository.getAll().filter(e => !e.archive);
  assert.strictEqual(lignes.length - 1, actifs.length, 'un salarié actif par ligne');
  assert.ok(actifs.every(e => lignes.some(l => String(l[0]) === String(e.matricule))), 'le matricule de chaque salarié est déjà rempli');

  // Remplir deux soldes puis vérifier l'aperçu
  lignes[1][1] = 12.5; lignes[2][1] = '3,5';
  const previews = api.buildSoldesPreviewRows(lignes.slice(1).filter(l => l.slice(1).some(c => c !== '')), mapSoldes, 'cible');
  assert.deepStrictEqual(previews.map(p => p.status), ['ok', 'ok']);
  assert.deepStrictEqual(previews.map(p => p.soldes[0].apres), [12.5, 3.5]);
  console.log('OK — modeles-import-salaries-soldes-12-11.test.js (modèles salariés et soldes : en-têtes reconnus, soldes remplissables)');
}

run();
