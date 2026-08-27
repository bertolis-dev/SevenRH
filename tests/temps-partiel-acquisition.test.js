/**
 * Seven RH — teste le point 2.4 (retour QA du 25/08/2026, confirmé par l'expert-comptable de
 * l'entreprise le 27/08/2026) : l'acquisition des congés payés ne doit JAMAIS être réduite au
 * pourcentage d'activité d'un temps partiel (seul le décompte à la consommation doit en tenir
 * compte, jamais l'acquisition) — et un temps partiel n'a droit à AUCUN RTT (pas "moins", zéro),
 * puisque les RTT compensent des heures au-delà de 35h/semaine qu'un temps partiel ne dépasse jamais.
 * Avant ce correctif, `calculateAcquisition` appliquait le même pourcentage d'activité à TOUS les
 * types de congés sans distinction — un salarié à 50% recevait la moitié des CP (sous-acquisition
 * silencieuse, non conforme) et une fraction de RTT (qui n'existent pas légalement pour ce profil).
 *
 * Les attentes ci-dessous comparent le résultat d'un temps partiel à celui d'un temps plein CALCULÉ
 * PAR LA MÊME FONCTION, plutôt que d'exiger un nombre de jours littéral — calculateAcquisition a sa
 * propre convention de comptage des mois (mois CALENDAIRES entre deux dates, pas "mois entamés"),
 * antérieure à ce correctif et hors de son périmètre ; comparer les deux profils entre eux teste
 * exactement l'invariant voulu (proratisation neutralisée / nulle) sans dépendre de cette convention.
 */
const assert = require('assert');
const { loadDataJs } = require('./load-data-js');

