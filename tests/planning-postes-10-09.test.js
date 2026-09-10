/**
 * Seven RH — retour Betty du 10/09/2026 : nouvel écran "Planning > Postes" (positions de planning +
 * quarts récurrents hebdomadaires), inspiré d'une maquette externe envoyée mais avec l'identité
 * visuelle de Nexus (bleu marine + or, jamais la palette/le branding de la référence — confirmé avec
 * Betty via deux questions avant de commencer). Couvre le modèle de données (positions/shifts,
 * migration pour une entreprise déjà existante) et le rendu de l'écran (filtres, regroupement,
 * quarts à combler, budget).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function run() {
  // ---- seedPositions / migrateCompanyPositions ----
  {
    const { seedPositions, migrateCompanyPositions } = loadAppJs();
    const positions = seedPositions();
    // JSON.stringify plutôt que deepStrictEqual : positions.map(...) est construit DANS le contexte
    // vm (un autre "realm" JS que ce fichier de test) — deepStrictEqual le jugerait "non
    // référentiellement égal" à un littéral de CE fichier même à contenu strictement identique (même
    // piège déjà documenté dans nominative-validators.test.js/repos-compensateur.test.js).
    assert.strictEqual(JSON.stringify(positions.map(p => p.nom)), JSON.stringify(['Caisse', 'Commis', 'Concierge', 'Assistant-gérant', 'RH', 'Entrepôt']));
    assert.ok(positions.every(p => !('couleur' in p)), 'aucune couleur par position (bleu marine + or conservé, confirmé avec Betty)');

    const companySansPositions = { leaveTypes: [] };
    assert.strictEqual(migrateCompanyPositions(companySansPositions), true, 'une entreprise sans positions doit déclencher le backfill');
    assert.strictEqual(companySansPositions.positions.length, 6);
    assert.strictEqual(companySansPositions.shifts.length, 0);
    assert.strictEqual(migrateCompanyPositions(companySansPositions), false, 'idempotent : un second passage ne doit plus rien changer');
  }

  // ---- computeShiftHeures ----
  {
    const { computeShiftHeures } = loadAppJs();
    assert.strictEqual(computeShiftHeures({ heureDebut: '09:00', heureFin: '16:00', pauseMinutes: 30 }), 6.5);
    assert.strictEqual(computeShiftHeures({ heureDebut: '16:00', heureFin: '23:00', pauseMinutes: 30 }), 6.5);
    assert.strictEqual(computeShiftHeures({ heureDebut: '09:00', heureFin: '17:00', pauseMinutes: 0 }), 8);
    assert.strictEqual(computeShiftHeures({ heureDebut: '09:00', heureFin: '09:00', pauseMinutes: 30 }), 0, 'jamais négatif');
  }

  // ---- CRUD positions/shifts (via DB, cascade de suppression) ----
  {
    const { DB, sandbox, positionRepository, shiftRepository } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;

    const position = positionRepository.create('Test Poste');
    assert.ok(position.id);
    assert.ok(positionRepository.getAll().some(p => p.id === position.id));

    const shift = shiftRepository.create({ employeeId: rh.id, positionId: position.id, weekday: 'Lun', heureDebut: '09:00', heureFin: '17:00', pauseMinutes: 30 });
    assert.ok(shiftRepository.getAll().some(s => s.id === shift.id));

    positionRepository.rename(position.id, 'Test Poste renommé');
    assert.strictEqual(positionRepository.getById(position.id).nom, 'Test Poste renommé');

    positionRepository.delete(position.id);
    assert.strictEqual(positionRepository.getById(position.id), null);
    assert.ok(!shiftRepository.getAll().some(s => s.id === shift.id), 'supprimer une position doit supprimer les quarts qui la référencent (sinon orphelins)');
  }

  // ---- renderPlanningPostes : filtres, regroupement, quarts à combler, budget ----
  {
    const { DB, sandbox, renderPlanningPostes, positionRepository, shiftRepository, state } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;

    const employee = DB.getEmployees().find(e => e.id !== rh.id);
    const caisse = positionRepository.getAll().find(p => p.nom === 'Caisse');
    const commis = positionRepository.getAll().find(p => p.nom === 'Commis');
    const shift = shiftRepository.create({ employeeId: employee.id, positionId: caisse.id, weekday: 'Lun', heureDebut: '09:00', heureFin: '16:00', pauseMinutes: 30 });

    state.planningView = 'postes';
    state.planningPostesFilters.positionIds = null;
    state.planningPostesFilters.grouperParPosition = true;
    state.planningPostesFilters.afficherQuartsACombler = true;
    state.planningPostesFilters.afficherBudget = false;

    const html = renderPlanningPostes();
    // §retour Betty du 10/09/2026 ("enlève tous les boutons, fais juste le design du planning") :
    // plus de panneau de filtres ni de barre d'outils — seule la grille reste, une position sans
    // aucun quart cette semaine (ex. Entrepôt) n'apparaît donc plus nulle part (avant, elle restait
    // visible dans la liste des filtres retirée depuis).
    assert.ok(!html.includes('poste-filters-panel'), 'le panneau de filtres a été retiré');
    assert.ok(!html.includes('Entrepôt'), 'une position sans aucun quart cette semaine ne doit plus apparaître nulle part (plus de liste de filtres)');
    assert.ok(html.includes('09:00-16:00'), 'l\'horaire du quart doit être affiché tel quel (avec le zéro initial)');
    assert.ok(html.includes('6,50 h'), 'la durée du quart (9h-16h, 30min de pause) doit être calculée à 6,5h');
    assert.ok(html.includes('data-add-shift'), 'une case vide doit proposer un "+" quand "Afficher les quarts à combler" est actif');

    // Le bandeau de groupe (voir renderPlanningPostes) a la forme `>Nom <span class="text-muted">(n)`
    // — absent pour Commis, qui n'a aucun quart cette semaine (reste dans la liste des filtres seulement).
    assert.ok(!html.includes('>Commis <span class="text-muted">'), 'Commis ne doit pas apparaître comme bandeau de groupe (aucun quart dessus)');
    assert.ok(html.includes('>Caisse <span class="text-muted">'), 'Caisse doit apparaître comme bandeau de groupe (a un quart cette semaine)');

    // Filtre positions : décocher Caisse doit faire disparaître le quart de la grille.
    state.planningPostesFilters.positionIds = new Set([commis.id]);
    const htmlFiltered = renderPlanningPostes();
    assert.ok(!htmlFiltered.includes('09:00-16:00'), 'un quart dont la position est décochée ne doit plus apparaître dans la grille');

    // "Masquer les quarts confirmés" : le quart existant disparaît, remplacé par un "+" si actif.
    state.planningPostesFilters.positionIds = null;
    state.planningPostesFilters.masquerQuartsConfirmes = true;
    const htmlMasque = renderPlanningPostes();
    assert.ok(!htmlMasque.includes('09:00-16:00'), 'masquer les quarts confirmés doit cacher la carte du quart existant');
    state.planningPostesFilters.masquerQuartsConfirmes = false;

    // Budget : ligne de synthèse visible seulement si l'option est cochée, total = somme des heures.
    const htmlSansBudget = renderPlanningPostes();
    assert.ok(!htmlSansBudget.includes('poste-budget-row'));
    state.planningPostesFilters.afficherBudget = true;
    const htmlAvecBudget = renderPlanningPostes();
    assert.ok(htmlAvecBudget.includes('poste-budget-row'));
    assert.ok(htmlAvecBudget.includes('Budget (heures planifiées)'));

    shiftRepository.delete(shift.id);
  }

  console.log('OK — planning-postes-10-09.test.js (positions/quarts récurrents, filtres, regroupement, quarts à combler, budget)');
}

run().catch((err) => {
  console.error('ÉCHEC — planning-postes-10-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
