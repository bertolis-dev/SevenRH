/**
 * Retour du 19/11/2026 : dans le Tableau des compteurs, des RTT s'affichaient pour des salariés dont le type est décoché dans « Types d'absences autorisés » de leur fiche
 * (la fiche individuelle les masquait déjà). Le compteur reste visible s'il y a un historique réel (jours pris, en attente, ajustement).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

const api = loadAppJs();
api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
api.DB.init();
const { DB } = api;
const nonConcerne = api.sandbox.compteurNonConcerne;

const salarie = DB.getEmployees().find(e => e.role === 'salarie');
const rtt = DB.getLeaveTypes().find(t => /rtt/i.test(t.nom));
const vide = { acquis: 7.5, disponible: 7.5, pris: 0, enAttente: 0, ajustement: 0 };

assert.strictEqual(nonConcerne({ ...salarie, typesAbsenceDesactives: [] }, rtt, vide), false, 'type autorisé : affiché');
assert.strictEqual(nonConcerne({ ...salarie, typesAbsenceDesactives: [rtt.id] }, rtt, vide), true, 'type décoché, rien de pris : masqué malgré l\'acquisition automatique');
assert.strictEqual(nonConcerne({ ...salarie, typesAbsenceDesactives: [rtt.id] }, rtt, { ...vide, pris: 3 }), false, 'type décoché mais des jours pris : historique conservé');
assert.strictEqual(nonConcerne({ ...salarie, typesAbsenceDesactives: [rtt.id] }, rtt, { ...vide, enAttente: 1 }), false, 'type décoché mais une demande en attente : conservé');
assert.strictEqual(nonConcerne({ ...salarie, typesAbsenceDesactives: [rtt.id] }, rtt, { ...vide, ajustement: 2 }), false, 'type décoché mais ajustement manuel : conservé');
assert.strictEqual(nonConcerne({ ...salarie, typesAbsenceDesactives: ['autre-type'] }, rtt, vide), false, 'un autre type décoché ne masque pas celui-ci');

console.log('OK — compteurs-types-decoches-19-11.test.js');
