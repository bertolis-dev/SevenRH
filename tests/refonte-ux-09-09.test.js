/**
 * Seven RH — refonte pratique du 09/09/2026, en plusieurs vagues au fil des retours de Betty dans la
 * même journée. Ce fichier couvre : le planning des absences en cases du Calendrier (une case par
 * jour, coloriée par type de congé/télétravail, regroupée par service comme le Planning), le design
 * "carte" du Planning Semaine (avatar, plage horaire réelle sur chaque jour travaillé, colonne
 * Total, bandeau de service marine — inspiré d'Agendrix mais SANS sa palette par poste), la
 * cohérence des couleurs congé/télétravail entre Planning et Calendrier, le format carte mobile
 * généralisé (Salariés/Congés/Télétravail/Notes de frais), le popover "Filtres" généralisé sur
 * mobile (Salariés/Congés/Organigramme), le sommaire cliquable du formulaire salarié, et la
 * pagination du panneau de notifications (remplace l'ancien plafond fixe).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAppJs } = require('./load-app-js');

async function run() {
  // ---- Calendrier des absences (vue équipe/entreprise) : un planning en cases par jour, chaque
  //      case coloriée par TYPE de congé (couleur déjà configurable en Paramètres, pas une nouvelle
  //      palette), regroupé par service comme le Planning — retour Betty du 09/09/2026 en plusieurs
  //      temps : "fais un calendrier dans ce style [...] pour chaque congé une couleur", "fais des
  //      cases", puis "quand il y a un congé [...] ne fais pas une ligne remplie, juste les cases" —
  //      un essai intermédiaire fusionnait une absence de plusieurs jours en une seule barre
  //      continue (colspan), rejeté au profit de cases individuelles pour ne jamais casser le
  //      damier. Remplace aussi le roster-en-modale d'un essai précédent (devenu inatteignable : la
  //      vue équipe n'affiche plus la grille de jours cliquable, ce planning répond déjà "qui est
  //      là" sans clic). ----
  {
    const { DB, sandbox, renderCalendrier, state } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    state.calendrierVue = 'entreprise';
    state.calendarYear = 2026;
    state.calendarMonth = 8; // septembre (0-indexé)
    state.calendarServiceFilter = '';

    const company = DB.getCurrentCompany();
    const salaries = company.employees.filter(e => e.role === 'salarie');
    assert.ok(salaries.length >= 2, 'préalable du scénario : au moins 2 salariés dans le jeu de démonstration');
    const [e1, e2] = salaries;
    e1.service = 'Ventes';
    e2.service = 'Ventes';
    const leaveTypes = DB.getLeaveTypes();
    const typeA = leaveTypes[0];
    typeA.couleur = '#e91e63';
    company.leaveRequests = [
      // Absence de 3 jours consécutifs -> doit rester 3 cases individuelles coloriées, jamais une
      // seule barre fusionnée (colspan).
      { id: 'lr-1', employeeId: e1.id, typeId: typeA.id, dateDebut: '2026-09-08', dateFin: '2026-09-10', nbJours: 3, statut: 'Validé', etapeIndex: 1, workflow: ['manager'], historique: [], demiJournee: null }
    ];
    company.teleworkRequests = [
      { id: 'tt-1', employeeId: e2.id, dateDebut: '2026-09-15', dateFin: '2026-09-15', nbJours: 1, statut: 'Validé', etapeIndex: 1, workflow: ['manager'], historique: [], commentaire: '' }
    ];
    DB.saveCurrentCompany(company);

    const html = renderCalendrier();
    assert.ok(html.includes('absence-cal-table'), 'la vue équipe/entreprise doit afficher le planning des absences en cases');
    assert.ok(!html.includes('calendar-grid-header'), 'l\'ancienne grille mensuelle (jour par jour) ne doit plus apparaître en vue équipe/entreprise');
    assert.ok(!html.includes('colspan="3"') && !html.includes('colspan=\"3\"'), 'une absence de plusieurs jours ne doit plus être fusionnée en une seule barre (colspan) — rejeté par Betty');
    // 4 occurrences attendues : 3 cases (une par jour de l'absence) + 1 pastille de légende pour ce type.
    const filledOccurrences = html.split(`background:${typeA.couleur}`).length - 1;
    assert.strictEqual(filledOccurrences, 4, 'les 3 jours de l\'absence doivent apparaître comme 3 cases individuelles coloriées (+ 1 pastille de légende), chacune reprenant EXACTEMENT la couleur configurée pour ce type (Paramètres > Types d\'absences)');
    assert.ok(html.includes('absence-cal-bar-telework'), 'le télétravail doit apparaître comme une case à part, avec l\'accent marine déjà utilisé pour lui ailleurs');
    assert.ok(html.includes('Tous les services'), 'un filtre service doit être disponible, comme dans le modèle envoyé');

    // Vue personnelle : le planning des absences (multi-salarié) n'a pas de sens pour une seule
    // personne — l'ancienne grille mensuelle doit rester inchangée là.
    state.calendrierVue = 'personnel';
    const htmlPersonnel = renderCalendrier();
    assert.ok(!htmlPersonnel.includes('absence-cal-table'), 'en vue personnelle, le planning des absences (multi-salarié) ne doit pas apparaître');
    assert.ok(htmlPersonnel.includes('calendar-grid-header'), 'en vue personnelle, la grille mensuelle habituelle doit rester en place');
  }

  // ---- Planning : la vue Semaine affiche la vraie plage horaire (modifiable) SUR CHAQUE JOUR
  //      travaillé — retour Betty du 09/09/2026 en deux temps : d'abord "pas le nombre d'heures
  //      mais d'une telle heure à une autre", puis "il faut qu'il y ait les horaires pour chaque
  //      jour" (un essai intermédiaire ne l'affichait qu'une fois, à côté du nom). ----
  {
    const { DB, sandbox, renderPlanningSemaine, formatHorairesRange, state } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    state.planningVue = 'equipe';
    state.planningWeekOffset = 0;
    state.planningFilters = { service: '' };

    const company = DB.getCurrentCompany();
    const salarie = company.employees.find(e => e.role === 'salarie');
    // Plage volontairement distincte des horaires par défaut du jeu de démonstration (souvent
    // partagés par plusieurs salariés) : un simple .includes() sur toute la page compterait aussi
    // les lignes d'autres salariés portant la même plage par coïncidence.
    Object.assign(salarie, {
      joursTravailles: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'],
      horaireMatinDebut: '08:15', horaireMatinFin: '12:15',
      horaireApresMidiDebut: '14:00', horaireApresMidiFin: '18:00'
    });
    DB.saveCurrentCompany(company);

    assert.strictEqual(formatHorairesRange(salarie), '08:15-12:15 · 14:00-18:00');

    const html = renderPlanningSemaine();
    assert.ok(!html.includes('planning-cell-hours'), 'un total d\'heures calculé ne doit plus apparaître dans les cases (rejeté par Betty)');
    const occurrences = html.split('08:15-12:15 · 14:00-18:00').length - 1;
    assert.strictEqual(occurrences, 7, 'la plage horaire doit apparaître sur CHAQUE jour travaillé (les 7 jours ici, joursTravailles couvrant toute la semaine), pas une seule fois à côté du nom');
    assert.ok(html.includes(`data-edit-horaires="${salarie.id}"`), 'le crayon "Modifier les horaires" reste atteignable (à côté du nom) même si la plage est désormais répétée par jour');
  }

  // ---- Cohérence visuelle : congé/télétravail utilisent désormais EXACTEMENT la même couleur dans
  //      le Planning que dans le Calendrier (avant ce correctif, le vert signifiait "congé" au
  //      Calendrier mais "présent" au Planning — vérification statique du CSS, pas d'exécution DOM
  //      possible pour une couleur réellement calculée dans ce bac à sable). ----
  {
    const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
    // §demande Betty du 09/09/2026 ("style Agendrix") : ces couleurs vivent désormais sur la carte
    // .planning-shift-* (voir renderPlanningStatusCell) plutôt que directement sur .planning-leave/
    // .planning-remote appliquées à la cellule entière — mêmes teintes, nouveau sélecteur.
    assert.ok(/\.planning-shift-leave\s*\{\s*background:\s*var\(--color-success-soft\)/.test(css),
      'planning-shift-leave (congé) doit utiliser le même vert que .legend-conge/.calendar-badge-conge du Calendrier');
    assert.ok(/\.planning-shift-remote\s*\{\s*background:\s*var\(--color-primary-soft\)/.test(css),
      'planning-shift-remote (télétravail) doit utiliser le même accent marine que .legend-teletravail/.calendar-badge-teletravail du Calendrier');
  }

  // ---- Design "carte" du Planning (style Agendrix, sans reprendre sa palette par poste) ----
  {
    const { DB, sandbox, renderPlanningSemaine, state } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    state.planningVue = 'equipe';
    state.planningWeekOffset = 0;
    state.planningFilters = { service: '' };

    const html = renderPlanningSemaine();
    assert.ok(html.includes('planning-shift-card'), 'chaque jour occupé doit être présenté comme une petite carte, pas un simple aplat de couleur sur toute la cellule');
    assert.ok(html.includes('planning-employee-cell') && html.includes('avatar'), 'l\'avatar du salarié doit apparaître à côté de son nom, comme dans le modèle envoyé');
    assert.ok(html.includes('<th>Total</th>') && html.includes('planning-total-cell'), 'une colonne "Total" hebdomadaire doit exister, comme dans le modèle envoyé');
    assert.ok(!/tag-color-\d|avatar-color-\d/.test(html.match(/planning-shift-card[\s\S]*?<\/div>/)?.[0] || ''), 'aucune couleur par poste/service ne doit être introduite (palette bleu marine + or conservée, contrairement au modèle envoyé)');
  }

  // ---- Tableaux en carte sur mobile, généralisés au-delà du seul Tableau des compteurs ----
  {
    const { DB, sandbox, renderEmployeesList, renderCongesDemandes, renderFrais, renderTeletravailDemandes, state } = loadAppJs();
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

    // §oubli repéré en vérifiant l'affichage mobile le 09/09/2026 : l'onglet "Télétravail" de ce
    // même écran fusionné "Congés & absences" avait été laissé de côté lors de la généralisation du
    // format carte — seul son voisin "Congés" l'avait reçu, incohérence visible en changeant simplement
    // d'onglet sur le même écran.
    company.teleworkRequests = [{ id: 'tt-x', employeeId: salarie.id, dateDebut: '2026-06-01', dateFin: '2026-06-01', nbJours: 1, statut: 'En attente', etapeIndex: 0, workflow: ['manager'], historique: [], commentaire: '' }];
    DB.saveCurrentCompany(company);
    state.teletravailFilters = { employeeId: '', statut: '' };
    state.teletravailPage = 1;
    const htmlTeletravail = renderTeletravailDemandes();
    assert.ok(htmlTeletravail.includes('table mobile-cards'), 'Télétravail (même écran que Congés & absences) : la table doit elle aussi porter la classe mobile-cards');
    assert.ok(htmlTeletravail.includes('data-toggle-filters="teletravail-filters"'), 'Télétravail : bouton de repli des filtres présent, comme sur Congés');
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

  console.log('OK — refonte-ux-09-09.test.js (planning des absences en cases du calendrier, design carte du Planning Semaine, couleurs congé/télétravail alignées, tableaux carte mobile généralisés, popover filtres généralisé, sommaire formulaire salarié, pagination notifications)');
}

run().catch((err) => {
  console.error('ÉCHEC — refonte-ux-09-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
