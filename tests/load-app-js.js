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
  // §11/09/2026 : vendorisée comme app.js/data.js (voir index.html), chargée ici aussi pour que les
  // fonctions qui appellent le global `qrcode` (renderEmbauche, renderPointageQrModalContent) soient
  // testables sans planter sur "qrcode is not defined" — pas de dépendance DOM au chargement (pur
  // générateur JS), donc chargeable tel quel dans ce bac à sable minimal.
  const qrcodeSource = fs.readFileSync(path.join(__dirname, '..', 'qrcode.js'), 'utf8');

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

  const sandbox = { console, localStorage, document, navigator, setTimeout, clearTimeout, Promise, Date, Math, JSON, Intl, URLSearchParams };
  sandbox.window = sandbox;
  // Minimal, mutable par un test qui a besoin d'un autre chemin/paramètre (ex. ?poste=...) — voir
  // candidatureUrlForCompany/carriereUrlForCompany/renderCarrierePage (app.js), seules fonctions de
  // ce bac à sable à lire window.location jusqu'ici.
  sandbox.location = { origin: 'https://nexus-rh.com', pathname: '/index.html', search: '' };
  sandbox.addEventListener = () => {};
  sandbox.removeEventListener = () => {};
  sandbox.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  // §retour QA du 26/08/2026 (point 6.5) : fetch() n'existe pas nativement dans ce bac à sable —
  // absent par défaut (lève une erreur claire si un test oublie de le fournir), plutôt qu'un appel
  // réseau réel accidentel vers une API externe pendant les tests.
  sandbox.fetch = async () => { throw new Error('fetch() non simulé dans ce test — voir sandbox.window.fetch'); };
  vm.createContext(sandbox);
  vm.runInContext(qrcodeSource, sandbox, { filename: 'qrcode.js' });

  const exposeAfterData = `
;globalThis.__DB = DB;
globalThis.__CURRENT_COMPANY_KEY = CURRENT_COMPANY_KEY;
globalThis.__shiftRepository = shiftRepository;
globalThis.__shiftSwapRepository = shiftSwapRepository;
globalThis.__weekTemplateRepository = weekTemplateRepository;
globalThis.__documentTemplateRepository = documentTemplateRepository;
globalThis.__CHAMPS_FUSION_MODELE = CHAMPS_FUSION_MODELE;
globalThis.__employeeRepository = employeeRepository;
globalThis.__computeShiftHeures = computeShiftHeures;
globalThis.__seedExampleShifts = seedExampleShifts;
globalThis.__pointageRepository = pointageRepository;
globalThis.__etablissementRepository = etablissementRepository;
globalThis.__serviceRepository = serviceRepository;
globalThis.__categorieSalarieRepository = categorieSalarieRepository;
globalThis.__computeDureeTravailleeMinutes = computeDureeTravailleeMinutes;
globalThis.__calculerCoutEmployeurComplet = calculerCoutEmployeurComplet;
globalThis.__revisionSalarialeRepository = revisionSalarialeRepository;
globalThis.__settingsRepository = settingsRepository;
globalThis.__candidatureRepository = candidatureRepository;
globalThis.__DEFAULT_SETTINGS = DEFAULT_SETTINGS;
globalThis.__formatCurrencyFR = formatCurrencyFR;
globalThis.__formatNomFamille = formatNomFamille;
globalThis.__formatPrenom = formatPrenom;
globalThis.__companyRepository = companyRepository;
globalThis.__billingRepository = billingRepository;
globalThis.__calculerJoursRTTAutoForfaitJours = calculerJoursRTTAutoForfaitJours;
globalThis.__getSexe = getSexe;
globalThis.__getCiviliteAffichee = getCiviliteAffichee;
globalThis.__ensureCiviliteSexeMigresVersServeur = ensureCiviliteSexeMigresVersServeur;
globalThis.__makeEmptyEmployee = makeEmptyEmployee;
globalThis.__parsePosteGenre = parsePosteGenre;
globalThis.__getPosteAccorde = getPosteAccorde;
globalThis.__ensurePostesGenresBackfilled = ensurePostesGenresBackfilled;
globalThis.__ensureContratsTermineDateDepartAutoDeduite = ensureContratsTermineDateDepartAutoDeduite;
globalThis.__ROLES = ROLES;
globalThis.__seedDocumentTemplatesDefaut = seedDocumentTemplatesDefaut;
globalThis.__ensureDocumentTemplatesAttestationCertificatBackfilled = ensureDocumentTemplatesAttestationCertificatBackfilled;
globalThis.__ensureContratsBackfilled = ensureContratsBackfilled;
`;
  vm.runInContext(dataSource + exposeAfterData, sandbox, { filename: 'data.js' });

  const exposeAfterApp = `
;globalThis.__syncNotifications = syncNotifications;
globalThis.__hasModule = hasModule;
globalThis.__navigateTo = navigateTo;
globalThis.__render = render;
globalThis.__state = state;
globalThis.__PARAMETRES_TABS = PARAMETRES_TABS;
globalThis.__LANDING_ALACARTE_MODULES = LANDING_ALACARTE_MODULES;
globalThis.__LANDING_FEATURES = LANDING_FEATURES;
globalThis.__renderMockCard = renderMockCard;
globalThis.__renderFeatureDetailPage = renderFeatureDetailPage;
globalThis.__openScreenshotLightbox = openScreenshotLightbox;
globalThis.__LEGAL_CONTENT = LEGAL_CONTENT;
globalThis.__openLegalModal = openLegalModal;
globalThis.__renderLandingScreen = renderLandingScreen;
globalThis.__computeAlacarteTotal = computeAlacarteTotal;
globalThis.__bindLandingScreenEvents = bindLandingScreenEvents;
globalThis.__renderPointeuse = renderPointeuse;
globalThis.__joursDuMoisPointeuse = joursDuMoisPointeuse;
globalThis.__shiftPointeuseHistoriqueMonth = shiftPointeuseHistoriqueMonth;
globalThis.__enhanceScrollableTabs = enhanceScrollableTabs;
globalThis.__renderPointeuseEquipe = renderPointeuseEquipe;
globalThis.__openRegulariserPointageModal = openRegulariserPointageModal;
globalThis.__renderEcartsPointageCard = renderEcartsPointageCard;
globalThis.__renderRapportMensuelPointageCard = renderRapportMensuelPointageCard;
globalThis.__bindPointeuseEvents = bindPointeuseEvents;
globalThis.__canRegulariserPointages = canRegulariserPointages;
globalThis.__openPointageQrModal = openPointageQrModal;
globalThis.__openModeleDocumentModal = openModeleDocumentModal;
globalThis.__openGenererDocumentModal = openGenererDocumentModal;
globalThis.__confirmerAccuseLectureDocument = confirmerAccuseLectureDocument;
globalThis.__documentExpirationInfo = documentExpirationInfo;
globalThis.__renderParametresRegistrePersonnel = renderParametresRegistrePersonnel;
globalThis.__renderShiftSwapCard = renderShiftSwapCard;
globalThis.__renderComparaisonPrevuRealiseCard = renderComparaisonPrevuRealiseCard;
globalThis.__openEnregistrerModeleSemaineModal = openEnregistrerModeleSemaineModal;
globalThis.__openAppliquerModeleSemaineModal = openAppliquerModeleSemaineModal;
globalThis.__openIndisponibiliteModal = openIndisponibiliteModal;
globalThis.__renderParametresMonCompte = renderParametresMonCompte;
globalThis.__bindParametresMonCompteEvents = bindParametresMonCompteEvents;
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
globalThis.__renderTableauCompteurs = renderTableauCompteurs;
globalThis.__exportTableauCompteursExcel = exportTableauCompteursExcel;
globalThis.__renderListEmptyState = renderListEmptyState;
globalThis.__matchesPeriodeFilter = matchesPeriodeFilter;
globalThis.__sortListBy = sortListBy;
globalThis.__renderSortableHeader = renderSortableHeader;
globalThis.__bindSortableHeadersGlobalDelegation = bindSortableHeadersGlobalDelegation;
globalThis.__getFilteredEntretiens = getFilteredEntretiens;
globalThis.__exportEntretiensExcel = exportEntretiensExcel;
globalThis.__getPaieAnomalies = getPaieAnomalies;
globalThis.__getPaieRows = getPaieRows;
globalThis.__getExpensePayableMonthKey = getExpensePayableMonthKey;
globalThis.__updateExpenseKmHint = updateExpenseKmHint;
globalThis.__submitExpenseForm = submitExpenseForm;
globalThis.__openExpenseModal = openExpenseModal;
globalThis.__expenseDossierRepository = expenseDossierRepository;
globalThis.__openRegrouperDossierModal = openRegrouperDossierModal;
globalThis.__updateExpenseCategoryFields = updateExpenseCategoryFields;
globalThis.__renderExpenseDossiersCard = renderExpenseDossiersCard;
globalThis.__handleApproveExpense = handleApproveExpense;
globalThis.__refuseRequest = refuseRequest;
globalThis.__expenseRepository = expenseRepository;
globalThis.__renderFrais = renderFrais;
globalThis.__renderParametresModelesDocuments = renderParametresModelesDocuments;
globalThis.__renderAbsencesHub = renderAbsencesHub;
globalThis.__teleworkRepository = teleworkRepository;
globalThis.__leaveRepository = leaveRepository;
globalThis.__renderDashboardActionCenter = renderDashboardActionCenter;
globalThis.__renderCalendrierValidationsCard = renderCalendrierValidationsCard;
globalThis.__exportTicketsCSV = exportTicketsCSV;
globalThis.__getTicketsRows = getTicketsRows;
globalThis.__genererFichierCommandeTickets = genererFichierCommandeTickets;
globalThis.__openCorrigerTicketsModal = openCorrigerTicketsModal;
globalThis.__renderTicketsEquipe = renderTicketsEquipe;
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
globalThis.__renderEntretienDetail = renderEntretienDetail;
globalThis.__bindEntretienDetailEvents = bindEntretienDetailEvents;
globalThis.__renderEntretiens = renderEntretiens;
globalThis.__renderCampagnesEntretienCard = renderCampagnesEntretienCard;
globalThis.__openLancerCampagneModal = openLancerCampagneModal;
globalThis.__openGererTramesModal = openGererTramesModal;
globalThis.__entretienTrameRepository = entretienTrameRepository;
globalThis.__entretienCampagneRepository = entretienCampagneRepository;
globalThis.__resolvePopulationEmployeeIds = resolvePopulationEmployeeIds;
globalThis.__openValiderEntretienModal = openValiderEntretienModal;
globalThis.__getObjectifsReconduits = getObjectifsReconduits;
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
globalThis.__renderCongesTypes = renderCongesTypes;
globalThis.__bindCongesTypesEvents = bindCongesTypesEvents;
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
globalThis.__renderTeletravailPlanning = renderTeletravailPlanning;
globalThis.__getWeekDates = getWeekDates;
globalThis.__toISODate = toISODate;
globalThis.__openShiftModal = openShiftModal;
globalThis.__renderAvatar = renderAvatar;
globalThis.__resolveAvatarUrl = resolveAvatarUrl;
globalThis.__hydrateAvatarImages = hydrateAvatarImages;
globalThis.__reportClientError = reportClientError;
globalThis.__renderEmployeeFraisCard = renderEmployeeFraisCard;
globalThis.__ensureFraisTotalsLoaded = ensureFraisTotalsLoaded;
globalThis.__renderEmployeeDetail = renderEmployeeDetail;
globalThis.__openAjouterAvenantModal = openAjouterAvenantModal;
globalThis.__openNouveauContratModal = openNouveauContratModal;
globalThis.__renderEmployeeContratTab = renderEmployeeContratTab;
globalThis.__computeNextVisiteMedicale = computeNextVisiteMedicale;
globalThis.__getLatestVisiteMedicale = getLatestVisiteMedicale;
globalThis.__SUIVI_MEDICAL_RULES = SUIVI_MEDICAL_RULES;
globalThis.__VISITE_MEDICALE_TYPE_LABELS = VISITE_MEDICALE_TYPE_LABELS;
globalThis.__openVisiteMedicaleModal = openVisiteMedicaleModal;
globalThis.__deleteVisiteMedicale = deleteVisiteMedicale;
globalThis.__visiteMedicaleConclusionBadgeClass = visiteMedicaleConclusionBadgeClass;
globalThis.__renderParametresListes = renderParametresListes;
globalThis.__renderParametresEntreprise = renderParametresEntreprise;
globalThis.__bindParametresEntrepriseEvents = bindParametresEntrepriseEvents;
globalThis.__handleExportToutesDonnees = handleExportToutesDonnees;
globalThis.__renderRequestActions = renderRequestActions;
globalThis.__openAttestationSalaireModal = openAttestationSalaireModal;
globalThis.__TYPE_ARRET_LABELS = TYPE_ARRET_LABELS;
globalThis.__isArretTravailType = isArretTravailType;
globalThis.__calculerEstimationIndemnitesArret = calculerEstimationIndemnitesArret;
globalThis.__releveBancaireRepository = releveBancaireRepository;
globalThis.__getAbsentsForQuota = getAbsentsForQuota;
globalThis.__necessiteVisiteReprise = necessiteVisiteReprise;
globalThis.__renderDelegationCard = renderDelegationCard;
globalThis.__openDelegationModal = openDelegationModal;
globalThis.__getVisitesRepriseAFaire = getVisitesRepriseAFaire;
globalThis.__renderVisitesRepriseCard = renderVisitesRepriseCard;
globalThis.__bindVisitesRepriseEvents = bindVisitesRepriseEvents;
globalThis.__getQuotasForEmployee = getQuotasForEmployee;
globalThis.__renderRapprochementBancaireCard = renderRapprochementBancaireCard;
globalThis.__bindRapprochementBancaireEvents = bindRapprochementBancaireEvents;
globalThis.__renderRemuneration = renderRemuneration;
globalThis.__bindRemunerationEvents = bindRemunerationEvents;
globalThis.__renderRevisionSalarialeCard = renderRevisionSalarialeCard;
globalThis.__openLancerRevisionSalarialeModal = openLancerRevisionSalarialeModal;
globalThis.__openProposerRevisionModal = openProposerRevisionModal;
globalThis.__renderConfidentialEmployeeCard = renderConfidentialEmployeeCard;
globalThis.__REVISION_STATUT_LABELS = REVISION_STATUT_LABELS;
globalThis.__CANDIDATURE_STATUT_LABELS = CANDIDATURE_STATUT_LABELS;
globalThis.__CANDIDATURE_STATUT_NEXT = CANDIDATURE_STATUT_NEXT;
globalThis.__renderCandidaturesBoard = renderCandidaturesBoard;
globalThis.__renderCandidatureCard = renderCandidatureCard;
globalThis.__candidatureToEmployeePrefill = candidatureToEmployeePrefill;
globalThis.__renderCarrierePage = renderCarrierePage;
globalThis.__carriereUrlForCompany = carriereUrlForCompany;
globalThis.__candidatureUrlForCompany = candidatureUrlForCompany;
globalThis.__guessAbsencesColumnMapping = guessAbsencesColumnMapping;
globalThis.__buildAbsencesPreviewRows = buildAbsencesPreviewRows;
globalThis.__importAbsencesRows = importAbsencesRows;
globalThis.__employeeFieldForRequest = employeeFieldForRequest;
globalThis.__buildAbsencesImportTemplateWorkbook = buildAbsencesImportTemplateWorkbook;
globalThis.__buildMultiSheetExcelXmlWorkbook = buildMultiSheetExcelXmlWorkbook;
globalThis.__computeWorkingDays = computeWorkingDays;
globalThis.__buildCreneauPropose = buildCreneauPropose;
globalThis.__EVALUATION_CANDIDATURE_CRITERES = EVALUATION_CANDIDATURE_CRITERES;
globalThis.__buildEvaluationRecord = buildEvaluationRecord;
globalThis.__computeEvaluationMoyenne = computeEvaluationMoyenne;
globalThis.__renderCandidatureCreneauxCard = renderCandidatureCreneauxCard;
globalThis.__renderCandidatureEvaluationsCard = renderCandidatureEvaluationsCard;
globalThis.__buildExcelXmlWorkbook = buildExcelXmlWorkbook;
globalThis.__downloadExcelXmlFile = downloadExcelXmlFile;
globalThis.__exportRowsToCSVWithDelimiter = exportRowsToCSVWithDelimiter;
globalThis.__exportLeaveRequestsCSV = exportLeaveRequestsCSV;
globalThis.__exportExpensesCSV = exportExpensesCSV;
globalThis.__buildCalendarExcelXmlWorkbook = buildCalendarExcelXmlWorkbook;
globalThis.__excelColumnWidths = excelColumnWidths;
globalThis.__excelXmlCell = excelXmlCell;
globalThis.__excelXmlEscape = excelXmlEscape;
globalThis.__renderParametresAbonnement = renderParametresAbonnement;
globalThis.__renderAbonnementAlaCarteComposer = renderAbonnementAlaCarteComposer;
globalThis.__renderAbonnementAlaCarteActif = renderAbonnementAlaCarteActif;
globalThis.__computeAbonnementAlacarteTotal = computeAbonnementAlacarteTotal;
globalThis.__bindParametresAbonnementEvents = bindParametresAbonnementEvents;
globalThis.__renderLoginView = renderLoginView;
globalThis.__bindLoginScreenEvents = bindLoginScreenEvents;
globalThis.__showLogin = showLogin;
globalThis.__renderExportPaiePreparationTab = renderExportPaiePreparationTab;
globalThis.__renderExportPaieExportTab = renderExportPaieExportTab;
globalThis.__openAttestationEmployeurModal = openAttestationEmployeurModal;
globalThis.__openCertificatTravailModal = openCertificatTravailModal;
globalThis.__renderPrintDocumentHeader = renderPrintDocumentHeader;
globalThis.__fetchConventionCollectiveFromSiret = fetchConventionCollectiveFromSiret;
globalThis.__secteurForConventionLabel = secteurForConventionLabel;
globalThis.__openRegistreUniquePersonnelModal = openRegistreUniquePersonnelModal;
globalThis.__exportEmployeesExcel = exportEmployeesExcel;
globalThis.__SETTINGS_LIST_USAGE_CHECK = SETTINGS_LIST_USAGE_CHECK;
globalThis.__EMPLOYEE_DETAIL_TABS = EMPLOYEE_DETAIL_TABS;
globalThis.__renderPermissionsCard = renderPermissionsCard;
globalThis.__getFilteredSortedEmployees = getFilteredSortedEmployees;
globalThis.__hasModuleLicense = hasModuleLicense;
globalThis.__licenseSummaryForModule = licenseSummaryForModule;
globalThis.__licenseAssignableEmployees = licenseAssignableEmployees;
globalThis.__ensureLicenseCapacity = ensureLicenseCapacity;
globalThis.__openGererLicencesModal = openGererLicencesModal;
globalThis.__releaseModuleLicensesForDeparture = releaseModuleLicensesForDeparture;
globalThis.__LICENSED_MODULE_KEYS = LICENSED_MODULE_KEYS;
globalThis.__computeTempsTravailAffichage = computeTempsTravailAffichage;
globalThis.__REGIME_RTT_OPTIONS = REGIME_RTT_OPTIONS;
globalThis.__libelleRegimeRTTAutoCalcul = libelleRegimeRTTAutoCalcul;
globalThis.__normalizeForDuplicateCheck = normalizeForDuplicateCheck;
globalThis.__findDuplicateInList = findDuplicateInList;
globalThis.__QUICK_ADD_LISTS = QUICK_ADD_LISTS;
globalThis.__SETTINGS_LISTS_RH = SETTINGS_LISTS_RH;
globalThis.__QUICK_CREATE_TYPES = QUICK_CREATE_TYPES;
`;
  vm.runInContext(appSource + exposeAfterApp, sandbox, { filename: 'app.js' });

  return {
    sandbox,
    DB: sandbox.__DB,
    CURRENT_COMPANY_KEY: sandbox.__CURRENT_COMPANY_KEY,
    shiftRepository: sandbox.__shiftRepository,
    shiftSwapRepository: sandbox.__shiftSwapRepository,
    weekTemplateRepository: sandbox.__weekTemplateRepository,
    documentTemplateRepository: sandbox.__documentTemplateRepository,
    CHAMPS_FUSION_MODELE: sandbox.__CHAMPS_FUSION_MODELE,
    openModeleDocumentModal: sandbox.__openModeleDocumentModal,
    openGenererDocumentModal: sandbox.__openGenererDocumentModal,
    confirmerAccuseLectureDocument: sandbox.__confirmerAccuseLectureDocument,
    documentExpirationInfo: sandbox.__documentExpirationInfo,
    renderParametresRegistrePersonnel: sandbox.__renderParametresRegistrePersonnel,
    renderShiftSwapCard: sandbox.__renderShiftSwapCard,
    renderComparaisonPrevuRealiseCard: sandbox.__renderComparaisonPrevuRealiseCard,
    openEnregistrerModeleSemaineModal: sandbox.__openEnregistrerModeleSemaineModal,
    openAppliquerModeleSemaineModal: sandbox.__openAppliquerModeleSemaineModal,
    openIndisponibiliteModal: sandbox.__openIndisponibiliteModal,
    renderParametresMonCompte: sandbox.__renderParametresMonCompte,
    bindParametresMonCompteEvents: sandbox.__bindParametresMonCompteEvents,
    employeeRepository: sandbox.__employeeRepository,
    computeShiftHeures: sandbox.__computeShiftHeures,
    seedExampleShifts: sandbox.__seedExampleShifts,
    pointageRepository: sandbox.__pointageRepository,
    etablissementRepository: sandbox.__etablissementRepository,
    serviceRepository: sandbox.__serviceRepository,
    categorieSalarieRepository: sandbox.__categorieSalarieRepository,
    computeDureeTravailleeMinutes: sandbox.__computeDureeTravailleeMinutes,
    calculerCoutEmployeurComplet: sandbox.__calculerCoutEmployeurComplet,
    revisionSalarialeRepository: sandbox.__revisionSalarialeRepository,
    settingsRepository: sandbox.__settingsRepository,
    candidatureRepository: sandbox.__candidatureRepository,
    DEFAULT_SETTINGS: sandbox.__DEFAULT_SETTINGS,
    formatCurrencyFR: sandbox.__formatCurrencyFR,
    formatNomFamille: sandbox.__formatNomFamille,
    formatPrenom: sandbox.__formatPrenom,
    syncNotifications: sandbox.__syncNotifications,
    hasModule: sandbox.__hasModule,
    navigateTo: sandbox.__navigateTo,
    render: sandbox.__render,
    state: sandbox.__state,
    PARAMETRES_TABS: sandbox.__PARAMETRES_TABS,
    LANDING_ALACARTE_MODULES: sandbox.__LANDING_ALACARTE_MODULES,
    LANDING_FEATURES: sandbox.__LANDING_FEATURES,
    renderMockCard: sandbox.__renderMockCard,
    renderFeatureDetailPage: sandbox.__renderFeatureDetailPage,
    openScreenshotLightbox: sandbox.__openScreenshotLightbox,
    LEGAL_CONTENT: sandbox.__LEGAL_CONTENT,
    openLegalModal: sandbox.__openLegalModal,
    renderLandingScreen: sandbox.__renderLandingScreen,
    computeAlacarteTotal: sandbox.__computeAlacarteTotal,
    bindLandingScreenEvents: sandbox.__bindLandingScreenEvents,
    renderPointeuse: sandbox.__renderPointeuse,
    joursDuMoisPointeuse: sandbox.__joursDuMoisPointeuse,
    shiftPointeuseHistoriqueMonth: sandbox.__shiftPointeuseHistoriqueMonth,
    enhanceScrollableTabs: sandbox.__enhanceScrollableTabs,
    renderPointeuseEquipe: sandbox.__renderPointeuseEquipe,
    openRegulariserPointageModal: sandbox.__openRegulariserPointageModal,
    renderEcartsPointageCard: sandbox.__renderEcartsPointageCard,
    renderRapportMensuelPointageCard: sandbox.__renderRapportMensuelPointageCard,
    bindPointeuseEvents: sandbox.__bindPointeuseEvents,
    canRegulariserPointages: sandbox.__canRegulariserPointages,
    openPointageQrModal: sandbox.__openPointageQrModal,
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
    renderTableauCompteurs: sandbox.__renderTableauCompteurs,
    exportTableauCompteursExcel: sandbox.__exportTableauCompteursExcel,
    renderListEmptyState: sandbox.__renderListEmptyState,
    matchesPeriodeFilter: sandbox.__matchesPeriodeFilter,
    sortListBy: sandbox.__sortListBy,
    renderSortableHeader: sandbox.__renderSortableHeader,
    bindSortableHeadersGlobalDelegation: sandbox.__bindSortableHeadersGlobalDelegation,
    getFilteredEntretiens: sandbox.__getFilteredEntretiens,
    exportEntretiensExcel: sandbox.__exportEntretiensExcel,
    getPaieAnomalies: sandbox.__getPaieAnomalies,
    getPaieRows: sandbox.__getPaieRows,
    getExpensePayableMonthKey: sandbox.__getExpensePayableMonthKey,
    updateExpenseKmHint: sandbox.__updateExpenseKmHint,
    submitExpenseForm: sandbox.__submitExpenseForm,
    openExpenseModal: sandbox.__openExpenseModal,
    expenseDossierRepository: sandbox.__expenseDossierRepository,
    openRegrouperDossierModal: sandbox.__openRegrouperDossierModal,
    updateExpenseCategoryFields: sandbox.__updateExpenseCategoryFields,
    renderExpenseDossiersCard: sandbox.__renderExpenseDossiersCard,
    handleApproveExpense: sandbox.__handleApproveExpense,
    refuseRequest: sandbox.__refuseRequest,
    expenseRepository: sandbox.__expenseRepository,
    renderFrais: sandbox.__renderFrais,
    renderParametresModelesDocuments: sandbox.__renderParametresModelesDocuments,
    renderAbsencesHub: sandbox.__renderAbsencesHub,
    teleworkRepository: sandbox.__teleworkRepository,
    leaveRepository: sandbox.__leaveRepository,
    renderDashboardActionCenter: sandbox.__renderDashboardActionCenter,
    renderCalendrierValidationsCard: sandbox.__renderCalendrierValidationsCard,
    exportTicketsCSV: sandbox.__exportTicketsCSV,
    getTicketsRows: sandbox.__getTicketsRows,
    genererFichierCommandeTickets: sandbox.__genererFichierCommandeTickets,
    openCorrigerTicketsModal: sandbox.__openCorrigerTicketsModal,
    renderTicketsEquipe: sandbox.__renderTicketsEquipe,
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
    renderEntretienDetail: sandbox.__renderEntretienDetail,
    bindEntretienDetailEvents: sandbox.__bindEntretienDetailEvents,
    renderEntretiens: sandbox.__renderEntretiens,
    renderCampagnesEntretienCard: sandbox.__renderCampagnesEntretienCard,
    openLancerCampagneModal: sandbox.__openLancerCampagneModal,
    openGererTramesModal: sandbox.__openGererTramesModal,
    entretienTrameRepository: sandbox.__entretienTrameRepository,
    entretienCampagneRepository: sandbox.__entretienCampagneRepository,
    resolvePopulationEmployeeIds: sandbox.__resolvePopulationEmployeeIds,
    openValiderEntretienModal: sandbox.__openValiderEntretienModal,
    getObjectifsReconduits: sandbox.__getObjectifsReconduits,
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
    renderCongesTypes: sandbox.__renderCongesTypes,
    bindCongesTypesEvents: sandbox.__bindCongesTypesEvents,
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
    renderTeletravailPlanning: sandbox.__renderTeletravailPlanning,
    getWeekDates: sandbox.__getWeekDates,
    toISODate: sandbox.__toISODate,
    openShiftModal: sandbox.__openShiftModal,
    renderAvatar: sandbox.__renderAvatar,
    resolveAvatarUrl: sandbox.__resolveAvatarUrl,
    hydrateAvatarImages: sandbox.__hydrateAvatarImages,
    reportClientError: sandbox.__reportClientError,
    renderEmployeeFraisCard: sandbox.__renderEmployeeFraisCard,
    ensureFraisTotalsLoaded: sandbox.__ensureFraisTotalsLoaded,
    renderEmployeeDetail: sandbox.__renderEmployeeDetail,
    openAjouterAvenantModal: sandbox.__openAjouterAvenantModal,
    openNouveauContratModal: sandbox.__openNouveauContratModal,
    renderEmployeeContratTab: sandbox.__renderEmployeeContratTab,
    computeNextVisiteMedicale: sandbox.__computeNextVisiteMedicale,
    getLatestVisiteMedicale: sandbox.__getLatestVisiteMedicale,
    SUIVI_MEDICAL_RULES: sandbox.__SUIVI_MEDICAL_RULES,
    VISITE_MEDICALE_TYPE_LABELS: sandbox.__VISITE_MEDICALE_TYPE_LABELS,
    openVisiteMedicaleModal: sandbox.__openVisiteMedicaleModal,
    deleteVisiteMedicale: sandbox.__deleteVisiteMedicale,
    visiteMedicaleConclusionBadgeClass: sandbox.__visiteMedicaleConclusionBadgeClass,
    renderParametresListes: sandbox.__renderParametresListes,
    renderParametresEntreprise: sandbox.__renderParametresEntreprise,
    bindParametresEntrepriseEvents: sandbox.__bindParametresEntrepriseEvents,
    handleExportToutesDonnees: sandbox.__handleExportToutesDonnees,
    renderRequestActions: sandbox.__renderRequestActions,
    openAttestationSalaireModal: sandbox.__openAttestationSalaireModal,
    TYPE_ARRET_LABELS: sandbox.__TYPE_ARRET_LABELS,
    isArretTravailType: sandbox.__isArretTravailType,
    calculerEstimationIndemnitesArret: sandbox.__calculerEstimationIndemnitesArret,
    releveBancaireRepository: sandbox.__releveBancaireRepository,
    getAbsentsForQuota: sandbox.__getAbsentsForQuota,
    necessiteVisiteReprise: sandbox.__necessiteVisiteReprise,
    renderDelegationCard: sandbox.__renderDelegationCard,
    openDelegationModal: sandbox.__openDelegationModal,
    getVisitesRepriseAFaire: sandbox.__getVisitesRepriseAFaire,
    renderVisitesRepriseCard: sandbox.__renderVisitesRepriseCard,
    bindVisitesRepriseEvents: sandbox.__bindVisitesRepriseEvents,
    getQuotasForEmployee: sandbox.__getQuotasForEmployee,
    renderRapprochementBancaireCard: sandbox.__renderRapprochementBancaireCard,
    bindRapprochementBancaireEvents: sandbox.__bindRapprochementBancaireEvents,
    renderRemuneration: sandbox.__renderRemuneration,
    bindRemunerationEvents: sandbox.__bindRemunerationEvents,
    renderRevisionSalarialeCard: sandbox.__renderRevisionSalarialeCard,
    openLancerRevisionSalarialeModal: sandbox.__openLancerRevisionSalarialeModal,
    openProposerRevisionModal: sandbox.__openProposerRevisionModal,
    renderConfidentialEmployeeCard: sandbox.__renderConfidentialEmployeeCard,
    REVISION_STATUT_LABELS: sandbox.__REVISION_STATUT_LABELS,
    CANDIDATURE_STATUT_LABELS: sandbox.__CANDIDATURE_STATUT_LABELS,
    CANDIDATURE_STATUT_NEXT: sandbox.__CANDIDATURE_STATUT_NEXT,
    renderCandidaturesBoard: sandbox.__renderCandidaturesBoard,
    renderCandidatureCard: sandbox.__renderCandidatureCard,
    candidatureToEmployeePrefill: sandbox.__candidatureToEmployeePrefill,
    renderCarrierePage: sandbox.__renderCarrierePage,
    carriereUrlForCompany: sandbox.__carriereUrlForCompany,
    candidatureUrlForCompany: sandbox.__candidatureUrlForCompany,
    getStatusForDate: sandbox.__getStatusForDate,
    getHalfDayForDate: sandbox.__getHalfDayForDate,
    computeAbsenceCalendarSegments: sandbox.__computeAbsenceCalendarSegments,
    renderAbsenceCalendarRow: sandbox.__renderAbsenceCalendarRow,
    renderAbsenceCalendarBoard: sandbox.__renderAbsenceCalendarBoard,
    leaveTypeRepository: sandbox.__leaveTypeRepository,
    openLeaveRequestModal: sandbox.__openLeaveRequestModal,
    updateLeaveRequestHints: sandbox.__updateLeaveRequestHints,
    submitLeaveRequestForm: sandbox.__submitLeaveRequestForm,
    guessAbsencesColumnMapping: sandbox.__guessAbsencesColumnMapping,
    buildAbsencesPreviewRows: sandbox.__buildAbsencesPreviewRows,
    importAbsencesRows: sandbox.__importAbsencesRows,
    employeeFieldForRequest: sandbox.__employeeFieldForRequest,
    buildAbsencesImportTemplateWorkbook: sandbox.__buildAbsencesImportTemplateWorkbook,
    buildMultiSheetExcelXmlWorkbook: sandbox.__buildMultiSheetExcelXmlWorkbook,
    computeWorkingDays: sandbox.__computeWorkingDays,
    buildCreneauPropose: sandbox.__buildCreneauPropose,
    EVALUATION_CANDIDATURE_CRITERES: sandbox.__EVALUATION_CANDIDATURE_CRITERES,
    buildEvaluationRecord: sandbox.__buildEvaluationRecord,
    computeEvaluationMoyenne: sandbox.__computeEvaluationMoyenne,
    renderCandidatureCreneauxCard: sandbox.__renderCandidatureCreneauxCard,
    renderCandidatureEvaluationsCard: sandbox.__renderCandidatureEvaluationsCard,
    companyRepository: sandbox.__companyRepository,
    billingRepository: sandbox.__billingRepository,
    calculerJoursRTTAutoForfaitJours: sandbox.__calculerJoursRTTAutoForfaitJours,
    getSexe: sandbox.__getSexe,
    getCiviliteAffichee: sandbox.__getCiviliteAffichee,
    ensureCiviliteSexeMigresVersServeur: sandbox.__ensureCiviliteSexeMigresVersServeur,
    makeEmptyEmployee: sandbox.__makeEmptyEmployee,
    parsePosteGenre: sandbox.__parsePosteGenre,
    getPosteAccorde: sandbox.__getPosteAccorde,
    ensurePostesGenresBackfilled: sandbox.__ensurePostesGenresBackfilled,
    ensureContratsTermineDateDepartAutoDeduite: sandbox.__ensureContratsTermineDateDepartAutoDeduite,
    ROLES: sandbox.__ROLES,
    seedDocumentTemplatesDefaut: sandbox.__seedDocumentTemplatesDefaut,
    ensureDocumentTemplatesAttestationCertificatBackfilled: sandbox.__ensureDocumentTemplatesAttestationCertificatBackfilled,
    ensureContratsBackfilled: sandbox.__ensureContratsBackfilled,
    renderParametresAbonnement: sandbox.__renderParametresAbonnement,
    renderAbonnementAlaCarteComposer: sandbox.__renderAbonnementAlaCarteComposer,
    renderAbonnementAlaCarteActif: sandbox.__renderAbonnementAlaCarteActif,
    computeAbonnementAlacarteTotal: sandbox.__computeAbonnementAlacarteTotal,
    bindParametresAbonnementEvents: sandbox.__bindParametresAbonnementEvents,
    renderLoginView: sandbox.__renderLoginView,
    bindLoginScreenEvents: sandbox.__bindLoginScreenEvents,
    showLogin: sandbox.__showLogin,
    renderExportPaiePreparationTab: sandbox.__renderExportPaiePreparationTab,
    renderExportPaieExportTab: sandbox.__renderExportPaieExportTab,
    openAttestationEmployeurModal: sandbox.__openAttestationEmployeurModal,
    openCertificatTravailModal: sandbox.__openCertificatTravailModal,
    renderPrintDocumentHeader: sandbox.__renderPrintDocumentHeader,
    fetchConventionCollectiveFromSiret: sandbox.__fetchConventionCollectiveFromSiret,
    secteurForConventionLabel: sandbox.__secteurForConventionLabel,
    openRegistreUniquePersonnelModal: sandbox.__openRegistreUniquePersonnelModal,
    exportEmployeesExcel: sandbox.__exportEmployeesExcel,
    SETTINGS_LIST_USAGE_CHECK: sandbox.__SETTINGS_LIST_USAGE_CHECK,
    EMPLOYEE_DETAIL_TABS: sandbox.__EMPLOYEE_DETAIL_TABS,
    renderPermissionsCard: sandbox.__renderPermissionsCard,
    getFilteredSortedEmployees: sandbox.__getFilteredSortedEmployees,
    buildExcelXmlWorkbook: sandbox.__buildExcelXmlWorkbook,
    downloadExcelXmlFile: sandbox.__downloadExcelXmlFile,
    exportRowsToCSVWithDelimiter: sandbox.__exportRowsToCSVWithDelimiter,
    exportLeaveRequestsCSV: sandbox.__exportLeaveRequestsCSV,
    exportExpensesCSV: sandbox.__exportExpensesCSV,
    buildCalendarExcelXmlWorkbook: sandbox.__buildCalendarExcelXmlWorkbook,
    excelColumnWidths: sandbox.__excelColumnWidths,
    excelXmlCell: sandbox.__excelXmlCell,
    excelXmlEscape: sandbox.__excelXmlEscape,
    hasModuleLicense: sandbox.__hasModuleLicense,
    licenseSummaryForModule: sandbox.__licenseSummaryForModule,
    licenseAssignableEmployees: sandbox.__licenseAssignableEmployees,
    ensureLicenseCapacity: sandbox.__ensureLicenseCapacity,
    openGererLicencesModal: sandbox.__openGererLicencesModal,
    releaseModuleLicensesForDeparture: sandbox.__releaseModuleLicensesForDeparture,
    LICENSED_MODULE_KEYS: sandbox.__LICENSED_MODULE_KEYS,
    computeTempsTravailAffichage: sandbox.__computeTempsTravailAffichage,
    REGIME_RTT_OPTIONS: sandbox.__REGIME_RTT_OPTIONS,
    libelleRegimeRTTAutoCalcul: sandbox.__libelleRegimeRTTAutoCalcul,
    normalizeForDuplicateCheck: sandbox.__normalizeForDuplicateCheck,
    findDuplicateInList: sandbox.__findDuplicateInList,
    QUICK_ADD_LISTS: sandbox.__QUICK_ADD_LISTS,
    SETTINGS_LISTS_RH: sandbox.__SETTINGS_LISTS_RH,
    QUICK_CREATE_TYPES: sandbox.__QUICK_CREATE_TYPES,
  };
}

module.exports = { loadAppJs };
