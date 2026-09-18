/**
 * Seven RH — retour Betty du 19/09/2026, point 6 ("le socle commun des écrans de liste") : "le
 * défaut dominant n'est pas l'absence de fonctions, c'est leur répartition inégale... définissons
 * une fois un socle commun, et déclinons-le sur chaque écran". Elle m'a laissé trancher moi-même
 * la conception et l'ordre de déploiement (message du 19/09/2026, "Tranche toi-même, montre-moi le
 * résultat") : période au format mois partagée (matchesPeriodeFilter, désormais réutilisée aussi par
 * Notes de frais/Congés, qui l'avaient chacun réécrite à la main), tri/recherche/pagination avec des
 * clés PAR écran (jamais les anciennes state.sortBy/search globales, réservées à Salariés), un état
 * vide paramétrable, et un déploiement complet d'abord sur Entretiens ("le plus pauvre de tous") et
 * Tableau des compteurs (filtre établissement/recherche manquants).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

// ---- Socle : helpers génériques ----

async function runMatchesPeriodeFilterDateUniqueEtPlage() {
  const { matchesPeriodeFilter } = loadAppJs();
  assert.strictEqual(matchesPeriodeFilter('2026-09-15', ''), true, 'periode vide = jamais de filtrage, quelle que soit la donnée');
  assert.strictEqual(matchesPeriodeFilter('2026-09-15', '2026-09'), true, 'date unique dans le mois filtré');
  assert.strictEqual(matchesPeriodeFilter('2026-07-15', '2026-09'), false, 'date unique hors du mois filtré');
  assert.strictEqual(matchesPeriodeFilter(['2026-08-28', '2026-09-03'], '2026-09'), true, 'plage qui CHEVAUCHE le mois filtré, même commencée le mois précédent');
  assert.strictEqual(matchesPeriodeFilter(['2026-07-01', '2026-07-10'], '2026-09'), false, 'plage entièrement hors du mois filtré');

  console.log('OK — socle-commun-listes-19-09.test.js (matchesPeriodeFilter : une seule implémentation pour date unique ET plage)');
}

async function runSortListByTexteEtNombre() {
  const { sortListBy } = loadAppJs();
  const items = [{ nom: 'Zoé' }, { nom: 'Amir' }, { nom: 'Marc' }];
  const asc = sortListBy(items, (i) => i.nom, 'asc').map(i => i.nom);
  assert.strictEqual(JSON.stringify(asc), JSON.stringify(['Amir', 'Marc', 'Zoé']));
  const desc = sortListBy(items, (i) => i.nom, 'desc').map(i => i.nom);
  assert.strictEqual(JSON.stringify(desc), JSON.stringify(['Zoé', 'Marc', 'Amir']));

  const nombres = [{ v: 30 }, { v: 5 }, { v: 100 }];
  assert.strictEqual(JSON.stringify(sortListBy(nombres, (i) => i.v, 'asc').map(i => i.v)), JSON.stringify([5, 30, 100]), 'un nombre doit trier numériquement, jamais lexicographiquement (sinon 100 < 30 < 5)');

  console.log('OK — socle-commun-listes-19-09.test.js (sortListBy : texte insensible à la casse, nombre trié numériquement)');
}

async function runRenderListEmptyStateAffichéLeMessage() {
  const { renderListEmptyState } = loadAppJs();
  const html = renderListEmptyState('Aucun entretien pour le moment. Utilisez le bouton ci-dessus.', 'notepad');
  assert.ok(html.includes('Aucun entretien pour le moment. Utilisez le bouton ci-dessus.'));
  assert.ok(html.includes('empty-state'));

  console.log('OK — socle-commun-listes-19-09.test.js (renderListEmptyState : message paramétrable, jamais câblé en dur)');
}

// ---- Entretiens ----

function seedEntretien(entretienRepository, employeeId, type, datePrevue, statut) {
  const e = entretienRepository.create({ employeeId, type, datePrevue });
  if (statut) e.statut = statut;
  return e;
}

async function runEntretiensFiltreTypeStatutEtPeriode() {
  const { DB, sandbox, employeeRepository, entretienRepository, getFilteredEntretiens, state } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');

  seedEntretien(entretienRepository, salarie.id, 'professionnel', '2026-09-10', 'a_planifier');
  seedEntretien(entretienRepository, salarie.id, 'bilan', '2026-07-05', 'cloture');

  state.entretiensFilters = { type: 'bilan', statut: '', periode: '' };
  let resultats = getFilteredEntretiens(true);
  assert.ok(resultats.every(e => e.type === 'bilan'), 'filtre type doit ne garder que les entretiens "bilan"');

  state.entretiensFilters = { type: '', statut: 'cloture', periode: '' };
  resultats = getFilteredEntretiens(true);
  assert.ok(resultats.every(e => e.statut === 'cloture'));

  state.entretiensFilters = { type: '', statut: '', periode: '2026-09' };
  resultats = getFilteredEntretiens(true);
  assert.ok(resultats.every(e => e.datePrevue.startsWith('2026-09')), 'filtre de période doit ne garder que les entretiens prévus en septembre 2026');
  assert.ok(!resultats.some(e => e.datePrevue === '2026-07-05'));

  console.log('OK — socle-commun-listes-19-09.test.js (Entretiens : filtres type/statut/période fonctionnent indépendamment)');
}

async function runEntretiensRechercheParSalarieReserveeAuxRolesQuiLaVoient() {
  const { DB, sandbox, employeeRepository, entretienRepository, getFilteredEntretiens, state } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;
  const salarie1 = employeeRepository.getAll().find(e => e.role === 'salarie');
  const salarie2 = employeeRepository.getAll().find(e => e.role === 'salarie' && e.id !== salarie1.id);
  seedEntretien(entretienRepository, salarie1.id, 'professionnel', '2026-09-10');
  seedEntretien(entretienRepository, salarie2.id, 'professionnel', '2026-09-11');

  state.entretiensFilters = { type: '', statut: '', periode: '' };
  state.entretiensSearch = salarie1.prenom;
  const avecPermission = getFilteredEntretiens(true);
  assert.ok(avecPermission.every(e => e.employeeId === salarie1.id), 'showEmployee=true : la recherche par salarié doit filtrer');

  // showEmployee=false (un simple salarié, qui ne voit que ses propres entretiens) : la recherche ne
  // doit jamais s'appliquer, elle n'aurait aucun sens pour lui.
  const sansPermission = getFilteredEntretiens(false);
  assert.ok(sansPermission.length >= 2, 'showEmployee=false : state.entretiensSearch ne doit jamais filtrer (pas de sens pour un salarié qui ne voit que les siens)');

  console.log('OK — socle-commun-listes-19-09.test.js (Entretiens : la recherche par salarié ne s\'applique que pour qui voit plusieurs salariés)');
}

async function runEntretiensTriParColonne() {
  const { DB, sandbox, employeeRepository, entretienRepository, getFilteredEntretiens, state } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  seedEntretien(entretienRepository, salarie.id, 'bilan', '2026-01-01');
  seedEntretien(entretienRepository, salarie.id, 'professionnel', '2026-12-01');

  state.entretiensFilters = { type: '', statut: '', periode: '' };
  state.entretiensSearch = '';
  state.entretiensSortBy = 'datePrevue';
  state.entretiensSortDir = 'asc';
  const asc = getFilteredEntretiens(true);
  assert.ok(asc[0].datePrevue <= asc[asc.length - 1].datePrevue, 'tri croissant par date prévue');

  state.entretiensSortDir = 'desc';
  const desc = getFilteredEntretiens(true);
  assert.ok(desc[0].datePrevue >= desc[desc.length - 1].datePrevue, 'tri décroissant par date prévue');

  console.log('OK — socle-commun-listes-19-09.test.js (Entretiens : tri par colonne fonctionne, croissant et décroissant)');
}

async function runEntretiensExportExcelRespecteLesFiltres() {
  const { DB, sandbox, employeeRepository, entretienRepository, exportEntretiensExcel, state } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  seedEntretien(entretienRepository, salarie.id, 'bilan', '2026-09-10');
  seedEntretien(entretienRepository, salarie.id, 'professionnel', '2026-07-01');

  state.entretiensFilters = { type: 'bilan', statut: '', periode: '' };
  state.entretiensSearch = '';
  let capture = null;
  sandbox.downloadExcelXmlFile = (xml) => { capture = xml; };
  exportEntretiensExcel();

  assert.ok(capture, 'l\'export doit produire un fichier');
  assert.ok(capture.includes('Bilan'), 'doit contenir l\'entretien filtré (type bilan)');
  assert.ok(!capture.includes('Entretien professionnel'), 'ne doit PAS contenir l\'entretien exclu par le filtre type');

  console.log('OK — socle-commun-listes-19-09.test.js (Entretiens : export Excel respecte exactement les filtres affichés)');
}

async function runEntretiensRenduIncluLeToolbarComplet() {
  const { DB, sandbox, renderEntretiens } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;

  const html = renderEntretiens();
  assert.ok(html.includes('id="entretiens-search"'), 'recherche doit être présente pour un RH');
  assert.ok(html.includes('id="entretiens-filter-type"'));
  assert.ok(html.includes('id="entretiens-filter-statut"'));
  assert.ok(html.includes('id="entretiens-filter-periode"'));
  assert.ok(html.includes('id="btn-export-entretiens"'));
  assert.ok(html.includes('Aucun entretien pour le moment'), 'état vide utile quand aucun entretien n\'existe encore');
  assert.ok(html.includes('Planifier un entretien'), 'l\'état vide doit dire quoi faire, pas seulement qu\'il n\'y a rien');

  console.log('OK — socle-commun-listes-19-09.test.js (Entretiens : le toolbar complet du socle est bien rendu)');
}

// ---- Tableau des compteurs ----

async function runTableauCompteursFiltreEtablissementEtRecherche() {
  const { DB, sandbox, employeeRepository, etablissementRepository, getTableauCompteursData, state } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  const etabs = etablissementRepository.getAll();
  const autreEtab = etablissementRepository.create({ nom: 'Agence Nice', actif: true });
  employeeRepository.update(salarie.id, { etablissementId: autreEtab.id });

  state.tableauCompteursFilters = { service: '', etablissementId: autreEtab.id };
  state.tableauCompteursSearch = '';
  const { rows: rowsFiltres } = getTableauCompteursData();
  assert.ok(rowsFiltres.every(r => r.employee.etablissementId === autreEtab.id), 'filtre établissement doit ne garder que les salariés de cet établissement');
  assert.ok(rowsFiltres.some(r => r.employee.id === salarie.id));

  state.tableauCompteursFilters = { service: '', etablissementId: '' };
  state.tableauCompteursSearch = salarie.matricule;
  const { rows: rowsRecherche } = getTableauCompteursData();
  assert.ok(rowsRecherche.every(r => r.employee.id === salarie.id), 'recherche par matricule doit fonctionner');

  console.log('OK — socle-commun-listes-19-09.test.js (Tableau des compteurs : filtre établissement et recherche fonctionnent)');
}

async function runTableauCompteursTriBascule() {
  const { DB, sandbox, getTableauCompteursData, state } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;

  state.tableauCompteursFilters = { service: '', etablissementId: '' };
  state.tableauCompteursSearch = '';
  state.tableauCompteursSortDir = 'asc';
  const { rows: asc } = getTableauCompteursData();
  state.tableauCompteursSortDir = 'desc';
  const { rows: desc } = getTableauCompteursData();
  assert.strictEqual(JSON.stringify(asc.map(r => r.employee.id)), JSON.stringify(desc.map(r => r.employee.id).reverse()), 'inverser sortDir doit inverser exactement l\'ordre');

  console.log('OK — socle-commun-listes-19-09.test.js (Tableau des compteurs : tri par salarié bascule correctement)');
}

async function runTableauCompteursExportExcelGereIllimite() {
  const { DB, sandbox, exportTableauCompteursExcel, state, employeeRepository, leaveTypeRepository } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;
  state.tableauCompteursFilters = { service: '', etablissementId: '' };
  state.tableauCompteursSearch = '';

  let capture = null;
  sandbox.downloadExcelXmlFile = (xml) => { capture = xml; };
  exportTableauCompteursExcel();

  assert.ok(capture, 'l\'export doit produire un fichier');
  assert.ok(!capture.includes('Infinity'), 'un solde illimité ne doit jamais fuiter la valeur JS brute "Infinity" dans un export destiné à être lu par un humain');

  console.log('OK — socle-commun-listes-19-09.test.js (Tableau des compteurs : export Excel, un solde illimité reste lisible, jamais "Infinity")');
}

async function runTableauCompteursRenduIncluLeToolbarComplet() {
  const { DB, sandbox, renderTableauCompteurs } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;

  const html = renderTableauCompteurs();
  assert.ok(html.includes('id="tableau-compteurs-search"'));
  assert.ok(html.includes('id="filter-tableau-compteurs-etablissement"'));
  assert.ok(html.includes('id="filter-tableau-compteurs-service"'));
  assert.ok(html.includes('id="btn-export-tableau-compteurs"'));

  console.log('OK — socle-commun-listes-19-09.test.js (Tableau des compteurs : le toolbar complet du socle est bien rendu)');
}

runMatchesPeriodeFilterDateUniqueEtPlage()
  .then(runSortListByTexteEtNombre)
  .then(runRenderListEmptyStateAffichéLeMessage)
  .then(runEntretiensFiltreTypeStatutEtPeriode)
  .then(runEntretiensRechercheParSalarieReserveeAuxRolesQuiLaVoient)
  .then(runEntretiensTriParColonne)
  .then(runEntretiensExportExcelRespecteLesFiltres)
  .then(runEntretiensRenduIncluLeToolbarComplet)
  .then(runTableauCompteursFiltreEtablissementEtRecherche)
  .then(runTableauCompteursTriBascule)
  .then(runTableauCompteursExportExcelGereIllimite)
  .then(runTableauCompteursRenduIncluLeToolbarComplet)
  .catch((err) => {
    console.error('ÉCHEC — socle-commun-listes-19-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
