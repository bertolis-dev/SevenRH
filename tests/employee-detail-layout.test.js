/**
 * Seven RH — "les cases quand on clique sur un salarié il y a des gros trou blanc" puis "fais un
 * panneau déroulant pour compteurs de congés" (retour QA du 27/08/2026). Deux correctifs :
 * - .detail-grid-cards (colonnes CSS façon Pinterest) remplace .detail-grid (grille à lignes de
 *   hauteur fixe) pour les grilles de VRAIES cartes .card, jamais pour une grille de champs.
 * - "Compteurs de congés" (potentiellement très long) est replié par défaut dans un <details>.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function run() {
  const { DB, sandbox, navigateTo, render } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;
  const employee = DB.getEmployees()[0];
  navigateTo('employee-detail', { currentEmployeeId: employee.id });
  render();
  const html = sandbox.document.getElementById('view-root').innerHTML;

  assert.ok(html.includes('detail-grid-cards'), 'la fiche salarié doit utiliser la grille de cartes en colonnes, pas la grille à lignes fixes');
  assert.ok(!/class="detail-grid"[^-]/.test(html), 'la fiche salarié ne doit plus utiliser la grille à lignes fixes (source de "gros trous blancs")');
  assert.ok(html.includes('<details class="collapsible-panel">'), 'le bloc Compteurs de congés doit être un panneau repliable');
  assert.ok(!/<details class="collapsible-panel"[^>]*\bopen\b/.test(html), 'le panneau des compteurs doit être replié par défaut, pas ouvert');
  assert.ok(html.includes('Voir le détail des compteurs'), 'le panneau doit avoir un intitulé explicite, pas juste une flèche');
  // Les boutons "Demander" doivent rester en dehors du <details> (toujours visibles, sans avoir à déplier).
  const beforeDetails = html.split('<details class="collapsible-panel">')[0];
  assert.ok(beforeDetails.includes('id="btn-request-leave"'), 'les boutons "Demander" doivent rester visibles sans déplier le panneau');

  console.log('OK — employee-detail-layout.test.js (grille en colonnes, compteurs de congés repliés par défaut)');
}

run().catch((err) => {
  console.error('ÉCHEC — employee-detail-layout.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
