/**
 * Seven RH — retour Betty du 14/09/2026 ("embauche tu peux augmenté") : les deux derniers points du
 * module Embauche écartés par choix de conception (feuille de route) — planification des créneaux
 * d'entretien et évaluation structurée des candidats. Limité au suivi CÔTÉ RH (aucun compte
 * candidat, aucune fonction Edge publique nouvelle) : voir 0056_candidature_creneaux_evaluations.sql.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function candidature(overrides) {
  return Object.assign({
    id: 'cand-1', nom: 'Martin', prenom: 'Julie', email: 'julie@example.com', telephone: '0601020304',
    postes: ['Développeur'], statut: 'entretien', dateSoumission: '2026-09-01', cvPath: null, lettrePath: null, lettreTexte: '',
    creneauxProposes: [], creneauChoisiId: null, evaluations: []
  }, overrides);
}

async function runCreneauxPropose() {
  const { buildCreneauPropose } = loadAppJs();
  const c = buildCreneauPropose('2026-09-20', '10:00', '11:00');
  assert.strictEqual(c.date, '2026-09-20');
  assert.strictEqual(c.heureDebut, '10:00');
  assert.strictEqual(c.heureFin, '11:00');
  assert.ok(c.id, 'un créneau doit avoir un identifiant');

  console.log('OK — embauche-creneaux-evaluation-14-09.test.js (buildCreneauPropose : forme correcte)');
}

async function runEvaluationEtMoyenne() {
  const { buildEvaluationRecord, computeEvaluationMoyenne, EVALUATION_CANDIDATURE_CRITERES } = loadAppJs();

  assert.strictEqual(EVALUATION_CANDIDATURE_CRITERES.length, 4);

  const criteres = [{ label: 'Compétences techniques', note: 4 }, { label: 'Communication', note: 2 }];
  const ev = buildEvaluationRecord('emp-1', 'Camille Lefèvre', criteres, '  Bon profil  ');
  assert.strictEqual(ev.evaluateurId, 'emp-1');
  assert.strictEqual(ev.evaluateurNom, 'Camille Lefèvre');
  assert.strictEqual(ev.commentaire, 'Bon profil', 'le commentaire doit être nettoyé des espaces superflus');
  assert.ok(ev.id && ev.date);

  assert.strictEqual(computeEvaluationMoyenne(ev), 3, '(4 + 2) / 2 = 3');

  // Un critère non noté (0) ne doit jamais faire baisser artificiellement la moyenne.
  const partielle = buildEvaluationRecord('emp-1', 'Camille Lefèvre', [{ label: 'A', note: 5 }, { label: 'B', note: 0 }], '');
  assert.strictEqual(computeEvaluationMoyenne(partielle), 5, 'un critère non renseigné ne doit jamais compter dans la moyenne');

  assert.strictEqual(computeEvaluationMoyenne({ criteres: [] }), null, 'aucune note : pas de moyenne, jamais 0 ou NaN');

  console.log('OK — embauche-creneaux-evaluation-14-09.test.js (évaluation : 4 critères fixes, moyenne ignore les critères non notés)');
}

async function runRepositoryAppels() {
  const { sandbox, candidatureRepository } = loadAppJs();
  const appels = [];
  sandbox.window.SupabaseSync = {
    setCandidatureData: async (id, patch) => { appels.push({ id, patch }); }
  };

  await candidatureRepository.proposerCreneaux('cand-1', [{ id: 'cr-1', date: '2026-09-20', heureDebut: '10:00', heureFin: '11:00' }]);
  assert.strictEqual(appels[0].id, 'cand-1');
  assert.deepStrictEqual(appels[0].patch.creneauxProposes, [{ id: 'cr-1', date: '2026-09-20', heureDebut: '10:00', heureFin: '11:00' }]);
  assert.strictEqual(appels[0].patch.creneauChoisiId, null, 'proposer de nouveaux créneaux doit toujours réinitialiser la confirmation précédente');

  await candidatureRepository.choisirCreneau('cand-1', 'cr-1');
  assert.strictEqual(appels[1].patch.creneauChoisiId, 'cr-1');
  assert.strictEqual(Object.keys(appels[1].patch).length, 1, 'choisirCreneau ne doit jamais toucher aux autres clés (fusion superficielle côté serveur)');

  await candidatureRepository.ajouterEvaluation('cand-1', [{ id: 'ev-1' }]);
  assert.deepStrictEqual(appels[2].patch.evaluations, [{ id: 'ev-1' }]);
  assert.strictEqual(Object.keys(appels[2].patch).length, 1);

  console.log('OK — embauche-creneaux-evaluation-14-09.test.js (candidatureRepository : appels corrects vers setCandidatureData, jamais de policy UPDATE directe)');
}

async function runEcranCreneaux() {
  const { renderCandidatureCreneauxCard } = loadAppJs();

  const vide = renderCandidatureCreneauxCard(candidature());
  assert.ok(vide.includes('Aucun créneau proposé'));
  assert.ok(vide.includes('+ Proposer des créneaux'));

  const avecCreneaux = renderCandidatureCreneauxCard(candidature({
    creneauxProposes: [
      { id: 'cr-1', date: '2026-09-20', heureDebut: '10:00', heureFin: '11:00' },
      { id: 'cr-2', date: '2026-09-21', heureDebut: '14:00', heureFin: '15:00' }
    ],
    creneauChoisiId: 'cr-1'
  }));
  assert.ok(avecCreneaux.includes('Confirmé par le candidat'), 'le créneau choisi doit être signalé');
  assert.ok(!avecCreneaux.includes('data-choisir-creneau="cr-1"'), 'un créneau déjà confirmé ne doit plus proposer de bouton "Marquer confirmé"');
  assert.ok(avecCreneaux.includes('data-choisir-creneau="cr-2"'), 'un créneau non confirmé doit garder son bouton');
  assert.ok(avecCreneaux.includes('Proposer d\'autres créneaux'), 'le libellé du bouton change une fois des créneaux déjà proposés');

  console.log('OK — embauche-creneaux-evaluation-14-09.test.js (écran créneaux : jamais vide de sens, un seul créneau confirmable à la fois)');
}

async function runEcranEvaluations() {
  const { renderCandidatureEvaluationsCard } = loadAppJs();

  const vide = renderCandidatureEvaluationsCard(candidature());
  assert.ok(vide.includes('Aucune évaluation'));

  const avecEvaluations = renderCandidatureEvaluationsCard(candidature({
    evaluations: [{ id: 'ev-1', evaluateurNom: 'Camille Lefèvre', date: '2026-09-14T10:00:00.000Z', criteres: [{ label: 'Communication', note: 4 }], commentaire: 'Très bon relationnel' }]
  }));
  assert.ok(avecEvaluations.includes('Camille Lefèvre'));
  assert.ok(avecEvaluations.includes('Communication : 4/5'));
  assert.ok(avecEvaluations.includes('Très bon relationnel'));
  assert.ok(avecEvaluations.includes('4/5'), 'la moyenne doit être affichée à côté de la date');

  console.log('OK — embauche-creneaux-evaluation-14-09.test.js (écran évaluations : jamais vide de sens, moyenne et commentaire affichés)');
}

runCreneauxPropose()
  .then(runEvaluationEtMoyenne)
  .then(runRepositoryAppels)
  .then(runEcranCreneaux)
  .then(runEcranEvaluations)
  .catch((err) => {
    console.error('ÉCHEC — embauche-creneaux-evaluation-14-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
