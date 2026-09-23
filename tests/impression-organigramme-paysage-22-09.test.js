/**
 * §retour Betty du 22/09/2026 : "regarde le résultat de l'organigramme, il faut qu'il s'adapte à la
 * largeur de la page. Donc de préférence en général je pense plus en paysage. Et là il y a une
 * grosse marge blanche sur le côté, du coup on ne voit pas tous les salariés."
 *
 * Sur sa capture, la colonne de Laura LIBESSART est coupée au bord droit de la feuille, et les deux
 * tiers inférieurs de la page sont vides.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const appJs = lire('app.js');
const css = lire('style.css');

function test(nom, fn) {
  try { fn(); console.log(`OK — impression-organigramme-paysage-22-09.test.js (${nom})`); }
  catch (e) { console.error(`ÉCHEC — ${nom}`); throw e; }
}

test('une orientation est enfin déclarée : sans @page, tout sortait en portrait', () => {
  assert.ok(/@page\s*\{[^}]*size:\s*A4 portrait/.test(css), 'format par défaut explicite attendu');
  assert.ok(/@page paysage\s*\{[^}]*size:\s*A4 landscape/.test(css), 'page nommée paysage attendue');
});

test('le paysage est choisi document par document, jamais imposé à tous', () => {
  assert.ok(css.includes('.print-landscape { page: paysage; }'));
  const occurrences = appJs.split('print-area print-document print-landscape').length - 1;
  assert.strictEqual(occurrences, 1,
    'seul l\'organigramme est en paysage : une attestation reste une colonne de texte');
});

test('la zone imprimable est réduite quand elle dépasse la feuille', () => {
  const i = appJs.indexOf('const largeurFeuille = printArea.classList.contains');
  assert.ok(i > -1, 'mise à l\'échelle attendue dans isolatePrintAreaForPrinting');
  const corps = appJs.slice(i, i + 900);
  assert.ok(corps.includes('if (largeurContenu > largeurFeuille)'),
    'réduction seulement si nécessaire, jamais un agrandissement');
  assert.ok(corps.includes("transformOrigin = 'top left'"), 'ancrage en haut à gauche');
});

test('la hauteur suit la réduction, sinon une page blanche s\'ajoute', () => {
  const i = appJs.indexOf('const largeurFeuille = printArea.classList.contains');
  const corps = appJs.slice(i, i + 900);
  assert.ok(corps.includes('printArea.scrollHeight * ratio'),
    'une transformation ne change pas la mise en page : la hauteur doit être ramenée à la main');
});

test('la réduction est annulée après impression, comme le reste de l\'isolement', () => {
  const i = appJs.indexOf('const largeurFeuille = printArea.classList.contains');
  const corps = appJs.slice(i, i + 900);
  ['transform', 'transformOrigin', 'width', 'height'].forEach(prop => {
    assert.ok(corps.includes(`'${prop}'`), `${prop} doit être restaurée`);
  });
});

test('la largeur paysage retenue reste sous la largeur réelle d\'une A4', () => {
  const paysage = Number(/const LARGEUR_IMPRIMABLE_PAYSAGE_PX = (\d+)/.exec(appJs)[1]);
  const portrait = Number(/const LARGEUR_IMPRIMABLE_PORTRAIT_PX = (\d+)/.exec(appJs)[1]);
  // 297 mm et 210 mm à 96 ppp, marges non déduites.
  assert.ok(paysage < 297 / 25.4 * 96, 'une valeur trop haute couperait le bord droit');
  assert.ok(portrait < 210 / 25.4 * 96);
  assert.ok(paysage > portrait);
});
