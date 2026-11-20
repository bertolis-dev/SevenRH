/**
 * Retour du 20/11/2026 (facilité d'usage, suite) : accès rapides en haut de l'accueil du RH, échéances vides regroupées,
 * Notes de frais sans filtres inutiles, rapprochement bancaire replié.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

const api = loadAppJs();
api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
api.DB.init();
const { DB } = api;
const sb = api.sandbox;

const rh = DB.getEmployees().find(e => e.role === 'rh');
DB._currentEmployeeId = rh.id;

// Accueil du RH : accès rapides avant les indicateurs et les graphiques
const accueil = sb.renderDashboardRH();
const posAcces = accueil.indexOf('Accès rapides');
assert.ok(posAcces > 0, 'accès rapides présents');
assert.ok(posAcces < accueil.indexOf('kpi-grid'), 'ils viennent avant les indicateurs');
assert.ok(!accueil.includes('<h2>Raccourcis</h2>'), 'plus de bloc « Raccourcis » en bas');
const proprio = DB.getEmployees().find(e => e.role === 'proprietaire');
DB._currentEmployeeId = proprio.id;
const accueilProprio = sb.renderDashboardProprietaire();
assert.ok(accueilProprio.indexOf('Accès rapides') > 0 && accueilProprio.indexOf('Accès rapides') < accueilProprio.indexOf('kpi-grid'), 'même chose pour le propriétaire');
DB._currentEmployeeId = rh.id;

// Échéances : les blocs vides sont regroupés, ceux qui ont du contenu restent des cartes
const vide = { birthdays: [], contractEnds: [], probationEnds: [], seniorityAnniversaries: [], entretiensProfessionnels: [], bilansSixAns: [], visitesMedicales: [], contingentHeuresSup: [], absencesLonguesDuree: [], visitesReprise: [] };
const toutVide = sb.renderEcheancesDashboard(vide);
assert.ok(toutVide.includes('Rien à signaler') && toutVide.includes('Fins de contrat'), 'tout vide : une seule ligne qui nomme les rubriques');
assert.ok(!toutVide.includes('Aucune fin de contrat dans les 60 prochains jours'), 'plus de carte vide par rubrique');
const emp = DB.getEmployees()[0];
const avecContrat = sb.renderEcheancesDashboard({ ...vide, contractEnds: [{ ...emp, typeContrat: 'CDD', dateFin: '2027-01-15' }] });
assert.ok(avecContrat.includes('<h2>Fins de contrat à venir</h2>'), 'une rubrique qui a du contenu garde sa carte');
const resume = avecContrat.slice(avecContrat.indexOf('Rien à signaler'));
assert.ok(!/Fins de contrat/.test(resume), 'et n\'est pas citée dans la ligne « Rien à signaler »');

// Notes de frais : sans note, pas de barre de filtres affichée
const frais = sb.renderFrais();
assert.ok(/class="toolbar card" style="display:none"/.test(frais), 'aucune note : barre de filtres masquée');
assert.ok(frais.includes('id="frais-search"') && frais.includes('id="frais-filter-employee"'), 'mais les champs restent dans la page pour les écouteurs');

// Rapprochement bancaire : replié par défaut
const rappro = sb.renderRapprochementBancaireCard();
assert.ok(rappro.includes('<details class="card card-repliable"') && !/<details[^>]*\bopen\b/.test(rappro), 'rapprochement bancaire replié quand rien n\'est à rapprocher');
assert.ok(rappro.includes('releve-bancaire-file'), 'l\'import reste dans la carte');

console.log('OK — facilite-usage-rh-frais-20-11.test.js');
