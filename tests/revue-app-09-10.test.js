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

// ---- Ajouts du même tour : soldes sans clôture et validation en lot ----
function runSoldeSansClotureNEstPasAmputeParLAnneePrecedente() {
  const { sandbox, DB, getLeaveBalance } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const emp = DB.getEmployees().find(e => e.role === 'salarie');
  const type = DB.getLeaveTypes().find(t => !t.dateClotureCompteur && !t.illimite && t.acquisition !== 'Illimitée');
  if (!type) { console.log('OK — revue-app-09-10.test.js (aucun type sans clôture dans le jeu de démo, solde annuel non testé)'); return; }
  const requests = [{ id: 'old', employeeId: emp.id, typeId: type.id, dateDebut: '2025-03-10', dateFin: '2025-03-12', nbJours: 3, statut: 'Validé', workflow: [], etapeIndex: 0 }];
  const avecPassé = getLeaveBalance(emp, type, requests, DB.getLeaveTypes(), '2026-06-15');
  const sans = getLeaveBalance(emp, type, [], DB.getLeaveTypes(), '2026-06-15');
  assert.strictEqual(avecPassé.pris, 0, 'des jours pris en 2025 ne doivent jamais être déduits du solde 2026');
  assert.strictEqual(avecPassé.disponible, sans.disponible);
  console.log('OK — revue-app-09-10.test.js (solde sans clôture : seuls les jours de l\'année de référence sont déduits)');
}

function runValidationEnLotIgnoreLesDemandesDejaTraitees() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const i = src.indexOf('function handleBulkApproveRequests(');
  const body = src.slice(i, i + 900);
  assert.ok(/request\.statut !== 'En attente'/.test(body), 'une demande refusée/annulée encore cochée ne doit jamais repasser en Validé');
  console.log('OK — revue-app-09-10.test.js (validation en lot : demandes déjà traitées ignorées)');
}
try { runSoldeSansClotureNEstPasAmputeParLAnneePrecedente(); runValidationEnLotIgnoreLesDemandesDejaTraitees(); } catch (err) { console.error('ÉCHEC — revue-app-09-10.test.js'); console.error(err.stack || err.message); process.exitCode = 1; }
