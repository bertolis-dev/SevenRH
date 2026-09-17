/**
 * Seven RH — suite de l'audit "millimètre par millimètre" (retour Betty du 17/09/2026, point 1
 * étendu à d'autres écrans) : l'écran Calendrier (NAV_ITEMS 'calendrier') ne dépend QUE du module
 * "congés" — une entreprise abonnée uniquement à "congés" peut donc l'atteindre sans jamais avoir
 * souscrit au module "planning" (qui porte le télétravail, voir NAV_ITEMS 'planning' et son
 * commentaire explicite : "le télétravail dépend du module planning [...] même si l'onglet vit dans
 * cet écran fusionné congés"). Or buildCalendarSharedData (app.js) chargeait teleworkRequests sans
 * aucune vérification de module, et aussi bien la grille mensuelle personnelle
 * (getCalendarDayInfo/renderCalendarCell) que le tableau équipe/entreprise
 * (renderAbsenceCalendarRow/renderAbsenceCalendarBoard, légende comprise) affichaient ces demandes de
 * télétravail dès qu'il en existait — même classe de fuite que celle déjà corrigée sur la fiche
 * salarié le même jour. Coupé à la source (teleworkRequests = [] si le module planning n'est pas
 * souscrit) : couvre les deux vues d'un coup, jamais recalculé séparément dans chaque fonction de rendu.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function setupCompanyWithModules(modules) {
  const { DB, sandbox, navigateTo, buildCalendarSharedData } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const company = DB.getCurrentCompany();
  company.abonnement.offre = 'a_la_carte';
  company.abonnement.modules = modules.map(key => ({ key }));
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`;
  const salarie = DB.getEmployees().find(e => e.role === 'salarie');
  company.teleworkRequests.push({
    id: 'test-cal-tt-leak', employeeId: salarie.id, statut: 'Validé', dateDebut: dateStr, dateFin: dateStr,
    workflow: [], etapeIndex: -1, historique: [], dateCreation: now.toISOString(), dateModification: now.toISOString()
  });
  DB.saveCurrentCompany(company);
  return { DB, sandbox, navigateTo, buildCalendarSharedData, salarie, dateStr };
}

function runCoupeALaSourceSansPlanning() {
  const { DB, buildCalendarSharedData } = setupCompanyWithModules(['conges']);
  DB._currentEmployeeId = DB.getEmployees().find(e => e.role === 'rh').id;
  const cells = [];
  const sharedData = buildCalendarSharedData(cells);
  // §note technique : .length plutôt que deepStrictEqual(..., []) — ce tableau est produit par un
  // .filter() exécuté DANS le bac à sable vm (Array différent de celui de ce process Node), et
  // assert.deepStrictEqual distingue les tableaux de deux realms différents même à contenu identique.
  assert.strictEqual(sharedData.teleworkRequests.length, 0, 'sans le module planning, sharedData.teleworkRequests doit être vide, même si une vraie demande de télétravail existe en base');

  console.log('OK — calendrier-teletravail-module-17-09.test.js (buildCalendarSharedData coupe le télétravail à la source sans le module planning)');
}

function runGrilleMensuellePersonnelleSansFuite() {
  const { DB, sandbox, navigateTo } = setupCompanyWithModules(['conges']);
  DB._currentEmployeeId = DB.getEmployees().find(e => e.role === 'salarie').id;
  navigateTo('calendrier', { calendrierVue: 'personnel' });
  const html = sandbox.document.getElementById('view-root').innerHTML;
  assert.ok(!html.includes('Télétravail'), 'sans le module planning, la grille mensuelle personnelle ne doit jamais afficher de case télétravail');

  console.log('OK — calendrier-teletravail-module-17-09.test.js (grille mensuelle personnelle : pas de fuite télétravail)');
}

function runTableauEquipeSansFuiteNiLegende() {
  const { DB, sandbox, navigateTo } = setupCompanyWithModules(['conges']);
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;
  navigateTo('calendrier', { calendrierVue: 'entreprise' });
  const html = sandbox.document.getElementById('view-root').innerHTML;
  assert.ok(!html.includes('Télétravail'), 'sans le module planning, le tableau équipe/entreprise ne doit ni afficher la barre télétravail ni sa légende');

  console.log('OK — calendrier-teletravail-module-17-09.test.js (tableau équipe/entreprise : pas de fuite télétravail, légende comprise)');
}

function runControlePositifAvecPlanning() {
  const { DB, sandbox, navigateTo } = setupCompanyWithModules(['conges', 'planning']);
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;
  navigateTo('calendrier', { calendrierVue: 'entreprise' });
  const html = sandbox.document.getElementById('view-root').innerHTML;
  assert.ok(html.includes('Télétravail'), 'contrôle positif : avec le module planning souscrit, le télétravail doit réapparaître (légende et/ou case) — sinon le test "zéro fuite" ne prouve rien');

  console.log('OK — calendrier-teletravail-module-17-09.test.js (contrôle positif : télétravail visible avec le module planning)');
}

try {
  runCoupeALaSourceSansPlanning();
  runGrilleMensuellePersonnelleSansFuite();
  runTableauEquipeSansFuiteNiLegende();
  runControlePositifAvecPlanning();
} catch (err) {
  console.error('ÉCHEC — calendrier-teletravail-module-17-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
