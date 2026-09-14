/**
 * Seven RH — retour Betty du 13/09/2026 ("ça marche toujours pas", même compte/appareil pour
 * générer ET scanner) : regenererPointageToken synchronise le secret vers Supabase — scanner un QR
 * tout juste généré pouvait arriver AVANT que le serveur n'ait reçu ce nouveau secret, et être rejeté
 * — alors même que rien n'avait jamais quitté le même appareil/compte.
 *
 * §retour Betty du 14/09/2026 (revue concurrentielle, Pointeuse QR point 1) : mocks mis à jour pour
 * le nouveau mécanisme (code dérivé, rotatif, vérifié par verifier_pointage_code — voir
 * pointage-rotation-14-09.test.js pour la propriété de sécurité elle-même) ; le comportement testé
 * ici (regenererPointageToken ATTEND la synchronisation avant de renvoyer) est inchangé.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function run() {
  const { DB, sandbox, etablissementRepository, pointageRepository } = loadAppJs();

  // "Serveur" en mémoire : ne connaît que ce que regeneratePointageTokenRemote lui a transmis.
  let secretCoteServeur = null;
  sandbox.window.SupabaseSync = new Proxy({
    regeneratePointageTokenRemote: async (etablissementId, token) => { secretCoteServeur = token; },
    getPointageQrCode: async () => { if (secretCoteServeur === null) throw new Error('secret non initialisé'); return `code-${secretCoteServeur}`; },
    verifierPointageCode: async (etablissementId, code) => secretCoteServeur !== null && code === `code-${secretCoteServeur}`,
  }, { get(target, prop) { return prop in target ? target[prop] : async () => ({ success: true }); } });

  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;
  const etab = etablissementRepository.getAll()[0];

  await etablissementRepository.regenererPointageToken(etab.id);

  // Le "serveur" doit déjà connaître ce secret une fois regenererPointageToken() résolue — pas
  // besoin d'attendre quoi que ce soit d'autre avant que le QR devienne utilisable.
  const code = await sandbox.window.SupabaseSync.getPointageQrCode(etab.id);
  assert.ok(code, 'la synchronisation vers le serveur doit être terminée avant que regenererPointageToken() ne renvoie');

  const resultat = await pointageRepository.enregistrer(rh.id, etab.id, code);
  assert.strictEqual(resultat.success, true, 'un scan immédiatement après la génération doit réussir : le serveur a déjà le secret à jour, pas de course possible');

  console.log('OK — pointage-regeneration-sync-13-09.test.js (régénération attend la synchronisation serveur, un scan immédiat après génération réussit toujours)');
}

run().catch((err) => {
  console.error('ÉCHEC — pointage-regeneration-sync-13-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
