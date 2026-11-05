/**
 * Seven RH — tour des bugs du 28/10/2026 : une modification refusée par une politique de sécurité (RLS) renvoie 0 ligne SANS erreur ; l'écran affichait un
 * succès et la modification disparaissait au rechargement. updateRows et deleteRow signalent maintenant un vrai refus (la ligne existe sur le serveur mais
 * n'a pas été touchée), sans jamais bloquer la file de synchronisation pour une ligne simplement absente (déjà supprimée, jamais envoyée).
 */
const assert = require('assert');
const { loadSupabaseClient } = require('./load-supabase-client');

/** Faux serveur : `lignes` = ids présents ; `refus` = ids que la RLS refuse de modifier ou supprimer (sans erreur, comme le vrai Postgres). */
function fauxServeur({ lignes, refus = [], erreur = null }) {
  const presentes = new Set(lignes);
  const refusees = new Set(refus);
  const journal = [];
  function builder(table) {
    const etat = { table, op: null, filtres: {} };
    const b = {
      update() { etat.op = 'update'; return b; },
      delete() { etat.op = 'delete'; return b; },
      select() { if (!etat.op) etat.op = 'select'; return b; },
      eq(k, v) { etat.filtres[k] = v; return b; },
      limit() { return b; },
      then(resolve) {
        journal.push({ op: etat.op, id: etat.filtres.id });
        const id = etat.filtres.id;
        if (erreur) return resolve({ data: null, error: erreur });
        if (etat.op === 'select') return resolve({ data: presentes.has(id) ? [{ id }] : [], error: null });
        if (!presentes.has(id) || refusees.has(id)) return resolve({ data: [], error: null });
        if (etat.op === 'delete') presentes.delete(id);
        return resolve({ data: [{ id }], error: null });
      }
    };
    return b;
  }
  return { client: { from: builder, auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }, journal, presentes };
}

async function rejette(promesse) {
  try { await promesse; } catch (e) { return e; }
  return null;
}

async function run() {
  const formation = (id) => ({ id, employeeId: 'e1', intitule: 'Excel avancé', organisme: '', financement: 'entreprise', statut: 'demandee', historique: [], dateCreation: '2026-11-05T10:00:00.000Z', dateModification: '2026-11-05T10:00:00.000Z' });

  // --- Modification acceptée : aucun bruit ---
  let serveur = fauxServeur({ lignes: ['f1'] });
  let { sandbox } = loadSupabaseClient({ supabase: serveur.client });
  assert.strictEqual(await rejette(sandbox.window.SupabaseSync.updateFormation(formation('f1'), 'C1')), null, 'modification acceptée');

  // --- Modification refusée par la RLS (la ligne existe, 0 ligne touchée) : erreur claire ---
  serveur = fauxServeur({ lignes: ['f1'], refus: ['f1'] });
  ({ sandbox } = loadSupabaseClient({ supabase: serveur.client }));
  const refus = await rejette(sandbox.window.SupabaseSync.updateFormation(formation('f1'), 'C1'));
  assert.ok(refus && /refusée par le serveur/.test(refus.message), 'un refus de droits ne passe plus pour un succès : ' + (refus && refus.message));
  assert.strictEqual(refus.refusDroits, true, 'l\'erreur est marquée « refus de droits »');

  // --- Ligne absente du serveur (déjà supprimée, jamais envoyée) : pas d'erreur, la file ne boucle pas ---
  serveur = fauxServeur({ lignes: [] });
  ({ sandbox } = loadSupabaseClient({ supabase: serveur.client }));
  assert.strictEqual(await rejette(sandbox.window.SupabaseSync.updateFormation(formation('f9'), 'C1')), null, 'ligne absente : pas de blocage');

  // --- Suppression ---
  serveur = fauxServeur({ lignes: ['d1'] });
  ({ sandbox } = loadSupabaseClient({ supabase: serveur.client }));
  assert.strictEqual(await rejette(sandbox.window.SupabaseSync.deleteRow('leave_requests', 'd1', 'C1')), null, 'suppression acceptée');
  assert.ok(!serveur.presentes.has('d1'), 'la ligne est bien supprimée');
  assert.strictEqual(await rejette(sandbox.window.SupabaseSync.deleteRow('leave_requests', 'd1', 'C1')), null, 'supprimer deux fois la même ligne reste un succès');

  serveur = fauxServeur({ lignes: ['d2'], refus: ['d2'] });
  ({ sandbox } = loadSupabaseClient({ supabase: serveur.client }));
  const refusSuppression = await rejette(sandbox.window.SupabaseSync.deleteRow('leave_requests', 'd2', 'C1'));
  assert.ok(refusSuppression && /Suppression refusée/.test(refusSuppression.message), 'suppression refusée par la RLS signalée');
  assert.ok(serveur.presentes.has('d2'), 'la ligne est toujours là (refus réel)');

  // --- Une vraie erreur du serveur reste remontée telle quelle ---
  serveur = fauxServeur({ lignes: ['f1'], erreur: new Error('permission denied') });
  ({ sandbox } = loadSupabaseClient({ supabase: serveur.client }));
  const erreur = await rejette(sandbox.window.SupabaseSync.updateFormation(formation('f1'), 'C1'));
  assert.ok(erreur && erreur.message === 'permission denied', 'erreur serveur conservée');

  // --- Côté données : un refus de droits prévient l'utilisateur mais ne remet pas l'écriture en file (elle échouerait indéfiniment) ---
  const { loadAppJs } = require('./load-app-js');
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  const company = api.DB.getCurrentCompany();
  let message = null;
  api.DB.onSaveError = (m) => { message = m; };
  const descripteur = { kind: 'delete', table: 'leave_requests', companyId: company.id, id: 'x1' };
  api.DB._pushInBackground(Promise.reject(Object.assign(new Error('refus'), { refusDroits: true })), descripteur);
  await new Promise(r => setTimeout(r, 20));
  assert.ok(message && /vos droits ne permettent pas/.test(message), 'l\'utilisateur est prévenu d\'un refus de droits');
  assert.ok(!(api.DB._pendingSync || {})[company.id] || !(api.DB._pendingSync[company.id]['delete:leave_requests:x1']), 'pas de remise en file indéfinie');
  message = null;
  api.DB._pushInBackground(Promise.reject(new Error('réseau coupé')), descripteur);
  await new Promise(r => setTimeout(r, 20));
  assert.ok(message && /Échec de synchronisation en ligne/.test(message), 'une panne réseau garde l\'ancien comportement (remise en file)');

  console.log('OK — sync-refus-silencieux-05-11.test.js (refus RLS signalé, ligne absente sans blocage, erreurs conservées)');
}

run().catch(err => { console.error('ÉCHEC — sync-refus-silencieux-05-11.test.js'); console.error(err.stack || err.message); process.exitCode = 1; });
