/**
 * Seven RH — retour Betty du 17/09/2026 : captures d'écran réelles fournies pour Planning &
 * télétravail, Congés & absences, Notes de frais, Tickets restaurant, Pointeuse QR, Entretiens et
 * Embauche — remplacent la maquette factice (LANDING_FEATURES[].mock) affichée jusqu'ici pour les
 * modules qui n'avaient pas encore de vraie capture (voir renderMockCard, app.js), et les anciennes
 * captures obsolètes (congés/frais/tickets) pour les trois qui en avaient déjà une. Puis, suite à
 * "ce qu'il avais pas tu les crées" : 4 nouveaux modules (Calendrier, Congés à valider, Salariés,
 * Tableau des compteurs) ajoutés à la carte des fonctionnalités. Et "je veux que quand on clique sur
 * l'image on puisse la voir de plus proche" : chaque capture s'agrandit désormais au clic
 * (openScreenshotLightbox), sur tous les modules qui en ont une, anciens et nouveaux.
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

async function runNouveauxModulesCrees() {
  const { LANDING_FEATURES } = loadAppJs();
  const nouveaux = {
    'Calendrier': 'landing-feature-calendrier.png',
    'Congés à valider': 'landing-feature-conges-a-valider.png',
    'Salariés': 'landing-feature-salaries.png',
    'Tableau des compteurs': 'landing-feature-compteurs.png',
  };
  Object.entries(nouveaux).forEach(([title, filename]) => {
    const feature = LANDING_FEATURES.find(f => f.title === title);
    assert.ok(feature, `le nouveau module "${title}" doit exister dans LANDING_FEATURES (demande Betty du 17/09/2026 : "ce qu'il avais pas tu les crées")`);
    assert.strictEqual(feature.screenshot, filename);
    assert.ok(fs.existsSync(path.join(ROOT, filename)), `le fichier ${filename} doit exister à la racine du dépôt`);
    assert.ok(Array.isArray(feature.detail) && feature.detail.length > 0, `"${title}" doit avoir un contenu détaillé, pas une fiche vide`);
    assert.ok(Array.isArray(feature.howItWorks) && feature.howItWorks.length > 0, `"${title}" doit avoir un "Comment ça fonctionne"`);
    assert.ok(Array.isArray(feature.audience) && feature.audience.length > 0, `"${title}" doit avoir un "Qui l'utilise ?"`);
    assert.ok(feature.mock, `"${title}" doit garder une maquette de repli même avec une vraie capture`);
  });

  // Les nouveaux modules sont ajoutés à la FIN du tableau, jamais insérés au milieu — sinon les
  // index déjà référencés dans `related` par les modules existants pointeraient vers le mauvais module.
  const titles = LANDING_FEATURES.map(f => f.title);
  const dernierIndexAncien = titles.indexOf('Embauche');
  Object.keys(nouveaux).forEach(title => {
    assert.ok(titles.indexOf(title) > dernierIndexAncien, `"${title}" doit être après tous les modules déjà existants (ajout en fin de tableau, jamais au milieu)`);
  });

  console.log('OK — landing-feature-screenshots-17-09.test.js (4 nouveaux modules créés, ajoutés en fin de tableau)');
}

async function runImageAgrandissableAuClic() {
  const { sandbox, renderMockCard, openScreenshotLightbox, LANDING_FEATURES } = loadAppJs();
  const feature = LANDING_FEATURES.find(f => f.title === 'Planning & télétravail');
  const html = renderMockCard(feature);

  assert.ok(html.includes('data-lightbox="landing-feature-planning.png"'), 'l\'image doit porter data-lightbox pour être cliquable en grand (retour Betty : "voir de plus proche")');
  assert.ok(html.includes('landing-hero-screenshot-zoomable'), 'l\'image doit avoir un indice visuel (curseur zoom) qu\'elle est cliquable');

  openScreenshotLightbox('landing-feature-planning.png', 'Planning & télétravail dans Nexus');
  const modalHtml = sandbox.document.getElementById('modal-root').innerHTML;
  assert.ok(modalHtml.includes('class="lightbox-image"'), 'la vue agrandie doit afficher l\'image en grand');
  assert.ok(modalHtml.includes('src="landing-feature-planning.png"'), 'la vue agrandie doit pointer vers la même image');
  assert.ok(modalHtml.includes('id="btn-close-modal"'), 'la vue agrandie doit avoir un bouton pour fermer');

  console.log('OK — landing-feature-screenshots-17-09.test.js (image du module cliquable, ouvre la vue agrandie)');
}

runToutesLesFeaturesAttenduesOntUneCapture()
  .then(runAnciennesCapturesRemplaceesSupprimees)
  .then(runFeaturesSansNouvelleCaptureRestentInchangees)
  .then(runNouveauxModulesCrees)
  .then(runImageAgrandissableAuClic)
  .catch((err) => {
    console.error('ÉCHEC — landing-feature-screenshots-17-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
