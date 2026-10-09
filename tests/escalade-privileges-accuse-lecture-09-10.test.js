/**
 * Seven RH — audit du 09/10/2026 :
 *  1. Un RH (gererUtilisateurs par défaut) pouvait prendre le compte du Propriétaire : la fonction
 *     manage-employee-account ne contrôlait pas le rôle de la cible, et le trigger de la table
 *     employees laissait modifier permissions_overrides à qui avait gererUtilisateurs (migration 0065).
 *  2. L'accusé de lecture et la diffusion de documents ne survivaient pas au rechargement (aucune
 *     colonne, mappers incomplets) et un salarié ne pouvait pas confirmer sa lecture (0066).
 * Les migrations ne s'exécutent pas ici : ce fichier vérifie leur contenu et le code client réel.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadSupabaseClient } = require('./load-supabase-client');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

function runLaFonctionRefuseLeCompteDuProprietaireAUnTiers() {
  const src = read('supabase', 'functions', 'manage-employee-account', 'index.ts');
  assert.ok(/select\("id, email, company_id, auth_user_id, data, role"\)/.test(src), 'le rôle de la cible doit être lu');
  assert.ok(/employee\.role === "proprietaire"/.test(src) && /caller\.role !== "proprietaire"/.test(src), 'seul le Propriétaire gère le compte du Propriétaire');
  assert.ok(src.indexOf('employee.role === "proprietaire"') < src.indexOf('const tempPassword = generateTempPassword()'), 'le refus doit précéder toute création/réinitialisation');
  console.log('OK — escalade-privileges-accuse-lecture-09-10.test.js (Edge Function : compte du Propriétaire réservé au Propriétaire)');
}

function runLaMigrationAlignePermissionsEtInsertSurLEcran() {
  const sql = read('supabase', 'migrations', '0065_garde_escalade_privileges.sql');
  assert.ok(/has_permission\('gererPermissions'\)/.test(sql), 'modifier des permissions exige gererPermissions, comme l\'écran');
  assert.ok(/Impossible de modifier ses propres permissions/.test(sql), 'jamais sur son propre compte');
  assert.ok(/Seul le Propriétaire peut modifier les permissions du Propriétaire/.test(sql));
  assert.ok(/Seul le Propriétaire peut archiver ou réactiver le Propriétaire/.test(sql));
  assert.ok(/role <> 'proprietaire' or current_role_name\(\) = 'proprietaire'/.test(sql), 'seul le Propriétaire insère un Propriétaire');
  assert.ok(/transfer_bypass/.test(sql), 'le transfert de propriété (bypass transactionnel) reste possible');
  console.log('OK — escalade-privileges-accuse-lecture-09-10.test.js (migration 0065 : permissions, archivage et insertion du Propriétaire gardés)');
}

function runLaMigrationAccuseNeDonneAuSalarieQueSesPropresDocuments() {
  const sql = read('supabase', 'migrations', '0066_documents_accuse_lecture.sql');
  ['accuse_lecture_requis', 'accuse_lecture_at', 'accuse_lecture_par', 'diffusion_id'].forEach(c => assert.ok(sql.includes(c), `colonne ${c}`));
  assert.ok(/security definer/.test(sql) && /set search_path = public/.test(sql));
  assert.ok(/employee_id = current_employee_id\(\)/.test(sql) && /company_id = current_company_id\(\)/.test(sql), 'uniquement les documents du salarié appelant, dans son entreprise');
  assert.ok(/revoke all on function accuser_lecture_document\(text\) from public, anon;/.test(sql));
  assert.ok(/grant execute on function accuser_lecture_document\(text\) to authenticated;/.test(sql));
  assert.ok(!/create policy documents_/.test(sql), 'aucune policy élargie : RLS ne restreint pas par colonne');
  console.log('OK — escalade-privileges-accuse-lecture-09-10.test.js (migration 0066 : RPC limitée aux documents du salarié appelant)');
}

function runLesMappersDocumentsFontLAllerRetour() {
  const { documentToRow, documentFromRow } = loadSupabaseClient();
  const row = documentToRow({ id: 'd1', employeeId: 'e1', categorie: 'Règlement', nom: 'RI', accuseLectureRequis: true, accuseLectureAt: '2026-10-01T10:00:00Z', accuseLecturePar: 'e1', diffusionId: 'diff1' }, 'c1');
  assert.strictEqual(row.accuse_lecture_requis, true);
  assert.strictEqual(row.diffusion_id, 'diff1');
  assert.ok(!('accuse_lecture_at' in row) && !('accuse_lecture_par' in row), 'un upsert RH ne doit jamais écraser la confirmation d\'un salarié (posée par la seule RPC)');
  const back = documentFromRow({ id: 'd1', employee_id: 'e1', categorie: 'Règlement', nom: 'RI', accuse_lecture_requis: true, accuse_lecture_at: '2026-10-01T10:00:00Z', accuse_lecture_par: 'e1', diffusion_id: 'diff1', created_at: '2026-09-30T00:00:00Z' });
  assert.strictEqual(back.accuseLectureRequis, true);
  assert.strictEqual(back.accuseLectureAt, '2026-10-01T10:00:00Z');
  assert.strictEqual(back.accuseLecturePar, 'e1');
  assert.strictEqual(back.diffusionId, 'diff1');
  const vide = documentFromRow({ id: 'd2', employee_id: 'e1', created_at: 'x' });
  assert.strictEqual(vide.accuseLectureRequis, false);
  assert.strictEqual(vide.accuseLectureAt, null);
  console.log('OK — escalade-privileges-accuse-lecture-09-10.test.js (documents : accusé de lecture et diffusion reviennent au rechargement)');
}

try {
  runLaFonctionRefuseLeCompteDuProprietaireAUnTiers();
  runLaMigrationAlignePermissionsEtInsertSurLEcran();
  runLaMigrationAccuseNeDonneAuSalarieQueSesPropresDocuments();
  runLesMappersDocumentsFontLAllerRetour();
} catch (err) {
  console.error('ÉCHEC — escalade-privileges-accuse-lecture-09-10.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
