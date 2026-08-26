/**
 * Seven RH — teste le point 7.2 (retour QA du 26/08/2026) : le tableau des compteurs doit respecter
 * la même portée de visibilité qu'un manager a déjà ailleurs (getVisibleEmployeeIdsForCurrentUser —
 * son équipe uniquement, jamais toute l'entreprise), rester bloqué pour un salarié et sans le module
 * congés, même pour un RH.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function run() {
  const { DB, sandbox, navigateTo, state, getVisibleEmployeeIdsForCurrentUser } = loadAppJs();
  // navigateTo() déclenche syncNotifications() en tâche de fond (jamais attendu) — sans ce mock,
  // window.SupabaseSync est undefined et une promesse rejetée non gérée fait planter le process
  // Node APRÈS que ce test ait déjà réussi, un faux échec qui n'a rien à voir avec 7.2.
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();

  // Le manager de démo (Nicolas Girard) n'a que Sarah Benali et Léa Dubois dans son équipe.
  const manager = DB.getEmployees().find(e => e.role === 'manager');
  DB._currentEmployeeId = manager.id;
  navigateTo('tableau-compteurs');
  assert.strictEqual(state.view, 'tableau-compteurs', 'un manager doit avoir accès au tableau des compteurs');
  const visibleIds = getVisibleEmployeeIdsForCurrentUser();
  assert.ok(Array.isArray(visibleIds), 'un manager doit avoir une portée restreinte (jamais null = toute l\'entreprise)');
  const team = DB.getEmployees().filter(e => (e.managerIds || []).includes(manager.id)).map(e => e.id);
  assert.deepStrictEqual(new Set(visibleIds), new Set([manager.id, ...team]),
    'la portée du manager doit être lui-même + son équipe directe, ni plus ni moins');

  // RH : aucune restriction de portée (visibilité entreprise entière).
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;
  navigateTo('tableau-compteurs');
  assert.strictEqual(state.view, 'tableau-compteurs', 'un RH doit avoir accès au tableau des compteurs');
  assert.strictEqual(getVisibleEmployeeIdsForCurrentUser(), null, 'un RH doit voir toute l\'entreprise, sans restriction');

  // Salarié : jamais accès, quel que soit le module souscrit.
  const salarie = DB.getEmployees().find(e => e.role === 'salarie');
  DB._currentEmployeeId = salarie.id;
  navigateTo('tableau-compteurs');
  assert.notStrictEqual(state.view, 'tableau-compteurs', 'un salarié ne doit jamais avoir accès au tableau des compteurs');

  // Module congés absent : bloqué pour tout le monde, y compris RH.
  DB._currentEmployeeId = rh.id;
  const company = DB.getCurrentCompany();
  company.abonnement.offre = 'a_la_carte';
  company.abonnement.modules = [{ key: 'planning' }];
  DB.saveCurrentCompany(company);
  navigateTo('tableau-compteurs');
  assert.notStrictEqual(state.view, 'tableau-compteurs', 'sans le module congés, même un RH ne doit pas accéder au tableau des compteurs');

  console.log('OK — tableau-compteurs.test.js (portée manager/RH, blocage salarié, blocage sans module congés)');
}

run().catch((err) => {
  console.error('ÉCHEC — tableau-compteurs.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
