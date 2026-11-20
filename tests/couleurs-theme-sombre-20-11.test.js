/**
 * Retour du 20/11/2026 : « les changements de couleurs dans les paramètres ne marchent pas ». Cause : les couleurs générales (principale, mise en avant, fond)
 * n'étaient écrites que pour le thème clair ; sur un écran en thème sombre (thème du système), rien ne changeait. Elles sont maintenant adaptées au thème sombre.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');
const api = loadAppJs();
api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
api.DB.init();
const sb = api.sandbox;

const css = sb.genererCssCouleursEntreprise({ principale: '#b3261e', miseEnAvant: '#a8501c', fond: '#f5efe0', menuTexte: '#1b5e20' });
const sombre = css.slice(css.indexOf('prefers-color-scheme: dark'));
assert.ok(/prefers-color-scheme: dark/.test(css) && css.includes(':root[data-theme="dark"]'), 'un bloc pour le thème sombre existe');
assert.ok(sombre.includes('--color-primary:') && sombre.includes('--color-gold:') && sombre.includes('--color-bg:'), 'principale, mise en avant et fond reprises en thème sombre');
assert.ok(!sombre.includes('--color-text:'), 'la couleur du texte ne sert pas en thème sombre (il doit rester clair)');
assert.ok(css.slice(0, css.indexOf('prefers-color-scheme: dark')).includes('--color-text:#1b5e20'), 'elle reste appliquée au thème clair');

// Lisibilité : la couleur principale est éclaircie quand elle se confondrait avec les cartes sombres, le fond reste plus sombre que les cartes
const marine = sb.genererCssCouleursEntreprise({ principale: '#17284d' });
const bouton = /--color-primary:(#[0-9a-f]{6})/.exec(marine.slice(marine.indexOf('prefers-color-scheme: dark')))[1];
assert.ok(sb.contrasteHex(bouton, '#1c1f26') >= 2.5, 'le bouton se détache de la carte sombre (' + bouton + ')');
const texte = /--color-primary-text:(#[0-9a-f]{6})/.exec(marine.slice(marine.indexOf('prefers-color-scheme: dark')))[1];
assert.ok(sb.contrasteHex(texte, '#1c1f26') >= 4.5, 'le texte de lien reste lisible sur la carte sombre (' + texte + ')');
const fond = /--color-bg:(#[0-9a-f]{6})/.exec(sombre)[1];
assert.ok(sb.luminanceHex(fond) < sb.luminanceHex('#1c1f26'), 'le fond reste plus sombre que les cartes');
assert.strictEqual(sb.genererCssCouleursEntreprise({}), '', 'aucune couleur choisie : aucune surcharge');
console.log('OK — couleurs-theme-sombre-20-11.test.js');
