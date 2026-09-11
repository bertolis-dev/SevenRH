/**
 * Seven RH — retour Betty du 11/09/2026 (point 4.1, "arrêts de travail") : le type "Maladie"
 * existait déjà (avec prolongation, §24) mais rien pour le type d'arrêt (maladie ordinaire/accident
 * du travail/accident de trajet/maladie professionnelle), la subrogation, ni l'attestation de
 * salaire — "un prospect nous posera la question dans les 10 premières minutes". Scope volontairement
 * réduit (v1, chiffrage séparé pour la suite) : PAS de calcul d'indemnités journalières/carence, un
 * document préparatoire à compléter avant transmission à la CPAM.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function run() {
  // ---- isArretTravailType : reconnaît "Maladie" et ses variantes par nom, jamais un autre type ----
  {
    const { isArretTravailType } = loadAppJs();
    assert.strictEqual(isArretTravailType({ nom: 'Maladie' }), true);
    assert.strictEqual(isArretTravailType({ nom: 'Maladie professionnelle' }), true);
    assert.strictEqual(isArretTravailType({ nom: 'Congés payés' }), false);
    assert.strictEqual(isArretTravailType(null), false);
  }

  // ---- Formulaire de demande : le bloc type d'arrêt/subrogation est masqué par défaut, affiché
  // seulement pour un type "Maladie", masqué à nouveau si on repasse sur un autre type ----
  {
    const { DB, sandbox, openLeaveRequestModal, updateLeaveRequestHints } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const maladieType = DB.getLeaveTypes().find(t => t.nom === 'Maladie');
    const cpType = DB.getLeaveTypes().find(t => t.nom === 'Congés payés');
    assert.ok(maladieType && cpType, 'sanity : les types de démo Maladie/Congés payés doivent exister');

    openLeaveRequestModal(null, 'autre');
    const arretField = sandbox.document.getElementById('field-arret-travail');
    assert.strictEqual(arretField.style.display, 'none', 'masqué tant qu\'aucun type n\'est choisi');

    sandbox.document.getElementById('f-typeId').value = maladieType.id;
    sandbox.document.getElementById('f-employeeId').value = rh.id;
    updateLeaveRequestHints();
    assert.strictEqual(arretField.style.display, 'grid', 'affiché dès qu\'un type "Maladie" est sélectionné');

    sandbox.document.getElementById('f-typeId').value = cpType.id;
    updateLeaveRequestHints();
    assert.strictEqual(arretField.style.display, 'none', 'masqué à nouveau pour un type sans rapport avec un arrêt');
  }

  // ---- Persistance : leaveRepository.create stocke arretTravail pour un type Maladie, jamais pour
  // un autre type (garde-fou, même si le formulaire ne l'enverrait pas) ----
  {
    const { DB, sandbox, leaveRepository } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const maladieType = DB.getLeaveTypes().find(t => t.nom === 'Maladie');

    const request = await leaveRepository.create({
      employeeId: rh.id, typeId: maladieType.id, dateDebut: '2026-09-15', dateFin: '2026-09-20', nbJours: 4,
      arretTravail: { typeArret: 'accidentTravail', subrogation: true }
    });
    assert.deepStrictEqual(request.arretTravail, { typeArret: 'accidentTravail', subrogation: true });
    const relu = leaveRepository.getById(request.id);
    assert.deepStrictEqual(relu.arretTravail, { typeArret: 'accidentTravail', subrogation: true }, 'doit survivre à une relecture depuis le cache');
  }
}

async function runAll() {
  await run();

  // ---- Bouton "Attestation de salaire" : uniquement sur une demande VALIDÉE portant arretTravail,
  // et uniquement pour qui a PROLONGER_MALADIE (même permission que "Prolonger", RH) ----
  {
    const { DB, sandbox, renderRequestActions, leaveTypeRepository } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const maladieType = leaveTypeRepository.getLeaveTypeById(leaveTypeRepository.getLeaveTypes().find(t => t.nom === 'Maladie').id);

    const requestAvecArret = { id: 'r1', statut: 'Validé', arretTravail: { typeArret: 'maladie', subrogation: false } };
    const htmlAvecArret = renderRequestActions(requestAvecArret, maladieType);
    assert.ok(htmlAvecArret.includes('data-attestation-salaire'), 'RH doit voir le bouton sur une demande d\'arrêt validée');

    const requestSansArret = { id: 'r2', statut: 'Validé', arretTravail: null };
    const htmlSansArret = renderRequestActions(requestSansArret, maladieType);
    assert.ok(!htmlSansArret.includes('data-attestation-salaire'), 'jamais ce bouton sur une demande sans informations d\'arrêt');

    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    DB._currentEmployeeId = salarie.id;
    const htmlSalarie = renderRequestActions(requestAvecArret, maladieType);
    assert.ok(!htmlSalarie.includes('data-attestation-salaire'), 'un salarié (sans PROLONGER_MALADIE) ne doit jamais voir ce bouton');
  }

  // ---- Contenu de l'attestation : jamais un plantage même sans numéro de sécu/salaire renseigné,
  // toujours un avertissement explicite qu'aucun calcul d'IJ n'est fait ----
  {
    const { DB, sandbox, openAttestationSalaireModal, leaveRepository, employeeRepository, TYPE_ARRET_LABELS } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    // Salarié de démo réel (numéro de sécu déjà pré-rempli) — vidé explicitement pour vérifier le
    // cas honnête où l'information manque encore, pas seulement le cas déjà renseigné.
    employeeRepository.update(rh.id, { numeroSecu: '' });
    const maladieType = DB.getLeaveTypes().find(t => t.nom === 'Maladie');

    const request = await leaveRepository.create({
      employeeId: rh.id, typeId: maladieType.id, dateDebut: '2026-09-15', dateFin: '2026-09-20', nbJours: 4,
      arretTravail: { typeArret: 'maladieProfessionnelle', subrogation: true }
    });

    assert.doesNotThrow(() => openAttestationSalaireModal(request.id));
    const html = sandbox.document.getElementById('modal-root').innerHTML;
    assert.ok(html.includes(TYPE_ARRET_LABELS.maladieProfessionnelle), 'le libellé du type d\'arrêt doit apparaître');
    assert.ok(html.includes('Oui'), 'la subrogation doit être indiquée');
    assert.ok(html.includes('N° sécurité sociale non renseigné'), 'un champ manquant doit être signalé explicitement, jamais silencieux/undefined');
    assert.ok(!html.includes('undefined') && !html.includes('NaN'), 'aucune fuite de valeur brute dans le document');
    assert.ok(html.includes('Aucune indemnité n\'est calculée'), 'l\'avertissement "aucun calcul d\'IJ" doit toujours être visible');
  }

  console.log('OK — arrets-travail-11-09.test.js (type d\'arrêt + subrogation à la saisie, attestation de salaire préparatoire, aucun calcul d\'IJ)');
}

runAll().catch((err) => {
  console.error('ÉCHEC — arrets-travail-11-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
