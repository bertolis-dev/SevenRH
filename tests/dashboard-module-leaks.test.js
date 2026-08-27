/**
 * Seven RH — teste le point 2 (retour QA du 27/08/2026) : "un test qui rend réellement chaque écran,
 * pour chaque rôle et chaque jeu de modules, et qui échoue dès qu'un libellé relevant d'un module non
 * souscrit apparaît". Contrairement à module-gating.test.js (qui ne vérifie QUE les notifications
 * générées), ce fichier rend le VRAI HTML de l'accueil — le tableau de bord n'avait jamais été
 * cloisonné : 7 cartes du bloc "Échéances", 3 indicateurs Direction, une ligne du Centre d'action et
 * les demandes personnelles d'un salarié apparaissaient toutes sans condition de module.
 *
 * Commence par l'accueil, comme demandé — à étendre à d'autres écrans dans un correctif suivant.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

// Libellé EXACT (ou fragment suffisamment spécifique pour ne matcher que cette carte) -> module requis.
const DASHBOARD_LABEL_MODULE_RULES = [
  { label: 'Prochains anniversaires', module: 'rh' },
  { label: 'Fins de contrat à venir', module: 'rh' },
  { label: 'Fins de période d\'essai', module: 'rh' },
  { label: 'Anniversaires d\'ancienneté', module: 'rh' },
  { label: 'Visites médicales à programmer', module: 'rh' },
  { label: 'contrat(s)? arrivant à échéance', module: 'rh', regex: true },
  { label: 'Entretiens professionnels à programmer', module: 'entretiens' },
  { label: 'Contingent annuel d\'heures sup', module: 'remuneration' },
  { label: 'Coût notes de frais', module: 'frais' },
  { label: 'Notes de frais en attente', module: 'frais' },
  { label: 'Coût tickets restaurant', module: 'tickets' },
  { label: 'Tickets restaurant ce mois', module: 'tickets' },
  { label: 'Demandes de congé en attente', module: 'conges' },
  { label: 'Congés pris par type', module: 'conges' },
  { label: 'En télétravail aujourd\'hui', module: 'planning' },
];

function findLeaks(html, activeModule) {
  return DASHBOARD_LABEL_MODULE_RULES.filter(rule => rule.module !== activeModule).filter(rule =>
    rule.regex ? new RegExp(rule.label).test(html) : html.includes(rule.label)
  );
}

async function run() {
  const ALL_MODULE_KEYS = ['conges', 'planning', 'frais', 'tickets', 'rh', 'remuneration', 'entretiens', 'embauche'];
  const ROLES_TO_CHECK = ['manager', 'rh', 'proprietaire'];

  for (const activeModule of ALL_MODULE_KEYS) {
    const { DB, sandbox, navigateTo } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const company = DB.getCurrentCompany();
    company.abonnement.offre = 'a_la_carte';
    company.abonnement.modules = [{ key: activeModule }];
    DB.saveCurrentCompany(company);

    for (const role of ROLES_TO_CHECK) {
      const employee = DB.getEmployees().find(e => e.role === role);
      if (!employee) continue;
      DB._currentEmployeeId = employee.id;
      navigateTo('dashboard');
      const html = sandbox.document.getElementById('view-root').innerHTML;
      const leaks = findLeaks(html, activeModule);
      assert.deepStrictEqual(leaks.map(l => l.label), [],
        `fuite sur l'accueil : avec UNIQUEMENT "${activeModule}" souscrit ("${role}"), le tableau de bord affiche un libellé d'un autre module : ${leaks.map(l => `"${l.label}" (module réel : ${l.module})`).join(', ')}`);
    }
  }

  // ---- Reproduction exacte du cas signalé : un salarié voit ses propres demandes de télétravail/
  //      notes de frais même sans les modules planning/frais (injectées, comme dans la lettre). ----
  {
    const { DB, sandbox, navigateTo } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const company = DB.getCurrentCompany();
    company.abonnement.offre = 'a_la_carte';
    company.abonnement.modules = [{ key: 'conges' }]; // ni planning, ni frais
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    const now = new Date().toISOString();
    company.teleworkRequests.push({
      id: 'test-tt-leak', employeeId: salarie.id, statut: 'En attente', dateDebut: '2026-09-01', dateFin: '2026-09-01',
      workflow: [], etapeIndex: -1, historique: [], dateCreation: now, dateModification: now
    });
    company.expenses.push({
      id: 'test-nf-leak', employeeId: salarie.id, statut: 'En attente', date: '2026-09-01', libelle: 'Taxi test fuite',
      montantTTC: 10, tauxTVA: 20, categorie: 'Transport', workflow: [], etapeIndex: -1, historique: [], dateCreation: now, dateModification: now
    });
    DB.saveCurrentCompany(company);

    DB._currentEmployeeId = salarie.id;
    navigateTo('dashboard');
    const html = sandbox.document.getElementById('view-root').innerHTML;
    assert.ok(!html.includes('Télétravail'), 'un salarié sans le module planning ne doit jamais voir sa propre demande de télétravail sur son accueil');
    assert.ok(!html.includes('Taxi test fuite'), 'un salarié sans le module frais ne doit jamais voir sa propre note de frais sur son accueil');
  }

  console.log('OK — dashboard-module-leaks.test.js (accueil rendu pour 3 rôles × 8 modules, plus la reproduction exacte du cas salarié)');
}

run().catch((err) => {
  console.error('ÉCHEC — dashboard-module-leaks.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
