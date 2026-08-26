/**
 * Seven RH — teste le point 2.6 (retour QA du 26/08/2026) : file de re-tentative pour les
 * écritures Supabase en arrière-plan qui échouent. Avant ce correctif, un échec réseau ne laissait
 * aucune trace exploitable (juste un compteur en mémoire, jamais persisté, jamais rejoué) — voir
 * l'historique git de _pushInBackground (data.js) pour le commentaire tel qu'il était avant.
 *
 * Couverture volontairement large car ce mécanisme touche 26 points d'écriture différents :
 * - persistance de la file à travers un "rechargement" (relecture depuis le localStorage simulé) ;
 * - reprise EXACTE (jamais un simple compteur) : la nouvelle tentative doit relire l'état ACTUEL du
 *   cache local pour les identifiants en attente, jamais une copie figée au moment de l'échec ;
 * - jamais d'upsert combiné insertion+mise à jour pour les tables à policies RLS asymétriques
 *   (employees, leave_requests, telework_requests, expenses, support_tickets, entretiens) — voir le
 *   commentaire au-dessus d'ID_CLASSIFIED_TABLES/INSERT_ONLY_TABLES dans data.js ;
 * - une insertion qui a en réalité déjà réussi (23505, conflit de clé) doit être traitée comme un
 *   succès, jamais comme un échec permanent qui bloquerait la file indéfiniment ;
 * - une suppression locale entre l'échec initial et la nouvelle tentative ne doit jamais faire
 *   planter ni renvoyer une donnée obsolète.
 */
const assert = require('assert');
const { loadDataJs } = require('./load-data-js');

