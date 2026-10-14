/**
 * Seven RH — point en attente de la revue du 13/10/2026, traité le 14/10 : l'ancienneté était calculée en jours / 365,25, donc
 * le jour d'un anniversaire elle pouvait valoir 4,9993 an au lieu de 5 (palier d'ancienneté manqué d'un jour). Elle est
 * désormais calculée en années civiles entières + fraction de l'année en cours : pile un entier le jour de l'anniversaire.
 */
const assert = require('assert');
const { loadDataJs } = require('./load-data-js');

function run() {
  const { calculateAncienneteYears } = loadDataJs();
  const an = (embauche, ref) => calculateAncienneteYears({ dateEmbauche: embauche }, ref);

  assert.strictEqual(an('2021-03-15', '2026-03-15'), 5, 'le jour de l\'anniversaire : exactement 5');
  assert.ok(an('2021-03-15', '2026-03-14') < 5 && an('2021-03-15', '2026-03-14') > 4.99, 'la veille : juste en dessous de 5');
  assert.strictEqual(an('2020-01-01', '2021-01-01'), 1, '1 an pile');
  assert.strictEqual(an('2016-06-30', '2026-06-30'), 10, '10 ans pile (années bissextiles traversées)');
  assert.strictEqual(an('2016-06-30', '2026-06-29') < 10, true);
  assert.strictEqual(an('2020-02-29', '2025-03-01'), 5, 'embauché un 29 février : anniversaire au 1er mars les années non bissextiles');
  assert.ok(Math.abs(an('2024-01-01', '2024-07-01') - 0.5) < 0.01, 'environ une demi-année à mi-parcours');
  assert.strictEqual(an('2026-10-14', '2026-10-14'), 0, 'le jour de l\'embauche : 0');
  assert.strictEqual(an('2026-10-14', '2026-10-01'), 0, 'avant l\'embauche : 0, jamais négatif');
  assert.strictEqual(calculateAncienneteYears({}, '2026-10-14'), 0, 'sans date d\'embauche : 0');

  // monotone : jamais de recul d'un jour à l'autre
  let precedent = -1;
  for (let j = 0; j < 800; j++) {
    const d = new Date(2024, 0, 1 + j);
    const ref = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const v = calculateAncienneteYears({ dateEmbauche: '2021-02-28' }, ref);
    assert.ok(v >= precedent, 'ancienneté croissante au jour ' + j);
    precedent = v;
  }
  console.log('OK — anciennete-anniversaire-14-10.test.js (années civiles : entier pile le jour de l\'anniversaire, 29 février, avant embauche, croissante)');
}

try { run(); } catch (err) { console.error('ÉCHEC — anciennete-anniversaire-14-10.test.js'); console.error(err.stack || err.message); process.exitCode = 1; }
