/**
 * Seven RH — retour Betty du 10/09/2026 : nouvel écran "Planning" fusionné avec la grille de quarts
 * récurrents hebdomadaires, inspirée d'une maquette externe envoyée mais avec l'identité visuelle de
 * Nexus (bleu marine + or, jamais la palette/le branding de la référence — confirmé avec Betty via
 * deux questions avant de commencer).
 *
 * §correctif du 10/09/2026 ("il faut que ce soit le service à cet endroit") : le premier jet
 * regroupait les quarts par "Position" (Caisse, Commis...), un concept inventé pour cet écran en
 * s'inspirant de la référence externe. Betty a demandé à utiliser à la place le SERVICE déjà présent
 * sur la fiche salarié — la "Position" a donc été entièrement retirée (plus de gestion dédiée, plus
 * de champ sur le quart). Ce fichier couvre le modèle de données (shifts, seed d'exemples pour une
 * entreprise déjà existante) et le rendu de l'écran (regroupement par service, quarts à combler,
 * budget).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function run() {
  // ---- seedExampleShifts (retour Betty du 10/09/2026 : "il y a plus de planning la [...] sans les
  // salariés qu'il y a sur la photo") : une entreprise réelle sans le moindre quart affichait une
  // grille totalement vide sous l'en-tête (voir renderPlanningPostes) — sème quelques quarts
  // d'exemple avec les VRAIS salariés de l'entreprise, une seule fois, jamais ré-appliqué. ----
  {
    const { seedExampleShifts } = loadAppJs();
    const companySansRien = {
      shifts: [],
      employees: [
        { id: 'e1', prenom: 'Alice', service: 'Vente', archive: false },
        { id: 'e2', prenom: 'Bob', service: 'Vente', archive: false },
        { id: 'e3', prenom: 'Carla', service: 'Vente', archive: true }
      ]
    };
    assert.strictEqual(seedExampleShifts(companySansRien), true, 'doit sémer des quarts d\'exemple');
    assert.ok(companySansRien.shifts.length > 0, 'des quarts d\'exemple doivent être créés');
    assert.ok(companySansRien.shifts.every(s => ['e1', 'e2'].includes(s.employeeId)), 'seuls les salariés réels non archivés doivent être utilisés (jamais un salarié fictif)');
    assert.ok(companySansRien.shifts.every(s => !('positionId' in s)), 'un quart n\'est plus rattaché à une position (retirée, voir service)');
    assert.strictEqual(companySansRien.exampleShiftsSeeded, true);

    // Idempotent : un second appel ne fait plus rien, même après suppression totale des quarts.
    companySansRien.shifts = [];
    assert.strictEqual(seedExampleShifts(companySansRien), false, 'ne doit plus jamais reséminer une fois déjà marqué');
    assert.strictEqual(companySansRien.shifts.length, 0, 'les quarts supprimés par l\'utilisateur ne doivent pas revenir');

    // Sans salarié, ne crée aucun quart mais marque quand même comme fait.
    const companySansSalarie = { shifts: [], employees: [] };
    assert.strictEqual(seedExampleShifts(companySansSalarie), true);
    assert.strictEqual(companySansSalarie.shifts.length, 0);
  }

  // ---- computeShiftHeures ----
  {
    const { computeShiftHeures } = loadAppJs();
    assert.strictEqual(computeShiftHeures({ heureDebut: '09:00', heureFin: '16:00', pauseMinutes: 30 }), 6.5);
    assert.strictEqual(computeShiftHeures({ heureDebut: '16:00', heureFin: '23:00', pauseMinutes: 30 }), 6.5);
    assert.strictEqual(computeShiftHeures({ heureDebut: '09:00', heureFin: '17:00', pauseMinutes: 0 }), 8);
    assert.strictEqual(computeShiftHeures({ heureDebut: '09:00', heureFin: '09:00', pauseMinutes: 30 }), 0, 'jamais négatif');
  }

  // ---- CRUD shifts (via DB) ----
  {
    const { DB, sandbox, shiftRepository } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;

    const shift = shiftRepository.create({ employeeId: rh.id, weekday: 'Lun', heureDebut: '09:00', heureFin: '17:00', pauseMinutes: 30 });
    assert.ok(shift.id);
    assert.ok(shiftRepository.getAll().some(s => s.id === shift.id));

    shiftRepository.update(shift.id, { heureFin: '18:00' });
    assert.strictEqual(shiftRepository.getById(shift.id).heureFin, '18:00');

    shiftRepository.delete(shift.id);
    assert.strictEqual(shiftRepository.getById(shift.id), null);
  }

  // ---- renderPlanningPostes : regroupement par SERVICE, quarts à combler, budget ----
  {
    const { DB, sandbox, renderPlanningPostes, shiftRepository, state } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;

    // Thomas Petit (service "Comptabilité", voir seedEmployees) reçoit un quart ; Nicolas Girard
    // (service "IT") n'en a aucun cette semaine.
    const thomas = DB.getEmployees().find(e => e.nom === 'Petit');
    const nicolas = DB.getEmployees().find(e => e.nom === 'Girard');
    const shift = shiftRepository.create({ employeeId: thomas.id, weekday: 'Lun', heureDebut: '09:00', heureFin: '16:00', pauseMinutes: 30 });

    state.planningVue = 'equipe';
    state.planningPostesFilters.afficherQuartsACombler = true;
    state.planningPostesFilters.afficherBudget = false;

    const html = renderPlanningPostes();
    // §retour Betty du 10/09/2026 ("enlève tous les boutons, fais juste le design du planning") :
    // plus de panneau de filtres ni de barre d'outils — seule la grille reste.
    assert.ok(!html.includes('poste-filters-panel'), 'le panneau de filtres a été retiré');
    assert.ok(html.includes('09:00-16:00'), 'l\'horaire du quart doit être affiché tel quel (avec le zéro initial)');
    assert.ok(html.includes('6,50 h'), 'la durée du quart (9h-16h, 30min de pause) doit être calculée à 6,5h');
    assert.ok(html.includes('data-add-shift'), 'une case vide doit proposer un "+" quand "Afficher les quarts à combler" est actif');

    // §retour Betty du 10/09/2026 ("il faut que ce soit le service à cet endroit") : le bandeau de
    // regroupement (voir renderPlanningPostes) affiche le SERVICE du salarié, jamais une "position".
    assert.ok(html.includes('>Comptabilité <span class="text-muted">(1)'), 'le bandeau de groupe doit afficher le service (Comptabilité), pas une position');
    assert.ok(html.includes('poste-shift-position">Comptabilité'), 'la carte du quart doit aussi afficher le service du salarié, jamais "Caisse"/"Commis"');
    // Nicolas (IT) n'a aucun quart mais doit tout de même apparaître dans son groupe de service —
    // contrairement à l'ancien regroupement par position, qui masquait un groupe sans quart dessus.
    assert.ok(html.includes('>IT <span class="text-muted">(1)'), 'un salarié sans quart doit rester visible, regroupé sous son propre service');
    assert.ok(html.includes(personNameOf(nicolas)), 'Nicolas doit apparaître même sans le moindre quart cette semaine');

    // "Masquer les quarts confirmés" : le quart existant disparaît, remplacé par un "+" si actif.
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

  // ---- §retour Betty du 10/09/2026, dernière clarification : "enlève le bouton poste, j'ai pas
  //      demandé ce bouton [...] les boutons dans Planning équipe et Moi tu enlève pas, mais les
  //      autres" — la grille remplace directement le contenu de Planning (plus de page/entrée de
  //      menu séparée), le bascule Planning équipe/Moi reste, mais plus aucun onglet Semaine/Mois/
  //      Année/Horaires/Astreintes ni de barre d'outils. ----
  {
    const { NAV_ITEMS, renderPlanning, DB, sandbox, shiftRepository, state } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;

    assert.ok(!NAV_ITEMS.some(item => item.key === 'planning-postes'), '"Postes" ne doit plus avoir sa propre entrée de menu (fusionné dans Planning)');

    const employee = DB.getEmployees().find(e => e.id !== rh.id);
    const shift = shiftRepository.create({ employeeId: employee.id, weekday: 'Lun', heureDebut: '09:00', heureFin: '16:00', pauseMinutes: 30 });

    state.planningVue = 'equipe';
    const planningHtml = renderPlanning();
    assert.ok(!planningHtml.includes('data-planning-view'), 'Planning ne doit plus avoir aucun onglet Semaine/Mois/Année/Horaires/Astreintes');
    assert.ok(!planningHtml.includes('class="toolbar'), 'Planning ne doit plus avoir de barre d\'outils (filtre service)');
    assert.ok(planningHtml.includes('data-moi-equipe'), 'le bascule "Planning équipe / Moi" doit rester');
    assert.ok(planningHtml.includes('09:00-16:00'), 'la grille de quarts doit être affichée directement dans Planning');

    // "Moi" doit filtrer la grille au seul utilisateur courant (RH ici, sans quart) — le quart de
    // l'autre salarié ne doit plus apparaître.
    state.planningVue = 'personnel';
    const planningHtmlMoi = renderPlanning();
    assert.ok(!planningHtmlMoi.includes('09:00-16:00'), '"Moi" doit limiter la grille au salarié connecté, pas montrer les quarts des autres');

    shiftRepository.delete(shift.id);
  }

  console.log('OK — planning-postes-10-09.test.js (quarts récurrents, regroupement par service, quarts à combler, budget, fusionné dans Planning sans onglets)');
}

function personNameOf(employee) {
  return `${employee.prenom} ${employee.nom}`;
}

run().catch((err) => {
  console.error('ÉCHEC — planning-postes-10-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
