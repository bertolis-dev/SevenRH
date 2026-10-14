/**
 * Seven RH — point en attente de la revue du 13/10/2026, traité le 14/10 : une campagne d'entretiens lancée avec une trame
 * enregistrait bien l'identifiant de la trame sur chaque entretien, mais ses questions n'apparaissaient nulle part : ni pour le
 * salarié qui prépare son auto-évaluation, ni pour son manager. Elles s'affichent désormais en haut de l'entretien.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function run() {
  const api = loadAppJs();
  const { DB, sandbox, entretienRepository, renderEntretienDetail } = api;
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const company = DB.getCurrentCompany();
  company.abonnement.offre = 'a_la_carte';
  company.abonnement.modules = [{ key: 'entretiens' }];
  DB.saveCurrentCompany(company);

  const rh = DB.getEmployees().find(e => e.role === 'rh');
  const salarie = DB.getEmployees().find(e => e.role === 'salarie');
  const manager = DB.getEmployees().find(e => e.role === 'manager');
  DB._currentEmployeeId = rh.id;

  const trame = DB.creerTrameEntretien('Trame managers', 'tous', [
    { id: 'q1', label: 'Quelles ont été vos principales réussites ?' },
    { id: 'q2', label: 'Vos souhaits d\'évolution <b>?</b>' }
  ]);
  const avec = entretienRepository.create({ employeeId: salarie.id, type: 'professionnel', datePrevue: '2026-12-01', trameId: trame.id });
  const sans = entretienRepository.create({ employeeId: salarie.id, type: 'professionnel', datePrevue: '2026-12-02' });

  for (const [role, id] of [['salarié', salarie.id], ['manager', manager.id], ['RH', rh.id]]) {
    DB._currentEmployeeId = id;
    const html = renderEntretienDetail(avec.id);
    assert.ok(html.includes('Trame managers'), `${role} : nom de la trame affiché`);
    assert.ok(html.includes('Quelles ont été vos principales réussites ?'), `${role} : question 1 affichée`);
    assert.ok(html.includes('souhaits d&#39;évolution &lt;b&gt;?&lt;/b&gt;') || html.includes('souhaits d&#039;évolution &lt;b&gt;?&lt;/b&gt;') || /souhaits d.{1,6}évolution &lt;b&gt;\?&lt;\/b&gt;/.test(html), `${role} : question 2 affichée et échappée`);
    assert.ok(!html.includes('<b>?</b>'), `${role} : jamais de HTML injecté par une question`);
  }

  DB._currentEmployeeId = salarie.id;
  assert.ok(!renderEntretienDetail(sans.id).includes('Trame d\'entretien'), 'sans trame : aucun bloc');

  // trame supprimée depuis : l'entretien s'affiche toujours, sans bloc ni erreur
  DB._currentEmployeeId = rh.id;
  DB.deleteTrameEntretien(trame.id);
  DB._currentEmployeeId = salarie.id;
  const html = renderEntretienDetail(avec.id);
  assert.ok(html.includes('Auto-évaluation') && !html.includes('Trame managers'), 'trame supprimée : entretien intact');
  console.log('OK — entretien-trame-affichee-14-10.test.js (questions de la trame visibles par le salarié, le manager et le RH, échappées, tolère une trame supprimée)');
}

try { run(); } catch (err) { console.error('ÉCHEC — entretien-trame-affichee-14-10.test.js'); console.error(err.stack || err.message); process.exitCode = 1; }
