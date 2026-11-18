/**
 * Retour du 16/11/2026 : les vacances scolaires choisies dans les Paramètres s'affichent dans le calendrier de l'équipe, en « parenthèse » au-dessus des jours concernés.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

const api = loadAppJs();
api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
api.DB.init();
const sb = api.sandbox;

const donnees = { zones: 'C', periodes: [
  { nom: 'Vacances de Noël', debut: '2025-12-20', fin: '2026-01-04', zones: ['A', 'B', 'C'] },
  { nom: 'Vacances d\'hiver', debut: '2026-02-07', fin: '2026-02-22', zones: ['A'] }
] };
const sharedData = { schoolHolidays: donnees, schoolZone: 'C' };
const meta = (annee, mois) => (d) => ({ dateStr: `${annee}-${String(mois).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
const jours = (n) => Array.from({ length: n }, (_, i) => i + 1);

// Décembre 2025 : du 20 au 31, la période continue en janvier
let v = sb.calculerVacancesScolairesDuMois(jours(31), meta(2025, 12), sharedData);
assert.strictEqual(v.segments.length, 1, 'une seule parenthèse en décembre');
assert.strictEqual(v.segments[0].debut, 19, 'commence le 20 (index 19)');
assert.strictEqual(v.segments[0].fin, 30, 'continue jusqu\'au 31');
assert.strictEqual(v.segments[0].commenceAvant, false);
assert.strictEqual(v.segments[0].finitApres, true, 'se poursuit le mois suivant');

// Janvier 2026 : du 1er au 4, commencée le mois précédent
v = sb.calculerVacancesScolairesDuMois(jours(31), meta(2026, 1), sharedData);
assert.strictEqual(v.segments.length, 1);
assert.strictEqual(v.segments[0].fin, 3);
assert.strictEqual(v.segments[0].commenceAvant, true);
assert.strictEqual(v.segments[0].finitApres, false);

// Février 2026 zone C : les vacances d'hiver de la zone A ne comptent pas (aucune période C ici)
v = sb.calculerVacancesScolairesDuMois(jours(28), meta(2026, 2), sharedData);
assert.strictEqual(v.segments.length, 0, 'seule la zone de l\'entreprise est affichée');
assert.strictEqual(sb.renderLigneVacancesScolaires(jours(28), v, 'C'), '', 'aucune ligne quand il n\'y a pas de vacances ce mois-ci');

// La ligne HTML
const html = sb.renderLigneVacancesScolaires(jours(31), sb.calculerVacancesScolairesDuMois(jours(31), meta(2025, 12), sharedData), 'C');
assert.ok(html.includes('colspan="12"') && html.includes('Vacances de Noël') && html.includes('zone C'), 'la parenthèse couvre 12 jours et porte le nom de la période');
assert.ok(html.includes('ouvert-droite'), 'bord droit ouvert quand la période continue');
assert.strictEqual((html.match(/absence-cal-vacances-vide/g) || []).length, 19, 'les 19 jours avant sont des cases vides');

console.log('OK — vacances-scolaires-calendrier-equipe-18-11.test.js');
