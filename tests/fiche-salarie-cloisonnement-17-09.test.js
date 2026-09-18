/**
 * Seven RH — retour Betty du 17/09/2026, point 1 : après avoir trouvé la carte "Suivi médical" non
 * cloisonnée sur la fiche salarié, elle a demandé d'étendre le même principe de test (déjà appliqué à
 * l'accueil, voir dashboard-module-leaks.test.js) à "d'autres écrans de détail". La fiche salarié
 * (renderEmployeeDetail) est le candidat naturel : c'est justement là que le premier bug a été trouvé,
 * et NAV_ITEMS documente explicitement que "employees" (la liste/fiche de base) reste volontairement
 * SANS module (socle commun), ce qui veut dire que TOUT ce qui, sur cette même fiche, appartient à un
 * module payant précis doit se cloisonner lui-même — rien ne le fait pour lui au niveau de l'écran.
 *
 * En construisant ce test, 4 fuites RÉELLES supplémentaires ont été trouvées par lecture de code (même
 * classe que le Suivi médical, jamais vérifiées avant) et corrigées dans le même correctif :
 *   - la carte "Compteurs de congés" (balances + bouton "Demander un congé") : aucune vérification de
 *     module, alors qu'elle appartient entièrement au module "congés" ;
 *   - le bouton "Demander du télétravail" (même carte) : appartient au module "planning", pas "congés"
 *     (voir le commentaire de NAV_ITEMS sur ce point précis) ;
 *   - "Types d'absences autorisés" (renderTypesAbsenceCard) : appartient au module "congés" ;
 *   - "Documents"/"Documents à générer" (renderEmployeeDocumentsCard/renderGenererDocumentCard) :
 *     LANDING_ALACARTE_MODULES liste "documents" explicitement comme faisant partie du module "rh".
 * Un cinquième correctif, connexe, a été nécessaire : bindEmployeeDetailEvents faisait un
 * .addEventListener SANS garde sur #btn-request-leave/#btn-request-telework, qui n'existent plus dans
 * le DOM une fois ces boutons cloisonnés — plantait toute la liaison d'événements de l'écran entier dès
 * qu'un des deux modules manquait (voir le scénario "aucun crash" ci-dessous).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

// Libellé (ou fragment suffisamment spécifique) -> module requis, même esprit que
// DASHBOARD_LABEL_MODULE_RULES (dashboard-module-leaks.test.js), appliqué ici à la fiche salarié.
const FICHE_LABEL_MODULE_RULES = [
  { label: 'Compteurs de congés', module: 'conges' },
  { label: 'Demander un congé', module: 'conges' },
  { label: 'Demander du télétravail', module: 'planning' },
  { label: 'Types d\'absences autorisés', module: 'conges' },
  { label: '<h2>Documents</h2>', module: 'rh' },
  { label: 'Documents à générer', module: 'rh' },
  { label: 'Notes de frais', module: 'frais' },
  { label: 'Suivi médical', module: 'rh' },
];

function findLeaks(html, activeModule) {
  return FICHE_LABEL_MODULE_RULES.filter(rule => rule.module !== activeModule).filter(rule => html.includes(rule.label));
}

// §retour Betty du 18/09/2026 (point 6) : la fiche salarié est passée de 16 cartes empilées à 6
// onglets (un seul rendu à la fois) — un balayage "toutes les fuites possibles" doit donc regarder
// TOUS les onglets, pas seulement celui affiché par défaut ("Fiche"), sinon une fuite qui ne vivrait
// que sous "Congés et absences"/"Documents"/etc. ne serait plus jamais détectée par ce test.
const ALL_EMPLOYEE_DETAIL_TABS = ['fiche', 'conges', 'frais', 'acces', 'documents', 'parcours'];
function renderAllEmployeeDetailTabsHtml(sandbox, navigateTo, employeeId) {
  return ALL_EMPLOYEE_DETAIL_TABS.map(tab => {
    navigateTo('employee-detail', { currentEmployeeId: employeeId, employeeDetailTab: tab });
    return sandbox.document.getElementById('view-root').innerHTML;
  }).join('\n');
}

async function runBalayageParModule() {
  const ALL_MODULE_KEYS = ['conges', 'planning', 'frais', 'tickets', 'rh', 'remuneration', 'entretiens', 'embauche'];
  const ROLES_TO_CHECK = ['rh', 'proprietaire'];

  for (const activeModule of ALL_MODULE_KEYS) {
    const { DB, sandbox, navigateTo } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const company = DB.getCurrentCompany();
    company.abonnement.offre = 'a_la_carte';
    company.abonnement.modules = [{ key: activeModule }];
    DB.saveCurrentCompany(company);

    for (const role of ROLES_TO_CHECK) {
      const viewer = DB.getEmployees().find(e => e.role === role);
      const target = DB.getEmployees().find(e => e.role === 'salarie') || viewer;
      if (!viewer || !target) continue;
      DB._currentEmployeeId = viewer.id;
      const html = renderAllEmployeeDetailTabsHtml(sandbox, navigateTo, target.id);
      const leaks = findLeaks(html, activeModule);
      assert.deepStrictEqual(leaks.map(l => l.label), [],
        `fuite sur la fiche salarié : avec UNIQUEMENT "${activeModule}" souscrit ("${role}" consultant la fiche d'un salarié), la page affiche un libellé d'un autre module : ${leaks.map(l => `"${l.label}" (module réel : ${l.module})`).join(', ')}`);
    }
  }

  // ---- Contrôle positif : avec TOUS les modules, chaque libellé doit réapparaître — sinon un test
  //      "zéro fuite" qui passe parce que plus rien ne s'affiche jamais ne prouve rien. ----
  {
    const { DB, sandbox, navigateTo, documentTemplateRepository } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const company = DB.getCurrentCompany();
    company.abonnement.offre = 'a_la_carte';
    company.abonnement.modules = ALL_MODULE_KEYS.map(key => ({ key }));
    DB.saveCurrentCompany(company);
    const viewer = DB.getEmployees().find(e => e.role === 'proprietaire');
    const target = DB.getEmployees().find(e => e.role === 'salarie') || viewer;
    DB._currentEmployeeId = viewer.id;
    // §retour Betty du 18/09/2026 (point 9) : "Documents à générer" est maintenant masquée sans
    // aucun modèle configuré (voir renderGenererDocumentCard) — il en faut donc un pour que ce
    // contrôle positif reste probant (sinon son absence ne prouverait plus rien sur le cloisonnement).
    documentTemplateRepository.create({ nom: 'Attestation de travail', corps: 'Test' });
    const html = renderAllEmployeeDetailTabsHtml(sandbox, navigateTo, target.id);
    FICHE_LABEL_MODULE_RULES.forEach(rule => assert.ok(html.includes(rule.label),
      `contrôle positif : avec tous les modules souscrits, "${rule.label}" doit apparaître sur la fiche salarié`));
  }

  console.log('OK — fiche-salarie-cloisonnement-17-09.test.js (fiche salarié rendue pour 2 rôles × 8 modules, plus contrôle positif tous modules)');
}

async function runAucunCrashSiCongesEtPlanningAbsents() {
  const { DB, sandbox, navigateTo } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const company = DB.getCurrentCompany();
  company.abonnement.offre = 'a_la_carte';
  company.abonnement.modules = [{ key: 'rh' }]; // ni congés, ni planning
  DB.saveCurrentCompany(company);
  const viewer = DB.getEmployees().find(e => e.role === 'rh');
  const target = DB.getEmployees().find(e => e.role === 'salarie') || viewer;
  DB._currentEmployeeId = viewer.id;

  // Avant correctif : bindEmployeeDetailEvents plantait ici (TypeError sur .addEventListener d'un
  // élément absent du DOM), navigateTo laissait tout le reste de la liaison d'événements non fait.
  // employeeDetailTab: 'conges' demandé explicitement : si le module manque, l'onglet "Congés et
  // absences" disparaît lui-même (retombe sur le premier onglet visible) — la vérification porte
  // justement sur le fait qu'aucun de ses boutons/contenus ne fuite ailleurs, ni ne plante le binding.
  navigateTo('employee-detail', { currentEmployeeId: target.id, employeeDetailTab: 'conges' });
  const html = sandbox.document.getElementById('view-root').innerHTML;
  assert.ok(!html.includes('Compteurs de congés'));
  assert.ok(!html.includes('id="btn-request-leave"'));
  assert.ok(!html.includes('id="btn-request-telework"'));

  console.log('OK — fiche-salarie-cloisonnement-17-09.test.js (aucun plantage de bindEmployeeDetailEvents sans congés/planning)');
}

async function runTeletravailIndependantDesConges() {
  const { DB, sandbox, navigateTo } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const company = DB.getCurrentCompany();
  company.abonnement.offre = 'a_la_carte';
  company.abonnement.modules = [{ key: 'conges' }]; // congés seul, jamais planning
  DB.saveCurrentCompany(company);
  const viewer = DB.getEmployees().find(e => e.role === 'rh');
  const target = DB.getEmployees().find(e => e.role === 'salarie') || viewer;
  DB._currentEmployeeId = viewer.id;
  navigateTo('employee-detail', { currentEmployeeId: target.id, employeeDetailTab: 'conges' });
  const html = sandbox.document.getElementById('view-root').innerHTML;

  assert.ok(html.includes('Compteurs de congés'), 'le module congés seul doit garder la carte');
  assert.ok(html.includes('id="btn-request-leave"'), 'le bouton congés doit rester présent avec le module congés');
  assert.ok(!html.includes('id="btn-request-telework"'), 'le télétravail dépend du module planning, jamais congés seul');

  console.log('OK — fiche-salarie-cloisonnement-17-09.test.js (télétravail bien indépendant du module congés)');
}

runBalayageParModule()
  .then(runAucunCrashSiCongesEtPlanningAbsents)
  .then(runTeletravailIndependantDesConges)
  .catch((err) => {
    console.error('ÉCHEC — fiche-salarie-cloisonnement-17-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
