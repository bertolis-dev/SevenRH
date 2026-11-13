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
