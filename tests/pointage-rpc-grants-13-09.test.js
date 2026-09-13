/**
 * Seven RH — regenerate_pointage_token (0050_regenerate_pointage_token_rpc.sql, §retour Betty du
 * 13/09/2026) est security definer (elle doit contourner etablissements_write pour un manager, qui
 * n'a pas gererParametres) — sa propre vérification de rôle (manager/rh/proprietaire) EST le
 * garde-fou de sécurité, elle doit donc rester appelable par authenticated mais jamais par
 * anon/public. Même leçon que 0039/0041 : "revoke ... from public" seul ne suffit pas, il faut
 * nommer explicitement anon/authenticated pour le revoke, puis regrant authenticated seul.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));
  const allSql = files.map(f => fs.readFileSync(path.join(migrationsDir, f), 'utf8')).join('\n');

  assert.ok(/create (or replace )?function\s+regenerate_pointage_token\s*\(/i.test(allSql),
    'regenerate_pointage_token introuvable dans les migrations');

  assert.ok(/revoke\s+all\s+on\s+function\s+regenerate_pointage_token\([^)]*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i.test(allSql),
    'regenerate_pointage_token doit être verrouillée avec "revoke all ... from public, anon, authenticated" (nommer anon/authenticated explicitement) — "from public" seul ne suffit pas, voir l\'incident 0039/0041.');

  assert.ok(/grant\s+execute\s+on\s+function\s+regenerate_pointage_token\([^)]*\)\s+to\s+authenticated/i.test(allSql),
    'regenerate_pointage_token doit explicitement regrant execute à authenticated après le revoke (elle DOIT rester appelable par un salarié connecté, sa propre vérification de rôle interne est le vrai garde-fou)');

  console.log('OK — pointage-rpc-grants-13-09.test.js (regenerate_pointage_token verrouillée sur le bon motif anon/authenticated, pas seulement public)');
}

try {
  run();
} catch (err) {
  console.error('ÉCHEC — pointage-rpc-grants-13-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
