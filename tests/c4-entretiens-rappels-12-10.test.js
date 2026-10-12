/**
 * Seven RH — brief du 12/10/2026, C4 : rappels automatiques à l'approche de l'entretien professionnel
 * (tous les 2 ans) et du bilan à 6 ans. Constat : rappel unique à 30 jours, et la clôture d'un entretien ne
 * mettait pas à jour la « date du dernier entretien » (champ saisi à la main), donc le rappel restait « en
 * retard » indéfiniment. Aucun test n'existait sur ces échéances. Corrigé : mise à jour automatique à la
 * clôture, bilan réalisé suivi, rappels échelonnés (30 jours, 7 jours, retard).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const decale = (jours, annees = 0) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + jours); d.setFullYear(d.getFullYear() + annees); return d; };

function setup() {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({
    async resolveValidatorEmployeeIdsForStep() { throw new Error('mock : indisponible en test'); }
  }, { get(target, prop) { return prop in target ? target[prop] : async () => ({ success: true }); } });
  api.DB.init();
  const rh = api.DB.getEmployees().find(e => e.role === 'rh');
  api.DB._currentEmployeeId = rh.id;
  return api;
}

function runLEntretienProfessionnelEstDuDeuxAnsApresLeDernier() {
  const api = setup();
  const s = api.DB.getEmployees().find(e => e.role === 'salarie');
  // dernier entretien il y a 2 ans moins 20 jours -> dû dans 20 jours
  api.employeeRepository.update(s.id, { dateEmbauche: '2015-01-01' });
  const dernier = decale(20, -2);
  api.employeeRepository.update(s.id, { dateDernierEntretienProfessionnel: iso(dernier) });
  const liste = api.sandbox.getUpcomingEntretiensProfessionnels(60, undefined, Infinity).filter(x => x.employee.id === s.id);
  assert.strictEqual(liste.length, 1);
  assert.ok(Math.abs(liste[0].daysUntil - 20) <= 1, `échéance à ~20 jours, obtenu ${liste[0].daysUntil}`);

  api.employeeRepository.update(s.id, { dateDernierEntretienProfessionnel: iso(decale(-5, -2)) });
  const enRetard = api.sandbox.getUpcomingEntretiensProfessionnels(60, undefined, Infinity).find(x => x.employee.id === s.id);
  assert.ok(enRetard.daysUntil < 0, 'un entretien manqué apparaît EN RETARD, jamais reporté en silence');
  console.log('OK — c4-entretiens-rappels-12-10.test.js (entretien pro : 2 ans après le dernier, en retard visible)');
}

async function runLaClotureMetAJourLaDateDuDernierEntretien() {
  const api = setup();
  const s = api.DB.getEmployees().find(e => e.role === 'salarie');
  api.employeeRepository.update(s.id, { dateEmbauche: '2015-01-01', dateDernierEntretienProfessionnel: '' });
  const entretien = api.DB.addEntretien({ employeeId: s.id, type: 'professionnel', datePrevue: iso(decale(-1)) });
  api.DB.clotureEntretien(entretien.id);
  const apres = api.employeeRepository.getById(s.id);
  assert.strictEqual(apres.dateDernierEntretienProfessionnel, iso(new Date()), 'la clôture d\'un entretien professionnel met à jour la date du dernier entretien');
  const encore = api.sandbox.getUpcomingEntretiensProfessionnels(60, undefined, Infinity).filter(x => x.employee.id === s.id);
  assert.strictEqual(encore.length, 0, 'plus aucun rappel « en retard » une fois l\'entretien clôturé');
  console.log('OK — c4-entretiens-rappels-12-10.test.js (clôture d\'un entretien : date du dernier entretien mise à jour, rappel levé)');
}

async function runLeBilanSixAnsRealiseDecaleLEcheance() {
  const api = setup();
  const s = api.DB.getEmployees().find(e => e.role === 'salarie');
  // embauché il y a 6 ans moins 10 jours : bilan dû dans 10 jours
  api.employeeRepository.update(s.id, { dateEmbauche: iso(decale(10, -6)), dateDernierBilanSixAns: '' });
  let b = api.sandbox.getUpcomingBilansSixAns(60, undefined, Infinity).find(x => x.employee.id === s.id);
  assert.ok(b && Math.abs(b.daysUntil - 10) <= 1, 'bilan dû dans ~10 jours');
  const entretien = api.DB.addEntretien({ employeeId: s.id, type: 'bilan', datePrevue: iso(new Date()) });
  api.DB.clotureEntretien(entretien.id);
  const apres = api.employeeRepository.getById(s.id);
  assert.strictEqual(apres.dateDernierBilanSixAns, iso(new Date()), 'la clôture d\'un bilan enregistre sa date');
  b = api.sandbox.getUpcomingBilansSixAns(60, undefined, Infinity).find(x => x.employee.id === s.id);
  assert.ok(!b, 'une fois le bilan réalisé, la prochaine échéance est 6 ans plus tard : plus de rappel');
  console.log('OK — c4-entretiens-rappels-12-10.test.js (bilan à 6 ans réalisé : suivi et prochaine échéance repoussée de 6 ans)');
}

async function runLesRappelsSontEchelonnes() {
  const api = setup();
  const s = api.DB.getEmployees().find(e => e.role === 'salarie');
  const reglerDernier = (joursAvantEcheance) => api.employeeRepository.update(s.id, { dateEmbauche: '2015-01-01', dateDernierEntretienProfessionnel: iso(decale(joursAvantEcheance, -2)) });
  const cles = () => api.DB.getNotifications().filter(n => n.sourceKey.startsWith('entretien-pro-' + s.id)).map(n => n.sourceKey);

  reglerDernier(25);
  await api.syncNotifications();
  assert.strictEqual(cles().length, 1, 'à 25 jours : premier rappel');
  assert.ok(!/j7|retard/.test(cles()[0]));

  reglerDernier(6);
  await api.syncNotifications();
  assert.ok(cles().some(k => /-j7$/.test(k)), 'à 6 jours : rappel de dernière semaine');

  reglerDernier(-3);
  await api.syncNotifications();
  assert.ok(cles().some(k => /-retard$/.test(k)), 'échéance dépassée : rappel « en retard »');

  const nombre = cles().length;
  await api.syncNotifications();
  assert.strictEqual(cles().length, nombre, 'un rappel n\'est jamais répété à l\'identique');
  console.log('OK — c4-entretiens-rappels-12-10.test.js (rappels échelonnés : 30 jours, 7 jours, retard ; jamais de doublon)');
}

(async () => {
  try {
    runLEntretienProfessionnelEstDuDeuxAnsApresLeDernier();
    await runLaClotureMetAJourLaDateDuDernierEntretien();
    await runLeBilanSixAnsRealiseDecaleLEcheance();
    await runLesRappelsSontEchelonnes();
  } catch (err) {
    console.error('ÉCHEC — c4-entretiens-rappels-12-10.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  }
})();
