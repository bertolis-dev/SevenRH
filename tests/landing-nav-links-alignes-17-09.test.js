/**
 * Seven RH — retour Betty du 17/09/2026 : "le menu en haut a gauche tu vas enlever le paneau
 * déroulant et tu vas juste les alignés" — l'ancien menu à un seul déclencheur ("☰ Menu", ouvrant un
 * panneau au clic pour Fonctionnalités/Tarifs/Installer/Nouveautés/À propos) est remplacé par ces 5
 * liens directement alignés dans la topbar, toujours visibles, sans clic pour les révéler.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAppJs } = require('./load-app-js');

async function runPlusDePanneauDeroulant() {
  const { sandbox, renderLandingScreen } = loadAppJs();
  sandbox.window.location = { hash: '' };

  renderLandingScreen();
  const html = sandbox.document.getElementById('landing-root').innerHTML;

  assert.ok(!html.includes('landing-nav-menu-trigger'), 'le bouton déclencheur "☰ Menu" ne doit plus exister');
  assert.ok(!html.includes('landing-nav-menu-panel'), 'le panneau déroulant ne doit plus exister');
  assert.ok(html.includes('landing-nav-links'), 'les liens doivent être regroupés dans le conteneur aligné landing-nav-links');

  ['Fonctionnalités', 'Tarifs', 'Installer', 'Nouveautés', 'À propos'].forEach(label => {
    assert.ok(html.includes(`>${label}</button>`), `le lien "${label}" doit rester présent, juste sans panneau à ouvrir`);
  });

  console.log('OK — landing-nav-links-alignes-17-09.test.js (page d\'accueil : plus de panneau déroulant, liens alignés)');
}

async function runMemeChoseSurUnePageDeFonctionnalite() {
  const { sandbox, renderLandingScreen } = loadAppJs();
  sandbox.window.location = { hash: '#fonctionnalite-1' };
  sandbox.window.scrollTo = () => {};

  renderLandingScreen();
  const html = sandbox.document.getElementById('landing-root').innerHTML;

  assert.ok(!html.includes('landing-nav-menu-trigger'), 'même chose sur une page de fonctionnalité : plus de déclencheur de panneau');
  assert.ok(html.includes('landing-nav-links'), 'les liens alignés doivent aussi être présents sur une page de fonctionnalité');

  console.log('OK — landing-nav-links-alignes-17-09.test.js (page de fonctionnalité : même barre de liens alignés)');
}

async function runPlusDeCodeMortDuPanneau() {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.ok(!appSource.includes('closeAllLandingNavMenus'), 'la logique d\'ouverture/fermeture du panneau (devenue inutile) doit être supprimée, pas seulement inaccessible');
  assert.ok(!appSource.includes('landingNavMenuOutsideCloseBound'), 'le drapeau de liaison du clic extérieur (propre au panneau) doit être supprimé');

  console.log('OK — landing-nav-links-alignes-17-09.test.js (logique du panneau déroulant bien supprimée, pas juste masquée)');
}

runPlusDePanneauDeroulant()
  .then(runMemeChoseSurUnePageDeFonctionnalite)
  .then(runPlusDeCodeMortDuPanneau)
  .catch((err) => {
    console.error('ÉCHEC — landing-nav-links-alignes-17-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
