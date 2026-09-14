/**
 * Seven RH — retour Betty du 13/09/2026 : cause RÉELLE du "QR de pointage toujours rejeté, même
 * sur le même appareil/compte", trouvée après deux correctifs infructueux sur le TIMING (cache
 * client périmé, puis course d'écriture). Le vrai problème : etablissements_write
 * (0002_rls_policies.sql) exige la permission gererParametres pour TOUTE écriture sur
 * etablissements — mais le bouton "QR de pointage" (écran Pointeuse) est explicitement montré aux
 * MANAGERS (§retour Betty du 11/09/2026, "pour le directeur et les manageurs"), qui n'ont PAS cette
 * permission par défaut (DEFAULT_ROLE_PERMISSIONS). La régénération s'écrivait donc en local, mais
 * la synchronisation générique vers Supabase (pushEtablissements, gated par cette même policy)
 * échouait SILENCIEUSEMENT pour un manager : le jeton n'atteignait jamais le serveur.
 *
 * Ce test simule exactement ça : pushEtablissements (la synchronisation générique) échoue comme le
 * ferait un vrai rejet RLS pour un manager, mais regenerate_pointage_token (la fonction dédiée,
 * 0050_regenerate_pointage_token_rpc.sql — non testable en RLS réel ici, voir
 * pointage-rpc-grants-13-09.test.js pour la vérification statique du verrouillage anon/authenticated)
 * réussit quand même — la régénération ne doit plus JAMAIS dépendre du chemin générique bloqué.
 *
 * §retour Betty du 14/09/2026 (revue concurrentielle, Pointeuse QR point 1) : mocks mis à jour pour
 * le nouveau mécanisme (code dérivé plutôt que jeton fixe comparé directement), le comportement testé
 * (le manager régénère via la fonction dédiée, jamais bloqué par la policy générique) est inchangé.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function run() {
  const { DB, sandbox, etablissementRepository, pointageRepository } = loadAppJs();

  let regenerateRpcCalls = 0;
  let secretCoteServeur = null;
  sandbox.window.SupabaseSync = new Proxy({
    // Simule le rejet RLS réel pour un manager (gererParametres manquant) : la synchronisation
    // générique d'établissements échoue, exactement comme avant ce correctif.
    pushEtablissements: async () => { throw new Error('new row violates row-level security policy for table "etablissements"'); },
    regeneratePointageTokenRemote: async (etablissementId, token) => { regenerateRpcCalls++; secretCoteServeur = token; },
    getPointageQrCode: async () => { if (secretCoteServeur === null) throw new Error('secret non initialisé'); return `code-${secretCoteServeur}`; },
    verifierPointageCode: async (etablissementId, code) => secretCoteServeur !== null && code === `code-${secretCoteServeur}`,
  }, { get(target, prop) { return prop in target ? target[prop] : async () => ({ success: true }); } });

  DB.init();
  const manager = DB.getEmployees().find(e => e.role === 'manager');
  DB._currentEmployeeId = manager.id;
  const etab = etablissementRepository.getAll()[0];

  await etablissementRepository.regenererPointageToken(etab.id);

  assert.strictEqual(regenerateRpcCalls, 1, 'la régénération doit passer par la fonction dédiée (regenerate_pointage_token), pas par la synchronisation générique bloquée par RLS pour un manager');
  const code = await sandbox.window.SupabaseSync.getPointageQrCode(etab.id);
  assert.ok(code, 'le secret doit atteindre le serveur via la fonction dédiée, même si la synchronisation générique échoue');

  const resultat = await pointageRepository.enregistrer(manager.id, etab.id, code);
  assert.strictEqual(resultat.success, true, 'un manager doit pouvoir scanner un QR qu\'il vient lui-même de générer, malgré son absence de gererParametres');

  console.log('OK — pointage-manager-rls-13-09.test.js (régénération par un manager passe par la fonction dédiée, jamais bloquée par la policy RLS générique)');
}

run().catch((err) => {
  console.error('ÉCHEC — pointage-manager-rls-13-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
