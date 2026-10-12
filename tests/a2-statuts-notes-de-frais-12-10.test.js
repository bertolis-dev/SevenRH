/**
 * Seven RH — brief du 12/10/2026, A2 : une note affichait à la fois « Remboursé » et « à payer ».
 * Cause : le statut stocké « Remboursé » veut en réalité dire « validée » (la date de paiement est un
 * second axe, posé par « Marquer comme payé »). Cycle affiché unique : Soumise -> Validée, à payer ->
 * Remboursée, ou Refusée / Annulée. Les 4 statuts stockés ne changent pas (aucune migration) ; seuls
 * l'affichage, l'export et les transitions autorisées sont cadrés.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAppJs } = require('./load-app-js');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function runUnSeulLibelleParEtat() {
  const { libelleStatutNoteFrais } = loadAppJs().sandbox;
  assert.strictEqual(libelleStatutNoteFrais({ statut: 'En attente' }).libelle, 'Soumise');
  assert.strictEqual(libelleStatutNoteFrais({ statut: 'Remboursé', datePaiement: null }).libelle, 'Validée, à payer');
  assert.strictEqual(libelleStatutNoteFrais({ statut: 'Remboursé', datePaiement: '2026-10-05' }).libelle, 'Remboursée');
  assert.strictEqual(libelleStatutNoteFrais({ statut: 'Refusé' }).libelle, 'Refusée');
  assert.strictEqual(libelleStatutNoteFrais({ statut: 'Annulé' }).libelle, 'Annulée');
  ['En attente', 'Remboursé', 'Refusé', 'Annulé'].forEach(s => {
    const l = libelleStatutNoteFrais({ statut: s, datePaiement: s === 'Remboursé' ? '2026-10-05' : null }).libelle;
    assert.ok(!(/Remboursée/.test(l) && /à payer/.test(l)), 'jamais « Remboursée » et « à payer » ensemble');
  });
  console.log('OK — a2-statuts-notes-de-frais-12-10.test.js (un seul libellé par état : Soumise, Validée à payer, Remboursée, Refusée, Annulée)');
}

function runLesTransitionsSontControlees() {
  const { transitionNoteFraisAutorisee } = loadAppJs().sandbox;
  const ok = (de, vers) => transitionNoteFraisAutorisee(de, vers);
  assert.ok(ok('En attente', 'Remboursé') && ok('En attente', 'Refusé') && ok('En attente', 'Annulé') && ok('En attente', 'En attente'));
  assert.ok(ok('Remboursé', 'Remboursé') && ok('Remboursé', 'Annulé'));
  assert.ok(!ok('Refusé', 'Remboursé') && !ok('Refusé', 'En attente'), 'une note refusée ne repart jamais en validation');
  assert.ok(!ok('Annulé', 'Remboursé') && !ok('Annulé', 'En attente'), 'une note annulée est définitive');
  assert.ok(!ok('Remboursé', 'En attente') && !ok('Remboursé', 'Refusé'), 'une note validée ne revient pas en arrière');
  assert.ok(ok('Refusé', 'Refusé') && ok('Annulé', 'Annulé'), 'modifier un champ sans changer de statut reste permis');
  console.log('OK — a2-statuts-notes-de-frais-12-10.test.js (transitions de statut autorisées uniquement : pas de retour en arrière)');
}

function runLeRepositoryRefuseUneTransitionInterdite() {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  const employe = api.DB.getEmployees().find(e => e.role === 'salarie');
  const note = api.DB.getExpenses()[0] || api.DB.addExpense && null;
  const id = 'nf-test-a2';
  const liste = api.DB.getExpenses();
  liste.push({ id, employeeId: employe.id, categorie: 'Repas', libelle: 'Déjeuner client', montantTTC: 20, tauxTVA: 10, date: '2026-10-01', statut: 'Refusé', workflow: [], etapeIndex: 0, historique: [] });
  api.DB.saveExpenses(liste);
  assert.throws(() => api.DB.updateExpense(id, { statut: 'Remboursé' }), /Transition/, 'une note refusée ne peut plus être validée');
  assert.doesNotThrow(() => api.DB.updateExpense(id, { libelle: 'Déjeuner client Lyon' }), 'modifier un champ sans changer de statut reste permis');
  assert.strictEqual(api.DB.getExpenseById ? api.DB.getExpenseById(id).statut : 'Refusé', 'Refusé');
  console.log('OK — a2-statuts-notes-de-frais-12-10.test.js (updateExpense refuse une transition interdite, accepte une simple modification)');
}

function runLEcranEtLExportUtilisentLesNouveauxLibelles() {
  const i = app.indexOf('function renderExpenseStatutBadge');
  assert.ok(i > 0, 'le badge de statut des notes doit être dédié');
  const ligne = app.split('\n').find(l => l.includes('data-label="Statut"') && l.includes('renderExpenseStatutBadge(n)'));
  assert.ok(ligne, 'la liste des notes utilise le badge dédié');
  assert.ok(!/badge-muted">à payer/.test(ligne), 'plus de second badge « à payer » à côté de « Remboursé »');
  assert.ok(/libelleStatutNoteFrais\(n\)\.libelle,\s*\n?\s*n\.datePaiement \? formatDate\(n\.datePaiement\) : ''/.test(app), 'l\'export donne le libellé de statut et la VRAIE date de paiement (plus la date de validation)');
  console.log('OK — a2-statuts-notes-de-frais-12-10.test.js (liste : un seul badge ; export : libellé de statut + date de paiement réelle)');
}

try {
  runUnSeulLibelleParEtat();
  runLesTransitionsSontControlees();
  runLeRepositoryRefuseUneTransitionInterdite();
  runLEcranEtLExportUtilisentLesNouveauxLibelles();
} catch (err) {
  console.error('ÉCHEC — a2-statuts-notes-de-frais-12-10.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
