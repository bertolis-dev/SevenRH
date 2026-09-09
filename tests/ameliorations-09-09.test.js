/**
 * Seven RH — tournée d'améliorations autonome du 09/09/2026 (Betty absente une heure ou plus,
 * autorisation explicite d'agir sans validation au fil de l'eau) : recherche de pratiques UX
 * courantes (centres de notifications, empty states d'onboarding SaaS, réinitialisation de filtres)
 * appliquées à l'existant, sans nouvelle fonctionnalité ni écart à la palette bleu marine + or.
 *
 * Couvre : le regroupement du panneau de notifications par jour relatif et "marquer comme non lu",
 * les messages d'empty state distinguant "rien créé encore" de "aucun résultat pour ces filtres"
 * (Congés/Absences, Télétravail, Notes de frais), et le lien "Réinitialiser les filtres" (Salariés,
 * Congés, Organigramme, Télétravail).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function run() {
  // ---- Notifications : regroupement par jour relatif ----
  {
    const { getNotifDayGroupLabel } = loadAppJs();
    const now = new Date();
    const daysAgo = (n) => { const d = new Date(now); d.setDate(d.getDate() - n); return d.toISOString(); };
    assert.strictEqual(getNotifDayGroupLabel(daysAgo(0)), "Aujourd'hui");
    assert.strictEqual(getNotifDayGroupLabel(daysAgo(1)), 'Hier');
    assert.strictEqual(getNotifDayGroupLabel(daysAgo(5)), 'Cette semaine');
    assert.strictEqual(getNotifDayGroupLabel(daysAgo(30)), 'Plus ancien');
  }

  {
    const { DB, sandbox, renderNotifPanel, state } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;

    const company = DB.getCurrentCompany();
    const now = new Date();
    const daysAgo = (n) => { const d = new Date(now); d.setDate(d.getDate() - n); return d.toISOString(); };
    company.notifications = [
      { id: 'n1', date: daysAgo(0), icon: '🔔', title: 'Notif A', message: 'Test', nav: 'dashboard', params: {}, luPar: {}, archivePar: {} },
      { id: 'n2', date: daysAgo(0), icon: '🔔', title: 'Notif B', message: 'Test', nav: 'dashboard', params: {}, luPar: {}, archivePar: {} },
      { id: 'n3', date: daysAgo(30), icon: '🔔', title: 'Notif C', message: 'Test', nav: 'dashboard', params: {}, luPar: {}, archivePar: {} }
    ];
    DB.saveCurrentCompany(company);
    state.notifTab = 'toutes';
    state.notifPage = 1;
    renderNotifPanel();
    const panelHtml = sandbox.document.getElementById('notif-panel').innerHTML;
    // L'apostrophe est échappée en HTML (&#39;) par escapeHtml au rendu — la fonction elle-même
    // (testée juste au-dessus) renvoie bien la chaîne brute, seul le HTML final diffère.
    const todayEscaped = "Aujourd&#39;hui";
    const todayOccurrences = panelHtml.split(todayEscaped).length - 1;
    assert.strictEqual(todayOccurrences, 1, 'l\'en-tête "Aujourd\'hui" ne doit apparaître qu\'une fois, pas répétée devant chaque notification du jour');
    assert.ok(panelHtml.includes('Plus ancien'), 'une notification ancienne doit apparaître sous son propre groupe');
    assert.ok(panelHtml.indexOf(todayEscaped) < panelHtml.indexOf('Plus ancien'), 'les groupes doivent rester dans l\'ordre chronologique (plus récent en premier)');
  }

  // ---- Notifications : "marquer comme non lu" pour retrouver une notification déjà ouverte ----
  {
    const { DB, sandbox, renderNotifPanel, notificationRepository, state } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const company = DB.getCurrentCompany();
    company.notifications = [{ id: 'n1', date: new Date().toISOString(), icon: '🔔', title: 'Notif A', message: 'Test', nav: 'dashboard', params: {}, luPar: {}, archivePar: {} }];
    DB.saveCurrentCompany(company);

    assert.ok(!notificationRepository.getNotifications()[0].lu, 'préalable : la notification démarre non lue');
    notificationRepository.markNotificationRead('n1', true);
    assert.ok(notificationRepository.getNotifications()[0].lu, 'préalable : passée à lue');

    state.notifTab = 'toutes';
    state.notifPage = 1;
    renderNotifPanel();
    const htmlRead = sandbox.document.getElementById('notif-panel').innerHTML;
    assert.ok(htmlRead.includes('data-notif-mark-unread="n1"'), 'une notification déjà lue doit proposer "Marquer comme non lu"');

    notificationRepository.markNotificationRead('n1', false);
    assert.ok(!notificationRepository.getNotifications()[0].lu, 'markNotificationRead(id, false) doit bien la remettre non lue');
    renderNotifPanel();
    const htmlUnread = sandbox.document.getElementById('notif-panel').innerHTML;
    assert.ok(!htmlUnread.includes('data-notif-mark-unread="n1"'), 'une fois non lue, l\'action "Marquer comme non lu" ne doit plus être proposée (déjà dans cet état)');
  }

  // ---- Empty states : "rien créé encore" distingué de "aucun résultat pour ces filtres" ----
  {
    const { DB, sandbox, renderCongesDemandes, renderFrais, renderTeletravailDemandes, state } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;

    // Congés & absences
    state.congesFilters = { employeeId: '', typeId: '', statut: '' };
    state.congesPage = 1;
    const htmlNoFilter = renderCongesDemandes('conge');
    assert.ok(htmlNoFilter.includes("pour l&#39;instant"), 'sans filtre actif et 0 demande, le message doit inviter à créer la première, pas suggérer d\'ajuster un filtre');
    assert.ok(!htmlNoFilter.includes('ne correspond à ces filtres'), 'le message "ne correspond à ces filtres" ne doit apparaître que si un filtre est réellement actif');

    state.congesFilters = { employeeId: '', typeId: '', statut: 'Refusé' };
    const htmlWithFilter = renderCongesDemandes('conge');
    assert.ok(htmlWithFilter.includes('ne correspond à ces filtres'), 'avec un filtre actif et 0 résultat, le message doit refléter le filtre, pas suggérer qu\'aucune demande n\'a jamais été créée');
    assert.ok(!htmlWithFilter.includes("pour l&#39;instant"), 'le message "onboarding" ne doit pas apparaître quand un filtre explique l\'absence de résultat');

    // Notes de frais
    state.fraisFilters = { employeeId: '', categorie: '', statut: '', periode: '' };
    state.fraisPage = 1;
    const fraisHtml = renderFrais();
    assert.ok(fraisHtml.includes("pour l&#39;instant"), 'Notes de frais : même distinction sans filtre actif');

    // Télétravail
    state.teletravailFilters = { employeeId: '', statut: '' };
    state.teletravailPage = 1;
    const ttHtml = renderTeletravailDemandes();
    assert.ok(ttHtml.includes("pour l&#39;instant"), 'Télétravail : même distinction sans filtre actif');
    state.teletravailFilters = { employeeId: '', statut: 'Refusé' };
    const ttFilteredHtml = renderTeletravailDemandes();
    assert.ok(ttFilteredHtml.includes('ne correspond à ces filtres'), 'Télétravail : avec un filtre actif, le message doit refléter le filtre');
  }

  // ---- "Réinitialiser les filtres" : visible seulement si un filtre est actif, vide tout d'un coup ----
  {
    const { DB, sandbox, renderEmployeesList, renderOrganigramme, FILTER_RESET_HANDLERS, state } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;

    const htmlNoFilter = renderEmployeesList();
    assert.ok(!htmlNoFilter.includes('Réinitialiser les filtres'), 'aucun filtre actif : pas de lien "Réinitialiser" (rien à réinitialiser)');

    state.filters.service = 'Ventes';
    const htmlWithFilter = renderEmployeesList();
    assert.ok(htmlWithFilter.includes('data-reset-filters="employees"'), 'un filtre actif doit faire apparaître le lien "Réinitialiser les filtres"');

    // JSON.stringify plutôt que deepStrictEqual : state.filters est construit DANS le contexte vm
    // (un autre "realm" JS que ce fichier de test) — deepStrictEqual le jugerait "non
    // référentiellement égal" à un littéral de CE fichier même à contenu strictement identique
    // (même piège déjà documenté dans nominative-validators.test.js/repos-compensateur.test.js).
    FILTER_RESET_HANDLERS.employees();
    assert.strictEqual(JSON.stringify(state.filters), JSON.stringify({ etablissementId: '', service: '', statutContrat: '', statut: '', favorisOnly: false }), 'le gestionnaire de réinitialisation doit vider TOUS les champs Salariés, pas seulement celui qui était actif');
    assert.strictEqual(state.search, '', 'la recherche texte doit aussi être vidée par la réinitialisation globale');

    state.organigrammeFilters = { search: '', etablissementId: '', service: 'Ventes', equipe: '' };
    const orgHtml = renderOrganigramme();
    assert.ok(orgHtml.includes('data-reset-filters="organigramme"'), 'Organigramme : le lien apparaît aussi quand un de ses filtres est actif');
    FILTER_RESET_HANDLERS.organigramme();
    assert.strictEqual(JSON.stringify(state.organigrammeFilters), JSON.stringify({ search: '', etablissementId: '', service: '', equipe: '' }));
  }

  console.log('OK — ameliorations-09-09.test.js (regroupement par jour des notifications, marquer comme non lu, empty states distinguant onboarding et filtres, réinitialisation globale des filtres)');
}

run().catch((err) => {
  console.error('ÉCHEC — ameliorations-09-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
