/**
 * Seven RH — retour Betty du 13/09/2026 ("le QR de la pointeuse ne marche pas, ça met invalide/
 * expiré") : DB.enregistrerPointage comparait le jeton scanné au SEUL cache local de l'APPAREIL QUI
 * SCANNE, hydraté uniquement à la connexion (hydrateCurrentCompany). Un salarié dont la session
 * reste ouverte longtemps (le cas normal d'un téléphone qui sert de pointeuse toute la journée) ne
 * revoit jamais un jeton régénéré (ou apparu pour la première fois, comme au lancement même de
 * cette fonctionnalité) tant qu'il ne se reconnecte pas — d'où un QR pourtant valide rejeté.
 *
 * Ce fichier couvre le nouveau comportement : le jeton est désormais vérifié contre la valeur RÉELLE
 * côté serveur (getEtablissementPointageToken), avec repli sur le cache local seulement si cette
 * vérification en ligne échoue (réseau indisponible) — voir aussi pointage-11-09.test.js pour la
 * couverture déjà existante (calcul de durée, enchaînement arrivée/départ...), inchangée par ce
 * correctif (mocks ajustés pour continuer à simuler un réseau indisponible, comportement identique).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function run() {
  // ---- Cache local périmé (le cas réel de Betty) : le serveur a un jeton plus récent que celui
  // encore connu de cet appareil — le scan doit réussir en se fiant à la valeur SERVEUR, jamais au
  // cache local périmé ----
  {
    const { DB, sandbox, etablissementRepository, pointageRepository } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const etab = etablissementRepository.getAll()[0];

    // Cache local de CET appareil : encore sur l'ANCIEN jeton (jamais rafraîchi depuis).
    const ancienJetonLocal = await etablissementRepository.regenererPointageToken(etab.id);
    // Le serveur, lui, a déjà un jeton plus récent (régénéré depuis un autre appareil/session) —
    // jamais reflété dans le cache de CET appareil tant qu'il ne se reconnecte pas.
    const nouveauJetonServeur = 'pqr_plus_recent_cote_serveur';
    sandbox.window.SupabaseSync = new Proxy({
      getEtablissementPointageToken: async () => nouveauJetonServeur,
    }, { get(target, prop) { return prop in target ? target[prop] : async () => ({ success: true }); } });

    const echecAvecAncienJetonLocal = await pointageRepository.enregistrer(rh.id, etab.id, ancienJetonLocal);
    assert.strictEqual(echecAvecAncienJetonLocal.success, false, 'un QR affichant l\'ancien jeton (déjà remplacé côté serveur) doit être refusé, même s\'il correspond encore au cache local périmé de cet appareil');

    const succesAvecNouveauJeton = await pointageRepository.enregistrer(rh.id, etab.id, nouveauJetonServeur);
    assert.strictEqual(succesAvecNouveauJeton.success, true, 'un QR affichant le jeton RÉEL côté serveur doit être accepté, même si le cache local de cet appareil ne le connaît pas encore (c\'est exactement le bug signalé par Betty)');
  }

  // ---- Réseau indisponible pendant la vérification en ligne : repli sur le cache local plutôt
  // qu'un pointage bloqué pour une simple coupure passagère ----
  {
    const { DB, sandbox, etablissementRepository, pointageRepository } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const etab = etablissementRepository.getAll()[0];
    const token = await etablissementRepository.regenererPointageToken(etab.id);

    sandbox.window.SupabaseSync = new Proxy({
      getEtablissementPointageToken: async () => { throw new Error('réseau indisponible'); },
    }, { get(target, prop) { return prop in target ? target[prop] : async () => ({ success: true }); } });

    const resultat = await pointageRepository.enregistrer(rh.id, etab.id, token);
    assert.strictEqual(resultat.success, true, 'une vérification en ligne qui échoue (réseau) ne doit jamais bloquer un pointage dont le jeton correspond au cache local');
  }

  console.log('OK — pointage-jeton-live-13-09.test.js (jeton vérifié en ligne, jamais bloqué par un cache local périmé, repli si réseau indisponible)');
}

run().catch((err) => {
  console.error('ÉCHEC — pointage-jeton-live-13-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
