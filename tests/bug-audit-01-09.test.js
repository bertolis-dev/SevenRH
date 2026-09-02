/**
 * Seven RH — 5 audits parallèles demandés par Betty le 01/09/2026 ("CHERCHE LES BUGS" puis "cherche
 * vraiment tous les bugs") sur l'ensemble du code (pas seulement la refonte visuelle en cours). Ce
 * fichier verrouille les correctifs qui se prêtent à un test automatisé :
 *
 * - Éligibilité par ancienneté (isLeaveTypeEligibleForEmployee) recalculait "à la main" avec
 *   new Date(employee.dateEmbauche), qui parse une date "AAAA-MM-JJ" en minuit UTC — décalage
 *   silencieux d'quelques heures pour toute entreprise dans un fuseau différent (DOM-TOM), jamais la
 *   même convention que calculateAncienneteYears (le reste du fichier). Doit maintenant DÉLÉGUER à
 *   calculateAncienneteYears, jamais recalculer indépendamment.
 * - Palette de commandes "Ajouter un salarié" : CREER_SALARIE seul ne suffisait pas à garantir que
 *   l'écran Salariés est réellement atteignable (VOIR_SALARIES ou VOIR_EQUIPE requis séparément).
 * - Vue groupe : 2 comptes gardés en parallèle pointant vers LA MÊME entreprise (companyId partagé)
 *   ne doivent jamais compter deux fois son effectif dans le total.
 * - Vue groupe : une deuxième actualisation ne doit jamais démarrer tant qu'une première tourne
 *   encore (le bouton seul ne protège pas contre une modale fermée puis rouverte).
 *
 * Les 2 autres correctifs de cette même série (fuite de state.pendingAttachmentFile entre modales
 * fermées sans envoi ; absence de garde-fou anti-double-clic sur congés/télétravail/notes de frais)
 * dépendent d'interactions DOM (submit/click) que ce harnais vm ne peut pas déclencher
 * (addEventListener y est un no-op, voir load-app-js.js) — vérifiés en direct dans le navigateur.
 */
const assert = require('assert');
const { loadDataJs } = require('./load-data-js');
const { loadAppJs } = require('./load-app-js');

