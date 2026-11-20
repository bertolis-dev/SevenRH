/**
 * Retour du 20/11/2026 : voiture de société dans la fiche (champs, début et fin de contrat, rappels), colonnes du calendrier de l'équipe qui ne s'élargissent plus
 * à cause du libellé des vacances scolaires, et plus de lignes grisées en alternance dans les grilles de planning.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAppJs } = require('./load-app-js');

const api = loadAppJs();
api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
api.DB.init();
const sb = api.sandbox;

// ---- Validation ----
const ok = sb.validerVoitureSociete({ marque: ' Peugeot ', modele: '308  SW', immatriculation: 'ab-123-cd', dateDebut: '2024-12-10', dateFin: '2026-12-10', kmAnnuel: '25 000', carteCarburant: true, numeroCarteCarburant: '7080', usagePrive: true, detention: 'loa', energie: 'electrique' });
assert.ok(ok.ok, 'saisie valide acceptée');
assert.strictEqual(ok.voiture.marque, 'Peugeot');
assert.strictEqual(ok.voiture.modele, '308 SW', 'espaces superflus retirés');
assert.strictEqual(ok.voiture.immatriculation, 'AB-123-CD', 'immatriculation en majuscules');
assert.strictEqual(ok.voiture.kmAnnuel, 25000, 'kilométrage lu avec ses espaces');
assert.strictEqual(ok.voiture.detention, 'loa');
assert.strictEqual(ok.voiture.energie, 'electrique');
assert.strictEqual(ok.voiture.numeroCarteCarburant, '7080');
assert.strictEqual(sb.validerVoitureSociete({ marque: 'A', modele: 'B', carteCarburant: false, numeroCarteCarburant: '999' }).voiture.numeroCarteCarburant, '', 'pas de numéro de carte si aucune carte');
assert.ok(!sb.validerVoitureSociete({ marque: '', modele: 'X' }).ok, 'marque obligatoire');
assert.ok(!sb.validerVoitureSociete({ marque: 'X', modele: '' }).ok, 'modèle obligatoire');
assert.ok(!sb.validerVoitureSociete({ marque: 'X', modele: 'Y', dateDebut: '2026-05-01', dateFin: '2026-04-01' }).ok, 'fin avant début refusée');
assert.ok(!sb.validerVoitureSociete({ marque: 'X', modele: 'Y', dateFin: '31/12/2026' }).ok, 'date mal formée refusée');
assert.ok(!sb.validerVoitureSociete({ marque: 'X', modele: 'Y', kmAnnuel: 'beaucoup' }).ok, 'kilométrage non numérique refusé');
assert.strictEqual(sb.validerVoitureSociete({ marque: 'X', modele: 'Y', detention: 'inconnue' }).voiture.detention, 'lld', 'détention inconnue : valeur par défaut');

// ---- Fin de contrat à venir ----
const aujourdhui = new Date();
const dans = (n) => { const d = new Date(aujourdhui); d.setDate(d.getDate() + n); return sb.toISODate(d); };
const [a, b, c] = api.DB.getEmployees().filter(e => e.statut === 'Actif');
const liste = [
  { ...a, voiture: { marque: 'A', modele: 'a', dateFin: dans(20) } },
  { ...b, voiture: { marque: 'B', modele: 'b', dateFin: dans(200) } },
  { ...c, voiture: { marque: 'C', modele: 'c', dateFin: dans(-5) } }
];
const fins = sb.getUpcomingVoitureFins(90, liste, Infinity);
assert.strictEqual(fins.length, 2, 'seulement les contrats qui se terminent bientôt ou sont terminés');
assert.strictEqual(fins[0].voiture.marque, 'C', 'le plus ancien d\'abord');
assert.ok(!sb.getUpcomingVoitureFins(90, [{ ...a }], Infinity).length, 'un salarié sans voiture n\'apparaît jamais');

// ---- Rappel rattaché au module RH ----
assert.strictEqual(sb.requiredModuleForSourceKey('voiture-fin-emp1-2026-12-10-j30'), 'rh');

// ---- Calendrier de l'équipe ----
const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
assert.ok(/\.absence-cal-vacances-bloc span\s*\{[^}]*position:\s*absolute/.test(css), 'le libellé des vacances ne compte plus dans la largeur des colonnes');
assert.ok(css.includes('.table:not(.mobile-cards):not(.planning-table) tbody tr:nth-child(even) td'), 'pas de lignes grisées en alternance dans les grilles de planning');

// ---- Plus de point de couleur devant le titre des pages ----
assert.ok(!/h1::before\s*\{[^}]*border-radius:\s*50%/.test(css), 'le point de couleur devant le titre de page est retiré');

assert.ok(/#absence-cal-filter-service\s*\{[^}]*width:\s*156px/.test(css) && css.includes('.calendar-nav:has(#absence-cal-filter-service) > .btn-sm'), 'le filtre de service du calendrier a la même taille que les boutons voisins');

// ---- Liseré de couleur en haut de l'écran retiré, couleurs du calendrier de l'équipe plus distinctes ----
assert.ok(!/#topbar\s*\{[^}]*border-top:\s*4px solid var\(--espace-accent\)/.test(css), 'le liseré de couleur du haut de l\'écran est retiré');
assert.strictEqual(sb.couleurCalendrierType({ nom: 'Maladie', couleur: '#16a34a' }), '#dc2626', 'Maladie : rouge au lieu d\'un vert voisin de Formation');
assert.strictEqual(sb.couleurCalendrierType({ nom: 'Ancienneté', couleur: '#0891b2' }), '#db2777', 'Ancienneté : rose au lieu d\'un bleu voisin');
assert.strictEqual(sb.couleurCalendrierType({ nom: 'Maladie', couleur: '#123456' }), '#123456', 'une couleur choisie dans Paramètres est respectée');
const teintes = ['Congés payés', 'RTT', 'Ancienneté', 'Maladie', 'Formation', 'Proche aidant'].map(nom => {
  const original = { 'Congés payés': '#2563eb', 'RTT': '#7c3aed', 'Ancienneté': '#0891b2', 'Maladie': '#16a34a', 'Formation': '#059669', 'Proche aidant': '#8b5cf6' }[nom];
  return sb.couleurCalendrierType({ nom, couleur: original });
});
assert.strictEqual(new Set(teintes).size, teintes.length, 'six types, six couleurs différentes');
assert.ok(css.includes('.absence-cal-bar-telework { background: #0f766e; }'), 'télétravail : sa propre teinte, plus le bleu marine');

console.log('OK — voiture-societe-calendrier-20-11.test.js');
