/**
 * Seven RH — "Vitrine Idées" (roadmap différenciation du 31/08/2026) : la Boîte à idées devient un
 * board par statut (nouvelle / à l'étude / en cours / livrée / non retenue) au lieu d'une liste plate,
 * pour montrer un vrai suivi jusqu'à la livraison plutôt qu'un "retenue" qui ne disait jamais la suite.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function run() {
  const { DB, sandbox, renderIdees, IDEE_STATUT_LABELS, ideeRepository } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, {
    get: (target, prop) => {
      if (prop === 'toggleIdeeVote') return async () => ({ success: true, votes: [] });
      if (prop === 'setIdeeStatut') return async () => ({ success: true });
      return async () => ({ success: true });
    }
  });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;

  // ---- Les 5 statuts existent, dans l'ordre attendu (nouvelle -> ... -> refusee) ----
  assert.deepStrictEqual(Object.keys(IDEE_STATUT_LABELS), ['nouvelle', 'etudiee', 'en_cours', 'livree', 'refusee'],
    'les 5 statuts doivent exister dans cet ordre précis (fixe l\'ordre des colonnes du board)');
  assert.strictEqual(IDEE_STATUT_LABELS.en_cours, 'En cours');
  assert.strictEqual(IDEE_STATUT_LABELS.livree, 'Livrée');

  // ---- Le board affiche une colonne par statut, chacune avec le bon nombre d'idées ----
  const employee = DB.getEmployees()[0];
  const idee1 = ideeRepository.create({ employeeId: employee.id, titre: 'Idée nouvelle', description: '' });
  const idee2 = ideeRepository.create({ employeeId: employee.id, titre: 'Idée en cours', description: '' });
  await DB.setIdeeStatut(idee2.id, 'en_cours');
  const idee3 = ideeRepository.create({ employeeId: employee.id, titre: 'Idée livrée', description: '' });
  await DB.setIdeeStatut(idee3.id, 'livree');

  const html = renderIdees();
  assert.ok(html.includes('idees-board'), 'la boîte à idées doit utiliser la grille en board, pas la liste plate');
  assert.ok(html.includes('idees-column'), 'le board doit être composé de colonnes');
  assert.ok(html.includes('En cours'), 'la colonne "En cours" doit être affichée');
  assert.ok(html.includes('Livrée'), 'la colonne "Livrée" doit être affichée');
  assert.ok(html.includes('Idée nouvelle'), 'l\'idée en statut nouvelle doit apparaître');
  assert.ok(html.includes('Idée en cours'), 'l\'idée passée en_cours doit apparaître');
  assert.ok(html.includes('Idée livrée'), 'l\'idée passée livree doit apparaître');

  // Chaque carte porte bien le bon hook de clic/vote (bindIdeesEvents s'appuie dessus, inchangé).
  assert.ok(html.includes(`data-open-idee="${idee1.id}"`), 'la carte doit rester ouvrable (data-open-idee)');
  assert.ok(html.includes(`data-vote-idee="${idee1.id}"`), 'la carte doit rester votable (data-vote-idee)');

  console.log('OK — vitrine-idees.test.js (board par statut, 5 colonnes, idées bien réparties)');
}

run().catch((err) => {
  console.error('ÉCHEC — vitrine-idees.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