async function run() {
  // ---- 1. fullResync : une table simple (etablissements) échoue puis réussit à la retentative ----
  {
    const { sandbox, DB } = loadDataJs();
    DB.init();
    const company = DB.getCurrentCompany();
    let pushCalls = 0;
    sandbox.window.SupabaseSync = new Proxy({}, {
      get(target, prop) {
        if (prop !== 'pushEtablissements') return async () => ({ success: true });
        return async () => { pushCalls++; throw new Error('mock : échec réseau'); };
      },
    });

    DB.saveEtablissements([...DB.getEtablissements(), { id: 'etab-x', nom: 'Nouveau site' }]);
    await new Promise(r => setTimeout(r, 10)); // laisse la promesse .catch() s'exécuter
    assert.strictEqual(DB.getPendingSyncCount(company.id), 1, 'un échec doit créer exactement une entrée en attente');

    // Simule un rechargement de page : la file en mémoire disparaît, seule celle du localStorage compte.
    DB._pendingSync = undefined;
    assert.strictEqual(DB.getPendingSyncCount(company.id), 1, 'la file doit survivre à un "rechargement" (relecture localStorage)');

    // La retentative réussit cette fois.
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    const result = await DB.retryPendingSyncNow(company.id);
    assert.strictEqual(result.attempted, 1);
    assert.strictEqual(result.resolved, 1);
    assert.strictEqual(DB.getPendingSyncCount(company.id), 0, 'une retentative réussie doit vider la file');
  }

  // ---- 2. idClassified : reprend l'état ACTUEL, pas une copie figée au moment de l'échec ----
  {
    const { sandbox, DB } = loadDataJs();
    DB.init();
    const company = DB.getCurrentCompany();
    const salarie = company.employees.find(e => e.role === 'salarie');

    let capturedArgs = null;
    let attempt = 0; // hors du get() du Proxy : sinon un nouveau compteur à 0 est recréé à chaque accès à la propriété.
    sandbox.window.SupabaseSync = new Proxy({}, {
      get(target, prop) {
        if (prop !== 'pushEmployees') return async () => ({ success: true });
        return async (args) => {
          attempt++;
          if (attempt === 1) throw new Error('mock : échec réseau');
          capturedArgs = args;
          return { success: true };
        };
      },
    });

    // Échec initial avec un premier commentaire de poste.
    const employeesV1 = company.employees.map(e => e.id === salarie.id ? { ...e, poste: 'Poste V1' } : e);
    DB.saveEmployees(employeesV1);
    await new Promise(r => setTimeout(r, 10));
    assert.strictEqual(DB.getPendingSyncCount(company.id), 1);

    // Nouvelle modification LOCALE avant toute nouvelle tentative — la retentative doit repartir de
    // CETTE valeur, jamais de "Poste V1" figé au moment de l'échec.
    const employeesV2 = DB.getEmployees().map(e => e.id === salarie.id ? { ...e, poste: 'Poste V2 (plus récent)' } : e);
    DB.saveCurrentCompany(Object.assign(DB.getCurrentCompany(), { employees: employeesV2 }));

    await DB.retryPendingSyncNow(company.id);
    assert.ok(capturedArgs, 'la nouvelle tentative doit avoir effectivement rappelé pushEmployees');
    const modifiedSarah = capturedArgs.modified.find(e => e.id === salarie.id);
    assert.ok(modifiedSarah, 'le salarié modifié doit être repoussé en "modified" (jamais "added", il existait déjà)');
    assert.strictEqual(modifiedSarah.poste, 'Poste V2 (plus récent)', 'la retentative doit utiliser l\'état ACTUEL, pas une copie figée au moment de l\'échec');
  }

  // ---- 3. delete : rejoué via deleteRow, jamais un upsert ----
  {
    const { sandbox, DB } = loadDataJs();
    DB.init();
    const company = DB.getCurrentCompany();
    const salarie = company.employees.find(e => e.role === 'salarie');

    let deleteCalls = 0;
    sandbox.window.SupabaseSync = new Proxy({}, {
      get(target, prop) {
        if (prop !== 'deleteRow') return async () => ({ success: true });
        return async () => { deleteCalls++; if (deleteCalls === 1) throw new Error('mock : échec réseau'); };
      },
    });

    DB.saveEmployees(company.employees.filter(e => e.id !== salarie.id));
    await new Promise(r => setTimeout(r, 10));
    assert.strictEqual(DB.getPendingSyncCount(company.id), 1);
    await DB.retryPendingSyncNow(company.id);
    assert.strictEqual(deleteCalls, 2, 'la suppression doit être rejouée exactement une fois de plus');
    assert.strictEqual(DB.getPendingSyncCount(company.id), 0);
  }

  // ---- 4. insertOnly : un conflit de clé (23505) à la retentative est un succès, pas un échec ----
  {
    const { sandbox, DB } = loadDataJs();
    DB.init();
    const company = DB.getCurrentCompany();

    let attempt = 0;
    sandbox.window.SupabaseSync = new Proxy({}, {
      get(target, prop) {
        if (prop !== 'pushIdees') return async () => ({ success: true });
        return async () => {
          attempt++;
          if (attempt === 1) throw new Error('mock : échec réseau (réponse perdue après écriture réussie)');
          // La ligne existe en réalité déjà côté serveur (la 1re tentative a réussi malgré l'erreur réseau côté client).
          throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
        };
      },
    });

    const salarie = company.employees.find(e => e.role === 'salarie');
    DB._currentEmployeeId = salarie.id;
    DB.addIdee({ employeeId: salarie.id, titre: 'Idée test', description: '' });
    await new Promise(r => setTimeout(r, 10));
    assert.strictEqual(DB.getPendingSyncCount(company.id), 1);
    const result = await DB.retryPendingSyncNow(company.id);
    assert.strictEqual(result.resolved, 1, 'un conflit de clé (23505) à la retentative doit être traité comme un succès');
    assert.strictEqual(DB.getPendingSyncCount(company.id), 0);
  }

  // ---- 5. idClassified : une ligne supprimée localement entre l'échec et la retentative ne doit
  //         jamais planter, et se résout silencieusement (rien à envoyer). ----
  {
    const { sandbox, DB } = loadDataJs();
    DB.init();
    const company = DB.getCurrentCompany();
    const salarie = company.employees.find(e => e.role === 'salarie');

    let attempt = 0;
    sandbox.window.SupabaseSync = new Proxy({}, {
      get(target, prop) {
        if (prop !== 'pushEmployees') return async () => ({ success: true });
        return async () => { attempt++; if (attempt === 1) throw new Error('mock : échec réseau'); return { success: true }; };
      },
    });
    DB.saveEmployees(company.employees.map(e => e.id === salarie.id ? { ...e, poste: 'Modifié' } : e));
    await new Promise(r => setTimeout(r, 10));
    assert.strictEqual(DB.getPendingSyncCount(company.id), 1);

    // Le salarié est maintenant supprimé localement (départ enregistré avant la retentative).
    DB.saveCurrentCompany(Object.assign(DB.getCurrentCompany(), { employees: DB.getEmployees().filter(e => e.id !== salarie.id) }));

    const result = await DB.retryPendingSyncNow(company.id);
    assert.strictEqual(result.resolved, 1, 'une ligne disparue localement ne doit jamais bloquer la file (rien à envoyer = succès)');
  }

  console.log('OK — pending-sync-queue.test.js (persistance, reprise à l\'état actuel, delete, 23505, ligne disparue)');
}

run().catch((err) => {
  console.error('ÉCHEC — pending-sync-queue.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
