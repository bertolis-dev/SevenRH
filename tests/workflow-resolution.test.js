/**
 * Seven RH — teste le REPLI de resolveWorkflowWithFallback, pas la régression d'origine elle-même.
 *
 * §précision QA du 26/08/2026 (point C.1, retour exact) : la régression d'origine venait de
 * hasEligibleValidatorForStep qui lisait DB.getEmployees() — le cache local filtré par RLS de
 * L'APPELANT — pour décider si un valideur existait. Dans ce bac à sable Node (pas de RLS, données
 * de démo complètes), cette fonction aurait retourné le même résultat AVANT et APRÈS le correctif :
 * ce test n'aurait donc PAS attrapé le bug d'origine s'il avait existé à l'époque. Ce n'est pas
 * un défaut à corriger ici : hasEligibleValidatorForStep a été SUPPRIMÉE, la décision est maintenant
 * entièrement côté serveur (0037_workflow_resolution_serveur.sql) — le client ne PEUT plus calculer
 * cette éligibilité localement, donc la protection contre ce bug précis est désormais structurelle,
 * pas une propriété qu'un test JS pourrait vérifier sans dupliquer la sémantique RLS de Postgres
 * (ce qui dériverait silencieusement du vrai comportement serveur avec le temps).
 *
 * Ce que ce test protège réellement, et qui reste une vraie régression possible : si l'appel serveur
 * échoue pour n'importe quelle raison (hors ligne, fonction non déployée, erreur réseau), le circuit
 * de validation d'ORIGINE doit être conservé tel quel — jamais réduit à `[]` puis auto-validé/
 * auto-remboursé. Voir data.js:resolveWorkflowWithFallback.
 */
const assert = require('assert');
const { loadDataJs } = require('./load-data-js');

async function run() {
  const { sandbox, DB, CURRENT_COMPANY_KEY } = loadDataJs();

  // Simule l'échec de résolution serveur (hors ligne, fonction non déployée...) — c'est exactement
  // ce scénario qui, avant le correctif, faisait retomber le circuit sur `[]` puis le statut sur
  // 'Validé' (ou 'Remboursé' pour les notes de frais) au lieu de conserver le circuit d'origine.
  // Proxy plutôt qu'un objet explicite : data.js appelle des dizaines de window.SupabaseSync.pushX
  // en tâche de fond (voir _pushInBackground) — seules resolveWorkflowWithFallback/
  // resolveValidatorEmployeeIdsForStep nous intéressent ici, tout le reste doit juste réussir sans
  // rien faire (comme le ferait un vrai réseau qui répond).
  sandbox.window.SupabaseSync = new Proxy({
    async resolveWorkflowWithFallback() { throw new Error('mock : résolution serveur indisponible'); },
    async resolveValidatorEmployeeIdsForStep() { throw new Error('mock : résolution serveur indisponible'); },
  }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return async () => ({ success: true });
    },
  });

  DB.init();
  const company = DB.getCompanies()[0];
  sandbox.localStorage.setItem(CURRENT_COMPANY_KEY, company.id);

  const salarie = company.employees.find(e => e.role === 'salarie');
  const manager = company.employees.find(e => e.role === 'manager');
  const congesType = company.leaveTypes.find(t => t.nom === 'Congés payés');
  assert.ok(salarie && manager && congesType, 'jeu de données de démo incomplet (rôles ou type de congé manquants)');

  for (const [label, employee] of [['salarie', salarie], ['manager', manager]]) {
    DB._currentEmployeeId = employee.id;
    const request = await DB.addLeaveRequest({
      employeeId: employee.id, typeId: congesType.id, dateDebut: '2027-02-01', dateFin: '2027-02-02', nbJours: 2,
    });
    assert.strictEqual(request.statut, 'En attente',
      `[${label}] une demande de congé ne doit jamais s'auto-valider quand la résolution serveur échoue (obtenu : "${request.statut}")`);
    assert.ok(Array.isArray(request.workflow) && request.workflow.length > 0,
      `[${label}] le circuit de validation ne doit jamais être vidé silencieusement (obtenu : ${JSON.stringify(request.workflow)})`);
    assert.deepStrictEqual(request.workflow, congesType.workflow,
      `[${label}] en cas de doute, le circuit d'ORIGINE (celui du type) doit être conservé tel quel`);
  }

  // Même scénario côté notes de frais — c'était le cas le plus grave (statut 'Remboursé' au lieu
  // de 'Validé', un versement plutôt qu'une simple validation).
  DB._currentEmployeeId = salarie.id;
  const expense = await DB.addExpense({
    employeeId: salarie.id, categorie: 'Transport', libelle: 'Test non-régression', montant: 10,
    date: '2027-02-03', montantTTC: 10, tauxTVA: 20,
  });
  assert.strictEqual(expense.statut, 'En attente',
    `une note de frais ne doit jamais s'auto-rembourser quand la résolution serveur échoue (obtenu : "${expense.statut}")`);
  assert.ok(Array.isArray(expense.workflow) && expense.workflow.length > 0,
    `le circuit de validation d'une note de frais ne doit jamais être vidé silencieusement (obtenu : ${JSON.stringify(expense.workflow)})`);

  console.log('OK — workflow-resolution.test.js (salarié, manager, note de frais : aucune auto-validation)');
}

run().catch((err) => {
  console.error('ÉCHEC — workflow-resolution.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
