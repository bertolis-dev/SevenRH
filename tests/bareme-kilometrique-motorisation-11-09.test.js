/**
 * Seven RH — retour Betty du 11/09/2026 (point 5, "ce qui reste ouvert de mes demandes
 * précédentes") : "Barème kilométrique rendu paramétrable par année/motorisation (majoration 20 %
 * électrique, barèmes deux-roues) — chantier à part mais à programmer, un salarié en voiture
 * électrique est aujourd'hui sous-payé." Ce fichier couvre : la non-régression du barème voiture
 * existant (mêmes valeurs qu'avant ce correctif), les seuils de distance distincts pour les
 * deux-roues (3000/6000 km au lieu de 5000/20000), la majoration de 20 % pour un véhicule
 * électrique, et le cumul annuel désormais suivi SÉPARÉMENT par motorisation (jamais mélangé entre
 * voiture et moto d'un même salarié).
 *
 * ⚠️ Les valeurs exactes du barème moto/cyclomoteur restent indicatives (voir le commentaire de
 * BAREMES_KILOMETRIQUES, data.js) — ces tests vérifient la STRUCTURE et le comportement du moteur
 * de calcul, jamais une conformité au barème officiel que je ne peux pas vérifier depuis ce
 * bac à sable.
 */
const assert = require('assert');
const { loadDataJs } = require('./load-data-js');

