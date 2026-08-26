/**
 * Seven RH — teste le point 6.7 (retour QA du 26/08/2026) : valideurs nommés par étape
 * (leaveType.workflowValidatorOverrides), qui remplacent la résolution par rôle pour l'étape
 * concernée. Cette logique retouche EXACTEMENT la fonction du point 1 (régression P0 du même jour) —
 * couverture volontairement large : une étape nominative ne doit jamais dépendre du serveur pour
 * savoir si elle est "éligible" (elle l'est toujours, par construction), et sa position d'origine
 * doit être préservée même quand des étapes par rôle voisines sont retirées par le serveur.
 *
 * Comparaison par JSON.stringify plutôt que assert.deepStrictEqual : les valeurs retournées sont
 * construites À L'INTÉRIEUR du contexte vm (autre "realm" JS que ce fichier de test) — deepStrictEqual
 * les considère "non référentiellement égales" même quand la structure est identique, un piège connu
 * du module vm plutôt qu'un vrai problème d'égalité.
 */
const assert = require('assert');
const { loadDataJs } = require('./load-data-js');

function assertJSONEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert.ok(a === e, `${message} — obtenu : ${a}, attendu : ${e}`);
}

function withMockedServer(sandbox, { workflowImpl, validatorIdsImpl, shouldNotBeCalled } = {}) {
  let workflowCalls = 0;
  let validatorCalls = 0;
  sandbox.window.SupabaseSync = {
    async resolveWorkflowWithFallback(employeeId, workflow, domain) {
      workflowCalls++;
      if (shouldNotBeCalled) throw new Error('resolveWorkflowWithFallback (serveur) ne devait PAS être appelé pour ce cas');
      return workflowImpl ? workflowImpl(workflow) : { success: true, workflow, escalated: false };
    },
    async resolveValidatorEmployeeIdsForStep(employeeId, role) {
      validatorCalls++;
      if (shouldNotBeCalled) throw new Error('resolveValidatorEmployeeIdsForStep (serveur) ne devait PAS être appelé pour ce cas');
      return validatorIdsImpl ? validatorIdsImpl(role) : { success: true, ids: [] };
    },
  };
  return { callCounts: () => ({ workflowCalls, validatorCalls }) };
}

