/**
 * Seven RH — anonymize_employee/anonymize_departed_employees (0049_retention_anonymisation.sql,
 * §retour Betty du 11/09/2026 point 4.3) sont des fonctions de MAINTENANCE INTERNE, appelées
 * uniquement par pg_cron (configuré à la main sur le Dashboard Supabase, jamais via l'API cliente).
 * Même leçon que get_expense_totals_for_employee (voir expense-totals-rpc-grants-11-09.test.js) et
 * l'incident 0039/0041 : "revoke ... from public" seul ne retire pas le privilège EXECUTE que
 * Supabase accorde par défaut directement à anon/authenticated — seul un revoke qui les NOMME
 * explicitement fonctionne. Ici la barre est encore plus haute que pour un simple total : ces
 * fonctions ÉCRIVENT (elles effacent des données personnelles), jamais un accès qui doit rester
 * ouvert à qui que ce soit côté client.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const FUNCTIONS = [
  { name: 'anonymize_employee', signature: 'anonymize_employee(text)' },
  { name: 'anonymize_departed_employees', signature: 'anonymize_departed_employees()' },
];

function run() {
  const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));
  const allSql = files.map(f => fs.readFileSync(path.join(migrationsDir, f), 'utf8')).join('\n');

  for (const { name, signature } of FUNCTIONS) {
    assert.ok(new RegExp(`create (or replace )?function\\s+${name}\\s*\\(`, 'i').test(allSql),
      `${name} introuvable dans les migrations`);

    const revokePattern = new RegExp(
      `revoke\\s+all\\s+on\\s+function\\s+${signature.replace(/[[\]()]/g, '\\$&')}\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`, 'i'
    );
    assert.ok(revokePattern.test(allSql),
      `${name} doit être verrouillée avec "revoke all ... from public, anon, authenticated" (nommer anon/authenticated explicitement) — ` +
      `"from public" seul ne suffit pas, voir l'incident 0039/0041. Ces fonctions modifient des données personnelles : aucun accès client ne doit jamais y être possible.`);
  }

  console.log(`OK — retention-rpc-grants-11-09.test.js (${FUNCTIONS.length} fonctions de maintenance interne verrouillées sur le bon motif anon/authenticated)`);
}

try {
  run();
} catch (err) {
  console.error('ÉCHEC — retention-rpc-grants-11-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
