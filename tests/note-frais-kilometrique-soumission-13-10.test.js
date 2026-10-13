/**
 * Seven RH — revue du 13/10/2026 : l'envoi d'une note de frais KILOMÉTRIQUE levait une ReferenceError
 * (« Cannot access 'settings' before initialization ») : le barème d'entreprise (C1, 12/10) passait
 * `settings` avant la ligne `const settings = ...` de la même fonction. La note n'était jamais enregistrée et
 * rien n'apparaissait à l'écran. Ce test EXÉCUTE réellement submitExpenseForm (le test précédent ne vérifiait que
 * le texte du code source, ce qui ne pouvait pas détecter ce genre d'erreur).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

class FormDataFactice {
  constructor(cible) { this.valeurs = cible.__valeurs; }
  get(cle) { return cle in this.valeurs ? this.valeurs[cle] : null; }
}

async function run() {
  const api = loadAppJs();
  api.sandbox.FormData = FormDataFactice;
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  const rh = api.DB.getEmployees().find(e => e.role === 'rh');
  api.DB._currentEmployeeId = rh.id;

  const aujourdhui = new Date();
  const date = `${aujourdhui.getFullYear()}-${String(aujourdhui.getMonth() + 1).padStart(2, '0')}-01`;
  const avant = api.DB.getExpenses().length;
  api.state.pendingAttachment = { nom: 'justificatif.jpg', dataUrl: 'data:image/jpeg;base64,AAAA' };

  const evt = {
    preventDefault() {},
    target: {
      __valeurs: { employeeId: rh.id, categorie: 'Kilométrique', date, libelle: 'Trajet client Lyon', distanceKm: '120', typeVehicule: 'voiture', puissanceFiscale: '5', commentaire: '' },
      querySelector() { return null; }
    }
  };
  await api.sandbox.submitExpenseForm(evt);

  const apres = api.DB.getExpenses();
  assert.strictEqual(apres.length, avant + 1, 'la note kilométrique doit être enregistrée (avant le correctif : ReferenceError, aucune note créée)');
  const note = apres[apres.length - 1];
  assert.strictEqual(note.categorie, 'Kilométrique');
  assert.ok(note.montantTTC > 0, 'l\'indemnité est calculée par le barème');
  assert.strictEqual(note.libelle, 'Trajet client Lyon');
  console.log('OK — note-frais-kilometrique-soumission-13-10.test.js (envoi réel d\'une note kilométrique : enregistrée, indemnité calculée)');
}

run().catch(err => {
  console.error('ÉCHEC — note-frais-kilometrique-soumission-13-10.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