async function run() {
  // ---- resolveWorkflowWithFallback ----
  {
    const { sandbox } = loadDataJs();
    const mock = withMockedServer(sandbox, { shouldNotBeCalled: true });
    const result = await sandbox.resolveWorkflowWithFallback('emp1', ['manager', 'rh'], 'absence', { '0': ['nomA'], '1': ['nomB'] });
    assertJSONEqual(result.workflow, ['manager', 'rh'], 'toutes les étapes nommées : le circuit d\'origine est conservé tel quel');
    assertJSONEqual(result.overrides, { '0': ['nomA'], '1': ['nomB'] }, 'les overrides doivent être renvoyés inchangés');
    assert.strictEqual(result.escalated, false);
    assert.strictEqual(mock.callCounts().workflowCalls, 0, 'aucune étape par rôle : le serveur ne doit jamais être appelé');
  }

  {
    // Étape 0 (manager) nommée, étape 1 (rh) par rôle et collapsée par le serveur (aucun RH actif,
    // hypothèse du test) — le résultat final doit garder UNIQUEMENT l'étape nommée, à sa position.
    const { sandbox } = loadDataJs();
    withMockedServer(sandbox, { workflowImpl: () => ({ success: true, workflow: [], escalated: true }) });
    const result = await sandbox.resolveWorkflowWithFallback('emp1', ['manager', 'rh'], 'absence', { '0': ['nomA'] });
    assertJSONEqual(result.workflow, ['manager'], 'l\'étape nommée doit survivre même si l\'étape par rôle voisine est retirée');
    assertJSONEqual(result.overrides, { '0': ['nomA'] }, 'l\'étape nommée doit garder son propre index après le retrait de l\'étape par rôle');
    assert.strictEqual(result.escalated, true, 'le circuit final diffère du circuit d\'origine : escalated doit être vrai');
  }

  {
    // Étape 0 (manager) nommée, étape 1 (rh) par rôle mais SANS AUCUN valideur possible côté serveur
    // (roleBasedRoles = ['rh'] devient []) — le serveur ajoute alors SA PROPRE escalade
    // ("proprietaire", un rôle absent de roleBasedRoles) pour ne jamais renvoyer un circuit
    // totalement vide. Cette escalade ne doit PAS survivre ici : l'étape nommée garantit déjà qu'il
    // existe un valideur, ajouter "proprietaire" en plus serait un doublon non voulu.
    const { sandbox } = loadDataJs();
    withMockedServer(sandbox, { workflowImpl: () => ({ success: true, workflow: ['proprietaire'], escalated: true }) });
    const result = await sandbox.resolveWorkflowWithFallback('emp1', ['manager', 'rh'], 'absence', { '0': ['nomA'] });
    assertJSONEqual(result.workflow, ['manager'], 'l\'escalade du serveur ne doit pas s\'ajouter quand une étape nommée couvre déjà le circuit');
  }

  {
    // Étape du MILIEU nommée, deux étapes par rôle autour, une des deux collapsée — vérifie que la
    // reconstruction positionnelle reste correcte dans un cas à 3 étapes, pas seulement 2.
    const { sandbox } = loadDataJs();
    withMockedServer(sandbox, { workflowImpl: (roles) => ({ success: true, workflow: roles.filter(r => r !== 'rh'), escalated: true }) });
    const result = await sandbox.resolveWorkflowWithFallback('emp1', ['manager', 'proprietaire', 'rh'], 'absence', { '1': ['nomB'] });
    assertJSONEqual(result.workflow, ['manager', 'proprietaire'], 'étape nommée au milieu + collapse de la dernière étape par rôle');
  }

  {
    // Panne serveur : même avec des overrides, le circuit d'ORIGINE complet doit être conservé —
    // c'est la garantie du point 1 (P0), qui doit continuer à s'appliquer à l'identique.
    const { sandbox } = loadDataJs();
    sandbox.window.SupabaseSync = { async resolveWorkflowWithFallback() { throw new Error('mock : indisponible'); } };
    const result = await sandbox.resolveWorkflowWithFallback('emp1', ['manager', 'rh'], 'absence', { '0': ['nomA'] });
    assertJSONEqual(result.workflow, ['manager', 'rh'], 'panne serveur : le circuit d\'origine complet doit être conservé, jamais réduit');
    assert.strictEqual(result.escalated, false);
  }

  // ---- resolveValidatorEmployeeIdsForStep ----
  {
    const { sandbox } = loadDataJs();
    const mock = withMockedServer(sandbox, { shouldNotBeCalled: true });
    const ids = await sandbox.resolveValidatorEmployeeIdsForStep('emp1', 'manager', ['nomA', 'nomB']);
    assertJSONEqual(ids, ['nomA', 'nomB'], 'une liste nommée non vide doit être retournée directement');
    assert.strictEqual(mock.callCounts().validatorCalls, 0, 'une liste nommée ne doit jamais déclencher d\'appel serveur');
  }
  {
    const { sandbox } = loadDataJs();
    withMockedServer(sandbox, { validatorIdsImpl: () => ({ success: true, ids: ['managerReel'] }) });
    const idsEmptyOverride = await sandbox.resolveValidatorEmployeeIdsForStep('emp1', 'manager', []);
    assertJSONEqual(idsEmptyOverride, ['managerReel'], 'un tableau vide (étape non nominative) doit retomber sur la résolution par rôle');
    const idsNoOverride = await sandbox.resolveValidatorEmployeeIdsForStep('emp1', 'manager', undefined);
    assertJSONEqual(idsNoOverride, ['managerReel'], 'undefined (télétravail/frais, jamais concernés) doit retomber sur la résolution par rôle');
  }

  console.log('OK — nominative-validators.test.js (resolveWorkflowWithFallback + resolveValidatorEmployeeIdsForStep, overrides)');
}

run().catch((err) => {
  console.error('ÉCHEC — nominative-validators.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
