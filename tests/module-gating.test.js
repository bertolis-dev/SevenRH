/**
 * Seven RH — garde-fou du point A.2 (retour QA du 26/08/2026, proposition E.6) : pour chaque
 * combinaison de modules à la carte, syncNotifications() ne doit produire AUCUNE notification
 * appartenant à un AUTRE module que ceux souscrits — c'est exactement la fuite trouvée ce jour-là
 * (Seven Sept, abonné uniquement à "Congés et Absences", recevait des notifications de visite
 * médicale, anniversaire, etc., toutes des données du module RH jamais souscrit).
 *
 * Principe : une règle par préfixe de sourceKey → module requis (ou aucun, pour les notifications
 * qui ne dépendent d'aucun module — ex. les tickets support, une fonctionnalité de base). Si une
 * notification apparaît alors que son module n'est pas dans l'ensemble souscrit, le test échoue et
 * nomme la notification en cause plutôt que de simplement dire "ça a fui".
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

// Ordre important : 'entretien-pro-' doit être vérifié AVANT 'entretien-' (préfixe plus spécifique),
// sinon un rappel de bilan professionnel (module rh) serait confondu avec un entretien planifié
// (module entretiens) — les deux sourceKeys commencent par "entretien-".
const SOURCE_KEY_MODULE_RULES = [
  { prefix: 'leave-', module: 'conges' },
  { prefix: 'telework-', module: 'planning' },
  { prefix: 'expense-', module: 'frais' },
  { prefix: 'cloture-perte-', module: 'conges' },
  { prefix: 'relance-', module: null }, // dépend de la demande d'origine (leave/telework/expense), déjà couverte par son propre filtre en amont
  { prefix: 'escalade-', module: null },
  { prefix: 'entretien-pro-', module: 'rh' },
  { prefix: 'bilan-six-ans-', module: 'rh' },
  { prefix: 'birthday-', module: 'rh' },
  { prefix: 'seniority-', module: 'rh' },
  { prefix: 'contract-end-', module: 'rh' },
  { prefix: 'probation-end-', module: 'rh' },
  { prefix: 'visite-medicale-', module: 'rh' },
  { prefix: 'document-expiry-', module: 'rh' },
  { prefix: 'entretien-', module: 'entretiens' },
  { prefix: 'ticket-status-', module: null }, // support : fonctionnalité de base, jamais liée à un module à la carte
];

function moduleForSourceKey(sourceKey) {
  const rule = SOURCE_KEY_MODULE_RULES.find(r => sourceKey.startsWith(r.prefix));
  if (!rule) throw new Error(`sourceKey sans règle connue : "${sourceKey}" — ajouter une entrée à SOURCE_KEY_MODULE_RULES`);
  return rule.module;
}

const ALL_MODULE_KEYS = ['conges', 'planning', 'frais', 'tickets', 'rh', 'remuneration', 'entretiens', 'embauche'];

async function runForModuleSet(activeModules) {
  const { DB, sandbox, syncNotifications } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({
    async resolveValidatorEmployeeIdsForStep() { throw new Error('mock : indisponible en test'); },
  }, { get(target, prop) { return prop in target ? target[prop] : async () => ({ success: true }); } });

  DB.init();
  const company = DB.getCurrentCompany();
  company.abonnement.offre = 'a_la_carte';
  company.abonnement.modules = activeModules.map(key => ({ key }));
  DB.saveCurrentCompany(company);

  await syncNotifications();
  return DB.getNotifications().map(n => n.sourceKey);
}

async function run() {
  // Contrôle positif : avec tous les modules, des notifications doivent apparaître — sinon un test
  // "zéro fuite" qui passe parce que rien n'est jamais généré ne prouve rien.
  const allKeys = await runForModuleSet(ALL_MODULE_KEYS);
  assert.ok(allKeys.length > 0, 'contrôle positif : avec tous les modules souscrits, au moins une notification doit être générée (données de démo insuffisantes ou génération cassée ?)');

  for (const activeModule of ALL_MODULE_KEYS) {
    const sourceKeys = await runForModuleSet([activeModule]);
    for (const sourceKey of sourceKeys) {
      const requiredModule = moduleForSourceKey(sourceKey);
      if (requiredModule === null) continue; // notification de base, jamais liée à un module
      assert.strictEqual(requiredModule, activeModule,
        `fuite inter-module : avec UNIQUEMENT "${activeModule}" souscrit, la notification "${sourceKey}" ` +
        `(module réel : "${requiredModule}") n'aurait jamais dû être générée.`);
    }
  }

  // Aucun module souscrit du tout : aucune notification dépendant d'un module ne doit apparaître.
  const noneKeys = await runForModuleSet([]);
  for (const sourceKey of noneKeys) {
    const requiredModule = moduleForSourceKey(sourceKey);
    assert.strictEqual(requiredModule, null,
      `fuite inter-module : sans AUCUN module souscrit, la notification "${sourceKey}" (module réel : "${requiredModule}") n'aurait jamais dû être générée.`);
  }

  console.log(`OK — module-gating.test.js (${ALL_MODULE_KEYS.length} modules testés isolément, aucune fuite inter-module)`);
}

run().catch((err) => {
  console.error('ÉCHEC — module-gating.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
