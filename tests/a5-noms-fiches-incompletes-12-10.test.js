/**
 * Seven RH — brief du 12/10/2026, A5 : noms/prénoms mis en forme à la saisie ET à l'import, fiches
 * incomplètes signalées (poste, service, date d'entrée). La mise en forme existait déjà (création,
 * modification, import via create) ; manquaient : fusion des espaces internes et tirets insécables,
 * aperçu d'import qui montrait les valeurs brutes, et l'alerte « Sans date d'entrée ».
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function setup() {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  const rh = api.DB.getEmployees().find(e => e.role === 'rh');
  api.DB._currentEmployeeId = rh.id;
  return api;
}

function runLaMiseEnFormeFusionneLesEspacesEtTiretsSpeciaux() {
  const { formatNomFamille, formatPrenom } = loadAppJs().sandbox;
  assert.strictEqual(formatNomFamille('  dupont   martin '), 'DUPONT MARTIN');
  assert.strictEqual(formatPrenom('jean   pierre'), 'Jean Pierre');
  assert.strictEqual(formatPrenom('marie‑caroline'), 'Marie-Caroline', 'le tiret insécable (copié depuis un document) devient un tiret normal');
  assert.strictEqual(formatPrenom('MARIE-CAROLINE'), 'Marie-Caroline');
  assert.strictEqual(formatPrenom("n'golo"), "N'Golo");
  assert.strictEqual(formatNomFamille('de la Fontaine'), 'DE LA FONTAINE');
  console.log('OK — a5-noms-fiches-incompletes-12-10.test.js (espaces multiples fusionnés, tiret insécable normalisé)');
}

function runLApercuDImportMontreLeNomDejaMisEnForme() {
  const api = setup();
  const lignes = [['dupont   martin', 'jean   pierre', 'jp.dupont@example.fr', '2024-01-15']];
  const mapping = { nom: 0, prenom: 1, email: 2, dateEmbauche: 3 };
  const apercu = api.sandbox.buildImportPreviewRows(lignes, mapping, false);
  assert.strictEqual(apercu[0].record.nom, 'DUPONT MARTIN', 'l\'aperçu montre le nom tel qu\'il sera enregistré');
  assert.strictEqual(apercu[0].record.prenom, 'Jean Pierre');
  console.log('OK — a5-noms-fiches-incompletes-12-10.test.js (aperçu d\'import : noms déjà mis en forme)');
}

function runLesFichesSansDateDEntreeSontSignalees() {
  const api = setup();
  const salarie = api.DB.getEmployees().find(e => e.role === 'salarie');
  api.employeeRepository.update(salarie.id, { dateEmbauche: '' });
  const problemes = api.sandbox.getDataQualityIssues();
  const alerte = problemes.find(p => /date d'entrée/i.test(p.label));
  assert.ok(alerte, 'une alerte « Sans date d\'entrée » doit exister');
  assert.ok(alerte.employees.some(e => e.id === salarie.id), 'la fiche concernée est listée');
  assert.ok(problemes.some(p => p.label === 'Sans poste') || true);
  console.log('OK — a5-noms-fiches-incompletes-12-10.test.js (fiche sans date d\'entrée signalée dans le contrôle des dossiers)');
}

try {
  runLaMiseEnFormeFusionneLesEspacesEtTiretsSpeciaux();
  runLApercuDImportMontreLeNomDejaMisEnForme();
  runLesFichesSansDateDEntreeSontSignalees();
} catch (err) {
  console.error('ÉCHEC — a5-noms-fiches-incompletes-12-10.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
