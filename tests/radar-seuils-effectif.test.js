/**
 * Seven RH — "Radar Seuils" (roadmap différenciation #1, 01/09/2026) : alerte au franchissement de
 * 11/50/250 salariés, avec le nombre de mois consécutifs déjà écoulés et les deux délais légaux
 * distincts (12 mois pour CSE/règlement intérieur, 5 ans pour les obligations harmonisées PACTE).
 */
const assert = require('assert');
const { loadDataJs } = require('./load-data-js');

// Décale une date ISO 'AAAA-MM-JJ' de N mois (N négatif = dans le passé) — calcul fait dans le realm
// EXTÉRIEUR (jamais passé tel quel dans le vm, seulement la chaîne résultante, pour éviter le piège
// cross-realm instanceof Date documenté dans ce projet).
function shiftMonthsISO(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1 + months, d);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function makeEmployees(n, dateEmbauche, dateDepart) {
  return Array.from({ length: n }, (_, i) => ({ id: `e${i}`, dateEmbauche, dateDepart: dateDepart || '' }));
}

async function run() {
  const { getEffectifActifAt, getSeuilsEffectifStatus } = loadDataJs();
  const REF = '2027-01-01';

  // ---- getEffectifActifAt : compte au bon jour, respecte embauche/départ ----
  {
    const employees = [
      ...makeEmployees(5, '2020-01-01'),
      ...makeEmployees(3, '2020-01-01', '2023-01-01'), // partis avant la référence
    ];
    assert.strictEqual(getEffectifActifAt(employees, '2022-06-01'), 8, 'avant leur départ, les 8 salariés comptent');
    assert.strictEqual(getEffectifActifAt(employees, '2023-06-01'), 5, 'après leur départ, seuls les 5 restants comptent');
    assert.strictEqual(getEffectifActifAt(employees, '2019-06-01'), 0, 'avant toute embauche, effectif nul');
  }

  // ---- Sous tous les seuils : aucun franchissement signalé ----
  {
    const employees = makeEmployees(6, '2020-01-01');
    const statuts = getSeuilsEffectifStatus(employees, REF);
    assert.ok(statuts.every(s => !s.franchi), 'avec seulement 6 salariés, aucun des 3 seuils ne doit être franchi');
  }

  // ---- Seuil 11, juste SOUS la barre des 12 mois consécutifs (11 mois) : délai court pas encore acquis ----
  {
    const employees = makeEmployees(12, shiftMonthsISO(REF, -10));
    const s11 = getSeuilsEffectifStatus(employees, REF).find(s => s.seuil === 11);
    assert.strictEqual(s11.franchi, true);
    assert.strictEqual(s11.moisConsecutifs, 11);
    assert.strictEqual(s11.courtDelaiApplicable, false, 'à 11 mois consécutifs, le délai de 12 mois (CSE) n\'est pas encore écoulé');
  }

  // ---- Seuil 11, exactement 12 mois consécutifs : délai court tout juste acquis ----
  {
    const employees = makeEmployees(12, shiftMonthsISO(REF, -11));
    const s11 = getSeuilsEffectifStatus(employees, REF).find(s => s.seuil === 11);
    assert.strictEqual(s11.moisConsecutifs, 12);
    assert.strictEqual(s11.courtDelaiApplicable, true, 'à 12 mois consécutifs, le CSE devient applicable');
    assert.strictEqual(s11.depuisDate, shiftMonthsISO(REF, -11), 'depuisDate doit correspondre à la date d\'embauche à l\'origine du franchissement');
  }

  // ---- Seuil 50, juste SOUS 5 ans (59 mois) : délai long pas encore acquis, court délai lui déjà acquis ----
  {
    const employees = makeEmployees(50, shiftMonthsISO(REF, -58));
    const s50 = getSeuilsEffectifStatus(employees, REF).find(s => s.seuil === 50);
    assert.strictEqual(s50.moisConsecutifs, 59);
    assert.strictEqual(s50.courtDelaiApplicable, true, '59 mois > 12 mois : règlement intérieur/BDESE déjà applicables');
    assert.strictEqual(s50.longDelaiApplicable, false, '59 mois < 60 : participation/PEEC (5 ans PACTE) pas encore applicables');
  }

  // ---- Seuil 50, exactement 5 ans (60 mois) : délai long tout juste acquis ----
  {
    const employees = makeEmployees(50, shiftMonthsISO(REF, -59));
    const s50 = getSeuilsEffectifStatus(employees, REF).find(s => s.seuil === 50);
    assert.strictEqual(s50.moisConsecutifs, 60);
    assert.strictEqual(s50.longDelaiApplicable, true, 'à 60 mois consécutifs (5 ans), la règle PACTE est satisfaite');
  }

  // ---- Un creux sous le seuil RÉINITIALISE le compteur de mois consécutifs (pas de cumul historique) ----
  {
    // 15 salariés il y a 3 ans, effectif retombé à 5 (sous 11) il y a 1 an, remonté à 12 il y a 2 mois.
    const anciens = makeEmployees(15, shiftMonthsISO(REF, -36), shiftMonthsISO(REF, -12));
    const recents = makeEmployees(12, shiftMonthsISO(REF, -2));
    const employees = [...anciens, ...recents];
    const s11 = getSeuilsEffectifStatus(employees, REF).find(s => s.seuil === 11);
    assert.strictEqual(s11.franchi, true);
    assert.ok(s11.moisConsecutifs <= 3, `le creux d'il y a 1 an doit avoir réinitialisé le compteur (obtenu ${s11.moisConsecutifs} mois, attendu ~3 max)`);
    assert.strictEqual(s11.courtDelaiApplicable, false, 'le franchissement récent (2-3 mois) ne doit pas hériter de l\'ancienneté d\'avant le creux');
  }

  console.log('OK — radar-seuils-effectif.test.js (11/50/250, délais 12 mois et 5 ans, réinitialisation après un creux)');
}

run().catch((err) => {
  console.error('ÉCHEC — radar-seuils-effectif.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
