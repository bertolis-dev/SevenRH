/**
 * Seven RH — teste le "vestige" signalé dans l'audit du 23/08/2026 (section 1, point d'attention) :
 * "La purge à la déconnexion fait que DB.init() re-sème l'entreprise de démonstration au chargement
 * suivant [...] ce vestige mériterait d'être retiré." Avant ce correctif, _purgeLocalCompanyCache()
 * (déconnexion, connexion refusée) vidait ROOT_KEY, et le PROCHAIN DB.init() le reconstruisait avec
 * une fausse entreprise de démonstration — comme si c'était un tout premier lancement. Corrigé via
 * HAS_RUN_BEFORE_KEY (data.js), jamais effacée par la purge.
 */
const assert = require('assert');
const { loadDataJs } = require('./load-data-js');

function run() {
  const { DB, CURRENT_COMPANY_KEY } = loadDataJs();

  // ---- Tout premier lancement : réensemencement normal (comportement historique préservé) ----
  DB.init();
  const firstCompanies = DB.getCompanies();
  assert.strictEqual(firstCompanies.length, 1, 'un tout premier lancement doit toujours semer une entreprise de démonstration');
  const demoCompanyId = firstCompanies[0].id;

  // ---- Purge (comme à la déconnexion) puis un DEUXIÈME DB.init() : ne doit PLUS re-semer ----
  DB._purgeLocalCompanyCache();
  assert.strictEqual(DB.getCompanies().length, 0, 'sanity : la purge doit bien vider le cache local');
  DB.init();
  assert.strictEqual(DB.getCompanies().length, 0,
    'après une purge (déconnexion), DB.init() ne doit JAMAIS re-semer une fausse entreprise de démonstration — restoreSession() est seul responsable de reconstruire le cache avec de vraies données');

  // ---- Une TROISIÈME purge + init : toujours aucun réensemencement (pas seulement la première fois) ----
  DB._purgeLocalCompanyCache();
  DB.init();
  assert.strictEqual(DB.getCompanies().length, 0, 'le non-réensemencement doit tenir à chaque purge suivante, pas seulement la première');

  console.log('OK — init-no-reseed-after-purge.test.js (premier lancement normal, jamais de re-seed après une purge/déconnexion)');
}

try {
  run();
} catch (err) {
  console.error('ÉCHEC — init-no-reseed-after-purge.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
