/**
 * Seven RH — retour Betty du 18/09/2026, point 7 ("impression des documents") :
 *   - le certificat de travail imprimait 6 pages identiques et vides : visibility:hidden (l'ancienne
 *     technique pour "n'imprimer que .print-area") laissait chaque élément cache occuper SA PLACE
 *     dans la mise en page, le navigateur paginait donc sur la hauteur du document ENTIER — corrigé
 *     par display:none (retire réellement du flux), vérifié manuellement dans le navigateur (une
 *     page blanche statique de test avec sidebar/topbar/modale factices, bascule "avant/après" :
 *     voir le commentaire de la règle @media print, style.css, non testable en Node) ;
 *   - en-tête commun aux 4 documents (logo, "Fait à..., le..." sur sa propre ligne, titre détaché,
 *     corps aéré, bloc signature), repris du modèle du registre ;
 *   - le certificat de travail n'apparaît plus que pour un DÉPART EFFECTIF (dateDepart), jamais pour
 *     dateFinContrat (propre aux seuls CDD/intérim) : "attestation employeur" le remplace sinon ;
 *   - "pour servir et valoir ce que de droit" ne doit plus jamais apparaître deux fois dans
 *     l'attestation employeur.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function setup() {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  const rh = api.DB.getEmployees().find(e => e.role === 'rh');
  api.DB._currentEmployeeId = rh.id;
  return api;
}

async function runEnTeteCommunAvecLogoLieuDateEtTitreDetache() {
  const { renderPrintDocumentHeader } = setup();
  const profil = { raisonSociale: 'Seven Sept', siret: '123 456 789 00012', adresse: '12 rue de la Paix, Paris', logo: 'data:image/png;base64,xyz' };
  const html = renderPrintDocumentHeader(profil, 'Attestation employeur');

  assert.ok(html.includes('print-logo'), 'le logo de l\'entreprise doit apparaître dans l\'en-tête quand il existe');
  assert.ok(html.includes('Seven Sept') && html.includes('SIRET 123 456 789 00012'), 'l\'identité de l\'entreprise doit être visible');
  assert.ok(/Fait à 12 rue de la Paix, Paris, le \d/.test(html), 'lieu et date doivent apparaître ensemble, sur leur propre ligne ("Fait à ..., le ...")');
  assert.ok(html.includes('print-title'), 'le titre doit être un élément détaché, plus jamais coincé dans le même bloc que le logo/la date (voir .print-header, style.css)');
  assert.ok(html.includes('>Attestation employeur<'), 'le titre doit reprendre le nom du document');

  console.log('OK — documents-impression-18-09.test.js (en-tête commun : logo, lieu/date sur leur ligne, titre détaché)');
}

async function runEnTeteSansLogoNiAdresseNePlanteJamais() {
  const { renderPrintDocumentHeader } = setup();
  const html = renderPrintDocumentHeader({}, 'Registre unique du personnel');
  assert.ok(!html.includes('print-logo'), 'sans logo renseigné, aucune balise image cassée');
  assert.ok(html.includes('Fait le') && !html.includes('Fait à ,'), 'sans adresse renseignée, jamais un "à" traînant sans lieu réel');

  console.log('OK — documents-impression-18-09.test.js (en-tête : robuste sans logo ni adresse renseignés)');
}

async function runAttestationEmployeurAucuneRepetition() {
  const { sandbox, openAttestationEmployeurModal, employeeRepository } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  openAttestationEmployeurModal(salarie.id);
  const html = sandbox.document.getElementById('modal-root').innerHTML;

  const occurrences = html.split('pour servir et valoir ce que de droit').length - 1;
  assert.strictEqual(occurrences, 1, '"pour servir et valoir ce que de droit" ne doit plus jamais apparaître deux fois dans le même document');
  assert.ok(html.includes('print-signature'), 'doit utiliser le bloc signature commun, pas une simple ligne de texte');

  console.log('OK — documents-impression-18-09.test.js (attestation employeur : plus de répétition de la formule finale)');
}

async function runCertificatTravailSeulementSurDepartEffectif() {
  const { sandbox, DB, renderEmployeeDetail, employeeRepository, openCertificatTravailModal } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');

  // CDD en cours, dateFinContrat renseignée (terme normal du contrat), mais AUCUN départ effectif
  // (dateDepart vide) : ne doit proposer QUE l'attestation employeur, jamais le certificat.
  employeeRepository.update(salarie.id, { typeContrat: 'CDD', dateFinContrat: '2026-12-31', dateDepart: '' });
  let html = renderEmployeeDetail(salarie.id);
  assert.ok(html.includes('id="btn-print-attestation">'), 'sans départ effectif (même avec une date de fin de CDD future), l\'attestation employeur doit rester proposée');
  assert.ok(!html.includes('id="btn-print-certificat-travail"'), 'sans départ effectif, le certificat de travail ne doit jamais être proposé (dateFinContrat n\'est pas un départ)');

  // Départ effectif renseigné : bascule vers le certificat de travail, plus d'attestation employeur.
  employeeRepository.update(salarie.id, { dateDepart: '2026-06-30', dateEmbauche: '2020-01-01' });
  html = renderEmployeeDetail(salarie.id);
  assert.ok(html.includes('id="btn-print-certificat-travail"'), 'un départ effectif (dateDepart renseignée) doit proposer le certificat de travail');
  assert.ok(!html.includes('id="btn-print-attestation">'), 'un départ effectif ne doit plus proposer l\'attestation employeur (période achevée, pas en cours)');

  const employeAJour = employeeRepository.getById(salarie.id);
  openCertificatTravailModal(employeAJour.id);
  const htmlCertificat = sandbox.document.getElementById('modal-root').innerHTML;
  assert.ok(htmlCertificat.includes('30/06/2026'), 'le certificat doit utiliser dateDepart comme date de sortie, jamais dateFinContrat');
  assert.ok(!htmlCertificat.includes('field-warning visible'), 'avec un départ effectif renseigné, aucun avertissement "toujours en poste" ne doit apparaître');

  console.log('OK — documents-impression-18-09.test.js (certificat de travail réservé à un départ effectif, jamais à dateFinContrat)');
}

async function runAucunDepartEffectifDeclencheLavertissement() {
  const { sandbox, employeeRepository, openCertificatTravailModal } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  employeeRepository.update(salarie.id, { dateDepart: '' });
  const employe = employeeRepository.getById(salarie.id);

  // Appelée directement (ex. lien externe) même sans départ effectif : doit rester utilisable,
  // mais avertir clairement plutôt que de générer un faux document.
  openCertificatTravailModal(employe.id);
  const html = sandbox.document.getElementById('modal-root').innerHTML;
  assert.ok(html.includes('field-warning visible'), 'sans départ effectif, un avertissement explicite doit apparaître si la modale est quand même ouverte');
  assert.ok(html.includes('____________________'), 'sans date de départ, le champ doit rester un espace à compléter à la main, jamais une date inventée');

  console.log('OK — documents-impression-18-09.test.js (certificat ouvert sans départ effectif : avertissement explicite, jamais une date inventée)');
}

runEnTeteCommunAvecLogoLieuDateEtTitreDetache()
  .then(runEnTeteSansLogoNiAdresseNePlanteJamais)
  .then(runAttestationEmployeurAucuneRepetition)
  .then(runCertificatTravailSeulementSurDepartEffectif)
  .then(runAucunDepartEffectifDeclencheLavertissement)
  .catch((err) => {
    console.error('ÉCHEC — documents-impression-18-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
