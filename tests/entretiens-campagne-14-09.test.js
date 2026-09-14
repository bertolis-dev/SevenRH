/**
 * Seven RH — retour Betty du 14/09/2026 (revue concurrentielle, module Entretiens, 9→16) :
 * trames paramétrables (point 1), gestion de campagne (point 2), préparation croisée (point 3),
 * objectifs reconduits (point 4), validation bilatérale (point 5), besoin de formation (point 6).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function activerEntretiens(DB) {
  const company = DB.getCurrentCompany();
  company.abonnement.offre = 'a_la_carte';
  company.abonnement.modules = [{ key: 'entretiens' }];
  DB.saveCurrentCompany(company);
}

async function runPreparationCroisee() {
  // ---- L'auto-évaluation du salarié reste masquée au manager tant qu'il n'a pas soumis SON retour ----
  {
    const { DB, sandbox, entretienRepository, renderEntretienDetail } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    activerEntretiens(DB);
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    const manager = DB.getEmployees().find(e => (e.role === 'manager') && (salarie.managerIds || []).includes(e.id)) || DB.getEmployees().find(e => e.role === 'manager');

    const entretien = entretienRepository.create({ employeeId: salarie.id, type: 'professionnel', datePrevue: '2026-12-01' });
    entretienRepository.submitAutoEvaluation(entretien.id, 'Mon bilan personnel confidentiel');

    DB._currentEmployeeId = manager.id;
    const htmlAvantRetour = renderEntretienDetail(entretien.id);
    assert.ok(!htmlAvantRetour.includes('Mon bilan personnel confidentiel'), 'le manager ne doit jamais voir l\'auto-évaluation avant d\'avoir soumis son propre retour (préparation croisée)');
    assert.ok(htmlAvantRetour.includes('masquée'), 'un message doit expliquer pourquoi c\'est masqué, pas un silence ambigu');

    entretienRepository.submitRetourManager(entretien.id, 'Mon retour manager');
    const htmlApresRetour = renderEntretienDetail(entretien.id);
    assert.ok(htmlApresRetour.includes('Mon bilan personnel confidentiel'), 'une fois le manager a soumis son propre retour, l\'auto-évaluation doit se révéler');

    // Symétrique : le salarié ne doit pas voir le retour manager avant d'avoir soumis SA propre auto-évaluation.
    const entretien2 = entretienRepository.create({ employeeId: salarie.id, type: 'professionnel', datePrevue: '2027-01-01' });
    entretienRepository.submitRetourManager(entretien2.id, 'Retour anticipé du manager');
    DB._currentEmployeeId = salarie.id;
    const htmlSalarieAvant = renderEntretienDetail(entretien2.id);
    assert.ok(!htmlSalarieAvant.includes('Retour anticipé du manager'), 'le salarié ne doit jamais voir le retour manager avant d\'avoir soumis sa propre auto-évaluation');
  }

  console.log('OK — entretiens-campagne-14-09.test.js (préparation croisée : masquage réciproque jusqu\'à double soumission, symétrique dans les deux sens)');
}

async function runObjectifsEtValidation() {
  // ---- Objectifs reconduits : pré-remplis depuis le dernier entretien AVEC objectifs de ce salarié ----
  {
    const { DB, sandbox, entretienRepository, getObjectifsReconduits } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    activerEntretiens(DB);
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    entretienRepository.create({ employeeId: salarie.id, type: 'professionnel', datePrevue: '2025-01-01', objectifs: 'Objectif de l\'an dernier : monter en compétence sur X' });
    entretienRepository.create({ employeeId: salarie.id, type: 'professionnel', datePrevue: '2025-06-01', objectifs: '' });

    assert.strictEqual(getObjectifsReconduits(salarie.id), 'Objectif de l\'an dernier : monter en compétence sur X', 'doit ignorer un entretien plus récent mais SANS objectifs, et reprendre le dernier qui en avait');
    assert.strictEqual(getObjectifsReconduits(''), '', 'sans salarié sélectionné, rien à reconduire');
    const autreSalarie = DB.getEmployees().find(e => e.role === 'manager');
    assert.strictEqual(getObjectifsReconduits(autreSalarie.id), '', 'un salarié sans aucun entretien précédent ne doit rien reconduire');
  }

  // ---- Validation bilatérale : jamais deux fois, commentaire réservé au salarié ----
  {
    const { DB, sandbox, entretienRepository } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    activerEntretiens(DB);
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    const entretien = entretienRepository.create({ employeeId: salarie.id, type: 'professionnel', datePrevue: '2026-12-01' });

    const result = entretienRepository.valider(entretien.id, 'employe', 'Je suis d\'accord avec ce bilan');
    assert.strictEqual(result.success, true);
    assert.strictEqual(entretienRepository.getById(entretien.id).validationEmploye.commentaire, 'Je suis d\'accord avec ce bilan');

    const echecDouble = entretienRepository.valider(entretien.id, 'employe', 'autre commentaire');
    assert.strictEqual(echecDouble.success, false, 'un entretien déjà validé par le salarié ne doit jamais pouvoir être validé une seconde fois');

    const resultManager = entretienRepository.valider(entretien.id, 'manager');
    assert.strictEqual(resultManager.success, true);
    assert.ok(entretienRepository.getById(entretien.id).validationManager.date, 'la validation manager doit être horodatée, sans commentaire (déjà retourManager pour ça)');
  }

  console.log('OK — entretiens-campagne-14-09.test.js (objectifs reconduits pré-remplis, validation bilatérale jamais dupliquée)');
}

async function runTramesEtCampagnes() {
  // ---- Trames : création, liste, suppression ----
  {
    const { DB, sandbox, entretienTrameRepository } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const trame = entretienTrameRepository.creer('Trame managers', 'managers', [{ id: 'q1', label: 'Vos réussites ?' }]);
    assert.strictEqual(entretienTrameRepository.getAll().length, 1);
    entretienTrameRepository.delete(trame.id);
    assert.strictEqual(entretienTrameRepository.getAll().length, 0);
  }

  // ---- Campagne : crée un entretien par salarié de la population, jamais pour les autres ----
  {
    const { DB, sandbox, entretienCampagneRepository, entretienRepository, resolvePopulationEmployeeIds } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    activerEntretiens(DB);
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const managers = resolvePopulationEmployeeIds('managers');
    assert.ok(managers.length > 0, 'sanity : le jeu de démo doit avoir au moins un manager');

    const result = entretienCampagneRepository.lancer('Campagne managers 2026', 'professionnel', '2026-12-31', managers, null);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.entretiens.length, managers.length);
    result.entretiens.forEach(e => assert.strictEqual(e.campagneId, result.campagne.id));

    // Un salarié qui n'est pas manager ne doit avoir aucun entretien créé par cette campagne.
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    assert.ok(!entretienRepository.getForEmployee(salarie.id).some(e => e.campagneId === result.campagne.id), 'un salarié hors population ne doit jamais recevoir un entretien de cette campagne');
  }

  // ---- Lancer une campagne sans aucun salarié concerné doit échouer, jamais silencieusement créer 0 entretien ----
  {
    const { DB, sandbox, entretienCampagneRepository } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const result = entretienCampagneRepository.lancer('Campagne vide', 'professionnel', '2026-12-31', [], null);
    assert.strictEqual(result.success, false);
  }

  console.log('OK — entretiens-campagne-14-09.test.js (trames CRUD, campagne ciblée sur la bonne population, jamais lancée sans salarié concerné)');
}

runPreparationCroisee().then(runObjectifsEtValidation).then(runTramesEtCampagnes).catch((err) => {
  console.error('ÉCHEC — entretiens-campagne-14-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
