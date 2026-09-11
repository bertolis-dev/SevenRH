/**
 * Seven RH — faux IndexedDB minimal pour tester le VRAI chemin IndexedDB de DB.init()/saveCompanies()
 * /_purgeLocalCompanyCache() (§retour Betty du 11/09/2026, point 1 étape 1), sans navigateur réel.
 * Ne couvre QUE le sous-ensemble utilisé par data.js (idbOpen/idbGet/idbSet/idbDelete) : un seul
 * object store nommé, get/put/delete par clé, complétion de transaction — pas une émulation
 * complète de la spec IndexedDB. Les callbacks sont toujours déclenchés en microtâche (jamais
 * synchrone), comme un vrai IndexedDB, pour révéler tout bug d'ordonnancement qu'un mock synchrone
 * masquerait.
 */
function createFakeIndexedDB() {
  const databases = new Map(); // nom de base -> Map(store -> Map(clé -> valeur))

  function getStoreMap(dbName, storeName) {
    if (!databases.has(dbName)) databases.set(dbName, new Map());
    const db = databases.get(dbName);
    if (!db.has(storeName)) db.set(storeName, new Map());
    return db.get(storeName);
  }

  return {
    _databases: databases, // accès direct depuis les tests, pour vérifier ce qui a été réellement persisté
    open(name) {
      const isFirstOpen = !databases.has(name);
      const req = {};
      queueMicrotask(() => {
        const fakeDb = {
          objectStoreNames: { contains: (s) => databases.has(name) && databases.get(name).has(s) },
          createObjectStore(storeName) { getStoreMap(name, storeName); },
          transaction(storeName) {
            const storeMap = getStoreMap(name, storeName);
            const store = {
              get(key) {
                const r = {};
                queueMicrotask(() => { r.result = storeMap.get(key); if (r.onsuccess) r.onsuccess(); });
                return r;
              },
              put(value, key) { storeMap.set(key, value); },
              delete(key) { storeMap.delete(key); },
            };
            const tx = { objectStore: () => store };
            queueMicrotask(() => { if (tx.oncomplete) tx.oncomplete(); });
            return tx;
          },
        };
        req.result = fakeDb;
        if (isFirstOpen && req.onupgradeneeded) req.onupgradeneeded();
        if (req.onsuccess) req.onsuccess();
      });
      return req;
    },
  };
}

module.exports = { createFakeIndexedDB };
