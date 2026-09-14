/**
 * Seven RH — retour Betty du 14/09/2026 (Congés, "délégation de validation") : "3 semaines
 * d'absence d'un manager gèle l'équipe" — un manager absent désigne un remplaçant pour une période
 * donnée, qui hérite alors de tout ce que le manager délégant pouvait faire pour SON équipe
 * pendant cette période (validations, mais aussi tout ce qui s'appuie sur isManagerOfEmployee).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function runIsManagerOfEmployee() {
  const { DB, sandbox, employeeRepository, isManagerOfEmployee } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const manager = DB.getEmployees().find(e => e.role === 'manager');
  const salarie = DB.getEmployees().find(e => (e.managerIds || []).includes(manager.id)) || DB.getEmployees().find(e => e.role === 'salarie');
  employeeRepository.update(salarie.id, { managerIds: [manager.id] });
  const remplacant = DB.getEmployees().find(e => e.id !== manager.id && e.id !== salarie.id);

  // ---- Le vrai manager reste manager, avec ou sans délégation active ----
  assert.strictEqual(isManagerOfEmployee(manager.id, salarie.id, '2026-09-14'), true);

  // ---- Sans aucune délégation, personne d'autre n'est manager ----
  assert.strictEqual(isManagerOfEmployee(remplacant.id, salarie.id, '2026-09-14'), false);

  // ---- Délégation active pendant sa fenêtre ----
  employeeRepository.update(manager.id, { delegations: [{ id: 'd1', delegataireId: remplacant.id, dateDebut: '2026-09-10', dateFin: '2026-09-20', dateCreation: new Date().toISOString() }] });
  assert.strictEqual(isManagerOfEmployee(remplacant.id, salarie.id, '2026-09-14'), true, 'le délégataire doit être traité comme manager pendant la fenêtre de délégation');

  // ---- Jamais hors de la fenêtre, avant ou après ----
  assert.strictEqual(isManagerOfEmployee(remplacant.id, salarie.id, '2026-09-09'), false, 'jamais avant le début de la délégation');
  assert.strictEqual(isManagerOfEmployee(remplacant.id, salarie.id, '2026-09-21'), false, 'jamais après la fin de la délégation');

  // ---- Un salarié totalement hors de l'équipe du manager délégant ne devient jamais manager de
  // personne — managerIds vidé explicitement : le jeu de démo a sa propre hiérarchie par défaut
  // (ex. plusieurs fiches rattachées au Propriétaire), sans rapport avec ce que ce test vérifie. ----
  const horsEquipe = DB.getEmployees().find(e => e.id !== manager.id && e.id !== salarie.id && e.id !== remplacant.id);
  employeeRepository.update(horsEquipe.id, { managerIds: [] });
  assert.strictEqual(isManagerOfEmployee(remplacant.id, horsEquipe.id, '2026-09-14'), false);

  console.log('OK — delegation-validation-14-09.test.js (isManagerOfEmployee : délégataire traité comme manager UNIQUEMENT pendant la fenêtre de délégation, jamais en dehors, jamais hors de l\'équipe déléguée)');
}

async function runValidationWorkflow() {
  const { DB, sandbox, employeeRepository, isCurrentWorkflowStepFor } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const manager = DB.getEmployees().find(e => e.role === 'manager');
  const salarie = DB.getEmployees().find(e => e.role === 'salarie');
  employeeRepository.update(salarie.id, { managerIds: [manager.id] });
  const remplacant = DB.getEmployees().find(e => e.id !== manager.id && e.id !== salarie.id);
  employeeRepository.update(remplacant.id, { role: 'manager' });

  const request = { employeeId: salarie.id, workflow: ['manager', 'rh'], etapeIndex: 0, workflowValidatorOverrides: {} };

  // Avant toute délégation : le remplaçant (pourtant manager d'ailleurs) ne peut pas valider CETTE demande.
  assert.strictEqual(isCurrentWorkflowStepFor(request, remplacant, 'absence'), false);

  employeeRepository.update(manager.id, { delegations: [{ id: 'd1', delegataireId: remplacant.id, dateDebut: '2026-09-01', dateFin: '2026-09-30', dateCreation: new Date().toISOString() }] });
  const remplacantAJour = employeeRepository.getById(remplacant.id);
  assert.strictEqual(isCurrentWorkflowStepFor(request, remplacantAJour, 'absence'), true, 'une fois délégué, le remplaçant doit pouvoir valider à l\'étape "manager" de la demande de l\'équipe déléguée');

  console.log('OK — delegation-validation-14-09.test.js (workflow de validation : le délégataire peut agir à l\'étape manager d\'une demande de l\'équipe déléguée, jamais avant la délégation)');
}

async function runEcran() {
  const { DB, sandbox, employeeRepository, renderDelegationCard } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const manager = DB.getEmployees().find(e => e.role === 'manager');
  const salarie = DB.getEmployees().find(e => e.role === 'salarie');

  assert.strictEqual(renderDelegationCard(salarie), '', 'jamais affichée à qui n\'est pas manager (RH/Propriétaire valident via une permission globale, pas via une équipe)');

  const htmlVide = renderDelegationCard(manager);
  assert.ok(htmlVide.includes('Délégation de validation'));
  assert.ok(htmlVide.includes('Aucune délégation en cours'));

  employeeRepository.update(manager.id, { delegations: [{ id: 'd1', delegataireId: salarie.id, dateDebut: '2026-09-01', dateFin: '2026-09-30', dateCreation: new Date().toISOString() }] });
  const managerAJour = employeeRepository.getById(manager.id);
  const html = renderDelegationCard(managerAJour);
  assert.ok(html.includes(salarie.prenom), 'le nom du délégataire doit apparaître');
  assert.ok(html.includes('active'), 'une délégation dont la fenêtre couvre aujourd\'hui doit être signalée comme active');

  console.log('OK — delegation-validation-14-09.test.js (écran : réservé aux managers, jamais affiché vide de sens, délégation active signalée)');
}

runIsManagerOfEmployee()
  .then(runValidationWorkflow)
  .then(runEcran)
  .catch((err) => {
    console.error('ÉCHEC — delegation-validation-14-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
