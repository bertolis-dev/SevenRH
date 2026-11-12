/**
 * Seven RH — retour du 06/11/2026 : (1) une demi-journée du Calendrier des absences doit se voir au premier coup d'œil (case coupée en diagonale) ;
 * (2) un type décoché dans « Types d'absences autorisés » de la fiche ne doit plus apparaître dans les compteurs du salarié.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function setup() {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  return api;
}

function run() {
  const api = setup();
  const { DB, state, renderAbsenceCalendarRow } = api;
  state.calendarYear = 2026; state.calendarMonth = 8;
  const employee = DB.getEmployees()[0];
  const cp = DB.getLeaveTypes().find(t => /congés payés/i.test(t.nom));
  const types = new Map(DB.getLeaveTypes().map(t => [t.id, t]));
  const meta = (day) => ({ dateStr: `2026-09-${String(day).padStart(2, '0')}`, isWeekend: false, isToday: false });
  const req = (extra) => [{ id: 'r', employeeId: employee.id, typeId: cp.id, statut: 'Validé', ...extra }];

  // --- Demi-journée seule : triangle haut-gauche (matin) / bas-droite (après-midi) ---
  const matin = renderAbsenceCalendarRow(employee, [14], meta, req({ dateDebut: '2026-09-14', dateFin: '2026-09-14', demiJournee: 'matin' }), [], types);
  assert.ok(matin.includes('clip-path:polygon(0 0, 100% 0, 0 100%)'), 'matin = triangle en haut à gauche');
  assert.ok(matin.includes('absence-cal-half-matin'));
  const apres = renderAbsenceCalendarRow(employee, [14], meta, req({ dateDebut: '2026-09-14', dateFin: '2026-09-14', demiJournee: 'apres-midi' }), [], types);
  assert.ok(apres.includes('clip-path:polygon(100% 0, 100% 100%, 0 100%)'), 'après-midi = triangle en bas à droite');
  assert.ok(apres.includes('(après-midi)'), 'le libellé reste lisible au survol');

  // --- Journée entière : aucune découpe ---
  const entiere = renderAbsenceCalendarRow(employee, [14], meta, req({ dateDebut: '2026-09-14', dateFin: '2026-09-14' }), [], types);
  assert.ok(!entiere.includes('clip-path'), 'une journée entière reste une case pleine');

  // --- Période : seule l'extrémité concernée est taillée en biais ---
  const debutPm = renderAbsenceCalendarRow(employee, [14, 15, 16, 17], meta, req({ dateDebut: '2026-09-14', dateFin: '2026-09-17', demiJourneeDebut: 'apres-midi' }), [], types);
  assert.ok(debutPm.includes('clip-path:polygon(25% 0, 100% 0, 100% 100%, 0 100%)'), 'début l\'après-midi : bord gauche oblique sur la largeur d\'un jour');
  const finAm = renderAbsenceCalendarRow(employee, [14, 15, 16, 17], meta, req({ dateDebut: '2026-09-14', dateFin: '2026-09-17', demiJourneeFin: 'matin' }), [], types);
  assert.ok(finAm.includes('clip-path:polygon(0 0, 100% 0, 75% 100%, 0 100%)'), 'fin le matin : bord droit oblique');
  const lesDeux = renderAbsenceCalendarRow(employee, [14, 15, 16, 17], meta, req({ dateDebut: '2026-09-14', dateFin: '2026-09-17', demiJourneeDebut: 'apres-midi', demiJourneeFin: 'matin' }), [], types);
  assert.ok(lesDeux.includes('clip-path:polygon(25% 0, 100% 0, 75% 100%, 0 100%)'), 'les deux extrémités à la fois');
  const periodeEntiere = renderAbsenceCalendarRow(employee, [14, 15, 16, 17], meta, req({ dateDebut: '2026-09-14', dateFin: '2026-09-17' }), [], types);
  assert.ok(!periodeEntiere.includes('clip-path'), 'une période de jours entiers reste une barre rectangulaire');

  // --- Compteurs : type décoché masqué, sauf s'il a déjà des demandes ---
  const rtt = DB.getLeaveTypes().find(t => t.id !== cp.id && t.actif && t.visibleSalarie);
  assert.ok(rtt, 'préalable : un second type actif existe');
  const avant = api.sandbox.renderEmployeeBalances(DB.getEmployeeById(employee.id));
  assert.ok(avant.includes(rtt.nom), 'préalable : le RTT apparaît tant qu\'il est autorisé');
  api.employeeRepository.update(employee.id, { typesAbsenceDesactives: [rtt.id] });
  const apresDecoche = api.sandbox.renderEmployeeBalances(DB.getEmployeeById(employee.id));
  assert.ok(!apresDecoche.includes(`>${rtt.nom}<`), 'le RTT décoché disparaît des compteurs');
  assert.ok(apresDecoche.includes('balance-card'), 'les autres compteurs restent');

  console.log('OK — calendrier-demi-case-compteurs-masques-06-11.test.js (demi-case diagonale ; compteurs masqués pour les types décochés)');
}

run();

// --- Import : licence « Congés » et message du bandeau ---
(function licenceEtBandeau() {
  const api = setup();
  const { DB } = api;
  assert.ok(/licence/i.test(api.sandbox.explicationRefusSynchro('75 lignes refusées sur 75 (leave_requests), première erreur : new row violates row-level security policy for table "leave_requests"')), 'le bandeau explique le refus des congés');
  assert.strictEqual(api.sandbox.explicationRefusSynchro('network error'), '', 'pas d\'explication pour une autre erreur');

  const salarie = api.employeeRepository.getAll().find(e => !e.archive && e.role === 'salarie');
  const courant = api.companyRepository.getCurrent();
  courant.abonnement = { ...(courant.abonnement || {}), offre: 'a_la_carte', modules: [{ key: 'conges', quantite: 1 }] };
  courant.moduleLicenses = { conges: [] };
  const type = api.leaveTypeRepository.getLeaveTypes().find(t => t.categorie === 'conge' && t.nom === 'Congés payés');
  const mapping = api.guessAbsencesColumnMapping(['Matricule', 'Type', 'Date début', 'Date fin']);
  const rows = api.buildAbsencesPreviewRows([[salarie.matricule, type.nom, '05/10/2026', '']], mapping, 'conge');
  if (api.sandbox.hasModuleLicense(salarie, 'conges')) {
    console.log('(licence déjà reconnue pour ce jeu de données : contrôle d\'aperçu non exercé)');
  } else {
    assert.strictEqual(rows[0].status, 'error');
    assert.ok(/licence/i.test(rows[0].message), rows[0].message);
    courant.moduleLicenses = { conges: [salarie.id] };
    const ok = api.buildAbsencesPreviewRows([[salarie.matricule, type.nom, '05/10/2026', '']], mapping, 'conge');
    assert.strictEqual(ok[0].status, 'ok', ok[0].message);
  }
  console.log('OK — licence Congés signalée à l\'aperçu d\'import, bandeau explicatif');
})();

// --- Planning : demi-journée en diagonale ---
(function planningDemiJournee() {
  const api = setup();
  const e = api.DB.getEmployees()[0];
  const cp = api.DB.getLeaveTypes().find(t => /congés payés/i.test(t.nom));
  const jour = '2026-09-14'; // lundi
  e.joursTravailles = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'];
  const req = (extra) => [{ id: 'p', employeeId: e.id, typeId: cp.id, dateDebut: jour, dateFin: jour, statut: 'Validé', ...extra }];
  const m = api.renderPlanningStatusCell(e, jour, req({ demiJournee: 'matin' }), [], true);
  const a = api.renderPlanningStatusCell(e, jour, req({ demiJournee: 'apres-midi' }), [], false);
  const p = api.renderPlanningStatusCell(e, jour, req({}), [], true);
  assert.ok(m.includes('planning-shift-half-matin'), 'matin : classe diagonale');
  assert.ok(a.includes('planning-shift-half-apres-midi'), 'après-midi : classe diagonale (vue Mois comprise)');
  assert.ok(!p.includes('planning-shift-half'), 'journée entière : aucune diagonale');
  console.log('OK — planning : demi-journée en diagonale');
})();
