/**
 * Seven RH — refonte pratique du 09/09/2026 : liste de changements demandée par Betty (pas de
 * nouvelle fonctionnalité, uniquement de l'existant amélioré/corrigé) + le regroupement service/
 * équipe du calendrier équipe, redemandé spécifiquement ce jour-là (même principe que celui déjà
 * livré pour le Planning le 04/09/2026, voir renderPlanningGroupRows).
 *
 * Ce fichier couvre : le roster "Équipe" du calendrier (tous les salariés, triés service puis
 * équipe, poste affiché), les heures visibles directement dans le Planning Semaine (fusion avec
 * l'onglet Horaires), l'alignement des couleurs congé/télétravail entre Planning et Calendrier, le
 * format carte mobile généralisé (Salariés/Congés/Notes de frais), le popover "Filtres" généralisé
 * sur mobile (Salariés/Congés/Organigramme), le sommaire cliquable du formulaire salarié, et la
 * pagination du panneau de notifications (remplace l'ancien plafond fixe).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAppJs } = require('./load-app-js');

async function run() {
  // ---- Calendrier équipe : roster complet trié service -> équipe, poste à côté du nom ----
  {
    const { DB, sandbox, buildCalendarSharedData, renderCalendarDayTeamRoster, renderCalendarCell, openCalendarDayModal, state } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    state.calendrierVue = 'entreprise';

    const company = DB.getCurrentCompany();
    const salaries = company.employees.filter(e => e.role === 'salarie');
    assert.ok(salaries.length >= 2, 'préalable du scénario : au moins 2 salariés dans le jeu de démonstration');
    const toutesLesJournees = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
    const [e1, e2] = salaries;
    Object.assign(e1, { service: 'Ventes', equipe: 'Nord', poste: 'Commercial', joursTravailles: toutesLesJournees });
    Object.assign(e2, { service: 'Ventes', equipe: 'Sud', poste: 'Commercial senior', joursTravailles: toutesLesJournees });
    DB.saveCurrentCompany(company);

    const dateStr = '2026-09-09';
    const sharedData = buildCalendarSharedData([{ date: new Date(2026, 8, 9) }]);
    assert.strictEqual(sharedData.vuePersonnelle, false, 'un RH démarre en vue entreprise, jamais personnelle par défaut');

    const rosterHtml = renderCalendarDayTeamRoster(dateStr, sharedData);
    assert.ok(rosterHtml.includes('Ventes'), 'le service doit apparaître comme en-tête de groupe');
    assert.ok(rosterHtml.includes('Nord') && rosterHtml.includes('Sud'), 'les deux équipes du même service doivent apparaître, chacune sous son propre sous-groupe');
    assert.ok(rosterHtml.includes('Commercial senior'), 'le poste doit être affiché à côté du nom (personNameWithPosteHtml, déjà utilisé par le Planning)');
    assert.ok(rosterHtml.indexOf('Nord') < rosterHtml.indexOf('Sud'), 'les équipes doivent être triées alphabétiquement au sein du service');
    assert.ok(rosterHtml.includes('Présent'), 'un salarié qui travaille ce jour-là (2026-09-09 est un mercredi, présent dans joursTravailles) et n\'a ni congé ni télétravail doit apparaître "Présent"');

    // §correctif associé : avant, en vue équipe/entreprise, une case du calendrier SANS badge
    // (aucune absence/anniversaire/arrivée/départ/férié ce jour-là) n'était pas cliquable du tout —
    // rendant le nouveau roster "Équipe" inatteignable les jours "normaux", pourtant les plus
    // fréquents. Une case du mois affiché doit désormais toujours être cliquable en vue élargie.
    const cellHtml = renderCalendarCell({ date: new Date(2026, 8, 9), inMonth: true }, sharedData);
    assert.ok(cellHtml.includes('calendar-cell-clickable') && cellHtml.includes('data-calendar-day='),
      'en vue équipe/entreprise, un jour sans aucun badge doit rester cliquable pour consulter le roster de l\'équipe');

    // Bout en bout : le roster n'apparaît que dans la modale de détail d'un jour en vue équipe/entreprise.
    openCalendarDayModal(dateStr);
    const modalHtmlEquipe = sandbox.document.getElementById('modal-root').innerHTML;
    assert.ok(modalHtmlEquipe.includes('Équipe'), 'la modale de détail d\'un jour doit inclure le roster "Équipe" en vue élargie');
    assert.ok(modalHtmlEquipe.includes('Commercial senior'), 'le poste doit être visible directement dans la modale');

    state.calendrierVue = 'personnel';
    openCalendarDayModal(dateStr);
    const modalHtmlPersonnel = sandbox.document.getElementById('modal-root').innerHTML;
    assert.ok(!modalHtmlPersonnel.includes('Équipe'), 'en vue personnelle, jamais de roster multi-salarié — une seule personne (soi) concernée');
  }

  // ---- Planning : heures visibles directement dans la vue Semaine (fusion avec l'onglet Horaires) ----
  {
    const { DB, sandbox, renderPlanningSemaine, state } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    state.planningVue = 'equipe';
    state.planningWeekOffset = 0;
    state.planningFilters = { service: '' };

    const company = DB.getCurrentCompany();
    const salarie = company.employees.find(e => e.role === 'salarie');
    Object.assign(salarie, {
      joursTravailles: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'],
      horaireMatinDebut: '09:00', horaireMatinFin: '12:00',
      horaireApresMidiDebut: '13:00', horaireApresMidiFin: '17:00'
    });
    DB.saveCurrentCompany(company);

    const html = renderPlanningSemaine();
    assert.ok(html.includes('planning-cell-hours'), 'les heures du jour doivent être visibles directement dans la vue Semaine, sans ouvrir l\'onglet séparé "Horaires"');
    assert.ok(html.includes('7,00 h'), '9h-12h + 13h-17h = 7h attendues pour une journée complète travaillée');
  }

  // ---- Cohérence visuelle : congé/télétravail utilisent désormais EXACTEMENT la même couleur dans
  //      le Planning que dans le Calendrier (avant ce correctif, le vert signifiait "congé" au
  //      Calendrier mais "présent" au Planning — vérification statique du CSS, pas d'exécution DOM
  //      possible pour une couleur réellement calculée dans ce bac à sable). ----
  {
    const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
    assert.ok(/\.planning-leave\s*\{\s*background:\s*var\(--color-success-soft\)/.test(css),
      'planning-leave (congé) doit utiliser le même vert que .legend-conge/.calendar-badge-conge du Calendrier');
    assert.ok(/\.planning-remote\s*\{\s*background:\s*var\(--color-primary-soft\)/.test(css),
      'planning-remote (télétravail) doit utiliser le même accent marine que .legend-teletravail/.calendar-badge-teletravail du Calendrier');
  }

  // ---- Tableaux en carte sur mobile, généralisés au-delà du seul Tableau des compteurs ----
  {
    const { DB, sandbox, renderEmployeesList, renderCongesDemandes, renderFrais, state } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;

    const htmlEmployees = renderEmployeesList();
    assert.ok(htmlEmployees.includes('table mobile-cards'), 'Salariés : la table doit porter la classe mobile-cards');
    assert.ok(htmlEmployees.includes('row-title'), 'Salariés : la cellule "nom" doit porter la classe row-title (titre de la carte sur mobile)');

    const company = DB.getCurrentCompany();
    const leaveType = DB.getLeaveTypes()[0];
    const salarie = company.employees.find(e => e.role === 'salarie');
    company.leaveRequests = [{ id: 'lr-x', employeeId: salarie.id, typeId: leaveType.id, dateDebut: '2026-06-01', dateFin: '2026-06-01', nbJours: 1, statut: 'En attente', etapeIndex: 0, workflow: ['manager'], historique: [], demiJournee: null }];
    DB.saveCurrentCompany(company);
    state.congesFilters = { employeeId: '', typeId: '', statut: '' };
    state.congesPage = 1;
    const htmlConges = renderCongesDemandes('conge');
    assert.ok(htmlConges.includes('table mobile-cards'), 'Congés & absences : la table doit porter la classe mobile-cards');
    assert.ok(htmlConges.includes('table-select-cell'), 'la case à cocher de sélection en masse doit être identifiée pour être masquée sur mobile (sans quoi elle resterait affichée sans étiquette)');

    company.expenses = [{ id: 'nf-x', employeeId: salarie.id, date: '2026-06-01', categorie: 'Repas', libelle: 'Test', montantTTC: 10, statut: 'En attente', etapeIndex: 0, historique: [] }];
    DB.saveCurrentCompany(company);
    state.fraisFilters = { employeeId: '', categorie: '', statut: '', periode: '' };
    state.fraisPage = 1;
    const htmlFrais = renderFrais();
    assert.ok(htmlFrais.includes('table mobile-cards'), 'Notes de frais : la table doit porter la classe mobile-cards');
  }

  // ---- Popover "Filtres" généralisé sur mobile (repose sur le même mécanisme que le Calendrier) ----
  {
    const { DB, sandbox, renderEmployeesList, renderCongesDemandes, renderOrganigramme, state } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;

    const htmlEmployees = renderEmployeesList();
    assert.ok(htmlEmployees.includes('data-toggle-filters="employees-filters"'), 'Salariés : bouton de repli des filtres présent');
    assert.ok(htmlEmployees.includes('id="employees-filters"') && htmlEmployees.includes('toolbar-collapsible'), 'Salariés : la toolbar de filtres doit être repliable');

    state.filters.service = 'Ventes';
    const htmlWithFilter = renderEmployeesList();
    assert.ok(/Filtres\s*\(1\)/.test(htmlWithFilter), 'un filtre actif doit apparaître en repère sur le bouton (ex. "Filtres (1)")');
    state.filters.service = '';

    state.congesFilters = { employeeId: '', typeId: '', statut: '' };
    state.congesPage = 1;
    const htmlConges = renderCongesDemandes('conge');
    assert.ok(htmlConges.includes('data-toggle-filters="conges-filters"'), 'Congés & absences : bouton de repli des filtres présent');

    state.organigrammeFilters = { search: '', etablissementId: '', service: '', equipe: '' };
    const htmlOrg = renderOrganigramme();
    assert.ok(htmlOrg.includes('data-toggle-filters="org-filters"'), 'Organigramme : bouton de repli des filtres présent');
  }

  // ---- Formulaire salarié : sommaire cliquable au lieu d'un seul long défilement ----
  {
    const { DB, sandbox, openEmployeeModal, state } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;

    openEmployeeModal();
    const html = sandbox.document.getElementById('modal-root').innerHTML;
    assert.ok(html.includes('form-summary-nav'), 'le sommaire cliquable doit être présent en haut du formulaire');
    ['Identité', 'Contrat &amp; poste', 'Temps de travail', 'Statut'].forEach(label => {
      assert.ok(html.includes(`>${label}<`), `le sommaire doit proposer un lien vers "${label}"`);
    });
    assert.ok(!html.includes('>Confidentiel<'), 'sans les réglages qui l\'activent, la section "Confidentiel" (et son lien) ne doit pas exister');
    assert.ok(html.includes('id="employee-form-section-identite"'), 'chaque section ciblée par le sommaire doit exposer l\'id correspondant');

    const proprietaire = DB.getEmployees().find(e => e.role === 'proprietaire');
    DB._currentEmployeeId = proprietaire.id;
    const company = DB.getCurrentCompany();
    company.settings = Object.assign({}, company.settings, { masseSalarialeActivee: true });
    DB.saveCurrentCompany(company);
    openEmployeeModal();
    const htmlProprietaire = sandbox.document.getElementById('modal-root').innerHTML;
    assert.ok(htmlProprietaire.includes('>Confidentiel<'), 'un propriétaire avec le suivi de masse salariale activé doit voir le lien vers "Confidentiel"');
  }

  // ---- Notifications : pagination au lieu d'un plafond fixe sans suite possible ----
  {
    const { DB, sandbox, renderNotifPanel, state } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;

    const company = DB.getCurrentCompany();
    company.notifications = Array.from({ length: 25 }, (_, i) => ({
      id: `notif-${i}`,
      date: new Date(2026, 8, 1, 12, 0, i).toISOString(),
      icon: '🔔', title: `Notification ${i}`, message: 'Test', nav: 'dashboard', params: {},
      luPar: {}, archivePar: {}
    }));
    DB.saveCurrentCompany(company);
    state.notifTab = 'toutes';
    state.notifPage = 1;

    renderNotifPanel();
    const panelHtml = sandbox.document.getElementById('notif-panel').innerHTML;
    assert.ok(panelHtml.includes('Page 1 / 2'), '25 notifications avec des pages de 20 (LIST_PAGE_SIZE) doivent donner 2 pages');
    assert.ok(!panelHtml.includes('Affichage limité'), 'l\'ancien plafond fixe sans suite possible ne doit plus jamais apparaître');
    assert.ok(panelHtml.includes('id="btn-page-next"'), 'un vrai contrôle de pagination doit être présent');
  }

  console.log('OK — refonte-ux-09-09.test.js (roster équipe calendrier, heures Planning Semaine, couleurs congé/télétravail alignées, tableaux carte mobile généralisés, popover filtres généralisé, sommaire formulaire salarié, pagination notifications)');
}

run().catch((err) => {
  console.error('ÉCHEC — refonte-ux-09-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
