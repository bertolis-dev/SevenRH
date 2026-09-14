/**
 * Seven RH — les 3 fonctions security definer de la Pointeuse QR (regenerate_pointage_token,
 * 0050_regenerate_pointage_token_rpc.sql ; get_pointage_qr_code et verifier_pointage_code,
 * 0051_pointage_rotation.sql) doivent contourner etablissements_write/l'absence de policy RLS sur
 * pointage_secrets — leur propre vérification interne EST le garde-fou de sécurité, elles doivent
 * donc rester appelables par authenticated mais jamais par anon/public. Même leçon que 0039/0041 :
 * "revoke ... from public" seul ne suffit pas, il faut nommer explicitement anon/authenticated pour
 * le revoke, puis regrant authenticated seul.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const FONCTIONS = [
  { nom: 'regenerate_pointage_token', args: '[^)]*' },
  { nom: 'get_pointage_qr_code', args: '[^)]*' },
  { nom: 'verifier_pointage_code', args: '[^)]*' },
];

function run() {
  const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));
  const allSql = files.map(f => fs.readFileSync(path.join(migrationsDir, f), 'utf8')).join('\n');

  FONCTIONS.forEach(({ nom, args }) => {
    assert.ok(new RegExp(`create (or replace )?function\\s+${nom}\\s*\\(`, 'i').test(allSql),
      `${nom} introuvable dans les migrations`);

    assert.ok(new RegExp(`revoke\\s+all\\s+on\\s+function\\s+${nom}\\(${args}\\)\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`, 'i').test(allSql),
      `${nom} doit être verrouillée avec "revoke all ... from public, anon, authenticated" (nommer anon/authenticated explicitement) — "from public" seul ne suffit pas, voir l'incident 0039/0041.`);

    assert.ok(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+${nom}\\(${args}\\)\\s+to\\s+authenticated`, 'i').test(allSql),
      `${nom} doit explicitement regrant execute à authenticated après le revoke (elle DOIT rester appelable par un salarié connecté, sa propre vérification interne est le vrai garde-fou)`);
  });

  // §retour Betty du 14/09/2026 : pointage_secrets ne doit avoir AUCUNE policy RLS pour
  // authenticated/anon — seules les fonctions ci-dessus (security definer) peuvent la lire, jamais
  // un client directement, même privilégié.
  assert.ok(/create table pointage_secrets/i.test(allSql), 'la table pointage_secrets doit exister');
  assert.ok(!/create policy[^;]*on pointage_secrets/i.test(allSql),
    'pointage_secrets ne doit avoir AUCUNE policy RLS : le secret ne doit être lisible/écrit que via les fonctions security definer, jamais par un select/update direct d\'un client, quel que soit son rôle');

  console.log('OK — pointage-rpc-grants-13-09.test.js (regenerate_pointage_token/get_pointage_qr_code/verifier_pointage_code verrouillées sur le bon motif anon/authenticated, pointage_secrets sans aucune policy RLS)');
}

try {
  run();
} catch (err) {
  console.error('ÉCHEC — pointage-rpc-grants-13-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
