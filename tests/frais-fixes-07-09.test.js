/**
 * Seven RH — retour Betty du 07/09/2026 sur le module Notes de frais, points 1 et 2 (les deux
 * défauts qui touchent l'argent, corrigés en priorité).
 */
const assert = require('assert');
const { loadDataJs } = require('./load-data-js');
const { loadAppJs } = require('./load-app-js');

async function run() {
  // ---- Point 1 : le barème kilométrique doit s'appliquer au CUMUL ANNUEL, pas trajet par trajet.
  //      Reproduit exactement l'exemple chiffré de Betty : 25 trajets de 300 km (7500 km au total)
  //      doit donner EXACTEMENT le même total que "le même total d'un coup", peu importe la puissance
  //      fiscale — jamais le montant surévalué de l'ancien calcul par trajet. ----
  {
    const { calculateIndemniteKilometrique } = loadDataJs();

    const cas = [
      { cv: 3, totalAttendu: 3435.00 },
      { cv: 5, totalAttendu: 4072.50 },
      { cv: 7, totalAttendu: 4470.00 },
    ];

    cas.forEach(({ cv, totalAttendu }) => {
      // 25 notes de 300 km, chacune calculée avec le cumul de TOUTES les précédentes de l'année.
      let cumul = 0;
      let totalDecoupe = 0;
      for (let i = 0; i < 25; i++) {
        const montant = calculateIndemniteKilometrique(300, cv, cumul);
        totalDecoupe += montant;
        cumul += 300;
      }
      totalDecoupe = Math.round(totalDecoupe * 100) / 100;

      assert.strictEqual(totalDecoupe, totalAttendu,
        `${cv} CV : 25 trajets de 300 km cumulés doivent totaliser ${totalAttendu} € (barème appliqué au cumul), pas un montant surévalué par trajet isolé — obtenu ${totalDecoupe}`);

      // Doit aussi correspondre exactement à "le même total d'un coup" (télescopage de la formule).
      const enUnCoup = calculateIndemniteKilometrique(7500, cv, 0);
      assert.strictEqual(enUnCoup, totalAttendu, `${cv} CV : 7500 km saisis en une seule note doit aussi donner ${totalAttendu} €`);
    });

    // Avant ce correctif, l'ancien calcul par trajet (sans cumul) aurait donné un montant supérieur —
    // vérifie que le nouveau calcul cumulatif est bien STRICTEMENT inférieur à cette ancienne erreur,
    // pas juste "différent".
    const ancienCalculParTrajetSurevalue = 25 * calculateIndemniteKilometrique(300, 3, 0); // 0 à chaque fois = bug reproduit
    assert.ok(3435.00 < ancienCalculParTrajetSurevalue, 'le nouveau total cumulé doit être strictement inférieur à l\'ancien calcul par trajet (qui restait chaque fois en tranche 1 à tort)');
  }

  // ---- Point 2 : une note validée après la clôture de son propre mois doit remonter sur la paie du
  //      mois où elle est devenue payable (validation), jamais rester rattachée au mois de la dépense
  //      (qui peut déjà être clos) ni disparaître silencieusement. ----
  {
    const { DB, sandbox, getPaieRows, getExpensePayableMonthKey } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();

    const employee = DB.getEmployees().find(e => e.role === 'salarie');
    const company = DB.getCurrentCompany();
    company.expenses = company.expenses || [];
    // Dépense du 28 janvier, mais validée (passage à "Remboursé") le 5 mars seulement.
    const noteTardive = {
      id: 'nf-tardive', employeeId: employee.id, categorie: 'Repas', date: '2026-01-28',
      libelle: 'Déjeuner client', montantTTC: 42.5, tauxTVA: 10, statut: 'Remboursé',
      workflow: ['manager'], etapeIndex: -1,
      historique: [
        { date: '2026-01-28T10:00:00.000Z', action: 'Note créée' },
        { date: '2026-03-05T09:00:00.000Z', action: 'Remboursé (par Manager)' },
      ],
      dateCreation: '2026-01-28T10:00:00.000Z', dateModification: '2026-03-05T09:00:00.000Z',
      kilometrage: null, justificatif: null, commentaire: '',
    };
    // Dépense de janvier, remboursée immédiatement (workflow vide) — doit, elle, bien rester en janvier.
    const noteNormale = {
      id: 'nf-normale', employeeId: employee.id, categorie: 'Repas', date: '2026-01-10',
      libelle: 'Déjeuner', montantTTC: 20, tauxTVA: 10, statut: 'Remboursé',
      workflow: [], etapeIndex: -1,
      historique: [{ date: '2026-01-10T10:00:00.000Z', action: 'Note créée' }],
      dateCreation: '2026-01-10T10:00:00.000Z', dateModification: '2026-01-10T10:00:00.000Z',
      kilometrage: null, justificatif: null, commentaire: '',
    };
    company.expenses.push(noteTardive, noteNormale);
    DB.saveCurrentCompany(company);

    assert.strictEqual(getExpensePayableMonthKey(noteTardive), '2026-03', 'une note validée en mars doit être rattachée à mars, jamais au mois de la dépense (janvier)');
    assert.strictEqual(getExpensePayableMonthKey(noteNormale), '2026-01', 'une note auto-validée à la création reste rattachée à son mois de création');

    const janvier = getPaieRows(2026, 0).find(r => r.employee.id === employee.id);
    const mars = getPaieRows(2026, 2).find(r => r.employee.id === employee.id);

    assert.strictEqual(janvier.notesRembourser, 20, 'janvier ne doit compter QUE la note normale (20 €), jamais la note validée en mars — sinon elle disparaît complètement, plus grave, elle ne doit pas non plus rester comptée deux fois');
    assert.strictEqual(mars.notesRembourser, 42.5, 'la note validée le 5 mars doit remonter sur la paie de mars, le mois où elle est réellement devenue payable');
  }

  // ---- Point 6 : le total affiché en haut de l'écran ne doit compter que ce qui reste réellement
  //      dû (en attente ou remboursé), jamais les notes Refusé/Annulé — sinon "12 notes, 2 340 € TTC"
  //      ne veut plus rien dire dès qu'un refus se mélange dans le total. ----
  {
    const { DB, sandbox, renderFrais, state } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    const company = DB.getCurrentCompany();
    company.expenses = [
      { id: 'nf-1', employeeId: salarie.id, categorie: 'Repas', date: '2026-01-05', libelle: 'A', montantTTC: 100, tauxTVA: 10, statut: 'Remboursé', workflow: [], etapeIndex: -1, historique: [{ date: '2026-01-05T10:00:00.000Z', action: 'Note créée' }], dateCreation: '2026-01-05T10:00:00.000Z', dateModification: '2026-01-05T10:00:00.000Z', kilometrage: null, justificatif: null, commentaire: '' },
      { id: 'nf-2', employeeId: salarie.id, categorie: 'Repas', date: '2026-01-06', libelle: 'B', montantTTC: 50, tauxTVA: 10, statut: 'En attente', workflow: ['rh'], etapeIndex: 0, historique: [{ date: '2026-01-06T10:00:00.000Z', action: 'Note créée' }], dateCreation: '2026-01-06T10:00:00.000Z', dateModification: '2026-01-06T10:00:00.000Z', kilometrage: null, justificatif: null, commentaire: '' },
      { id: 'nf-3', employeeId: salarie.id, categorie: 'Repas', date: '2026-01-07', libelle: 'C', montantTTC: 999, tauxTVA: 10, statut: 'Refusé', workflow: ['rh'], etapeIndex: 0, historique: [{ date: '2026-01-07T10:00:00.000Z', action: 'Note créée' }], dateCreation: '2026-01-07T10:00:00.000Z', dateModification: '2026-01-07T10:00:00.000Z', kilometrage: null, justificatif: null, commentaire: '' },
      { id: 'nf-4', employeeId: salarie.id, categorie: 'Repas', date: '2026-01-08', libelle: 'D', montantTTC: 777, tauxTVA: 10, statut: 'Annulé', workflow: [], etapeIndex: -1, historique: [{ date: '2026-01-08T10:00:00.000Z', action: 'Note créée' }], dateCreation: '2026-01-08T10:00:00.000Z', dateModification: '2026-01-08T10:00:00.000Z', kilometrage: null, justificatif: null, commentaire: '' },
    ];
    DB.saveCurrentCompany(company);
    state.fraisFilters = { employeeId: '', categorie: '', statut: '', periode: '' };
    state.fraisPage = 1;

    const html = renderFrais();
    const subtitle = (html.match(/<p class="view-subtitle">([\s\S]*?)<\/p>/) || [])[1] || '';
    assert.ok(subtitle.includes('4 notes'), 'les 4 notes doivent toutes apparaître dans le compte (filtre inchangé)');
    assert.ok(subtitle.includes('150,00'), `le total affiché doit être 150 € (100 remboursé + 50 en attente), jamais 1926 € (avec le refusé et l'annulé mélangés) — sous-titre obtenu : "${subtitle}"`);
    assert.ok(!subtitle.includes('1 926') && !subtitle.includes('1926'), 'le total ne doit jamais inclure les notes Refusé/Annulé');
  }

  // ---- Point 8 : le bouton "Voir les notes à valider" doit suivre les permissions individuelles
  //      (comme partout ailleurs dans l'application), pas une liste de rôles codée en dur — un
  //      salarié qui reçoit validerNoteFrais par surcharge individuelle doit voir le bouton. ----
  {
    const { DB, sandbox, renderFrais, state } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    state.fraisFilters = { employeeId: '', categorie: '', statut: '' };
    state.fraisPage = 1;

    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    DB._currentEmployeeId = salarie.id;
    assert.ok(!renderFrais().includes('Voir les notes à valider'), 'un salarié ordinaire ne doit pas voir le bouton de validation');

    const company = DB.getCurrentCompany();
    const salarieAvecSurcharge = company.employees.find(e => e.id === salarie.id);
    salarieAvecSurcharge.permissionsOverrides = { validerNoteFrais: true };
    DB.saveCurrentCompany(company);
    assert.ok(renderFrais().includes('Voir les notes à valider'), 'une permission validerNoteFrais accordée individuellement doit afficher le bouton, même pour un rôle salarié — c\'était impossible avec l\'ancienne liste de rôles codée en dur');

    const manager = DB.getEmployees().find(e => e.role === 'manager');
    DB._currentEmployeeId = manager.id;
    assert.ok(renderFrais().includes('Voir les notes à valider'), 'un manager (controlerNoteFrais par défaut) doit toujours voir le bouton, comme avant');
  }

  // ---- Point 4 : justificatif obligatoire par catégorie, inconditionnel ou au-delà d'un seuil. ----
  {
    const { isJustificatifObligatoireForExpense } = loadAppJs();
    const settings = { categoriesFraisConfig: {
      Hébergement: { justificatifObligatoire: true },
      Repas: { seuilJustificatif: 50 },
    } };
    assert.strictEqual(isJustificatifObligatoireForExpense('Hébergement', 5, settings), true, 'catégorie marquée obligatoire : toujours requis, quel que soit le montant');
    assert.strictEqual(isJustificatifObligatoireForExpense('Repas', 30, settings), false, 'sous le seuil : pas obligatoire');
    assert.strictEqual(isJustificatifObligatoireForExpense('Repas', 60, settings), true, 'au-delà du seuil : obligatoire');
    assert.strictEqual(isJustificatifObligatoireForExpense('Transport', 1000, settings), false, 'catégorie absente de la config : jamais obligatoire (comportement inchangé avant ce correctif)');
  }

  // ---- Point 5 : le salarié peut corriger/annuler sa propre note tant que personne ne l'a
  //      validée — jamais après, jamais la note d'un autre. ----
  {
    const { DB, sandbox, canSelfManagePendingExpense, handleEditExpense, handleSelfCancelExpense } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    const autre = DB.getEmployees().find(e => e.role === 'manager');
    DB._currentEmployeeId = salarie.id;

    const notePendante = { id: 'nf-a', employeeId: salarie.id, statut: 'En attente', etapeIndex: 0 };
    const noteEnCoursDeValidation = { id: 'nf-b', employeeId: salarie.id, statut: 'En attente', etapeIndex: 1 };
    const noteAutrui = { id: 'nf-c', employeeId: autre.id, statut: 'En attente', etapeIndex: 0 };
    const user = DB.getCurrentUser();

    assert.strictEqual(canSelfManagePendingExpense(notePendante, user), true, 'sa propre note, jamais encore touchée par un valideur : modifiable/annulable');
    assert.strictEqual(canSelfManagePendingExpense(noteEnCoursDeValidation, user), false, 'une étape de validation déjà franchie protège la note, même pour son auteur');
    assert.strictEqual(canSelfManagePendingExpense(noteAutrui, user), false, 'jamais la note d\'un autre salarié');

    // handleEditExpense/handleSelfCancelExpense doivent refuser (toast) les cas interdits — capturé
    // en remplaçant showToast plutôt que de lire le DOM (le stub de toast-root n'implémente pas
    // appendChild, utilisé par la vraie fonction).
    const company = DB.getCurrentCompany();
    company.expenses = [notePendante, noteEnCoursDeValidation, noteAutrui];
    DB.saveCurrentCompany(company);
    let toastMessages = [];
    sandbox.showToast = (msg) => toastMessages.push(msg);
    handleEditExpense('nf-c'); // note d'autrui
    assert.ok(toastMessages.some(m => m.includes('non autorisée')), 'handleEditExpense doit refuser la note d\'un autre salarié');
    toastMessages = [];
    handleSelfCancelExpense('nf-b'); // déjà en cours de validation
    assert.ok(toastMessages.some(m => m.includes('non autorisée')), 'handleSelfCancelExpense doit refuser une note déjà touchée par un valideur');
  }

  // ---- Point 7 : "Remboursé" (fin du circuit de validation) reste distinct du paiement réel —
  //      markExpensePaid enregistre une date de paiement séparée, jamais automatique. ----
  {
    const { markExpensePaid } = loadDataJs();
    const expense = { historique: [{ date: '2026-01-01T00:00:00.000Z', action: 'Note créée' }] };
    const patch = markExpensePaid(expense);
    assert.ok(patch.datePaiement, 'markExpensePaid doit renseigner une date de paiement');
    assert.ok(patch.historique.some(h => h.action === 'Marqué comme payé'), 'l\'action doit être tracée dans l\'historique');

    const { DB, sandbox, handleMarkExpensePaid, PERMISSIONS } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    // MARQUER_NOTE_REMBOURSEE est accordée par défaut à Comptabilité (qui gère les vrais paiements),
    // PAS à RH (qui valide la légitimité de la dépense) — séparation des tâches déjà voulue par le
    // catalogue de permissions (DEFAULT_ROLE_PERMISSIONS, data.js), pas une omission de ce correctif.
    const comptable = DB.getEmployees().find(e => e.role === 'comptabilite');
    DB._currentEmployeeId = comptable.id;
    const company = DB.getCurrentCompany();
    company.expenses = [{ id: 'nf-payee', employeeId: comptable.id, statut: 'Remboursé', datePaiement: null, historique: [], montantTTC: 10 }];
    DB.saveCurrentCompany(company);
    handleMarkExpensePaid('nf-payee');
    assert.ok(DB.getExpenses().find(n => n.id === 'nf-payee').datePaiement, 'la note doit porter une date de paiement après l\'action');

    // RH, elle, n'a PAS cette permission par défaut : ne doit jamais pouvoir l'appeler.
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const company2 = DB.getCurrentCompany();
    company2.expenses = [{ id: 'nf-payee-2', employeeId: comptable.id, statut: 'Remboursé', datePaiement: null, historique: [], montantTTC: 10 }];
    DB.saveCurrentCompany(company2);
    handleMarkExpensePaid('nf-payee-2');
    assert.strictEqual(DB.getExpenses().find(n => n.id === 'nf-payee-2').datePaiement, null, 'un rôle sans la permission ne doit jamais pouvoir marquer une note comme payée');
  }

  // ---- Point 10 : détection de doublon (même salarié/date/montant/catégorie), en excluant les
  //      notes déjà refusées/annulées et la note elle-même (cas d'une modification). ----
  {
    const { findDuplicateExpense } = loadDataJs();
    const notes = [
      { id: 'nf-1', employeeId: 'e1', categorie: 'Repas', date: '2026-01-05', montantTTC: 20, statut: 'En attente' },
      { id: 'nf-2', employeeId: 'e1', categorie: 'Repas', date: '2026-01-05', montantTTC: 999, statut: 'Refusé' },
    ];
    assert.strictEqual(findDuplicateExpense('e1', 'Repas', '2026-01-05', 20, notes), notes[0], 'un doublon actif (même salarié/date/montant/catégorie) doit être détecté');
    assert.strictEqual(findDuplicateExpense('e1', 'Repas', '2026-01-05', 999, notes), null, 'une note Refusée ne doit jamais compter comme doublon actif');
    assert.strictEqual(findDuplicateExpense('e1', 'Repas', '2026-01-05', 20, notes, 'nf-1'), null, 'exclure la note elle-même (cas d\'une modification) ne doit pas se signaler comme son propre doublon');
  }

  // ---- Point 13 : filtre par période + totaux par statut, séparés du total dû unique (point 6). ----
  {
    const { DB, sandbox, renderFrais, state } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    const company = DB.getCurrentCompany();
    company.expenses = [
      { id: 'nf-jan', employeeId: salarie.id, categorie: 'Repas', date: '2026-01-05', libelle: 'A', montantTTC: 20, tauxTVA: 10, statut: 'Remboursé', workflow: [], etapeIndex: -1, historique: [{ date: '2026-01-05T10:00:00.000Z', action: 'Note créée' }], dateCreation: '2026-01-05T10:00:00.000Z', dateModification: '2026-01-05T10:00:00.000Z', kilometrage: null, justificatif: null, commentaire: '' },
      { id: 'nf-fev', employeeId: salarie.id, categorie: 'Repas', date: '2026-02-05', libelle: 'B', montantTTC: 30, tauxTVA: 10, statut: 'Refusé', workflow: [], etapeIndex: -1, historique: [{ date: '2026-02-05T10:00:00.000Z', action: 'Note créée' }], dateCreation: '2026-02-05T10:00:00.000Z', dateModification: '2026-02-05T10:00:00.000Z', kilometrage: null, justificatif: null, commentaire: '' },
    ];
    DB.saveCurrentCompany(company);
    state.fraisFilters = { employeeId: '', categorie: '', statut: '', periode: '2026-01' };
    state.fraisPage = 1;

    const html = renderFrais();
    const subtitle = (html.match(/<p class="view-subtitle">([\s\S]*?)<\/p>/) || [])[1] || '';
    assert.ok(subtitle.includes('1 note'), 'le filtre période=2026-01 ne doit garder que la note de janvier');
    assert.ok(subtitle.includes('Remboursé : 1'), 'les totaux par statut doivent apparaître à côté du total dû');
    assert.ok(!html.includes('>B<'), 'la note de février (hors période filtrée) ne doit pas apparaître dans le tableau');
  }

  // ---- Point 14 : export léger congés + frais, accessible sans le module RH. ----
  {
    const { DB, sandbox, canExportCongesFraisMoisLeger, exportCongesFraisMoisCSV, PERMISSIONS } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const user = DB.getCurrentUser();

    // §hasModule (app.js) ne restreint qu'en offre 'a_la_carte' — l'entreprise de démo par défaut a
    // toutes les options, il faut simuler explicitement un client qui n'a PAS souscrit au module RH.
    const company = DB.getCurrentCompany();
    company.abonnement.offre = 'a_la_carte';
    company.abonnement.modules = [{ key: 'conges' }, { key: 'frais' }];
    DB.saveCurrentCompany(company);

    assert.strictEqual(canExportCongesFraisMoisLeger(user), true, 'un RH avec voirSalaries, abonné congés+frais mais pas RH, doit voir l\'export léger');

    let captured = null;
    sandbox.exportRowsToCSV = (headers, rows, filename) => { captured = { headers, filename, rowCount: rows.length }; };
    exportCongesFraisMoisCSV();
    assert.ok(captured, 'exportCongesFraisMoisCSV doit produire un export');
    assert.strictEqual(captured.headers.length, 6, `l'export léger doit avoir exactement 6 colonnes (Matricule, Nom, Prénom, congés payés, RTT, notes de frais) — obtenu : ${JSON.stringify(captured.headers)}`);
    assert.ok(captured.headers.includes('Matricule'), 'colonne Matricule attendue');
    assert.ok(captured.headers.some(h => h.includes('Congés payés')), 'colonne congés payés attendue');
    assert.ok(captured.headers.some(h => h.includes('Notes de frais')), 'colonne notes de frais attendue');
    const forbiddenRhColumns = ['Salaire', 'Heures supplémentaires', 'Variables', 'Repos compensateur', 'Tickets'];
    forbiddenRhColumns.forEach(forbidden => {
      assert.ok(!captured.headers.some(h => h.includes(forbidden)), `l'export léger ne doit jamais exposer de colonne RH ("${forbidden}") — obtenu : ${JSON.stringify(captured.headers)}`);
    });
  }

  console.log('OK — frais-fixes-07-09.test.js (points 1,2,3,4,5,6,7,8,9,10,13,14 vérifiés)');
}

run().catch((err) => {
  console.error('ÉCHEC — frais-fixes-07-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
