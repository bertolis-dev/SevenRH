/**
 * Seven RH — retour Betty du 14/09/2026 (revue concurrentielle, module Rémunération, 7→16) :
 * historique des salaires (point 1), campagne de révision annuelle (point 2), coût employeur
 * complet (point 5), lien avec les entretiens (point 6). Les points 3 (suivi égalité F/H) et 4
 * (éléments variables) existaient déjà (indexEgaliteProfessionnelle, variablesPaie) — seule leur
 * visibilité a été ajoutée sur l'écran Rémunération, pas retesté ici (déjà couvert ailleurs).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function activerMasseSalariale(settingsRepository) {
  const settings = settingsRepository.getSettings();
  settings.masseSalarialeActivee = true;
  settingsRepository.saveSettings(settings);
}

async function runHistoriqueSalaires() {
  const { DB, sandbox } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const employee = DB.getEmployees().find(e => e.role === 'salarie');
  DB._currentEmployeeId = DB.getEmployees().find(e => e.role === 'proprietaire').id;

  const salaireInitial = employee.salaireBrutMensuel || 0;
  assert.strictEqual((employee.historiqueSalaire || []).length, 0, 'sanity : pas d\'historique au départ');

  const apresPremierChangement = DB.updateEmployee(employee.id, { salaireBrutMensuel: 2800 });
  assert.strictEqual(apresPremierChangement.historiqueSalaire.length, 1, 'un changement de salaire doit être tracé');
  assert.strictEqual(apresPremierChangement.historiqueSalaire[0].ancienMontant, salaireInitial);
  assert.strictEqual(apresPremierChangement.historiqueSalaire[0].nouveauMontant, 2800);

  // Un patch qui redonne EXACTEMENT le même montant ne doit rien ajouter (pas un "changement").
  const memeMontant = DB.updateEmployee(employee.id, { salaireBrutMensuel: 2800 });
  assert.strictEqual(memeMontant.historiqueSalaire.length, 1, 'aucune nouvelle entrée si le montant ne change pas réellement');

  // Une modification qui ne touche pas salaireBrutMensuel ne doit jamais toucher l'historique.
  const autreChamp = DB.updateEmployee(employee.id, { service: 'Autre service' });
  assert.strictEqual(autreChamp.historiqueSalaire.length, 1, 'une modification sans rapport avec le salaire ne doit pas alimenter l\'historique');

  const deuxiemeChangement = DB.updateEmployee(employee.id, { salaireBrutMensuel: 3100 }, 'Augmentation individuelle');
  assert.strictEqual(deuxiemeChangement.historiqueSalaire.length, 2);
  assert.strictEqual(deuxiemeChangement.historiqueSalaire[1].motif, 'Augmentation individuelle');

  console.log('OK — remuneration-revision-14-09.test.js (historique des salaires : tracé à chaque changement réel, jamais sur un patch sans rapport ou sans changement)');
}

async function runCoutEmployeurComplet() {
  const { calculerCoutEmployeurComplet } = loadAppJs();
  assert.strictEqual(calculerCoutEmployeurComplet(3000, 0.42), 4260);
  assert.strictEqual(calculerCoutEmployeurComplet(0, 0.42), 0, 'pas de salaire renseigné = pas de coût employeur à estimer');
  assert.strictEqual(calculerCoutEmployeurComplet(2000, 0), 2000, 'taux nul = coût employeur égal au brut (aucune charge)');

  console.log('OK — remuneration-revision-14-09.test.js (coût employeur complet : brut × (1 + taux de charges), jamais calculé sans salaire renseigné)');
}

async function runCampagneRevision() {
  // ---- Lancer une campagne vide doit échouer, jamais silencieusement créer 0 proposition ----
  {
    const { DB, sandbox, revisionSalarialeRepository } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const result = revisionSalarialeRepository.lancer('Campagne vide', 2026, '2026-12-31', []);
    assert.strictEqual(result.success, false);
  }

  // ---- Cycle complet : proposer, valider, application réelle au salaire + historique ----
  {
    const { DB, sandbox, revisionSalarialeRepository, employeeRepository } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    const salaireDepart = salarie.salaireBrutMensuel || 0;

    const lancement = revisionSalarialeRepository.lancer('Révision annuelle 2026', 2026, '2026-12-31', [salarie.id]);
    assert.strictEqual(lancement.success, true);
    assert.strictEqual(lancement.campagne.propositions.length, 1);
    assert.strictEqual(lancement.campagne.propositions[0].salaireActuel, salaireDepart, 'la proposition fige le salaire de référence au lancement');
    assert.strictEqual(lancement.campagne.propositions[0].statut, 'en_attente');

    // Valider sans avoir d'abord proposé un montant doit échouer.
    const validationSansProposition = revisionSalarialeRepository.valider(lancement.campagne.id, salarie.id);
    assert.strictEqual(validationSansProposition.success, false);

    const proposition = revisionSalarialeRepository.proposer(lancement.campagne.id, salarie.id, salaireDepart + 300, 'Atteinte des objectifs');
    assert.strictEqual(proposition.success, true);
    assert.strictEqual(proposition.campagne.propositions[0].statut, 'proposee');

    // Le salaire du salarié ne doit JAMAIS changer avant la validation.
    assert.strictEqual(employeeRepository.getById(salarie.id).salaireBrutMensuel, salaireDepart, 'une simple proposition n\'applique jamais le nouveau salaire');

    const validation = revisionSalarialeRepository.valider(lancement.campagne.id, salarie.id);
    assert.strictEqual(validation.success, true);
    const salarieMisAJour = employeeRepository.getById(salarie.id);
    assert.strictEqual(salarieMisAJour.salaireBrutMensuel, salaireDepart + 300, 'la validation applique réellement le nouveau salaire');
    assert.strictEqual(salarieMisAJour.historiqueSalaire[salarieMisAJour.historiqueSalaire.length - 1].motif.includes('Révision annuelle 2026'), true, 'l\'historique doit référencer la campagne d\'origine');

    // Plus aucune modification possible une fois validée.
    const reproposer = revisionSalarialeRepository.proposer(lancement.campagne.id, salarie.id, salaireDepart + 500, 'Autre motif');
    assert.strictEqual(reproposer.success, false);
    const revalider = revisionSalarialeRepository.valider(lancement.campagne.id, salarie.id);
    assert.strictEqual(revalider.success, false);
    const refuserApresValidation = revisionSalarialeRepository.refuser(lancement.campagne.id, salarie.id);
    assert.strictEqual(refuserApresValidation.success, false);
  }

  // ---- Refus : le salaire ne change jamais ----
  {
    const { DB, sandbox, revisionSalarialeRepository, employeeRepository } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    const salaireDepart = salarie.salaireBrutMensuel || 0;
    const lancement = revisionSalarialeRepository.lancer('Révision test refus', 2026, '2026-12-31', [salarie.id]);
    revisionSalarialeRepository.proposer(lancement.campagne.id, salarie.id, salaireDepart + 200, 'Test');
    const refus = revisionSalarialeRepository.refuser(lancement.campagne.id, salarie.id, 'Budget insuffisant cette année');
    assert.strictEqual(refus.success, true);
    assert.strictEqual(refus.campagne.propositions[0].statut, 'refusee');
    assert.strictEqual(employeeRepository.getById(salarie.id).salaireBrutMensuel, salaireDepart, 'un refus ne doit jamais toucher au salaire');
  }

  console.log('OK — remuneration-revision-14-09.test.js (campagne de révision : jamais appliquée avant validation, jamais modifiable après, refus sans effet sur le salaire, jamais lancée sans salarié concerné)');
}

async function runEcranRemuneration() {
  const { DB, sandbox, settingsRepository, renderRemuneration, renderRevisionSalarialeCard, revisionSalarialeRepository, entretienRepository } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  activerMasseSalariale(settingsRepository);
  const salarie = DB.getEmployees().find(e => e.role === 'salarie');
  DB.updateEmployee(salarie.id, { salaireBrutMensuel: 2500 });

  const htmlSansCampagne = renderRemuneration();
  assert.ok(htmlSansCampagne.includes('Coût employeur complet'), 'le coût employeur complet doit apparaître dès que la masse salariale est suivie');
  assert.strictEqual(renderRevisionSalarialeCard(), '', 'aucune campagne active = aucune carte affichée');

  // §retour Betty du 14/09/2026 (Rémunération point 6, "lien avec les entretiens") : le dernier
  // entretien du salarié doit apparaître comme repère de contexte sur sa proposition de révision.
  entretienRepository.create({ employeeId: salarie.id, type: 'professionnel', datePrevue: '2026-11-01' });
  const lancement = revisionSalarialeRepository.lancer('Révision annuelle 2026', 2026, '2026-12-31', [salarie.id]);
  const htmlAvecCampagne = renderRevisionSalarialeCard();
  assert.ok(htmlAvecCampagne.includes(salarie.prenom), 'le salarié concerné doit apparaître dans la carte de campagne');
  assert.ok(htmlAvecCampagne.includes('Dernier entretien'), 'le dernier entretien du salarié doit être rappelé au moment de la révision');

  revisionSalarialeRepository.proposer(lancement.campagne.id, salarie.id, 2800, 'Test');
  const htmlApresProposition = renderRevisionSalarialeCard();
  assert.ok(htmlApresProposition.includes('Valider') && htmlApresProposition.includes('Refuser'), 'une fois proposée, la révision doit pouvoir être validée ou refusée');

  console.log('OK — remuneration-revision-14-09.test.js (écran Rémunération : coût employeur visible, campagne affichée avec repère entretien, actions selon le statut)');
}

runHistoriqueSalaires()
  .then(runCoutEmployeurComplet)
  .then(runCampagneRevision)
  .then(runEcranRemuneration)
  .catch((err) => {
    console.error('ÉCHEC — remuneration-revision-14-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
