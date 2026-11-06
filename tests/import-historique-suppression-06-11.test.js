/**
 * Seven RH — retour du 06/11/2026 : « mon import de vendredi dernier a encore disparu » et « pouvoir supprimer manuellement des congés ».
 * L'import créait chaque ligne avec sa propre sauvegarde et son propre envoi (des centaines de requêtes simultanées), annonçait « importé » sans
 * attendre le serveur, et le succès d'un envoi pouvait effacer de la file l'échec d'un autre : une ligne jamais renvoyée disparaissait au rechargement.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function run() {
  const api = loadAppJs();
  const { DB, sandbox, canDeleteLeaveRequest, importAbsencesRows } = api;
  const appels = { push: [], delete: [] };
  let echec = false;
  sandbox.window.SupabaseSync = new Proxy({}, {
    get: (_, nom) => {
      if (nom === 'pushLeaveRequests') return async (lot) => { appels.push.push(lot); if (echec) throw new Error('serveur indisponible'); };
      if (nom === 'deleteRow') return async (table, id) => { appels.delete.push({ table, id }); };
      return async () => ({ success: true });
    }
  });
  DB.init();
  const company = DB.getCurrentCompany();
  const salarie = DB.getEmployees().find(e => e.role === 'salarie');
  const type = DB.getLeaveTypes().find(t => t.categorie === 'conge' && t.actif);
  const lignes = (n, debut = 1) => Array.from({ length: n }, (_, i) => ({ employeeId: salarie.id, typeId: type.id, dateDebut: `2025-0${debut}-0${(i % 9) + 1}`, dateFin: `2025-0${debut}-0${(i % 9) + 1}`, nbJours: 1, commentaire: '' }));
  const avant = DB.getLeaveRequests().length;

  // --- Un import de 60 lignes = UNE sauvegarde, UN envoi de 60 lignes, résultat réel attendu ---
  const lot = DB.importerAbsencesHistoriqueLot(lignes(60));
  assert.strictEqual(lot.requests.length, 60, '60 demandes créées');
  assert.ok(lot.requests.every(r => r.statut === 'Validé' && r.workflow.length === 0), 'créées au statut Validé, sans circuit');
  assert.strictEqual(DB.getLeaveRequests().length, avant + 60, 'toutes présentes dans la liste locale');
  assert.strictEqual(await lot.envoi, true, 'envoi réussi : vrai');
  assert.strictEqual(appels.push.length, 1, 'un seul envoi au serveur, pas un par ligne');
  assert.strictEqual(appels.push[0].added.length, 60, 'les 60 lignes dans cet envoi');
  assert.strictEqual(DB.getPendingSyncCount(company.id), 0, 'rien en attente après un succès');

  // --- Serveur indisponible : le résultat est faux et les 60 lignes restent en file pour être renvoyées ---
  echec = true;
  const lot2 = DB.importerAbsencesHistoriqueLot(lignes(5, 2));
  assert.strictEqual(await lot2.envoi, false, 'envoi échoué : faux (l\'écran ne annonce plus un faux succès)');
  const details = DB.getPendingSyncDetails(company.id).find(d => d.sectionKey === 'idClassified:leave_requests');
  assert.ok(details && lot2.requests.every(r => details.insertIds.includes(r.id)), 'les 5 lignes sont gardées en file');

  // --- Le succès d'un autre envoi ne vide plus la file d'un échec (la perte silencieuse du 06/11) ---
  echec = false;
  const autre = DB.importerAbsencesHistoriqueLot(lignes(2, 3));
  assert.strictEqual(await autre.envoi, true, 'second envoi réussi');
  const apres = DB.getPendingSyncDetails(company.id).find(d => d.sectionKey === 'idClassified:leave_requests');
  assert.ok(apres, 'la file garde l\'échec précédent après un succès concurrent');
  assert.ok(lot2.requests.every(r => apres.insertIds.includes(r.id)), 'les 5 lignes échouées sont toujours à renvoyer');
  assert.ok(autre.requests.every(r => !apres.insertIds.includes(r.id)), 'les lignes réussies n\'y sont pas');

  // --- importAbsencesRows (écran) rend aussi la promesse d'envoi ---
  const lignePrete = { status: 'ok', employee: salarie, type, dateDebut: '2025-04-01', dateFin: '2025-04-02', nbJours: 2, commentaire: '' };
  const res = importAbsencesRows([lignePrete, { status: 'error', message: 'x' }]);
  assert.strictEqual(res.created, 1);
  assert.strictEqual(res.errors, 1);
  assert.strictEqual(await res.envoi, true);

  // --- Suppression manuelle ---
  const cible = lot.requests[0];
  const supprimee = DB.supprimerLeaveRequest(cible.id);
  assert.ok(supprimee && supprimee.request.id === cible.id, 'la demande est retrouvée');
  assert.ok(!DB.getLeaveRequests().some(r => r.id === cible.id), 'retirée de la liste');
  assert.strictEqual(await supprimee.envoi, true);
  assert.ok(appels.delete.some(d => d.table === 'leave_requests' && d.id === cible.id), 'suppression envoyée au serveur');
  assert.strictEqual(DB.supprimerLeaveRequest('inconnue'), null, 'demande inconnue : rien');

  // --- Qui voit le bouton « Supprimer » : aligné sur la politique du serveur ---
  const dePersonne = (role) => {
    const e = DB.getEmployees().find(x => x.role === role);
    DB._currentEmployeeId = e.id;
    return e;
  };
  const demandeDu = (employeeId) => ({ employeeId, statut: 'Validé' });
  const rh = dePersonne('rh');
  assert.strictEqual(canDeleteLeaveRequest(demandeDu(salarie.id)), true, 'un RH supprime la demande d\'un salarié');
  assert.strictEqual(canDeleteLeaveRequest(demandeDu(rh.id)), false, 'un RH ne supprime pas sa propre demande (hors mode mise en service)');
  const manager = dePersonne('manager');
  assert.strictEqual(canDeleteLeaveRequest(demandeDu(salarie.id)), false, 'un manager n\'a pas ce droit (le serveur refuserait)');
  dePersonne('salarie');
  assert.strictEqual(canDeleteLeaveRequest(demandeDu(salarie.id)), false, 'un salarié non plus');
  const proprietaire = dePersonne('proprietaire');
  assert.strictEqual(canDeleteLeaveRequest(demandeDu(salarie.id)), true, 'le propriétaire supprime la demande d\'un salarié');
  assert.strictEqual(canDeleteLeaveRequest(demandeDu(proprietaire.id)), false, 'mais pas la sienne hors mode mise en service');
  assert.ok(manager && proprietaire);

  console.log('OK — import-historique-suppression-06-11.test.js (import en un lot, vrai résultat, file de synchronisation sûre, suppression)');
}

run().catch(err => { console.error('ÉCHEC — import-historique-suppression-06-11.test.js'); console.error(err.stack || err.message); process.exitCode = 1; });
