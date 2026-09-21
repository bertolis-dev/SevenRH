/**
 * Seven RH — teste le point 7.1 (retour QA du 25/08/2026, confirmé par l'expert-comptable le
 * 27/08/2026 : "mettre le minimum légal et que ce soit modifiable") : les durées par défaut des
 * congés pour événements familiaux doivent correspondre au minimum légal actuel (Art. L3142-4 du
 * Code du travail, version en vigueur au 27/08/2026 — vérifiée en direct sur Légifrance au moment du
 * correctif, jamais présumée de mémoire, cet article ayant été modifié en 2026), et rester modifiables
 * (déjà garanti : ce sont des leaveTypes normaux, éditables via l'écran Paramètres existant).
 */
const assert = require('assert');
const { loadDataJs } = require('./load-data-js');

function run() {
  const { seedLeaveTypes } = loadDataJs();
  const types = seedLeaveTypes();
  const byName = (nom) => types.find(t => t.nom === nom);

  const attendus = {
    'Mariage / PACS': 4,
    'Mariage d\'un enfant': 1,
    'Naissance / adoption': 3,
    'Décès': 3,
    'Décès d\'un enfant': 12,
    'Annonce de handicap ou maladie grave d\'un enfant': 10
  };

  Object.entries(attendus).forEach(([nom, jours]) => {
    const type = byName(nom);
    assert.ok(type, `le type "${nom}" doit exister dans le jeu de règles par défaut`);
    assert.strictEqual(type.nombreAnnuel, jours, `"${nom}" doit valoir le minimum légal (${jours} jours) — Art. L3142-4`);
    assert.strictEqual(type.categorie, 'autre');
  });

  // "Décès" (3j, proche) et "Décès d'un enfant" (12j) doivent être deux types DISTINCTS — une seule
  // valeur pour les deux masquerait une vraie différence légale (exactement le bug corrigé ici).
  assert.notStrictEqual(byName('Décès').id, byName('Décès d\'un enfant').id);

  // §retour Betty du 22/09/2026 (défaut 1.2, "les droits annuels sont affichés au prorata du temps
  // écoulé") : ces droits sont légalement ouverts en totalité dès le premier jour de la période,
  // jamais accumulés — natureAcquisition doit valoir 'ouverte' pour chacun (voir calculateAcquisition),
  // y compris Enfant malade et Formation, absents de la liste "attendus" ci-dessus (durées non issues
  // de l'Art. L3142-4) mais concernés par la même nature de droit.
  ['Mariage / PACS', 'Mariage d\'un enfant', 'Naissance / adoption', 'Décès', 'Décès d\'un enfant',
    'Annonce de handicap ou maladie grave d\'un enfant', 'Enfant malade', 'Formation', 'Exceptionnel'
  ].forEach(nom => {
    const type = byName(nom);
    assert.ok(type, `le type "${nom}" doit exister`);
    assert.strictEqual(type.natureAcquisition, 'ouverte', `"${nom}" doit être un droit ouvert d'emblée, jamais accumulé au prorata du temps écoulé`);
  });

  // Congés payés/RTT/Ancienneté restent 'progressive' (comportement historique, correct pour eux) :
  // ce correctif ne doit jamais s'étendre au-delà des 9 types concernés ci-dessus.
  ['Congés payés', 'RTT', 'Ancienneté'].forEach(nom => {
    assert.strictEqual(byName(nom).natureAcquisition, 'progressive', `"${nom}" doit rester à accumulation progressive`);
  });

  console.log('OK — evenements-familiaux-seed.test.js (minimum légal L3142-4, Décès/Décès d\'un enfant bien distincts, droits ouverts vs progressifs correctement répartis)');
}

try {
  run();
} catch (err) {
  console.error('ÉCHEC — evenements-familiaux-seed.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
