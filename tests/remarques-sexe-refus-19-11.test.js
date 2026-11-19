/**
 * Retour du 19/11/2026 (analyse complète) :
 *  - l'import des salariés reconnaît une colonne « Sexe » (ou Genre / Civilité) : une fiche importée n'est plus bloquée à la modification faute de ce champ obligatoire ;
 *  - l'historique d'un refus nomme qui a refusé, comme celui d'une validation.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

const api = loadAppJs();
api.sandbox.window.SupabaseSync = new Proxy({}, { get: (_, nom) => async () => (nom === 'assignMatriculeNumber' ? { success: true, number: 77 } : { success: true }) });
api.DB.init();

(async () => {
  // Lecture du sexe
  ['Homme', 'homme', 'H', 'M', 'M.', 'Mr', 'Monsieur', 'masculin'].forEach(v => assert.strictEqual(api.sexeImporte(v), 'Homme', v));
  ['Femme', 'F', 'Mme', 'Mlle', 'Madame', 'Féminin'].forEach(v => assert.strictEqual(api.sexeImporte(v), 'Femme', v));
  ['', null, undefined, 'autre', 'x'].forEach(v => assert.strictEqual(api.sexeImporte(v), '', String(v)));

  // Colonne reconnue, valeur reprise dans l'aperçu
  const entetes = ['Nom', 'Prénom', 'Email', "Date d'embauche", 'Sexe'];
  const mapping = api.guessEmployeeColumnMapping(entetes);
  assert.strictEqual(mapping.sexe, 4, 'la colonne Sexe est reconnue');
  const apercu = api.buildImportPreviewRows([['LEROY', 'Hugo', 'hugo.sexe@test.fr', '05/01/2026', 'M'], ['DURAND', 'Zoé', 'zoe.sexe@test.fr', '05/01/2026', '']], mapping, false);
  assert.strictEqual(apercu[0].record.sexe, 'Homme');
  assert.strictEqual(apercu[1].record.sexe, '');
  const civilite = api.guessEmployeeColumnMapping(['Nom', 'Prénom', 'Email', "Date d'embauche", 'Civilité']);
  assert.strictEqual(civilite.sexe, 4, 'une colonne Civilité (M./Mme) est lue comme le sexe');

  // Création : le sexe est bien porté par la fiche, et les fiches sans sexe sont comptées
  const resultat = await api.importEmployeesRows(apercu);
  assert.strictEqual(resultat.created, 2);
  assert.strictEqual(resultat.sansSexe, 1, 'une fiche créée sans sexe est signalée');
  const emp = api.DB.getEmployees().find(e => e.email === 'hugo.sexe@test.fr');
  assert.strictEqual(emp.sexe, 'Homme', 'le sexe du fichier est enregistré sur la fiche');

  // Refus : l'historique nomme l'auteur
  const demande = { historique: [{ action: 'Demande créée' }] };
  assert.strictEqual(api.refuseRequest(demande, 'Période chargée', 'Manager').historique.pop().action, 'Refusé (par Manager)');
  assert.strictEqual(api.refuseRequest(demande, 'x').historique.pop().action, 'Refusé', 'sans rôle fourni, la mention reste « Refusé »');
  const refus = api.refuseRequest(demande, 'Période chargée', 'RH');
  assert.strictEqual(refus.statut, 'Refusé');
  assert.strictEqual(refus.motifRefus, 'Période chargée');

  console.log('OK — remarques-sexe-refus-19-11.test.js');
})().catch(err => { console.error(err); process.exit(1); });
