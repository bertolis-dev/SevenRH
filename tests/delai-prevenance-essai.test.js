/**
 * Seven RH — roadmap différenciation point #8 (01/09/2026) : "suivi automatique des fins de période
 * d'essai [...] avec les fenêtres de préavis légales calculées". Vérifie getDelaiPrevenanceFinEssai
 * contre les 4 paliers de l'article L1221-25 du Code du travail (vérifié sur Légifrance) :
 * 24h avant 8 jours de présence, 48h entre 8 jours et 1 mois, 2 semaines après 1 mois,
 * 1 mois après 3 mois — le délai se comptant TOUJOURS en amont de la date de fin prévue.
 */
const assert = require('assert');
const { loadDataJs } = require('./load-data-js');

async function run() {
  const { getDelaiPrevenanceFinEssai } = loadDataJs();

  // ---- Palier 1 : moins de 8 jours de présence -> 24 heures (ici : 1 jour avant la fin) ----
  {
    const r = getDelaiPrevenanceFinEssai({ dateEmbauche: '2027-01-01', dateFinPeriodeEssai: '2027-01-05' });
    assert.strictEqual(r.delaiLabel, '24 heures');
    assert.strictEqual(r.dateLimitePrevenance, '2027-01-04');
  }

  // ---- Palier 2 : entre 8 jours et 1 mois de présence -> 48 heures ----
  {
    const r = getDelaiPrevenanceFinEssai({ dateEmbauche: '2027-01-01', dateFinPeriodeEssai: '2027-01-20' });
    assert.strictEqual(r.delaiLabel, '48 heures');
    assert.strictEqual(r.dateLimitePrevenance, '2027-01-18');
  }

  // ---- Palier 3 : après 1 mois de présence (avant 3 mois) -> 2 semaines ----
  {
    const r = getDelaiPrevenanceFinEssai({ dateEmbauche: '2027-01-01', dateFinPeriodeEssai: '2027-02-15' });
    assert.strictEqual(r.delaiLabel, '2 semaines');
    assert.strictEqual(r.dateLimitePrevenance, '2027-02-01');
  }

  // ---- Palier 4 : après 3 mois de présence -> 1 mois calendaire (pas 30 jours plats) ----
  {
    const r = getDelaiPrevenanceFinEssai({ dateEmbauche: '2027-01-01', dateFinPeriodeEssai: '2027-05-01' });
    assert.strictEqual(r.delaiLabel, '1 mois');
    assert.strictEqual(r.dateLimitePrevenance, '2027-04-01');
  }

  // ---- 1 mois calendaire correct même sur un mois plus court (mars 31 -> fin février) ----
  {
    // Embauche le 31/12, fin d'essai le 31/03 (exactement 3 mois plus tard) : palier "après 3 mois"
    // atteint pile à la date de fin -> 1 mois calendaire, pas -30 jours.
    const r = getDelaiPrevenanceFinEssai({ dateEmbauche: '2026-12-31', dateFinPeriodeEssai: '2027-03-31' });
    assert.strictEqual(r.delaiLabel, '1 mois');
    assert.strictEqual(r.dateLimitePrevenance, '2027-02-28', 'un mois calendaire avant le 31 mars doit retomber sur le dernier jour de février, pas un simple -30 jours');
  }

  // ---- Cas dégénérés : pas de calcul possible ----
  {
    assert.strictEqual(getDelaiPrevenanceFinEssai({ dateEmbauche: '', dateFinPeriodeEssai: '2027-01-05' }), null, 'sans date d\'embauche, aucun calcul');
    assert.strictEqual(getDelaiPrevenanceFinEssai({ dateEmbauche: '2027-01-01', dateFinPeriodeEssai: '' }), null, 'sans date de fin d\'essai, aucun calcul');
    assert.strictEqual(getDelaiPrevenanceFinEssai({ dateEmbauche: '2027-01-05', dateFinPeriodeEssai: '2027-01-01' }), null, 'une fin antérieure au début est incohérente, aucun calcul');
  }

  console.log('OK — delai-prevenance-essai.test.js (4 paliers L1221-25 vérifiés + 1 mois calendaire + cas dégénérés)');
}

run().catch((err) => {
  console.error('ÉCHEC — delai-prevenance-essai.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
