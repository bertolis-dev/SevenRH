/**
 * Seven RH — "Vue groupe" (roadmap différenciation #5, "Chaîne Multi-sociétés", 01/09/2026). Le vrai
 * changement d'architecture multi-tenant est hors de portée d'une session (discuté avec Betty le
 * 01/09/2026) — cette fonctionnalité réutilise à la place le mécanisme de comptes gardés en parallèle
 * déjà existant (façon Gmail, SAVED_ACCOUNTS_KEY) pour une simple consolidation en lecture, sans
 * toucher à la moindre policy RLS. Ce test couvre : le gating d'affichage du bouton, l'agrégation
 * correcte (y compris un compte en échec), et le retour systématique au compte d'origine.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function run() {
  const { DB, sandbox, authRepository, renderUserMenuPanel, runGroupSummaryRefresh, renderGroupSummaryResult } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();

  // ---- Gating : le bouton "Vue groupe" n'apparaît que pour une vision entreprise entière ET 2+ comptes ----
  {
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;

    authRepository.getSavedAccounts = () => [{ id: 'a' }]; // un seul compte
    renderUserMenuPanel();
    let html = sandbox.document.getElementById('user-menu-panel').innerHTML;
    assert.ok(!html.includes('Vue groupe'), 'avec un seul compte enregistré, "Vue groupe" ne doit pas apparaître');

    authRepository.getSavedAccounts = () => [{ id: 'a' }, { id: 'b' }]; // 2 comptes
    renderUserMenuPanel();
    html = sandbox.document.getElementById('user-menu-panel').innerHTML;
    assert.ok(html.includes('Vue groupe'), 'avec 2 comptes enregistrés et une vision entreprise entière (RH), "Vue groupe" doit apparaître');

    const manager = DB.getEmployees().find(e => e.role === 'manager');
    DB._currentEmployeeId = manager.id;
    renderUserMenuPanel();
    html = sandbox.document.getElementById('user-menu-panel').innerHTML;
    assert.ok(!html.includes('Vue groupe'), 'un manager (portée équipe, pas entreprise entière) ne doit jamais voir "Vue groupe", même avec 2 comptes');

    DB._currentEmployeeId = rh.id;
  }

  // ---- Agrégation : bascule sur chaque compte, agrège, gère un échec, revient TOUJOURS à l'origine ----
  {
    sandbox.document.getElementById('modal-root').innerHTML =
      '<button id="btn-refresh-group-summary"></button><div id="group-summary-content"></div>';

    const switchCalls = [];
    authRepository.getCurrentAccountId = () => 'compte-origine';
    authRepository.getSavedAccounts = () => [
      { id: 'compte-a', companyName: 'Entreprise A' },
      { id: 'compte-b', companyName: 'Entreprise B (en échec)' },
      { id: 'compte-origine', companyName: 'Entreprise Origine' }
    ];
    authRepository.switchAccount = async (accountId) => {
      switchCalls.push(accountId);
      if (accountId === 'compte-b') return { success: false, error: 'Session expirée.' };
      return { success: true };
    };

    await runGroupSummaryRefresh();

    assert.deepStrictEqual(switchCalls, ['compte-a', 'compte-b', 'compte-origine', 'compte-origine'],
      'doit basculer sur chaque compte dans l\'ordre, PUIS revenir explicitement sur le compte d\'origine à la fin');

    const contentHtml = sandbox.document.getElementById('group-summary-content').innerHTML;
    assert.ok(contentHtml.includes('Session expirée.'), 'un compte en échec doit afficher son erreur, pas faire planter toute la vue groupe');
    assert.ok(contentHtml.includes('Total groupe'), 'une ligne de total doit être affichée');
  }

  // ---- renderGroupSummaryResult : agrégation numérique correcte, compte en erreur exclu du total ----
  {
    sandbox.document.getElementById('modal-root').innerHTML =
      '<button id="btn-refresh-group-summary"></button><div id="group-summary-content"></div>';
    renderGroupSummaryResult([
      { companyName: 'A', effectifActif: 10, masseSalariale: 25000, congesEnAttente: 2 },
      { companyName: 'B', effectifActif: 5, masseSalariale: null, congesEnAttente: 1 },
      { companyName: 'C (échec)', erreur: 'Compte introuvable.' }
    ]);
    const html = sandbox.document.getElementById('group-summary-content').innerHTML;
    assert.ok(html.includes('15'), 'le total effectif (10+5) doit être calculé en excluant le compte en erreur');
    assert.ok(html.includes('3'), 'le total congés en attente (2+1) doit être calculé');
    assert.ok(html.includes('Compte introuvable.'), 'le message d\'erreur du compte C doit rester visible');
  }

  console.log('OK — vue-groupe.test.js (gating entreprise entière + 2 comptes, agrégation, retour systématique au compte d\'origine)');
}

run().catch((err) => {
  console.error('ÉCHEC — vue-groupe.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
