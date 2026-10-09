/**
 * Seven RH — tour de l'application du 09/10/2026 :
 *  1. changePassword (async, Supabase Auth) était appelé sans await : result.success valait toujours
 *     undefined, l'écran affichait une erreur "undefined" alors que le mot de passe était changé.
 *  2. Le menu en haut à droite n'avait plus "Mon compte" (retiré à la demande de Betty), et la barre
 *     latérale exclut toutes les entrées 'parametres' : un salarié/manager/comptable (sans
 *     gererParametres) n'avait plus aucun chemin vers Mon compte. "Paramètres" est désormais visible
 *     de tout rôle (renderParametres retombe sur Mon compte pour qui n'a pas ce droit).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAppJs } = require('./load-app-js');

function runLeMenuUtilisateurOffreParametresATousLesRoles() {
  for (const role of ['salarie', 'manager', 'comptabilite', 'rh']) {
    const api = loadAppJs();
    api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    api.DB.init();
    const emp = api.DB.getEmployees().find(e => e.role === role);
    if (!emp) continue;
    api.DB._currentEmployeeId = emp.id;
    api.renderUserMenuPanel();
    const html = api.sandbox.document.getElementById('user-menu-panel').innerHTML;
    assert.ok(html.includes('id="btn-user-menu-parametres"'), `rôle ${role} : "Paramètres" doit rester atteignable depuis le menu utilisateur`);
    assert.ok(!html.includes('btn-user-menu-mon-compte'), 'plus d\'entrée "Mon compte" en doublon dans ce menu');
  }
  console.log('OK — revue-app-09-10.test.js (menu utilisateur : "Paramètres" visible de tout rôle, aucun doublon "Mon compte")');
}

function runLeChangementDeMotDePasseAttendLaReponse() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const i = src.indexOf("getElementById('change-password-form').addEventListener('submit'");
  const body = src.slice(i, i + 1800);
  assert.ok(/addEventListener\('submit', async \(evt\)/.test(body), 'le handler doit être async');
  assert.ok(/await authRepository\.changePassword\(/.test(body), 'changePassword (Promise) doit être attendu');
  console.log('OK — revue-app-09-10.test.js (changement de mot de passe : réponse attendue avant de lire result.success)');
}

try {
  runLeMenuUtilisateurOffreParametresATousLesRoles();
  runLeChangementDeMotDePasseAttendLaReponse();
} catch (err) {
  console.error('ÉCHEC — revue-app-09-10.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
