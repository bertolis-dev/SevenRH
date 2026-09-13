/**
 * Seven RH — retour Betty du 13/09/2026 ("ça marche toujours pas", même compte/appareil pour
 * générer ET scanner) : le premier correctif du jour (vérifier le jeton EN DIRECT côté serveur,
 * voir pointage-jeton-live-13-09.test.js) réglait un cache client périmé, mais ouvrait une NOUVELLE
 * course dans l'autre sens — regenererPointageToken synchronise le nouveau jeton vers Supabase EN
 * ARRIÈRE-PLAN (jamais attendu, comportement voulu pour la plupart des écritures de l'app) : scanner
 * un QR tout juste généré pouvait arriver AVANT que le serveur n'ait reçu ce nouveau jeton, et être
 * rejeté par la toute nouvelle vérification en direct — alors même que rien n'avait jamais quitté
 * le même appareil/compte.
 *
 * Ce fichier simule un "serveur" en mémoire (le dernier jeton reçu par pushEtablissements) pour
 * vérifier que regenererPointageToken() ATTEND bien cette synchronisation avant de renvoyer le
 * nouveau jeton — un scan immédiatement après doit donc toujours réussir, sans dépendre d'un délai
 * arbitraire.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function run() {
  const { DB, sandbox, etablissementRepository, pointageRepository } = loadAppJs();

  // "Serveur" en mémoire : ne connaît que ce que pushEtablissements lui a explicitement transmis.
  let jetonCoteServeur = null;
  sandbox.window.SupabaseSync = new Proxy({
    pushEtablissements: async (list) => {
      const etab = list[0];
      jetonCoteServeur = etab ? etab.pointageToken : null;
    },
    getEtablissementPointageToken: async () => jetonCoteServeur,
  }, { get(target, prop) { return prop in target ? target[prop] : async () => ({ success: true }); } });

  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;
  const etab = etablissementRepository.getAll()[0];

  const token = await etablissementRepository.regenererPointageToken(etab.id);

  // Le "serveur" doit déjà connaître ce jeton une fois regenererPointageToken() résolue — pas
  // besoin d'attendre quoi que ce soit d'autre avant de considérer le QR utilisable.
  assert.strictEqual(jetonCoteServeur, token, 'la synchronisation vers le serveur doit être terminée avant que regenererPointageToken() ne renvoie');

  const resultat = await pointageRepository.enregistrer(rh.id, etab.id, token);
  assert.strictEqual(resultat.success, true, 'un scan immédiatement après la génération doit réussir : le serveur a déjà le jeton à jour, pas de course possible');

  console.log('OK — pointage-regeneration-sync-13-09.test.js (régénération attend la synchronisation serveur, un scan immédiat après génération réussit toujours)');
}

run().catch((err) => {
  console.error('ÉCHEC — pointage-regeneration-sync-13-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
