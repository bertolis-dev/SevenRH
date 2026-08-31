/**
 * Seven RH — "Simulateur convention collective" (roadmap différenciation #9, pilote du 01/09/2026) :
 * première convention codée dans le moteur de règles par IDCC — Syntec (IDCC 1486), Article 5.1
 * "Congés d'ancienneté" (vérifié via Légifrance/sources professionnelles concordantes). Vérifie que
 * le bonus s'applique correctement (paliers non cumulatifs) ET qu'un salarié hors Syntec (l'immense
 * majorité) n'est jamais affecté.
 */
const assert = require('assert');
const { loadDataJs } = require('./load-data-js');

function makeEmployee(overrides) {
  return Object.assign({
    id: 'emp-test',
    dateEmbauche: '2010-01-01',
    pourcentageActivite: 100,
    compteurs: {},
    conventionCollective: 'Syntec (IDCC 1486)'
  }, overrides);
}

async function run() {
  const { getConventionCollectiveIdccCode, getConventionCollectiveCongesAncienneteBonus, calculateAcquisition, makeEmptyLeaveType } = loadDataJs();

  // ---- Extraction du code IDCC depuis le texte libre affiché ----
  assert.strictEqual(getConventionCollectiveIdccCode('Syntec (IDCC 1486)'), '1486');
  assert.strictEqual(getConventionCollectiveIdccCode('Aucune'), null);
  assert.strictEqual(getConventionCollectiveIdccCode(''), null);
  assert.strictEqual(getConventionCollectiveIdccCode(undefined), null);

  const cp = Object.assign(makeEmptyLeaveType(), { nom: 'Congés payés', nombreAnnuel: 25 }); // uniteDecompte 'ouvres' par défaut

  // ---- Paliers Article 5.1, non cumulatifs (le plus haut atteint seulement) ----
  const refDate = '2027-01-01';
  const casTest = [
    ['2026-06-01', 0],  // moins de 5 ans -> aucun bonus
    ['2021-06-01', 1],  // 5 à 9 ans -> +1
    ['2016-06-01', 2],  // 10 à 14 ans -> +2
    ['2011-06-01', 3],  // 15 à 19 ans -> +3
    ['2000-06-01', 4],  // 20 ans et plus -> +4 (jamais 1+2+3+4=10, non cumulatif)
  ];
  casTest.forEach(([dateEmbauche, attendu]) => {
    const bonus = getConventionCollectiveCongesAncienneteBonus(makeEmployee({ dateEmbauche }), cp, refDate);
    assert.strictEqual(bonus, attendu, `ancienneté depuis ${dateEmbauche} : bonus attendu ${attendu}, obtenu ${bonus}`);
  });

  // ---- Le bonus est bien intégré au calcul complet (calculateAcquisition), pas juste calculé à part ----
  // refDate au 31/12 (fin d'année civile) pour obtenir l'acquisition ANNUELLE COMPLÈTE, pas la
  // fraction déjà accumulée au 1er janvier (calculateAcquisition prorata sur l'année en cours).
  const refDateFinAnnee = '2027-12-31';
  {
    const employee20ans = makeEmployee({ dateEmbauche: '2000-06-01' });
    const acquis = calculateAcquisition(employee20ans, cp, refDateFinAnnee);
    assert.strictEqual(acquis, 29, 'un salarié Syntec à 20+ ans d\'ancienneté doit acquérir 25 + 4 = 29 jours sur l\'année, pas 25');
  }

  // ---- Un salarié SANS convention couverte n'est jamais affecté (comportement inchangé) ----
  {
    const sansConvention = makeEmployee({ dateEmbauche: '2000-06-01', conventionCollective: 'Aucune' });
    assert.strictEqual(getConventionCollectiveCongesAncienneteBonus(sansConvention, cp, refDate), 0, 'sans convention couverte, aucun bonus');
    assert.strictEqual(calculateAcquisition(sansConvention, cp, refDateFinAnnee), 25, 'sans convention couverte, le calcul standard (25) reste inchangé');

    const autreConvention = makeEmployee({ dateEmbauche: '2000-06-01', conventionCollective: 'Métallurgie (IDCC 3248)' });
    assert.strictEqual(getConventionCollectiveCongesAncienneteBonus(autreConvention, cp, refDate), 0, 'une convention non codée dans le pilote ne doit jamais planter ni inventer un bonus');
  }

  // ---- Ne s'applique qu'au type "Congés payés", jamais à un autre type (ex. RTT) ----
  {
    const rtt = Object.assign(makeEmptyLeaveType(), { nom: 'RTT', nombreAnnuel: 10 });
    const salarie20ans = makeEmployee({ dateEmbauche: '2000-06-01' });
    assert.strictEqual(getConventionCollectiveCongesAncienneteBonus(salarie20ans, rtt, refDate), 0, 'le bonus Syntec ne concerne que les congés payés, jamais la RTT');
  }

  // ---- Ne s'applique que si le type est en jours ouvrés (l'article l'exprime précisément ainsi) ----
  {
    const cpOuvrables = Object.assign(makeEmptyLeaveType(), { nom: 'Congés payés', nombreAnnuel: 30, uniteDecompte: 'ouvrables' });
    const salarie20ans = makeEmployee({ dateEmbauche: '2000-06-01' });
    assert.strictEqual(getConventionCollectiveCongesAncienneteBonus(salarie20ans, cpOuvrables, refDate), 0,
      'un type réglé en jours ouvrables ne doit jamais recevoir le bonus exprimé en jours ouvrés (éviter de mélanger les unités)');
  }

  console.log('OK — convention-collective-syntec.test.js (Article 5.1 Syntec : 4 paliers non cumulatifs, aucun effet hors Syntec)');
}

run().catch((err) => {
  console.error('ÉCHEC — convention-collective-syntec.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