function run() {
  // ---- Non-régression : le barème voiture (par défaut, sans options) reste identique à avant ce
  // correctif — aucun salarié en voiture thermique ne doit voir son indemnité changer ----
  {
    const { calculateIndemniteKilometrique } = loadDataJs();
    // Valeurs de référence, calculées à la main avec l'ancien barème codé en dur (5 CV, tranche 1
    // jusqu'à 5000 km : 0.636/km).
    assert.strictEqual(calculateIndemniteKilometrique(1000, 5, 0), 636);
    assert.strictEqual(calculateIndemniteKilometrique(1000, 5, 0, {}), 636, 'un objet options vide doit se comporter comme son absence');
    assert.strictEqual(calculateIndemniteKilometrique(1000, 5, 0, { typeVehicule: 'voiture', electrique: false }), 636);
  }

  // ---- Structure du barème par motorisation ----
  {
    const { getBaremeKilometrique, getSeuilsKilometriques } = loadDataJs();
    assert.strictEqual(getBaremeKilometrique('voiture').length, 5, 'barème voiture : 5 tranches de puissance fiscale, comme avant ce correctif');
    assert.strictEqual(getBaremeKilometrique('moto').length, 3, 'barème moto : 3 tranches de puissance fiscale (1-2 CV / 3-5 CV / plus de 5 CV)');
    assert.strictEqual(getBaremeKilometrique('cyclomoteur').length, 1, 'barème cyclomoteur : une seule tranche, pas de puissance fiscale au sens habituel');
    assert.strictEqual(getBaremeKilometrique(), getBaremeKilometrique('voiture'), 'sans motorisation précisée, retombe sur voiture (compatibilité avec le comportement d\'avant ce correctif)');

    // Comparaison par JSON.stringify plutôt que deepStrictEqual : getSeuilsKilometriques tourne
    // dans le bac à sable vm (un autre realm) — deepStrictEqual compare aussi les prototypes, qui
    // diffèrent toujours entre deux realms différents même pour un objet de même forme.
    assert.strictEqual(JSON.stringify(getSeuilsKilometriques('voiture')), JSON.stringify({ seuil1: 5000, seuil2: 20000 }));
    assert.strictEqual(JSON.stringify(getSeuilsKilometriques('moto')), JSON.stringify({ seuil1: 3000, seuil2: 6000 }));
    assert.strictEqual(JSON.stringify(getSeuilsKilometriques('cyclomoteur')), JSON.stringify({ seuil1: 3000, seuil2: 6000 }), 'même seuils que moto : les deux-roues partagent la structure officielle 3000/6000 km, à la différence des voitures');
  }

  // ---- Les seuils distincts changent réellement le résultat : une même distance peut être dans la
  // tranche 1 pour une voiture mais déjà en tranche 2 pour une moto ----
  {
    const { calculateIndemniteKilometrique, getBaremeKilometrique } = loadDataJs();
    const cv = 3;
    const voitureTier = getBaremeKilometrique('voiture').find(t => cv <= t.cvMax);
    const motoTier = getBaremeKilometrique('moto').find(t => cv <= t.cvMax);

    const montantVoiture4000km = calculateIndemniteKilometrique(4000, cv, 0, { typeVehicule: 'voiture' });
    assert.strictEqual(montantVoiture4000km, Math.round(4000 * voitureTier.tranche1 * 100) / 100, '4000 km reste dans la tranche 1 pour une voiture (seuil à 5000 km)');

    const montantMoto4000km = calculateIndemniteKilometrique(4000, cv, 0, { typeVehicule: 'moto' });
    const attenduMoto = Math.round((4000 * motoTier.tranche2Coef + motoTier.tranche2Fixe) * 100) / 100;
    assert.strictEqual(montantMoto4000km, attenduMoto, '4000 km bascule déjà en tranche 2 pour une moto (seuil à 3000 km) — preuve que les seuils sont bien distincts, pas juste les valeurs');
  }

  // ---- Majoration véhicule électrique : +20 % sur le montant, jamais sur autre chose (arrondi
  // cohérent, pas de dérive) ----
  {
    const { calculateIndemniteKilometrique } = loadDataJs();
    const sansElectrique = calculateIndemniteKilometrique(2000, 5, 0);
    const avecElectrique = calculateIndemniteKilometrique(2000, 5, 0, { electrique: true });
    assert.strictEqual(avecElectrique, Math.round(sansElectrique * 1.2 * 100) / 100, 'la majoration électrique doit être exactement +20 %, jamais un autre taux');
    assert.ok(avecElectrique > sansElectrique, 'un salarié en véhicule électrique doit toujours être mieux indemnisé, jamais moins');
  }

  // ---- Cumul annuel scopé par motorisation : voiture et moto du même salarié ne doivent jamais se
  // mélanger dans le même compteur ----
  {
    const { getKilometrageDejaDeclareAnnee } = loadDataJs();
    const notes = [
      { id: 'nf-voiture', employeeId: 'e1', categorie: 'Kilométrique', date: '2026-03-01', statut: 'Remboursé', kilometrage: { distanceKm: 3000, typeVehicule: 'voiture' } },
      { id: 'nf-moto', employeeId: 'e1', categorie: 'Kilométrique', date: '2026-06-01', statut: 'Remboursé', kilometrage: { distanceKm: 2000, typeVehicule: 'moto' } },
      { id: 'nf-sans-type', employeeId: 'e1', categorie: 'Kilométrique', date: '2026-01-01', statut: 'Remboursé', kilometrage: { distanceKm: 500 } } // note saisie avant ce correctif, sans typeVehicule
    ];
    assert.strictEqual(getKilometrageDejaDeclareAnnee('e1', '2026-09-01', notes, null, 'voiture'), 3500, 'le cumul voiture doit inclure les anciennes notes sans typeVehicule (compatibilité : voiture par défaut), mais jamais le kilométrage moto');
    assert.strictEqual(getKilometrageDejaDeclareAnnee('e1', '2026-09-01', notes, null, 'moto'), 2000, 'le cumul moto ne doit jamais inclure le kilométrage voiture');
    assert.strictEqual(getKilometrageDejaDeclareAnnee('e1', '2026-09-01', notes, null), 3500, 'sans motorisation précisée, retombe sur voiture (compatibilité avec le comportement d\'avant ce correctif)');
  }

  // ---- Recalcul après refus : le cumul rejoué reste bien séparé par motorisation ----
  {
    const { calculateIndemniteKilometrique, recalculerIndemnitesKilometriquesAnnee } = loadDataJs();
    const cv = 5;
    const notes = [
      { id: 'nf-1', employeeId: 'e1', categorie: 'Kilométrique', date: '2026-03-01', dateCreation: '2026-03-01T09:00:00.000Z', statut: 'Remboursé', kilometrage: { distanceKm: 4000, puissanceFiscale: cv, typeVehicule: 'voiture' }, montantTTC: calculateIndemniteKilometrique(4000, cv, 0, { typeVehicule: 'voiture' }) },
      // Note MOTO refusée entre les deux notes voiture — ne doit avoir aucun effet sur leur cumul.
      { id: 'nf-moto', employeeId: 'e1', categorie: 'Kilométrique', date: '2026-05-01', dateCreation: '2026-05-01T09:00:00.000Z', statut: 'Refusé', kilometrage: { distanceKm: 9999, puissanceFiscale: cv, typeVehicule: 'moto' }, montantTTC: 0 },
      { id: 'nf-2', employeeId: 'e1', categorie: 'Kilométrique', date: '2026-06-01', dateCreation: '2026-06-01T09:00:00.000Z', statut: 'Remboursé', kilometrage: { distanceKm: 2000, puissanceFiscale: cv, typeVehicule: 'voiture' }, montantTTC: calculateIndemniteKilometrique(2000, cv, 4000, { typeVehicule: 'voiture' }) }
    ];
    const misesAJour = recalculerIndemnitesKilometriquesAnnee('e1', '2026', notes);
    assert.strictEqual(misesAJour.length, 0, 'la note moto refusée ne doit déclencher aucun recalcul sur les notes voiture (motorisations non mélangées)');
  }

  console.log('OK — bareme-kilometrique-motorisation-11-09.test.js (barème paramétrable par motorisation, majoration électrique +20%, cumul annuel séparé par motorisation)');
}

try {
  run();
} catch (err) {
  console.error('ÉCHEC — bareme-kilometrique-motorisation-11-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
