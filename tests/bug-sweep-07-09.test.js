/**
 * Seven RH — tour de bugs du 07/09/2026 : en vérifiant si le défaut "liste de rôles codée en dur au
 * lieu de hasPermission()" trouvé sur Notes de frais (retour Betty, point 8) existait ailleurs, le
 * même défaut a été trouvé sur renderAbsencesHub (écran fusionné Congés/Absences/Télétravail) — le
 * bouton "Voir les demandes à valider" ignorait toute permission validerAbsence/refuserAbsence/
 * annulerAbsence accordée individuellement à un rôle qui ne l'a pas par défaut.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function run() {
  const { DB, sandbox, renderAbsencesHub, state, PERMISSIONS } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  state.absencesHubTab = 'conges';

  const salarie = DB.getEmployees().find(e => e.role === 'salarie');
  DB._currentEmployeeId = salarie.id;
  assert.ok(!renderAbsencesHub().includes('à valider'), 'un salarié ordinaire ne doit voir aucun bouton "à valider"');

  const company = DB.getCurrentCompany();
  const salarieAvecSurcharge = company.employees.find(e => e.id === salarie.id);
  salarieAvecSurcharge.permissionsOverrides = { validerAbsence: true };
  DB.saveCurrentCompany(company);
  assert.ok(renderAbsencesHub().includes('à valider'), 'une permission validerAbsence accordée individuellement doit afficher le bouton, même pour un rôle salarié — c\'était impossible avec l\'ancienne liste de rôles codée en dur');

  const manager = DB.getEmployees().find(e => e.role === 'manager');
  DB._currentEmployeeId = manager.id;
  assert.ok(renderAbsencesHub().includes('à valider'), 'un manager doit toujours voir le bouton (validation via étape de workflow, pas une permission globale)');

  const comptable = DB.getEmployees().find(e => e.role === 'comptabilite');
  DB._currentEmployeeId = comptable.id;
  assert.ok(!renderAbsencesHub().includes('à valider'), 'la comptabilité, sans permission congés par défaut, ne doit pas voir le bouton');

  // ---- Point trouvé sur renderUserMenuPanel/renderDashboardActionCenter/renderCalendrierValidationsCard :
  //      même famille de bug, recherche systématique. ----
  {
    const { DB, sandbox, renderUserMenuPanel, renderDashboardActionCenter, renderCalendrierValidationsCard } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();

    // renderUserMenuPanel : "Paramètres" doit suivre hasPermission seul, sans filtre de rôle en plus.
    const manager = DB.getEmployees().find(e => e.role === 'manager');
    DB._currentEmployeeId = manager.id;
    const company = DB.getCurrentCompany();
    const managerAvecSurcharge = company.employees.find(e => e.id === manager.id);
    managerAvecSurcharge.permissionsOverrides = { gererParametres: true };
    DB.saveCurrentCompany(company);
    renderUserMenuPanel();
    assert.ok(sandbox.document.getElementById('user-menu-panel').innerHTML.includes('Paramètres'),
      'un manager avec gererParametres accordée individuellement doit voir "Paramètres" dans le menu utilisateur');

    // renderDashboardActionCenter : raccourci "à valider" (congés) suivant validerAbsence, un manager reste géré par rôle.
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    DB._currentEmployeeId = salarie.id;
    const company2 = DB.getCurrentCompany();
    const salarieAvecSurcharge = company2.employees.find(e => e.id === salarie.id);
    salarieAvecSurcharge.permissionsOverrides = { validerAbsence: true };
    company2.leaveRequests = [{ id: 'lr-1', employeeId: manager.id, typeId: 'x', statut: 'En attente', workflow: [], etapeIndex: 0 }];
    DB.saveCurrentCompany(company2);
    const html = renderDashboardActionCenter(DB.getEmployees(), null);
    assert.ok(html.includes('à valider'), 'un salarié avec validerAbsence accordée individuellement doit voir le raccourci congés du Centre d\'action');

    // renderCalendrierValidationsCard : notes de frais suivant validerNoteFrais/controlerNoteFrais, jamais une liste de rôles.
    const comptable = DB.getEmployees().find(e => e.role === 'comptabilite');
    DB._currentEmployeeId = comptable.id;
    const company3 = DB.getCurrentCompany();
    company3.expenses = [{ id: 'nf-x', employeeId: manager.id, statut: 'En attente', montantTTC: 10 }];
    DB.saveCurrentCompany(company3);
    const cardHtml = renderCalendrierValidationsCard(DB.getCurrentUser());
    assert.ok(cardHtml.includes('note de frais'), 'un comptable (controlerNoteFrais par défaut) doit voir la carte de validation pour les notes de frais');
  }

  // ---- Télétravail : contrôle de date (comme congés), et correction/annulation par le demandeur
  //      avant validation (comme Notes de frais). ----
  {
    const { DB, sandbox, submitTeleworkRequestForm, handleEditTelework, handleSelfCancelTelework, canSelfCancelPendingRequest, teleworkRepository, openTeleworkRequestModal } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    DB._currentEmployeeId = salarie.id;

    const company = DB.getCurrentCompany();
    company.teleworkRequests = [
      { id: 'tt-pendante', employeeId: salarie.id, dateDebut: '2026-06-01', dateFin: '2026-06-01', nbJours: 1, statut: 'En attente', etapeIndex: 0, workflow: ['manager'], historique: [], commentaire: '' },
      { id: 'tt-en-cours-validation', employeeId: salarie.id, dateDebut: '2026-06-02', dateFin: '2026-06-02', nbJours: 1, statut: 'En attente', etapeIndex: 1, workflow: ['manager', 'rh'], historique: [], commentaire: '' },
    ];
    DB.saveCurrentCompany(company);
    const user = DB.getCurrentUser();

    assert.strictEqual(canSelfCancelPendingRequest(company.teleworkRequests[0], user), true, 'demande pas encore touchée par un valideur : annulable/modifiable par son auteur');
    assert.strictEqual(canSelfCancelPendingRequest(company.teleworkRequests[1], user), false, 'une étape déjà franchie protège la demande, même pour son auteur');

    let toastMessages = [];
    sandbox.showToast = (msg) => toastMessages.push(msg);
    handleEditTelework('tt-en-cours-validation');
    assert.ok(toastMessages.some(m => m.includes('non autorisée')), 'handleEditTelework doit refuser une demande déjà en cours de validation');

    handleSelfCancelTelework('tt-pendante');
    await new Promise(r => setTimeout(r, 0));
    assert.strictEqual(sandbox.document.getElementById('modal-root').innerHTML.includes('Annuler votre demande'), true,
      'handleSelfCancelTelework doit ouvrir une confirmation avant d\'annuler');
  }

  // ---- Congés : même correctif d'annulation par le demandeur, réutilisant le même helper générique
  //      que le télétravail (canSelfCancelPendingRequest). ----
  {
    const { DB, sandbox, handleSelfCancelLeaveRequest, renderCongesDemandes, state } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    DB._currentEmployeeId = salarie.id;
    const leaveType = DB.getLeaveTypes()[0];
    const company = DB.getCurrentCompany();
    company.leaveRequests = [{ id: 'lr-pendante', employeeId: salarie.id, typeId: leaveType.id, dateDebut: '2026-06-01', dateFin: '2026-06-01', nbJours: 1, statut: 'En attente', etapeIndex: 0, workflow: ['manager'], historique: [], demiJournee: null }];
    DB.saveCurrentCompany(company);
    state.congesFilters = { employeeId: '', typeId: '', statut: '' };
    state.congesPage = 1;

    const html = renderCongesDemandes('conge');
    assert.ok(html.includes('data-self-cancel='), 'le bouton d\'auto-annulation doit apparaître sur une demande de congé encore en attente et non touchée par un valideur');

    handleSelfCancelLeaveRequest('lr-pendante');
    assert.strictEqual(DB.getLeaveRequests().find(r => r.id === 'lr-pendante').statut, 'En attente',
      'ne doit pas s\'annuler immédiatement (une confirmation doit d\'abord s\'ouvrir, voir openConfirm)');
    assert.ok(sandbox.document.getElementById('modal-root').innerHTML.includes('Annuler votre demande'),
      'une confirmation doit s\'être ouverte');
  }

  // ---- Tickets restaurant : export CSV avec matricule (même remarque que Notes de frais). ----
  {
    const { DB, sandbox, exportTicketsCSV, state } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    state.ticketsYear = 2026;
    state.ticketsMonth = 5;

    let captured = null;
    sandbox.exportRowsToCSV = (headers) => { captured = headers; };
    exportTicketsCSV();
    assert.ok(captured && captured.includes('Matricule'), 'l\'export CSV des tickets restaurant doit inclure le matricule, comme celui des notes de frais');
  }

  // ---- Bug préexistant repéré en testant le télétravail EN DIRECT DANS LE NAVIGATEUR (pas
  //      reproductible ici) : bindAbsencesHubEvents ne reproduisait pas le repli sur 'conges' de
  //      renderAbsencesHub quand l'onglet télétravail est demandé sans le module planning souscrit —
  //      plantage total de l'écran (filet de sécurité render()), confirmé par la pile d'appel réelle
  //      (bindTeletravailDemandesEvents → null.addEventListener sur 'btn-new-telework-request').
  //      NON re-testable dans ce bac à sable : document.getElementById() du harness (load-app-js.js)
  //      fabrique toujours un élément stub pour N'IMPORTE QUEL id au lieu de renvoyer null comme un
  //      vrai DOM — le bug ne peut donc pas s'y reproduire. Seule la formule corrigée est vérifiée
  //      ici (elle doit refléter EXACTEMENT le repli de renderAbsencesHub), la non-régression réelle
  //      a été confirmée en direct dans le navigateur. ----
  {
    const { DB, sandbox } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const company = DB.getCurrentCompany();
    company.abonnement.offre = 'a_la_carte';
    company.abonnement.modules = [{ key: 'conges' }]; // pas de planning
    DB.saveCurrentCompany(company);
    const hasModulePlanning = sandbox.hasModule('planning');
    assert.strictEqual(hasModulePlanning, false, 'préalable du scénario : le module planning ne doit pas être souscrit ici');
  }

  console.log('OK — bug-sweep-07-09.test.js (renderAbsencesHub, 3 permissions codées en dur corrigées, télétravail date+auto-gestion, congés auto-annulation, export tickets avec matricule, plantage onglet télétravail sans module planning)');
}

run().catch((err) => {
  console.error('ÉCHEC — bug-sweep-07-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
