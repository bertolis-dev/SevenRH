/**
 * Seven RH — retour Betty du 11/09/2026 (point 1, étape 1 : "plafond de taille bas") : ROOT_KEY (le
 * blob "companies", de très loin le plus volumineux) déménage de localStorage (quota fixe ~5-10 Mo,
 * déjà mesuré comme dépassé en 1 à 3 ans pour 50-250 salariés) vers IndexedDB (couramment plusieurs
 * centaines de Mo). Tous les autres tests de cette suite exercent le repli synchrone localStorage
 * (aucun IndexedDB dans le bac à sable Node par défaut, voir load-data-js.js) — ce fichier est le
 * seul à injecter un faux IndexedDB (tests/fake-indexeddb.js) pour vérifier le VRAI chemin :
 * migration silencieuse d'un ancien blob localStorage, écriture/lecture round-trip, et purge à la
 * déconnexion qui ne doit plus laisser de donnée lisible sur disque (même exigence de sécurité que
 * pour localStorage, correctif du 23/08/2026).
 */
const assert = require('assert');
const { loadDataJs } = require('./load-data-js');
const { createFakeIndexedDB } = require('./fake-indexeddb');

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function run() {
  // ---- Premier lancement, IndexedDB disponible dès le départ : seed écrit dans IndexedDB, pas
  // seulement en mémoire ----
  {
    const fakeIdb = createFakeIndexedDB();
    const { DB, idbGet, ROOT_KEY } = loadDataJs({ indexedDB: fakeIdb });
    await DB.init();
    const companies = DB.getCompanies();
    assert.strictEqual(companies.length, 1, 'premier lancement : une entreprise de démonstration semée comme avant');

    const fromIdb = await idbGet(ROOT_KEY);
    assert.ok(Array.isArray(fromIdb) && fromIdb.length === 1, 'la donnée semée doit être écrite dans IndexedDB, pas seulement dans le cache mémoire');
    assert.strictEqual(fromIdb[0].id, companies[0].id);
  }

  // ---- Migration d'un ancien blob localStorage (navigateur ayant déjà utilisé l'app avant ce
  // correctif) : la donnée doit survivre intacte, finir dans IndexedDB, et disparaître de
  // localStorage (jamais les deux copies en même temps une fois la migration confirmée) ----
  {
    const fakeIdb = createFakeIndexedDB();
    const { DB, sandbox, idbGet, ROOT_KEY, HAS_RUN_BEFORE_KEY } = loadDataJs({ indexedDB: fakeIdb });
    const legacyCompany = { id: 'legacy-co', raisonSociale: 'Ancienne donnée localStorage', employees: [] };
    sandbox.localStorage.setItem(ROOT_KEY, JSON.stringify([legacyCompany]));
    // Simule un navigateur qui a déjà servi (sinon DB.init() re-sèmerait une fausse entreprise de
    // démo par-dessus, comme pour tout premier lancement — hors sujet ici).
    sandbox.localStorage.setItem(HAS_RUN_BEFORE_KEY, '1');

    await DB.init();

    assert.strictEqual(DB.getCompanies().length, 1, 'la donnée existante doit être reprise telle quelle, jamais réensemencée par-dessus');
    assert.strictEqual(DB.getCompanies()[0].id, 'legacy-co');

    const fromIdb = await idbGet(ROOT_KEY);
    assert.ok(fromIdb && fromIdb[0] && fromIdb[0].id === 'legacy-co', 'la donnée migrée doit être relisible directement depuis IndexedDB');
    assert.strictEqual(sandbox.localStorage.getItem(ROOT_KEY), null, 'localStorage doit être vidé une fois la copie IndexedDB confirmée (jamais les deux copies à la fois)');
  }

  // ---- Round-trip normal : DB.saveCompanies() persiste bien dans IndexedDB en tâche de fond
  // (jamais bloquant pour l'appelant, qui reste synchrone) ----
  {
    const fakeIdb = createFakeIndexedDB();
    const { DB, idbGet, ROOT_KEY } = loadDataJs({ indexedDB: fakeIdb });
    await DB.init();
    const companies = DB.getCompanies();
    companies[0].raisonSociale = 'Renommée pendant le test';
    DB.saveCompanies(companies); // synchrone du point de vue de l'appelant, comme avant ce correctif

    // Le cache mémoire est déjà à jour de façon synchrone, sans attendre IndexedDB.
    assert.strictEqual(DB.getCompanies()[0].raisonSociale, 'Renommée pendant le test');

    await flush();
    const fromIdb = await idbGet(ROOT_KEY);
    assert.strictEqual(fromIdb[0].raisonSociale, 'Renommée pendant le test', 'la modification doit finir par atteindre IndexedDB, même si saveCompanies() ne l\'attend pas');
  }

  // ---- Purge (déconnexion, connexion refusée) : ne doit plus rien laisser lisible dans
  // IndexedDB, même exigence de sécurité que pour localStorage (poste RH partagé) ----
  {
    const fakeIdb = createFakeIndexedDB();
    const { DB, idbGet, ROOT_KEY } = loadDataJs({ indexedDB: fakeIdb });
    await DB.init();
    await flush();
    assert.ok(await idbGet(ROOT_KEY), 'sanity : la donnée doit bien être en IndexedDB avant la purge');

    await DB._purgeLocalCompanyCache();

    assert.strictEqual(DB.getCompanies().length, 0, 'le cache mémoire doit être vidé par la purge');
    const fromIdbAfterPurge = await idbGet(ROOT_KEY);
    assert.ok(fromIdbAfterPurge === null || (Array.isArray(fromIdbAfterPurge) && fromIdbAfterPurge.length === 0), 'IndexedDB ne doit plus contenir de donnée d\'entreprise lisible après la purge');
  }

  // ---- Sans IndexedDB (bac à sable par défaut, tous les autres tests de la suite) : comportement
  // inchangé, jamais un `await` réellement atteint ----
  {
    const { DB, idbAvailable } = loadDataJs();
    assert.strictEqual(idbAvailable(), false, 'sans IndexedDB injecté, idbAvailable() doit rester false (repli synchrone total)');
    DB.init(); // volontairement SANS await, comme le fait toute la suite de tests existante
    assert.strictEqual(DB.getCompanies().length, 1, 'DB.init() doit rester utilisable sans await quand IndexedDB est indisponible');
  }

  console.log('OK — indexeddb-storage-11-09.test.js (migration localStorage → IndexedDB, round-trip, purge à la déconnexion, repli synchrone préservé)');
}

run().catch((err) => {
  console.error('ÉCHEC — indexeddb-storage-11-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
