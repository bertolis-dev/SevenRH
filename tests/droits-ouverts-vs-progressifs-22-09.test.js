/**
 * Seven RH — retour Betty du 22/09/2026 (revue "écran par écran", défaut 1.2, "les droits annuels
 * sont affichés au prorata du temps écoulé") : "Enfant malade" affichait 2,16 jours au lieu de 3
 * (72 % de l'année écoulée × 3), et au 15 janvier, "Décès d'un enfant" affichait 0,49 j au lieu de
 * 12, "Formation" 0,21 j au lieu de 5 — calculateAcquisition appliquait le MÊME prorata temps-
 * écoulé aux congés payés/RTT/ancienneté (qui s'acquièrent réellement avec le temps de travail) et
 * aux événements familiaux/enfant malade/formation (des droits légalement OUVERTS EN TOTALITÉ dès
 * le premier jour de la période, jamais accumulés). "Un salarié qui perd un enfant le 15 janvier a
 * droit à ses douze jours immédiatement, pas à un demi-jour."
 *
 * Corrigé par un nouveau champ natureAcquisition ('progressive' | 'ouverte', makeEmptyLeaveType) :
 * 'ouverte' désactive le prorata temps écoulé dans calculateAcquisition, sans toucher au prorata
 * temps partiel (proratisationTempsPartiel) ni à la suspension d'acquisition, deux questions
 * distinctes non soulevées par cette demande. Migration idempotente dans DB.getLeaveTypes() (même
 * patron que la recoloration des événements familiaux du 16/09/2026) pour que les entreprises déjà
 * créées avant ce correctif en bénéficient aussi, pas seulement les nouvelles.
 */
const assert = require('assert');
const { loadDataJs } = require('./load-data-js');
const { loadAppJs } = require('./load-app-js');

async function runReproductionExacteDesChiffresDeBetty() {
  const { calculateAcquisition } = loadDataJs();
  const employee = { id: 'e1', dateEmbauche: '2020-01-01', pourcentageActivite: 100 };
  const settings = {};
  const refDate = '2026-01-15'; // 15 janvier, comme dans le repro de Betty

  const enfantMalade = { nom: 'Enfant malade', nombreAnnuel: 3, acquisition: 'Annuelle', natureAcquisition: 'ouverte', proratisationTempsPartiel: 'proportionnelle' };
  const deces = { nom: 'Décès', nombreAnnuel: 3, acquisition: 'Annuelle', natureAcquisition: 'ouverte', proratisationTempsPartiel: 'proportionnelle' };
  const decesEnfant = { nom: 'Décès d\'un enfant', nombreAnnuel: 12, acquisition: 'Annuelle', natureAcquisition: 'ouverte', proratisationTempsPartiel: 'proportionnelle' };
  const formation = { nom: 'Formation', nombreAnnuel: 5, acquisition: 'Annuelle', natureAcquisition: 'ouverte', proratisationTempsPartiel: 'proportionnelle' };

  assert.strictEqual(calculateAcquisition(employee, enfantMalade, refDate), 3, 'Enfant malade doit valoir 3 jours dès le 15 janvier, jamais 0,12 (12 % de l\'année écoulée)');
  assert.strictEqual(calculateAcquisition(employee, deces, refDate), 3, 'Décès doit valoir 3 jours dès le 15 janvier');
  assert.strictEqual(calculateAcquisition(employee, decesEnfant, refDate), 12, 'Décès d\'un enfant doit valoir 12 jours dès le 15 janvier, jamais 0,49 : "a droit à ses douze jours immédiatement, pas à un demi-jour"');
  assert.strictEqual(calculateAcquisition(employee, formation, refDate), 5, 'Formation doit valoir 5 jours dès le 15 janvier, jamais 0,21');

  // Au 31 décembre, un droit ouvert reste identique (jamais capé par le temps écoulé, mais jamais
  // non plus augmenté au-delà de nombreAnnuel — annualAmount reste la seule borne).
  assert.strictEqual(calculateAcquisition(employee, enfantMalade, '2026-12-31'), 3, 'un droit ouvert doit rester à sa valeur pleine toute l\'année, jamais recalculé à la hausse ou à la baisse selon la date');

  console.log('OK — droits-ouverts-vs-progressifs-22-09.test.js (reproduction exacte des chiffres signalés : 3/3/12/5, jamais 0,12/0,12/0,49/0,21)');
}

