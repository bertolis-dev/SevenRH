/**
 * Seven RH — retour Betty du 19/09/2026 (point 7, "cinq suppressions sans confirmation") : "un
 * clic, c'est parti". Vérification par lecture du code source (même patron que
 * convention-collective-auto-18-09.test.js, runSuggestionJamaisAppliqueeAutomatiquement) plutôt que
 * par DOM réel : le bac à sable Node n'a pas de vraie modale à cliquer, mais on peut s'assurer que
 * chaque handler de clic passe bien par openConfirm({...}) avant d'appeler la suppression réelle,
 * plutôt que de l'appeler directement.
 *
 * Sur les 5 signalées, une (visite médicale) avait déjà sa confirmation avant cette lettre —
 * vérifié aussi ici pour non-régression, jamais retouché.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function extraireBloc(marqueurDebut, tailleMax = 1400) {
  const start = appSource.indexOf(marqueurDebut);
  assert.ok(start !== -1, `marqueur introuvable dans app.js : ${marqueurDebut}`);
  return appSource.slice(start, start + tailleMax);
}

async function runIndisponibiliteDemandeConfirmation() {
  const bloc = extraireBloc(`document.querySelectorAll('[data-delete-indisponibilite]')`);
  assert.ok(bloc.includes('openConfirm('), 'la suppression d\'une indisponibilité doit passer par openConfirm, jamais un clic direct');
  assert.ok(bloc.indexOf('employeeRepository.update(user.id, { indisponibilitesRecurrentes') > bloc.indexOf('onConfirm:'),
    'la mutation réelle doit se trouver DANS onConfirm, pas avant openConfirm(...) ni en dehors');

  console.log('OK — confirmations-suppressions-19-09.test.js (indisponibilité : confirmation ajoutée, mutation dans onConfirm)');
}

async function runDelegationDemandeConfirmation() {
  const bloc = extraireBloc(`document.querySelectorAll('[data-delete-delegation]')`);
  assert.ok(bloc.includes('openConfirm('), 'la suppression d\'une délégation doit passer par openConfirm, jamais un clic direct');
  assert.ok(bloc.indexOf('employeeRepository.update(user.id, { delegations') > bloc.indexOf('onConfirm:'),
    'la mutation réelle doit se trouver DANS onConfirm');
  assert.ok(bloc.includes('delegataire'), 'le message doit nommer la personne concernée quand elle est disponible, pas un "voulez-vous supprimer ?" muet');

  console.log('OK — confirmations-suppressions-19-09.test.js (délégation : confirmation ajoutée, message nominatif)');
}

async function runModeleSemaineDemandeConfirmation() {
  const bloc = extraireBloc(`document.querySelectorAll('[data-delete-modele-semaine]')`);
  assert.ok(bloc.includes('openConfirm('), 'la suppression d\'un modèle de semaine doit passer par openConfirm, jamais un clic direct');
  assert.ok(bloc.indexOf('weekTemplateRepository.delete(') > bloc.indexOf('onConfirm:'), 'la suppression réelle doit se trouver DANS onConfirm');

  console.log('OK — confirmations-suppressions-19-09.test.js (modèle de semaine : confirmation ajoutée)');
}

async function runTrameEntretienDemandeConfirmation() {
  const bloc = extraireBloc(`document.querySelectorAll('[data-delete-trame]')`);
  assert.ok(bloc.includes('openConfirm('), 'la suppression d\'une trame d\'entretien doit passer par openConfirm, jamais un clic direct');
  assert.ok(bloc.indexOf('entretienTrameRepository.delete(') > bloc.indexOf('onConfirm:'), 'la suppression réelle doit se trouver DANS onConfirm');

  console.log('OK — confirmations-suppressions-19-09.test.js (trame d\'entretien : confirmation ajoutée)');
}

async function runVisiteMedicaleAvaitDejaSaConfirmationEtRestInchangee() {
  // §non-régression : Betty l'a signalée dans sa liste des 5, mais deleteVisiteMedicale avait déjà
  // sa propre confirmation (retour du 17/09/2026) — vérifié pour m'assurer de ne jamais l'avoir
  // supprimée ou cassée par erreur en touchant les 4 autres.
  const bloc = extraireBloc(`function deleteVisiteMedicale(`, 1200);
  assert.ok(bloc.includes('openConfirm('), 'deleteVisiteMedicale doit toujours passer par openConfirm (déjà le cas avant cette lettre)');

  console.log('OK — confirmations-suppressions-19-09.test.js (visite médicale : confirmation déjà présente, non régressée)');
}

runIndisponibiliteDemandeConfirmation()
  .then(runDelegationDemandeConfirmation)
  .then(runModeleSemaineDemandeConfirmation)
  .then(runTrameEntretienDemandeConfirmation)
  .then(runVisiteMedicaleAvaitDejaSaConfirmationEtRestInchangee)
  .catch((err) => {
    console.error('ÉCHEC — confirmations-suppressions-19-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
