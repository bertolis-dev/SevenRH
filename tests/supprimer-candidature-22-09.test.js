/**
 * §retour Betty du 22/09/2026 : "on a fait des tests dans les candidatures reçues et je ne peux pas
 * les supprimer. Ce serait bien de pouvoir supprimer les candidatures reçues."
 *
 * La table candidatures (0024) n'avait qu'une policy SELECT : aucune suppression n'était possible,
 * et "Archivée" ne faisait que déplacer la carte dans une autre colonne.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const appJs = lire('app.js');
const dataJs = lire('data.js');
const clientJs = lire('supabase-client.js');
const sql = lire('supabase/migrations/0063_supprimer_candidature.sql');

function test(nom, fn) {
  try { fn(); console.log(`OK — supprimer-candidature-22-09.test.js (${nom})`); }
  catch (e) { console.error(`ÉCHEC — ${nom}`); throw e; }
}

test('la suppression passe par une fonction dédiée, jamais une policy DELETE générique', () => {
  assert.ok(sql.includes('create or replace function delete_candidature(p_id uuid)'));
  assert.ok(sql.includes('security definer'), 'même patron que set_candidature_statut');
  assert.ok(!/create policy candidatures_delete/.test(sql),
    'une policy DELETE générique laisserait un .delete() direct contourner la règle');
});

test('la fonction vérifie l\'entreprise ET la permission', () => {
  assert.ok(sql.includes("v_company_id <> current_company_id()"), 'cloisonnement par entreprise');
  assert.ok(sql.includes("has_permission('creerSalarie')"), 'même droit que pour embaucher ou archiver');
});

test('elle n\'est pas exécutable sans authentification', () => {
  assert.ok(sql.includes('revoke all on function delete_candidature(uuid) from public, anon;'));
  assert.ok(sql.includes('grant execute on function delete_candidature(uuid) to authenticated;'));
});

test('les fichiers déposés sont retirés du stockage, pas seulement la ligne', () => {
  assert.ok(sql.includes('returns table(cv_path text, lettre_path text)'),
    'la fonction rend les chemins à l\'appelant');
  const i = clientJs.indexOf('async function supprimerCandidature');
  const corps = clientJs.slice(i, i + 900);
  assert.ok(corps.includes("storage.from('candidatures-files').remove("), 'retrait des fichiers attendu');
  assert.ok(corps.includes('catch'), 'un échec sur les fichiers ne doit pas masquer la suppression réussie');
});

test('le dépôt expose la suppression, distincte de l\'archivage', () => {
  assert.ok(dataJs.includes('supprimer: (id) => window.SupabaseSync.supprimerCandidature(id)'));
  assert.ok(dataJs.includes("archiver: (id) => window.SupabaseSync.setCandidatureStatut(id, 'archivee', null)"),
    'archiver reste disponible : les deux ne font pas la même chose');
});

test('le bouton demande confirmation et oriente vers l\'archivage', () => {
  assert.ok(appJs.includes('data-supprimer-candidature='), 'bouton attendu sur la carte');
  const i = appJs.indexOf("data-supprimer-candidature]').forEach");
  const corps = appJs.slice(i, i + 1200);
  assert.ok(corps.includes('openConfirm('), 'confirmation attendue');
  assert.ok(corps.includes('danger: true'));
  assert.ok(corps.includes('Archivée'), 'la confirmation rappelle l\'alternative non destructive');
  assert.ok(corps.includes('evt.stopPropagation()'), 'le clic ne doit pas aussi ouvrir la candidature');
});

test('cliquer sur Supprimer n\'ouvre pas le détail de la candidature', () => {
  assert.ok(appJs.includes("if (evt.target.closest('[data-supprimer-candidature]')) return;"));
});
