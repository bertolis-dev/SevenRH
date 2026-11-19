/**
 * Essai de bout en bout des imports (19/11/2026) :
 *  - un email saisi dans la colonne « Matricule » (ou un matricule dans « Email ») est reconnu au lieu d'être refusé (historique des absences ET soldes initiaux) ;
 *  - l'import des salariés dit POURQUOI la création a échoué (serveur injoignable, par exemple) au lieu d'afficher seulement « N erreurs ».
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

const api = loadAppJs();
api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
api.DB.init();
const { DB } = api;

(async () => {
  const salarie = DB.getEmployees().find(e => e.role === 'salarie');
  const cp = DB.getLeaveTypes().find(t => /congés payés/i.test(t.nom) && t.actif);

  // Historique des absences : colonne « Matricule » contenant un email
  const mapMatricule = api.guessAbsencesColumnMapping(['Matricule', 'Type', 'Date début', 'Date fin']);
  const parEmail = api.buildAbsencesPreviewRows([[salarie.email, cp.nom, '15/12/2026', '15/12/2026']], mapMatricule, 'conge')[0];
  assert.strictEqual(parEmail.status, 'ok', 'email dans la colonne Matricule : ' + parEmail.message);
  assert.strictEqual(parEmail.employee.id, salarie.id);
  // Colonne « Email » contenant un matricule
  const mapEmail = api.guessAbsencesColumnMapping(['Email', 'Type', 'Date début', 'Date fin']);
  const parMatricule = api.buildAbsencesPreviewRows([[salarie.matricule, cp.nom, '16/12/2026', '16/12/2026']], mapEmail, 'conge')[0];
  assert.strictEqual(parMatricule.status, 'ok', 'matricule dans la colonne Email : ' + parMatricule.message);
  // Un identifiant qui n'existe nulle part reste refusé
  const inconnu = api.buildAbsencesPreviewRows([['inconnu@x.fr', cp.nom, '17/12/2026', '17/12/2026']], mapMatricule, 'conge')[0];
  assert.strictEqual(inconnu.status, 'error');

  // Soldes initiaux
  const mapSoldes = api.guessSoldesColumnMapping(['Matricule', cp.nom], DB.getLeaveTypes());
  const soldes = api.buildSoldesPreviewRows([[salarie.email, '12,5']], mapSoldes, 'cible')[0];
  assert.strictEqual(soldes.status, 'ok', 'soldes : email dans la colonne Matricule : ' + soldes.message);

  // Import des salariés : la raison d'un échec est conservée
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: (_, nom) => async () => (nom === 'assignMatriculeNumber' ? { success: false, error: 'connexion au serveur requise' } : { success: true }) });
  const apercu = [{ status: 'ok', record: Object.assign(api.sandbox.makeEmptyEmployee ? api.sandbox.makeEmptyEmployee() : {}, { nom: 'TEST', prenom: 'Zoé', email: 'zoe.test@x.fr', dateEmbauche: '2026-01-05' }) }];
  const resultat = await api.importEmployeesRows(apercu);
  assert.strictEqual(resultat.created, 0);
  assert.strictEqual(resultat.errors, 1);
  assert.ok(/connexion au serveur requise/.test(resultat.premiereErreur), 'la raison est remontée : ' + resultat.premiereErreur);

  console.log('OK — imports-identifiant-croise-19-11.test.js');
})().catch(err => { console.error(err); process.exit(1); });
