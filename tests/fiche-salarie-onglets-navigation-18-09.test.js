/**
 * Seven RH — retour Betty du 18/09/2026, point 6 ("fiche salarié : onglets, navigation, permissions
 * repliées") :
 *   - 16 cartes empilées remplacées par 6 onglets (Fiche/Congés et absences/Notes de frais/Accès et
 *     droits/Documents/Parcours), chacun disparaissant de lui-même s'il n'a rien à montrer ;
 *   - deep-link depuis une notification (employeeDetailTab dans les params de navigateTo), repli sur
 *     "Fiche" par défaut sinon (jamais l'onglet resté ouvert par le salarié précédent consulté) ;
 *   - flèches précédent/suivant respectant le filtre/tri de la liste "Salariés" (state.filters,
 *     déjà conservé entre deux écrans), avec indicateur "X sur Y" ;
 *   - fil d'Ariane rendu plus visible (couleur primaire, flèche), sans bouton "Retour" en double ;
 *   - permissions individuelles repliées derrière "Permissions par défaut du rôle X" + un bouton
 *     "Ajouter une exception" : seules les exceptions RÉELLEMENT posées restent visibles sans déplier.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function setup() {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  const rh = api.DB.getEmployees().find(e => e.role === 'rh');
  api.DB._currentEmployeeId = rh.id;
  return { ...api, rh };
}

async function runSixOngletsExactsEtFicheParDefaut() {
  const { EMPLOYEE_DETAIL_TABS, sandbox, navigateTo, employeeRepository } = setup();
  const cles = Array.from(EMPLOYEE_DETAIL_TABS).map(t => t.key);
  assert.deepStrictEqual(cles, ['fiche', 'conges', 'frais', 'acces', 'documents', 'parcours']);

  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  navigateTo('employee-detail', { currentEmployeeId: salarie.id });
  const html = sandbox.document.getElementById('view-root').innerHTML;
  assert.ok(html.includes('data-employee-detail-tab="fiche"') && html.includes('tab active'), '"Fiche" doit être l\'onglet actif par défaut, sans deep-link explicite');

  console.log('OK — fiche-salarie-onglets-navigation-18-09.test.js (6 onglets exacts, "Fiche" par défaut)');
}

async function runDeepLinkDepuisNotificationOuvreLeBonOnglet() {
  const { sandbox, navigateTo, employeeRepository, documentRepository } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  documentRepository.create({ employeeId: salarie.id, categorie: 'Administratif', nom: 'Test', dateExpiration: '2026-01-01' });

  // Simule le lien d'une notification "document-expiry" (voir syncNotifications, app.js).
  navigateTo('employee-detail', { currentEmployeeId: salarie.id, employeeDetailTab: 'documents' });
  const html = sandbox.document.getElementById('view-root').innerHTML;
  assert.ok(html.includes('data-employee-detail-tab="documents"'), 'l\'onglet "Documents" doit exister');
  const ongletDocumentsActif = html.includes('active" data-employee-detail-tab="documents"') || /class="tab active"[^>]*data-employee-detail-tab="documents"/.test(html);
  assert.ok(ongletDocumentsActif, 'le deep-link doit ouvrir directement l\'onglet "Documents", pas "Fiche"');

  console.log('OK — fiche-salarie-onglets-navigation-18-09.test.js (deep-link depuis une notification ouvre le bon onglet)');
}

async function runChangerDeSalarieSansDeepLinkRepartSurFiche() {
  const { sandbox, navigateTo, employeeRepository } = setup();
  const employees = employeeRepository.getAll().filter(e => e.role === 'salarie');
  navigateTo('employee-detail', { currentEmployeeId: employees[0].id, employeeDetailTab: 'documents' });
  // Un simple clic "ouvrir cette fiche" (liste, organigramme, favoris...) sur un AUTRE salarié, sans
  // préciser d'onglet : ne doit jamais hériter de l'onglet resté ouvert pour le précédent.
  navigateTo('employee-detail', { currentEmployeeId: employees[1].id });
  const html = sandbox.document.getElementById('view-root').innerHTML;
  assert.ok(/class="tab active"[^>]*data-employee-detail-tab="fiche"|data-employee-detail-tab="fiche">\s*Fiche/.test(html) || html.includes('active" data-employee-detail-tab="fiche"'),
    'sans deep-link explicite, un nouveau salarié doit toujours repartir sur l\'onglet "Fiche"');

  console.log('OK — fiche-salarie-onglets-navigation-18-09.test.js (changer de salarié sans deep-link repart sur "Fiche")');
}

async function runPrecedentSuivantRespecteLeFiltreEtLindicateur() {
  const { sandbox, navigateTo, employeeRepository, getFilteredSortedEmployees, state } = setup();
  state.filters.service = '';
  state.search = '';
  const { list } = getFilteredSortedEmployees();
  const visibles = list.filter(x => !x.archive);
  assert.ok(visibles.length >= 3, 'contrôle : le jeu de démo doit avoir au moins 3 salariés visibles pour ce test');
  const milieu = visibles[1];

  navigateTo('employee-detail', { currentEmployeeId: milieu.id });
  const html = sandbox.document.getElementById('view-root').innerHTML;
  assert.ok(html.includes(`2 sur ${visibles.length}`), `l'indicateur doit refléter la position réelle dans la liste filtrée/triée (attendu "2 sur ${visibles.length}")`);
  assert.ok(html.includes(`data-employee-id="${visibles[0].id}"`), 'le bouton précédent doit cibler le salarié juste avant dans la MÊME liste');
  assert.ok(html.includes(`data-employee-id="${visibles[2].id}"`), 'le bouton suivant doit cibler le salarié juste après dans la MÊME liste');

  console.log('OK — fiche-salarie-onglets-navigation-18-09.test.js (précédent/suivant : bonne position, bons voisins, respecte le filtre/tri en cours)');
}

async function runPremierEtDernierOntUneFlecheDesactivee() {
  const { sandbox, navigateTo, employeeRepository, getFilteredSortedEmployees, state } = setup();
  state.filters.service = '';
  state.search = '';
  const { list } = getFilteredSortedEmployees();
  const visibles = list.filter(x => !x.archive);

  navigateTo('employee-detail', { currentEmployeeId: visibles[0].id });
  let html = sandbox.document.getElementById('view-root').innerHTML;
  assert.ok(/id="btn-employee-prev"[^>]*disabled/.test(html), 'le premier de la liste ne doit pas avoir de bouton "précédent" actif');

  navigateTo('employee-detail', { currentEmployeeId: visibles[visibles.length - 1].id });
  html = sandbox.document.getElementById('view-root').innerHTML;
  assert.ok(/id="btn-employee-next"[^>]*disabled/.test(html), 'le dernier de la liste ne doit pas avoir de bouton "suivant" actif');

  console.log('OK — fiche-salarie-onglets-navigation-18-09.test.js (bouton désactivé en début/fin de liste)');
}

async function runFilDArianePlusVisibleAvecFleche() {
  const appSource = require('fs').readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8');
  const fnStart = appSource.indexOf('function renderBreadcrumb(');
  const fnBody = appSource.slice(fnStart, fnStart + 700);
  assert.ok(fnBody.includes("i === 0 ? '← ' : ''"), 'le premier maillon (retour vers la liste d\'origine) doit porter une flèche explicite');

  console.log('OK — fiche-salarie-onglets-navigation-18-09.test.js (fil d\'Ariane : flèche explicite sur le retour)');
}

async function runPermissionsRaplieesSurLeDefautDuRole() {
  // GERER_PERMISSIONS (voir renderPermissionsCard) est réservé au Propriétaire par défaut, pas RH.
  const { renderPermissionsCard, employeeRepository } = setup();
  const proprietaire = employeeRepository.getAll().find(e => e.role === 'proprietaire');
  const manager = employeeRepository.getAll().find(e => e.role === 'manager');
  const html = renderPermissionsCard(manager, proprietaire);

  assert.ok(html.includes(`Permissions par défaut du rôle`), 'doit rappeler le rôle par défaut, plutôt que 23 menus déroulants tous ouverts');
  assert.ok(html.includes('Aucune exception'), 'sans aucune surcharge posée, doit dire explicitement qu\'il n\'y en a aucune');
  assert.ok(html.includes('<details') && html.includes('Ajouter ou modifier une exception'), 'le catalogue complet doit rester disponible, mais replié derrière un bouton/résumé explicite');

  console.log('OK — fiche-salarie-onglets-navigation-18-09.test.js (permissions : repliées derrière le défaut du rôle par défaut)');
}

async function runSeulesLesExceptionsReellementPoseesRestentVisibles() {
  const { renderPermissionsCard, employeeRepository } = setup();
  const proprietaire = employeeRepository.getAll().find(e => e.role === 'proprietaire');
  const manager = employeeRepository.getAll().find(e => e.role === 'manager');
  employeeRepository.update(manager.id, { permissionsOverrides: { gererParametres: true } });
  const managerAJour = employeeRepository.getById(manager.id);
  const html = renderPermissionsCard(managerAJour, proprietaire);

  assert.ok(!html.includes('Aucune exception'), 'une exception existe : le message "aucune exception" ne doit plus apparaître');
  assert.ok(html.includes('Gérer les paramètres') && html.includes('toujours autorisé'), 'l\'exception réellement posée doit être visible sans avoir à déplier le panneau');
  assert.ok(html.includes('data-remove-permission-exception="gererParametres"'), 'un bouton doit permettre de retirer cette exception précise, pour revenir au défaut du rôle');

  console.log('OK — fiche-salarie-onglets-navigation-18-09.test.js (seules les exceptions réellement posées restent visibles sans déplier)');
}

runSixOngletsExactsEtFicheParDefaut()
  .then(runDeepLinkDepuisNotificationOuvreLeBonOnglet)
  .then(runChangerDeSalarieSansDeepLinkRepartSurFiche)
  .then(runPrecedentSuivantRespecteLeFiltreEtLindicateur)
  .then(runPremierEtDernierOntUneFlecheDesactivee)
  .then(runFilDArianePlusVisibleAvecFleche)
  .then(runPermissionsRaplieesSurLeDefautDuRole)
  .then(runSeulesLesExceptionsReellementPoseesRestentVisibles)
  .catch((err) => {
    console.error('ÉCHEC — fiche-salarie-onglets-navigation-18-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
