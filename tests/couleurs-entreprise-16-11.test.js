/**
 * Retour du 16/11/2026 : écran Paramètres > Couleurs (couleur principale, texte, mise en avant, fond, palette de chaque espace).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

const api = loadAppJs();
api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
api.DB.init();
const sb = api.sandbox;

// CSS généré
assert.strictEqual(sb.genererCssCouleursEntreprise({}), '', 'aucune couleur choisie : aucune surcharge');
const css = sb.genererCssCouleursEntreprise({ principale: '#245090', miseEnAvant: '#a8501c', palettes: { personnel: 'bordeaux', equipe: 'vert' } });
assert.ok(css.includes('--color-primary:#245090'), 'couleur principale appliquée');
assert.ok(css.includes('--color-gold:#a8501c'), 'mise en avant appliquée');
assert.ok(css.includes('--espace-personnel:#8b1f3a') && css.includes('--espace-equipe:#2e6e40'), 'palettes des espaces appliquées');
assert.ok(/prefers-color-scheme: light/.test(css) && css.includes('[data-theme="light"]'), 'les couleurs générales ne s\'appliquent qu\'au thème clair');
assert.ok(!sb.genererCssCouleursEntreprise({ principale: 'rouge; background:red' }).includes('--color-primary'), 'une valeur qui n\'est pas une couleur hexadécimale est ignorée');
assert.strictEqual(sb.melangerHex('#000000', '#ffffff', 0.5), '#808080');

// L'onglet existe, pour la RH et le propriétaire
const rh = api.DB.getEmployees().find(e => e.role === 'rh');
api.DB._currentEmployeeId = rh.id;
const onglet = api.PARAMETRES_TABS.find(t => t.key === 'couleurs');
assert.ok(onglet && onglet.isVisible(), 'onglet Couleurs visible pour la RH');
const html = sb.renderParametresCouleurs();
assert.ok(html.includes('data-couleur="principale"') && html.includes('data-couleur="fond"'), 'quatre couleurs modifiables');
assert.strictEqual((html.match(/data-palette-espace="personnel"/g) || []).length, 9, 'neuf palettes par espace');
assert.ok(html.includes('Bleu canard') && html.includes('Terre cuite'), 'noms des palettes');

// Enregistrement
sb.enregistrerCouleursEntreprise({ principale: '#176775', palettes: { administration: 'ardoise' } });
const c = sb.couleursEntrepriseEffectives();
assert.strictEqual(c.principale, '#176775');
assert.strictEqual(c.palettes.administration, 'ardoise');
assert.strictEqual(c.palettes.personnel, 'bleu', 'les autres palettes gardent leur valeur');

console.log('OK — couleurs-entreprise-16-11.test.js');
