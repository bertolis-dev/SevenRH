/**
 * Seven RH — retour Betty du 17/09/2026 ("il faut mettre quoi comme obligations légales") :
 * complète Mentions légales / CGU-CGV / Politique de confidentialité avec les points manquants les
 * plus significatifs pour un SIRH réel (adresses des hébergeurs, RCS, droit applicable, et surtout
 * le statut de sous-traitant RGPD de BERTOLIS sur les données des salariés des entreprises clientes).
 * Reste un brouillon sérieux, PAS un texte validé juridiquement (voir le commentaire au-dessus de
 * LEGAL_CONTENT, app.js) — ces tests vérifient seulement que les points identifiés comme manquants
 * sont bien présents, pas leur validité juridique.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function runMentionsLegalesCompletees() {
  const { LEGAL_CONTENT } = loadAppJs();
  const body = LEGAL_CONTENT.mentions.body;
  assert.ok(body.includes('RCS Meaux'), 'les mentions légales doivent indiquer le greffe RCS (Meaux, compétent pour Doue 77510)');
  assert.ok(body.includes('San Francisco'), 'l\'adresse de l\'hébergeur du site (GitHub, Inc.) doit être indiquée, pas juste son nom (LCEN art. 6-III)');
  assert.ok(body.includes('Supabase'), 'l\'hébergeur des données applicatives doit être nommé');
  assert.ok(body.includes('Propriété intellectuelle'), 'une mention de propriété intellectuelle sur le contenu du site doit être présente');

  console.log('OK — legal-content-completee-17-09.test.js (mentions légales : RCS, adresse hébergeur, propriété intellectuelle)');
}

async function runCguCgvCompletees() {
  const { LEGAL_CONTENT } = loadAppJs();
  const body = LEGAL_CONTENT.cgu.body;
  assert.ok(body.includes('droit français'), 'les CGU/CGV doivent préciser le droit applicable');
  assert.ok(body.toLowerCase().includes('responsabilité'), 'les CGU/CGV doivent aborder la limitation de responsabilité (disponibilité, force majeure)');
  assert.ok(body.includes('reste la propriété de BERTOLIS'), 'les CGU/CGV doivent préciser que le logiciel (pas les données du client) reste la propriété de BERTOLIS');

  console.log('OK — legal-content-completee-17-09.test.js (CGU/CGV : droit applicable, responsabilité, propriété du logiciel)');
}

async function runConfidentialiteCompletee() {
  const { LEGAL_CONTENT } = loadAppJs();
  const body = LEGAL_CONTENT.confidentialite.body;
  assert.ok(body.includes('sous-traitant'), 'la politique de confidentialité doit préciser que BERTOLIS est SOUS-TRAITANT (pas responsable de traitement) pour les données des salariés d\'une entreprise cliente — point RGPD le plus significatif identifié');
  assert.ok(body.includes('article 9 du RGPD') || body.includes("article 9"), 'les arrêts de travail (donnée de santé) doivent être signalés comme catégorie particulière au sens de l\'article 9 du RGPD');
  assert.ok(body.includes('CNIL'), 'le droit de réclamation auprès de la CNIL doit être mentionné, pas seulement l\'export de données');
  assert.ok(body.toLowerCase().includes('portabilité') && body.toLowerCase().includes('opposition'), 'la liste complète des droits RGPD doit être présente (accès/rectification/effacement/limitation/opposition/portabilité), pas seulement l\'export');
  assert.ok(body.includes('Cookies'), 'la politique doit préciser explicitement la position sur les cookies (aucun cookie de mesure d\'audience/publicité)');

  console.log('OK — legal-content-completee-17-09.test.js (confidentialité : statut sous-traitant RGPD, donnée de santé, droits complets, cookies)');
}

runMentionsLegalesCompletees()
  .then(runCguCgvCompletees)
  .then(runConfidentialiteCompletee)
  .catch((err) => {
    console.error('ÉCHEC — legal-content-completee-17-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
