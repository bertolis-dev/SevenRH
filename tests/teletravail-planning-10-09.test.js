/**
 * Seven RH — retour Betty du 10/09/2026 : "fais le même planning pour le planning télétravail dans
 * congés et absences". Le planning télétravail (Congés & absences > Télétravail > Planning) reprend
 * désormais la STRUCTURE de la grille de quarts de Planning (renderPlanningPostes) : en-tête
 * "Prénom" triable, regroupement par SERVICE uniquement (plus de sous-groupe équipe), carte de
 * statut flottante (accent gauche, ombre, coins arrondis, voir .teletravail-planning-card,
 * style.css). Betty a explicitement choisi de GARDER les trois couleurs sémantiques par statut
 * (bureau/télétravail/congé) plutôt qu'une teinte unique comme sur la grille de quarts — seule la
 * FORME de la carte change ici, jamais sa couleur.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function run() {
  const { DB, sandbox, renderTeletravailPlanning, teleworkRepository, getWeekDates, toISODate, state } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;

  state.teletravailWeekOffset = 0;
  state.teletravailSortDir = 'asc';

  const html = renderTeletravailPlanning();
  // Structure reprise de la grille de quarts : en-tête triable, regroupement par service SEUL.
  assert.ok(html.includes('↕ Prénom (A-Z)'), 'l\'en-tête "Prénom" doit être triable, comme sur la grille de quarts');
  assert.ok(html.includes('teletravail-planning-card'), 'la carte du tableau doit porter la classe scopée qui donne la forme flottante (voir style.css)');
  // seedEmployees (data.js) place chaque salarié dans un service distinct (Direction, RH, IT,
  // Commercial, Comptabilité, Support client) — le service RH (Camille Lefèvre) doit apparaître
  // comme bandeau de groupe à lui seul, jamais mélangé à un sous-groupe "équipe".
  assert.ok(html.includes('>RH <span class="text-muted">(1)'), 'le bandeau de groupe doit être le SERVICE seul (plus de sous-groupe équipe)');
  assert.ok(!html.includes('class="planning-equipe-header"'), 'plus de sous-groupe équipe (groupEmployeesByService, pas groupEmployeesByServiceAndEquipe)');

  // Tri : inverser doit changer le libellé de l'en-tête.
  state.teletravailSortDir = 'desc';
  const htmlDesc = renderTeletravailPlanning();
  assert.ok(htmlDesc.includes('↕ Prénom (Z-A)'));
  state.teletravailSortDir = 'asc';

  // Couleurs par statut conservées (choix explicite de Betty, contrairement à la grille de quarts
  // qui n'a qu'une seule teinte pour tout) : un jour en télétravail garde sa classe sémantique
  // .planning-shift-remote (fond doré/marine clair), jamais une carte neutre comme sur la grille de
  // quarts.
  const employee = DB.getEmployees().find(e => e.id !== rh.id);
  const mardi = toISODate(getWeekDates(0)[1]);
  const teletravail = await teleworkRepository.create({ employeeId: employee.id, dateDebut: mardi, dateFin: mardi });
  teleworkRepository.update(teletravail.id, { statut: 'Validé' });
  const htmlAvecTeletravail = renderTeletravailPlanning();
  assert.ok(htmlAvecTeletravail.includes('planning-shift-remote'), 'un jour de télétravail doit garder sa couleur sémantique propre, pas la teinte unique de la grille de quarts');

  console.log('OK — teletravail-planning-10-09.test.js (structure de la grille de quarts, regroupement par service, en-tête triable, couleurs par statut conservées)');
}

run().catch((err) => {
  console.error('ÉCHEC — teletravail-planning-10-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
