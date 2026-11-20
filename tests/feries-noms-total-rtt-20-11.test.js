/**
 * Retour du 20/11/2026 : noms des jours fériés modifiables (tous, y compris nationaux), deux entrées le même jour (ex. « Pentecôte cadres » ajouté à côté du lundi de Pentecôte),
 * « Total RTT » en tiret pour qui n'a aucun RTT, et explication d'un « acquis 0 » dû aux paliers d'ancienneté.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

const api = loadAppJs();
api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
api.DB.init();
const { DB } = api;
const sb = api.sandbox;

// ---- Noms des fériés ----
const base = { feriesOverrides: {}, joursFeriesPersonnalises: [] };
const lundi2026 = sb.getAllPublicHolidays(2026, base).find(h => h.date === '2026-05-25');
assert.strictEqual(lundi2026.label, 'Lundi de Pentecôte', 'nom d\'origine par défaut');
assert.strictEqual(lundi2026.labelOriginal, 'Lundi de Pentecôte');

const renomme = { ...base, feriesNoms: { 'Lundi de Pentecôte': 'Journée de solidarité' } };
assert.strictEqual(sb.getAllPublicHolidays(2026, renomme).find(h => h.date === '2026-05-25').label, 'Journée de solidarité', 'nom personnalisé appliqué');
const lundi2027 = sb.getAllPublicHolidays(2027, renomme).find(h => h.labelOriginal === 'Lundi de Pentecôte');
assert.strictEqual(lundi2027.label, 'Journée de solidarité', 'valable pour toutes les années (la date de Pentecôte change)');
assert.strictEqual(lundi2027.date, '2027-05-17');
assert.strictEqual(sb.getAllPublicHolidays(2026, renomme).find(h => h.labelOriginal === 'Noël').label, 'Noël', 'les autres fériés gardent leur nom');
assert.strictEqual(sb.getFrenchPublicHolidays(2026).find(h => h.date === '2026-05-25').label, 'Lundi de Pentecôte', 'le calcul des fériés nationaux ne dépend pas des noms');

// ---- Deux entrées le même jour : l'exception d'une catégorie dans n'importe laquelle l'emporte ----
const settings = DB.getSettings();
const categories = [{ id: 'cat-cadre', nom: 'Cadre' }, { id: 'cat-non', nom: 'Non cadre' }];
const employee = DB.getEmployees().find(e => e.role === 'salarie');
const cadre = { ...employee, categorieSalarieId: 'cat-cadre' };
const nonCadre = { ...employee, categorieSalarieId: 'cat-non' };
const cfg = {
  ...settings, categoriesSalarie: categories, feriesOverrides: {},
  joursFeriesPersonnalises: [{ date: '2026-05-25', label: 'Pentecôte Cadre', travaillable: false, exceptionsCategories: [{ categorieSalarieId: 'cat-cadre', travaillable: true }] }]
};
assert.strictEqual(sb.isJourTravaillePourSalarie('2026-05-25', cadre, cfg, categories), true, 'le cadre travaille (exception de l\'entrée ajoutée)');
assert.strictEqual(sb.isJourTravaillePourSalarie('2026-05-25', nonCadre, cfg, categories), false, 'le non-cadre suit la règle par défaut du férié national');
assert.strictEqual(sb.isJourTravaillePourSalarie('2026-05-26', nonCadre, cfg, categories), true, 'un jour ordinaire reste travaillé');

// ---- Total RTT : tiret pour qui n'a aucun RTT ----
// (rendu complet vérifié en navigateur ; ici, la règle : plus de « 0,00 j » dans la colonne)
const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8');
assert.ok(src.includes('aucunRtt: Boolean(employee) && concernes.length === 0'), 'le total RTT sait qu\'un salarié n\'est concerné par aucun type RTT');
assert.ok(src.includes('Non concerné : aucun type RTT pour ce salarié'), 'et affiche un tiret expliqué');

// ---- Acquis 0 dû aux paliers : le tableau l'explique ----
const congesPayes = DB.getLeaveTypes().find(t => /^Congés payés/.test(t.nom));
const typeAPaliers = { ...congesPayes, paliersAnciennete: [{ ancienneteMin: 20, jours: 27 }], nombreAnnuel: 0 };
const bal = { acquis: 0, pris: 15, enAttente: 0, disponible: 10, ajustement: 25 };
const recent = { ...employee, dateEmbauche: '2024-01-01' };
const cellule = sb.renderTableauCompteursCell(bal, recent, typeAPaliers);
assert.ok(cellule.includes('Aucun palier d\'ancienneté ne s\'applique'), 'explication affichée quand aucun palier ne s\'applique');
const celluleOk = sb.renderTableauCompteursCell(bal, recent, { ...typeAPaliers, paliersAnciennete: [{ ancienneteMin: 0, jours: 25 }, { ancienneteMin: 20, jours: 27 }] });
assert.ok(!celluleOk.includes('Aucun palier'), 'rien à signaler avec une ligne « 0 an »');
assert.ok(!sb.renderTableauCompteursCell(bal, recent, { ...congesPayes, paliersAnciennete: [] }).includes('Aucun palier'), 'type sans palier : jamais d\'alerte');

console.log('OK — feries-noms-total-rtt-20-11.test.js');
