/**
 * Seven RH — retour Betty du 14/09/2026 (Congés & absences, "vue de l'équipe au moment de poser") :
 * le calcul d'absences simultanées existait déjà (le quota, §correctif audit du 23/08/2026 §7.6),
 * seul le CHIFFRE était affiché à la personne qui pose sa demande — jamais qui est concerné.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function run() {
  const { DB, sandbox, openLeaveRequestModal, updateLeaveRequestHints, leaveRepository, getAbsentsForQuota } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;

  const company = DB.getCurrentCompany();
  const [demandeur, collegue1, collegue2, horsPerimetre] = company.employees;
  // Même équipe pour les 3 premiers, un salarié hors périmètre reste sur la sienne d'origine — le
  // quota ne doit jamais le compter, même si sa demande se recoupe dans le temps.
  [demandeur, collegue1, collegue2].forEach(e => { e.equipe = 'Support'; e.service = 'Support client'; });
  company.settings.quotasSimultanes = [{ id: 'q1', nom: 'Support', scope: 'equipe', scopeValue: 'Support', maxSimultane: 2 }];
  DB.saveCurrentCompany(company);

  const cpType = DB.getLeaveTypes().find(t => t.nom === 'Congés payés');
  const creerAbsence = (employeeId) => leaveRepository.create({ employeeId, typeId: cpType.id, dateDebut: '2026-09-20', dateFin: '2026-09-22', commentaire: '' });
  await creerAbsence(collegue1.id);
  await creerAbsence(collegue2.id);

  // ---- Fonction pure : la liste (pas seulement le compte) des collègues déjà absents ----
  const quota = company.settings.quotasSimultanes[0];
  const absents = getAbsentsForQuota(quota, '2026-09-21', demandeur.id);
  assert.strictEqual(absents.length, 2);
  assert.ok(absents.some(e => e.id === collegue1.id) && absents.some(e => e.id === collegue2.id));
  assert.ok(!absents.some(e => e.id === horsPerimetre.id), 'un salarié hors périmètre du quota ne doit jamais apparaître');

  // ---- Aide à la saisie : le nom des collègues déjà absents doit apparaître, pas seulement "quota atteint" ----
  openLeaveRequestModal(null, 'autre');
  sandbox.document.getElementById('f-employeeId').value = demandeur.id;
  sandbox.document.getElementById('f-typeId').value = cpType.id;
  sandbox.document.getElementById('f-dateDebut').value = '2026-09-20';
  sandbox.document.getElementById('f-dateFin').value = '2026-09-22';
  updateLeaveRequestHints();
  const hint = sandbox.document.getElementById('leave-balance-hint').textContent;
  assert.ok(hint.includes('Quota'), 'sanity : le quota doit toujours être signalé');
  assert.ok(hint.includes(collegue1.prenom) && hint.includes(collegue2.prenom), 'le prénom de chaque collègue déjà absent ce jour-là doit apparaître, pas seulement le nombre');

  console.log('OK — conges-vue-equipe-14-09.test.js (quota d\'absences simultanées : la liste nominative des collègues déjà absents, pas seulement le chiffre, jamais un salarié hors périmètre)');
}

run().catch((err) => {
  console.error('ÉCHEC — conges-vue-equipe-14-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
