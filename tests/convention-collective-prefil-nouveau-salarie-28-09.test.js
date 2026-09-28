/**
 * Seven RH — retour Betty du 28/09/2026 ("dans nouveau salarié dans contrat & poste la convention
 * est liée à l'entreprise, pas aux salariés. mise à jour automatique à faire pour la création du
 * salarié en fonction de l'entreprise") : la convention de l'entreprise (Paramètres > Entreprise)
 * remontait déjà en tête des suggestions d'un salarié, mais ne préremplissait jamais le champ à la
 * création — chaque nouvelle fiche repartait vide, à ressaisir à la main à chaque fois.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function setup() {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  const rh = api.DB.getEmployees().find(e => e.role === 'rh');
  api.DB._currentEmployeeId = rh.id;
  return api;
}

function runNouveauSalariePrerempliDepuisLaConventionDeLentreprise() {
  const { DB, sandbox, companyRepository, openEmployeeModal } = setup();
  const profile = companyRepository.getProfile();
  companyRepository.saveProfile({ ...profile, conventionCollective: 'Bureaux d\'études techniques (Syntec) (IDCC 1486)' });

  openEmployeeModal(null); // pas d'id : création d'un NOUVEAU salarié
  const html = sandbox.document.getElementById('modal-root').innerHTML;

  assert.ok(html.includes('id="f-conventionCollective" name="conventionCollective" value="Bureaux d&#39;études techniques (Syntec) (IDCC 1486)"'), 'le champ convention collective doit être prérempli avec celle de l\'entreprise dès l\'ouverture');

  console.log('OK — convention-collective-prefil-nouveau-salarie-28-09.test.js (nouveau salarié prérempli depuis la convention de l\'entreprise)');
}

function runNeForceJamaisSiLentrepriseNaAucuneConventionRenseignee() {
  const { sandbox, companyRepository, openEmployeeModal } = setup();
  const profile = companyRepository.getProfile();
  companyRepository.saveProfile({ ...profile, conventionCollective: '' });

  openEmployeeModal(null);
  const html = sandbox.document.getElementById('modal-root').innerHTML;
  assert.ok(html.includes('id="f-conventionCollective" name="conventionCollective" value=""'), 'sans convention renseignée côté entreprise, le champ doit rester vide, jamais une valeur inventée');

  console.log('OK — convention-collective-prefil-nouveau-salarie-28-09.test.js (jamais forcé si l\'entreprise n\'a aucune convention renseignée)');
}

function run() {
  runNouveauSalariePrerempliDepuisLaConventionDeLentreprise();
  runNeForceJamaisSiLentrepriseNaAucuneConventionRenseignee();
}

try {
  run();
} catch (err) {
  console.error('ÉCHEC — convention-collective-prefil-nouveau-salarie-28-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
