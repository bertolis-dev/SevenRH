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

function loadDataJs() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8');

  const store = {};
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };

  const sandbox = { console, localStorage };
  sandbox.window = sandbox; // data.js référence `window.SupabaseSync` — même objet que le sandbox, pratique pour l'injecter depuis les tests.
  vm.createContext(sandbox);

  const expose = `
;globalThis.__DB = DB;
globalThis.__CURRENT_COMPANY_KEY = CURRENT_COMPANY_KEY;
globalThis.__ROLES = ROLES;
globalThis.__seedLeaveTypes = seedLeaveTypes;
globalThis.__ensureDefaultLeaveTypesBackfilled = ensureDefaultLeaveTypesBackfilled;
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
`;
  vm.runInContext(source + expose, sandbox, { filename: 'data.js' });

  return {
    sandbox,
    DB: sandbox.__DB,
    CURRENT_COMPANY_KEY: sandbox.__CURRENT_COMPANY_KEY,
    ROLES: sandbox.__ROLES,
    seedLeaveTypes: sandbox.__seedLeaveTypes,
    ensureDefaultLeaveTypesBackfilled: sandbox.__ensureDefaultLeaveTypesBackfilled,
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
  };
}

module.exports = { loadDataJs };
