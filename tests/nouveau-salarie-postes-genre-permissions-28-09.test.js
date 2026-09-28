/**
 * Seven RH — retour Betty du 28/09/2026 :
 *   - "on rentre la civilité donc tu peux mettre des propositions de postes en fonction du genre" :
 *     la liste déroulante "Poste" du formulaire "Nouveau salarié" affiche désormais un libellé
 *     accordé (ex. "Directrice générale" pour Madame) d'après la civilité/le sexe déjà saisis dans
 *     l'onglet Identité — la valeur enregistrée reste toujours la forme neutre du référentiel.
 *   - "n'autorises pas la possibilité de création d'un nouveau salarié si on a pas le droit" :
 *     openEmployeeModal/submitEmployeeForm ne revérifiaient CREER_SALARIE/MODIFIER_SALARIE qu'au
 *     niveau du bouton qui les déclenche (masqué sans le droit), jamais dans la fonction elle-même —
 *     même défense en profondeur que le reste de ce module (contrat, enfants...).
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

function runListeDesPostesAccordeeSelonLaCiviliteDejaSaisie() {
  const { sandbox, openEmployeeModal } = setup();
  openEmployeeModal(null, { civilite: 'Madame' });
  const html = sandbox.document.getElementById('modal-root').innerHTML;

  assert.ok(html.includes('>Directrice générale<'), 'le poste "Directeur·rice général·e" doit s\'afficher accordé au féminin pour Madame');
  assert.ok(!html.includes('>Directeur général<'), 'la forme masculine ne doit pas apparaître quand la civilité est Madame');
  assert.ok(html.includes('value="Directeur·rice général·e"'), 'la VALEUR enregistrée doit rester la forme neutre du référentiel, jamais la forme accordée');

  console.log('OK — nouveau-salarie-postes-genre-permissions-28-09.test.js (liste des postes accordée selon la civilité déjà saisie)');
}

function runListeDesPostesReplieSurLeSexeSiCiviliteNonRenseignee() {
  const { sandbox, openEmployeeModal } = setup();
  openEmployeeModal(null, { sexe: 'Homme' }); // pas de civilité choisie, mais le sexe à l'état civil oui
  const html = sandbox.document.getElementById('modal-root').innerHTML;

  assert.ok(html.includes('>Directeur général<'), 'sans civilité choisie, doit se replier sur le sexe à l\'état civil (Homme -> masculin)');

  console.log('OK — nouveau-salarie-postes-genre-permissions-28-09.test.js (repli sur le sexe si la civilité n\'est pas encore choisie)');
}

function runNePeutJamaisCreerUnSalarieSansCreerSalarie() {
  const { DB, sandbox, employeeRepository, openEmployeeModal } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  DB._currentEmployeeId = salarie.id; // un simple salarié n'a jamais CREER_SALARIE

  openEmployeeModal(null);
  const modalRoot = sandbox.document.getElementById('modal-root');
  assert.strictEqual(modalRoot.innerHTML, '', 'sans le droit de créer un salarié, la modale ne doit jamais s\'ouvrir');

  console.log('OK — nouveau-salarie-postes-genre-permissions-28-09.test.js (création refusée sans CREER_SALARIE, même en appelant directement openEmployeeModal)');
}

function runNePeutJamaisModifierUneFicheSansLeDroit() {
  const { DB, sandbox, employeeRepository, openEmployeeModal } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  const autreSalarie = employeeRepository.getAll().find(e => e.role === 'salarie' && e.id !== salarie.id);
  DB._currentEmployeeId = salarie.id; // simple salarié, ni MODIFIER_SALARIE ni manager de l'autre

  openEmployeeModal(autreSalarie.id);
  const modalRoot = sandbox.document.getElementById('modal-root');
  assert.strictEqual(modalRoot.innerHTML, '', 'sans le droit de modifier cette fiche précise, la modale ne doit jamais s\'ouvrir');

  console.log('OK — nouveau-salarie-postes-genre-permissions-28-09.test.js (modification refusée sans le droit, même en appelant directement openEmployeeModal)');
}

function run() {
  runListeDesPostesAccordeeSelonLaCiviliteDejaSaisie();
  runListeDesPostesReplieSurLeSexeSiCiviliteNonRenseignee();
  runNePeutJamaisCreerUnSalarieSansCreerSalarie();
  runNePeutJamaisModifierUneFicheSansLeDroit();
}

try {
  run();
} catch (err) {
  console.error('ÉCHEC — nouveau-salarie-postes-genre-permissions-28-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
