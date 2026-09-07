/**
 * Seven RH — retour Betty du 07/09/2026 : un salarié qui a créé une demande de congé pour un autre
 * salarié, après avoir récemment utilisé "Vue groupe"/changé de compte, obtenait un échec de
 * synchronisation opaque ("new row violates row-level security policy for table leave_requests"),
 * sans lien apparent avec le changement de compte.
 *
 * Cause : DB.switchToSavedAccount (data.js) bascule la VRAIE session Supabase (auth.uid(), utilisée
 * par toutes les policies RLS) AVANT d'hydrater l'entreprise cible. Si cette hydratation échoue
 * (réseau, ou aucun salarié associé), l'ancien code laissait la session RÉELLE sur le NOUVEAU compte
 * tout en gardant l'écran/le cache local (DB._currentEmployeeId, _companiesCache) sur l'ANCIEN —
 * exactement le genre de désynchronisation qui fait échouer une écriture RLS bien plus tard, sans
 * rapport apparent avec sa cause réelle. Ce test vérifie que la session réelle est désormais
 * explicitement restaurée sur le compte précédent dans ce cas, jamais laissée dans cet état bâtard.
 */
const assert = require('assert');
const { loadDataJs } = require('./load-data-js');

async function run() {
  // ---- 1. hydrateCurrentCompany lève une exception (réseau) après la bascule de session ----
  {
    const { DB, sandbox } = loadDataJs();
    DB._saveSavedAccounts([
      { id: 'compte-origine', email: 'origine@test.fr', session: { access_token: 'tok-origine', refresh_token: 'ref-origine' } },
      { id: 'compte-cible', email: 'cible@test.fr', session: { access_token: 'tok-cible', refresh_token: 'ref-cible' } },
    ]);
    DB._currentAuthUserId = 'compte-origine';

    const switchToSessionCalls = [];
    sandbox.window.SupabaseSync = {
      switchToSession: async (session) => { switchToSessionCalls.push(session.access_token); return { success: true }; },
      hydrateCurrentCompany: async () => { throw new Error('mock : réseau interrompu'); },
    };

    const result = await DB.switchToSavedAccount('compte-cible');

    assert.strictEqual(result.success, false, 'une hydratation en échec doit renvoyer un échec propre, jamais laisser l\'exception remonter');
    assert.ok(result.error.includes('réseau interrompu'), 'le message d\'erreur réel doit être conservé, pas remplacé par un texte générique');
    assert.deepStrictEqual(switchToSessionCalls, ['tok-cible', 'tok-origine'],
      'la session doit basculer vers la cible PUIS être explicitement restaurée vers l\'origine après l\'échec');
    assert.strictEqual(DB._currentAuthUserId, 'compte-origine', 'le compte actif ne doit jamais rester sur la cible après un échec de bascule');
  }

  // ---- 2. hydrateCurrentCompany renvoie null (aucun salarié associé) — même garde-fou ----
  {
    const { DB, sandbox } = loadDataJs();
    DB._saveSavedAccounts([
      { id: 'compte-origine', email: 'origine@test.fr', session: { access_token: 'tok-origine', refresh_token: 'ref-origine' } },
      { id: 'compte-cible', email: 'cible@test.fr', session: { access_token: 'tok-cible', refresh_token: 'ref-cible' } },
    ]);
    DB._currentAuthUserId = 'compte-origine';

    const switchToSessionCalls = [];
    sandbox.window.SupabaseSync = {
      switchToSession: async (session) => { switchToSessionCalls.push(session.access_token); return { success: true }; },
      hydrateCurrentCompany: async () => null,
    };

    const result = await DB.switchToSavedAccount('compte-cible');

    assert.strictEqual(result.success, false);
    assert.deepStrictEqual(switchToSessionCalls, ['tok-cible', 'tok-origine'],
      'un retour null (pas seulement une exception) doit aussi déclencher la restauration de la session d\'origine');
    assert.strictEqual(DB._currentAuthUserId, 'compte-origine');
  }

  console.log('OK — saved-account-switch-rollback.test.js (session réelle restaurée après un échec d\'hydratation, exception ou retour null)');
}

run().catch((err) => {
  console.error('ÉCHEC — saved-account-switch-rollback.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
