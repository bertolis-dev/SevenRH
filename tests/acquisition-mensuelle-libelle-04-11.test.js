/**
 * Seven RH — retour du 04/11/2026 : « 1 jour par mois ou 12 par an ? Si je mets 1 ici, ça affiche 1 jour par an ». Le nombre saisi sur un type de congé
 * est toujours un TOTAL ANNUEL (même en acquisition mensuelle : un douzième par mois). Le formulaire disait « par mois » à tort ; la liste doit
 * donner les deux repères, et le calcul doit rester cohérent avec eux.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function run() {
  const api = loadAppJs();
  const { DB, sandbox, renderLeaveTypeRow, calculateAcquisition } = api;
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();

  const texte = (type) => renderLeaveTypeRow(type).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const base = DB.getLeaveTypes().find(t => t.nom === 'RTT');
  assert.ok(texte({ ...base, acquisition: 'Mensuelle', nombreAnnuel: 12, illimite: false }).includes('12,00 j/an (soit 1,00 j/mois)'), '12 par an en mensuel = 1 jour par mois');
  assert.ok(texte({ ...base, acquisition: 'Mensuelle', nombreAnnuel: 1, illimite: false }).includes('1,00 j/an (soit 0,08 j/mois)'), '1 saisi = 1 jour par an, et la liste le dit sans ambiguïté');
  assert.ok(!texte({ ...base, acquisition: 'Annuelle', nombreAnnuel: 25, illimite: false }).includes('/mois'), 'pas de rythme mensuel pour une acquisition annuelle');

  // Le calcul suit : 12 par an en mensuel = 3 jours après 3 mois pleins ; 1 par an = 0,25.
  const emp = DB.getEmployees().find(e => e.role === 'salarie');
  const salarie = { ...emp, dateEmbauche: '2020-01-01', dateDepart: '' };
  const type = (n) => ({ ...base, acquisition: 'Mensuelle', nombreAnnuel: n, illimite: false, natureAcquisition: 'progressive', paliersAnciennete: null, dateClotureCompteur: '' });
  const apres3Mois = new Date(2026, 3, 1);
  assert.strictEqual(calculateAcquisition(salarie, type(12), apres3Mois), 3, '12 par an : 3 jours après 3 mois');
  assert.strictEqual(calculateAcquisition(salarie, type(1), apres3Mois), 0.25, '1 par an : un quart de jour après 3 mois');

  console.log('OK — acquisition-mensuelle-libelle-04-11.test.js (liste : par an et par mois, calcul cohérent)');
}

try { run(); } catch (err) { console.error('ÉCHEC — acquisition-mensuelle-libelle-04-11.test.js'); console.error(err.stack || err.message); process.exitCode = 1; }
