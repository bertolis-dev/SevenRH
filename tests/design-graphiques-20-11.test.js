/**
 * Retour du 20/11/2026 (finitions de design) : graphiques lisibles (textes à leur taille réelle, anneau en camaïeu marine + or).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

const api = loadAppJs();
api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
api.DB.init();
const sb = api.sandbox;

// Barres : dessinées à ~la largeur d'affichage, étiquettes longues raccourcies (et complètes en infobulle)
const barres = sb.renderBarChartSVG([
  { label: 'Direction', value: 3, color: 'var(--color-primary)' },
  { label: "Annonce de handicap ou maladie grave d'un enfant", value: 1, color: 'var(--color-primary)' }
]);
assert.ok(barres.includes('viewBox="0 0 360 '), 'graphique à barres dessiné en 360 de large (textes non réduits)');
assert.ok(barres.includes('Annonce de handi…') || /Annonce de handic?…/.test(barres), 'étiquette trop longue raccourcie');
assert.ok(barres.includes("<title>Annonce de handicap ou maladie grave d&#39;un enfant</title>") || barres.includes("<title>Annonce de handicap ou maladie grave d'un enfant</title>"), 'libellé complet en infobulle');

// Anneau : un segment = une teinte différente, pastille de légende comprise
const contrats = sb.getContratBreakdown([
  { typeContrat: 'CDI', statut: 'Actif' }, { typeContrat: 'CDI', statut: 'Actif' }, { typeContrat: 'CDD', statut: 'Actif' }, { typeContrat: 'Alternance', statut: 'Actif' }
]);
const couleurs = contrats.map(c => c.color);
assert.strictEqual(new Set(couleurs).size, contrats.length, 'chaque type de contrat a sa teinte');
assert.ok(couleurs.every(c => /var\(--color-(primary|gold)\)|color-mix\(in srgb, var\(--color-(primary|gold)\)/.test(c)), 'toutes les teintes restent dans la famille marine + or');
const anneau = sb.renderDonutChartSVG(contrats) + sb.chartLegend(contrats);
assert.ok(anneau.includes('stroke="var(--color-gold)"') && anneau.includes('background:var(--color-gold)'), 'anneau et légende utilisent les mêmes teintes');

// Les barres (par service) gardent une seule teinte, comme demandé le 21/08/2026
const services = sb.getServiceBreakdown([
  { service: 'IT', statut: 'Actif' }, { service: 'RH', statut: 'Actif' }
]);
assert.strictEqual(new Set(services.map(s => s.color)).size, 1, 'barres : une seule teinte');

console.log('OK — design-graphiques-20-11.test.js');
