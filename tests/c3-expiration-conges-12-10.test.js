/**
 * Seven RH — brief du 12/10/2026, C3 : espace salarié, solde de congés avec la DATE D'EXPIRATION et rappel
 * avant la perte de jours. Constat : le solde n'indiquait la perte qu'APRÈS coup (« report perdu ») ; la seule
 * notification (60 jours avant la clôture) avait un délai fixe, sans test. Corrigé : le solde expose la date et
 * le nombre de jours concernés, la carte du salarié l'affiche, le délai de rappel est un réglage et un second
 * rappel part 14 jours avant.
 * Limite documentée (docs/regles-a-valider.md) : l'échéance de report (dateLimiteReportMMJJ) tombe par
 * construction dans la période déjà close, il n'y a donc jamais d'échéance de report « à venir » à rappeler.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const mmjj = (d) => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dansJours = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return d; };

function setup(clotureDansJours, reportCompteur = 'aucun') {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({
    async resolveValidatorEmployeeIdsForStep() { throw new Error('mock : indisponible en test'); }
  }, { get(target, prop) { return prop in target ? target[prop] : async () => ({ success: true }); } });
  api.DB.init();
  const rh = api.DB.getEmployees().find(e => e.role === 'rh');
  api.DB._currentEmployeeId = rh.id;
  const salarie = api.DB.getEmployees().find(e => e.role === 'salarie');
  api.employeeRepository.update(salarie.id, { dateEmbauche: '2018-01-01' });
  const cloture = dansJours(clotureDansJours);
  const type = api.DB.addLeaveType({ nom: 'Congés test C3', categorie: 'conge', acquisition: 'Mensuelle', nombreAnnuel: 24, dateClotureCompteur: mmjj(cloture), reportCompteur, actif: true, visibleSalarie: true, illimite: false });
  return { api, salarie, type, cloture };
}

function runLeSoldeExposeLaDateEtLesJoursQuiExpirent() {
  const { api, salarie, type, cloture } = setup(30, 'aucun');
  const e = api.employeeRepository.getById(salarie.id);
  const bilan = api.sandbox.getLeaveBalance(e, type, [], api.DB.getLeaveTypes(), new Date());
  assert.ok(bilan.disponible > 0, 'préalable : des jours sont disponibles');
  assert.ok(bilan.expiration, 'le solde indique une expiration');
  assert.strictEqual(bilan.expiration.date, iso(cloture), 'date = clôture du compteur');
  assert.strictEqual(bilan.expiration.jours, bilan.disponible, 'sans report, tous les jours disponibles expirent');
  assert.strictEqual(bilan.expiration.motif, 'cloture');

  const avecLimite = setup(30, 'limite');
  avecLimite.api.leaveTypeRepository.updateLeaveType(avecLimite.type.id, { reportLimiteJours: 5 });
  const typeLimite = avecLimite.api.DB.getLeaveTypeById(avecLimite.type.id);
  const b2 = avecLimite.api.sandbox.getLeaveBalance(avecLimite.api.employeeRepository.getById(avecLimite.salarie.id), typeLimite, [], avecLimite.api.DB.getLeaveTypes(), new Date());
  assert.strictEqual(b2.expiration.jours, Math.max(0, Math.round((b2.disponible - 5) * 100) / 100), 'avec un report plafonné à 5 j, seul l\'excédent expire');

  const illimite = setup(30, 'illimite');
  const b3 = illimite.api.sandbox.getLeaveBalance(illimite.api.employeeRepository.getById(illimite.salarie.id), illimite.type, [], illimite.api.DB.getLeaveTypes(), new Date());
  assert.strictEqual(b3.expiration, null, 'report intégral : aucun jour n\'expire');
  console.log('OK — c3-expiration-conges-12-10.test.js (solde : date d\'expiration et jours concernés, selon la règle de report)');
}

function runLaCarteDuSalarieAfficheLExpiration() {
  const { api, salarie, cloture } = setup(30, 'aucun');
  api.DB._currentEmployeeId = salarie.id;
  const html = api.sandbox.renderEmployeeBalances(api.employeeRepository.getById(salarie.id));
  assert.ok(/à prendre avant le/.test(html), 'la carte dit « à prendre avant le … »');
  assert.ok(html.includes(api.sandbox.formatDate(iso(cloture))), 'la date d\'expiration est affichée');
  console.log('OK — c3-expiration-conges-12-10.test.js (carte du solde du salarié : « X j à prendre avant le JJ/MM/AAAA »)');
}

async function runLesRappelsSuiventLeReglageEtUnSecondRappelPart() {
  const { api, salarie, type } = setup(40, 'aucun');
  const cles = () => api.DB.getNotifications().filter(n => n.sourceKey.startsWith(`cloture-perte-${type.id}-${salarie.id}`)).map(n => n.sourceKey);

  const reglages = api.settingsRepository.getSettings();
  assert.strictEqual(reglages.delaiRappelPerteCongesJours, 60, 'défaut : rappel 60 jours avant');
  api.settingsRepository.saveSettings({ ...reglages, delaiRappelPerteCongesJours: 30 });
  await api.syncNotifications();
  assert.strictEqual(cles().length, 0, 'clôture dans 40 jours, rappel réglé à 30 jours : pas encore de rappel');

  api.settingsRepository.saveSettings({ ...api.settingsRepository.getSettings(), delaiRappelPerteCongesJours: 45 });
  await api.syncNotifications();
  assert.strictEqual(cles().length, 1, 'avec un délai de 45 jours, le rappel part');
  assert.ok(!cles().some(k => /j14$/.test(k)));
  await api.syncNotifications();
  assert.strictEqual(cles().length, 1, 'jamais de doublon');
  console.log('OK — c3-expiration-conges-12-10.test.js (délai de rappel réglable, un seul rappel par palier)');

  const proche = setup(10, 'aucun');
  await proche.api.syncNotifications();
  const clesProche = proche.api.DB.getNotifications().filter(n => n.sourceKey.startsWith(`cloture-perte-${proche.type.id}-${proche.salarie.id}`)).map(n => n.sourceKey);
  assert.ok(clesProche.some(k => /j14$/.test(k)), 'à 10 jours de la clôture : rappel de dernière chance');
  console.log('OK — c3-expiration-conges-12-10.test.js (rappel de dernière chance à 14 jours)');
}

function runLeReglageDuDelaiEstDansParametres() {
  const { api } = setup(30, 'aucun');
  assert.ok(api.sandbox.renderParametresTypesAbsences().includes('id="f-rappel-perte-conges"'), 'réglage du délai de rappel dans Paramètres > Congés et absences');
  console.log('OK — c3-expiration-conges-12-10.test.js (délai de rappel réglable dans Paramètres)');
}

(async () => {
  try {
    runLeSoldeExposeLaDateEtLesJoursQuiExpirent();
    runLaCarteDuSalarieAfficheLExpiration();
    await runLesRappelsSuiventLeReglageEtUnSecondRappelPart();
    runLeReglageDuDelaiEstDansParametres();
  } catch (err) {
    console.error('ÉCHEC — c3-expiration-conges-12-10.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  }
})();
