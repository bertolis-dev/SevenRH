/**
 * Seven RH — retour Betty du 14/09/2026 (Notes de frais point 2, "rapprochement bancaire") :
 * import MANUEL d'un relevé bancaire (CSV) plutôt qu'un flux automatique payant (Bridge/Budget
 * Insight), explicitement refusé par Betty ("je veux quand même que tu augmente les notes sans
 * devoir payer ni créer d'autres comptes"). Aucun compte tiers, aucun coût récurrent.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function activerFrais(DB) {
  const company = DB.getCurrentCompany();
  company.abonnement.offre = 'a_la_carte';
  company.abonnement.modules = [{ key: 'frais' }];
  DB.saveCurrentCompany(company);
}

function ajouterNoteFrais(DB, patch) {
  const expenses = DB.getExpenses();
  const note = Object.assign({ id: `nf-${expenses.length + 1}`, categorie: 'Transport', libelle: 'Note', montantTTC: 0, tauxTVA: 20, statut: 'En attente', workflow: [], etapeIndex: -1, historique: [], dossierId: null, justificatif: null, kilometrage: null, commentaire: '', datePaiement: null }, patch);
  expenses.push(note);
  DB.saveExpenses(expenses);
  return note;
}

async function runImport() {
  const { DB, sandbox, releveBancaireRepository } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();

  // Séparateur ';', virgule décimale (export bancaire français classique).
  const csv1 = '14/09/2026;VIR SEPA J DUPONT;89,50\n10/09/2026;CB CARREFOUR;12,30';
  const r1 = releveBancaireRepository.importer(csv1);
  assert.strictEqual(r1.success, true);
  assert.strictEqual(r1.ajoutees, 2);
  assert.strictEqual(releveBancaireRepository.getAll().length, 2);

  // Réimporter EXACTEMENT le même fichier ne doit jamais dupliquer les lignes.
  const r2 = releveBancaireRepository.importer(csv1);
  assert.strictEqual(r2.ajoutees, 0, 'un réimport du même fichier ne doit ajouter aucun doublon');
  assert.strictEqual(releveBancaireRepository.getAll().length, 2);

  // Séparateur ',', point décimal, et une ligne d'en-tête (montant non numérique) à ignorer sans
  // faire échouer le reste de l'import.
  const csv2 = 'Date,Libellé,Montant\n2026-09-05,VIR SEPA A MARTIN,45.00';
  const r3 = releveBancaireRepository.importer(csv2);
  assert.strictEqual(r3.ajoutees, 1, 'seule la ligne de données doit être importée');
  assert.strictEqual(r3.ignorees, 1, 'la ligne d\'en-tête doit être comptée comme ignorée, jamais silencieusement perdue');
  assert.strictEqual(releveBancaireRepository.getAll().length, 3);

  const ligne = releveBancaireRepository.getAll().find(l => l.libelle === 'VIR SEPA A MARTIN');
  assert.strictEqual(ligne.date, '2026-09-05');
  assert.strictEqual(ligne.montant, 45);

  console.log('OK — rapprochement-bancaire-14-09.test.js (import CSV : ; et , comme séparateur, virgule ou point décimal, dédoublonnage, en-tête ignorée sans casser le reste)');
}

async function runRapprochementAutomatique() {
  const { DB, sandbox, releveBancaireRepository } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  activerFrais(DB);
  const sarah = DB.getEmployees().find(e => e.role === 'salarie');

  const note = ajouterNoteFrais(DB, { employeeId: sarah.id, libelle: 'Train Paris-Lyon', montantTTC: 89.5, date: '2026-09-10', statut: 'Remboursé' });
  releveBancaireRepository.importer('14/09/2026;VIR SEPA REMBOURSEMENT;89,50');

  const result = releveBancaireRepository.rapprocherAuto();
  assert.strictEqual(result.rapprochees, 1, 'un montant identique à moins de 10 jours d\'écart doit être rapproché automatiquement');
  const ligne = releveBancaireRepository.getAll()[0];
  assert.strictEqual(ligne.statut, 'rapproche');
  assert.strictEqual(ligne.expenseId, note.id);

  // ---- Ambiguïté : deux notes au même montant ne doivent JAMAIS être rapprochées automatiquement ----
  {
    const { DB, sandbox, releveBancaireRepository } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    activerFrais(DB);
    const sarah = DB.getEmployees().find(e => e.role === 'salarie');
    ajouterNoteFrais(DB, { employeeId: sarah.id, libelle: 'Taxi A', montantTTC: 12.5, date: '2026-09-10', statut: 'Remboursé' });
    ajouterNoteFrais(DB, { employeeId: sarah.id, libelle: 'Taxi B', montantTTC: 12.5, date: '2026-09-12', statut: 'Remboursé' });
    releveBancaireRepository.importer('14/09/2026;VIR SEPA TAXI;12,50');
    const result = releveBancaireRepository.rapprocherAuto();
    assert.strictEqual(result.rapprochees, 0, 'deux notes candidates au même montant ne doivent jamais être rapprochées au hasard');
    assert.strictEqual(releveBancaireRepository.getAll()[0].statut, 'non_rapproche');
  }

  // ---- Un écart de plus de 10 jours ne doit jamais être proposé ----
  {
    const { DB, sandbox, releveBancaireRepository } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    activerFrais(DB);
    const sarah = DB.getEmployees().find(e => e.role === 'salarie');
    ajouterNoteFrais(DB, { employeeId: sarah.id, libelle: 'Ancien restaurant', montantTTC: 30, date: '2026-01-01', statut: 'Remboursé' });
    releveBancaireRepository.importer('14/09/2026;VIR SEPA;30,00');
    const result = releveBancaireRepository.rapprocherAuto();
    assert.strictEqual(result.rapprochees, 0, 'un écart de plusieurs mois ne doit jamais être proposé comme correspondance');
  }

  console.log('OK — rapprochement-bancaire-14-09.test.js (rapprochement automatique : montant + date proches, jamais en cas d\'ambiguïté ou d\'écart trop grand)');
}

async function runRapprochementManuel() {
  const { DB, sandbox, releveBancaireRepository } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  activerFrais(DB);
  const sarah = DB.getEmployees().find(e => e.role === 'salarie');
  const note = ajouterNoteFrais(DB, { employeeId: sarah.id, libelle: 'Hôtel', montantTTC: 120, date: '2026-09-01', statut: 'En attente' });
  releveBancaireRepository.importer('05/09/2026;VIR SEPA HOTEL;120,00');
  const ligne = releveBancaireRepository.getAll()[0];

  const echecSansNote = releveBancaireRepository.rapprocherManuel(ligne.id, null);
  assert.strictEqual(echecSansNote.success, false);

  const result = releveBancaireRepository.rapprocherManuel(ligne.id, note.id);
  assert.strictEqual(result.success, true);
  assert.strictEqual(releveBancaireRepository.getAll()[0].statut, 'rapproche');

  // Jamais un deuxième rapprochement sur une ligne déjà rapprochée.
  const echecDouble = releveBancaireRepository.rapprocherManuel(ligne.id, note.id);
  assert.strictEqual(echecDouble.success, false);

  const annulation = releveBancaireRepository.annuler(ligne.id);
  assert.strictEqual(annulation.success, true);
  assert.strictEqual(releveBancaireRepository.getAll()[0].statut, 'non_rapproche');
  assert.strictEqual(releveBancaireRepository.getAll()[0].expenseId, null);

  releveBancaireRepository.supprimer(ligne.id);
  assert.strictEqual(releveBancaireRepository.getAll().length, 0);

  console.log('OK — rapprochement-bancaire-14-09.test.js (rapprochement manuel : jamais deux fois, annulation propre, suppression d\'une ligne)');
}

async function runEcran() {
  const { DB, sandbox, releveBancaireRepository, renderRapprochementBancaireCard, renderFrais } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  activerFrais(DB);
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;
  const sarah = DB.getEmployees().find(e => e.role === 'salarie');
  const note = ajouterNoteFrais(DB, { employeeId: sarah.id, libelle: 'Train Paris-Lyon', montantTTC: 89.5, date: '2026-09-10', statut: 'Remboursé' });

  const htmlVide = renderRapprochementBancaireCard();
  assert.ok(htmlVide.includes('Importer un relevé'), 'le bouton d\'import doit toujours être visible, même sans relevé importé');
  assert.ok(htmlVide.includes('Aucun relevé importé'));

  releveBancaireRepository.importer('14/09/2026;VIR SEPA;89,50');
  releveBancaireRepository.rapprocherAuto();
  const htmlApresImport = renderRapprochementBancaireCard();
  assert.ok(htmlApresImport.includes('Train Paris-Lyon'), 'la note associée doit être rappelée sur la ligne rapprochée');
  assert.ok(!htmlApresImport.includes('Rapprocher automatiquement'), 'plus rien à rapprocher : le bouton ne doit pas s\'afficher pour rien');

  const htmlListe = renderFrais();
  assert.ok(htmlListe.includes('Rapproché'), 'la note elle-même doit afficher le badge "Rapproché" dans la liste des notes de frais');

  console.log('OK — rapprochement-bancaire-14-09.test.js (écran : import toujours accessible, note rapprochée rappelée, badge visible dans la liste des notes)');
}

runImport()
  .then(runRapprochementAutomatique)
  .then(runRapprochementManuel)
  .then(runEcran)
  .catch((err) => {
    console.error('ÉCHEC — rapprochement-bancaire-14-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
