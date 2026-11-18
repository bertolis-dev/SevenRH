/**
 * Retour du 18/11/2026 : déplacer les demandes d'un ancien type (ex. RTT désactivé) vers un nouveau, pour décompter les jours pris sur le bon compteur.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

const api = loadAppJs();
api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
api.DB.init();
const { DB } = api;
const sb = api.sandbox;

const cats = DB.getSettings().categoriesSalarie;
const cadre = cats.find(c => /^cadre$/i.test(c.nom));
const non = cats.find(c => /non cadre/i.test(c.nom));
const proprio = DB.getEmployees().find(e => e.role === 'proprietaire');
DB._currentEmployeeId = proprio.id;
const [a, b] = DB.getEmployees().filter(e => !e.archive && e.id !== proprio.id);
api.employeeRepository.update(a.id, { categorieSalarieId: cadre.id });
api.employeeRepository.update(b.id, { categorieSalarieId: non.id });

const ancien = DB.addLeaveType({ nom: 'RTT 2026 Ancien', actif: false, acquisition: 'Annuelle', nombreAnnuel: 10 });
const res = sb.creerDeuxTypesRtt({ baseId: '', categorieCadreId: cadre.id, categorieNonCadreId: non.id, joursCadre: 12, joursNonCadre: 8 });
assert.ok(res.success, res.error);
const rttNon = res.nonCadres;

const demande = (id, employeeId, debut, fin, extra) => Object.assign({ id, employeeId, typeId: ancien.id, dateDebut: debut, dateFin: fin, statut: 'Validé', nbJours: 1 }, extra || {});
DB.saveLeaveRequests(DB.getLeaveRequests().concat([
  demande('d-b1', b.id, '2026-03-02', '2026-03-02'),
  demande('d-b2', b.id, '2026-04-06', '2026-04-07', { nbJours: 2 }),
  demande('d-a1', a.id, '2026-03-09', '2026-03-09'),
  demande('d-b3', b.id, '2026-05-04', '2026-05-04', { id: 'd-b3' }),
  { id: 'd-dup', employeeId: b.id, typeId: rttNon.id, dateDebut: '2026-05-04', dateFin: '2026-05-04', statut: 'Validé', nbJours: 1 }
]));

const plan = sb.planifierDeplacementDemandes(ancien.id, rttNon.id);
assert.strictEqual(plan.erreur, '');
assert.strictEqual(plan.aDeplacer.length, 2, 'deux demandes du non-cadre à déplacer');
assert.strictEqual(plan.nonConcernes.length, 1, 'la demande du cadre n\'est pas concernée par « RTT non-cadres »');
assert.strictEqual(plan.doublons.length, 1, 'une demande identique existe déjà sur le type d\'arrivée');

// Garde-fous
assert.ok(sb.planifierDeplacementDemandes(ancien.id, ancien.id).erreur, 'même type refusé');
assert.ok(sb.planifierDeplacementDemandes('', rttNon.id).erreur, 'type de départ manquant');
const autre = DB.getLeaveTypes().find(t => t.categorie === 'autre');
if (autre) assert.ok(sb.planifierDeplacementDemandes(ancien.id, autre.id).erreur, 'catégories différentes refusées');

// Exécution
const avant = sb.getLeaveBalance(DB.getEmployeeById(b.id), DB.getLeaveTypeById(rttNon.id), DB.getLeaveRequests(), DB.getLeaveTypes());
const exec = api.leaveRepository.deplacerVersType(plan.aDeplacer.map(r => r.id), rttNon.id);
assert.ok(exec.success && exec.deplacees === 2, 'deux demandes déplacées');
const apres = sb.getLeaveBalance(DB.getEmployeeById(b.id), DB.getLeaveTypeById(rttNon.id), DB.getLeaveRequests(), DB.getLeaveTypes());
assert.ok(apres.pris > avant.pris, 'les jours pris sont décomptés sur le nouveau compteur (' + avant.pris + ' puis ' + apres.pris + ')');
const deplacee = DB.getLeaveRequests().find(r => r.id === 'd-b1');
assert.strictEqual(deplacee.typeId, rttNon.id);
assert.ok((deplacee.regularisations || []).some(r => /Déplacée vers/.test(r.motif)), 'l\'historique garde la trace du changement');
assert.strictEqual(DB.getLeaveRequests().find(r => r.id === 'd-a1').typeId, ancien.id, 'la demande du cadre reste sur l\'ancien type');

console.log('OK — deplacer-demandes-vers-type-18-11.test.js');
