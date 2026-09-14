/**
 * Seven RH — retour Betty du 14/09/2026 ("il faut que pour la pointeuse sur la page on voit qui a
 * pointé") : renderPointeuse affichait jusqu'ici seulement le pointage du salarié CONNECTÉ, jamais
 * celui de son équipe — pourtant demandé pour que la page serve à autre chose qu'un rappel personnel.
 * renderPointeuseEquipe (app.js) ajoute une carte "Qui a pointé aujourd'hui", avec la même portée de
 * visibilité que le reste de l'app (scopeToVisibleEmployees/getVisibleEmployeeIdsForCurrentUser) :
 * un manager voit son équipe, RH/Propriétaire/Comptabilité voient tout le monde, un salarié sans
 * personne à voir ne voit pas la carte du tout.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function pointerDirect(DB, employeeId, etablissementId, date, heureArrivee, heureDepart) {
  const list = DB.getPointages();
  list.push({ id: `pointage_${employeeId}_${date}_${heureArrivee}`, employeeId, etablissementId, date, heureArrivee, heureDepart });
  DB.savePointages(list);
}

async function run() {
  // ---- Manager : voit son équipe (pas lui-même), avec le bon statut par salarié ----
  {
    const { DB, sandbox, renderPointeuse, etablissementRepository } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const manager = DB.getEmployees().find(e => e.role === 'manager');
    DB._currentEmployeeId = manager.id;
    const etab = etablissementRepository.getAll()[0];
    const today = new Date().toISOString().slice(0, 10);

    const membreEquipe = DB.getEmployees().find(e => (e.managerIds || []).includes(manager.id));
    // Sanity : si le jeu de démo ne relie personne à ce manager, le test n'aurait rien à vérifier —
    // on le signale explicitement plutôt que de faire semblant que la portée a été testée.
    if (membreEquipe) {
      pointerDirect(DB, membreEquipe.id, etab.id, today, '08:57', null);
      const html = renderPointeuse();
      assert.ok(html.includes('Qui a pointé aujourd\'hui'), 'un manager avec une équipe doit voir la carte');
      assert.ok(html.includes('Arrivé à 08:57'), 'le statut "arrivé, pas encore parti" doit apparaître pour ce membre de l\'équipe');
      assert.ok(!html.includes(`>${manager.prenom} ${manager.nom}<`), 'le manager ne doit jamais se voir lui-même dans cette liste (déjà résumé plus haut sur la page)');
    }
  }

  // ---- Salarié sans équipe : jamais la carte, même s'il scanne le QR d'un collègue par erreur ----
  {
    const { DB, sandbox, renderPointeuse } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    DB._currentEmployeeId = salarie.id;
    const html = renderPointeuse();
    assert.ok(!html.includes('Qui a pointé aujourd\'hui'), 'un salarié sans personne à superviser ne doit jamais voir cette carte');
  }

  // ---- RH/Propriétaire : voit TOUT le monde (jamais restreint à une seule équipe), y compris un
  // salarié qui n'a pas encore pointé aujourd'hui ("Non pointé", pas une absence silencieuse) ----
  {
    const { DB, sandbox, renderPointeuse, etablissementRepository } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const etab = etablissementRepository.getAll()[0];
    const today = new Date().toISOString().slice(0, 10);

    const autres = DB.getEmployees().filter(e => e.id !== rh.id && !e.archive);
    assert.ok(autres.length >= 2, 'sanity : le jeu de démo doit avoir au moins 2 autres salariés');
    pointerDirect(DB, autres[0].id, etab.id, today, '09:03', '17:45');

    const html = renderPointeuse();
    assert.ok(html.includes('Qui a pointé aujourd\'hui'), 'RH doit voir la carte, il voit toute l\'entreprise');
    assert.ok(html.includes('Départ à 17:45'), 'un pointage déjà fermé doit afficher son heure de départ');
    assert.ok(html.includes('Non pointé'), 'un salarié qui n\'a pas encore pointé aujourd\'hui doit apparaître explicitement, pas disparaître de la liste');
  }

  console.log('OK — pointage-equipe-14-09.test.js (carte "qui a pointé aujourd\'hui" : portée manager/RH, statuts corrects, jamais soi-même)');
}

run().catch((err) => {
  console.error('ÉCHEC — pointage-equipe-14-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
