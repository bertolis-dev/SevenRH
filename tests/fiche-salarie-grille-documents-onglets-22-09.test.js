/**
 * Seven RH — retour Betty du 22/09/2026 (Partie 2), points 2.1/2.2/2.3 :
 *   2.1 la grille de cartes de la fiche salarié (onglet Fiche, onglet Congés et absences) utilisait
 *       des colonnes CSS (column-count) : avec moins de cartes que de colonnes disponibles, un ou
 *       plusieurs colonnes restaient VIDES sur un écran large plutôt que redistribuer la largeur —
 *       revenue à une vraie grille CSS (.detail-grid-cards, voir style.css).
 *   2.2 "Attestation employeur"/"Certificat de travail" vivaient en tête de fiche (detail-header-
 *       actions), mélangés aux actions de la fiche elle-même — déplacés dans l'onglet "Documents"
 *       (renderDocumentsOfficielsCard), avec le reste des documents de ce salarié.
 *   2.3 la règle "un onglet disparaît de lui-même s'il n'a rien à montrer" était neutralisée sur 4
 *       des 7 onglets (Congés et absences, Accès et droits, Documents, Parcours) : chacun
 *       enveloppait systématiquement ses cartes dans un <div class="detail-grid-cards">, qui restait
 *       "non vide" même quand chaque carte à l'intérieur retournait '' — corrigé par
 *       renderDetailGridCards(), qui ne rend le conteneur que si au moins une carte a un contenu réel.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAppJs } = require('./load-app-js');

function setup() {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  const rh = api.DB.getEmployees().find(e => e.role === 'rh');
  api.DB._currentEmployeeId = rh.id;
  return api;
}

function runGrilleCssUneVraieGrilleJamaisDesColonnes() {
  const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
  const ruleStart = css.indexOf('.detail-grid-cards {');
  const ruleBody = css.slice(ruleStart, css.indexOf('}', ruleStart));
  assert.ok(ruleBody.includes('display: grid'), '.detail-grid-cards doit être une vraie grille CSS (display: grid), pas des colonnes');
  assert.ok(!ruleBody.includes('column-count'), '.detail-grid-cards ne doit plus utiliser column-count (colonnes vides sur écran large avec peu de cartes)');
  assert.ok(ruleBody.includes('grid-template-columns'), '.detail-grid-cards doit répartir la largeur disponible entre les cartes présentes');

  console.log('OK — fiche-salarie-grille-documents-onglets-22-09.test.js (2.1 : grille CSS réelle, plus de colonnes pouvant rester vides)');
}

function runDocumentsOfficielsDeplacesDansLongletDocuments() {
  const { state, renderEmployeeDetail, employeeRepository } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  employeeRepository.update(salarie.id, { dateDepart: '' });

  state.employeeDetailTab = 'fiche';
  const htmlFiche = renderEmployeeDetail(salarie.id);
  assert.ok(!htmlFiche.includes('id="btn-print-attestation"'), '"Attestation employeur" ne doit plus apparaître en tête de fiche (onglet Fiche)');
  assert.ok(!htmlFiche.includes('id="btn-print-certificat-travail"'), '"Certificat de travail" ne doit plus apparaître en tête de fiche (onglet Fiche)');

  state.employeeDetailTab = 'documents';
  const htmlDocuments = renderEmployeeDetail(salarie.id);
  assert.ok(htmlDocuments.includes('id="btn-print-attestation"'), '"Attestation employeur" doit être rendue dans l\'onglet Documents');
  assert.ok(htmlDocuments.includes('Documents officiels'), 'les documents officiels doivent avoir leur propre carte, distincte des documents générés depuis un modèle');

  console.log('OK — fiche-salarie-grille-documents-onglets-22-09.test.js (2.2 : Attestation employeur/Certificat de travail déplacés dans l\'onglet Documents)');
}

function runOngletDisparaitVraimentQuandAucuneCarteNaRienAMontrer() {
  const { renderDetailGridCards } = setup();

  assert.strictEqual(renderDetailGridCards('', '', ''), '', 'sans aucune carte réelle, le conteneur ne doit plus être rendu du tout (chaîne vide)');
  assert.strictEqual(renderDetailGridCards(), '', 'appelé sans argument, doit aussi rester vide, jamais planter');
  const withOneCard = renderDetailGridCards('', '<div class="card">Contenu</div>', '');
  assert.ok(withOneCard.includes('detail-grid-cards'), 'dès qu\'une seule carte a du contenu, le conteneur doit apparaître');
  assert.ok(withOneCard.includes('<div class="card">Contenu</div>'), 'le contenu réel doit être conservé tel quel');

  console.log('OK — fiche-salarie-grille-documents-onglets-22-09.test.js (2.3 : renderDetailGridCards ne rend le conteneur que si une carte a un contenu réel)');
}

function runOngletDocumentsDisparaitSansModuleRhNiDroitDedition() {
  const { DB, state, navigateTo, sandbox, employeeRepository } = setup();
  const company = DB.getCurrentCompany();
  company.abonnement.offre = 'a_la_carte';
  company.abonnement.modules = []; // ni RH, ni aucun autre module
  DB.saveCurrentCompany(company);

  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  // Le salarié consulte sa PROPRE fiche : jamais canEdit sur soi-même, et le module RH n'est pas
  // souscrit — les 3 cartes de l'onglet Documents (officiels, coffre-fort, modèles) doivent
  // toutes être vides, et l'onglet lui-même doit disparaître de la barre d'onglets.
  DB._currentEmployeeId = salarie.id;
  navigateTo('employee-detail', { currentEmployeeId: salarie.id });
  const html = sandbox.document.getElementById('view-root').innerHTML;

  assert.ok(!/data-employee-detail-tab="documents"/.test(html), 'sans module RH ni droit d\'édition, l\'onglet "Documents" ne doit même plus apparaître dans la barre d\'onglets');

  console.log('OK — fiche-salarie-grille-documents-onglets-22-09.test.js (2.3 : l\'onglet Documents disparaît réellement sans module RH ni droit d\'édition)');
}

try {
  runGrilleCssUneVraieGrilleJamaisDesColonnes();
  runDocumentsOfficielsDeplacesDansLongletDocuments();
  runOngletDisparaitVraimentQuandAucuneCarteNaRienAMontrer();
  runOngletDocumentsDisparaitSansModuleRhNiDroitDedition();
} catch (err) {
  console.error('ÉCHEC — fiche-salarie-grille-documents-onglets-22-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
