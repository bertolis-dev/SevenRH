/**
 * Seven RH — pont Nexus Gestion (14/10/2026) : la date de commande des tickets restaurant n'était pas conservée (seul le
 * nombre commandé l'était). Elle est maintenant enregistrée à chaque génération du fichier de commande, sans migration
 * (réglages de l'entreprise). Les mois déjà commandés avant ce changement n'ont pas de date : l'export donne null.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function run() {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  const rh = api.DB.getEmployees().find(e => e.role === 'rh');
  api.DB._currentEmployeeId = rh.id;

  assert.deepStrictEqual(Object.keys(api.settingsRepository.getSettings().ticketsCommandesDates), [], 'aucune date de commande au départ');
  const auditAvant = api.DB.getAuditLog().length;
  api.DB.enregistrerCommandeTickets(2026, 9, [], []);

  const dates = api.settingsRepository.getSettings().ticketsCommandesDates;
  assert.strictEqual(dates['2026-10'], iso(new Date()), 'la date du jour est enregistrée pour le mois commandé');
  const nouvelles = api.DB.getAuditLog().length - auditAvant;
  assert.strictEqual(nouvelles, 1, 'une seule ligne de journal (pas de « Modification Paramètres » en plus)');

  api.DB.enregistrerCommandeTickets(2026, 10, [], []);
  const apres = api.settingsRepository.getSettings().ticketsCommandesDates;
  assert.strictEqual(apres['2026-10'], iso(new Date()), 'la date d\'un autre mois ne touche pas les précédentes');
  assert.ok(apres['2026-11'], 'chaque mois a la sienne');
  console.log('OK — export-nexus-gestion-date-commande-14-10.test.js (date de commande enregistrée par mois, journal inchangé)');
}

try { run(); } catch (err) { console.error('ÉCHEC — export-nexus-gestion-date-commande-14-10.test.js'); console.error(err.stack || err.message); process.exitCode = 1; }
