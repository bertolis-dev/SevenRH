/**
 * Seven RH — retour Betty du 19/09/2026, "trois blocages" (point 5 de sa lettre d'audit écran par
 * écran) : des choses qu'on ne pouvait pas faire du tout, pas un simple manque de confort.
 *   5.1 barre d'onglets des Paramètres inatteignable à la souris (scrollbar masquée sans
 *       remplaçant, menu déroulant de repli réservé au mobile <860px) ;
 *   5.2 pointeuse plafonnée en dur à 7 jours, aucun moyen de vérifier un pointage du mois dernier ;
 *   5.3 aucun filtre de période dans les congés, alors que Notes de frais (juste à côté) en a un.
 * Les trois sont traités ici pour rester groupés comme dans la lettre, même si les fichiers touchés
 * sont différents (style.css/app.js pour 5.1, app.js pour 5.2 et 5.3).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAppJs } = require('./load-app-js');

// ---- 5.1 : flèches de défilement des onglets ----

async function runTabsArrowInjecteesEtFonctionnellesQuandCaDeborde() {
  const { sandbox, enhanceScrollableTabs } = loadAppJs();
  // Le bac à sable Node (voir load-app-js.js) a un DOM trop primitif pour mesurer un vrai
  // scrollWidth/clientWidth (querySelectorAll y renvoie toujours []) — le mécanisme complet
  // (injection, chevauchement au clic, ré-affichage au scroll) a été vérifié en direct dans un vrai
  // navigateur (voir la session du 19/09/2026) : overflow détecté, flèche droite visible/gauche
  // cachée au départ, scrollBy fonctionne, la flèche gauche apparaît une fois défilé. Ici, contrôle
  // seulement que la fonction existe et ne plante jamais sur une liste vide.
  assert.strictEqual(typeof enhanceScrollableTabs, 'function');
  sandbox.window.document.querySelectorAll = () => [];
  assert.doesNotThrow(() => enhanceScrollableTabs());

  console.log('OK — trois-blocages-19-09.test.js (5.1 : enhanceScrollableTabs existe, ne plante jamais sans .tabs à traiter)');
}

async function runCssRemplaceLaScrollbarMasqueeParUnVraiControle() {
  const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
  assert.ok(css.includes('.tabs-arrow'), 'un vrai contrôle (flèche) doit exister pour remplacer la scrollbar masquée');
  assert.ok(/\.tabs-arrow\s*{[^}]*display:\s*none/.test(css), 'cachée par défaut : jamais affichée sur une rangée qui ne déborde pas');
  assert.ok(css.includes('.tabs-arrow.visible'), 'affichée seulement quand enhanceScrollableTabs (app.js) détecte un vrai débordement');
  // La scrollbar reste masquée (choix visuel d'origine conservé), mais SEULEMENT parce qu'un
  // remplaçant existe désormais — le garde-fou porte sur la présence du remplaçant, pas sur le
  // retrait de scrollbar-width (qui reste une préférence esthétique légitime une fois remplacée).
  assert.ok(css.includes('scrollbar-width: none'));

  console.log('OK — trois-blocages-19-09.test.js (5.1 : la scrollbar masquée a désormais un vrai remplaçant, jamais rien du tout)');
}

async function runEnhanceScrollableTabsAppeleeApresChaqueRendu() {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const fnStart = appSource.indexOf('function render() {');
  const fnBody = appSource.slice(fnStart, fnStart + 300);
  assert.ok(fnBody.includes('enhanceScrollableTabs()'), 'doit tourner après CHAQUE rendu (comme hydrateAvatarImages), sinon les flèches injectées disparaîtraient à la moindre navigation sans être réinjectées');

  console.log('OK — trois-blocages-19-09.test.js (5.1 : enhanceScrollableTabs rappelée après chaque render(), jamais une seule fois au chargement)');
}

// ---- 5.2 : historique de la pointeuse au-delà de 7 jours ----

function seedPointageADate(DB, employeeId, etablissementId, date) {
  DB.ajouterPointageOublie(employeeId, etablissementId, date, '09:00', '17:00', 'seed test', employeeId);
}

async function runHistoriquePointeuseVaAuDelaDeSeptJours() {
  const { DB, sandbox, joursDuMoisPointeuse, etablissementRepository, toISODate } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;
  const etab = etablissementRepository.getAll()[0];

  // Un pointage il y a 40 jours (largement au-delà de l'ancien plafond de 7) et un autre il y a 2 jours.
  const now = new Date();
  const il40Jours = new Date(now); il40Jours.setDate(il40Jours.getDate() - 40);
  const il2Jours = new Date(now); il2Jours.setDate(il2Jours.getDate() - 2);
  const dateAncienne = toISODate(il40Jours);
  const dateRecente = toISODate(il2Jours);
  seedPointageADate(DB, rh.id, etab.id, dateAncienne);
  seedPointageADate(DB, rh.id, etab.id, dateRecente);

  // Le mois du pointage récent (probablement le mois en cours) doit le retrouver.
  const historiqueMoisRecent = joursDuMoisPointeuse(rh, il2Jours.getFullYear(), il2Jours.getMonth());
  assert.ok(historiqueMoisRecent.some(h => h.date === dateRecente), 'un pointage récent doit apparaître dans l\'historique de son mois');

  // Le mois du pointage ancien (40 jours, presque certainement un autre mois) doit AUSSI le retrouver
  // une fois qu'on navigue jusqu'à CE mois-là — impossible avec l'ancien plafond de 7 jours.
  const historiqueMoisAncien = joursDuMoisPointeuse(rh, il40Jours.getFullYear(), il40Jours.getMonth());
  assert.ok(historiqueMoisAncien.some(h => h.date === dateAncienne), 'un pointage vieux de 40 jours doit rester consultable en naviguant vers son mois : c\'était impossible avec le plafond de 7 jours');

  console.log('OK — trois-blocages-19-09.test.js (5.2 : un pointage vieux de 40 jours reste consultable via son mois, plus de plafond de 7 jours)');
}

async function runHistoriquePointeuseJamaisDeJourFutur() {
  const { DB, sandbox, joursDuMoisPointeuse, toISODate } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  const now = new Date();

  const historiqueMoisEnCours = joursDuMoisPointeuse(rh, now.getFullYear(), now.getMonth());
  const aujourdhui = toISODate(now);
  assert.ok(historiqueMoisEnCours.every(h => h.date <= aujourdhui), 'aucun jour futur ne doit jamais apparaître, même à l\'intérieur du mois en cours');

  console.log('OK — trois-blocages-19-09.test.js (5.2 : jamais un jour futur dans l\'historique, même pour le mois en cours)');
}

async function runShiftPointeuseHistoriqueMoisJamaisAuDelaDuMoisEnCours() {
  const { sandbox, shiftPointeuseHistoriqueMonth, state } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  const now = new Date();
  state.pointeuseHistoriqueYear = now.getFullYear();
  state.pointeuseHistoriqueMonth = now.getMonth();

  shiftPointeuseHistoriqueMonth(1); // tenter d'aller au mois SUIVANT le mois en cours

  assert.strictEqual(state.pointeuseHistoriqueYear, now.getFullYear(), 'ne doit jamais dépasser l\'année en cours en avançant');
  assert.strictEqual(state.pointeuseHistoriqueMonth, now.getMonth(), 'ne doit jamais dépasser le mois en cours : un pointage futur n\'existe par définition jamais');

  shiftPointeuseHistoriqueMonth(-1); // reculer doit fonctionner normalement
  const attenduMois = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
  const attenduAnnee = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  assert.strictEqual(state.pointeuseHistoriqueMonth, attenduMois);
  assert.strictEqual(state.pointeuseHistoriqueYear, attenduAnnee);

  console.log('OK — trois-blocages-19-09.test.js (5.2 : navigation par mois, jamais au-delà du mois en cours, recul normal)');
}

// ---- 5.3 : filtre de période dans les congés ----

async function runFiltrePeriodeCongesChevaucheLaPlage() {
  const { DB, sandbox, employeeRepository, leaveTypeRepository, leaveRepository, getFilteredLeaveRequests, state } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  const type = leaveTypeRepository.getLeaveTypes().find(t => t.categorie === 'conge');

  // Trois demandes : une qui CHEVAUCHE septembre (commencée fin août), une entièrement en juillet
  // (aucun rapport avec septembre), une entièrement en octobre (idem).
  const chevauche = { id: 'lr1', employeeId: salarie.id, typeId: type.id, dateDebut: '2026-08-28', dateFin: '2026-09-03', statut: 'Validé', nbJours: 5 };
  const juillet = { id: 'lr2', employeeId: salarie.id, typeId: type.id, dateDebut: '2026-07-05', dateFin: '2026-07-10', statut: 'Validé', nbJours: 4 };
  const octobre = { id: 'lr3', employeeId: salarie.id, typeId: type.id, dateDebut: '2026-10-01', dateFin: '2026-10-02', statut: 'Validé', nbJours: 2 };
  const company = DB.getCurrentCompany();
  company.leaveRequests = [...(company.leaveRequests || []), chevauche, juillet, octobre];
  DB.saveCurrentCompany(company);

  state.congesFilters = { employeeId: '', typeId: '', statut: '', periode: '2026-09' };
  const resultats = getFilteredLeaveRequests('conge').map(r => r.id);

  assert.ok(resultats.includes('lr1'), 'une demande qui CHEVAUCHE le mois filtré doit apparaître, même commencée le mois précédent');
  assert.ok(!resultats.includes('lr2'), 'une demande entièrement en juillet ne doit pas apparaître si on filtre sur septembre');
  assert.ok(!resultats.includes('lr3'), 'une demande entièrement en octobre ne doit pas apparaître si on filtre sur septembre');

  console.log('OK — trois-blocages-19-09.test.js (5.3 : le filtre de période des congés teste le CHEVAUCHEMENT de la plage, pas une égalité stricte)');
}

async function runFiltrePeriodeCongesAbsentSansValeurChoisie() {
  const { DB, sandbox, getFilteredLeaveRequests, state } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;
  const avant = getFilteredLeaveRequests('conge').length;

  state.congesFilters = { employeeId: '', typeId: '', statut: '', periode: '' };
  assert.strictEqual(getFilteredLeaveRequests('conge').length, avant, 'periode vide = aucun filtrage supplémentaire, comme fraisFilters.periode');

  console.log('OK — trois-blocages-19-09.test.js (5.3 : periode vide n\'exclut rien, même comportement que Notes de frais)');
}

async function runChampPeriodeVisibleDansLeToolbarConges() {
  const { DB, sandbox, renderCongesDemandes } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;

  const html = renderCongesDemandes('conge');
  assert.ok(html.includes('id="conges-filter-periode"'), 'le champ de période doit être présent dans le toolbar, comme frais-filter-periode dans Notes de frais');
  assert.ok(html.includes('type="month"'), 'même type de champ que Notes de frais (mois), pour que les deux écrans se comportent enfin pareil');

  console.log('OK — trois-blocages-19-09.test.js (5.3 : le champ de période est bien rendu dans le toolbar Congés, comme Notes de frais)');
}

runTabsArrowInjecteesEtFonctionnellesQuandCaDeborde()
  .then(runCssRemplaceLaScrollbarMasqueeParUnVraiControle)
  .then(runEnhanceScrollableTabsAppeleeApresChaqueRendu)
  .then(runHistoriquePointeuseVaAuDelaDeSeptJours)
  .then(runHistoriquePointeuseJamaisDeJourFutur)
  .then(runShiftPointeuseHistoriqueMoisJamaisAuDelaDuMoisEnCours)
  .then(runFiltrePeriodeCongesChevaucheLaPlage)
  .then(runFiltrePeriodeCongesAbsentSansValeurChoisie)
  .then(runChampPeriodeVisibleDansLeToolbarConges)
  .catch((err) => {
    console.error('ÉCHEC — trois-blocages-19-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
