/**
 * Seven RH — retour Betty du 11/09/2026 ("un vrai défaut de paiement", déjà signalé le 07/09/2026) :
 * refuser ou annuler une note de frais Kilométrique retire bien son kilométrage du cumul annuel pour
 * les FUTURES notes (getKilometrageDejaDeclareAnnee l'excluait déjà), mais les notes DÉJÀ enregistrées
 * avant ce refus restaient figées sur l'indemnité calculée à l'époque, sur un cumul qui n'existe plus
 * — le salarié perdait la différence. Ce fichier couvre recalculerIndemnitesKilometriquesAnnee (pur)
 * et DB.recalculerIndemnitesKilometriques (persistance), appelées après un refus/une annulation.
 */
const assert = require('assert');
const { loadDataJs } = require('./load-data-js');

async function run() {
  // ---- recalculerIndemnitesKilometriquesAnnee (pur) : le total après refus doit correspondre au
  // barème appliqué au SEUL kilométrage réellement valide, jamais à un cumul fantôme ----
  {
    const { calculateIndemniteKilometrique, recalculerIndemnitesKilometriquesAnnee } = loadDataJs();
    const cv = 5;
    // Trois notes saisies dans cet ordre : 4000 km (cumul 0→4000), 3000 km (cumul 4000→7000, la
    // 2ᵉ moitié franchit la tranche 2), 2000 km (cumul 7000→9000). La 2ᵉ note est ensuite refusée.
    const notes = [
      { id: 'nf-1', employeeId: 'e1', categorie: 'Kilométrique', date: '2026-03-01', dateCreation: '2026-03-01T09:00:00.000Z', statut: 'Remboursé', kilometrage: { distanceKm: 4000, puissanceFiscale: cv }, montantTTC: calculateIndemniteKilometrique(4000, cv, 0) },
      { id: 'nf-2', employeeId: 'e1', categorie: 'Kilométrique', date: '2026-06-01', dateCreation: '2026-06-01T09:00:00.000Z', statut: 'Refusé', kilometrage: { distanceKm: 3000, puissanceFiscale: cv }, montantTTC: calculateIndemniteKilometrique(3000, cv, 4000) },
      { id: 'nf-3', employeeId: 'e1', categorie: 'Kilométrique', date: '2026-09-01', dateCreation: '2026-09-01T09:00:00.000Z', statut: 'Remboursé', kilometrage: { distanceKm: 2000, puissanceFiscale: cv }, montantTTC: calculateIndemniteKilometrique(2000, cv, 7000) }
    ];

    const misesAJour = recalculerIndemnitesKilometriquesAnnee('e1', '2026', notes);
    assert.strictEqual(misesAJour.length, 1, 'seule la note nf-3 (après la note refusée) doit changer de montant');
    assert.strictEqual(misesAJour[0].id, 'nf-3');
    // nf-3 doit désormais être calculée sur un cumul avant de 4000 (seule nf-1 reste valide avant
    // elle), pas 7000 (qui incluait la note refusée nf-2).
    const attendu = calculateIndemniteKilometrique(2000, cv, 4000);
    assert.strictEqual(misesAJour[0].montantTTC, attendu);
    assert.ok(misesAJour[0].montantTTC > notes[2].montantTTC, 'le salarié doit récupérer la différence, jamais en perdre davantage');

    // Invariant central : la somme des notes encore valides doit désormais correspondre exactement
    // au barème appliqué en une seule fois au kilométrage réellement valide (4000 + 2000 = 6000 km)
    // — plus aucune trace du cumul fantôme de la note refusée.
    const totalApresRecalcul = notes[0].montantTTC + misesAJour[0].montantTTC;
    assert.strictEqual(totalApresRecalcul, calculateIndemniteKilometrique(6000, cv, 0), 'le total des notes valides doit égaler le barème appliqué directement à 6000 km, sans perte ni surplus');
  }

  // ---- Idempotence : rejouer le recalcul sans rien changer d'autre ne doit plus rien modifier ----
  {
    const { calculateIndemniteKilometrique, recalculerIndemnitesKilometriquesAnnee } = loadDataJs();
    const cv = 5;
    const notes = [
      { id: 'nf-1', employeeId: 'e1', categorie: 'Kilométrique', date: '2026-03-01', dateCreation: '2026-03-01T09:00:00.000Z', statut: 'Remboursé', kilometrage: { distanceKm: 4000, puissanceFiscale: cv }, montantTTC: calculateIndemniteKilometrique(4000, cv, 0) },
      { id: 'nf-3', employeeId: 'e1', categorie: 'Kilométrique', date: '2026-09-01', dateCreation: '2026-09-01T09:00:00.000Z', statut: 'Remboursé', kilometrage: { distanceKm: 2000, puissanceFiscale: cv }, montantTTC: calculateIndemniteKilometrique(2000, cv, 4000) }
    ];
    assert.strictEqual(recalculerIndemnitesKilometriquesAnnee('e1', '2026', notes).length, 0, 'déjà cohérent : aucune mise à jour à rejouer');
  }

  // ---- DB.recalculerIndemnitesKilometriques : persistance déclenchée après un vrai refus (via
  // handleRefuseExpense/handleCancelExpense, app.js) ----
  {
    const { DB, sandbox, calculateIndemniteKilometrique, refuseRequest } = loadDataJs();
    sandbox.window.SupabaseSync = new Proxy({
      async resolveWorkflowWithFallback() { return { success: true, workflow: [] }; }
    }, { get(target, prop) { return prop in target ? target[prop] : async () => ({ success: true }); } });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const cv = 5;

    const note1 = await DB.addExpense({ employeeId: rh.id, categorie: 'Kilométrique', date: '2026-03-01', libelle: 'Trajet 1', tauxTVA: 0, kilometrage: { distanceKm: 4000, puissanceFiscale: cv }, montantTTC: calculateIndemniteKilometrique(4000, cv, 0) });
    const note2 = await DB.addExpense({ employeeId: rh.id, categorie: 'Kilométrique', date: '2026-06-01', libelle: 'Trajet 2', tauxTVA: 0, kilometrage: { distanceKm: 3000, puissanceFiscale: cv }, montantTTC: calculateIndemniteKilometrique(3000, cv, 4000) });
    const note3 = await DB.addExpense({ employeeId: rh.id, categorie: 'Kilométrique', date: '2026-09-01', libelle: 'Trajet 3', tauxTVA: 0, kilometrage: { distanceKm: 2000, puissanceFiscale: cv }, montantTTC: calculateIndemniteKilometrique(2000, cv, 7000) });
    const montantNote3Avant = DB.getExpenseById(note3.id).montantTTC;

    // Refuse la 2ᵉ note, comme le ferait handleRefuseExpense (app.js) — puis déclenche le recalcul,
    // exactement comme ce handler le fait désormais pour toute note Kilométrique.
    DB.updateExpense(note2.id, refuseRequest(DB.getExpenseById(note2.id), 'Justificatif illisible'));
    DB.recalculerIndemnitesKilometriques(rh.id, '2026');

    assert.strictEqual(DB.getExpenseById(note1.id).montantTTC, note1.montantTTC, 'la 1ère note (avant celle refusée) ne doit jamais changer');
    const montantNote3Apres = DB.getExpenseById(note3.id).montantTTC;
    assert.notStrictEqual(montantNote3Apres, montantNote3Avant, 'la 3ᵉ note doit être recalculée après le refus de la 2ᵉ');
    assert.strictEqual(montantNote3Apres, calculateIndemniteKilometrique(2000, cv, 4000));
  }

  console.log('OK — kilometrique-recalcul-11-09.test.js (recalcul du barème kilométrique après refus/annulation, aucune perte pour le salarié)');
}

run().catch((err) => {
  console.error('ÉCHEC — kilometrique-recalcul-11-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
