/**
 * Seven RH — retour Betty du 16/09/2026 (légende du Calendrier entreprise) : "les couleurs [...]
 * mariage / PACS, mariage d'un enfant, décès, décès d'un enfant, annonce de handicap [...], enfant
 * malade, naissance / adoption [...] tu vas mettre dans exceptionnel" — regroupées sur la couleur
 * du type "Exceptionnel" déjà existant, une seule fois par entreprise (jamais réappliqué après un
 * choix de couleur refait depuis Paramètres > Types de congés).
 */
const assert = require('assert');
const { loadDataJs } = require('./load-data-js');

const NOMS_A_UNIFIER = ['Mariage / PACS', 'Mariage d\'un enfant', 'Décès', 'Décès d\'un enfant', 'Annonce de handicap ou maladie grave d\'un enfant', 'Enfant malade', 'Naissance / adoption'];

async function runUnificationCouleurs() {
  const { DB, sandbox } = loadDataJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const company = DB.getCurrentCompany();

  // Simule une entreprise déjà créée AVANT ce correctif : chaque type d'événement familial garde
  // encore son ancienne couleur distincte, "Exceptionnel" la sienne.
  company.leaveTypes.forEach(t => {
    if (NOMS_A_UNIFIER.includes(t.nom)) t.couleur = '#123456';
    if (t.nom === 'Exceptionnel') t.couleur = '#d97706';
  });
  DB.saveCurrentCompany(company);

  const types = DB.getLeaveTypes();
  const exceptionnel = types.find(t => t.nom === 'Exceptionnel');
  NOMS_A_UNIFIER.forEach(nom => {
    const type = types.find(t => t.nom === nom);
    assert.ok(type, `le type "${nom}" doit exister dans le jeu de démo`);
    assert.strictEqual(type.couleur, exceptionnel.couleur, `"${nom}" doit désormais partager la couleur d'"Exceptionnel"`);
  });
  // Les autres types (Congés payés, RTT, Maladie...) ne doivent JAMAIS être touchés par ce correctif.
  const cp = types.find(t => t.nom === 'Congés payés');
  assert.strictEqual(cp.couleur, '#2563eb', 'les types non listés ne doivent jamais être recolorés');

  console.log('OK — couleurs-evenements-familiaux-16-09.test.js (7 types d\'événements familiaux recolorés sur "Exceptionnel", les autres inchangés)');
}

async function runJamaisReapplique() {
  const { DB, sandbox } = loadDataJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();

  // Première lecture : déclenche le rattrapage.
  DB.getLeaveTypes();

  // Un utilisateur change ENSUITE volontairement la couleur d'un de ces types depuis Paramètres.
  const types = DB.getLeaveTypes();
  const deces = types.find(t => t.nom === 'Décès');
  DB.updateLeaveType(deces.id, { couleur: '#ff00ff' });

  // Une nouvelle lecture ne doit JAMAIS écraser ce choix redevenu volontairement différent.
  const apresModif = DB.getLeaveTypes();
  assert.strictEqual(apresModif.find(t => t.nom === 'Décès').couleur, '#ff00ff', 'un choix de couleur refait après le rattrapage ne doit jamais être réécrasé');

  console.log('OK — couleurs-evenements-familiaux-16-09.test.js (rattrapage une seule fois : un choix de couleur fait ensuite est respecté)');
}

runUnificationCouleurs()
  .then(runJamaisReapplique)
  .catch((err) => {
    console.error('ÉCHEC — couleurs-evenements-familiaux-16-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
