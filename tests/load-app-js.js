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
    removeAttribute() {},
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
globalThis.__positionRepository = positionRepository;
globalThis.__shiftRepository = shiftRepository;
globalThis.__computeShiftHeures = computeShiftHeures;
globalThis.__seedPositions = seedPositions;
globalThis.__migrateCompanyPositions = migrateCompanyPositions;
globalThis.__seedExampleShifts = seedExampleShifts;
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
globalThis.__getPaieRows = getPaieRows;
globalThis.__getExpensePayableMonthKey = getExpensePayableMonthKey;
globalThis.__updateExpenseKmHint = updateExpenseKmHint;
globalThis.__submitExpenseForm = submitExpenseForm;
globalThis.__openExpenseModal = openExpenseModal;
globalThis.__expenseRepository = expenseRepository;
globalThis.__renderFrais = renderFrais;
globalThis.__renderAbsencesHub = renderAbsencesHub;
globalThis.__teleworkRepository = teleworkRepository;
globalThis.__leaveRepository = leaveRepository;
globalThis.__renderDashboardActionCenter = renderDashboardActionCenter;
globalThis.__renderCalendrierValidationsCard = renderCalendrierValidationsCard;
globalThis.__exportTicketsCSV = exportTicketsCSV;
globalThis.__getTicketsRows = getTicketsRows;
globalThis.__canSelfCancelPendingRequest = canSelfCancelPendingRequest;
globalThis.__handleSelfCancelLeaveRequest = handleSelfCancelLeaveRequest;
globalThis.__handleEditTelework = handleEditTelework;
globalThis.__handleSelfCancelTelework = handleSelfCancelTelework;
globalThis.__submitTeleworkRequestForm = submitTeleworkRequestForm;
globalThis.__openTeleworkRequestModal = openTeleworkRequestModal;
globalThis.__renderTeletravailDemandes = renderTeletravailDemandes;
globalThis.__documentRepository = documentRepository;
globalThis.__entretienRepository = entretienRepository;
globalThis.__openPlanEntretienModal = openPlanEntretienModal;
globalThis.__openDocumentModal = openDocumentModal;
globalThis.__canSelfManagePendingExpense = canSelfManagePendingExpense;
globalThis.__handleEditExpense = handleEditExpense;
globalThis.__handleSelfCancelExpense = handleSelfCancelExpense;
globalThis.__handleMarkExpensePaid = handleMarkExpensePaid;
globalThis.__isJustificatifObligatoireForExpense = isJustificatifObligatoireForExpense;
globalThis.__finalizeExpenseSubmit = finalizeExpenseSubmit;
globalThis.__canExportCongesFraisMoisLeger = canExportCongesFraisMoisLeger;
globalThis.__exportCongesFraisMoisCSV = exportCongesFraisMoisCSV;
globalThis.__renderExpenseRow = renderExpenseRow;
globalThis.__openConfirm = openConfirm;
globalThis.__closeModal = closeModal;
globalThis.__getFilteredLeaveRequests = getFilteredLeaveRequests;
globalThis.__getFilteredTeleworkRequests = getFilteredTeleworkRequests;
globalThis.__getFilteredExpenses = getFilteredExpenses;
globalThis.__renderIdees = renderIdees;
globalThis.__IDEE_STATUT_LABELS = IDEE_STATUT_LABELS;
globalThis.__ideeRepository = ideeRepository;
globalThis.__buildBoussoleContext = buildBoussoleContext;
globalThis.__renderBoussole = renderBoussole;
globalThis.__NAV_ITEMS = NAV_ITEMS;
globalThis.__renderSidebar = renderSidebar;
globalThis.__authRepository = authRepository;
globalThis.__renderUserMenuPanel = renderUserMenuPanel;
globalThis.__openGroupSummaryModal = openGroupSummaryModal;
globalThis.__runGroupSummaryRefresh = runGroupSummaryRefresh;
globalThis.__renderGroupSummaryResult = renderGroupSummaryResult;
globalThis.__renderContratBadge = renderContratBadge;
globalThis.__renderBreadcrumb = renderBreadcrumb;
globalThis.__getEmployeeActivityHistory = getEmployeeActivityHistory;
globalThis.__auditLogRepository = auditLogRepository;
globalThis.__PERMISSIONS = PERMISSIONS;
globalThis.__getThemePreference = getThemePreference;
globalThis.__applyThemePreference = applyThemePreference;
globalThis.__performGlobalSearch = performGlobalSearch;
globalThis.__getGlobalCommands = getGlobalCommands;
globalThis.__renderCongesDemandes = renderCongesDemandes;
globalThis.__bulkSelection = bulkSelection;
globalThis.__renderCalendrier = renderCalendrier;
globalThis.__renderCalendarCell = renderCalendarCell;
globalThis.__openCalendarDayModal = openCalendarDayModal;
globalThis.__renderPlanningSemaine = renderPlanningSemaine;
globalThis.__formatHorairesRange = formatHorairesRange;
globalThis.__groupEmployeesByServiceAndEquipe = groupEmployeesByServiceAndEquipe;
globalThis.__personNameWithPosteHtml = personNameWithPosteHtml;
globalThis.__renderEmployeesList = renderEmployeesList;
globalThis.__renderOrganigramme = renderOrganigramme;
globalThis.__openEmployeeModal = openEmployeeModal;
globalThis.__renderNotifPanel = renderNotifPanel;
globalThis.__getNotifDayGroupLabel = getNotifDayGroupLabel;
globalThis.__notificationRepository = notificationRepository;
globalThis.__FILTER_RESET_HANDLERS = FILTER_RESET_HANDLERS;
globalThis.__getStatusForDate = getStatusForDate;
globalThis.__getHalfDayForDate = getHalfDayForDate;
globalThis.__computeAbsenceCalendarSegments = computeAbsenceCalendarSegments;
globalThis.__renderAbsenceCalendarRow = renderAbsenceCalendarRow;
globalThis.__renderAbsenceCalendarBoard = renderAbsenceCalendarBoard;
globalThis.__leaveTypeRepository = leaveTypeRepository;
globalThis.__openLeaveRequestModal = openLeaveRequestModal;
globalThis.__updateLeaveRequestHints = updateLeaveRequestHints;
globalThis.__submitLeaveRequestForm = submitLeaveRequestForm;
globalThis.__renderPlanningPostes = renderPlanningPostes;
globalThis.__renderPlanning = renderPlanning;
globalThis.__openShiftModal = openShiftModal;
`;
  vm.runInContext(appSource + exposeAfterApp, sandbox, { filename: 'app.js' });

  return {
    sandbox,
    DB: sandbox.__DB,
    CURRENT_COMPANY_KEY: sandbox.__CURRENT_COMPANY_KEY,
    positionRepository: sandbox.__positionRepository,
    shiftRepository: sandbox.__shiftRepository,
    computeShiftHeures: sandbox.__computeShiftHeures,
    seedPositions: sandbox.__seedPositions,
    migrateCompanyPositions: sandbox.__migrateCompanyPositions,
    seedExampleShifts: sandbox.__seedExampleShifts,
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
    getPaieRows: sandbox.__getPaieRows,
    getExpensePayableMonthKey: sandbox.__getExpensePayableMonthKey,
    updateExpenseKmHint: sandbox.__updateExpenseKmHint,
    submitExpenseForm: sandbox.__submitExpenseForm,
    openExpenseModal: sandbox.__openExpenseModal,
    expenseRepository: sandbox.__expenseRepository,
    renderFrais: sandbox.__renderFrais,
    renderAbsencesHub: sandbox.__renderAbsencesHub,
    teleworkRepository: sandbox.__teleworkRepository,
    leaveRepository: sandbox.__leaveRepository,
    renderDashboardActionCenter: sandbox.__renderDashboardActionCenter,
    renderCalendrierValidationsCard: sandbox.__renderCalendrierValidationsCard,
    exportTicketsCSV: sandbox.__exportTicketsCSV,
    getTicketsRows: sandbox.__getTicketsRows,
    canSelfCancelPendingRequest: sandbox.__canSelfCancelPendingRequest,
    handleSelfCancelLeaveRequest: sandbox.__handleSelfCancelLeaveRequest,
    handleEditTelework: sandbox.__handleEditTelework,
    handleSelfCancelTelework: sandbox.__handleSelfCancelTelework,
    submitTeleworkRequestForm: sandbox.__submitTeleworkRequestForm,
    openTeleworkRequestModal: sandbox.__openTeleworkRequestModal,
    renderTeletravailDemandes: sandbox.__renderTeletravailDemandes,
    documentRepository: sandbox.__documentRepository,
    entretienRepository: sandbox.__entretienRepository,
    openPlanEntretienModal: sandbox.__openPlanEntretienModal,
    openDocumentModal: sandbox.__openDocumentModal,
    canSelfManagePendingExpense: sandbox.__canSelfManagePendingExpense,
    handleEditExpense: sandbox.__handleEditExpense,
    handleSelfCancelExpense: sandbox.__handleSelfCancelExpense,
    handleMarkExpensePaid: sandbox.__handleMarkExpensePaid,
    isJustificatifObligatoireForExpense: sandbox.__isJustificatifObligatoireForExpense,
    finalizeExpenseSubmit: sandbox.__finalizeExpenseSubmit,
    canExportCongesFraisMoisLeger: sandbox.__canExportCongesFraisMoisLeger,
    exportCongesFraisMoisCSV: sandbox.__exportCongesFraisMoisCSV,
    renderExpenseRow: sandbox.__renderExpenseRow,
    openConfirm: sandbox.__openConfirm,
    closeModal: sandbox.__closeModal,
    getFilteredLeaveRequests: sandbox.__getFilteredLeaveRequests,
    getFilteredTeleworkRequests: sandbox.__getFilteredTeleworkRequests,
    getFilteredExpenses: sandbox.__getFilteredExpenses,
    renderIdees: sandbox.__renderIdees,
    IDEE_STATUT_LABELS: sandbox.__IDEE_STATUT_LABELS,
    ideeRepository: sandbox.__ideeRepository,
    buildBoussoleContext: sandbox.__buildBoussoleContext,
    renderBoussole: sandbox.__renderBoussole,
    NAV_ITEMS: sandbox.__NAV_ITEMS,
    renderSidebar: sandbox.__renderSidebar,
    authRepository: sandbox.__authRepository,
    renderUserMenuPanel: sandbox.__renderUserMenuPanel,
    openGroupSummaryModal: sandbox.__openGroupSummaryModal,
    runGroupSummaryRefresh: sandbox.__runGroupSummaryRefresh,
    renderGroupSummaryResult: sandbox.__renderGroupSummaryResult,
    renderContratBadge: sandbox.__renderContratBadge,
    renderBreadcrumb: sandbox.__renderBreadcrumb,
    getEmployeeActivityHistory: sandbox.__getEmployeeActivityHistory,
    auditLogRepository: sandbox.__auditLogRepository,
    PERMISSIONS: sandbox.__PERMISSIONS,
    getThemePreference: sandbox.__getThemePreference,
    applyThemePreference: sandbox.__applyThemePreference,
    performGlobalSearch: sandbox.__performGlobalSearch,
    getGlobalCommands: sandbox.__getGlobalCommands,
    renderCongesDemandes: sandbox.__renderCongesDemandes,
    bulkSelection: sandbox.__bulkSelection,
    renderCalendrier: sandbox.__renderCalendrier,
    renderCalendarCell: sandbox.__renderCalendarCell,
    openCalendarDayModal: sandbox.__openCalendarDayModal,
    renderPlanningSemaine: sandbox.__renderPlanningSemaine,
    formatHorairesRange: sandbox.__formatHorairesRange,
    groupEmployeesByServiceAndEquipe: sandbox.__groupEmployeesByServiceAndEquipe,
    personNameWithPosteHtml: sandbox.__personNameWithPosteHtml,
    renderEmployeesList: sandbox.__renderEmployeesList,
    renderOrganigramme: sandbox.__renderOrganigramme,
    openEmployeeModal: sandbox.__openEmployeeModal,
    renderNotifPanel: sandbox.__renderNotifPanel,
    getNotifDayGroupLabel: sandbox.__getNotifDayGroupLabel,
    notificationRepository: sandbox.__notificationRepository,
    FILTER_RESET_HANDLERS: sandbox.__FILTER_RESET_HANDLERS,
    renderPlanningPostes: sandbox.__renderPlanningPostes,
    renderPlanning: sandbox.__renderPlanning,
    openShiftModal: sandbox.__openShiftModal,
    getStatusForDate: sandbox.__getStatusForDate,
    getHalfDayForDate: sandbox.__getHalfDayForDate,
    computeAbsenceCalendarSegments: sandbox.__computeAbsenceCalendarSegments,
    renderAbsenceCalendarRow: sandbox.__renderAbsenceCalendarRow,
    renderAbsenceCalendarBoard: sandbox.__renderAbsenceCalendarBoard,
    leaveTypeRepository: sandbox.__leaveTypeRepository,
    openLeaveRequestModal: sandbox.__openLeaveRequestModal,
    updateLeaveRequestHints: sandbox.__updateLeaveRequestHints,
    submitLeaveRequestForm: sandbox.__submitLeaveRequestForm,
  };
}

module.exports = { loadAppJs };
