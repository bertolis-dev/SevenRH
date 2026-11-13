/**
 * Retour du 13/11/2026 : le menu du rond ne garde que Paramètres, Aide / Signaler un problème, Guide, Se déconnecter ;
 * le reste est dans Paramètres > Mon compte.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

const api = loadAppJs();
api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
api.DB.init();

for (const role of ['salarie', 'manager', 'rh', 'proprietaire']) {
  const emp = api.DB.getEmployees().find(e => e.role === role);
  if (!emp) continue;
  api.DB._currentEmployeeId = emp.id;

  api.renderUserMenuPanel();
  const menu = api.sandbox.document.getElementById('user-menu-panel').innerHTML;
  ['btn-user-menu-parametres', 'btn-user-menu-support', 'btn-user-menu-guide', 'btn-logout'].forEach(id =>
    assert.ok(menu.includes(`id="${id}"`), `${role} : « ${id} » reste dans le menu`));
  ['btn-change-password', 'btn-export-my-data', 'btn-ical-sync', 'btn-add-account', 'btn-user-menu-abonnement', 'btn-user-menu-transfer-proprietaire', 'data-theme-choice'].forEach(id =>
    assert.ok(!menu.includes(id), `${role} : « ${id} » n'est plus dans le menu`));
  assert.strictEqual((menu.match(/<button[^>]*class="user-menu-item[ "]/g) || []).length, 4, `${role} : 4 entrées seulement dans le menu`);

  const monCompte = api.renderParametresMonCompte();
  ['btn-change-password', 'btn-export-my-data', 'btn-add-account', 'data-theme-choice', 'btn-mon-compte-nouveautes'].forEach(id =>
    assert.ok(monCompte.includes(id), `${role} : « ${id} » est dans Paramètres > Mon compte`));
  assert.strictEqual(monCompte.includes('btn-user-menu-transfer-proprietaire'), role === 'proprietaire', `${role} : transfert de propriété réservé au propriétaire`);
}

console.log('OK — menu-compte-allege-13-11.test.js');
