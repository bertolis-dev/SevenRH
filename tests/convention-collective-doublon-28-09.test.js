/**
 * Seven RH — retour Betty du 28/09/2026 ("pourquoi deux Syntec, je pense que le premier suffit") :
 * la suggestion de convention depuis le SIRET (Paramètres > Entreprise, bindEntrepriseFields)
 * construisait son libellé depuis le titre renvoyé par l'API gouvernementale, qui peut différer de
 * l'intitulé déjà présent dans le catalogue pour le MÊME code IDCC (ex. "Syntec" côté API contre
 * "Bureaux d'études techniques (Syntec)" côté catalogue) — deux chaînes distinctes jamais
 * dédoublonnées par un simple Set, donc deux entrées pour une seule convention réelle.
 */
const assert = require('assert');
const { loadDataJs } = require('./load-data-js');

function runDedoublonneParIdccGardeLeLibelleDuCatalogueEnPremier() {
  const { dedupeConventionsCollectivesParIdcc } = loadDataJs();
  const liste = [
    'Bureaux d\'études techniques (Syntec) (IDCC 1486)',
    'Syntec (IDCC 1486)', // doublon du même IDCC, sous un intitulé plus court
    'Commerce de détail et de gros à prédominance alimentaire (IDCC 2216)',
    'Aucune'
  ];
  const resultat = dedupeConventionsCollectivesParIdcc(liste);
  const syntecEntries = resultat.filter(c => c.includes('IDCC 1486'));
  assert.strictEqual(syntecEntries.length, 1, 'un seul et unique IDCC 1486 doit rester après dédoublonnage');
  assert.strictEqual(syntecEntries[0], 'Bureaux d\'études techniques (Syntec) (IDCC 1486)', 'l\'intitulé du catalogue (arrivé en premier) doit être conservé, pas le doublon plus court');
  assert.strictEqual(resultat.length, 3, 'les entrées non concernées (un autre IDCC, "Aucune") doivent toutes rester');

  console.log('OK — convention-collective-doublon-28-09.test.js (dédoublonnage par IDCC, garde l\'intitulé du catalogue)');
}

function runNeRetireJamaisUneConventionSansIdccReconnaissable() {
  const { dedupeConventionsCollectivesParIdcc } = loadDataJs();
  const liste = ['Convention maison, texte libre', 'Autre convention maison, texte libre'];
  const resultat = dedupeConventionsCollectivesParIdcc(liste);
  assert.strictEqual(resultat.length, 2, 'des conventions personnalisées sans IDCC reconnaissable ne doivent jamais être retirées, même si leur texte se ressemble');

  console.log('OK — convention-collective-doublon-28-09.test.js (jamais de retrait pour une convention personnalisée sans IDCC)');
}

function runGetSettingsAppliqueLeDedoublonnageALaLecture() {
  const { DB, sandbox } = loadDataJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const company = DB.getCurrentCompany();
  company.settings.conventionsCollectives = [
    ...company.settings.conventionsCollectives,
    'Syntec (IDCC 1486)' // doublon simulé, comme aurait pu en laisser un ancien SIRET confirmé
  ];
  DB.saveCurrentCompany(company);

  const settings = DB.getSettings();
  const syntecEntries = settings.conventionsCollectives.filter(c => c.includes('IDCC 1486'));
  assert.strictEqual(syntecEntries.length, 1, 'getSettings() doit renvoyer une liste déjà dédoublonnée, sans jamais avoir à y penser à chaque appelant');

  console.log('OK — convention-collective-doublon-28-09.test.js (getSettings applique le dédoublonnage à la lecture)');
}

function run() {
  runDedoublonneParIdccGardeLeLibelleDuCatalogueEnPremier();
  runNeRetireJamaisUneConventionSansIdccReconnaissable();
  runGetSettingsAppliqueLeDedoublonnageALaLecture();
}

try {
  run();
} catch (err) {
  console.error('ÉCHEC — convention-collective-doublon-28-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
