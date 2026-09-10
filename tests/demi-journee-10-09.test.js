/**
 * Seven RH — retour Betty du 10/09/2026 : "il faut que dans les congés on puisse poser une
 * demi-journée et que ce soit affiché dans le planning équipe et calendrier entreprise".
 *
 * La demi-journée se pose déjà techniquement (openLeaveRequestModal, champs demiJournee/
 * demiJourneeDebut/demiJourneeFin) — mais deux défauts distincts empêchaient Betty de le constater :
 *
 * 1. Le sélecteur demi-journée n'apparaît QUE si type.autoriserDemiJournee est vrai
 *    (updateLeaveRequestHints, app.js). Un type créé APRÈS l'ajout de ce champ l'a (true par défaut,
 *    makeEmptyLeaveType) mais un type plus ANCIEN que ce champ (le cas de "Seven Sept", l'entreprise
 *    réelle de Betty — voir le commentaire de hydrateCurrentCompanyWithMigrations, data.js) ne l'a
 *    jamais reçu : `undefined`, donc le sélecteur ne s'affiche jamais, sans le moindre message
 *    d'erreur. migrateLeaveTypeAutoriserDemiJournee (data.js) corrige ça, et — contrairement aux
 *    AUTRES migrations client existantes, qui ne corrigent que le cache local (DB.init()) — est
 *    aussi appliquée à la VRAIE connexion (hydrateCurrentCompanyWithMigrations), là où ça compte
 *    réellement pour une entreprise déjà créée.
 * 2. Même une fois posée, rien ne signalait la demi-journée dans le Planning équipe
 *    (getStatusForDate) ni dans le Calendrier des absences (renderAbsenceCalendarRow) — les deux
 *    affichaient juste le nom du type de congé, identique à une journée complète.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');
const { loadDataJs } = require('./load-data-js');

async function run() {
  // ---- migrateLeaveTypeAutoriserDemiJournee (data.js) : backfill du champ manquant ----
  {
    const { migrateLeaveTypeAutoriserDemiJournee } = loadDataJs();
    const company = {
      leaveTypes: [
        { id: 't1', nom: 'Congés payés' }, // créé avant l'existence du champ : absent
        { id: 't2', nom: 'Sans solde', autoriserDemiJournee: false }, // déjà réglé explicitement : ne doit PAS être touché
        { id: 't3', nom: 'RTT', autoriserDemiJournee: true }
      ]
    };
    const changed = migrateLeaveTypeAutoriserDemiJournee(company);
    assert.strictEqual(changed, true, 'un type sans le champ doit déclencher le backfill');
    assert.strictEqual(company.leaveTypes[0].autoriserDemiJournee, true, 'le champ manquant doit être ajouté à true (comportement par défaut de makeEmptyLeaveType)');
    assert.strictEqual(company.leaveTypes[1].autoriserDemiJournee, false, 'un type déjà réglé explicitement à false ne doit jamais être écrasé');
    assert.strictEqual(company.leaveTypes[2].autoriserDemiJournee, true, 'un type déjà réglé à true reste inchangé');

    const changedAgain = migrateLeaveTypeAutoriserDemiJournee(company);
    assert.strictEqual(changedAgain, false, 'idempotent : un second passage ne doit plus rien changer');
  }

  // ---- hydrateCurrentCompanyWithMigrations : corrige aussi une VRAIE connexion, pas seulement le cache local ----
  {
    const { sandbox, hydrateCurrentCompanyWithMigrations, seedLeaveTypes } = loadDataJs();
    // Tous les types par défaut déjà "proposés" (defaultLeaveTypesSeeded) : neutralise
    // ensureDefaultLeaveTypesBackfilled (rien à ajouter, rien à pousser) pour isoler ce qu'on teste
    // réellement ici — migrateLeaveTypeAutoriserDemiJournee, pas le backfill des types manquants
    // (déjà couvert par tests/leave-types-backfill.test.js).
    const allDefaultNames = seedLeaveTypes().map(t => t.nom.trim().toLowerCase());

    const rhUser = { id: 'emp1', role: 'rh' };
    const pushedCalls = [];
    sandbox.window.SupabaseSync = {
      hydrateCurrentCompany: async () => ({
        id: 'c1',
        _currentEmployeeId: 'emp1',
        employees: [rhUser],
        defaultLeaveTypesSeeded: allDefaultNames,
        leaveTypes: [{ id: 't1', nom: 'Congés payés' }] // pas de autoriserDemiJournee, comme une entreprise réelle plus ancienne que ce champ
      }),
      pushLeaveTypes: async (leaveTypes) => { pushedCalls.push(leaveTypes); },
      // seedExampleShifts (§10/09/2026) tourne aussi ici (le mock ci-dessus n'a pas de champ
      // `shifts`) et pousse via pushCompanyProfile — sans mock, l'appel échoue (avalé par le
      // try/catch, sans faire échouer ce test) mais pollue la sortie console pour rien.
      pushCompanyProfile: async () => {}
    };
    const company = await hydrateCurrentCompanyWithMigrations();
    assert.strictEqual(company.leaveTypes[0].autoriserDemiJournee, true, 'la VRAIE connexion (pas seulement DB.init) doit corriger le champ manquant');
    assert.strictEqual(pushedCalls.length, 1, 'un RH (droit d\'écrire les types de congés) doit voir la correction poussée côté serveur');
    assert.ok(Array.isArray(company.shifts) && company.shifts.length > 0, 'seedExampleShifts doit aussi tourner sur une vraie connexion (même leçon que la demi-journée)');

    // Un salarié (pas le droit d'écrire les paramètres) : correction en mémoire pour cette session,
    // mais jamais de tentative d'écriture serveur (la policy RLS leave_types_write la rejetterait de
    // toute façon — même précaution que ensureDefaultLeaveTypesBackfilled un peu plus haut dans ce fichier).
    const salarieUser = { id: 'emp2', role: 'salarie' };
    const pushedCalls2 = [];
    sandbox.window.SupabaseSync = {
      hydrateCurrentCompany: async () => ({
        id: 'c2',
        _currentEmployeeId: 'emp2',
        employees: [salarieUser],
        defaultLeaveTypesSeeded: allDefaultNames,
        leaveTypes: [{ id: 't1', nom: 'Congés payés' }]
      }),
      pushLeaveTypes: async (leaveTypes) => { pushedCalls2.push(leaveTypes); },
      pushCompanyProfile: async () => {}
    };
    const company2 = await hydrateCurrentCompanyWithMigrations();
    assert.strictEqual(company2.leaveTypes[0].autoriserDemiJournee, true, 'la correction s\'applique en mémoire quel que soit le rôle (mutation sans risque, aucun id externe en jeu)');
    assert.strictEqual(pushedCalls2.length, 0, 'un salarié ne doit jamais déclencher d\'écriture serveur des types de congés');
  }

  // ---- getHalfDayForDate (app.js) : la demi-journée concerne UNE date précise, jamais un jour intermédiaire ----
  {
    const { getHalfDayForDate } = loadAppJs();
    const monoJour = { dateDebut: '2026-09-15', dateFin: '2026-09-15', demiJournee: 'matin' };
    assert.strictEqual(getHalfDayForDate(monoJour, '2026-09-15'), 'matin');

    const periode = { dateDebut: '2026-09-15', dateFin: '2026-09-17', demiJourneeDebut: 'apres-midi', demiJourneeFin: 'matin' };
    assert.strictEqual(getHalfDayForDate(periode, '2026-09-15'), 'apres-midi', 'premier jour : après-midi seulement');
    assert.strictEqual(getHalfDayForDate(periode, '2026-09-16'), null, 'jour intermédiaire : journée complète, jamais une demi-journée');
    assert.strictEqual(getHalfDayForDate(periode, '2026-09-17'), 'matin', 'dernier jour : matin seulement');

    assert.strictEqual(getHalfDayForDate({ dateDebut: '2026-09-15', dateFin: '2026-09-17' }, '2026-09-15'), null, 'aucun champ demi-journée renseigné : null');
    assert.strictEqual(getHalfDayForDate(null, '2026-09-15'), null);
  }

  // ---- Planning équipe (getStatusForDate) : affiche la demi-journée dans le titre de la case ----
  {
    const { DB, getStatusForDate } = loadAppJs();
    DB.init();
    const employee = DB.getEmployees().find(e => (e.joursTravailles || []).includes('Lun')) || DB.getEmployees()[0];
    const cp = DB.getLeaveTypes().find(t => /congés payés/i.test(t.nom));

    const monoJourRequest = [{ id: 'r1', employeeId: employee.id, typeId: cp.id, dateDebut: '2026-09-14', dateFin: '2026-09-14', demiJournee: 'matin', statut: 'Validé' }];
    const statusMono = getStatusForDate(employee, '2026-09-14', monoJourRequest, []);
    assert.ok(statusMono.title.includes('(matin)'), `le titre doit mentionner "(matin)" pour une demi-journée isolée, reçu : "${statusMono.title}"`);

    const periodeRequest = [{ id: 'r2', employeeId: employee.id, typeId: cp.id, dateDebut: '2026-09-14', dateFin: '2026-09-16', demiJourneeDebut: 'apres-midi', demiJourneeFin: 'matin', statut: 'Validé' }];
    const statusDebut = getStatusForDate(employee, '2026-09-14', periodeRequest, []);
    assert.ok(statusDebut.title.includes('(après-midi)'), `premier jour d'une période à cheval : "(après-midi)" attendu, reçu : "${statusDebut.title}"`);
    const statusMilieu = getStatusForDate(employee, '2026-09-15', periodeRequest, []);
    assert.ok(!statusMilieu.title.includes('matin') && !statusMilieu.title.includes('après-midi'), `jour intermédiaire : aucune mention de demi-journée attendue, reçu : "${statusMilieu.title}"`);
    const statusFin = getStatusForDate(employee, '2026-09-16', periodeRequest, []);
    assert.ok(statusFin.title.includes('(matin)'), `dernier jour d'une période à cheval : "(matin)" attendu, reçu : "${statusFin.title}"`);
  }

  // ---- Calendrier entreprise (renderAbsenceCalendarRow) : affiche la demi-journée sur la barre ----
  {
    const { DB, getHalfDayForDate, computeAbsenceCalendarSegments, renderAbsenceCalendarRow } = loadAppJs();
    DB.init();
    const employee = DB.getEmployees()[0];
    const cp = DB.getLeaveTypes().find(t => /congés payés/i.test(t.nom));
    const leaveTypesById = new Map(DB.getLeaveTypes().map(t => [t.id, t]));
    const year = 2026, month = 8; // septembre (0-indexé)
    const dayMeta = (day) => ({ dateStr: `2026-09-${String(day).padStart(2, '0')}`, isWeekend: false, isToday: false });

    // Demi-journée isolée (segment d'un seul jour) : suffixe directement dans le libellé centré.
    const monoJourRequest = [{ id: 'r1', employeeId: employee.id, typeId: cp.id, dateDebut: '2026-09-14', dateFin: '2026-09-14', demiJournee: 'matin', statut: 'Validé' }];
    const rowMono = renderAbsenceCalendarRow(employee, [14], dayMeta, monoJourRequest, [], leaveTypesById);
    assert.ok(rowMono.includes('(matin)'), `le libellé d'un segment d'un seul jour doit mentionner "(matin)", reçu : ${rowMono}`);

    // Demi-journée sur une période de plusieurs jours : marqueur "½" sur le quantième concerné + mention dans le title.
    const periodeRequest = [{ id: 'r2', employeeId: employee.id, typeId: cp.id, dateDebut: '2026-09-14', dateFin: '2026-09-16', demiJourneeDebut: 'apres-midi', statut: 'Validé' }];
    const rowPeriode = renderAbsenceCalendarRow(employee, [14, 15, 16], dayMeta, periodeRequest, [], leaveTypesById);
    assert.ok(rowPeriode.includes('<sup>½</sup>'), `un marqueur "½" doit apparaître sur le quantième du premier jour, reçu : ${rowPeriode}`);
    assert.ok(rowPeriode.includes('après-midi'), `le title doit mentionner "après-midi" pour le premier jour de la période, reçu : ${rowPeriode}`);

    // Vérifie aussi le résultat brut de computeAbsenceCalendarSegments (un seul segment, tous les jours regroupés).
    const segments = computeAbsenceCalendarSegments(employee, [14, 15, 16], year, month, periodeRequest, []);
    assert.strictEqual(segments.length, 1);
    assert.strictEqual(segments[0].days.length, 3);
    assert.strictEqual(getHalfDayForDate(segments[0].leave, '2026-09-14'), 'apres-midi');
    assert.strictEqual(getHalfDayForDate(segments[0].leave, '2026-09-15'), null);
  }

  console.log('OK — demi-journee-10-09.test.js (backfill autoriserDemiJournee sur vraie connexion, affichage planning équipe et calendrier entreprise)');
}

run().catch((err) => {
  console.error('ÉCHEC — demi-journee-10-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