async function run() {
  // ---- data.js : isLeaveTypeEligibleForEmployee doit DÉLÉGUER à calculateAncienneteYears, jamais recalculer seul ----
  {
    const { isLeaveTypeEligibleForEmployee, sandbox } = loadDataJs();
    const employee = { dateEmbauche: '2015-01-01' }; // peu importe la vraie date : on monkeypatch le calcul
    const originalFn = sandbox.calculateAncienneteYears;
    try {
      sandbox.calculateAncienneteYears = () => 7; // valeur arbitraire, jamais 7 par coïncidence via un vrai calcul sur 2015-01-01 à la date du test
      const typeAtteint = { regles: [{ critere: 'anciennete', operateur: '>=', valeur: 6 }] };
      const typeNonAtteint = { regles: [{ critere: 'anciennete', operateur: '>=', valeur: 8 }] };
      assert.strictEqual(isLeaveTypeEligibleForEmployee(employee, typeAtteint, []), true,
        'doit refléter la valeur de calculateAncienneteYears (7 >= 6), preuve que le calcul est bien délégué et non recalculé indépendamment');
      assert.strictEqual(isLeaveTypeEligibleForEmployee(employee, typeNonAtteint, []), false,
        'doit refléter la valeur de calculateAncienneteYears (7 < 8) — si ce test passe alors que la fonction recalculait indépendamment (bug d\'origine), c\'est une coïncidence, pas une preuve ; combiné au test précédent (7 pile entre 6 et 8), la délégation est confirmée');
    } finally {
      sandbox.calculateAncienneteYears = originalFn;
    }
  }

  // ---- app.js : palette de commandes "Ajouter un salarié" exige CREER_SALARIE ET (VOIR_SALARIES ou VOIR_EQUIPE) ----
  {
    const { DB, sandbox, performGlobalSearch, PERMISSIONS } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();

    // Salarié ordinaire avec CREER_SALARIE accordé individuellement, mais SANS VOIR_SALARIES ni
    // VOIR_EQUIPE (jamais accordés par défaut à ce rôle) — reproduit exactement le scénario confirmé
    // par l'audit : ne peut pas ouvrir l'écran Salariés, mais aurait pu créer un salarié via la
    // palette avant ce correctif.
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    salarie.permissionsOverrides = { [PERMISSIONS.CREER_SALARIE]: true };
    DB._currentEmployeeId = salarie.id;

    const results = performGlobalSearch('salarié');
    assert.ok(!results.some(r => r.label === 'Ajouter un salarié'),
      'CREER_SALARIE seul (sans VOIR_SALARIES ni VOIR_EQUIPE) ne doit jamais suffire à faire apparaître cette commande — l\'écran Salariés resterait de toute façon inaccessible à cet utilisateur');

    // Un RH a normalement les deux : la commande doit rester accessible pour qui peut vraiment l'utiliser.
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const resultsRh = performGlobalSearch('salarié');
    assert.ok(resultsRh.some(r => r.label === 'Ajouter un salarié'),
      'un RH (VOIR_SALARIES + CREER_SALARIE via son rôle) doit toujours voir cette commande — le correctif ne doit pas être devenu trop restrictif');
  }

  // ---- app.js : Vue groupe ne compte jamais deux fois la même entreprise (companyId partagé) ----
  {
    const { DB, sandbox, authRepository, runGroupSummaryRefresh, renderGroupSummaryResult } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    sandbox.document.getElementById('modal-root').innerHTML =
      '<button id="btn-refresh-group-summary"></button><div id="group-summary-content"></div>';

    authRepository.getCurrentAccountId = () => 'compte-origine';
    authRepository.getSavedAccounts = () => [
      { id: 'compte-a', companyName: 'Seven Sept (compte RH)', companyId: 'company-1' },
      { id: 'compte-b', companyName: 'Seven Sept (compte Direction)', companyId: 'company-1' }, // même entreprise !
      { id: 'compte-origine', companyName: 'Autre Entreprise', companyId: 'company-2' }
    ];
    const switchCalls = [];
    authRepository.switchAccount = async (accountId) => { switchCalls.push(accountId); return { success: true }; };

    await runGroupSummaryRefresh();

    // Ne doit basculer QUE sur le premier des deux comptes "company-1", jamais les deux, puis le
    // compte d'origine — jamais 4 bascules pour 3 comptes gardés en parallèle.
    assert.deepStrictEqual(switchCalls, ['compte-a', 'compte-origine', 'compte-origine'],
      'ne doit jamais re-basculer sur un deuxième compte déjà compté pour la même entreprise (companyId partagé)');

    const contentHtml = sandbox.document.getElementById('group-summary-content').innerHTML;
    assert.ok(contentHtml.includes('déjà compté ci-dessus'), 'le compte exclu doit rester visible avec une explication, jamais juste disparaître silencieusement');
  }

  // ---- app.js : Vue groupe refuse une deuxième actualisation tant que la première n'est pas terminée ----
  {
    const { DB, sandbox, authRepository, runGroupSummaryRefresh } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    sandbox.document.getElementById('modal-root').innerHTML =
      '<button id="btn-refresh-group-summary"></button><div id="group-summary-content"></div>';

    authRepository.getCurrentAccountId = () => 'compte-origine';
    authRepository.getSavedAccounts = () => [{ id: 'compte-a', companyName: 'A', companyId: 'company-1' }, { id: 'compte-origine', companyName: 'Origine', companyId: 'company-2' }];
    let resolveFirstSwitch;
    let switchCallCount = 0;
    authRepository.switchAccount = async () => {
      switchCallCount++;
      if (switchCallCount === 1) return new Promise(res => { resolveFirstSwitch = () => res({ success: true }); });
      return { success: true };
    };

    const toastCalls = [];
    sandbox.showToast = (msg, type) => toastCalls.push({ msg, type });

    const firstRun = runGroupSummaryRefresh(); // jamais attendu tout de suite : reste bloqué sur le premier switchAccount
    await Promise.resolve(); // laisse la micro-tâche démarrer jusqu'au premier await
    await runGroupSummaryRefresh(); // deuxième appel PENDANT que le premier tourne encore

    assert.strictEqual(switchCallCount, 1, 'la deuxième actualisation ne doit déclencher AUCUNE bascule de compte tant que la première n\'est pas terminée');
    assert.ok(toastCalls.some(t => t.type === 'error' && /déjà en cours/.test(t.msg)), 'doit prévenir explicitement l\'utilisateur plutôt que de laisser la deuxième actualisation démarrer silencieusement en parallèle');

    resolveFirstSwitch();
    await firstRun;
  }

  console.log('OK — bug-audit-01-09.test.js (ancienneté déléguée, garde-fou palette de commandes, Vue groupe sans doublon d\'entreprise ni actualisations concurrentes)');
}

run().catch((err) => {
  console.error('ÉCHEC — bug-audit-01-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
