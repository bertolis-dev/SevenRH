/**
 * Seven RH — retour du 21/10/2026 (point 4) : pendant la mise en service, la personne qui paramètre Nexus (RH) doit pouvoir
 * corriger ses propres congés et compteurs. La règle « personne ne gère sa propre demande » (hors propriétaire) reste la règle ;
 * le propriétaire peut l'assouplir pour une durée limitée (mode « mise en service »), tracée dans le journal d'audit.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function setup() {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  const proprietaire = api.DB.getEmployees().find(e => e.role === 'proprietaire');
  const rh = api.DB.getEmployees().find(e => e.role === 'rh');
  const cp = api.DB.getLeaveTypes().find(t => t.nom === 'Congés payés');
  const demande = api.DB.addLeaveRequest({ employeeId: rh.id, typeId: cp.id, dateDebut: '2026-03-02', dateFin: '2026-03-03', nbJours: 2 });
  return { api, proprietaire, rh, cp, demande };
}

const demain = () => { const d = new Date(Date.now() + 24 * 3600 * 1000); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const hier = () => { const d = new Date(Date.now() - 24 * 3600 * 1000); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

function run() {
  const { api, proprietaire, rh, demande } = setup();
  const { sandbox, DB } = api;

  // par défaut : la règle de séparation des tâches s'applique au RH
  DB._currentEmployeeId = rh.id;
  assert.strictEqual(sandbox.miseEnServiceActive(), false);
  assert.strictEqual(sandbox.canManageRequestFor(rh.id), false, 'le RH ne gère pas sa propre demande par défaut');
  assert.ok(!sandbox.renderEmployeeBalances(DB.getEmployeeById(rh.id), sandbox.peutAjusterCompteursDe(DB.getEmployeeById(rh.id))).includes('data-adjust-compteur'), 'ni ses propres compteurs');

  // seul le propriétaire active le mode
  assert.strictEqual(sandbox.activerMiseEnService(30).success, false, 'le RH ne peut pas activer le mode lui-même');
  DB._currentEmployeeId = proprietaire.id;
  const avantAudit = DB.getAuditLog().length;
  const activation = sandbox.activerMiseEnService(30);
  assert.strictEqual(activation.success, true);
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(activation.jusquau));
  assert.ok(DB.getAuditLog().length > avantAudit, 'activation tracée dans le journal d audit');
  assert.ok(DB.getAuditLog().slice(0, DB.getAuditLog().length - avantAudit).some(l => /mise en service/i.test(JSON.stringify(l))), 'entrée nommant le mode mise en service');

  // mode actif : le RH peut corriger ses propres congés et compteurs
  DB._currentEmployeeId = rh.id;
  assert.strictEqual(sandbox.miseEnServiceActive(), true);
  assert.strictEqual(sandbox.canManageRequestFor(rh.id), true, 'le RH peut régulariser sa propre demande pendant la mise en service');
  assert.ok(sandbox.renderEmployeeBalances(DB.getEmployeeById(rh.id), sandbox.peutAjusterCompteursDe(DB.getEmployeeById(rh.id))).includes('data-adjust-compteur'), 'et ajuster ses propres compteurs');
  // un salarié sans droit de gestion n'y gagne rien
  const salarie = DB.getEmployees().find(e => e.role === 'salarie');
  DB._currentEmployeeId = salarie.id;
  assert.strictEqual(sandbox.canManageRequestFor(salarie.id), false, 'le mode ne donne aucun droit à un simple salarié');

  // échéance dépassée : retour à la règle normale, sans rien à faire
  DB._currentEmployeeId = proprietaire.id;
  const reglages = DB.getSettings(); reglages.miseEnServiceJusquau = hier(); DB.saveSettings(reglages);
  DB._currentEmployeeId = rh.id;
  assert.strictEqual(sandbox.miseEnServiceActive(), false, 'mode expiré');
  assert.strictEqual(sandbox.canManageRequestFor(rh.id), false);

  // veille d'expiration encore valable, désactivation manuelle
  DB._currentEmployeeId = proprietaire.id;
  const r2 = DB.getSettings(); r2.miseEnServiceJusquau = demain(); DB.saveSettings(r2);
  assert.strictEqual(sandbox.miseEnServiceActive(), true);
  assert.strictEqual(sandbox.desactiverMiseEnService().success, true);
  assert.strictEqual(sandbox.miseEnServiceActive(), false);

  // durée raisonnable imposée
  assert.strictEqual(sandbox.activerMiseEnService(0).success, false);
  assert.strictEqual(sandbox.activerMiseEnService(400).success, false, 'pas de mode quasi permanent');
  console.log('OK — mise-en-service-21-10.test.js (mode limité dans le temps, réservé au propriétaire, tracé, expire seul)');
}

try { run(); } catch (err) { console.error('ÉCHEC — mise-en-service-21-10.test.js'); console.error(err.stack || err.message); process.exitCode = 1; }

// Carte de réglage : visible du seul propriétaire dans Paramètres > Congés
(function carte() {
  const { api, proprietaire, rh } = setup();
  const { sandbox, DB } = api;
  const rendu = () => sandbox.renderParametresTypesAbsences ? sandbox.renderParametresTypesAbsences() : null;
  DB._currentEmployeeId = proprietaire.id;
  const html = rendu();
  if (html === null) { console.log('(carte non testée : fonction de rendu introuvable)'); return; }
  assert.ok(html.includes('btn-mise-en-service-activer'), 'le propriétaire voit le bouton d\'activation');
  DB._currentEmployeeId = rh.id;
  assert.ok(!rendu().includes('btn-mise-en-service-activer'), 'le RH ne voit pas la carte');
  console.log('OK — mise-en-service-21-10.test.js (carte de réglage réservée au propriétaire)');
})();
