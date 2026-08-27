/**
 * Seven RH — teste le point 7 (retour QA du 27/08/2026) : l'aide contextuelle ne couvrait que 11
 * écrans sur 19, avec un message "Aucune aide spécifique n'est disponible" qui "fait produit
 * inachevé" sur les autres. Le bouton d'aide se masque désormais quand aucun contenu n'existe pour
 * l'écran courant, et l'aide est indexée dans la recherche globale (tier 1 de sa proposition).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function run() {
  const { DB, sandbox, navigateTo, render, HELP_CONTENT } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;
  navigateTo('dashboard');
  render();

  // ---- Le bouton d'aide reste visible sur un écran couvert (dashboard, dans HELP_CONTENT) ----
  {
    const btn = sandbox.document.getElementById('btn-help');
    assert.notStrictEqual(btn.style.display, 'none', 'un écran avec du contenu d\'aide doit garder le bouton visible');
  }

  // ---- Tableau des compteurs (explicitement demandé, le plus difficile à interpréter) a bien du contenu ----
  {
    navigateTo('tableau-compteurs');
    render();
    const btn = sandbox.document.getElementById('btn-help');
    assert.notStrictEqual(btn.style.display, 'none', 'Tableau des compteurs doit désormais avoir une aide dédiée');
    assert.ok(HELP_CONTENT['tableau-compteurs'], 'HELP_CONTENT doit couvrir tableau-compteurs');
  }

  // ---- Les 6 écrans signalés comme sans aide en ont désormais une ----
  {
    ['mes-tickets', 'entretiens', 'idees', 'remuneration', 'embauche'].forEach(view => {
      assert.ok(HELP_CONTENT[view], `HELP_CONTENT doit couvrir "${view}" (signalé sans aide dans la lettre)`);
    });
  }

  // ---- Un écran sans contenu (vue de détail, ex. fiche salarié) masque le bouton plutôt que
  //      d'afficher "aucune aide disponible" ----
  {
    const employee = DB.getEmployees()[0];
    navigateTo('employee-detail', { currentEmployeeId: employee.id });
    render();
    const btn = sandbox.document.getElementById('btn-help');
    assert.strictEqual(btn.style.display, 'none', 'une vue de détail sans contenu d\'aide doit masquer le bouton, pas afficher un message vide');
  }

  console.log('OK — help-content-coverage.test.js (6 écrans complétés, bouton masqué sans contenu)');
}

run().catch((err) => {
  console.error('ÉCHEC — help-content-coverage.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
