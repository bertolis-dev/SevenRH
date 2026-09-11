/**
 * Seven RH — get_expense_totals_for_employee (0048_expense_totals_rpc.sql, §retour Betty du
 * 11/09/2026 point 1 étape 2) n'a PAS besoin d'être security definer (elle tourne avec les
 * privilèges de l'appelant, la RLS existante sur expenses la protège déjà — voir son commentaire
 * dans la migration), contrairement aux fonctions listées dans security-definer-grants.test.js.
 * Mais la leçon de 0039/0041 reste valable pour toute fonction qu'on verrouille explicitement :
 * "revoke ... from public" seul NE retire PAS le privilège EXECUTE que Supabase accorde par défaut
 * directement à anon/authenticated (pas seulement via PUBLIC) — seul un revoke qui les NOMME
 * explicitement fonctionne réellement. Ce test vérifie que la migration applique bien le bon motif.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));
  const allSql = files.map(f => fs.readFileSync(path.join(migrationsDir, f), 'utf8')).join('\n');

  assert.ok(/create (or replace )?function\s+get_expense_totals_for_employee\s*\(/i.test(allSql),
    'get_expense_totals_for_employee introuvable dans les migrations');

  const correctRevokePattern = /revoke\s+all\s+on\s+function\s+get_expense_totals_for_employee\([^)]*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i;
  assert.ok(correctRevokePattern.test(allSql),
    'get_expense_totals_for_employee doit être verrouillée avec "revoke all ... from public, anon, authenticated" ' +
    '(nommer anon/authenticated explicitement) — "from public" seul ne suffit pas, voir l\'incident 0039/0041.');

  assert.ok(/grant\s+execute\s+on\s+function\s+get_expense_totals_for_employee\([^)]*\)\s+to\s+authenticated/i.test(allSql),
    'get_expense_totals_for_employee doit explicitement regrant execute à authenticated après le revoke');

  console.log('OK — expense-totals-rpc-grants-11-09.test.js (get_expense_totals_for_employee verrouillée sur le bon motif anon/authenticated, pas seulement public)');
}

try {
  run();
} catch (err) {
  console.error('ÉCHEC — expense-totals-rpc-grants-11-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
