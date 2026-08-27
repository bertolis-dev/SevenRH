/**
 * Seven RH — "il y a pas la case rôle du coup... quand je crée un salarié" (retour QA du 27/08/2026) :
 * makeEmptyEmployee() fixe role: 'salarie' par défaut, et rien dans le formulaire de création ne
 * permettait de le changer — chaque nouveau salarié devait être créé "Salarié" puis corrigé après
 * coup via "Changer le rôle" sur sa fiche, une étape facile à oublier (cause réelle trouvée dans ce
 * dossier : une salariée "Chargée RH" restée avec le rôle Salarié, "Poste" (texte libre) confondu
 * avec "Rôle" (le champ qui contrôle réellement les permissions)).
 *
 * Ce bac à sable Node n'a pas de vrai DOM (voir load-app-js.js) — document.getElementById renvoie
 * un stub, jamais de vrais <form>.elements après innerHTML. On vérifie donc directement le HTML
 * généré (présence/absence de name="role") plutôt que d'interagir avec un formulaire simulé —
 * même principe que les autres tests de ce fichier qui inspectent le HTML produit.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function run() {
  const { DB, sandbox, navigateTo, render } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;
  navigateTo('dashboard');
  render();

  sandbox.openEmployeeModal(null);
  const creationHtml = sandbox.document.getElementById('modal-root').innerHTML;
  assert.ok(creationHtml.includes('name="role"'),
    'le formulaire de CRÉATION doit exposer un champ "role" (un utilisateur avec gererUtilisateurs peut fixer le rôle dès la création)');
  assert.ok(!creationHtml.includes('value="proprietaire"'),
    'le rôle Propriétaire ne doit jamais être proposé ici (voir transfer_proprietaire, flux dédié)');
  ['value="rh"', 'value="manager"', 'value="comptabilite"', 'value="salarie"'].forEach(v =>
    assert.ok(creationHtml.includes(v), `option manquante dans le sélecteur de rôle : ${v}`));

  const created = await DB.addEmployee({ nom: 'Role', prenom: 'Test', email: 'test-role@example.com', dateEmbauche: '2026-08-27', role: 'rh' });
  assert.strictEqual(created.role, 'rh', 'le rôle transmis à la création doit être appliqué, pas silencieusement retombé sur "salarie"');

  // À l'ÉDITION, le champ ne doit jamais apparaître — le rôle reste modifiable uniquement via le
  // flux dédié "Changer le rôle" (garde-fous : trigger SQL, un seul Propriétaire...).
  sandbox.openEmployeeModal(created.id);
  const editHtml = sandbox.document.getElementById('modal-root').innerHTML;
  assert.ok(!editHtml.includes('name="role"'), 'le champ "role" ne doit jamais apparaître en édition, seulement à la création');

  console.log('OK — employee-creation-role.test.js (rôle choisi à la création, jamais exposé en édition)');
}

run().catch((err) => {
  console.error('ÉCHEC — employee-creation-role.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
