/**
 * Seven RH — retour Betty du 19/09/2026 ("R7GLE CA", en réaction à un défaut signalé en marge du
 * point 1.1) : le formulaire "Modifier le salarié" échouait à s'enregistrer SANS AUCUN MESSAGE si un
 * champ obligatoire (ex. "Sexe", onglet Identité) était invalide dans un onglet NON actif — la
 * console affichait seulement "An invalid form control is not focusable", jamais un toast ni une
 * bascule d'onglet, jamais l'événement 'submit' (donc jamais submitEmployeeForm).
 *
 * Cause : un <fieldset hidden> n'exempte PAS ses champs de la validation native (checkValidity() les
 * compte bien comme invalides, voir updateEmployeeFormTabErrors), mais le navigateur échoue à
 * focaliser un champ non rendu une fois la validation refusée — cet échec de focalisation avorte
 * tout le processus avant même l'émission de 'submit'.
 *
 * Correctif : un clic sur le bouton type="submit" déclenche d'abord ce listener 'click' (posé AVANT
 * que le navigateur ne lance sa propre validation native pour ce même clic), qui bascule vers
 * l'onglet du premier champ requis invalide s'il est cencore caché — la validation native, qui
 * reprend la main juste après, réussit alors à focaliser le champ, désormais visible.
 *
 * Vérifié en direct dans un vrai navigateur (le bac à sable Node de ce fichier ne peut pas
 * reproduire la validation HTML5 native ni un vrai clic sur un bouton submit — limite déjà établie
 * dans cette session) : basculer sur l'onglet "Contrat & poste", laisser "Sexe" vide sur "Identité",
 * cliquer "Enregistrer" bascule bien automatiquement sur "Identité" (jamais d'échec silencieux), et
 * une fois le champ rempli, un second clic enregistre normalement et ferme la modale.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

async function runActivateEmployeeFormTabExtraiteEtReutilisee() {
  const fnStart = appSource.indexOf('function activateEmployeeFormTab(');
  assert.ok(fnStart !== -1, 'activateEmployeeFormTab doit exister : une fonction unique pour basculer d\'onglet par programme, réutilisée par le clic normal ET le nouveau garde-fou');
  const body = appSource.slice(fnStart, fnStart + 400);
  assert.ok(body.includes('data-employee-tab') && body.includes('data-employee-tab-panel'));

  const bindStart = appSource.indexOf('function bindEmployeeFormTabs()');
  const bindBody = appSource.slice(bindStart, bindStart + 600);
  assert.ok(bindBody.includes('activateEmployeeFormTab(btn.dataset.employeeTab)'), 'le clic normal sur un onglet doit réutiliser activateEmployeeFormTab, pas dupliquer la logique de bascule');

  console.log('OK — echec-silencieux-soumission-19-09.test.js (activateEmployeeFormTab : extraite, réutilisée par le clic normal sur un onglet)');
}

async function runClicSurSubmitBasculeVersLOngletDuChampInvalideCache() {
  const bindStart = appSource.indexOf('function bindEmployeeFormTabs()');
  const bindEnd = appSource.indexOf('\nfunction ', bindStart + 30);
  const body = appSource.slice(bindStart, bindEnd);

  assert.ok(body.includes(`querySelector('button[type="submit"]')`), 'doit cibler le bouton de soumission du formulaire employé');
  assert.ok(body.includes(`addEventListener('click'`), 'doit écouter le clic sur ce bouton (jamais "submit", qui ne se déclenche justement jamais dans le cas à corriger)');
  assert.ok(body.includes('checkValidity()'), 'doit détecter le premier champ requis invalide via checkValidity(), comme updateEmployeeFormTabErrors juste à côté');
  assert.ok(body.includes('closest(\'[data-employee-tab-panel]\')'), 'doit retrouver l\'onglet du champ invalide via son fieldset ancêtre');
  assert.ok(body.includes('panel.hidden') && body.includes('activateEmployeeFormTab('), 'doit basculer l\'onglet SEULEMENT si le champ invalide est actuellement cache, en réutilisant activateEmployeeFormTab');
  // Le nouveau listener 'click' lui-même ne doit jamais appeler evt.preventDefault() (sa callback ne
  // reçoit même pas l'événement) : c'est justement la validation native qui reprend la main juste
  // après ce clic qui doit focaliser le champ désormais visible, jamais interrompue ici.
  const submitClickStart = body.indexOf('if (submitBtn)');
  const submitClickBody = body.slice(submitClickStart);
  assert.ok(!/\.preventDefault\(\)/.test(submitClickBody), 'le nouveau listener sur le clic submit ne doit jamais appeler .preventDefault()');

  console.log('OK — echec-silencieux-soumission-19-09.test.js (clic sur "Enregistrer" bascule vers l\'onglet du champ requis invalide caché, sans empêcher la validation native)');
}

runActivateEmployeeFormTabExtraiteEtReutilisee()
  .then(runClicSurSubmitBasculeVersLOngletDuChampInvalideCache)
  .catch((err) => {
    console.error('ÉCHEC — echec-silencieux-soumission-19-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
