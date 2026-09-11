/**
 * Seven RH — retour Betty du 11/09/2026 (point 1, étape 2) : hydrateCurrentCompany (supabase-client.js)
 * ne rapatrie plus qu'une fenêtre glissante (~40 mois) pour leave_requests/telework_requests/expenses,
 * au lieu de tout l'historique à chaque connexion — la requête elle-même n'est pas testable ici (ES
 * module qui parle au vrai client Supabase, jamais chargé dans ce bac à sable Node, voir les autres
 * tests de ce fichier pour le patron habituel). Ce fichier couvre les deux conséquences CÔTÉ CLIENT
 * qui, elles, sont testables :
 *  - la fiche salarié "Notes de frais" ne doit plus jamais afficher un total "toute période" calculé
 *    sur le cache (désormais partiel) — il doit venir du serveur (get_expense_totals_for_employee) ;
 *  - le filtre "période" libre de l'écran Notes de frais doit prévenir plutôt que ressembler à un bug
 *    quand la période demandée est hors de la fenêtre rapatriée.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function run() {
  // ---- renderEmployeeFraisCard : chiffres locaux affichés immédiatement, puis remplacés par les
  // chiffres serveur une fois la RPC résolue ----
  {
    const { DB, sandbox, renderEmployeeFraisCard, state } = loadAppJs();
    DB.init();
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    const company = DB.getCurrentCompany();
    company.abonnement.offre = 'a_la_carte';
    company.abonnement.modules = [{ key: 'frais' }];
    company.expenses = [
      { id: 'nf-1', employeeId: salarie.id, categorie: 'Repas', date: '2026-08-01', libelle: 'A', montantTTC: 20, tauxTVA: 10, statut: 'Remboursé', workflow: [], etapeIndex: -1, historique: [], dateCreation: '2026-08-01T10:00:00.000Z', dateModification: '2026-08-01T10:00:00.000Z', kilometrage: null, justificatif: null, commentaire: '' },
    ];
    DB.saveCurrentCompany(company);

    let resolveRpc;
    sandbox.window.SupabaseSync = new Proxy({
      getExpenseTotalsForEmployee: () => new Promise((resolve) => {
        resolveRpc = () => resolve({ success: true, totalCount: 7, totalMontant: 543.21, enAttenteCount: 2 });
      }),
    }, { get(target, prop) { return prop in target ? target[prop] : async () => ({ success: true }); } });

    // Avant résolution de la RPC : les chiffres LOCAUX (le seul en attente/1 note) doivent déjà
    // s'afficher, jamais un blanc ni une exception.
    const htmlAvant = renderEmployeeFraisCard(salarie, salarie);
    assert.ok(htmlAvant.includes('1 note'), 'avant la réponse serveur, le nombre local (cache) doit déjà s\'afficher');
    assert.ok(htmlAvant.includes('20,00'), 'avant la réponse serveur, le montant local doit déjà s\'afficher');

    resolveRpc();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Après résolution : les chiffres SERVEUR (toute période) doivent remplacer les chiffres locaux.
    assert.ok(state.fraisTotalsCache[salarie.id].success, 'le cache de totaux doit contenir la réponse serveur');
    const htmlApres = renderEmployeeFraisCard(salarie, salarie);
    assert.ok(htmlApres.includes('7 notes'), 'après la réponse serveur, le total doit venir de get_expense_totals_for_employee, pas du cache local');
    assert.ok(htmlApres.includes('543,21'), 'le montant affiché doit être le total serveur, pas la somme du cache local (partiel)');
    assert.ok(htmlApres.includes('2 en attente'));
  }

  // ---- Salarié dont TOUT l'historique est hors fenêtre (cache local vide) mais qui a bien des
  // notes côté serveur : le message doit être honnête, jamais "aucune note enregistrée" ----
  {
    const { DB, sandbox, renderEmployeeFraisCard, state } = loadAppJs();
    DB.init();
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    const company = DB.getCurrentCompany();
    company.abonnement.offre = 'a_la_carte';
    company.abonnement.modules = [{ key: 'frais' }];
    company.expenses = []; // rien dans le cache local (tout hors fenêtre)
    DB.saveCurrentCompany(company);

    sandbox.window.SupabaseSync = new Proxy({
      getExpenseTotalsForEmployee: async () => ({ success: true, totalCount: 3, totalMontant: 150, enAttenteCount: 0 }),
    }, { get(target, prop) { return prop in target ? target[prop] : async () => ({ success: true }); } });
    renderEmployeeFraisCard(salarie, salarie); // déclenche le chargement
    await new Promise((resolve) => setTimeout(resolve, 0));

    const html = renderEmployeeFraisCard(salarie, salarie);
    assert.ok(html.includes('3 notes'), 'le total serveur doit s\'afficher même si le cache local est vide');
    assert.ok(!html.includes('Aucune note de frais enregistrée'), 'ne jamais dire "aucune note" quand le serveur affirme qu\'il y en a (juste hors fenêtre locale)');
    assert.ok(html.includes('40 mois'), 'le message doit expliquer honnêtement pourquoi le détail n\'est pas affiché');
  }

  // ---- Échec de la RPC : repli sur les chiffres locaux, jamais un plantage ----
  {
    const { DB, sandbox, renderEmployeeFraisCard } = loadAppJs();
    DB.init();
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    const company = DB.getCurrentCompany();
    company.abonnement.offre = 'a_la_carte';
    company.abonnement.modules = [{ key: 'frais' }];
    DB.saveCurrentCompany(company);
    sandbox.window.SupabaseSync = new Proxy({
      getExpenseTotalsForEmployee: async () => ({ success: false, error: 'indisponible' }),
    }, { get(target, prop) { return prop in target ? target[prop] : async () => ({ success: true }); } });

    assert.doesNotThrow(() => renderEmployeeFraisCard(salarie, salarie));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.doesNotThrow(() => renderEmployeeFraisCard(salarie, salarie), 'un échec de la RPC ne doit jamais faire planter le rendu, seulement garder les chiffres locaux');
  }

  // ---- renderFrais : le filtre période libre doit prévenir quand la période demandée est hors de
  // la fenêtre rapatriée, plutôt que de ressembler à un bug ----
  {
    const { DB, sandbox, renderFrais, state } = loadAppJs();
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const company = DB.getCurrentCompany();
    company.expenses = [];
    DB.saveCurrentCompany(company);
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });

    state.fraisFilters = { employeeId: '', categorie: '', statut: '', periode: '2010-01' }; // très largement avant la fenêtre, quelle que soit la date réelle d'exécution du test
    state.fraisPage = 1;
    const htmlVieillePeriode = renderFrais();
    assert.ok(htmlVieillePeriode.includes('hors du cache local') || htmlVieillePeriode.includes('40 mois'),
      'une période antérieure à la fenêtre rapatriée doit afficher un message dédié, pas juste "aucune note ne correspond à ces filtres"');

    const moisCourant = new Date().toISOString().slice(0, 7); // toujours dans la fenêtre, quelle que soit la date réelle d'exécution du test
    state.fraisFilters = { employeeId: '', categorie: '', statut: '', periode: moisCourant };
    const htmlPeriodeRecente = renderFrais();
    assert.ok(htmlPeriodeRecente.includes('Aucune note de frais ne correspond à ces filtres'),
      'une période RÉCENTE sans résultat doit garder le message générique habituel, pas le message "hors fenêtre"');
  }

  console.log('OK — fenetre-hydratation-11-09.test.js (fiche frais : total serveur jamais sous-évalué, filtre période : message honnête si hors fenêtre)');
}

run().catch((err) => {
  console.error('ÉCHEC — fenetre-hydratation-11-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
