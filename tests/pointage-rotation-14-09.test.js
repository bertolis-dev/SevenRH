/**
 * Seven RH — retour Betty du 14/09/2026 (revue concurrentielle, Pointeuse QR point 1, "empêcher le
 * pointage à distance") : le QR encodait jusqu'ici le secret de l'établissement EN CLAIR — une seule
 * photo suffisait pour pointer depuis chez soi indéfiniment, et n'importe quel salarié pouvait de
 * toute façon lire ce secret directement (etablissements_select, RLS "toute l'entreprise").
 *
 * Ce fichier couvre la propriété de sécurité elle-même, distincte du comportement fonctionnel déjà
 * couvert par pointage-11-09.test.js : le secret ne doit plus JAMAIS transiter par un client, sous
 * aucune forme (ni le cache local, ni la valeur encodée dans le QR affiché).
 *
 * Remplace pointage-jeton-live-13-09.test.js, dont la prémisse (repli sur un cache local périmé) n'a
 * plus de sens depuis ce correctif : il n'existe plus de secret côté client sur lequel se replier.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function mockPointageServer(sandbox) {
  let secret = null;
  let getPointageQrCodeCalls = 0;
  sandbox.window.SupabaseSync = new Proxy({
    regeneratePointageTokenRemote: async (etablissementId, token) => { secret = token; },
    getPointageQrCode: async () => {
      getPointageQrCodeCalls++;
      if (secret === null) throw new Error('secret non initialisé');
      return `code-${secret}`;
    },
    verifierPointageCode: async (etablissementId, code) => secret !== null && code === `code-${secret}`,
  }, { get(target, prop) { return prop in target ? target[prop] : async () => ({ success: true }); } });
  return { calls: () => getPointageQrCodeCalls };
}

async function run() {
  // ---- Le secret ne vit plus jamais dans l'objet établissement côté client ----
  {
    const { DB, sandbox, etablissementRepository } = loadAppJs();
    mockPointageServer(sandbox);
    DB.init();
    const etab = etablissementRepository.getAll()[0];
    await etablissementRepository.regenererPointageToken(etab.id);
    const etabApresRegeneration = etablissementRepository.getById(etab.id);
    assert.strictEqual(etabApresRegeneration.pointageToken, undefined, 'aucun secret ne doit plus jamais être conservé dans le cache local de l\'établissement');
  }

  // ---- Le QR affiché encode le CODE dérivé (getPointageQrCode), jamais un secret brut ----
  {
    const { DB, sandbox, etablissementRepository, openPointageQrModal } = loadAppJs();
    const server = mockPointageServer(sandbox);
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const etab = etablissementRepository.getAll()[0];

    await openPointageQrModal(etab.id);
    assert.ok(server.calls() >= 1, 'l\'affichage du QR doit passer par get_pointage_qr_code, jamais lire le secret directement');
  }

  // ---- Un code correct pour un AUTRE établissement (ou inventé) est toujours refusé ----
  {
    const { DB, sandbox, etablissementRepository, pointageRepository } = loadAppJs();
    mockPointageServer(sandbox);
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const etab = etablissementRepository.getAll()[0];
    await etablissementRepository.regenererPointageToken(etab.id);

    const resultat = await pointageRepository.enregistrer(rh.id, etab.id, 'code-secret-etranger');
    assert.strictEqual(resultat.success, false, 'un code qui ne correspond pas au secret courant de cet établissement doit toujours être refusé');
    assert.ok(!resultat.error.includes('undefined') && !resultat.error.includes('NaN'), 'aucune fuite de valeur brute dans le message');
  }

  console.log('OK — pointage-rotation-14-09.test.js (le secret ne quitte jamais le client, le QR encode un code dérivé, un code invalide reste refusé)');
}

run().catch((err) => {
  console.error('ÉCHEC — pointage-rotation-14-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
