/**
 * Seven RH — retour Betty du 22/09/2026 ("4 points rouges" visibles sur sa propre fiche en édition,
 * signalé comme non reproduit à la première relecture du JS). Cause réelle, trouvée en revenant sur
 * le CSS plutôt que sur updateEmployeeFormTabErrors (app.js) : `.tab-error-dot { display:
 * inline-block; ... }` posait `display` avec la MÊME spécificité que la règle UA `[hidden] {
 * display: none }` (un sélecteur simple chacune) — à spécificité égale, une feuille d'auteur
 * l'emporte toujours sur la feuille du navigateur, donc l'attribut `hidden` (posé par défaut sur ce
 * <span>, voir renderEmployeeFormTabs) n'avait AUCUN effet visuel : le point restait affiché sur
 * TOUS les onglets dès l'ouverture de la modale, jamais piloté par la validation réelle — d'où
 * exactement 4 points rouges (le nombre d'onglets du formulaire en édition), sur N'IMPORTE QUELLE
 * fiche, jamais spécifique à une saisie invalide.
 *
 * Vérifié en direct dans le navigateur intégré (une page HTML autonome rejouant les deux règles,
 * comparant getComputedStyle(...).display sur un élément `hidden` avant/après correctif : "true"
 * avant, "false" après) — non re-vérifiable ici, ce bac à sable Node n'a pas de vrai moteur CSS
 * (cascade/spécificité). Ce test protège seulement contre une régression du CODE de la règle
 * elle-même (le sélecteur `:not([hidden])`, l'idiome déjà utilisé par .quick-add-inline plus haut
 * dans ce même fichier).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');

  assert.ok(!/(^|\n)\.tab-error-dot\s*\{/.test(css),
    '.tab-error-dot ne doit plus jamais être stylé SANS le garde :not([hidden]) — cette règle nue a la même spécificité que [hidden] et la bat toujours (origine auteur > UA à spécificité égale), rendant l\'attribut hidden totalement sans effet.');

  const ruleStart = css.indexOf('.tab-error-dot:not([hidden])');
  assert.ok(ruleStart !== -1, 'la règle doit exister, scopée à :not([hidden]) — même idiome que .quick-add-inline:not([hidden]) déjà utilisé dans ce fichier.');
  const ruleBody = css.slice(ruleStart, css.indexOf('}', ruleStart));
  assert.ok(ruleBody.includes('display: inline-block'), 'le point doit rester visible (inline-block) quand il n\'est PAS caché, sinon il ne servirait jamais à rien même sans le bug de spécificité.');

  console.log('OK — point-rouge-onglet-specificite-css-22-09.test.js (.tab-error-dot scopé à :not([hidden]), l\'attribut hidden reprend enfin effet)');
}

try {
  run();
} catch (err) {
  console.error('ÉCHEC — point-rouge-onglet-specificite-css-22-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
