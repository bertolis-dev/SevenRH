/**
 * Seven RH — point en attente de la revue du 13/10/2026, traité le 14/10 : l'échange de créneaux ne fonctionnait que pour un
 * compte autorisé à écrire le bloc de l'entreprise (gererParametres). Un salarié ne pouvait ni proposer son quart (la carte
 * n'était pas cliquable) ni en prendre un, et un manager ne pouvait pas valider : le serveur refusait tout en silence. Les trois
 * actions passent maintenant par la fonction serveur echange_shift_action (0072).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAppJs } = require('./load-app-js');

function setup() {
  const api = loadAppJs();
  const appels = [];
  api.sandbox.window.SupabaseSync = new Proxy({}, {
    get: (_, nom) => {
      if (nom === 'echangeShiftAction') return async (...args) => { appels.push(args); return {}; };
      return async () => ({ success: true });
    }
  });
  api.DB.init();
  return { api, appels };
}

async function run() {
  const { api, appels } = setup();
  const { DB, sandbox, shiftRepository, shiftSwapRepository } = api;
  const salaries = DB.getEmployees().filter(e => e.role === 'salarie');
  const [salA, salB] = salaries;
  const manager = DB.getEmployees().find(e => e.role === 'manager');
  const shift = shiftRepository.create({ employeeId: salA.id, weekday: 'Lun', heureDebut: '09:00', heureFin: '17:00', pauseMinutes: 60 });
  appels.length = 0;

  // proposer / accepter / traiter appellent le serveur avec l'identifiant de la demande et l'action
  const proposition = shiftSwapRepository.proposer(shift.id, salA.id);
  assert.deepStrictEqual(appels.pop(), ['proposer', proposition.id, shift.id, undefined]);
  shiftSwapRepository.accepter(proposition.id, salB.id);
  assert.deepStrictEqual(appels.pop(), ['accepter', proposition.id, undefined, undefined]);
  shiftSwapRepository.traiter(proposition.id, true);
  assert.deepStrictEqual(appels.pop(), ['traiter', proposition.id, null, true]);
  assert.strictEqual(shiftRepository.getById(shift.id).employeeId, salB.id, 'quart réaffecté localement après validation');

  const refus = shiftSwapRepository.proposer(shiftRepository.create({ employeeId: salA.id, weekday: 'Mar', heureDebut: '09:00', heureFin: '17:00', pauseMinutes: 60 }).id, salA.id);
  appels.length = 0;
  shiftSwapRepository.accepter(refus.id, salB.id);
  shiftSwapRepository.traiter(refus.id, false);
  assert.deepStrictEqual(appels[1], ['traiter', refus.id, null, false]);

  // plus aucune écriture du bloc entreprise (réservée à gererParametres) pour ces actions
  const blobAvant = [];
  const original = DB._pushCompanyDataBlob;
  DB._pushCompanyDataBlob = function () { blobAvant.push(1); return original.apply(this, arguments); };
  const autre = shiftRepository.create({ employeeId: salA.id, weekday: 'Mer', heureDebut: '09:00', heureFin: '17:00', pauseMinutes: 60 });
  blobAvant.length = 0;
  const p2 = shiftSwapRepository.proposer(autre.id, salA.id);
  shiftSwapRepository.accepter(p2.id, salB.id);
  shiftSwapRepository.traiter(p2.id, true);
  assert.strictEqual(blobAvant.length, 0, 'aucune écriture du bloc entreprise : un salarié ou un manager n\'y a pas droit');
  DB._pushCompanyDataBlob = original;

  // un échec serveur déclenche l'avertissement de synchronisation
  const erreurs = [];
  DB.onSaveError = (m) => erreurs.push(m);
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => { throw new Error('Permission refusée.'); } });
  const quart = shiftRepository.create({ employeeId: salA.id, weekday: 'Jeu', heureDebut: '09:00', heureFin: '17:00', pauseMinutes: 60 });
  shiftSwapRepository.proposer(quart.id, salA.id);
  await new Promise(r => setTimeout(r, 20));
  assert.ok(erreurs.length >= 1, 'le refus du serveur est signalé à l\'utilisateur');

  console.log('OK — echange-creneaux-salarie-14-10.test.js (proposer/accepter/traiter passent par la fonction serveur, sans écrire le bloc entreprise)');
}

async function runUi() {
  const { api } = setup();
  const { DB, sandbox, shiftRepository, shiftSwapRepository } = api;
  const company = DB.getCurrentCompany();
  company.abonnement.offre = 'a_la_carte';
  company.abonnement.modules = [{ key: 'planning' }];
  DB.saveCurrentCompany(company);
  const [salA, salB] = DB.getEmployees().filter(e => e.role === 'salarie');
  const manager = DB.getEmployees().find(e => e.role === 'manager');
  DB.updateEmployee(salA.id, { managerIds: [manager.id] });
  const shift = shiftRepository.create({ employeeId: salA.id, weekday: 'Lun', heureDebut: '09:00', heureFin: '17:00', pauseMinutes: 60 });

  DB._currentEmployeeId = salA.id;
  api.state.planningPostesWeekOffset = 0;
  const html = sandbox.renderPlanningPostes();
  assert.ok(html.includes(`data-proposer-echange="${shift.id}"`), 'le salarié voit le bouton « proposer l\'échange » sur SON quart');
  assert.ok(!html.includes('data-edit-shift'), 'sans ouvrir l\'édition du quart (réservée à qui planifie)');

  DB._currentEmployeeId = salB.id;
  assert.ok(!sandbox.renderPlanningPostes().includes('data-proposer-echange'), 'un collègue ne voit pas ce bouton sur le quart des autres');

  // une fois proposé : plus de bouton, et le collègue peut le prendre
  DB._currentEmployeeId = salA.id;
  const p = shiftSwapRepository.proposer(shift.id, salA.id);
  assert.ok(!sandbox.renderPlanningPostes().includes('data-proposer-echange'), 'une proposition en cours : bouton masqué');
  DB._currentEmployeeId = salB.id;
  assert.ok(sandbox.renderPlanningPostes().includes(`data-accepter-echange="${p.id}"`), 'le collègue peut prendre le créneau');

  // le manager du proposant peut valider, pas un manager étranger à l'équipe
  shiftSwapRepository.accepter(p.id, salB.id);
  DB._currentEmployeeId = manager.id;
  assert.ok(sandbox.renderPlanningPostes().includes(`data-valider-echange="${p.id}"`), 'le manager de l\'équipe voit « Valider »');

  const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.ok(/data-proposer-echange/.test(src) && /querySelectorAll\('\[data-proposer-echange\]'\)/.test(src), 'bouton câblé');
  console.log('OK — echange-creneaux-salarie-14-10.test.js (interface : proposer depuis son quart, prendre, valider par le manager de l\'équipe)');
}

(async () => {
  try { await run(); await runUi(); } catch (err) { console.error('ÉCHEC — echange-creneaux-salarie-14-10.test.js'); console.error(err.stack || err.message); process.exitCode = 1; }
})();