async function runLesDroitsProgressifsContinuentDeSAccumulerAuTempsEcoule() {
  const { calculateAcquisition } = loadDataJs();
  const employee = { id: 'e1', dateEmbauche: '2020-01-01', pourcentageActivite: 100 };
  // Un type 'progressive' à acquisition 'Annuelle' (ex. Ancienneté sans palier, ou tout type créé
  // par une entreprise sur ce modèle) doit continuer à se prorater au temps écoulé, exactement comme
  // avant ce correctif — sinon la distinction n'aurait plus de sens.
  const typeProgressif = { nom: 'Congé sabbatique interne', nombreAnnuel: 12, acquisition: 'Annuelle', natureAcquisition: 'progressive', proratisationTempsPartiel: 'proportionnelle' };

  const au15Janvier = calculateAcquisition(employee, typeProgressif, '2026-01-15');
  const au31Decembre = calculateAcquisition(employee, typeProgressif, '2026-12-31');
  assert.ok(au15Janvier < au31Decembre, 'un droit progressif doit continuer à croître avec le temps écoulé dans l\'année');
  assert.ok(au15Janvier > 0 && au15Janvier < 1, 'au 15 janvier (15/365e de l\'année), un droit progressif de 12 jours doit valoir une petite fraction, pas la valeur pleine');
  assert.strictEqual(au31Decembre, 12, 'au 31 décembre, le prorata doit atteindre la valeur pleine');

  console.log('OK — droits-ouverts-vs-progressifs-22-09.test.js (les droits progressifs (CP/RTT/ancienneté) continuent de s\'accumuler au temps écoulé, comportement inchangé)');
}

async function runMigrationBackfillLesEntreprisesDejaCreees() {
  const { DB, sandbox } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const company = DB.getCurrentCompany();
  // Simule une entreprise créée AVANT ce correctif : un type "Décès" sans natureAcquisition du tout
  // (jamais recréé depuis, donc jamais passé par le nouveau makeEmptyLeaveType).
  company.leaveTypes = company.leaveTypes.map(t => t.nom === 'Décès' ? Object.assign({}, t, { natureAcquisition: undefined }) : t);
  delete company.natureAcquisitionEvenementsFamiliauxAppliquee;
  DB.saveCurrentCompany(company);

  const types = DB.getLeaveTypes();
  const deces = types.find(t => t.nom === 'Décès');
  assert.strictEqual(deces.natureAcquisition, 'ouverte', 'une entreprise déjà créée avant ce correctif doit être rattrapée automatiquement, dès le premier appel');

  // Idempotent : un second appel ne doit rien casser ni re-basculer une valeur changée depuis par l'entreprise.
  const decesModifieManuellement = DB.getLeaveTypes().find(t => t.nom === 'Décès');
  decesModifieManuellement.natureAcquisition = 'progressive'; // l'entreprise a explicitement changé ce réglage depuis Paramètres
  DB.saveLeaveTypes(DB.getLeaveTypes().map(t => t.id === decesModifieManuellement.id ? decesModifieManuellement : t));
  const typesApres = DB.getLeaveTypes();
  assert.strictEqual(typesApres.find(t => t.nom === 'Décès').natureAcquisition, 'progressive', 'une fois le marqueur de migration posé, un choix explicite de l\'entreprise ne doit jamais être écrasé à nouveau');

  console.log('OK — droits-ouverts-vs-progressifs-22-09.test.js (migration : rattrape les entreprises déjà créées, idempotente, jamais un choix explicite ultérieur écrasé)');
}

async function runGetLeaveBalanceDeBoutEnBoutSurLaFicheSalarie() {
  const { DB, sandbox, employeeRepository, getLeaveBalance, leaveTypeRepository } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  const enfantMalade = leaveTypeRepository.getLeaveTypes().find(t => t.nom === 'Enfant malade');
  assert.ok(enfantMalade, 'le type Enfant malade doit exister dans le jeu de démo');
  assert.strictEqual(enfantMalade.natureAcquisition, 'ouverte');

  const balance = getLeaveBalance(salarie, enfantMalade, [], leaveTypeRepository.getLeaveTypes());
  assert.strictEqual(balance.acquis, 3, 'la fiche salarié doit afficher 3 jours pour Enfant malade, quelle que soit la date du jour où ce test tourne');

  console.log('OK — droits-ouverts-vs-progressifs-22-09.test.js (getLeaveBalance, tel qu\'utilisé par la fiche salarié, reflète bien le correctif de bout en bout)');
}

runReproductionExacteDesChiffresDeBetty()
  .then(runLesDroitsProgressifsContinuentDeSAccumulerAuTempsEcoule)
  .then(runMigrationBackfillLesEntreprisesDejaCreees)
  .then(runGetLeaveBalanceDeBoutEnBoutSurLaFicheSalarie)
  .catch((err) => {
    console.error('ÉCHEC — droits-ouverts-vs-progressifs-22-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
