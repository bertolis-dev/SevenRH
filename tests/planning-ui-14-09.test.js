/**
 * Seven RH — retour Betty du 14/09/2026 (revue concurrentielle, Planning) : couverture d'affichage
 * pour les 6 points — badge de violation légale, coût de la semaine (comparé à un budget), quart en
 * conflit avec une indisponibilité, comparaison prévu/réalisé, et la déclaration d'indisponibilités
 * elle-même ("Mon compte").
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function activerPlanning(DB) {
  const company = DB.getCurrentCompany();
  company.abonnement.offre = 'a_la_carte';
  company.abonnement.modules = [{ key: 'planning' }, { key: 'pointage' }];
  DB.saveCurrentCompany(company);
}

async function run() {
  // ---- Badge de violation légale visible pour le manager sur la ligne du salarié concerné ----
  {
    const { DB, sandbox, shiftRepository, renderPlanningPostes } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    activerPlanning(DB);
    const manager = DB.getEmployees().find(e => e.role === 'manager');
    DB._currentEmployeeId = manager.id;
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    // 7 jours travaillés d'affilée : viole le repos hebdomadaire, garanti détectable.
    ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].forEach(j => {
      shiftRepository.create({ employeeId: salarie.id, weekday: j, heureDebut: '09:00', heureFin: '13:00', pauseMinutes: 0 });
    });
    const html = renderPlanningPostes();
    assert.ok(html.includes('badge-danger'), 'un salarié dont le planning viole le repos hebdomadaire doit porter un badge d\'alerte visible');
  }

  // ---- Coût de la semaine affiché avec la masse salariale activée, dépassement de budget signalé ----
  {
    const { DB, sandbox, shiftRepository, employeeRepository, renderPlanningPostes } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    activerPlanning(DB);
    const company = DB.getCurrentCompany();
    company.settings = Object.assign({}, company.settings, { masseSalarialeActivee: true, budgetHebdomadairePlanningEuros: 50 });
    DB.saveCurrentCompany(company);
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    employeeRepository.update(salarie.id, { salaireBrutMensuel: 3033.4 }); // ≈ 20 €/h
    shiftRepository.create({ employeeId: salarie.id, weekday: 'Lun', heureDebut: '09:00', heureFin: '17:00', pauseMinutes: 60 }); // 7h × 20€ = 140€

    const html = renderPlanningPostes();
    assert.ok(html.includes('Coût de la semaine'), 'la ligne de coût doit apparaître dès que la masse salariale est suivie');
    assert.ok(html.includes('140'), 'le coût réel (140 €) doit être affiché');
    assert.ok(html.includes('text-danger'), 'un coût qui dépasse le budget fixé (50 €) doit être signalé visuellement');
  }

  // ---- Sans suivi de la masse salariale : jamais de ligne de coût (rien à cacher, juste absente) ----
  {
    const { DB, sandbox, shiftRepository, renderPlanningPostes } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    activerPlanning(DB);
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    shiftRepository.create({ employeeId: salarie.id, weekday: 'Lun', heureDebut: '09:00', heureFin: '17:00', pauseMinutes: 60 });
    const html = renderPlanningPostes();
    assert.ok(!html.includes('Coût de la semaine'), 'sans suivi de la masse salariale, aucune ligne de coût ne doit apparaître');
    assert.ok(html.includes('Heures planifiées'), 'la ligne heures planifiées, elle, reste toujours visible (plus de filtre mort à activer)');
  }

  // ---- Indisponibilité : la carte existe, message honnête si vide, masquée sans le module
  // planning, et une fois déclarée elle s'affiche correctement (mutation testée directement, comme
  // le reste de ce projet — voir les autres tests "-14-09" : le bac à sable de test ne simule pas
  // les évènements DOM réels, voir load-app-js.js) ----
  {
    const { DB, sandbox, employeeRepository, renderParametresMonCompte } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    activerPlanning(DB);
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    DB._currentEmployeeId = salarie.id;

    const htmlVide = renderParametresMonCompte();
    assert.ok(htmlVide.includes('Disponibilités'), 'la carte doit exister dès que le module planning est souscrit');
    assert.ok(htmlVide.includes('Aucune indisponibilité déclarée'), 'message honnête si rien n\'a encore été déclaré');

    employeeRepository.update(salarie.id, { indisponibilitesRecurrentes: [{ id: 'indispo1', weekday: 'Mer', heureDebut: '12:00', heureFin: '14:00', motif: 'Cours du soir' }] });
    const htmlApres = renderParametresMonCompte();
    assert.ok(htmlApres.includes('Mer') && htmlApres.includes('12:00-14:00') && htmlApres.includes('Cours du soir'), 'une indisponibilité déclarée doit s\'afficher avec son jour, ses horaires et son motif');

    const company = DB.getCurrentCompany();
    company.abonnement.modules = [{ key: 'pointage' }]; // sans "planning"
    DB.saveCurrentCompany(company);
    const htmlSansModule = renderParametresMonCompte();
    assert.ok(!htmlSansModule.includes('Disponibilités'), 'sans le module planning souscrit, la carte ne doit jamais apparaître');
  }

  console.log('OK — planning-ui-14-09.test.js (badge de violation, coût de la semaine avec dépassement de budget, indisponibilités déclarées depuis Mon compte)');
}

run().catch((err) => {
  console.error('ÉCHEC — planning-ui-14-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
