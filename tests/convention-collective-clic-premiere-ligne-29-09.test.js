/**
 * Seven RH — retour Betty du 29/09/2026 ("dans convention collective en cliquant sur la première
 * ligne ça ne fait rien") : bindConventionCollectiveAutocomplete() posait un nouveau
 * document.addEventListener('click', ...) à CHAQUE ouverture de la modale "Nouveau/Modifier
 * salarié" (jamais nettoyé à la fermeture) — les copies s'accumulent sur `document` pour toute la
 * session. Remplacé par un seul jeu d'écouteurs, posé une fois pour toutes (drapeau
 * document.__conventionAutocompleteBound), sur `mousedown` plutôt que `click` (évite toute course
 * avec un focus/blur déclenché entre l'appui et le relâchement du clic).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAppJs } = require('./load-app-js');

function runNePoseQuUneSeuleFoisLecouteurMemeApresPlusieursOuvertures() {
  const { sandbox, bindConventionCollectiveAutocomplete } = loadAppJs();
  assert.strictEqual(sandbox.document.__conventionAutocompleteBound, undefined, 'préalable : rien posé avant le premier appel');

  bindConventionCollectiveAutocomplete();
  assert.strictEqual(sandbox.document.__conventionAutocompleteBound, true, 'le drapeau doit être posé après le premier appel');

  // Simule plusieurs ouvertures de la modale (ex. Nouveau salarié fermé et rouvert) : ne doit
  // jamais tenter de reposer un second jeu d'écouteurs.
  bindConventionCollectiveAutocomplete();
  bindConventionCollectiveAutocomplete();
  assert.strictEqual(sandbox.document.__conventionAutocompleteBound, true, 'un second/troisième appel ne doit jamais réinitialiser ni dupliquer l\'écouteur');

  console.log('OK — convention-collective-clic-premiere-ligne-29-09.test.js (un seul jeu d\'écouteurs, quel que soit le nombre d\'ouvertures de la modale)');
}

function runUtiliseMousedownJamaisClickPourEviterLaCourseAvecUnFocus() {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const fnStart = appSource.indexOf('function bindConventionCollectiveAutocomplete(');
  const nextFnStart = appSource.indexOf('\nfunction ', fnStart + 1);
  const fnBody = appSource.slice(fnStart, nextFnStart);

  assert.ok(/addEventListener\('mousedown'/.test(fnBody), 'la sélection d\'une suggestion doit se faire sur mousedown, jamais sur click (course possible avec un focus/blur entre les deux)');
  assert.ok(/e\.preventDefault\(\)/.test(fnBody), 'preventDefault() doit empêcher le mousedown de retirer le focus du champ avant que sa valeur ne soit posée');

  console.log('OK — convention-collective-clic-premiere-ligne-29-09.test.js (sélection sur mousedown avec preventDefault, jamais click)');
}

function run() {
  runNePoseQuUneSeuleFoisLecouteurMemeApresPlusieursOuvertures();
  runUtiliseMousedownJamaisClickPourEviterLaCourseAvecUnFocus();
}

try {
  run();
} catch (err) {
  console.error('ÉCHEC — convention-collective-clic-premiere-ligne-29-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