function run() {
  const { calculateAcquisition, resolveProratisationTempsPartiel, makeEmptyLeaveType } = loadDataJs();

  // ---- resolveProratisationTempsPartiel : inférence par nom quand le champ est absent ----
  {
    const cp = Object.assign(makeEmptyLeaveType(), { nom: 'Congés payés', proratisationTempsPartiel: undefined });
    const rtt = Object.assign(makeEmptyLeaveType(), { nom: 'RTT', proratisationTempsPartiel: undefined });
    const autre = Object.assign(makeEmptyLeaveType(), { nom: 'Ancienneté', proratisationTempsPartiel: undefined });
    assert.strictEqual(resolveProratisationTempsPartiel(cp), 'aucune');
    assert.strictEqual(resolveProratisationTempsPartiel(rtt), 'exclu');
    assert.strictEqual(resolveProratisationTempsPartiel(autre), 'proportionnelle');
  }

  // ---- Un choix explicite prévaut toujours sur l'inférence par nom ----
  {
    const rttReconfigure = Object.assign(makeEmptyLeaveType(), { nom: 'RTT', proratisationTempsPartiel: 'proportionnelle' });
    assert.strictEqual(resolveProratisationTempsPartiel(rttReconfigure), 'proportionnelle',
      'un réglage explicitement enregistré doit toujours l\'emporter sur l\'inférence par nom, même pour "RTT"');
  }

  // ---- CP (acquisition 'aucune') : un temps partiel à 50% acquiert AUTANT qu'un temps plein ----
  //      (proratisationTempsPartiel fixé explicitement ici — l'inférence par nom est déjà couverte
  //      par le bloc précédent ; calculateAcquisition doit juste RESPECTER la valeur résolue.)
  {
    const cp = Object.assign(makeEmptyLeaveType(), { nom: 'Congés payés', acquisition: 'Mensuelle', nombreAnnuel: 30, proratisationTempsPartiel: 'aucune' });
    const refDate = '2026-12-31';
    const tempsPlein = { dateEmbauche: '2020-01-01', pourcentageActivite: 100 };
    const tempsPartiel50 = { dateEmbauche: '2020-01-01', pourcentageActivite: 50 };
    const acquisPlein = calculateAcquisition(tempsPlein, cp, refDate);
    const acquisPartiel = calculateAcquisition(tempsPartiel50, cp, refDate);
    assert.ok(acquisPlein > 0, 'sanity : un temps plein embauché en 2020 doit acquérir des CP > 0 sur 2026');
    assert.strictEqual(acquisPartiel, acquisPlein, 'un temps partiel à 50% doit acquérir EXACTEMENT le même nombre de CP qu\'un temps plein');
  }

  // ---- RTT (acquisition 'exclu') : un temps partiel n'acquiert AUCUN RTT, un temps plein le reçoit normalement ----
  {
    const rtt = Object.assign(makeEmptyLeaveType(), { nom: 'RTT', acquisition: 'Mensuelle', nombreAnnuel: 12, proratisationTempsPartiel: 'exclu' });
    const refDate = '2026-12-31';
    const tempsPlein = { dateEmbauche: '2020-01-01', pourcentageActivite: 100 };
    const tempsPartiel80 = { dateEmbauche: '2020-01-01', pourcentageActivite: 80 };
    assert.ok(calculateAcquisition(tempsPlein, rtt, refDate) > 0, 'sanity : un temps plein doit acquérir des RTT > 0');
    assert.strictEqual(calculateAcquisition(tempsPartiel80, rtt, refDate), 0,
      'un temps partiel, même à 80%, ne doit acquérir AUCUN RTT — pas une réduction proportionnelle');
  }

  // ---- Un type SANS règle confirmée (ex. Ancienneté) garde le comportement historique proportionnel ----
  //      — pas de régression pour les types que l'expert-comptable n'a pas encore tranchés.
  {
    const anciennete = Object.assign(makeEmptyLeaveType(), { nom: 'Ancienneté', acquisition: 'Annuelle', nombreAnnuel: 4 });
    const refDate = '2026-12-31';
    const tempsPlein = { dateEmbauche: '2020-01-01', pourcentageActivite: 100 };
    const tempsPartiel50 = { dateEmbauche: '2020-01-01', pourcentageActivite: 50 };
    const acquisPlein = calculateAcquisition(tempsPlein, anciennete, refDate);
    const acquisPartiel = calculateAcquisition(tempsPartiel50, anciennete, refDate);
    assert.ok(acquisPlein > 0);
    assert.strictEqual(acquisPartiel, Math.round((acquisPlein / 2) * 100) / 100,
      'un type non couvert par la confirmation comptable (ni CP ni RTT) doit rester proratisé de moitié à 50%, comme avant');
  }

  // ---- La proratisation "aucune"/"exclu" ne casse jamais le prorata légitime d'entrée en cours d'année ----
  {
    const cp = Object.assign(makeEmptyLeaveType(), { nom: 'Congés payés', acquisition: 'Mensuelle', nombreAnnuel: 30, proratisationTempsPartiel: 'aucune' });
    const rtt = Object.assign(makeEmptyLeaveType(), { nom: 'RTT', acquisition: 'Mensuelle', nombreAnnuel: 12, proratisationTempsPartiel: 'exclu' });
    const refDate = '2026-12-31';
    // Même date d'embauche en cours d'année, seul le %% d'activité diffère entre les deux profils.
    const embaucheMiAnneePlein = { dateEmbauche: '2026-07-01', pourcentageActivite: 100 };
    const embaucheMiAnneePartiel = { dateEmbauche: '2026-07-01', pourcentageActivite: 50 };
    const cpPlein = calculateAcquisition(embaucheMiAnneePlein, cp, refDate);
    const cpPartiel = calculateAcquisition(embaucheMiAnneePartiel, cp, refDate);
    assert.ok(cpPlein > 0 && cpPlein < 30, 'sanity : une embauche mi-année doit acquérir moins que le plein annuel (prorata date d\'embauche toujours actif)');
    assert.strictEqual(cpPartiel, cpPlein, 'le prorata "date d\'embauche" doit rester identique entre les deux profils — seul le %% d\'activité est neutralisé pour les CP');
    assert.strictEqual(calculateAcquisition(embaucheMiAnneePartiel, rtt, refDate), 0, 'même embauché en cours d\'année, un temps partiel reste à 0 RTT');
  }

  // ---- Bout en bout : un type "legacy" (comme en production avant ce correctif — champ absent,
  //      simulé via `delete`) doit bénéficier de l'inférence par nom DANS calculateAcquisition lui-même,
  //      pas seulement dans resolveProratisationTempsPartiel testé isolément plus haut. ----
  {
    const cpLegacy = Object.assign(makeEmptyLeaveType(), { nom: 'Congés payés', acquisition: 'Mensuelle', nombreAnnuel: 30 });
    delete cpLegacy.proratisationTempsPartiel;
    const rttLegacy = Object.assign(makeEmptyLeaveType(), { nom: 'RTT', acquisition: 'Mensuelle', nombreAnnuel: 12 });
    delete rttLegacy.proratisationTempsPartiel;
    const refDate = '2026-12-31';
    const tempsPlein = { dateEmbauche: '2020-01-01', pourcentageActivite: 100 };
    const tempsPartiel50 = { dateEmbauche: '2020-01-01', pourcentageActivite: 50 };
    assert.strictEqual(calculateAcquisition(tempsPartiel50, cpLegacy, refDate), calculateAcquisition(tempsPlein, cpLegacy, refDate),
      'un type CP legacy (sans le champ, comme les données déjà en production) doit déjà bénéficier du correctif via l\'inférence par nom');
    assert.strictEqual(calculateAcquisition(tempsPartiel50, rttLegacy, refDate), 0,
      'un type RTT legacy (sans le champ) doit déjà exclure les temps partiels via l\'inférence par nom');
  }

  console.log('OK — temps-partiel-acquisition.test.js (CP jamais réduits, RTT exclus, autres types inchangés, prorata embauche préservé)');
}

try {
  run();
} catch (err) {
  console.error('ÉCHEC — temps-partiel-acquisition.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
