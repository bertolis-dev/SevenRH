/**
 * Seven RH — retour Betty du 14/09/2026 (revue concurrentielle, Planning points 3 et 5) : échange de
 * créneaux entre salariés (propose → un collègue prend → le manager valide, jamais de réaffectation
 * avant validation) et modèles de semaine (snapshot des quarts, réappliqué en un clic).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function run() {
  // ---- Échange de créneau : le quart n'est réaffecté qu'APRÈS validation manager, jamais avant ----
  {
    const { DB, sandbox, shiftRepository, shiftSwapRepository } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const salarieA = DB.getEmployees().find(e => e.role === 'salarie');
    const salarieB = DB.getEmployees().find(e => e.role === 'salarie' && e.id !== salarieA.id) || DB.getEmployees().find(e => e.role === 'manager');
    const shift = shiftRepository.create({ employeeId: salarieA.id, weekday: 'Lun', heureDebut: '09:00', heureFin: '17:00', pauseMinutes: 60 });

    const proposition = shiftSwapRepository.proposer(shift.id, salarieA.id);
    assert.strictEqual(proposition.statut, 'proposé');
    assert.strictEqual(shiftRepository.getById(shift.id).employeeId, salarieA.id, 'proposer un échange ne doit rien réaffecter tout de suite');

    const accepte = shiftSwapRepository.accepter(proposition.id, salarieB.id);
    assert.strictEqual(accepte.statut, 'accepté');
    assert.strictEqual(shiftRepository.getById(shift.id).employeeId, salarieA.id, 'accepter un échange ne doit toujours rien réaffecter avant la validation du manager');

    const valide = shiftSwapRepository.traiter(proposition.id, true);
    assert.strictEqual(valide.statut, 'validé');
    assert.strictEqual(shiftRepository.getById(shift.id).employeeId, salarieB.id, 'la validation du manager doit réaffecter réellement le quart au destinataire');
  }

  // ---- Refus du manager : le quart reste chez le proposant ----
  {
    const { DB, sandbox, shiftRepository, shiftSwapRepository } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const salarieA = DB.getEmployees().find(e => e.role === 'salarie');
    const shift = shiftRepository.create({ employeeId: salarieA.id, weekday: 'Mar', heureDebut: '09:00', heureFin: '17:00', pauseMinutes: 60 });
    const proposition = shiftSwapRepository.proposer(shift.id, salarieA.id);
    shiftSwapRepository.accepter(proposition.id, 'un-autre-id');
    const refuse = shiftSwapRepository.traiter(proposition.id, false);
    assert.strictEqual(refuse.statut, 'refusé');
    assert.strictEqual(shiftRepository.getById(shift.id).employeeId, salarieA.id, 'un échange refusé ne doit jamais réaffecter le quart');
  }

  // ---- Modale du quart : le bouton "Proposer l'échange" n'apparaît que pour le salarié concerné,
  // et jamais deux fois pour le même quart si une proposition est déjà en cours ----
  {
    const { DB, sandbox, shiftRepository, shiftSwapRepository, openShiftModal } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const salarieA = DB.getEmployees().find(e => e.role === 'salarie');
    const manager = DB.getEmployees().find(e => e.role === 'manager');
    const shift = shiftRepository.create({ employeeId: salarieA.id, weekday: 'Mer', heureDebut: '09:00', heureFin: '17:00', pauseMinutes: 60 });

    DB._currentEmployeeId = manager.id;
    openShiftModal(shift);
    assert.ok(!sandbox.document.getElementById('modal-root').innerHTML.includes('btn-proposer-echange-shift'), 'un manager ne doit jamais voir ce bouton sur le quart d\'un autre salarié');

    DB._currentEmployeeId = salarieA.id;
    openShiftModal(shift);
    assert.ok(sandbox.document.getElementById('modal-root').innerHTML.includes('btn-proposer-echange-shift'), 'le salarié concerné doit voir le bouton sur son propre quart');

    shiftSwapRepository.proposer(shift.id, salarieA.id);
    openShiftModal(shiftRepository.getById(shift.id));
    assert.ok(!sandbox.document.getElementById('modal-root').innerHTML.includes('btn-proposer-echange-shift'), 'une proposition déjà en cours ne doit jamais pouvoir être doublée');
  }

  console.log('OK — planning-echange-modeles-14-09.test.js (échange de créneau : jamais de réaffectation avant validation manager, bouton réservé au salarié concerné)');
}

async function runModeles() {
  // ---- Modèle de semaine : snapshot puis application, seuls les salariés du modèle sont remplacés ----
  {
    const { DB, sandbox, shiftRepository, weekTemplateRepository } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const employees = DB.getEmployees().filter(e => !e.archive);
    const [e1, e2] = employees;

    shiftRepository.create({ employeeId: e1.id, weekday: 'Lun', heureDebut: '09:00', heureFin: '17:00', pauseMinutes: 60 });
    const shiftE2AvantModele = shiftRepository.create({ employeeId: e2.id, weekday: 'Lun', heureDebut: '10:00', heureFin: '18:00', pauseMinutes: 60 });

    const template = weekTemplateRepository.enregistrer('Semaine type', shiftRepository.getAll());
    assert.strictEqual(template.shifts.length, 2);

    // On modifie e1 après le snapshot, puis on réapplique le modèle : e1 doit retrouver l'horaire
    // du modèle, e2 (absent d'une modification ultérieure) garde son quart d'origine intact.
    const shiftsE1 = shiftRepository.getAll().filter(s => s.employeeId === e1.id);
    shiftRepository.update(shiftsE1[0].id, { heureDebut: '06:00' });

    weekTemplateRepository.appliquer(template.id);
    const shiftsApres = shiftRepository.getAll();
    const shiftE1Apres = shiftsApres.find(s => s.employeeId === e1.id);
    assert.strictEqual(shiftE1Apres.heureDebut, '09:00', 'appliquer le modèle doit restaurer l\'horaire du modèle, pas la modification faite après le snapshot');
    const shiftE2Apres = shiftsApres.find(s => s.employeeId === e2.id);
    assert.strictEqual(shiftE2Apres.heureDebut, '10:00', 'e2 fait aussi partie du modèle : son quart doit aussi être remplacé par celui du modèle');
    assert.notStrictEqual(shiftE2Apres.id, shiftE2AvantModele.id, 'appliquer un modèle génère de nouveaux quarts, jamais une réutilisation d\'ancien id');
  }

  // ---- Un salarié absent du modèle garde son quart intact ----
  {
    const { DB, sandbox, shiftRepository, weekTemplateRepository } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const employees = DB.getEmployees().filter(e => !e.archive);
    const [e1, e2] = employees;
    shiftRepository.create({ employeeId: e1.id, weekday: 'Lun', heureDebut: '09:00', heureFin: '17:00', pauseMinutes: 60 });
    const template = weekTemplateRepository.enregistrer('Semaine e1 seul', shiftRepository.getAll());

    const shiftE2 = shiftRepository.create({ employeeId: e2.id, weekday: 'Mar', heureDebut: '08:00', heureFin: '16:00', pauseMinutes: 30 });
    weekTemplateRepository.appliquer(template.id);
    assert.ok(shiftRepository.getById(shiftE2.id), 'un salarié absent du modèle appliqué doit garder son quart existant intact');
  }

  console.log('OK — planning-echange-modeles-14-09.test.js (modèle de semaine : snapshot, application ciblée, salariés absents du modèle inchangés)');
}

run().then(runModeles).catch((err) => {
  console.error('ÉCHEC — planning-echange-modeles-14-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
