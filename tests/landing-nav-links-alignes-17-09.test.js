/**
 * Seven RH — retour Betty du 17/09/2026 : "le menu en haut a gauche tu vas enlever le paneau
 * déroulant et tu vas juste les alignés" — l'ancien menu à un seul déclencheur ("☰", ouvrant un
 * panneau au clic pour Fonctionnalités/Tarifs/Installer/Nouveautés/À propos) a d'abord été remplacé
 * par ces 5 liens directement alignés dans la topbar. Puis, retour du même jour : "sur téléphone
 * laisse le paneau déroulant" — les liens restent alignés à partir d'une largeur d'écran normale,
 * mais sous 480px (voir style.css) redeviennent un panneau caché derrière le déclencheur ☰, comme
 * avant. Le déclencheur et les liens sont donc TOUJOURS dans le DOM (même markup partout) ; seule la
 * largeur d'écran (CSS) décide s'ils s'affichent alignés ou en panneau — voir cette limite du bac à
 * sable (load-app-js.js) qui ne simule pas les media queries : ce test porte sur le HTML/JS produits,
 * pas sur le rendu visuel réel à une largeur donnée (vérifié manuellement dans le navigateur).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAppJs } = require('./load-app-js');

async function runDeclencheurEtLiensToujoursPresents() {
  const { sandbox, renderLandingScreen } = loadAppJs();
  sandbox.window.location = { hash: '' };

  renderLandingScreen();
  const html = sandbox.document.getElementById('landing-root').innerHTML;

  // Le déclencheur ☰ est de retour dans le markup (masqué en CSS au-dessus de 480px, visible en
  // dessous) — jamais supprimé du DOM, seule sa visibilité dépend de la largeur d'écran.
  assert.ok(html.includes('landing-nav-menu-trigger'), 'le déclencheur ☰ doit exister dans le markup, pour être affichable sur téléphone');
  assert.ok(html.includes('landing-nav-links'), 'les liens doivent être regroupés dans landing-nav-links (alignés sur grand écran, panneau du déclencheur sur téléphone)');

  ['Fonctionnalités', 'Tarifs', 'Installer', 'Nouveautés', 'À propos'].forEach(label => {
    assert.ok(html.includes(`>${label}</button>`), `le lien "${label}" doit être présent`);
  });

  console.log('OK — landing-nav-links-alignes-17-09.test.js (déclencheur ☰ et liens tous les deux dans le markup)');
}

async function runMemeChoseSurUnePageDeFonctionnalite() {
  const { sandbox, renderLandingScreen } = loadAppJs();
  sandbox.window.location = { hash: '#fonctionnalite-1' };
  sandbox.window.scrollTo = () => {};

  renderLandingScreen();
  const html = sandbox.document.getElementById('landing-root').innerHTML;

  assert.ok(html.includes('landing-nav-menu-trigger'), 'même chose sur une page de fonctionnalité : le déclencheur doit aussi être présent');
  assert.ok(html.includes('landing-nav-links'), 'les liens alignés/panneau doivent aussi être présents sur une page de fonctionnalité');

  console.log('OK — landing-nav-links-alignes-17-09.test.js (page de fonctionnalité : même déclencheur + liens)');
}

async function runLogiqueDouvertureFermetureRestauree() {
  // document.querySelector/click ne sont pas simulables dans ce bac à sable minimal
  // (querySelector/querySelectorAll renvoient toujours null/[], voir load-app-js.js) — vérifié
  // manuellement dans le navigateur ; ici, vérification statique que le code du déclencheur/panneau
  // (supprimé le 17/09/2026 matin, restauré l'après-midi pour le téléphone) est bien de retour.
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.ok(appSource.includes('function closeAllLandingNavMenus()'), 'la fonction de fermeture du panneau doit être de retour');
  assert.ok(appSource.includes("panel.classList.toggle('open'"), 'le clic sur le déclencheur doit basculer la classe "open" du panneau');
  assert.ok(appSource.includes("if (!evt.target.closest('.landing-nav-menu')) closeAllLandingNavMenus();"), 'un clic en dehors du menu doit refermer le panneau');
  assert.ok(appSource.includes("if (evt.key === 'Escape') closeAllLandingNavMenus();"), 'la touche Échap doit refermer le panneau');

  console.log('OK — landing-nav-links-alignes-17-09.test.js (logique d\'ouverture/fermeture du panneau restaurée)');
}

runDeclencheurEtLiensToujoursPresents()
  .then(runMemeChoseSurUnePageDeFonctionnalite)
  .then(runLogiqueDouvertureFermetureRestauree)
  .catch((err) => {
    console.error('ÉCHEC — landing-nav-links-alignes-17-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
