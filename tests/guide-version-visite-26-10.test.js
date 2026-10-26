/**
 * Seven RH — retour du 26/10/2026 : numéro de version visible dans l'application, guide complet accessible depuis le rond du compte,
 * visite guidée au premier lancement et astuces par écran. Vérifie que la version reste alignée entre le code, le chargement
 * (index.html) et les Nouveautés, que chaque écran du menu a une explication dans le guide, et que la visite ne se déclenche jamais à tort.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAppJs } = require('./load-app-js');

function run() {
  const api = loadAppJs();
  const { DB, sandbox, APP_VERSION, CHANGELOG_ENTRIES, guideSections, tourStepsForUser, SCREEN_TIPS, GUIDE_RESUMES, HELP_CONTENT, NAV_ITEMS, authRepository, renderUserMenuPanel, startTour, insertScreenTip, navItemsForRole } = api;
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();

  // --- Numéro de version : même valeur dans le code, index.html et les Nouveautés ---
  assert.ok(/^\d{4}\.\d{2}\.\d{2}\.\d+$/.test(APP_VERSION), 'format AAAA.MM.JJ.N (N = numéro de la mise en ligne du jour, voir npm run bump)');
  assert.strictEqual(CHANGELOG_ENTRIES[0].version, APP_VERSION, 'la première entrée des Nouveautés porte la version courante');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const versions = [...html.matchAll(/\?v=([0-9A-Za-z.]+)/g)].map(m => m[1]);
  assert.ok(versions.length >= 5, 'les fichiers sont chargés avec un ?v=');
  assert.ok(versions.every(v => v === APP_VERSION), `tous les ?v= d'index.html valent ${APP_VERSION} (lancer npm run bump à chaque mise en ligne)`);

  // --- Le numéro apparaît dans le menu du compte, avec le bouton du guide ---
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;
  renderUserMenuPanel();
  const menu = sandbox.document.getElementById('user-menu-panel').innerHTML;
  assert.ok(menu.includes(`version ${APP_VERSION}`), 'version dans le menu du compte');
  assert.ok(menu.includes('id="btn-user-menu-guide"'), 'bouton Guide dans le menu du compte');

  // --- Chaque écran du menu a une explication dans le guide, pour chaque rôle ---
  ['salarie', 'manager', 'rh', 'comptabilite', 'proprietaire'].forEach(role => {
    const emp = DB.getEmployees().find(e => e.role === role);
    if (!emp) return;
    DB._currentEmployeeId = emp.id;
    const user = authRepository.getCurrentUser();
    const sections = guideSections(user);
    const ids = sections.map(s => s.id);
    assert.strictEqual(new Set(ids).size, ids.length, `${role} : identifiants de chapitres uniques`);
    ['bienvenue', 'reperes', 'role', 'astuces', 'aide'].forEach(id => assert.ok(ids.includes(id), `${role} : chapitre ${id}`));
    navItemsForRole(user).filter(i => i.key !== 'boussole').forEach(item => {
      assert.ok(ids.includes('ecran-' + item.key), `${role} : le guide explique l'écran « ${item.label} »`);
    });
    sections.forEach(s => assert.ok(s.html.length > 60 && s.titre, `${role} : chapitre « ${s.titre} » non vide`));
  });

  // --- Tous les écrans du menu ont une aide (bouton « ? ») et un résumé ---
  const cles = [...new Set(NAV_ITEMS.map(i => i.key))].filter(k => k !== 'boussole');
  cles.forEach(k => {
    assert.ok(HELP_CONTENT[k], `aide « ? » manquante pour ${k}`);
    assert.ok(GUIDE_RESUMES[k], `résumé du guide manquant pour ${k}`);
  });
  Object.keys(SCREEN_TIPS).forEach(k => assert.ok(NAV_ITEMS.some(i => i.key === k), `astuce pour un écran inconnu : ${k}`));

  // --- Visite guidée : étapes cohérentes, jamais lancée dans un environnement sans écran ---
  DB._currentEmployeeId = DB.getEmployees().find(e => e.role === 'salarie').id;
  const user = authRepository.getCurrentUser();
  const steps = tourStepsForUser(user);
  assert.ok(steps.length >= 5 && steps.every(s => s.titre && s.texte), 'étapes de la visite');
  assert.ok(steps[0].titre.includes(user.prenom), 'la visite accueille la personne par son prénom');
  assert.ok(steps.some(s => (s.cibles || []).includes('#btn-user-menu')), 'la visite montre le rond du compte');
  assert.strictEqual(startTour(), false, 'pas de visite sans vrai écran');
  assert.doesNotThrow(() => insertScreenTip(), 'astuce sans vrai écran : sans effet');

  console.log('OK — guide-version-visite-26-10.test.js (version alignée, guide complet pour chaque rôle, aides, visite guidée)');
}

try { run(); } catch (err) { console.error('ÉCHEC — guide-version-visite-26-10.test.js'); console.error(err.stack || err.message); process.exitCode = 1; }
