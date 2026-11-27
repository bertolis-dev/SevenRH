/**
 * 27/11/2026 — audit, section 5 : « Mon espace » strictement personnel. Premier écran traité : les notes de frais (un RH ou la comptabilité voyait celles de tout le monde dans « Mes notes de frais »).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

const api = loadAppJs();
api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
api.DB.init();
const { DB, state } = api;
const sb = api.sandbox;
const now = new Date().toISOString();
const note = (id, employeeId) => ({ id, employeeId, categorie: 'Repas', date: '2026-03-15', libelle: 'Note ' + id, montantTTC: 10, tauxTVA: 10, statut: 'En attente', workflow: [], etapeIndex: -1, historique: [], dateCreation: now, dateModification: now, kilometrage: null, justificatif: null, commentaire: '' });

const rh = DB.getEmployees().find(e => e.role === 'rh');
const compta = DB.getEmployees().find(e => e.role === 'comptabilite');
const salarie = DB.getEmployees().find(e => e.role === 'salarie');
DB.saveExpenses([note('n-rh', rh.id), note('n-compta', compta.id), note('n-sal', salarie.id)]);
state.fraisFilters = { employeeId: '', categorie: '', statut: '', periode: '' };

for (const [qui, ids] of [[rh, ['n-rh']], [compta, ['n-compta']], [salarie, ['n-sal']]]) {
  DB._currentEmployeeId = qui.id;
  state.fraisVue = 'personnel';
  assert.strictEqual(sb.getFilteredExpenses().map(n => n.id).join(','), ids.join(','), qui.role + ' : Mon espace ne montre que ses propres notes');
  assert.ok(sb.renderFrais().includes('Mes notes de frais'));
}

DB._currentEmployeeId = rh.id;
state.fraisVue = 'equipe';
assert.strictEqual(sb.getFilteredExpenses().length, 3, 'RH : la vue Équipe montre toutes les notes');
assert.ok(sb.renderFrais().includes('Notes de frais de l&#39;équipe') || sb.renderFrais().includes("Notes de frais de l'équipe"));
DB._currentEmployeeId = compta.id;
assert.strictEqual(sb.getFilteredExpenses().length, 3, 'comptabilité : la vue Équipe montre toutes les notes à contrôler');
DB._currentEmployeeId = salarie.id;
assert.strictEqual(sb.getFilteredExpenses().map(n => n.id).join(','), 'n-sal', 'un salarié ne bascule jamais en vue équipe');

// Menus : une entrée personnelle et une entrée d'équipe, les liens « à valider » ouvrent l'équipe
const app = require('fs').readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8');
assert.ok(app.includes("{ key: 'frais', label: 'Mes notes de frais'") && app.includes("navParams: { fraisVue: 'personnel' }"));
assert.ok(app.includes("{ key: 'frais', label: \"Notes de frais de l'équipe\"") && app.includes("group: 'equipe', navParams: { fraisVue: 'equipe' }"));
assert.ok(app.includes("const NAVPARAMS_FRAIS_A_VALIDER = { fraisVue: 'equipe'"));
console.log('OK — mon-espace-personnel-27-11.test.js');
