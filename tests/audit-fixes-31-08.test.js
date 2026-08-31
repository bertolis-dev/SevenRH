/**
 * Seven RH — audit de bugs du 31/08/2026 (7 agents en parallèle sur app.js/data.js/supabase-client.js).
 * Un test par correctif confirmé et appliqué. Les correctifs touchant des fonctions de
 * supabase-client.js (module ES avec appel réseau à l'import, non exécutable simplement dans ce
 * harnais vm) sont vérifiés par lecture de source — même principe que
 * tests/security-definer-grants.test.js pour les migrations SQL.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadDataJs } = require('./load-data-js');
const { loadAppJs } = require('./load-app-js');

function makeSupabaseMock() {
  const calls = { deleteRow: [], pushFavorites: [] };
  return {
    calls,
    mock: new Proxy({}, {
      get: (target, prop) => {
        if (prop === 'deleteRow') return async (table, id, companyId) => { calls.deleteRow.push({ table, id, companyId }); return true; };
        if (prop === 'pushFavorites') return async (companyId, favorites) => { calls.pushFavorites.push({ companyId, favorites: JSON.parse(JSON.stringify(favorites)) }); return true; };
        return async () => ({ success: true });
      }
    })
  };
}

async function run() {
  // ---- data.js : deleteEmployee nettoie entretiens/idées/tickets ET repousse les favoris ----
  {
    const { DB, sandbox } = loadDataJs();
    const { mock, calls } = makeSupabaseMock();
    sandbox.window.SupabaseSync = mock;
    DB.init();
    const [e1, e2] = DB.getEmployees();

    const entretien = DB.addEntretien({ employeeId: e1.id, datePrevue: '2027-01-01' });
    const idee = DB.addIdee({ employeeId: e1.id, titre: 'Test' });
    DB._currentEmployeeId = e2.id;
    DB.toggleFavoriteEmployee(e1.id); // e2 favorise e1

    DB.deleteEmployee(e1.id);

    assert.ok(!DB.getEntretiens().some(x => x.id === entretien.id), 'un entretien du salarié supprimé ne doit plus traîner');
    assert.ok(!DB.getIdees().some(x => x.id === idee.id), 'une idée du salarié supprimé ne doit plus traîner');
    assert.ok(!(DB.getCurrentCompany().favorites[e2.id] || []).includes(e1.id), 'le favori pointant vers le salarié supprimé doit disparaître localement');
    assert.ok(calls.pushFavorites.length > 0, 'la suppression des favoris doit être repoussée à Supabase (pas seulement locale)');
    assert.ok(calls.deleteRow.some(c => c.table === 'entretiens' && c.id === entretien.id), 'la suppression de l\'entretien orphelin doit être repoussée à Supabase');
    assert.ok(calls.deleteRow.some(c => c.table === 'idees' && c.id === idee.id), 'la suppression de l\'idée orpheline doit être repoussée à Supabase');
  }

  // ---- data.js : deleteLeaveType nettoie compteurPartageAvecId et fermetures.decompteTypeId ----
  {
    const { DB, sandbox } = loadDataJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rtt = DB.getLeaveTypes().find(t => t.nom === 'RTT') || DB.addLeaveType({ nom: 'RTT test', categorie: 'conge' });
    const sansSolde = DB.addLeaveType({ nom: 'Congé sans solde test', categorie: 'conge', compteurPartageAvecId: rtt.id });
    const settings = DB.getSettings();
    settings.fermetures = [{ id: 'ferm1', nom: 'Pont', dateDebut: '2027-05-01', dateFin: '2027-05-01', decompteTypeId: rtt.id }];
    DB.saveSettings(settings);

    DB.deleteLeaveType(rtt.id);

    const sansSoldeApres = DB.getLeaveTypeById(sansSolde.id);
    assert.strictEqual(sansSoldeApres.compteurPartageAvecId, null, 'compteurPartageAvecId doit être nettoyé quand le type qu\'il référence est supprimé');
    const fermetureApres = DB.getSettings().fermetures[0];
    assert.strictEqual(fermetureApres.decompteTypeId, null, 'fermetures[].decompteTypeId doit être nettoyé quand le type qu\'il référence est supprimé');
  }

  // ---- app.js : fins de contrat / période d'essai déjà dépassées restent visibles (pas juste "à venir") ----
  {
    const { DB, getUpcomingContractEnds, getUpcomingProbationEnds } = loadAppJs();
    DB.init();
    const employees = DB.getEmployees();
    const hier = new Date(); hier.setDate(hier.getDate() - 3);
    const hierStr = hier.toISOString().slice(0, 10);
    const withPastContrat = [{ ...employees[0], dateFinContrat: hierStr, dateFinPeriodeEssai: '' }];
    const withPastEssai = [{ ...employees[0], dateFinPeriodeEssai: hierStr, dateFinContrat: '' }];

    assert.ok(getUpcomingContractEnds(60, withPastContrat, Infinity).some(e => e.id === employees[0].id),
      'une fin de contrat déjà dépassée doit rester listée (en retard), pas disparaître');
    assert.ok(getUpcomingProbationEnds(60, withPastEssai, Infinity).some(e => e.id === employees[0].id),
      'une fin de période d\'essai déjà dépassée doit rester listée (en retard), pas disparaître');
  }

  // ---- app.js : canManageDocumentsFor respecte hasPermission (donc les surcharges), pas un rôle en dur ----
  {
    const { DB, canManageDocumentsFor } = loadAppJs();
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    assert.strictEqual(canManageDocumentsFor(), true, 'RH doit pouvoir gérer les documents par défaut');

    rh.permissionsOverrides = { gererUtilisateurs: false };
    assert.strictEqual(canManageDocumentsFor(), false, 'une surcharge retirant gererUtilisateurs doit être respectée (pas juste le rôle)');
  }

  // ---- app.js : isManagerOfEmployee est bien la seule implémentation restante (pas de doublon inline) ----
  {
    const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    const inlineDuplicates = appSource.match(/\(\w+\.managerIds \|\| \[\]\)\.includes\(/g) || [];
    assert.strictEqual(inlineDuplicates.length, 1, 'une seule occurrence de ce test de relation manager doit rester (dans isManagerOfEmployee lui-même) — voir audit du 31/08/2026');
  }

  // ---- app.js : submitEmployeeForm rejette un pourcentage d'activité de 0 au lieu de le forcer à 100 ----
  {
    const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    assert.ok(
      appSource.includes("const pourcentageActivite = (pourcentageActiviteRaw === '' || pourcentageActiviteRaw == null) ? 100 : Number(pourcentageActiviteRaw);"),
      'un "0" explicite ne doit plus être silencieusement remplacé par 100 avant la validation'
    );
  }

  // ---- app.js : openProlongerModal / openRegulariserModal revérifient la permission (défense en profondeur) ----
  {
    const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    const prolongerBody = appSource.slice(appSource.indexOf('function openProlongerModal'), appSource.indexOf('function openProlongerModal') + 1600);
    assert.ok(prolongerBody.includes('PERMISSIONS.PROLONGER_MALADIE'), 'openProlongerModal doit revérifier PROLONGER_MALADIE, pas seulement le bouton qui l\'ouvre');
    const regulariserBody = appSource.slice(appSource.indexOf('function openRegulariserModal'), appSource.indexOf('function openRegulariserModal') + 1600);
    assert.ok(regulariserBody.includes('canManageRequestFor(request.employeeId)'), 'openRegulariserModal doit revérifier canManageRequestFor, pas seulement le bouton qui l\'ouvre');
  }

  // ---- app.js : bindCalendrierEvents ne réattache plus le listener document au fil des rendus ----
  {
    const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    assert.ok(appSource.includes('calendarFiltersOutsideCloseBound'), 'le listener de fermeture du panneau filtres doit être posé derrière une garde "une seule fois"');
  }

  // ---- supabase-client.js : leaveRequestFromRow/employeeFromRow ne perdent plus de champs au rechargement ----
  {
    const scSource = fs.readFileSync(path.join(__dirname, '..', 'supabase-client.js'), 'utf8');
    ['demiJourneeDebut', 'demiJourneeFin', 'workflowValidatorOverrides', 'fermetureId'].forEach(field => {
      assert.ok(new RegExp(`${field}:\\s*d\\.${field}`).test(scSource), `leaveRequestFromRow doit relire ${field}`);
    });
    ['astreintes', 'reposCompensateurPris'].forEach(field => {
      assert.ok(new RegExp(`${field}:\\s*d\\.${field}`).test(scSource), `employeeFromRow doit relire ${field}`);
    });
  }

  // ---- supabase-client.js : syncFavorites vérifie l'erreur du delete avant de continuer ----
  {
    const scSource = fs.readFileSync(path.join(__dirname, '..', 'supabase-client.js'), 'utf8');
    assert.ok(scSource.includes('const { error: deleteError } = await supabase.from(\'favorites\').delete()'), 'syncFavorites doit lire l\'erreur du delete');
    assert.ok(scSource.includes('if (deleteError) throw deleteError;'), 'syncFavorites doit interrompre avant l\'insert si le delete a échoué');
  }

  // ---- supabase-client.js : onSessionRefreshed rejoue le dernier évènement s'il est déjà passé ----
  {
    const scSource = fs.readFileSync(path.join(__dirname, '..', 'supabase-client.js'), 'utf8');
    assert.ok(scSource.includes('if (lastRefreshedSession) callback(lastRefreshedSession);'), 'onSessionRefreshed doit rejouer un rafraîchissement déjà survenu, comme onPasswordRecovery');
  }

  // ---- supabase-client.js : hydrateCurrentCompany se protège contre companyRes.data absent ----
  {
    const scSource = fs.readFileSync(path.join(__dirname, '..', 'supabase-client.js'), 'utf8');
    assert.ok(scSource.includes('if (!company) return null;'), 'hydrateCurrentCompany doit se garder contre un company introuvable/erreur, pas planter sur company.id');
  }

  console.log('OK — audit-fixes-31-08.test.js (13 correctifs de l\'audit du 31/08/2026 vérifiés)');
}

run().catch((err) => {
  console.error('ÉCHEC — audit-fixes-31-08.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
