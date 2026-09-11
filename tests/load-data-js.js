/**
 * Seven RH — chargeur minimal pour exécuter data.js (script navigateur classique, sans export) dans
 * Node, afin de tester le moteur de congés/permissions sans navigateur ni backend réel. §retour QA
 * du 26/08/2026 (section 3, "protéger le moteur de congés et le moteur de permissions").
 *
 * data.js déclare DB/generateId/etc. en `const`/`function` au niveau racine — invisibles depuis
 * l'extérieur d'un script vm.runInContext (les `const`/`let` de premier niveau ne deviennent jamais
 * des propriétés du contexte). On ajoute donc, à la fin du MÊME script exécuté, quelques lignes qui
 * copient explicitement ce dont les tests ont besoin sur `globalThis` (qui correspond à l'objet
 * sandbox fourni à vm.createContext) — sans jamais modifier data.js lui-même.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/**
 * `options.indexedDB` (optionnel, voir tests/fake-indexeddb.js) : injecte un faux IndexedDB dans le
 * bac à sable pour tester le VRAI chemin IndexedDB de DB.init()/saveCompanies() (§retour Betty du
 * 11/09/2026, point 1 étape 1) — omis par défaut pour TOUS les autres tests, qui continuent
 * d'exercer le repli synchrone localStorage (idbAvailable() renvoie false), exactement comme avant
 * ce correctif : c'est ce qui garantit qu'aucun des ~40 fichiers de test existants n'a besoin d'être
 * modifié pour rester `DB.init()` sans `await`.
 */
