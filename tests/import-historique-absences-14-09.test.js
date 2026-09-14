/**
 * Seven RH — retour Betty du 14/09/2026 ("continue avec un autre point gratuit", Congés) : import
 * Excel de l'historique des absences (congés déjà pris avant l'arrivée sur Nexus, ou saisie groupée
 * par RH plutôt qu'une demande à la fois). Même principe Excel → aperçu → import que l'import de
 * salariés/soldes initiaux (app.js) — aucun compte tiers, aucun coût récurrent.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function runMapping() {
  const { guessAbsencesColumnMapping } = loadAppJs();

  const headers = ['Matricule', 'Type de congé', 'Date début', 'Date fin', 'Commentaire'];
  const mapping = guessAbsencesColumnMapping(headers);
  assert.strictEqual(mapping.identifiant.field, 'matricule');
  assert.strictEqual(mapping.identifiant.index, 0);
  assert.strictEqual(mapping.type, 1);
  assert.strictEqual(mapping.dateDebut, 2);
  assert.strictEqual(mapping.dateFin, 3);
  assert.strictEqual(mapping.commentaire, 4);

  // Insensible aux accents/à la casse, et Email reconnu comme identifiant alternatif au Matricule.
  const headersEmail = ['EMAIL', 'TYPE', 'DEBUT', 'FIN'];
  const mappingEmail = guessAbsencesColumnMapping(headersEmail);
  assert.strictEqual(mappingEmail.identifiant.field, 'email');
  assert.strictEqual(mappingEmail.identifiant.index, 0);
  assert.strictEqual(mappingEmail.dateDebut, 2);
  assert.strictEqual(mappingEmail.dateFin, 3);

  console.log('OK — import-historique-absences-14-09.test.js (reconnaissance des colonnes, insensible aux accents/casse)');
}

async function runPreviewEtImport() {
  const { DB, sandbox, employeeRepository, leaveTypeRepository, leaveRepository, guessAbsencesColumnMapping, buildAbsencesPreviewRows, importAbsencesRows } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();

  const employee = employeeRepository.getAll().find(e => !e.archive);
  const type = leaveTypeRepository.getLeaveTypes().find(t => t.categorie === 'conge' && t.nom === 'Congés payés');
  assert.ok(employee && type, 'jeu de démo attendu : au moins un salarié et le type "Congés payés"');

  const headers = ['Matricule', 'Type', 'Date début', 'Date fin', 'Commentaire'];
  const mapping = guessAbsencesColumnMapping(headers);

  const dataRows = [
    [employee.matricule, 'Congés payés', '02/06/2026', '06/06/2026', 'Import test'], // ligne valide
    ['NE-EXISTE-PAS', 'Congés payés', '02/06/2026', '06/06/2026', ''], // salarié introuvable
    [employee.matricule, 'Type inconnu', '02/06/2026', '06/06/2026', ''], // type introuvable
    [employee.matricule, 'Congés payés', '10/06/2026', '05/06/2026', ''] // fin avant début
  ];

  const preview = buildAbsencesPreviewRows(dataRows, mapping, 'conge');
  assert.strictEqual(preview.length, 4);
  assert.strictEqual(preview[0].status, 'ok');
  assert.ok(preview[0].nbJours > 0);
  assert.strictEqual(preview[1].status, 'error');
  assert.match(preview[1].message, /introuvable/);
  assert.strictEqual(preview[2].status, 'error');
  assert.match(preview[2].message, /introuvable/);
  assert.strictEqual(preview[3].status, 'error');
  assert.match(preview[3].message, /avant/);

  const before = leaveRepository.getForEmployee(employee.id).length;
  const results = importAbsencesRows(preview);
  assert.strictEqual(results.created, 1, 'seule la ligne valide doit créer une demande');
  assert.strictEqual(results.errors, 3);

  const after = leaveRepository.getForEmployee(employee.id);
  assert.strictEqual(after.length, before + 1);
  const created = after.find(r => r.commentaire === 'Import test');
  assert.ok(created, 'la demande importée doit être retrouvable');
  assert.strictEqual(created.statut, 'Validé', 'une absence déjà passée est directement Validé, jamais En attente');
  assert.strictEqual(created.workflow.length, 0, 'aucune chaîne de validation pour un import historique');
  assert.strictEqual(created.dateDebut, '2026-06-02');
  assert.strictEqual(created.dateFin, '2026-06-06');

  console.log('OK — import-historique-absences-14-09.test.js (aperçu + import : seules les lignes valides créent une demande Validé, sans workflow)');
}

runMapping()
  .then(runPreviewEtImport)
  .catch((err) => {
    console.error('ÉCHEC — import-historique-absences-14-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
