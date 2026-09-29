/**
 * Seven RH — retour Betty du 29/09/2026 ("je veux que le design des paramètres ressemble à ça pour
 * pas avoir tout au même endroit et le bouton mon compte tu le mets aussi dedans"), capture d'écran
 * des Paramètres Windows 11 fournie en référence : la rangée plate de 17 onglets (repliée en menu
 * déroulant dès qu'elle débordait, voir l'historique de checkParametresTabsOverflow, retiré) devient
 * une barre latérale groupée par catégorie (PARAMETRES_GROUPES, app.js) — "Mon compte" (seul onglet
 * ouvert à tout rôle) rejoint cette même barre, sous son propre repère "Mon espace".
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function setup(role) {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  const employee = api.DB.getEmployees().find(e => e.role === role);
  api.DB._currentEmployeeId = employee.id;
  return api;
}

function viewRootHtml(api) {
  return api.sandbox.document.getElementById('view-root').innerHTML;
}

function runAdminVoitLesTroisCategoriesGroupeesPlusMonEspace() {
  const api = setup('rh');
  api.navigateTo('parametres', { parametresTab: 'entreprise' });
  const html = viewRootHtml(api);

  assert.ok(html.includes('class="parametres-sidebar-desktop"'), 'la barre latérale groupée doit exister');
  ['Entreprise', 'Modules', 'Suivi & conformité', 'Mon espace'].forEach(label => {
    assert.ok(html.includes(`<div class="nav-section-label">${label}</div>`), `le repère de catégorie "${label}" doit être affiché pour un rôle qui gère les paramètres`);
  });
  // Un onglet de chaque catégorie, pris au hasard, doit se retrouver sous son groupe (data-parametres-tab
  // inchangé : c'est ce que bindParametresEvents câble déjà de façon générique).
  ['entreprise', 'remuneration', 'audit', 'mon-compte'].forEach(key => {
    assert.ok(html.includes(`data-parametres-tab="${key}"`), `l'onglet "${key}" doit rester atteignable dans la nouvelle barre latérale`);
  });

  console.log('OK — parametres-sidebar-categories-29-09.test.js (rôle qui gère les paramètres : 3 catégories + Mon espace)');
}

function runSalarieSansGererParametresNeVoitQueMonCompte() {
  const api = setup('salarie');
  api.navigateTo('parametres', { parametresTab: 'mon-compte' });
  const html = viewRootHtml(api);

  assert.ok(html.includes('class="parametres-sidebar-desktop"'), 'la barre latérale doit exister même pour un simple salarié (elle ne contient alors que "Mon compte")');
  ['Entreprise', 'Modules', 'Suivi & conformité'].forEach(label => {
    assert.ok(!html.includes(`<div class="nav-section-label">${label}</div>`), `la catégorie "${label}" ne doit jamais apparaître sans le droit de gérer les paramètres (aucun de ses onglets n'est visible)`);
  });
  assert.ok(html.includes('<div class="nav-section-label">Mon espace</div>'), '"Mon espace" doit rester affiché : "Mon compte" est ouvert à tout rôle');
  assert.ok(html.includes('data-parametres-tab="mon-compte"'), '"Mon compte" doit rester atteignable');

  console.log('OK — parametres-sidebar-categories-29-09.test.js (simple salarié : seul "Mon espace / Mon compte" apparaît, aucune catégorie vide)');
}

function runLeMenuDeroulantMobileListeToujoursTousLesOngletsVisibles() {
  const api = setup('rh');
  api.navigateTo('parametres', { parametresTab: 'entreprise' });
  const html = viewRootHtml(api);
  const visibleTabs = api.PARAMETRES_TABS.filter(t => t.isVisible());

  const selectMatch = html.match(/<select class="input parametres-tab-select"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(selectMatch, 'le repli mobile (menu déroulant) doit être conservé, voir @media 860px');
  visibleTabs.forEach(t => {
    assert.ok(selectMatch[1].includes(`value="${t.key}"`), `l'onglet "${t.key}" doit rester listé dans le menu déroulant mobile, groupé ou non dans la barre latérale desktop`);
  });

  console.log(`OK — parametres-sidebar-categories-29-09.test.js (menu déroulant mobile : ${visibleTabs.length} onglets, comportement non régressé)`);
}

function runAucunResteDeLancienMecanismeDeDebordementJsMesure() {
  const api = setup('rh');
  assert.strictEqual(api.sandbox.checkParametresTabsOverflow, undefined, 'checkParametresTabsOverflow (mesure JS scrollWidth/clientWidth) doit avoir disparu : une sidebar verticale n\'a plus le même risque de débordement horizontal qu\'une rangée de 17 boutons, le seuil CSS 860px suffit désormais (voir style.css)');

  console.log('OK — parametres-sidebar-categories-29-09.test.js (ancien mécanisme de mesure JS du débordement retiré, repli purement CSS)');
}

function run() {
  runAdminVoitLesTroisCategoriesGroupeesPlusMonEspace();
  runSalarieSansGererParametresNeVoitQueMonCompte();
  runLeMenuDeroulantMobileListeToujoursTousLesOngletsVisibles();
  runAucunResteDeLancienMecanismeDeDebordementJsMesure();
}

try {
  run();
} catch (err) {
  console.error('ÉCHEC — parametres-sidebar-categories-29-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
