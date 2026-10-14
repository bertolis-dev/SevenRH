/**
 * Seven RH — revue du 13/10/2026, point en attente traité le 14/10 : la carence des indemnités journalières de la Sécurité
 * sociale (3 jours) n'est PAS celle du maintien de salaire par l'employeur (maladie ordinaire : à partir du 8e jour, donc 7
 * jours de carence, art. D1226-3 ; aucune carence pour accident du travail / maladie professionnelle). Le délai employeur est
 * un réglage (une convention collective peut faire mieux), proposé à 7.
 */
const assert = require('assert');
const { loadDataJs } = require('./load-data-js');
const { loadAppJs } = require('./load-app-js');

function run() {
  const d = loadDataJs();
  assert.strictEqual(d.calculerJoursCarenceArret('maladie'), 3, 'carence Sécurité sociale inchangée : 3 jours');
  assert.strictEqual(d.calculerJoursCarenceMaintien('maladie'), 7, 'maintien employeur : 7 jours par défaut');
  assert.strictEqual(d.calculerJoursCarenceMaintien('maladie', 3), 3, 'réglable (convention plus favorable)');
  assert.strictEqual(d.calculerJoursCarenceMaintien('maladie', 0), 0, 'un 0 explicite est respecté');
  assert.strictEqual(d.calculerJoursCarenceMaintien('maladie', 'abc'), 7, 'valeur invalide : défaut');
  ['accidentTravail', 'accidentTrajet', 'maladieProfessionnelle'].forEach(t => assert.strictEqual(d.calculerJoursCarenceMaintien(t), 0, t + ' : aucune carence'));

  const employee = { id: 'e1', salaireBrutMensuel: 3000, dateEmbauche: '2020-01-01' };
  const maladie = { id: 'r1', employeeId: 'e1', dateDebut: '2026-09-01', dateFin: '2026-09-12', arretTravail: { typeArret: 'maladie' }, statut: 'Validé' };
  const e = d.calculerEstimationIndemnitesArret(maladie, employee, [maladie]);
  assert.strictEqual(e.nbJoursCalendaires, 12);
  assert.strictEqual(e.joursCarence, 3);
  assert.strictEqual(e.joursIndemnisables, 9, 'IJ Sécurité sociale : 12 - 3');
  assert.strictEqual(e.joursCarenceMaintien, 7);
  assert.strictEqual(e.joursMaintien, 5, 'maintien employeur : 12 - 7');
  assert.strictEqual(e.maintien.joursPlein, 5, 'le maintien ne couvre que les jours après la carence employeur');
  const ij5 = d.calculerIJSecuEstimee('maladie', 3000, 5);
  assert.strictEqual(e.complementEmployeurEstime, Math.max(0, Math.round((e.maintien.montant - ij5) * 100) / 100), 'complément = maintien moins l\'IJ sur LES MÊMES jours');
  assert.ok(e.ijSecuEstimee > ij5, 'l\'IJ affichée reste celle de tous les jours indemnisés par la Sécurité sociale');

  const e3 = d.calculerEstimationIndemnitesArret(maladie, employee, [maladie], { carenceMaintienMaladie: 3 });
  assert.strictEqual(e3.joursMaintien, 9, 'avec un réglage à 3 jours (ancien comportement)');

  const at = { ...maladie, arretTravail: { typeArret: 'accidentTravail' } };
  const ea = d.calculerEstimationIndemnitesArret(at, employee, [at]);
  assert.strictEqual(ea.joursMaintien, 12, 'accident du travail : maintien dès le premier jour');
  assert.strictEqual(ea.joursIndemnisables, 12);

  // les jours déjà consommés sur 12 mois suivent la carence employeur, pas celle de la Sécurité sociale
  const passe = { id: 'r0', employeeId: 'e1', dateDebut: '2026-06-01', dateFin: '2026-06-10', arretTravail: { typeArret: 'maladie' }, statut: 'Validé' };
  assert.strictEqual(d.getJoursMaintienDejaConsommes12Mois('e1', '2026-09-14', [passe], 'x'), 3, '10 jours - 7 de carence employeur');
  assert.strictEqual(d.getJoursMaintienDejaConsommes12Mois('e1', '2026-09-14', [passe], 'x', 3), 7, 'avec une carence réglée à 3');

  assert.strictEqual(loadAppJs().settingsRepository === undefined, false);
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  assert.strictEqual(api.settingsRepository.getSettings().carenceMaintienMaladieJours, 7, 'réglage proposé à 7 jours');
  console.log('OK — carence-maintien-salaire-14-10.test.js (carence Sécurité sociale 3 j, carence employeur 7 j réglable, AT sans carence, complément sur les mêmes jours)');
}

try { run(); } catch (err) { console.error('ÉCHEC — carence-maintien-salaire-14-10.test.js'); console.error(err.stack || err.message); process.exitCode = 1; }
