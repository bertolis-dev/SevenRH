/**
 * Seven RH — retour Betty du 17/09/2026 : captures d'écran réelles fournies pour Planning &
 * télétravail, Congés & absences, Notes de frais, Tickets restaurant, Pointeuse QR, Entretiens et
 * Embauche — remplacent la maquette factice (LANDING_FEATURES[].mock) affichée jusqu'ici pour les
 * modules qui n'avaient pas encore de vraie capture (voir renderMockCard, app.js), et les anciennes
 * captures obsolètes (congés/frais/tickets) pour les trois qui en avaient déjà une.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAppJs } = require('./load-app-js');

const ROOT = path.join(__dirname, '..');

async function runToutesLesFeaturesAttenduesOntUneCapture() {
  const { LANDING_FEATURES } = loadAppJs();
  const attendues = {
    'Planning & télétravail': 'landing-feature-planning.png',
    'Congés & absences': 'landing-feature-conges.png',
    'Notes de frais': 'landing-feature-frais.png',
    'Tickets restaurant': 'landing-feature-tickets.png',
    'Pointeuse QR': 'landing-feature-pointeuse.png',
    'Entretiens': 'landing-feature-entretiens.png',
    'Embauche': 'landing-feature-embauche.png',
  };
  Object.entries(attendues).forEach(([title, filename]) => {
    const feature = LANDING_FEATURES.find(f => f.title === title);
    assert.ok(feature, `le module "${title}" doit exister dans LANDING_FEATURES`);
    assert.strictEqual(feature.screenshot, filename, `le module "${title}" doit référencer sa vraie capture ${filename}, plus la maquette factice`);
    assert.ok(fs.existsSync(path.join(ROOT, filename)), `le fichier ${filename} doit exister à la racine du dépôt (référencé par LANDING_FEATURES)`);
  });

  console.log('OK — landing-feature-screenshots-17-09.test.js (les 7 modules référencent leur vraie capture, présente sur le disque)');
}

async function runAnciennesCapturesRemplaceesSupprimees() {
  ['landing-feature-conges.jpg', 'landing-feature-frais.jpg', 'landing-feature-tickets.jpg'].forEach(filename => {
    assert.ok(!fs.existsSync(path.join(ROOT, filename)), `l'ancienne capture ${filename} doit être supprimée du dépôt, remplacée par la nouvelle`);
  });

  console.log('OK — landing-feature-screenshots-17-09.test.js (anciennes captures remplacées bien supprimées, pas juste orphelines)');
}

async function runFeaturesSansNouvelleCaptureRestentInchangees() {
  const { LANDING_FEATURES } = loadAppJs();
  const inchangees = {
    'Préparation de paie': 'landing-feature-paie.jpg',
    'Organigramme': 'landing-feature-organigramme.jpg',
    'Documents RH': 'landing-feature-documents.jpg',
    'Support intégré': 'landing-feature-support.jpg',
  };
  Object.entries(inchangees).forEach(([title, filename]) => {
    const feature = LANDING_FEATURES.find(f => f.title === title);
    assert.strictEqual(feature.screenshot, filename, `le module "${title}" n'a pas reçu de nouvelle capture, il doit garder ${filename}`);
    assert.ok(fs.existsSync(path.join(ROOT, filename)), `le fichier ${filename} doit toujours exister`);
  });
  // "Rémunération" n'a pas reçu de capture cette fois (Betty n'en a pas fourni) : garde sa maquette factice.
  const remuneration = LANDING_FEATURES.find(f => f.title === 'Rémunération');
  assert.ok(!remuneration.screenshot, 'Rémunération n\'a pas encore de vraie capture, doit garder sa maquette factice');

  console.log('OK — landing-feature-screenshots-17-09.test.js (modules non concernés par cet envoi inchangés)');
}

runToutesLesFeaturesAttenduesOntUneCapture()
  .then(runAnciennesCapturesRemplaceesSupprimees)
  .then(runFeaturesSansNouvelleCaptureRestentInchangees)
  .catch((err) => {
    console.error('ÉCHEC — landing-feature-screenshots-17-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
