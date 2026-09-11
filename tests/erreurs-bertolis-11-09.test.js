/**
 * Seven RH — retour Betty du 11/09/2026 (point 2, "nous ne voyons toujours pas les erreurs de nos
 * clients") : reportClientError (app.js) n'écrivait que dans l'audit_log DE L'ENTREPRISE CLIENTE,
 * jamais consulté pour cet usage côté BERTOLIS ni côté client. Ce fichier couvre la partie client de
 * la remontée directe à BERTOLIS (voir 0047_client_error_reports.sql et l'Edge Function
 * bertolis-tickets, actions listErrors/markErrorReviewed, non testables ici — Deno, hors de ce
 * bac à sable Node) : la transmission doit avoir lieu EN PLUS du journal local, jamais À LA PLACE,
 * et un échec de la transmission ne doit jamais remonter jusqu'à l'appelant (render()).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function run() {
  // ---- reportClientError : journal local ET transmission à BERTOLIS, avec les bons identifiants ----
  {
    const { DB, sandbox, reportClientError, auditLogRepository } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const company = DB.getCurrentCompany();

    const calls = [];
    sandbox.window.SupabaseSync = new Proxy({
      async reportClientErrorToBertolis(companyId, employeeId, version, contexte, message, stack) {
        calls.push({ companyId, employeeId, version, contexte, message, stack });
        return { success: true };
      }
    }, { get(target, prop) { return prop in target ? target[prop] : async () => ({ success: true }); } });

    const before = auditLogRepository.getAuditLog().length;
    reportClientError(new Error('boom de test'), 'render');

    // Journal local inchangé (comportement déjà en place, ne doit jamais régresser).
    assert.strictEqual(auditLogRepository.getAuditLog().length, before + 1, 'le journal d\'audit local doit toujours recevoir l\'erreur');

    // Transmission à BERTOLIS déclenchée en plus, synchrone à l'appel (le await est côté mock,
    // mais l'appel lui-même — donc le push dans `calls` — a lieu avant le retour de reportClientError
    // puisque .catch() est posé sur une promesse déjà résolue au moment de l'assertion ci-dessous
    // n'a pas encore eu le temps de s'exécuter — on laisse passer un tick).
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.strictEqual(calls.length, 1, 'reportClientErrorToBertolis doit être appelé une fois');
    assert.strictEqual(calls[0].companyId, company.id);
    assert.strictEqual(calls[0].employeeId, rh.id);
    assert.strictEqual(calls[0].contexte, 'render');
    assert.strictEqual(calls[0].message, 'boom de test');
  }

  // ---- Un échec de la transmission ne doit jamais faire planter l'appelant ----
  {
    const { DB, sandbox, reportClientError } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;

    sandbox.window.SupabaseSync = new Proxy({
      async reportClientErrorToBertolis() { throw new Error('réseau indisponible'); }
    }, { get(target, prop) { return prop in target ? target[prop] : async () => ({ success: true }); } });

    assert.doesNotThrow(() => reportClientError(new Error('boom'), 'render'), 'un échec de transmission à BERTOLIS ne doit jamais remonter à l\'appelant');
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  console.log('OK — erreurs-bertolis-11-09.test.js (reportClientError transmet à BERTOLIS en plus du journal local, jamais bloquant)');
}

run().catch((err) => {
  console.error('ÉCHEC — erreurs-bertolis-11-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
