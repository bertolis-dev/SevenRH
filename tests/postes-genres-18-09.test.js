/**
 * Seven RH — retour Betty du 18/09/2026, point 5 ("postes accordés en genre") : "Commercial·e" au
 * point médian (affiché tel quel partout) devient 3 formes stockées (masculin/féminin/neutre,
 * settings.postes) — employee.poste continue de stocker UNIQUEMENT la forme neutre (jamais changée,
 * jamais une id), l'affichage choisit la forme qui correspond au sexe du salarié (getPosteAccorde).
 * parsePosteGenre() reste un MEILLEUR EFFORT (la grammaire française du genre est irrégulière,
 * "développeur·se" ne se déduit pas comme "commercial·e") : le résultat est toujours modifiable à la
 * main dans Paramètres > Référentiels > Postes. Une reprise persistante (ensurePostesGenresBackfilled)
 * migre une entreprise déjà créée avant ce changement, qui n'avait que l'ancien tableau de chaînes.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function runParsePosteGenreSur7DefautsExacts() {
  const { parsePosteGenre } = loadAppJs();
  const cas = [
    ['Directeur·rice général·e', 'Directeur général', 'Directrice générale'],
    ['Responsable RH', 'Responsable RH', 'Responsable RH'],
    ['Chargé·e RH', 'Chargé RH', 'Chargée RH'],
    ['Comptable', 'Comptable', 'Comptable'],
    ['Commercial·e', 'Commercial', 'Commerciale'],
    ['Développeur·se', 'Développeur', 'Développeuse'],
    ['Technicien·ne support', 'Technicien support', 'Technicienne support']
  ];
  cas.forEach(([neutre, masculinAttendu, femininAttendu]) => {
    const { masculin, feminin } = parsePosteGenre(neutre);
    assert.strictEqual(masculin, masculinAttendu, `masculin de "${neutre}"`);
    assert.strictEqual(feminin, femininAttendu, `féminin de "${neutre}"`);
  });

  console.log('OK — postes-genres-18-09.test.js (parsePosteGenre : les 7 postes par défaut, formes exactes)');
}

async function runDefaultSettingsPostesNouvelleForme() {
  const { DEFAULT_SETTINGS } = loadAppJs();
  assert.strictEqual(DEFAULT_SETTINGS.postes.length, 7);
  DEFAULT_SETTINGS.postes.forEach(p => {
    assert.ok(typeof p === 'object' && 'neutre' in p && 'masculin' in p && 'feminin' in p, 'chaque poste par défaut doit être un objet {neutre, masculin, feminin}, plus une simple chaîne');
  });

  console.log('OK — postes-genres-18-09.test.js (DEFAULT_SETTINGS.postes : nouvelle forme structurée)');
}

async function runGetPosteAccordeChoisitLaBonneForme() {
  const { getPosteAccorde } = loadAppJs();
  const settings = { postes: [{ neutre: 'Commercial·e', masculin: 'Commercial', feminin: 'Commerciale' }] };
  assert.strictEqual(getPosteAccorde({ poste: 'Commercial·e', sexe: 'Homme' }, settings), 'Commercial');
  assert.strictEqual(getPosteAccorde({ poste: 'Commercial·e', sexe: 'Femme' }, settings), 'Commerciale');
  assert.strictEqual(getPosteAccorde({ poste: 'Commercial·e' }, settings), 'Commercial·e', 'sans sexe renseigné, retombe sur la forme neutre, jamais un genre présumé');
  assert.strictEqual(getPosteAccorde({ poste: '' }, settings), '', 'aucun poste renseigné : chaîne vide, jamais une erreur');
  assert.strictEqual(getPosteAccorde({ poste: 'Poste maison jamais catalogué', sexe: 'Femme' }, settings), 'Poste maison jamais catalogué',
    'un intitulé tapé librement, absent du catalogue, doit rester affiché tel quel plutôt que de disparaître');

  console.log('OK — postes-genres-18-09.test.js (getPosteAccorde : bonne forme selon le sexe, jamais de genre présumé, jamais d\'intitulé perdu)');
}

async function runFicheModaleUtiliseEncoreLaFormeNeutrePourLaSaisie() {
  const { DB, sandbox, openEmployeeModal } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;

  openEmployeeModal();
  const html = sandbox.document.getElementById('modal-root').innerHTML;
  // La liste déroulante de saisie propose toujours les formes NEUTRES (au point médian) : seul
  // l'AFFICHAGE ailleurs s'accorde, jamais la valeur choisie/stockée elle-même.
  assert.ok(html.includes('>Commercial·e<'), 'la liste déroulante doit continuer à proposer la forme neutre au point médian, jamais déjà accordée');
  assert.ok(html.includes('value="Commercial·e"'), 'la valeur stockée à la sélection doit rester la forme neutre');

  console.log('OK — postes-genres-18-09.test.js (fiche salarié : la liste de sélection reste sur la forme neutre)');
}

async function runRepriseMigreLancienFormatEtPousseAuServeur() {
  const { ensurePostesGenresBackfilled, sandbox } = loadAppJs();
  const rh = { id: 'rh1', role: 'rh' };
  const company = { id: 'c1', settings: { postes: ['Commercial·e', 'Comptable'] } };
  const pushed = [];
  sandbox.window.SupabaseSync = { pushSettings: async (companyId, settings) => { pushed.push(settings); } };

  await ensurePostesGenresBackfilled(company, rh);

  assert.strictEqual(company.settings.postes.length, 2);
  // JSON.stringify plutôt que deepStrictEqual : company.settings.postes[0] vient d'un contexte vm
  // séparé (voir load-app-js.js), deepStrictEqual échoue sur le prototype même à contenu identique.
  const entree = company.settings.postes[0];
  assert.strictEqual(entree.neutre, 'Commercial·e');
  assert.strictEqual(entree.masculin, 'Commercial');
  assert.strictEqual(entree.feminin, 'Commerciale');
  assert.ok(pushed.length >= 1, 'la reprise doit réellement pousser le nouveau format à Supabase, jamais rester seulement locale');

  console.log('OK — postes-genres-18-09.test.js (reprise : migre l\'ancien tableau de chaînes, pousse réellement à Supabase)');
}

async function runRepriseRienAFaireSiDejaMigre() {
  const { ensurePostesGenresBackfilled, sandbox } = loadAppJs();
  const rh = { id: 'rh1', role: 'rh' };
  const company = { id: 'c1', settings: { postes: [{ neutre: 'Commercial·e', masculin: 'Commercial', feminin: 'Commerciale' }] } };
  sandbox.window.SupabaseSync = { pushSettings: async () => { throw new Error('ne doit jamais être appelé : rien à migrer'); } };

  await ensurePostesGenresBackfilled(company, rh);

  console.log('OK — postes-genres-18-09.test.js (reprise : aucun appel serveur si déjà au nouveau format)');
}

async function runAffichageAccordeSurLaFicheSalarie() {
  const { DB, sandbox, renderEmployeeDetail, employeeRepository } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  employeeRepository.update(salarie.id, { poste: 'Commercial·e', sexe: 'Femme' });

  const html = renderEmployeeDetail(salarie.id);
  assert.ok(html.includes('Commerciale'), 'la fiche d\'une salariée doit afficher la forme féminine accordée, pas le point médian brut');
  assert.ok(!html.includes('Commercial·e'), 'le point médian brut ne doit plus apparaître une fois le sexe renseigné');

  console.log('OK — postes-genres-18-09.test.js (fiche salarié : le poste s\'affiche accordé au sexe)');
}

async function runExportExcelResteSurLaFormeNeutre() {
  // Non-régression : l'export Excel des salariés doit rester réimportable (voir
  // IMPORT_EMPLOYEE_FIELD_ALIASES) — la valeur exportée doit rester la forme neutre du catalogue,
  // jamais la forme accordée (qui ne correspondrait plus à aucune entrée du catalogue à la réimportation).
  const { DB, sandbox, exportEmployeesExcel, employeeRepository } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  employeeRepository.update(salarie.id, { poste: 'Commercial·e', sexe: 'Femme' });

  let capturedXml = null;
  sandbox.downloadExcelXmlFile = (xml) => { capturedXml = xml; };
  exportEmployeesExcel();

  assert.ok(capturedXml && capturedXml.includes('Commercial·e'), 'l\'export doit garder la forme neutre du catalogue, pour rester réimportable');
  assert.ok(!capturedXml.includes('>Commerciale<'), 'l\'export ne doit jamais contenir une forme déjà accordée');

  console.log('OK — postes-genres-18-09.test.js (non-régression : export Excel reste sur la forme neutre, réimportable)');
}

async function runSuppressionDunPosteEncoreUtiliseResteBloquee() {
  const { SETTINGS_LIST_USAGE_CHECK, DB, sandbox, employeeRepository } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  employeeRepository.update(salarie.id, { poste: 'Commercial·e' });

  assert.strictEqual(SETTINGS_LIST_USAGE_CHECK.postes('Commercial·e'), true, 'un poste encore utilisé par au moins un salarié doit être détecté, pour ne jamais le retirer du catalogue sous ses pieds');
  assert.strictEqual(SETTINGS_LIST_USAGE_CHECK.postes('Poste jamais attribué'), false);

  console.log('OK — postes-genres-18-09.test.js (le garde-fou "poste encore utilisé" continue de fonctionner sur la forme neutre)');
}

runParsePosteGenreSur7DefautsExacts()
  .then(runDefaultSettingsPostesNouvelleForme)
  .then(runGetPosteAccordeChoisitLaBonneForme)
  .then(runFicheModaleUtiliseEncoreLaFormeNeutrePourLaSaisie)
  .then(runRepriseMigreLancienFormatEtPousseAuServeur)
  .then(runRepriseRienAFaireSiDejaMigre)
  .then(runAffichageAccordeSurLaFicheSalarie)
  .then(runExportExcelResteSurLaFormeNeutre)
  .then(runSuppressionDunPosteEncoreUtiliseResteBloquee)
  .catch((err) => {
    console.error('ÉCHEC — postes-genres-18-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
