/**
 * Seven RH — garde-fou du point A.2 (retour QA du 26/08/2026, proposition E.6) : pour chaque
 * combinaison de modules à la carte, syncNotifications() ne doit produire AUCUNE notification
 * appartenant à un AUTRE module que ceux souscrits — c'est exactement la fuite trouvée ce jour-là
 * (Seven Sept, abonné uniquement à "Congés et Absences", recevait des notifications de visite
 * médicale, anniversaire, etc., toutes des données du module RH jamais souscrit).
 *
 * §correctif retour QA du 27/08/2026 (point 2) : moduleForSourceKey ne duplique plus la table en
 * local — "elle est dans ton fichier de test, sous le nom SOURCE_KEY_MODULE_RULES... elle n'existe
 * nulle part dans l'application". Remontée dans app.js (requiredModuleForSourceKey), génération,
 * purge et affichage partagent désormais la même source de vérité, importée ici plutôt que recopiée.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

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

const { requiredModuleForSourceKey } = loadAppJs();

async function run() {
  // Contrôle positif : avec tous les modules, des notifications doivent apparaître — sinon un test
  // "zéro fuite" qui passe parce que rien n'est jamais généré ne prouve rien.
  const allKeys = await runForModuleSet(ALL_MODULE_KEYS);
  assert.ok(allKeys.length > 0, 'contrôle positif : avec tous les modules souscrits, au moins une notification doit être générée (données de démo insuffisantes ou génération cassée ?)');

  for (const activeModule of ALL_MODULE_KEYS) {
    const sourceKeys = await runForModuleSet([activeModule]);
    for (const sourceKey of sourceKeys) {
      const requiredModule = requiredModuleForSourceKey(sourceKey);
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
