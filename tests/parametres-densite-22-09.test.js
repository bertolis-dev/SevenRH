/**
 * §retour Betty du 22/09/2026 : "on voit qu'il y a beaucoup d'espace perdu... revoir tous les menus
 * pour qu'il y ait une meilleure utilisation de l'espace. Que ce ne soit pas tassé, mais que du
 * coup il n'y ait pas des espaces vides comme ça... on ne voit que deux cartouches alors qu'on
 * pourrait facilement en voir plus."
 *
 * Vérifie sur la SOURCE (ces écrans ont besoin d'une entreprise chargée pour s'exécuter) les trois
 * causes identifiées : cartes empilées une par ligne, largeur de champ plafonnée en dur, et
 * explications affichées dans la couleur d'avertissement.
 */
const assert = require('assert');
const fs = require('fs');

const appJs = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8');
const css = fs.readFileSync(require('path').join(__dirname, '..', 'style.css'), 'utf8');

function test(nom, fn) {
  try { fn(); console.log(`OK — paramètres-densite-22-09.test.js (${nom})`); }
  catch (e) { console.error(`ÉCHEC — ${nom}`); throw e; }
}

test('les onglets à cartes d\'options les disposent en grille, plus une par ligne', () => {
  ['renderParametresRemuneration', 'renderParametresRH',
   'renderParametresPlanningTeletravail', 'renderParametresTicketsRestaurant'].forEach(nom => {
    const debut = appJs.indexOf(`function ${nom}() {`);
    assert.ok(debut > -1, `${nom} introuvable`);
    const corps = appJs.slice(debut, appJs.indexOf('\n}\n', debut));
    assert.ok(corps.includes('settings-cards-grid'), `${nom} devrait disposer ses cartes en grille`);
  });
});

test('la grille se replie seule sur écran étroit, sans media query dédiée', () => {
  const regle = css.slice(css.indexOf('.settings-cards-grid {'));
  assert.ok(/repeat\(auto-fit, minmax\(\d+px, 1fr\)\)/.test(regle.slice(0, 200)),
    'auto-fit attendu plutôt qu\'un nombre de colonnes figé');
});

test('les cartes de Paramètres ne plafonnent plus leurs champs à 700px', () => {
  assert.strictEqual(appJs.split('form-grid" style="max-width: 700px;"').length - 1, 0,
    'ce plafond laissait la moitié droite de chaque carte vide');
});

test('une explication sous un champ n\'est plus affichée en couleur d\'avertissement', () => {
  const debut = css.indexOf('.form-hint {');
  const regle = css.slice(debut, css.indexOf('}', debut));
  assert.ok(!regle.includes('--color-warning'),
    '.form-hint explique, elle n\'alerte pas : l\'orange reste à .field-warning');
  assert.ok(regle.includes('--color-text-muted'), 'gris de texte secondaire attendu');
});

test('un vrai avertissement garde bien la couleur d\'avertissement', () => {
  const debut = css.indexOf('.field-warning {');
  const regle = css.slice(debut, css.indexOf('}', debut));
  assert.ok(regle.includes('--color-warning'), '.field-warning reste orange');
});

test('la hauteur de ligne des tableaux reste celle demandée', () => {
  const debut = css.indexOf('.table td {');
  const regle = css.slice(debut, css.indexOf('}', debut));
  assert.ok(regle.includes('padding: 10px 22px'), 'lignes resserrées attendues');
});
