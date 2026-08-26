/**
 * Seven RH — teste le point 6.7 (retour QA du 26/08/2026), volet contrôle d'accès :
 * isCurrentWorkflowStepFor (app.js) décide qui peut cliquer Valider/Refuser sur une demande — un
 * valideur nommé doit pouvoir agir MÊME SI son rôle réel ne correspond pas à l'étape programmée
 * (c'est tout le sens de la fonctionnalité), et à l'inverse quelqu'un qui a le bon rôle mais n'est
 * PAS dans la liste nommée ne doit plus pouvoir agir sur cette étape précise.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function run() {
  const { isCurrentWorkflowStepFor } = loadAppJs();

  // Rôle "rh" plutôt que "manager" pour les cas de base : évite la vérification supplémentaire
  // managerIds (isCurrentWorkflowStepFor va lire employeeRepository.getById, hors de propos ici —
  // ce test porte sur les valideurs nommés, pas sur la hiérarchie manager/salarié déjà couverte
  // par ailleurs) et n'a pas besoin d'un DB.init() pour rester correct.
  const managerUser = { id: 'mgr1', role: 'manager' };
  const rhUser = { id: 'rh1', role: 'rh' };
  const rhOnlyRequest = { workflow: ['rh'], etapeIndex: 0, employeeId: 'salarie1', workflowValidatorOverrides: {} };
  assert.strictEqual(isCurrentWorkflowStepFor(rhOnlyRequest, rhUser, 'absence'), true, 'sans override, un RH doit pouvoir agir sur une étape "rh"');
  assert.strictEqual(isCurrentWorkflowStepFor(rhOnlyRequest, managerUser, 'absence'), false, 'sans override, un manager ne doit pas pouvoir agir sur une étape "rh"');

  // Avec override : un salarié nommé, hors du schéma de rôles habituel, doit pouvoir agir.
  const namedRequest = { workflow: ['manager'], etapeIndex: 0, employeeId: 'salarie1', workflowValidatorOverrides: { '0': ['delegue1'] } };
  const delegueUser = { id: 'delegue1', role: 'salarie' }; // même un simple salarié, désigné nommément
  assert.strictEqual(isCurrentWorkflowStepFor(namedRequest, delegueUser, 'absence'), true,
    'un valideur nommé doit pouvoir agir même si son rôle réel ("salarie") ne correspond pas à l\'étape programmée ("manager")');

  // Avec override : quelqu'un qui a le "bon" rôle mais n'est PAS dans la liste nommée ne doit plus pouvoir agir.
  assert.strictEqual(isCurrentWorkflowStepFor(namedRequest, managerUser, 'absence'), false,
    'avec un override actif, avoir le rôle programmé ne suffit plus si on n\'est pas dans la liste nommée');

  // Override vide ([]) : doit se comporter comme "pas d'override" (retombe sur le rôle).
  const emptyOverrideRequest = { workflow: ['rh'], etapeIndex: 0, employeeId: 'salarie1', workflowValidatorOverrides: { '0': [] } };
  assert.strictEqual(isCurrentWorkflowStepFor(emptyOverrideRequest, rhUser, 'absence'), true,
    'un override vide (jamais configuré) doit retomber sur la résolution par rôle habituelle');

  // Télétravail/frais : workflowValidatorOverrides est toujours absent (jamais concernés par 6.7) —
  // ne doit jamais planter ni changer de comportement.
  // Rôle "rh" ici aussi (pas "manager") : cette assertion porte sur l'absence totale du champ
  // workflowValidatorOverrides, pas sur la hiérarchie manager/salarié (qui nécessiterait un
  // DB.init() pour résoudre employeeRepository.getById, hors sujet pour ce test).
  const teleworkRequest = { workflow: ['rh'], etapeIndex: 0, employeeId: 'salarie1' }; // pas de workflowValidatorOverrides du tout
  assert.strictEqual(isCurrentWorkflowStepFor(teleworkRequest, managerUser, 'absence'), false,
    'sans le champ workflowValidatorOverrides du tout (télétravail/frais), le comportement de base reste inchangé (un manager n\'agit pas sur une étape "rh")');

  console.log('OK — workflow-step-access.test.js (isCurrentWorkflowStepFor respecte les valideurs nommés)');
}

try {
  run();
} catch (err) {
  console.error('ÉCHEC — workflow-step-access.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
