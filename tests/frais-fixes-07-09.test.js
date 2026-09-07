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
    state.fraisFilters = { employeeId: '', categorie: '', statut: '' };
    state.fraisPage = 1;

    const html = renderFrais();
    const subtitle = (html.match(/<p class="view-subtitle">([^<]*)<\/p>/) || [])[1] || '';
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

  console.log('OK — frais-fixes-07-09.test.js (barème kilométrique cumulatif annuel, note validée tardivement rattachée au bon mois de paie, total exact, bouton de validation par permission)');
}

run().catch((err) => {
  console.error('ÉCHEC — frais-fixes-07-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
