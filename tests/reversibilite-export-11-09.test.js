/**
 * Seven RH — retour Betty du 11/09/2026 (point 4.2, "la réversibilité, question que tout acheteur
 * sérieux pose avant de signer") : un salarié pouvait déjà exporter ses propres données, jamais
 * l'entreprise dans son ensemble. Voir fetchFullCompanyExportData (supabase-client.js, non testable
 * ici — ES module qui parle au vrai Supabase, même limite que le reste des fonctions "fetch*"/RPC de
 * ce fichier) : ce test couvre la partie CLIENT — qui voit le bouton, ce qui se passe au clic
 * (succès et échec), jamais un déclenchement de téléchargement DOM réel (Blob/URL non simulés dans
 * ce bac à sable, downloadJSONFile est donc remplacée par un espion, même patron que
 * frais-fixes-07-09.test.js pour exportRowsToCSV).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function run() {
  // ---- Le bouton n'apparaît que pour qui gère déjà les Paramètres (RH/Propriétaire) ----
  {
    const { DB, sandbox, renderParametresEntreprise } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const htmlRh = renderParametresEntreprise();
    assert.ok(htmlRh.includes('btn-export-toutes-donnees'), 'RH (gererParametres) doit voir le bouton d\'export complet');

    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    DB._currentEmployeeId = salarie.id;
    const htmlSalarie = renderParametresEntreprise();
    assert.ok(!htmlSalarie.includes('btn-export-toutes-donnees'), 'un simple salarié ne doit jamais voir l\'export complet de l\'entreprise');
  }

  // ---- Clic : succès — les bonnes données sont transmises au téléchargement, un audit est posé,
  // le bouton se réactive ----
  {
    const { DB, sandbox, handleExportToutesDonnees, auditLogRepository } = loadAppJs();
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const company = DB.getCurrentCompany();

    let capturedFetchCompanyId = null;
    sandbox.window.SupabaseSync = new Proxy({
      fetchFullCompanyExportData: async (companyId) => {
        capturedFetchCompanyId = companyId;
        return { exporteLe: '2026-09-11T00:00:00.000Z', salaries: [{ id: 'e1' }] };
      },
    }, { get(target, prop) { return prop in target ? target[prop] : async () => ({ success: true }); } });

    let captured = null;
    sandbox.downloadJSONFile = (data, filename) => { captured = { data, filename }; };

    const btn = sandbox.document.getElementById('btn-export-toutes-donnees');
    btn.textContent = 'Exporter toutes les données';

    const before = auditLogRepository.getAuditLog().length;
    const clickPromise = handleExportToutesDonnees();
    assert.strictEqual(btn.disabled, true, 'le bouton doit être désactivé pendant la génération');
    await clickPromise;

    assert.strictEqual(capturedFetchCompanyId, company.id, 'l\'export doit porter sur l\'entreprise COURANTE');
    assert.ok(captured, 'downloadJSONFile doit être appelée en cas de succès');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(captured.data)), { exporteLe: '2026-09-11T00:00:00.000Z', salaries: [{ id: 'e1' }] });
    assert.ok(captured.filename.endsWith('.json'), 'le fichier généré doit être un .json');
    assert.strictEqual(btn.disabled, false, 'le bouton doit se réactiver après un succès');
    assert.strictEqual(auditLogRepository.getAuditLog().length, before + 1, 'un export complet doit être journalisé (traçabilité d\'un accès sensible)');
  }

  // ---- Clic : échec — jamais de plantage, un message d'erreur, le bouton se réactive ----
  {
    const { DB, sandbox, handleExportToutesDonnees } = loadAppJs();
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    sandbox.window.SupabaseSync = new Proxy({
      fetchFullCompanyExportData: async () => { throw new Error('Échec de lecture (employees) — export incomplet, réessayez.'); },
    }, { get(target, prop) { return prop in target ? target[prop] : async () => ({ success: true }); } });
    let downloadCalled = false;
    sandbox.downloadJSONFile = () => { downloadCalled = true; };

    const btn = sandbox.document.getElementById('btn-export-toutes-donnees');
    btn.textContent = 'Exporter toutes les données';
    await handleExportToutesDonnees();

    assert.strictEqual(downloadCalled, false, 'un échec ne doit jamais déclencher un téléchargement (fichier partiel/vide)');
    assert.strictEqual(btn.disabled, false, 'le bouton doit se réactiver après un échec, pour permettre de réessayer');
  }

  console.log('OK — reversibilite-export-11-09.test.js (export complet réservé à RH/Propriétaire, succès journalisé, échec sans plantage)');
}

run().catch((err) => {
  console.error('ÉCHEC — reversibilite-export-11-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