function loadDataJs(options = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8');

  const store = {};
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };

  const sandbox = { console, localStorage };
  sandbox.window = sandbox; // data.js référence `window.SupabaseSync` — même objet que le sandbox, pratique pour l'injecter depuis les tests.
  if (options.indexedDB) sandbox.indexedDB = options.indexedDB;
  vm.createContext(sandbox);

  const expose = `
;globalThis.__DB = DB;
globalThis.__CURRENT_COMPANY_KEY = CURRENT_COMPANY_KEY;
globalThis.__ROOT_KEY = ROOT_KEY;
globalThis.__HAS_RUN_BEFORE_KEY = HAS_RUN_BEFORE_KEY;
globalThis.__ROLES = ROLES;
globalThis.__seedLeaveTypes = seedLeaveTypes;
globalThis.__ensureDefaultLeaveTypesBackfilled = ensureDefaultLeaveTypesBackfilled;
globalThis.__migrateLeaveTypeAutoriserDemiJournee = migrateLeaveTypeAutoriserDemiJournee;
globalThis.__hydrateCurrentCompanyWithMigrations = hydrateCurrentCompanyWithMigrations;
globalThis.__hasPermission = hasPermission;
globalThis.__PERMISSIONS = PERMISSIONS;
globalThis.__calculateAcquisition = calculateAcquisition;
globalThis.__resolveProratisationTempsPartiel = resolveProratisationTempsPartiel;
globalThis.__makeEmptyLeaveType = makeEmptyLeaveType;
globalThis.__getLeaveBalance = getLeaveBalance;
globalThis.__getCompteurPeriodBounds = getCompteurPeriodBounds;
globalThis.__deriveCategoriesSalarieFromStatutPro = deriveCategoriesSalarieFromStatutPro;
globalThis.__DEFAULT_SETTINGS = DEFAULT_SETTINGS;
globalThis.__getDelaiPrevenanceFinEssai = getDelaiPrevenanceFinEssai;
globalThis.__getConventionCollectiveCongesAncienneteBonus = getConventionCollectiveCongesAncienneteBonus;
globalThis.__getConventionCollectiveIdccCode = getConventionCollectiveIdccCode;
globalThis.__getEffectifActifAt = getEffectifActifAt;
globalThis.__getSeuilsEffectifStatus = getSeuilsEffectifStatus;
globalThis.__getRadarTresorerieRH = getRadarTresorerieRH;
globalThis.__isLeaveTypeEligibleForEmployee = isLeaveTypeEligibleForEmployee;
globalThis.__calculateAncienneteYears = calculateAncienneteYears;
globalThis.__calculateIndemniteKilometrique = calculateIndemniteKilometrique;
globalThis.__getKilometrageDejaDeclareAnnee = getKilometrageDejaDeclareAnnee;
globalThis.__recalculerIndemnitesKilometriquesAnnee = recalculerIndemnitesKilometriquesAnnee;
globalThis.__getBaremeKilometrique = getBaremeKilometrique;
globalThis.__getSeuilsKilometriques = getSeuilsKilometriques;
globalThis.__markExpensePaid = markExpensePaid;
globalThis.__refuseRequest = refuseRequest;
globalThis.__findDuplicateExpense = findDuplicateExpense;
globalThis.__getExpenseRembourseDate = getExpenseRembourseDate;
globalThis.__idbAvailable = idbAvailable;
globalThis.__idbGet = idbGet;
globalThis.__isArretTravailType = isArretTravailType;
`;
  vm.runInContext(source + expose, sandbox, { filename: 'data.js' });

  return {
    sandbox,
    DB: sandbox.__DB,
    CURRENT_COMPANY_KEY: sandbox.__CURRENT_COMPANY_KEY,
    ROOT_KEY: sandbox.__ROOT_KEY,
    HAS_RUN_BEFORE_KEY: sandbox.__HAS_RUN_BEFORE_KEY,
    ROLES: sandbox.__ROLES,
    seedLeaveTypes: sandbox.__seedLeaveTypes,
    ensureDefaultLeaveTypesBackfilled: sandbox.__ensureDefaultLeaveTypesBackfilled,
    migrateLeaveTypeAutoriserDemiJournee: sandbox.__migrateLeaveTypeAutoriserDemiJournee,
    hydrateCurrentCompanyWithMigrations: sandbox.__hydrateCurrentCompanyWithMigrations,
    hasPermission: sandbox.__hasPermission,
    PERMISSIONS: sandbox.__PERMISSIONS,
    calculateAcquisition: sandbox.__calculateAcquisition,
    resolveProratisationTempsPartiel: sandbox.__resolveProratisationTempsPartiel,
    makeEmptyLeaveType: sandbox.__makeEmptyLeaveType,
    getLeaveBalance: sandbox.__getLeaveBalance,
    getCompteurPeriodBounds: sandbox.__getCompteurPeriodBounds,
    deriveCategoriesSalarieFromStatutPro: sandbox.__deriveCategoriesSalarieFromStatutPro,
    DEFAULT_SETTINGS: sandbox.__DEFAULT_SETTINGS,
    getDelaiPrevenanceFinEssai: sandbox.__getDelaiPrevenanceFinEssai,
    getConventionCollectiveCongesAncienneteBonus: sandbox.__getConventionCollectiveCongesAncienneteBonus,
    getConventionCollectiveIdccCode: sandbox.__getConventionCollectiveIdccCode,
    getEffectifActifAt: sandbox.__getEffectifActifAt,
    getSeuilsEffectifStatus: sandbox.__getSeuilsEffectifStatus,
    getRadarTresorerieRH: sandbox.__getRadarTresorerieRH,
    isLeaveTypeEligibleForEmployee: sandbox.__isLeaveTypeEligibleForEmployee,
    calculateAncienneteYears: sandbox.__calculateAncienneteYears,
    calculateIndemniteKilometrique: sandbox.__calculateIndemniteKilometrique,
    getKilometrageDejaDeclareAnnee: sandbox.__getKilometrageDejaDeclareAnnee,
    recalculerIndemnitesKilometriquesAnnee: sandbox.__recalculerIndemnitesKilometriquesAnnee,
    getBaremeKilometrique: sandbox.__getBaremeKilometrique,
    getSeuilsKilometriques: sandbox.__getSeuilsKilometriques,
    markExpensePaid: sandbox.__markExpensePaid,
    refuseRequest: sandbox.__refuseRequest,
    findDuplicateExpense: sandbox.__findDuplicateExpense,
    getExpenseRembourseDate: sandbox.__getExpenseRembourseDate,
    idbAvailable: sandbox.__idbAvailable,
    idbGet: sandbox.__idbGet,
    isArretTravailType: sandbox.__isArretTravailType,
  };
}

module.exports = { loadDataJs };
