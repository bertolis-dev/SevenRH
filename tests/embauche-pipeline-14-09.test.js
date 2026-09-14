/**
 * Seven RH — retour Betty du 14/09/2026 (revue concurrentielle, module Embauche, 8→16) :
 * suivi par étapes réel (point 1), page carrière publique (point 2), conformité/rétention des
 * candidatures (point 3), candidat → salarié sans ressaisie (point 4). Lecture automatique du CV
 * (OCR) et diffusion France Travail restent explicitement hors scope (crédits externes payants).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function candidature(overrides) {
  return Object.assign({
    id: 'cand-1', nom: 'Martin', prenom: 'Julie', email: 'julie@example.com', telephone: '0601020304',
    postes: ['Développeur'], statut: 'nouvelle', dateSoumission: '2026-09-01', cvPath: null, lettrePath: null, lettreTexte: ''
  }, overrides);
}

async function runPipelineEtapes() {
  const { CANDIDATURE_STATUT_LABELS, CANDIDATURE_STATUT_NEXT } = loadAppJs();

  // nouvelle → entretien → offre : de simples avancées de statut. offre n'a pas de "suivant" (les
  // seules transitions depuis offre sont Embaucher/Pas intéressé, jamais un simple avancement).
  assert.strictEqual(CANDIDATURE_STATUT_NEXT.nouvelle, 'entretien');
  assert.strictEqual(CANDIDATURE_STATUT_NEXT.entretien, 'offre');
  assert.strictEqual(CANDIDATURE_STATUT_NEXT.offre, undefined, 'offre est une étape sans avancement automatique');
  assert.strictEqual(CANDIDATURE_STATUT_NEXT.embauchee, undefined);
  assert.strictEqual(CANDIDATURE_STATUT_NEXT.archivee, undefined);
  assert.deepStrictEqual(Object.keys(CANDIDATURE_STATUT_LABELS), ['nouvelle', 'entretien', 'offre', 'embauchee', 'archivee']);

  console.log('OK — embauche-pipeline-14-09.test.js (pipeline : nouvelle → entretien → offre, jamais d\'avancement automatique vers embauchée/archivée)');
}

async function runBoardCandidatures() {
  const { renderCandidaturesBoard } = loadAppJs();

  const candidatures = [
    candidature({ id: 'c1', statut: 'nouvelle' }),
    candidature({ id: 'c2', nom: 'Durand', prenom: 'Marc', statut: 'entretien' }),
    candidature({ id: 'c3', nom: 'Petit', prenom: 'Léa', statut: 'offre' }),
    candidature({ id: 'c4', nom: 'Roux', prenom: 'Sam', statut: 'embauchee' }),
  ];

  const html = renderCandidaturesBoard(candidatures);
  assert.ok(html.includes('Martin'), 'chaque candidat doit apparaître dans le board');
  assert.ok(html.includes('data-avancer-candidature="c1"') && html.includes('data-next-statut="entretien"'), 'une candidature "nouvelle" doit proposer d\'avancer vers "entretien"');
  assert.ok(html.includes('data-avancer-candidature="c2"') && html.includes('data-next-statut="offre"'), 'une candidature "entretien" doit proposer d\'avancer vers "offre"');
  assert.ok(!html.includes('data-avancer-candidature="c3"'), 'une candidature "offre" ne doit proposer aucun bouton d\'avancement automatique');
  assert.ok(!html.includes('data-avancer-candidature="c4"'), 'une candidature déjà embauchée ne doit proposer aucun bouton d\'avancement');
  assert.strictEqual(renderCandidaturesBoard([]), '<p class="text-muted">Aucune candidature reçue pour le moment.</p>');

  console.log('OK — embauche-pipeline-14-09.test.js (board par étapes : bouton d\'avancement uniquement sur les étapes intermédiaires)');
}

async function runPrefillSansRessaisie() {
  const { candidatureToEmployeePrefill } = loadAppJs();

  const prefill = candidatureToEmployeePrefill(candidature({ postes: ['Développeur', 'Chef de projet'] }));
  assert.strictEqual(prefill.nom, 'Martin');
  assert.strictEqual(prefill.prenom, 'Julie');
  assert.strictEqual(prefill.email, 'julie@example.com');
  assert.strictEqual(prefill.telephone, '0601020304');
  assert.strictEqual(prefill.poste, 'Développeur', 'le premier poste souhaité doit pré-remplir le poste de la fiche salarié');

  const sansPoste = candidatureToEmployeePrefill(candidature({ postes: [] }));
  assert.strictEqual(sansPoste.poste, '', 'aucun poste souhaité ne doit jamais planter, juste laisser le champ vide');

  console.log('OK — embauche-pipeline-14-09.test.js (candidat → salarié sans ressaisie : identité + poste pré-remplis depuis la candidature)');
}

async function runPageCarriere() {
  // ---- Postes ouverts : chaque poste doit apparaître avec un lien de candidature ciblé ----
  {
    const { sandbox, renderCarrierePage } = loadAppJs();
    sandbox.window.SupabaseSync = {
      getCompanyPublicInfo: async () => ({ raisonSociale: 'Acme', logo: null, postesOuverts: [{ nom: 'Développeur', quantite: 2 }, { nom: 'Comptable', quantite: 1 }] })
    };
    await renderCarrierePage('company-1');
    const html = sandbox.document.getElementById('carriere-postes-list').innerHTML;
    assert.ok(html.includes('Développeur') && html.includes('Comptable'), 'les deux postes ouverts doivent apparaître');
    assert.ok(html.includes('?candidature=company-1&poste=D%C3%A9veloppeur'), 'le lien "Postuler" doit cibler le formulaire de candidature avec le poste présélectionné');
    assert.ok(sandbox.document.getElementById('carriere-postes-intro').textContent.includes('2 postes'));
  }

  // ---- Aucun poste ouvert : message honnête, jamais une page vide sans explication ----
  {
    const { sandbox, renderCarrierePage } = loadAppJs();
    sandbox.window.SupabaseSync = { getCompanyPublicInfo: async () => ({ raisonSociale: 'Acme', logo: null, postesOuverts: [] }) };
    await renderCarrierePage('company-1');
    assert.ok(sandbox.document.getElementById('carriere-postes-intro').textContent.includes('Aucun poste ouvert'));
  }

  // ---- Panne réseau : message d'erreur, jamais un plantage ----
  {
    const { sandbox, renderCarrierePage } = loadAppJs();
    sandbox.window.SupabaseSync = { getCompanyPublicInfo: async () => { throw new Error('réseau'); } };
    await renderCarrierePage('company-1');
    assert.ok(sandbox.document.getElementById('carriere-postes-intro').textContent.includes('Impossible'));
  }

  console.log('OK — embauche-pipeline-14-09.test.js (page carrière publique : liste les postes avec lien ciblé, message honnête si vide ou en panne)');
}

async function runLiensPublics() {
  const { candidatureUrlForCompany, carriereUrlForCompany } = loadAppJs();
  assert.strictEqual(candidatureUrlForCompany('acme'), 'https://nexus-rh.com/?candidature=acme');
  assert.strictEqual(carriereUrlForCompany('acme'), 'https://nexus-rh.com/?carriere=acme');

  console.log('OK — embauche-pipeline-14-09.test.js (lien de candidature directe et lien de page carrière distincts)');
}

async function runRetentionCandidatures() {
  const { DEFAULT_SETTINGS } = loadAppJs();
  assert.strictEqual(DEFAULT_SETTINGS.dureeConservationCandidaturesAnnees, 2, 'une durée de conservation par défaut doit exister pour les candidatures résolues (conformité RGPD)');

  console.log('OK — embauche-pipeline-14-09.test.js (conformité : durée de conservation des candidatures configurable, cohérente avec celle des salariés partis)');
}

async function runAvancerStatut() {
  const { sandbox, candidatureRepository } = loadAppJs();
  const appels = [];
  sandbox.window.SupabaseSync = {
    setCandidatureStatut: async (id, statut, employeeId) => { appels.push({ id, statut, employeeId }); }
  };
  await candidatureRepository.avancerStatut('cand-1', 'entretien');
  assert.strictEqual(appels.length, 1);
  assert.deepStrictEqual(appels[0], { id: 'cand-1', statut: 'entretien', employeeId: null }, 'avancerStatut ne doit jamais transmettre d\'employeeId (réservé à marquerEmbauchee)');

  console.log('OK — embauche-pipeline-14-09.test.js (avancement de statut : jamais employeeId en dehors de marquerEmbauchee)');
}

runPipelineEtapes()
  .then(runBoardCandidatures)
  .then(runPrefillSansRessaisie)
  .then(runPageCarriere)
  .then(runLiensPublics)
  .then(runRetentionCandidatures)
  .then(runAvancerStatut)
  .catch((err) => {
    console.error('ÉCHEC — embauche-pipeline-14-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
