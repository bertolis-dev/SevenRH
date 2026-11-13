/**
 * Retour du 13/11/2026 : (1) deux types RTT selon le statut (cadres / non-cadres), chacun réservé à sa catégorie par une règle d'éligibilité —
 * un salarié ne voit que le compteur de son statut ; (2) dans le calendrier, un double-clic sur un congé (RH / administrateurs) ouvre la fiche
 * de modification et de suppression.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

const api = loadAppJs();
api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
api.DB.init();
const { DB, state, renderAbsenceCalendarRow } = api;

// --- Deux types RTT, un par catégorie ---
const categories = DB.getSettings().categoriesSalarie || [];
let cadre = categories.find(c => /^cadre$/i.test(c.nom));
let nonCadre = categories.find(c => /non cadre/i.test(c.nom));
assert.ok(cadre && nonCadre, 'préalable : les catégories Cadre et Non cadre existent dans les données de démonstration');

const rttCadres = DB.addLeaveType({ nom: 'RTT cadres', actif: true, visibleSalarie: true, acquisition: 'Annuelle', nombreAnnuel: 12, regles: [{ critere: 'categorieSalarieId', operateur: 'in', valeur: [cadre.id] }] });
const rttNon = DB.addLeaveType({ nom: 'RTT non-cadres', actif: true, visibleSalarie: true, acquisition: 'Annuelle', nombreAnnuel: 8, regles: [{ critere: 'categorieSalarieId', operateur: 'in', valeur: [nonCadre.id] }] });

const [a, b] = DB.getEmployees().filter(e => !e.archive);
api.employeeRepository.update(a.id, { categorieSalarieId: cadre.id });
api.employeeRepository.update(b.id, { categorieSalarieId: nonCadre.id });

const soldesCadre = api.sandbox.renderEmployeeBalances(DB.getEmployeeById(a.id));
const soldesNon = api.sandbox.renderEmployeeBalances(DB.getEmployeeById(b.id));
assert.ok(soldesCadre.includes('RTT cadres') && !soldesCadre.includes('RTT non-cadres'), 'un cadre ne voit que « RTT cadres »');
assert.ok(soldesNon.includes('RTT non-cadres') && !soldesNon.includes('RTT cadres'), 'un non-cadre ne voit que « RTT non-cadres »');

// Un historique réel n'est jamais caché : une demande existante sur le type non concerné le fait réapparaître.
const demandeHisto = { id: 'histo-rtt', employeeId: b.id, typeId: rttCadres.id, dateDebut: '2026-03-02', dateFin: '2026-03-02', statut: 'Validé', nbJours: 1 };
DB.saveLeaveRequests(DB.getLeaveRequests().concat([demandeHisto]));
assert.ok(api.sandbox.renderEmployeeBalances(DB.getEmployeeById(b.id)).includes('RTT cadres'), 'un type avec historique reste visible');
DB.saveLeaveRequests(DB.getLeaveRequests().filter(r => r.id !== 'histo-rtt'));

// Tableau des compteurs : « — » plutôt que « 0 » pour un type réservé à d'autres salariés.
const balanceZero = { acquis: 0, pris: 0, enAttente: 0, disponible: 0, ajustement: 0 };
assert.strictEqual(api.sandbox.compteurNonConcerne(DB.getEmployeeById(b.id), rttCadres, balanceZero), true, 'RTT cadres : non concerné pour un non-cadre');
assert.strictEqual(api.sandbox.compteurNonConcerne(DB.getEmployeeById(a.id), rttCadres, { ...balanceZero, acquis: 3, disponible: 3 }), false, 'RTT cadres : concerné pour un cadre');

// --- Calendrier : double-clic réservé à la RH / aux administrateurs ---
state.calendarYear = 2026; state.calendarMonth = 8;
const cp = DB.getLeaveTypes().find(t => /congés payés/i.test(t.nom));
const types = new Map(DB.getLeaveTypes().map(t => [t.id, t]));
const meta = (day) => ({ dateStr: `2026-09-${String(day).padStart(2, '0')}`, isWeekend: false, isToday: false });
const demande = [{ id: 'cal-1', employeeId: a.id, typeId: cp.id, dateDebut: '2026-09-14', dateFin: '2026-09-15', statut: 'Validé' }];

const rh = DB.getEmployees().find(e => e.role === 'rh');
DB._currentEmployeeId = rh.id;
const htmlRh = renderAbsenceCalendarRow(DB.getEmployeeById(a.id), [14, 15], meta, demande, [], types);
assert.ok(htmlRh.includes('data-cal-leave="cal-1"') && htmlRh.includes('absence-cal-editable'), 'la RH peut ouvrir un congé par double-clic');
assert.ok(htmlRh.includes('double-clic'), 'l\'info-bulle l\'explique');

const salarie = DB.getEmployees().find(e => e.role === 'salarie' && e.id !== a.id);
DB._currentEmployeeId = salarie.id;
const htmlSalarie = renderAbsenceCalendarRow(DB.getEmployeeById(a.id), [14, 15], meta, demande, [], types);
assert.ok(!htmlSalarie.includes('data-cal-leave'), 'un salarié n\'a pas de double-clic');

// --- La fiche propose Enregistrer et Supprimer ---
DB._currentEmployeeId = rh.id;
DB.saveLeaveRequests(DB.getLeaveRequests().concat(demande));
api.sandbox.openRegulariserModal('cal-1', { depuisCalendrier: true });
const modale = api.sandbox.document.getElementById('modal-root').innerHTML;
assert.ok(modale.includes('Modifier le congé') && modale.includes('id="btn-delete-leave-modal"') && modale.includes('Enregistrer'), 'fiche de modification avec bouton Supprimer');

console.log('OK — rtt-deux-statuts-calendrier-double-clic-13-11.test.js');

// --- Assistant « Deux RTT selon le statut » ---
(function assistantDeuxRtt() {
  const api2 = loadAppJs();
  api2.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api2.DB.init();
  const DB2 = api2.DB;
  const cats = DB2.getSettings().categoriesSalarie || [];
  const cadre2 = cats.find(c => /^cadre$/i.test(c.nom));
  const non2 = cats.find(c => /non cadre/i.test(c.nom));
  const baseRtt = DB2.getLeaveTypes().find(t => t.categorie === 'conge' && /^rtt/i.test(t.nom));
  assert.ok(baseRtt, 'préalable : un type RTT existe dans les données de démonstration');

  // Refus : mêmes catégories, jours manquants
  assert.strictEqual(api2.sandbox.creerDeuxTypesRtt({ baseId: baseRtt.id, categorieCadreId: cadre2.id, categorieNonCadreId: cadre2.id, joursCadre: 12, joursNonCadre: 8 }).success, false);
  assert.strictEqual(api2.sandbox.creerDeuxTypesRtt({ baseId: baseRtt.id, categorieCadreId: cadre2.id, categorieNonCadreId: non2.id, joursCadre: 0, joursNonCadre: 8 }).success, false);

  const avant = DB2.getLeaveTypes().length;
  const res = api2.sandbox.creerDeuxTypesRtt({ baseId: baseRtt.id, categorieCadreId: cadre2.id, categorieNonCadreId: non2.id, joursCadre: 12, joursNonCadre: 8 });
  assert.ok(res.success, res.error);
  assert.strictEqual(res.cadres.id, baseRtt.id, 'le type RTT existant est réutilisé (historique conservé)');
  assert.strictEqual(DB2.getLeaveTypes().length, avant + 1, 'un seul nouveau type : RTT non-cadres');
  assert.strictEqual(res.cadres.nom, 'RTT cadres');
  assert.strictEqual(res.nonCadres.nom, 'RTT non-cadres');
  assert.strictEqual(res.cadres.nombreAnnuel, 12);
  assert.strictEqual(res.nonCadres.nombreAnnuel, 8);
  assert.strictEqual(JSON.stringify(res.cadres.regles.find(r => r.critere === 'categorieSalarieId').valeur), JSON.stringify([cadre2.id]));
  assert.strictEqual(JSON.stringify(res.nonCadres.regles.find(r => r.critere === 'categorieSalarieId').valeur), JSON.stringify([non2.id]));

  // Relancer l'assistant ne doit pas créer de doublons
  assert.strictEqual(api2.sandbox.creerDeuxTypesRtt({ baseId: '', categorieCadreId: cadre2.id, categorieNonCadreId: non2.id, joursCadre: 12, joursNonCadre: 8 }).success, false, 'doublon refusé');

  // Départ de zéro : deux nouveaux types
  const api3 = loadAppJs();
  api3.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api3.DB.init();
  const c3 = api3.DB.getSettings().categoriesSalarie;
  const neuf = api3.sandbox.creerDeuxTypesRtt({ baseId: '', categorieCadreId: c3.find(c => /^cadre$/i.test(c.nom)).id, categorieNonCadreId: c3.find(c => /non cadre/i.test(c.nom)).id, joursCadre: 10, joursNonCadre: 6 });
  assert.ok(neuf.success && neuf.cadres.id !== neuf.nonCadres.id, 'deux types distincts créés');
  console.log('OK — assistant « Deux RTT selon le statut »');
})();

// --- Imports : un type réservé ne s'applique pas à un salarié non concerné (même règle que la saisie manuelle) ---
(function importsRespectentEligibilite() {
  const types2 = DB.getLeaveTypes();
  const mapSoldes = api.guessSoldesColumnMapping(['Matricule', 'RTT cadres'], types2);
  const lignes = api.buildSoldesPreviewRows([[a.matricule, '3'], [b.matricule, '3']], mapSoldes, 'cible');
  assert.strictEqual(lignes[0].status, 'ok', 'un cadre peut recevoir un solde « RTT cadres » : ' + lignes[0].message);
  assert.strictEqual(lignes[1].status, 'error', 'un non-cadre ne peut pas recevoir de solde « RTT cadres »');
  assert.ok(/pas concerné/.test(lignes[1].message), lignes[1].message);

  const mapAbs = api.guessAbsencesColumnMapping(['Matricule', 'Type', 'Date début', 'Date fin']);
  const abs = api.buildAbsencesPreviewRows([[a.matricule, 'RTT cadres', '05/10/2026', ''], [b.matricule, 'RTT cadres', '06/10/2026', '']], mapAbs, 'conge');
  assert.strictEqual(abs[0].status, 'ok', 'un cadre peut importer un « RTT cadres » : ' + abs[0].message);
  assert.strictEqual(abs[1].status, 'error', 'un non-cadre ne peut pas importer un « RTT cadres »');
  assert.ok(/pas concerné/.test(abs[1].message), abs[1].message);
  console.log('OK — imports soldes et absences : règle d\'éligibilité respectée');
})();
