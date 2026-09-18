/**
 * Seven RH — retour Betty du 18/09/2026 (reprise de l'historique 2026 depuis Axcelor), points 1 à 4 :
 *
 * 1. buildAbsencesPreviewRows appelait computeWorkingDays avec demiJournee figé à false — toute
 *    demi-journée importée devenait une journée entière. Deux colonnes ajoutées (Demi-journée
 *    début/fin), au même vocabulaire que le formulaire manuel (openLeaveRequestModal) : "Après-midi"
 *    pour la première colonne, "Matin" pour la seconde, jamais un texte libre — un jour unique n'en
 *    remplit qu'une des deux (elle donne directement la demi-journée de ce jour), plusieurs jours
 *    peuvent remplir les deux indépendamment (début ET fin).
 * 2. Bouton "Télécharger le modèle" dans la fenêtre d'import (buildAbsencesImportTemplateWorkbook).
 * 3. Le modèle contient deux onglets de référence (Salariés avec matricule, Types de congés/
 *    absences existants) en plus de l'onglet à remplir.
 * 4. Le modèle ne propose plus que le matricule comme colonne d'identification (l'email reste
 *    reconnu par l'analyseur pour un fichier construit autrement, volontairement — voir le fil de
 *    discussion).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function setup() {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  return api;
}

async function runMappingReconnaitLesDeuxColonnes() {
  const { guessAbsencesColumnMapping } = setup();
  const headers = ['Matricule', 'Type', 'Date début', 'Date fin', 'Demi-journée début', 'Demi-journée fin', 'Commentaire'];
  const mapping = guessAbsencesColumnMapping(headers);
  assert.strictEqual(mapping.demiJourneeDebut, 4);
  assert.strictEqual(mapping.demiJourneeFin, 5);

  // Insensible aux accents/à la casse, comme le reste des colonnes de ce fichier.
  const headersSansAccent = ['MATRICULE', 'TYPE', 'DEBUT', 'FIN', 'DEMI JOURNEE DEBUT', 'DEMI JOURNEE FIN'];
  const mapping2 = guessAbsencesColumnMapping(headersSansAccent);
  assert.strictEqual(mapping2.demiJourneeDebut, 4);
  assert.strictEqual(mapping2.demiJourneeFin, 5);

  console.log('OK — import-demi-journees-modele-18-09.test.js (les deux colonnes demi-journée sont reconnues, insensibles aux accents/casse)');
}

async function runJourUniqueApresMidi() {
  const { DB, employeeRepository, leaveTypeRepository, guessAbsencesColumnMapping, buildAbsencesPreviewRows, computeWorkingDays, settingsRepository } = setup();
  const employee = employeeRepository.getAll().find(e => !e.archive);
  const type = leaveTypeRepository.getLeaveTypes().find(t => t.categorie === 'conge' && t.nom === 'Congés payés');
  const attendu = computeWorkingDays('2026-10-06', '2026-10-06', true, employee, settingsRepository.getSettings(), type.uniteDecompte);
  assert.strictEqual(attendu, 0.5, 'contrôle : un jour unique en demi-journée doit valoir 0,5 (mardi 06/10/2026, jour ouvré)');

  const headers = ['Matricule', 'Type', 'Date début', 'Date fin', 'Demi-journée début', 'Demi-journée fin'];
  const mapping = guessAbsencesColumnMapping(headers);
  const dataRows = [[employee.matricule, 'Congés payés', '06/10/2026', '06/10/2026', 'Après-midi', '']];
  const preview = buildAbsencesPreviewRows(dataRows, mapping, 'conge');
  assert.strictEqual(preview[0].status, 'ok');
  assert.strictEqual(preview[0].demiJournee, 'apres-midi');
  assert.strictEqual(preview[0].nbJours, 0.5, 'un jour unique "Après-midi" doit valoir une demi-journée, jamais une journée entière');

  console.log('OK — import-demi-journees-modele-18-09.test.js (jour unique après-midi : 0,5 jour, jamais 1)');
}

async function runJourUniqueMatin() {
  const { employeeRepository, leaveTypeRepository, guessAbsencesColumnMapping, buildAbsencesPreviewRows } = setup();
  const employee = employeeRepository.getAll().find(e => !e.archive);
  const headers = ['Matricule', 'Type', 'Date début', 'Date fin', 'Demi-journée début', 'Demi-journée fin'];
  const mapping = guessAbsencesColumnMapping(headers);
  const dataRows = [[employee.matricule, 'Congés payés', '07/10/2026', '07/10/2026', '', 'Matin']];
  const preview = buildAbsencesPreviewRows(dataRows, mapping, 'conge');
  assert.strictEqual(preview[0].status, 'ok');
  assert.strictEqual(preview[0].demiJournee, 'matin');
  assert.strictEqual(preview[0].nbJours, 0.5);

  console.log('OK — import-demi-journees-modele-18-09.test.js (jour unique matin : 0,5 jour)');
}

async function runPlusieursJoursDebutEtFin() {
  // Même motif que le cas réel signalé (Véronique BORGE, après-midi au premier jour, matin au
  // dernier) — dates propres (lundi-mercredi, semaine standard) plutôt que reprendre exactement ses
  // dates du 02 au 07/10 : computeWorkingDays renvoie bien 3 jours pour cette période précise-là
  // (vendredi après-midi + lundi + mardi + mercredi matin), pas 3,5 — écart signalé séparément à
  // Betty, jamais supposé silencieusement dans ce test.
  const { employeeRepository, leaveTypeRepository, guessAbsencesColumnMapping, buildAbsencesPreviewRows, computeWorkingDays, settingsRepository } = setup();
  const employee = employeeRepository.getAll().find(e => !e.archive);
  const type = leaveTypeRepository.getLeaveTypes().find(t => t.categorie === 'conge' && t.nom === 'Congés payés');
  const attendu = computeWorkingDays('2026-10-05', '2026-10-07', false, employee, settingsRepository.getSettings(), type.uniteDecompte, 'apres-midi', 'matin');
  assert.strictEqual(attendu, 2, 'contrôle : lundi après-midi à mercredi matin doit valoir 2 jours (0,5 + 1 + 0,5)');

  const headers = ['Matricule', 'Type', 'Date début', 'Date fin', 'Demi-journée début', 'Demi-journée fin'];
  const mapping = guessAbsencesColumnMapping(headers);
  const dataRows = [[employee.matricule, 'Congés payés', '05/10/2026', '07/10/2026', 'Après-midi', 'Matin']];
  const preview = buildAbsencesPreviewRows(dataRows, mapping, 'conge');
  assert.strictEqual(preview[0].status, 'ok');
  assert.strictEqual(preview[0].demiJournee, null, 'sur plusieurs jours, demiJournee (jour unique) doit rester vide');
  assert.strictEqual(preview[0].demiJourneeDebut, 'apres-midi');
  assert.strictEqual(preview[0].demiJourneeFin, 'matin');
  assert.strictEqual(preview[0].nbJours, 2);

  console.log('OK — import-demi-journees-modele-18-09.test.js (plusieurs jours, début après-midi ET fin matin, jour composé correctement)');
}

async function runValeurNonReconnueEstUneErreur() {
  const { employeeRepository, guessAbsencesColumnMapping, buildAbsencesPreviewRows } = setup();
  const employee = employeeRepository.getAll().find(e => !e.archive);
  const headers = ['Matricule', 'Type', 'Date début', 'Date fin', 'Demi-journée début', 'Demi-journée fin'];
  const mapping = guessAbsencesColumnMapping(headers);
  const dataRows = [
    [employee.matricule, 'Congés payés', '06/10/2026', '06/10/2026', 'Toute la journée', ''], // valeur non reconnue
    [employee.matricule, 'Congés payés', '08/10/2026', '08/10/2026', 'Matin', ''] // "Matin" refusé en colonne DÉBUT (seule "Après-midi" y a un sens)
  ];
  const preview = buildAbsencesPreviewRows(dataRows, mapping, 'conge');
  assert.strictEqual(preview[0].status, 'error', 'une valeur non reconnue ne doit jamais retomber silencieusement sur "journée complète"');
  assert.match(preview[0].message, /non reconnue/);
  assert.strictEqual(preview[1].status, 'error', '"Matin" n\'a de sens qu\'en colonne fin, jamais en colonne début');

  console.log('OK — import-demi-journees-modele-18-09.test.js (valeur de demi-journée non reconnue : erreur, jamais silencieusement ignorée)');
}

async function runLesDeuxColonnesSurUnJourUniqueEstUneErreur() {
  const { employeeRepository, guessAbsencesColumnMapping, buildAbsencesPreviewRows } = setup();
  const employee = employeeRepository.getAll().find(e => !e.archive);
  const headers = ['Matricule', 'Type', 'Date début', 'Date fin', 'Demi-journée début', 'Demi-journée fin'];
  const mapping = guessAbsencesColumnMapping(headers);
  const dataRows = [[employee.matricule, 'Congés payés', '06/10/2026', '06/10/2026', 'Après-midi', 'Matin']];
  const preview = buildAbsencesPreviewRows(dataRows, mapping, 'conge');
  assert.strictEqual(preview[0].status, 'error', 'un seul jour ne peut être à la fois "après-midi" et "matin" : contradictoire');

  console.log('OK — import-demi-journees-modele-18-09.test.js (les deux colonnes remplies sur un seul jour : rejeté comme contradictoire)');
}

async function runImportPersisteLaDemiJournee() {
  const { DB, employeeRepository, leaveRepository, guessAbsencesColumnMapping, buildAbsencesPreviewRows, importAbsencesRows } = setup();
  const employee = employeeRepository.getAll().find(e => !e.archive);
  const headers = ['Matricule', 'Type', 'Date début', 'Date fin', 'Demi-journée début', 'Demi-journée fin'];
  const mapping = guessAbsencesColumnMapping(headers);
  const dataRows = [[employee.matricule, 'Congés payés', '09/10/2026', '09/10/2026', '', 'Matin']];
  const preview = buildAbsencesPreviewRows(dataRows, mapping, 'conge');
  importAbsencesRows(preview);
  const created = leaveRepository.getForEmployee(employee.id).find(r => r.dateDebut === '2026-10-09');
  assert.ok(created, 'la demande importée doit être retrouvable');
  assert.strictEqual(created.demiJournee, 'matin', 'la demi-journée doit être conservée sur la demande créée, pas seulement dans l\'aperçu');
  assert.strictEqual(created.nbJours, 0.5);

  console.log('OK — import-demi-journees-modele-18-09.test.js (la demi-journée est bien persistée sur la demande importée)');
}

async function runModeleTelechargeable() {
  const { DB, employeeRepository, leaveTypeRepository, buildAbsencesImportTemplateWorkbook } = setup();
  const employees = employeeRepository.getAll().filter(e => !e.archive);
  const types = leaveTypeRepository.getLeaveTypes().filter(t => t.categorie === 'conge' && t.actif);
  const xml = buildAbsencesImportTemplateWorkbook('conge');

  assert.ok(xml.includes('ss:Name="Modèle"'), 'le premier onglet doit être celui à remplir');
  assert.ok(xml.includes('ss:Name="Salariés"'), 'un onglet de référence salariés doit exister (point 3)');
  assert.ok(xml.includes('ss:Name="Types de congés"'), 'un onglet de référence types de congés doit exister (point 3)');
  assert.ok(xml.includes('>Matricule<') && xml.includes('>Demi-journée début<') && xml.includes('>Demi-journée fin<'), 'les colonnes du modèle doivent inclure le matricule et les deux colonnes demi-journée');
  assert.ok(!xml.includes('>Email<'), 'le modèle ne doit plus proposer l\'email comme colonne d\'identification (point 4)');
  employees.forEach(e => assert.ok(xml.includes(excelXmlEscapeForTest(e.matricule)), `le salarié ${e.matricule} doit apparaître dans l'onglet de référence`));
  types.forEach(t => assert.ok(xml.includes(excelXmlEscapeForTest(t.nom)), `le type "${t.nom}" doit apparaître dans l'onglet de référence`));

  console.log('OK — import-demi-journees-modele-18-09.test.js (modèle téléchargeable : 3 onglets, colonnes correctes, listes de référence à jour)');
}

// Même échappement que excelXmlEscape (app.js) : & < > uniquement, pour comparer avec le XML généré
// sans dépendre de l'export de cette fonction interne.
function excelXmlEscapeForTest(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

runMappingReconnaitLesDeuxColonnes()
  .then(runJourUniqueApresMidi)
  .then(runJourUniqueMatin)
  .then(runPlusieursJoursDebutEtFin)
  .then(runValeurNonReconnueEstUneErreur)
  .then(runLesDeuxColonnesSurUnJourUniqueEstUneErreur)
  .then(runImportPersisteLaDemiJournee)
  .then(runModeleTelechargeable)
  .catch((err) => {
    console.error('ÉCHEC — import-demi-journees-modele-18-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
