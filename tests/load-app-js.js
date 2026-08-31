/**
 * Seven RH — chargeur minimal pour exécuter data.js PUIS app.js dans le même contexte Node (comme
 * le navigateur les charge en deux <script> classiques partageant le même `window`), afin de tester
 * des fonctions d'app.js (ex. syncNotifications) sans navigateur réel. Même principe que
 * load-data-js.js : DOM réduit au strict nécessaire pour que le chargement du fichier ne plante pas
 * (aucun appel DOM au chargement, seulement des addEventListener qui ne se déclenchent jamais ici),
 * pas une émulation complète du navigateur.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function stubElement() {
  let html = '';
  return {
    addEventListener() {},
    removeEventListener() {},
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    style: {},
    dataset: {},
    setAttribute() {},
    getAttribute() { return null; },
    appendChild() {},
    remove() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    get innerHTML() { return html; },
    set innerHTML(v) { html = v; },
    get textContent() { return html; },
    set textContent(v) { html = v; },
  };
}

function loadAppJs() {
  const dataSource = fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8');
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

  const store = {};
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };

  // Éléments persistants par id (pas une vraie arborescence DOM) : suffisant pour que
  // document.getElementById('view-root').innerHTML = ... écrive quelque chose qu'un test peut
  // ensuite relire, sans avoir à parser du HTML. querySelectorAll reste volontairement vide (les
  // clics de boutons sont déjà couverts par les tests navigateur manuels, pas reproduits ici).
  const elementsById = new Map();
  const document = {
    addEventListener() {},
    removeEventListener() {},
    getElementById(id) {
      if (!elementsById.has(id)) elementsById.set(id, stubElement());
      return elementsById.get(id);
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return stubElement(); },
    documentElement: stubElement(),
    body: stubElement(),
  };

  const navigator = { clipboard: { writeText: async () => {} }, userAgent: 'node-test' };

  const sandbox = { console, localStorage, document, navigator, setTimeout, clearTimeout, Promise, Date, Math, JSON, Intl };
  sandbox.window = sandbox;
  sandbox.addEventListener = () => {};
  sandbox.removeEventListener = () => {};
  sandbox.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  // §retour QA du 26/08/2026 (point 6.5) : fetch() n'existe pas nativement dans ce bac à sable —
  // absent par défaut (lève une erreur claire si un test oublie de le fournir), plutôt qu'un appel
  // réseau réel accidentel vers une API externe pendant les tests.
  sandbox.fetch = async () => { throw new Error('fetch() non simulé dans ce test — voir sandbox.window.fetch'); };
  vm.createContext(sandbox);

  const exposeAfterData = `
;globalThis.__DB = DB;
globalThis.__CURRENT_COMPANY_KEY = CURRENT_COMPANY_KEY;
`;
  vm.runInContext(dataSource + exposeAfterData, sandbox, { filename: 'data.js' });

  const exposeAfterApp = `
;globalThis.__syncNotifications = syncNotifications;
globalThis.__hasModule = hasModule;
globalThis.__navigateTo = navigateTo;
globalThis.__render = render;
globalThis.__state = state;
globalThis.__PARAMETRES_TABS = PARAMETRES_TABS;
globalThis.__getVisibleEmployeeIdsForCurrentUser = getVisibleEmployeeIdsForCurrentUser;
globalThis.__isCurrentWorkflowStepFor = isCurrentWorkflowStepFor;
globalThis.__parisDateFromISO = parisDateFromISO;
globalThis.__nextAnneeScolaire = nextAnneeScolaire;
globalThis.__fetchOfficialSchoolHolidays = fetchOfficialSchoolHolidays;
globalThis.__getEmployeesOnLongAbsence = getEmployeesOnLongAbsence;
globalThis.__getReposCompensateurSolde = getReposCompensateurSolde;
globalThis.__buildImportPreviewRows = buildImportPreviewRows;
globalThis.__importEmployeesRows = importEmployeesRows;
globalThis.__requiredModuleForSourceKey = requiredModuleForSourceKey;
globalThis.__SOURCE_KEY_MODULE_RULES = SOURCE_KEY_MODULE_RULES;
globalThis.__HELP_CONTENT = HELP_CONTENT;
globalThis.__canEditEmployeeRecord = canEditEmployeeRecord;
globalThis.__getUpcomingContractEnds = getUpcomingContractEnds;
globalThis.__getUpcomingProbationEnds = getUpcomingProbationEnds;
globalThis.__canManageDocumentsFor = canManageDocumentsFor;
globalThis.__isManagerOfEmployee = isManagerOfEmployee;
globalThis.__getCalendarDayInfo = getCalendarDayInfo;
globalThis.__buildCalendarSharedData = buildCalendarSharedData;
globalThis.__getTableauCompteursData = getTableauCompteursData;
globalThis.__getPaieAnomalies = getPaieAnomalies;
`;
  vm.runInContext(appSource + exposeAfterApp, sandbox, { filename: 'app.js' });

  return {
    sandbox,
    DB: sandbox.__DB,
    CURRENT_COMPANY_KEY: sandbox.__CURRENT_COMPANY_KEY,
    syncNotifications: sandbox.__syncNotifications,
    hasModule: sandbox.__hasModule,
    navigateTo: sandbox.__navigateTo,
    render: sandbox.__render,
    state: sandbox.__state,
    PARAMETRES_TABS: sandbox.__PARAMETRES_TABS,
    getVisibleEmployeeIdsForCurrentUser: sandbox.__getVisibleEmployeeIdsForCurrentUser,
    isCurrentWorkflowStepFor: sandbox.__isCurrentWorkflowStepFor,
    parisDateFromISO: sandbox.__parisDateFromISO,
    nextAnneeScolaire: sandbox.__nextAnneeScolaire,
    fetchOfficialSchoolHolidays: sandbox.__fetchOfficialSchoolHolidays,
    getEmployeesOnLongAbsence: sandbox.__getEmployeesOnLongAbsence,
    getReposCompensateurSolde: sandbox.__getReposCompensateurSolde,
    buildImportPreviewRows: sandbox.__buildImportPreviewRows,
    importEmployeesRows: sandbox.__importEmployeesRows,
    requiredModuleForSourceKey: sandbox.__requiredModuleForSourceKey,
    SOURCE_KEY_MODULE_RULES: sandbox.__SOURCE_KEY_MODULE_RULES,
    HELP_CONTENT: sandbox.__HELP_CONTENT,
    canEditEmployeeRecord: sandbox.__canEditEmployeeRecord,
    getUpcomingContractEnds: sandbox.__getUpcomingContractEnds,
    getUpcomingProbationEnds: sandbox.__getUpcomingProbationEnds,
    canManageDocumentsFor: sandbox.__canManageDocumentsFor,
    isManagerOfEmployee: sandbox.__isManagerOfEmployee,
    getCalendarDayInfo: sandbox.__getCalendarDayInfo,
    buildCalendarSharedData: sandbox.__buildCalendarSharedData,
    getTableauCompteursData: sandbox.__getTableauCompteursData,
    getPaieAnomalies: sandbox.__getPaieAnomalies,
  };
}

module.exports = { loadAppJs };
