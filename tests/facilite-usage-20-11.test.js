/**
 * Retour du 20/11/2026 (facilité d'usage) : « Demander un congé » en haut de l'accueil du salarié, soldes rares repliés, page Congés sans filtres inutiles
 * pour un salarié, actions de la page Salariés rangées sous « Plus d'actions ».
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

const api = loadAppJs();
api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
api.DB.init();
const { DB } = api;
const sb = api.sandbox;

const salarie = DB.getEmployees().find(e => e.role === 'salarie');
DB._currentEmployeeId = salarie.id;

// Accueil du salarié : l'action principale est avant les indicateurs et les soldes
const accueil = sb.renderDashboardSalarie(salarie);
const posBouton = accueil.indexOf('id="btn-accueil-demander-conge"');
assert.ok(posBouton > 0, 'bouton « Demander un congé » présent sur l\'accueil du salarié');
assert.ok(posBouton < accueil.indexOf('kpi-grid') && posBouton < accueil.indexOf('Mes soldes de congés'), 'il vient avant les indicateurs et les soldes');

// Soldes compacts : congés payés visibles d'emblée, événements familiaux dans un bloc repliable
const complet = sb.renderEmployeeBalances(salarie);
const compact = sb.renderEmployeeBalances(salarie, false, true);
assert.ok(!complet.includes('balance-autres'), 'la fiche (version complète) montre tous les soldes, sans bloc replié');
assert.ok(compact.includes('<details class="balance-autres">') && /Voir les autres soldes \(\d+\)/.test(compact), 'les soldes rares sont repliés sur l\'accueil');
const avantAutres = compact.slice(0, compact.indexOf('<details'));
assert.ok(avantAutres.includes('Congés payés') && !avantAutres.includes('Mariage'), 'Congés payés reste visible, les événements familiaux sont dans le bloc replié');
assert.ok(compact.includes('Mariage') && compact.includes('Décès'), 'rien n\'est perdu : ils restent accessibles');
assert.strictEqual((complet.match(/class="balance-card"/g) || []).length, (compact.match(/class="balance-card"/g) || []).length, 'même nombre de cartes au total');

// Un salarié ayant déjà pris un congé d'un type « rare » le garde visible
const mariage = DB.getLeaveTypes().find(t => /^Mariage \/ PACS/.test(t.nom));
const societe = DB.getCurrentCompany();
societe.leaveRequests = [{ id: 'lr-mariage', employeeId: salarie.id, typeId: mariage.id, dateDebut: '2026-03-02', dateFin: '2026-03-03', nbJours: 2, statut: 'Validé', etapeIndex: 1, workflow: ['manager'], historique: [], demiJournee: null }];
DB.saveCurrentCompany(societe);
const avecPris = sb.renderEmployeeBalances(salarie, false, true);
assert.ok(avecPris.slice(0, avecPris.indexOf('<details')).includes('Mariage / PACS'), 'un type dont des jours ont été pris reste affiché d\'emblée');
societe.leaveRequests = [];
DB.saveCurrentCompany(societe);

// Page Congés d'un salarié : pas de barre de filtres vide, ni recherche de salarié
const state = api.state;
state.congesFilters = { employeeId: '', typeId: '', statut: '' };
state.congesPage = 1;
const conges = sb.renderCongesDemandes('conge');
assert.ok(!conges.includes('data-toggle-filters="conges-filters"'), 'aucune demande : pas de bouton Filtres');
assert.ok(/id="conges-filters"[^>]*display:none/.test(conges), 'la barre de filtres reste dans la page mais masquée (les écouteurs retrouvent leurs champs)');
assert.ok(!conges.includes('Les demandes des salariés apparaîtront ici'), 'texte adapté à un salarié seul dans son périmètre');
assert.ok(/Nouvelle demande/.test(conges), 'le bouton de création reste présent');

// Page Salariés : un seul bouton plein, le reste sous « Plus d'actions »
const rh = DB.getEmployees().find(e => e.role === 'rh');
DB._currentEmployeeId = rh.id;
const liste = sb.renderEmployeesList();
const debutMenu = liste.indexOf('<details class="menu-actions">');
assert.ok(debutMenu > 0, 'menu « Plus d\'actions » présent');
const menu = liste.slice(debutMenu, liste.indexOf('</details>', debutMenu));
['btn-import-employees', 'btn-import-soldes', 'btn-export-employees', 'btn-registre-personnel', 'btn-index-egalite'].forEach(id => assert.ok(menu.includes('id="' + id + '"'), id + ' rangé dans le menu'));
assert.ok(liste.slice(0, debutMenu).includes('id="btn-new-employee"'), '« + Nouveau salarié » reste visible hors du menu');
assert.strictEqual((liste.match(/class="btn btn-primary"/g) || []).length, 1, 'un seul bouton plein dans l\'en-tête');

console.log('OK — facilite-usage-20-11.test.js');
