/**
 * Seven RH — retour Betty du 28/09/2026 ("dans contrat & poste il y a une petite incohérence sur le
 * statut, catégorie cadre et le statut est à non cadre") : la fiche affiche deux champs distincts
 * pour la même idée de statut cadre — "Catégorie de salarié" (e.statutPro, synchronisée depuis
 * categorieSalarieId) et "Statut" (e.statutCadre, une case à cocher du CONTRAT depuis le socle
 * enrichi du 22/09/2026) — rien ne les synchronise entre elles. Remonté dans le contrôle des
 * dossiers (getDataQualityIssues) plutôt qu'auto-corrigé : les deux champs restent des décisions
 * distinctes (contrat vs catégorie RH), une correction automatique pourrait écraser une donnée
 * légitime.
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

function runCategorieCadreEtStatutNonCadreRemonteDansLeControleDesDossiers() {
  const { getDataQualityIssues, employeeRepository } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  employeeRepository.update(salarie.id, { statutPro: 'Cadre', statutCadre: false });

  const issues = getDataQualityIssues();
  const incoherence = issues.find(i => i.label === 'Catégorie de salarié et statut cadre du contrat en désaccord');
  assert.ok(incoherence, 'l\'incohérence catégorie/statut cadre doit apparaître dans le contrôle des dossiers');
  assert.ok(incoherence.employees.some(e => e.id === salarie.id), 'le salarié en désaccord doit figurer dans cette anomalie');

  console.log('OK — coherence-cadre-28-09.test.js (catégorie "Cadre" + statut "Non cadre" remonté dans le contrôle des dossiers)');
}

function runAgentDeMaitriseEtCadreRemonteAussi() {
  const { getDataQualityIssues, employeeRepository } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  employeeRepository.update(salarie.id, { statutPro: 'Agent de maîtrise', statutCadre: true });

  const issues = getDataQualityIssues();
  const incoherence = issues.find(i => i.label === 'Catégorie de salarié et statut cadre du contrat en désaccord');
  assert.ok(incoherence && incoherence.employees.some(e => e.id === salarie.id), 'une catégorie non-cadre avec un statut de contrat "cadre" doit aussi être signalée');

  console.log('OK — coherence-cadre-28-09.test.js ("Agent de maîtrise" + statut "Cadre" remonté aussi)');
}

function runAucuneFausseAlerteQuandCoherentOuCategoriePersonnalisee() {
  const { getDataQualityIssues, employeeRepository } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');

  employeeRepository.update(salarie.id, { statutPro: 'Cadre', statutCadre: true });
  let issues = getDataQualityIssues();
  assert.ok(!issues.find(i => i.label === 'Catégorie de salarié et statut cadre du contrat en désaccord' && i.employees.some(e => e.id === salarie.id)),
    'catégorie et statut cohérents (Cadre + cadre) ne doivent jamais être signalés');

  employeeRepository.update(salarie.id, { statutPro: 'Responsable régional (catégorie personnalisée)', statutCadre: false });
  issues = getDataQualityIssues();
  assert.ok(!issues.find(i => i.label === 'Catégorie de salarié et statut cadre du contrat en désaccord' && i.employees.some(e => e.id === salarie.id)),
    'une catégorie personnalisée, sans correspondance cadre/non-cadre fiable, ne doit jamais être signalée à tort');

  console.log('OK — coherence-cadre-28-09.test.js (aucune fausse alerte : cohérent, ou catégorie personnalisée sans correspondance fiable)');
}

function run() {
  runCategorieCadreEtStatutNonCadreRemonteDansLeControleDesDossiers();
  runAgentDeMaitriseEtCadreRemonteAussi();
  runAucuneFausseAlerteQuandCoherentOuCategoriePersonnalisee();
}

try {
  run();
} catch (err) {
  console.error('ÉCHEC — coherence-cadre-28-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
