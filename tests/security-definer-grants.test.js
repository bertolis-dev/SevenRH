/**
 * Seven RH — garde-fou du point B.1 (retour QA du 26/08/2026) : les 5 fonctions security definer
 * touchées ce jour-là (has_permission_for, has_eligible_validator_for_step,
 * resolve_workflow_with_fallback, resolve_validator_employee_ids_for_step,
 * check_notify_request_email_rate_limit) prennent toutes un employee_id (ou un ip/company_id pour
 * la limite de débit) EN PARAMÈTRE — n'importe qui avec la clé anon pouvait donc les appeler sans
 * authentification pour lire les droits/valideurs de n'IMPORTE QUI, ou épuiser le quota d'un autre.
 * Elles doivent rester `revoke all ... from public` pour toujours (0039_revoke_public_execute.sql).
 *
 * Volontairement une liste nommée, pas une détection heuristique générale ("toute fonction security
 * definer doit avoir un revoke") : le projet a plusieurs fonctions security definer légitimement
 * laissées à PUBLIC par conception — has_permission()/current_employee_id()/current_company_id()
 * (0002) ne prennent AUCUN employee_id en paramètre, elles ne répondent que sur l'appelant lui-même
 * (current_employee_id() en interne), donc rien à y lire pour un tiers. Une règle générale les
 * signalerait à tort et créerait exactement le genre de test qui semble protéger quelque chose sans
 * le faire vraiment (voir le point C.1 de ce même retour, sur workflow-resolution.test.js).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const PROTECTED_FUNCTIONS = [
  { name: 'has_permission_for', signature: 'has_permission_for(text, text)' },
  { name: 'has_eligible_validator_for_step', signature: 'has_eligible_validator_for_step(text, text, text)' },
  { name: 'resolve_workflow_with_fallback', signature: 'resolve_workflow_with_fallback(text, text[], text)' },
  { name: 'resolve_validator_employee_ids_for_step', signature: 'resolve_validator_employee_ids_for_step(text, text)' },
  { name: 'check_notify_request_email_rate_limit', signature: 'check_notify_request_email_rate_limit(text, int)' },
  // §rétroactif : même défaut, plus ancien, sur candidature-submit (voir 0031 et 0039).
  { name: 'check_candidature_rate_limit', signature: 'check_candidature_rate_limit(text, text, int)' },
];

function run() {
  const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));
  const allSql = files.map(f => fs.readFileSync(path.join(migrationsDir, f), 'utf8')).join('\n');

  for (const { name, signature } of PROTECTED_FUNCTIONS) {
    const definedPattern = new RegExp(`create (or replace )?function\\s+${name}\\s*\\(`, 'i');
    assert.ok(definedPattern.test(allSql), `${name} : introuvable dans les migrations — la liste protégée est-elle encore à jour ?`);

    const revokePattern = new RegExp(`revoke\\s+all\\s+on\\s+function\\s+${signature.replace(/[[\]()]/g, '\\$&')}\\s+from\\s+public`, 'i');
    assert.ok(revokePattern.test(allSql),
      `${name} : aucun "revoke all on function ${signature} from public" trouvé dans les migrations — ` +
      `cette fonction security definer redeviendrait appelable par n'importe qui avec la clé anon (voir point B.1 du 26/08/2026).`);
  }

  console.log(`OK — security-definer-grants.test.js (${PROTECTED_FUNCTIONS.length} fonctions vérifiées revoke-from-public)`);
}

try {
  run();
} catch (err) {
  console.error('ÉCHEC — security-definer-grants.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
