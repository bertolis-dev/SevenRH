/**
 * Seven RH — bug réel trouvé le 26/08/2026 en testant le point 7.2/6.7 : renderOperationalDashboardBody
 * appelait renderLineChartSVG(ticketsCostTrend) SANS jamais vérifier ticketsCostTrend.length === 0
 * au préalable (contrairement aux 3 autres graphiques de la même fonction, qui font tous cette
 * vérification) — renderLineChartSVG plante sur un tableau vide (coords[coords.length - 1].x avec
 * coords === [], donc coords[-1] === undefined). ticketsCostTrend est vide dès que le module
 * "tickets" n'est pas souscrit (abonnement à la carte) : le tableau de bord de TOUT RH/manager/
 * propriétaire d'une entreprise à la carte sans tickets restaurant plantait donc à chaque connexion
 * — reproduit exactement le signalement "l'accueil n'apparaît pas" (Seven Sept, congés uniquement).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function run() {
  const { DB, sandbox, navigateTo, state } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });

  DB.init();
  const company = DB.getCurrentCompany();
  // Reproduit exactement le profil de Seven Sept : à la carte, uniquement le module congés (donc
  // JAMAIS "tickets" — c'est précisément la condition qui vide ticketsCostTrend).
  company.abonnement.offre = 'a_la_carte';
  company.abonnement.modules = [{ key: 'conges' }];
  DB.saveCurrentCompany(company);

  for (const role of ['rh', 'proprietaire', 'manager', 'comptabilite']) {
    const employee = DB.getEmployees().find(e => e.role === role);
    if (!employee) continue;
    DB._currentEmployeeId = employee.id;
    navigateTo('dashboard');
    const html = sandbox.document.getElementById('view-root').innerHTML;
    assert.ok(!html.includes("Un problème d'affichage est survenu"),
      `le tableau de bord d'un "${role}" plante pour une entreprise sans le module tickets (voir renderOperationalDashboardBody / renderLineChartSVG)`);
    assert.strictEqual(state.view, 'dashboard', `un "${role}" doit rester sur le tableau de bord, pas être redirigé après un plantage`);
  }

  console.log('OK — dashboard-empty-chart.test.js (tableau de bord sans module tickets, tous les rôles concernés)');
}

run().catch((err) => {
  console.error('ÉCHEC — dashboard-empty-chart.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
