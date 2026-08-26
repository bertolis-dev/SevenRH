/**
 * Seven RH — teste le pilote E.2 (retour QA du 26/08/2026) : PARAMETRES_TABS centralise le rendu, le
 * dispatch d'évènements et la visibilité par module d'un onglet de Paramètres en un seul endroit,
 * remplaçant 4 listes dupliquées (bouton desktop, option mobile, content-switch, bindParametresEvents)
 * — c'est exactement leur désynchronisation qui a fait planter bindParametresEvents() le jour même,
 * une fois le rendu déjà corrigé pour ne plus fuiter. Ce test reproduit ce scénario précis : rester
 * sur un onglet qui devient invisible en cours de session ne doit jamais planter render().
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function setModules(DB, keys) {
  const c = DB.getCurrentCompany();
  c.abonnement.offre = keys === null ? 'essai' : 'a_la_carte';
  if (keys !== null) c.abonnement.modules = keys.map(key => ({ key }));
  DB.saveCurrentCompany(c);
}

function viewRootHasCrashFallback(sandbox) {
  return sandbox.document.getElementById('view-root').innerHTML.includes("Un problème d'affichage");
}

async function run() {
  const { sandbox, DB, navigateTo, render, state, PARAMETRES_TABS } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });

  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;

  // Scénario exact du 26/08/2026 : arriver sur un onglet valide, puis perdre le module qui le
  // rendait visible SANS changer d'écran (l'utilisateur reste sur Paramètres) — c'est cette
  // combinaison précise qui faisait planter bindParametresEvents() malgré un content-switch déjà
  // correctement gardé.
  setModules(DB, ['conges']);
  navigateTo('parametres', { parametresTab: 'types-absences' });
  assert.strictEqual(state.parametresTab, 'types-absences', 'pré-condition : l\'onglet doit être accessible avant le retrait du module');
  setModules(DB, ['planning']);
  render();
  assert.strictEqual(state.parametresTab, 'listes', 'l\'onglet devenu invisible doit se replier sur "listes", jamais rester bloqué dessus');
  assert.ok(!viewRootHasCrashFallback(sandbox), 'un onglet devenu invisible en cours de session ne doit jamais faire planter render()');

  // Balayage complet : pour chaque combinaison réaliste de modules, visiter CHAQUE onglet de
  // PARAMETRES_TABS (y compris ceux censés être masqués) ne doit jamais planter, et un onglet masqué
  // doit toujours retomber sur un onglet réellement visible.
  const moduleCombos = [null, [], ['conges'], ['planning'], ['frais'], ['conges', 'planning', 'frais']];
  for (const combo of moduleCombos) {
    setModules(DB, combo);
    for (const tab of PARAMETRES_TABS) {
      navigateTo('parametres', { parametresTab: tab.key });
      assert.ok(!viewRootHasCrashFallback(sandbox),
        `combo=${JSON.stringify(combo)} onglet=${tab.key} : render() a planté (voir le filet de sécurité déclenché)`);
      const landedTab = PARAMETRES_TABS.find(t => t.key === state.parametresTab);
      assert.ok(landedTab && landedTab.isVisible(),
        `combo=${JSON.stringify(combo)} onglet=${tab.key} : retombé sur "${state.parametresTab}", qui n'est pourtant pas visible dans cette configuration`);
    }
  }

  console.log(`OK — parametres-tabs.test.js (${PARAMETRES_TABS.length} onglets × ${moduleCombos.length} combinaisons de modules, aucun plantage)`);
}

run().catch((err) => {
  console.error('ÉCHEC — parametres-tabs.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
