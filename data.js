/**
 * Seven RH — Couche de données
 * Persistance localStorage + modèle de données + listes de référence.
 * Toute liste "métier" (services, postes, conventions...) vit dans DB.settings
 * pour rester paramétrable depuis un futur module Paramètres, plutôt que
 * codée en dur dans les vues.
 */

const ROOT_KEY = 'sevenrh_companies';
const CURRENT_COMPANY_KEY = 'sevenrh_current_company_id';
const SESSION_KEY = 'sevenrh_session';
const NOTIF_STORAGE_LIMIT = 500; // même logique que le Journal d'audit (borné à 2000) : évite une croissance illimitée du blob localStorage au fil des années

/**
 * Administrateur BERTOLIS (§9.6) — l'éditeur du logiciel, PAS un salarié d'une entreprise cliente.
 * Stocké hors de ROOT_KEY (aucune entreprise ne le "possède") avec sa propre clé de session, pour
 * qu'un accès BERTOLIS ne puisse jamais se confondre avec une session salarié d'entreprise.
 */
const BERTOLIS_ADMINS_KEY = 'sevenrh_bertolis_admins';
const BERTOLIS_SESSION_KEY = 'sevenrh_bertolis_session';

/**
 * Rôles disponibles et niveau d'accès associé. IMPORTANT — ceci est une simulation
 * de rôles côté navigateur, pas un vrai contrôle d'accès serveur : toute personne
 * ouvrant les outils de développement peut lire/modifier localStorage directement.
 * Utile pour valider les écrans et le workflow, pas pour un déploiement multi-utilisateurs réel.
 */
const ROLES = {
  SALARIE: 'salarie',
  MANAGER: 'manager',
  RH: 'rh',
  COMPTABILITE: 'comptabilite',
  DIRECTEUR: 'directeur'
};

const ROLE_LABELS = {
  salarie: 'Salarié',
  manager: 'Manager',
  rh: 'RH',
  comptabilite: 'Comptabilité',
  directeur: 'Directeur'
};

/**
 * Catalogue des permissions individuelles (§8 du cahier des charges). Chaque droit peut être
 * activé/désactivé indépendamment du rôle via `employee.permissionsOverrides`. IMPORTANT — comme
 * pour les rôles (voir plus haut), ceci reste une simulation côté navigateur : la vérification
 * réelle devra être refaite côté serveur dans la version commerciale (§8, dernière ligne).
 */
const PERMISSIONS = {
  VOIR_PROPRE_FICHE: 'voirPropreFiche',
  MODIFIER_PROPRES_COORDONNEES: 'modifierPropresCoordonnees',
  VOIR_SALARIES: 'voirSalaries',
  VOIR_EQUIPE: 'voirEquipe',
  CREER_SALARIE: 'creerSalarie',
  MODIFIER_SALARIE: 'modifierSalarie',
  ARCHIVER_SALARIE: 'archiverSalarie',
  SUPPRIMER_SALARIE: 'supprimerSalarie',
  VOIR_INFOS_CONTRACTUELLES: 'voirInfosContractuelles',
  VOIR_INFOS_FINANCIERES: 'voirInfosFinancieres',
  VOIR_COMPTEURS: 'voirCompteurs',
  MODIFIER_COMPTEURS: 'modifierCompteurs',
  CREER_DEMANDE_ABSENCE: 'creerDemandeAbsence',
  VALIDER_ABSENCE: 'validerAbsence',
  REFUSER_ABSENCE: 'refuserAbsence',
  ANNULER_ABSENCE: 'annulerAbsence',
  SAISIR_MALADIE: 'saisirMaladie',
  PROLONGER_MALADIE: 'prolongerMaladie',
  VOIR_CALENDRIER_GENERAL: 'voirCalendrierGeneral',
  VOIR_CALENDRIER_EQUIPE: 'voirCalendrierEquipe',
  CREER_NOTE_FRAIS: 'creerNoteFrais',
  VALIDER_NOTE_FRAIS: 'validerNoteFrais',
  CONTROLER_NOTE_FRAIS: 'controlerNoteFrais',
  MARQUER_NOTE_REMBOURSEE: 'marquerNoteRemboursee',
  CALCULER_TICKETS_RESTAURANT: 'calculerTicketsRestaurant',
  CORRIGER_TICKETS_RESTAURANT: 'corrigerTicketsRestaurant',
  EXPORTER_PAIE: 'exporterPaie',
  GERER_PARAMETRES: 'gererParametres',
  GERER_UTILISATEURS: 'gererUtilisateurs',
  GERER_PERMISSIONS: 'gererPermissions',
  VOIR_JOURNAL_AUDIT: 'voirJournalAudit',
  GERER_ABONNEMENTS: 'gererAbonnements'
};

/** Permissions accordées par défaut à chaque rôle — reproduit le comportement actuel de l'app
 * (avant l'introduction des permissions individuelles), pour que le passage à ce système ne change
 * rien tant qu'aucune surcharge individuelle n'est définie sur un salarié. */
const DEFAULT_ROLE_PERMISSIONS = {
  salarie: [
    PERMISSIONS.VOIR_PROPRE_FICHE, PERMISSIONS.MODIFIER_PROPRES_COORDONNEES, PERMISSIONS.VOIR_COMPTEURS,
    PERMISSIONS.CREER_DEMANDE_ABSENCE, PERMISSIONS.CREER_NOTE_FRAIS, PERMISSIONS.VOIR_CALENDRIER_GENERAL
  ],
  // VALIDER_ABSENCE / REFUSER_ABSENCE / VALIDER_NOTE_FRAIS ne sont PAS accordés au manager par défaut :
  // dans canActOnRequestFor/canManageRequestFor, ces clés déclenchent un accès complet (bypass), sans
  // restriction d'équipe. Un manager valide via le mécanisme normal (son rôle == l'étape du workflow en
  // cours + appartenance à l'équipe du salarié) ; lui accorder ces permissions par défaut romprait la
  // règle "un manager n'agit que sur son équipe" pour l'ensemble de l'entreprise.
  manager: [
    PERMISSIONS.VOIR_PROPRE_FICHE, PERMISSIONS.MODIFIER_PROPRES_COORDONNEES, PERMISSIONS.VOIR_COMPTEURS,
    PERMISSIONS.CREER_DEMANDE_ABSENCE, PERMISSIONS.CREER_NOTE_FRAIS, PERMISSIONS.VOIR_CALENDRIER_GENERAL,
    PERMISSIONS.VOIR_EQUIPE, PERMISSIONS.VOIR_CALENDRIER_EQUIPE,
    // Contrairement à VALIDER_NOTE_FRAIS (bypass company-wide), CONTROLER_NOTE_FRAIS ne fait que
    // confirmer le rôle manager à l'étape non-finale du workflow frais (cf. canActOnRequestFor) —
    // sans lui, un manager ne pourrait plus agir sur les notes de frais de sa propre équipe.
    PERMISSIONS.CONTROLER_NOTE_FRAIS
  ],
  rh: [
    PERMISSIONS.VOIR_PROPRE_FICHE, PERMISSIONS.MODIFIER_PROPRES_COORDONNEES, PERMISSIONS.VOIR_COMPTEURS,
    PERMISSIONS.CREER_DEMANDE_ABSENCE, PERMISSIONS.CREER_NOTE_FRAIS, PERMISSIONS.VOIR_CALENDRIER_GENERAL,
    PERMISSIONS.VOIR_SALARIES, PERMISSIONS.VOIR_CALENDRIER_EQUIPE, PERMISSIONS.CREER_SALARIE,
    PERMISSIONS.MODIFIER_SALARIE, PERMISSIONS.ARCHIVER_SALARIE, PERMISSIONS.VOIR_INFOS_CONTRACTUELLES,
    PERMISSIONS.MODIFIER_COMPTEURS, PERMISSIONS.VALIDER_ABSENCE,
    PERMISSIONS.REFUSER_ABSENCE, PERMISSIONS.ANNULER_ABSENCE, PERMISSIONS.SAISIR_MALADIE,
    PERMISSIONS.PROLONGER_MALADIE, PERMISSIONS.VALIDER_NOTE_FRAIS, PERMISSIONS.CALCULER_TICKETS_RESTAURANT,
    PERMISSIONS.CORRIGER_TICKETS_RESTAURANT, PERMISSIONS.EXPORTER_PAIE, PERMISSIONS.GERER_PARAMETRES,
    PERMISSIONS.GERER_UTILISATEURS, PERMISSIONS.VOIR_JOURNAL_AUDIT
  ],
  comptabilite: [
    PERMISSIONS.VOIR_PROPRE_FICHE, PERMISSIONS.MODIFIER_PROPRES_COORDONNEES, PERMISSIONS.VOIR_COMPTEURS,
    PERMISSIONS.CREER_DEMANDE_ABSENCE, PERMISSIONS.CREER_NOTE_FRAIS, PERMISSIONS.VOIR_CALENDRIER_GENERAL,
    PERMISSIONS.CONTROLER_NOTE_FRAIS, PERMISSIONS.MARQUER_NOTE_REMBOURSEE,
    // Sans CORRIGER_TICKETS_RESTAURANT : la Comptabilité consulte/exporte les tickets restaurant mais
    // ne corrige pas manuellement le calcul (réservé à RH/Directeur, cf. les compteurs de congés).
    PERMISSIONS.CALCULER_TICKETS_RESTAURANT
  ],
  directeur: Object.values(PERMISSIONS)
};

/** Vérifie une permission individuelle : une surcharge explicite sur le salarié (true ou false)
 * prime toujours sur le défaut de son rôle. */
function hasPermission(employee, permissionKey) {
  if (!employee) return false;
  const overrides = employee.permissionsOverrides || {};
  if (Object.prototype.hasOwnProperty.call(overrides, permissionKey)) return Boolean(overrides[permissionKey]);
  return (DEFAULT_ROLE_PERMISSIONS[employee.role] || []).includes(permissionKey);
}

/** Taux de TVA français en vigueur (loi fiscale, non paramétrable par l'entreprise). */
const TVA_RATES = [20, 10, 5.5, 2.1, 0];

/**
 * Offres commerciales BERTOLIS (§36) — point de départ configurable, pas une grille tarifaire figée :
 * BERTOLIS ajuste les plafonds selon ses propres offres commerciales. Seul le plafond de salariés est
 * suivi pour l'instant (affiché à titre indicatif) ; le blocage réel de fonctionnalités par offre et
 * la console de gestion BERTOLIS (activer/suspendre une entreprise, facturation) restent à construire.
 */
const OFFRES_BERTOLIS = {
  essai: { label: 'Essai gratuit', nombreSalariesMax: null },
  essentiel: { label: 'Essentiel', nombreSalariesMax: 25 },
  professionnel: { label: 'Professionnel', nombreSalariesMax: 100 },
  premium: { label: 'Premium', nombreSalariesMax: null }
};

const ABONNEMENT_STATUT_LABELS = {
  actif: 'Actif',
  impaye: 'Impayé',
  suspendu: 'Suspendu',
  resilie: 'Résilié'
};

function makeEmptyAbonnement() {
  return {
    offre: 'essai', // clé de OFFRES_BERTOLIS
    periodicite: 'mensuel', // 'mensuel' | 'annuel'
    statut: 'actif', // voir ABONNEMENT_STATUT_LABELS
    dateDebut: toISODate(new Date()),
    dateRenouvellement: '',
    nombreSalariesMax: OFFRES_BERTOLIS.essai.nombreSalariesMax
  };
}

/**
 * Modèles d'export paie (§34). IMPORTANT — ce sont des POINTS DE DÉPART configurables, pas des
 * formats certifiés : Sage/Silae/Cegid/ADP/PayFit ont des specs d'import propriétaires qui varient
 * selon la version et le paramétrage de chaque client, et l'app n'a pas accès à ces specs exactes.
 * Chaque modèle ne fixe que des conventions courantes et peu risquées (délimiteur), jamais un
 * mappage de colonnes prétendument garanti — voir le message affiché sur l'écran Export paie.
 * "personnalise" est le seul mode où les colonnes elles-mêmes sont configurables (voir
 * settings.exportPaieColonnes).
 */
const EXPORT_PAIE_MODELES = {
  generique: { label: 'Générique (CSV standard)', delimiter: ';' },
  sage: { label: 'Sage', delimiter: ';' },
  silae: { label: 'Silae', delimiter: ';' },
  cegid: { label: 'Cegid', delimiter: ';' },
  adp: { label: 'ADP', delimiter: ',' },
  payfit: { label: 'PayFit', delimiter: ';' },
  personnalise: { label: 'Personnalisé', delimiter: ';' }
};

// Listes de référence par défaut (modifiables via DB.settings une fois le
// module Paramètres construit — elles ne sont donc pas figées dans le code).
const DEFAULT_SETTINGS = {
  // Les services/équipes ont leur propre catalogue structuré (company.services), pas une simple
  // liste de textes : voir makeEmptyService()/seedServices() et l'onglet Paramètres dédié.
  postes: ['Directeur·rice général·e', 'Responsable RH', 'Chargé·e RH', 'Comptable', 'Commercial·e', 'Développeur·se', 'Technicien·ne support'],
  conventionsCollectives: ['Métallurgie', 'Commerce de détail', 'Bureaux d\'études techniques (Syntec)', 'Transport routier', 'Hôtellerie-restauration', 'Aucune'],
  statutsPro: ['Non cadre', 'Cadre', 'Agent de maîtrise', 'Dirigeant'],
  typesContrat: ['CDI', 'CDD', 'Stage', 'Alternance', 'Apprentissage', 'Intérim'],
  forfaits: ['Aucun', 'Forfait jours', 'Forfait heures'],
  joursOuvres: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'],
  schoolZone: 'C', // 'A' | 'B' | 'C' — code court, aligné avec LeaveType.zones / seedSchoolHolidays()
  teletravailQuotaSemaine: 2,
  categoriesFrais: ['Transport', 'Repas', 'Hébergement', 'Fournitures', 'Kilométrique', 'Autre'],
  ticketsValeurFaciale: 9,
  ticketsPartEmployeurPct: 60,
  ticketsInclureTeletravail: true,
  // Chaînes de validation par défaut (voir advanceWorkflow) : modifiables dans Paramètres.
  // workflowCongesDefault sert de modèle pré-rempli à la création d'un nouveau type de congé.
  workflowCongesDefault: ['manager', 'rh'],
  workflowTeletravail: ['manager'],
  workflowFrais: ['manager', 'comptabilite'],
  categoriesDocuments: ['Contrat', 'Avenant', 'Permis', 'CNI', 'Passeport', 'Visite médicale', 'Habilitation', 'Diplôme', 'Attestation', 'Bulletin de paie', 'Autre'],
  // Indicateurs sensibles du tableau de bord Directeur, désactivés par défaut (opt-in) :
  // la masse salariale, le genre et la pyramide des âges restent des données que l'entreprise
  // choisit de suivre ou non (cf. l'avertissement affiché juste au-dessus de ces cases à cocher).
  masseSalarialeActivee: false,
  suiviGenreActive: false,
  suiviAgeActive: false,
  // §34 — voir EXPORT_PAIE_MODELES ; exportPaieColonnes n'est utilisé que si exportPaieModele === 'personnalise'.
  exportPaieModele: 'generique',
  exportPaieColonnes: { conges: true, teletravail: true, tickets: true, frais: true }
};

/**
 * Structure complète d'une entreprise. Seven RH est conçu multi-entreprises dès
 * aujourd'hui (même s'il n'y en a qu'une seule en pratique) : chaque entreprise
 * porte l'intégralité de ses propres données, isolées des autres. Cela permettra
 * de vendre Seven RH à plusieurs clients sans réécrire l'application, et de migrer
 * plus tard vers une vraie API/base de données en ne changeant que cette couche.
 */
function makeEmptyCompany() {
  return {
    id: null,
    raisonSociale: '',
    logo: null,
    siret: '',
    tva: '',
    adresse: '',
    telephone: '',
    email: '',
    conventionCollective: 'Aucune',
    matriculeSeq: 0,
    abonnement: null, // §36 — voir makeEmptyAbonnement()/migrateCompanyAbonnement()
    etablissements: [],
    employees: [],
    services: [],
    settings: Object.assign({}, DEFAULT_SETTINGS),
    leaveTypes: [],
    leaveRequests: [],
    teleworkRequests: [],
    expenses: [],
    documents: [],
    schoolHolidays: null,
    auditLog: [],
    favorites: {}, // { [idDuSalariéConnecté]: [idsSalariésFavoris] } — personnel à chaque utilisateur, pas partagé
    notifications: []
  };
}

/** Entreprise de démonstration chargée au tout premier lancement. */
function seedCompany() {
  const company = makeEmptyCompany();
  return Object.assign(company, {
    id: generateId('company'),
    raisonSociale: 'Seven RH Demo',
    siret: '000 000 000 00000',
    tva: 'FR00 000000000',
    adresse: '1 rue de la Paix, 75000 Paris',
    telephone: '01 23 45 67 89',
    email: 'contact@sevenrh-demo.fr',
    conventionCollective: 'Aucune',
    matriculeSeq: 6,
    employees: seedEmployees(),
    services: seedServices(),
    leaveTypes: seedLeaveTypes(),
    schoolHolidays: seedSchoolHolidays()
  });
}

/** Ajoute un établissement principal par défaut aux entreprises créées avant l'existence de ce
 * concept (§12), et rattache tout salarié qui n'en a pas encore un — migration idempotente et sans
 * perte de données (ne touche à rien si l'entreprise a déjà au moins un établissement). Appelée à
 * la fois par DB.init() (entreprises déjà en localStorage) et createCompanyFromOnboarding()
 * (nouvelles entreprises), pour ne jamais laisser une entreprise sans établissement. */
function migrateCompanyEtablissements(company) {
  if (company.etablissements && company.etablissements.length > 0) return false;
  const etab = Object.assign(makeEmptyEtablissement(), {
    id: generateId('etab'),
    nom: 'Siège',
    adresse: company.adresse || '',
    telephone: company.telephone || '',
    email: company.email || '',
    principal: true,
    actif: true
  });
  company.etablissements = [etab];
  company.employees.forEach(e => { if (!e.etablissementId) e.etablissementId = etab.id; });
  return true;
}

/** Ajoute `categorie` ('conge' §14 | 'autre' §15) aux types de congés créés avant l'existence de ce
 * champ. Heuristique par nom pour les 3 types "congés classiques" (congés payés, RTT, ancienneté) ;
 * tout le reste devient 'autre' par défaut — l'entreprise peut reclasser ensuite depuis Paramètres.
 * Idempotent : ne touche à rien si un type a déjà une catégorie. */
function migrateLeaveTypeCategories(company) {
  const CONGE_NAMES = ['congés payés', 'rtt', 'ancienneté'];
  let changed = false;
  (company.leaveTypes || []).forEach(t => {
    if (t.categorie) return;
    t.categorie = CONGE_NAMES.includes(t.nom.trim().toLowerCase()) ? 'conge' : 'autre';
    changed = true;
  });
  return changed;
}

/** Ajoute saisiParSalarie (§15) aux types créés avant l'existence de ce champ — "Maladie" seul
 * repasse à false par défaut (§24 : "saisis uniquement par le service RH"), le reste garde true
 * (comportement actuel inchangé) : l'entreprise peut reclasser ensuite depuis Paramètres. */
function migrateLeaveTypeSaisiParSalarie(company) {
  let changed = false;
  (company.leaveTypes || []).forEach(t => {
    if ('saisiParSalarie' in t) return;
    t.saisiParSalarie = t.nom.trim().toLowerCase() !== 'maladie';
    changed = true;
  });
  return changed;
}

/** Ajoute un abonnement par défaut (§36, offre "Essai gratuit") aux entreprises créées avant
 * l'existence de ce champ. Idempotent : ne touche à rien si l'entreprise a déjà un abonnement. */
function migrateCompanyAbonnement(company) {
  if (company.abonnement) return false;
  company.abonnement = makeEmptyAbonnement();
  return true;
}

/** Cœur de la journalisation d'audit, partagé par DB.logAudit() (entreprise courante de la
 * session) et toute action qui cible une entreprise précise sans que ce soit "l'entreprise
 * courante" — ex. les actions BERTOLIS (§9.6), qui n'ont pas de notion d'entreprise courante. */
function appendAuditLogEntry(company, action, entite, cible, details) {
  const list = company.auditLog || [];
  list.push({
    id: generateId('log'),
    date: new Date().toISOString(),
    action, entite,
    cible: cible || '',
    details: details || ''
  });
  company.auditLog = list.length > 2000 ? list.slice(list.length - 2000) : list;
}

const DB = {
  /** Initialise le stockage au premier lancement (seed de démo) : une entreprise, active par défaut. Re-seed aussi si les données existantes sont absentes OU corrompues (getCompanies() retombe sur [] dans ce cas). */
  init() {
    if (localStorage.getItem(ROOT_KEY) === null || this.getCompanies().length === 0) {
      const company = seedCompany();
      localStorage.setItem(ROOT_KEY, JSON.stringify([company]));
      localStorage.setItem(CURRENT_COMPANY_KEY, company.id);
    }
    if (localStorage.getItem(CURRENT_COMPANY_KEY) === null) {
      const companies = this.getCompanies();
      if (companies.length) localStorage.setItem(CURRENT_COMPANY_KEY, companies[0].id);
    }
    const companies = this.getCompanies();
    const migratedEtablissements = companies.map(c => migrateCompanyEtablissements(c)).some(Boolean);
    const migratedLeaveCategories = companies.map(c => migrateLeaveTypeCategories(c)).some(Boolean);
    const migratedAbonnements = companies.map(c => migrateCompanyAbonnement(c)).some(Boolean);
    const migratedSaisiParSalarie = companies.map(c => migrateLeaveTypeSaisiParSalarie(c)).some(Boolean);
    if (migratedEtablissements || migratedLeaveCategories || migratedAbonnements || migratedSaisiParSalarie) this.saveCompanies(companies);

    if (localStorage.getItem(BERTOLIS_ADMINS_KEY) === null) {
      localStorage.setItem(BERTOLIS_ADMINS_KEY, JSON.stringify([
        { id: generateId('bertolis'), prenom: 'Admin', nom: 'BERTOLIS', email: 'admin@bertolis.fr', motDePasse: 'Bertolis1234' }
      ]));
    }
  },

  // ---- Administrateur BERTOLIS (§9.6) — hors périmètre entreprise, voir BERTOLIS_ADMINS_KEY ----

  getBertolisAdmins() {
    try { return JSON.parse(localStorage.getItem(BERTOLIS_ADMINS_KEY) || '[]'); }
    catch (err) { return []; }
  },

  bertolisLogin(email, password) {
    const admin = this.getBertolisAdmins().find(a => a.email.toLowerCase() === (email || '').toLowerCase().trim());
    if (!admin || admin.motDePasse !== password) return { success: false, error: 'Email ou mot de passe incorrect.' };
    sessionStorage.setItem(BERTOLIS_SESSION_KEY, JSON.stringify({ adminId: admin.id }));
    return { success: true, admin };
  },

  bertolisLogout() {
    sessionStorage.removeItem(BERTOLIS_SESSION_KEY);
  },

  getCurrentBertolisAdmin() {
    let session;
    try { session = JSON.parse(sessionStorage.getItem(BERTOLIS_SESSION_KEY) || 'null'); }
    catch (err) { return null; }
    if (!session) return null;
    return this.getBertolisAdmins().find(a => a.id === session.adminId) || null;
  },

  isBertolisLoggedIn() {
    return this.getCurrentBertolisAdmin() !== null;
  },

  /** §9.6 : l'administrateur BERTOLIS ne doit JAMAIS consulter librement les données RH sensibles
   * des clients — ce résumé n'expose donc que des métadonnées (nom, offre, statut, effectif compté,
   * jamais la liste des salariés ni leurs données). */
  getAllCompaniesForBertolis() {
    return this.getCompanies().map(c => ({
      id: c.id,
      raisonSociale: c.raisonSociale,
      abonnement: c.abonnement || makeEmptyAbonnement(),
      nombreSalaries: c.employees.filter(e => !e.archive).length,
      nombreEtablissements: (c.etablissements || []).length
    }));
  },

  /** Seule action de gestion construite pour l'instant (§36 : activer/suspendre/résilier). Journalisée
   * dans le journal d'audit DE L'ENTREPRISE CONCERNÉE, pas un journal BERTOLIS séparé — pour rester
   * "visible par le client" (§9.6), même si ce n'est pas un accès aux données RH à proprement parler. */
  updateCompanyAbonnementStatut(companyId, statut) {
    const companies = this.getCompanies();
    const company = companies.find(c => c.id === companyId);
    if (!company) return { success: false, error: 'Entreprise introuvable.' };
    company.abonnement = Object.assign({}, company.abonnement, { statut });
    appendAuditLogEntry(company, 'Modification', 'Abonnement',
      `Statut changé en « ${ABONNEMENT_STATUT_LABELS[statut] || statut} »`, 'Par l\'administrateur BERTOLIS');
    this.saveCompanies(companies);
    return { success: true };
  },

  // ---- Multi-entreprise ----

  /**
   * Cache mémoire pour éviter de relire/re-parser tout le blob localStorage à chaque appel — quasiment
   * chaque méthode de DB passe par getCurrentCompany() -> getCompanies(), donc un seul rendu peut déclencher
   * des dizaines d'appels. Mesuré : sans cache, avec ~1200 notifications + 800 demandes de congé accumulées,
   * une seule navigation prenait plus de 3 secondes (tout entier dans le JSON.parse répété du même blob).
   * Invalidé à chaque écriture (saveCompanies) pour ne jamais servir de données périmées dans cette même session.
   */
  _companiesCache: null,

  /** Si le JSON stocké est corrompu (édition manuelle, extension navigateur, bug), on retombe sur une liste vide plutôt que de planter toute l'app dès le premier rendu. */
  getCompanies() {
    if (this._companiesCache) return this._companiesCache;
    const raw = localStorage.getItem(ROOT_KEY);
    if (!raw) return (this._companiesCache = []);
    try {
      return (this._companiesCache = JSON.parse(raw));
    } catch (err) {
      console.error('Données entreprises corrompues dans localStorage, réinitialisation.', err);
      return (this._companiesCache = []);
    }
  },

  /** onSaveError : hook optionnel branché par app.js (ex. showToast) pour prévenir l'utilisateur sans coupler data.js à l'UI. */
  onSaveError: null,

  saveCompanies(list) {
    this._companiesCache = list;
    try {
      localStorage.setItem(ROOT_KEY, JSON.stringify(list));
    } catch (err) {
      const message = err && err.name === 'QuotaExceededError'
        ? 'Stockage plein : impossible d\'enregistrer. Supprimez d\'anciens documents/photos puis réessayez.'
        : 'Échec de l\'enregistrement local. Vos dernières modifications n\'ont pas été sauvegardées.';
      if (this.onSaveError) this.onSaveError(message); else console.error(message, err);
    }
  },

  getCurrentCompanyId() {
    return localStorage.getItem(CURRENT_COMPANY_KEY);
  },

  setCurrentCompanyId(id) {
    localStorage.setItem(CURRENT_COMPANY_KEY, id);
  },

  getCurrentCompany() {
    const companies = this.getCompanies();
    return companies.find(c => c.id === this.getCurrentCompanyId()) || companies[0] || null;
  },

  /** Point de passage unique pour toute écriture dans l'entreprise active. */
  saveCurrentCompany(company) {
    const companies = this.getCompanies();
    const index = companies.findIndex(c => c.id === company.id);
    if (index === -1) return;
    companies[index] = company;
    this.saveCompanies(companies);
  },

  getCompanyProfile() {
    const c = this.getCurrentCompany();
    return {
      id: c.id,
      raisonSociale: c.raisonSociale,
      logo: c.logo,
      siret: c.siret,
      tva: c.tva,
      adresse: c.adresse,
      telephone: c.telephone,
      email: c.email,
      conventionCollective: c.conventionCollective
    };
  },

  saveCompanyProfile(profile) {
    const company = this.getCurrentCompany();
    Object.assign(company, profile);
    this.saveCurrentCompany(company);
    this.logAudit('Modification', 'Entreprise', profile.raisonSociale || company.raisonSociale);
  },

  /**
   * Crée une nouvelle entreprise à partir de l'assistant de première installation :
   * profil, convention, organisation, et son premier compte administrateur (droits Directeur
   * pour pouvoir tout configurer ensuite — la fiche pourra être ajustée après coup).
   * Ne seede pas de salariés de démonstration : seuls les types de congés et le calendrier
   * scolaire standards sont pré-remplis, le reste se construit depuis un catalogue vide.
   */
  createCompanyFromOnboarding({ profile, conventionCollective, etablissement, organisation, admin }) {
    const company = makeEmptyCompany();
    company.id = generateId('company');
    Object.assign(company, profile, { conventionCollective, matriculeSeq: 1 });
    company.settings = Object.assign({}, DEFAULT_SETTINGS, {
      teletravailQuotaSemaine: organisation.teletravailQuotaSemaine,
      ticketsValeurFaciale: organisation.ticketsValeurFaciale,
      ticketsPartEmployeurPct: organisation.ticketsPartEmployeurPct
    });
    company.leaveTypes = seedLeaveTypes();
    company.schoolHolidays = seedSchoolHolidays();

    const etab = Object.assign(makeEmptyEtablissement(), etablissement, {
      id: generateId('etab'),
      principal: true,
      actif: true
    });
    company.etablissements = [etab];

    const now = new Date().toISOString();
    const adminEmployee = Object.assign(makeEmptyEmployee(), {
      id: generateId('emp'),
      matricule: 'SRH-0001',
      prenom: admin.prenom,
      nom: admin.nom,
      email: admin.email,
      motDePasse: admin.motDePasse,
      role: ROLES.DIRECTEUR,
      statut: 'Actif',
      horairesHebdo: organisation.horairesHebdo,
      etablissementId: etab.id,
      dateEmbauche: toISODate(new Date()),
      dateCreation: now,
      dateModification: now
    });
    company.employees = [adminEmployee];
    migrateCompanyEtablissements(company); // filet de sécurité si `etablissement` est absent/mal formé
    company.abonnement = makeEmptyAbonnement();

    const companies = this.getCompanies();
    companies.push(company);
    this.saveCompanies(companies);
    this.setCurrentCompanyId(company.id);
    this.logAudit('Création', 'Entreprise', company.raisonSociale);
    return company;
  },

  // ---- Salariés ----

  getEmployees() {
    return this.getCurrentCompany().employees;
  },

  saveEmployees(list) {
    const company = this.getCurrentCompany();
    company.employees = list;
    this.saveCurrentCompany(company);
  },

  getEmployeeById(id) {
    return this.getEmployees().find(e => e.id === id) || null;
  },

  addEmployee(data) {
    const company = this.getCurrentCompany();
    const now = new Date().toISOString();
    company.matriculeSeq = (company.matriculeSeq || 0) + 1;
    const employee = Object.assign(makeEmptyEmployee(), data, {
      id: generateId('emp'),
      matricule: data.matricule || 'SRH-' + String(company.matriculeSeq).padStart(4, '0'),
      dateCreation: now,
      dateModification: now
    });
    company.employees.push(employee);
    this.saveCurrentCompany(company);
    this.logAudit('Création', 'Salarié', `${employee.prenom} ${employee.nom}`);
    return employee;
  },

  updateEmployee(id, patch) {
    const list = this.getEmployees();
    const index = list.findIndex(e => e.id === id);
    if (index === -1) return null;
    list[index] = Object.assign({}, list[index], patch, { dateModification: new Date().toISOString() });
    this.saveEmployees(list);
    this.logAudit('Modification', 'Salarié', `${list[index].prenom} ${list[index].nom}`);
    return list[index];
  },

  /** Suppression définitive : nettoie aussi les références qui pointeraient vers ce salarié ailleurs dans l'entreprise (managers, équipes, demandes, documents, favoris). */
  deleteEmployee(id) {
    const employee = this.getEmployeeById(id);
    const list = this.getEmployees().filter(e => e.id !== id);
    list.forEach(e => {
      if ((e.managerIds || []).includes(id)) e.managerIds = e.managerIds.filter(m => m !== id);
    });
    this.saveEmployees(list);

    const services = this.getServices();
    let servicesChanged = false;
    services.forEach(s => {
      (s.equipes || []).forEach(eq => {
        if ((eq.managerIds || []).includes(id)) {
          eq.managerIds = eq.managerIds.filter(m => m !== id);
          servicesChanged = true;
        }
      });
    });
    if (servicesChanged) this.saveServices(services);

    this.saveLeaveRequests(this.getLeaveRequests().filter(r => r.employeeId !== id));
    this.saveTeleworkRequests(this.getTeleworkRequests().filter(r => r.employeeId !== id));
    this.saveExpenses(this.getExpenses().filter(n => n.employeeId !== id));
    this.saveDocuments(this.getDocuments().filter(d => d.employeeId !== id));

    const company = this.getCurrentCompany();
    if (company.favorites && !Array.isArray(company.favorites)) {
      delete company.favorites[id];
      Object.keys(company.favorites).forEach(userId => {
        company.favorites[userId] = company.favorites[userId].filter(fid => fid !== id);
      });
    }
    this.saveCurrentCompany(company);

    if (employee) this.logAudit('Suppression', 'Salarié', `${employee.prenom} ${employee.nom}`);
  },

  setArchived(id, archived) {
    return this.updateEmployee(id, {
      archive: archived,
      statut: archived ? 'Inactif' : 'Actif'
    });
  },

  // ---- Paramètres / listes de référence ----

  getSettings() {
    const company = this.getCurrentCompany();
    // Fusion avec les défauts : un champ ajouté plus tard (ex. schoolZone) apparaît
    // automatiquement chez les utilisateurs existants sans écraser leurs réglages.
    return Object.assign({}, DEFAULT_SETTINGS, company.settings || {});
  },

  saveSettings(settings) {
    const company = this.getCurrentCompany();
    company.settings = settings;
    this.saveCurrentCompany(company);
    this.logAudit('Modification', 'Paramètres', 'Listes et réglages généraux');
  },

  // ---- Services & équipes (catalogue structuré, pas une simple liste de textes) ----

  // ---- Établissements (§12) ----

  getEtablissements() {
    return this.getCurrentCompany().etablissements || [];
  },

  saveEtablissements(list) {
    const company = this.getCurrentCompany();
    company.etablissements = list;
    this.saveCurrentCompany(company);
  },

  getEtablissementById(id) {
    return this.getEtablissements().find(e => e.id === id) || null;
  },

  addEtablissement(data) {
    const list = this.getEtablissements();
    const etab = Object.assign(makeEmptyEtablissement(), data, { id: generateId('etab') });
    if (etab.principal) list.forEach(e => { e.principal = false; }); // un seul principal à la fois
    list.push(etab);
    this.saveEtablissements(list);
    this.logAudit('Création', 'Établissement', etab.nom);
    return etab;
  },

  updateEtablissement(id, patch) {
    const list = this.getEtablissements();
    const index = list.findIndex(e => e.id === id);
    if (index === -1) return;
    if (patch.principal) list.forEach(e => { e.principal = false; });
    list[index] = Object.assign({}, list[index], patch);
    this.saveEtablissements(list);
    this.logAudit('Modification', 'Établissement', list[index].nom);
  },

  /** Un établissement référencé par au moins un salarié ne peut pas être supprimé (pas d'orphelin),
   * et il en faut toujours au moins un dans l'entreprise (§12). */
  deleteEtablissement(id) {
    const list = this.getEtablissements();
    if (list.length <= 1) return { success: false, error: 'Une entreprise doit avoir au moins un établissement.' };
    const inUse = this.getEmployees().some(e => e.etablissementId === id);
    if (inUse) return { success: false, error: 'Cet établissement est encore rattaché à des salariés.' };
    const etab = list.find(e => e.id === id);
    const remaining = list.filter(e => e.id !== id);
    if (etab && etab.principal && remaining.length) remaining[0].principal = true; // il faut toujours un principal
    this.saveEtablissements(remaining);
    if (etab) this.logAudit('Suppression', 'Établissement', etab.nom);
    return { success: true };
  },

  getServices() {
    return this.getCurrentCompany().services || [];
  },

  saveServices(list) {
    const company = this.getCurrentCompany();
    company.services = list;
    this.saveCurrentCompany(company);
  },

  getServiceById(id) {
    return this.getServices().find(s => s.id === id) || null;
  },

  addService(nom) {
    const list = this.getServices();
    const service = Object.assign(makeEmptyService(), { id: generateId('svc'), nom });
    list.push(service);
    this.saveServices(list);
    this.logAudit('Création', 'Service', nom);
    return service;
  },

  /** Le service d'un salarié est stocké en texte libre (pas un id) : un renommage doit donc se répercuter sur chaque salarié qui portait l'ancien nom, sinon sa fiche référence un service qui n'existe plus. */
  renameService(id, nom) {
    const list = this.getServices();
    const service = list.find(s => s.id === id);
    if (!service) return;
    const oldNom = service.nom;
    service.nom = nom;
    this.saveServices(list);

    if (oldNom !== nom) {
      const employees = this.getEmployees();
      let employeesChanged = false;
      employees.forEach(e => {
        if (e.service === oldNom) { e.service = nom; employeesChanged = true; }
      });
      if (employeesChanged) this.saveEmployees(employees);
    }

    this.logAudit('Modification', 'Service', nom);
  },

  /** Idem : un service supprimé doit libérer les salariés qui le référençaient (service + équipe, qui n'existe plus non plus). */
  deleteService(id) {
    const service = this.getServiceById(id);
    this.saveServices(this.getServices().filter(s => s.id !== id));

    if (service) {
      const employees = this.getEmployees();
      let employeesChanged = false;
      employees.forEach(e => {
        if (e.service === service.nom) { e.service = ''; e.equipe = ''; employeesChanged = true; }
      });
      if (employeesChanged) this.saveEmployees(employees);
    }

    if (service) this.logAudit('Suppression', 'Service', service.nom);
  },

  addEquipe(serviceId, nom) {
    const list = this.getServices();
    const service = list.find(s => s.id === serviceId);
    if (!service) return null;
    const equipe = Object.assign(makeEmptyEquipe(), { id: generateId('eq'), nom });
    service.equipes.push(equipe);
    this.saveServices(list);
    this.logAudit('Création', 'Équipe', `${nom} (${service.nom})`);
    return equipe;
  },

  /** Même logique que deleteService : une équipe supprimée doit libérer les salariés qui la référençaient. */
  deleteEquipe(serviceId, equipeId) {
    const list = this.getServices();
    const service = list.find(s => s.id === serviceId);
    if (!service) return;
    const equipe = service.equipes.find(e => e.id === equipeId);
    service.equipes = service.equipes.filter(e => e.id !== equipeId);
    this.saveServices(list);

    if (equipe) {
      const employees = this.getEmployees();
      let employeesChanged = false;
      employees.forEach(e => {
        if (e.service === service.nom && e.equipe === equipe.nom) { e.equipe = ''; employeesChanged = true; }
      });
      if (employeesChanged) this.saveEmployees(employees);
    }
    if (equipe) this.logAudit('Suppression', 'Équipe', `${equipe.nom} (${service.nom})`);
  },

  setEquipeManagers(serviceId, equipeId, managerIds) {
    const list = this.getServices();
    const service = list.find(s => s.id === serviceId);
    if (!service) return;
    const equipe = service.equipes.find(e => e.id === equipeId);
    if (!equipe) return;
    equipe.managerIds = managerIds;
    this.saveServices(list);
    this.logAudit('Modification', 'Équipe', `Managers de ${equipe.nom} (${service.nom})`);
  },

  // ---- Vacances scolaires (paramétrables par zone) ----

  getSchoolHolidays() {
    return this.getCurrentCompany().schoolHolidays || seedSchoolHolidays();
  },

  saveSchoolHolidays(data) {
    const company = this.getCurrentCompany();
    company.schoolHolidays = data;
    this.saveCurrentCompany(company);
    this.logAudit('Modification', 'Vacances scolaires', data.anneeScolaire || '');
  },

  // ---- Types de congés (paramétrables) ----

  getLeaveTypes() {
    return this.getCurrentCompany().leaveTypes.slice().sort((a, b) => a.ordre - b.ordre);
  },

  saveLeaveTypes(list) {
    const company = this.getCurrentCompany();
    company.leaveTypes = list;
    this.saveCurrentCompany(company);
  },

  getLeaveTypeById(id) {
    return this.getLeaveTypes().find(t => t.id === id) || null;
  },

  addLeaveType(data) {
    const list = this.getLeaveTypes();
    const type = Object.assign(makeEmptyLeaveType(), data, {
      id: generateId('lt'),
      ordre: list.length
    });
    list.push(type);
    this.saveLeaveTypes(list);
    this.logAudit('Création', 'Type de congé', type.nom);
    return type;
  },

  updateLeaveType(id, patch) {
    const list = this.getLeaveTypes();
    const index = list.findIndex(t => t.id === id);
    if (index === -1) return null;
    list[index] = Object.assign({}, list[index], patch);
    this.saveLeaveTypes(list);
    this.logAudit('Modification', 'Type de congé', list[index].nom);
    return list[index];
  },

  duplicateLeaveType(id) {
    const source = this.getLeaveTypeById(id);
    if (!source) return null;
    return this.addLeaveType(Object.assign({}, source, { id: undefined, nom: source.nom + ' (copie)' }));
  },

  deleteLeaveType(id) {
    const type = this.getLeaveTypeById(id);
    this.saveLeaveTypes(this.getLeaveTypes().filter(t => t.id !== id));
    this.saveLeaveRequests(this.getLeaveRequests().filter(r => r.typeId !== id));
    if (type) this.logAudit('Suppression', 'Type de congé', type.nom);
  },

  reorderLeaveType(id, direction) {
    const list = this.getLeaveTypes();
    const index = list.findIndex(t => t.id === id);
    const swapWith = direction === 'up' ? index - 1 : index + 1;
    if (index === -1 || swapWith < 0 || swapWith >= list.length) return;
    const tmp = list[index].ordre;
    list[index].ordre = list[swapWith].ordre;
    list[swapWith].ordre = tmp;
    this.saveLeaveTypes(list);
    this.logAudit('Modification', 'Type de congé', `Réordonnancement : ${list[index].nom}`);
  },

  // ---- Demandes de congés ----

  getLeaveRequests() {
    return this.getCurrentCompany().leaveRequests.slice().sort((a, b) => new Date(b.dateCreation) - new Date(a.dateCreation));
  },

  saveLeaveRequests(list) {
    const company = this.getCurrentCompany();
    company.leaveRequests = list;
    this.saveCurrentCompany(company);
  },

  getLeaveRequestById(id) {
    return this.getLeaveRequests().find(r => r.id === id) || null;
  },

  getLeaveRequestsForEmployee(employeeId) {
    return this.getLeaveRequests().filter(r => r.employeeId === employeeId);
  },

  addLeaveRequest(data) {
    const list = this.getLeaveRequests();
    const now = new Date().toISOString();
    const leaveType = this.getLeaveTypeById(data.typeId);
    const workflow = (leaveType && leaveType.workflow) || [];
    const request = Object.assign(makeEmptyLeaveRequest(), data, {
      id: generateId('lr'),
      workflow,
      etapeIndex: computeInitialWorkflowStep(workflow),
      statut: computeInitialWorkflowStatus(workflow) || 'Validé',
      historique: [{ date: now, action: 'Demande créée' }],
      dateCreation: now,
      dateModification: now
    });
    list.push(request);
    this.saveLeaveRequests(list);
    const employee = this.getEmployeeById(request.employeeId);
    this.logAudit('Création', 'Demande de congé', `${employee ? employee.prenom + ' ' + employee.nom : '—'} · ${leaveType ? leaveType.nom : '—'}`);
    return request;
  },

  updateLeaveRequest(id, patch) {
    const list = this.getLeaveRequests();
    const index = list.findIndex(r => r.id === id);
    if (index === -1) return null;
    list[index] = Object.assign({}, list[index], patch, { dateModification: new Date().toISOString() });
    this.saveLeaveRequests(list);
    return list[index];
  },

  /** §24 : "Prolonger l'arrêt" — conserve le lien avec l'arrêt initial (même enregistrement,
   * pas une nouvelle demande) et garde l'historique de chaque prolongation plutôt que d'écraser
   * silencieusement l'ancienne date de fin. */
  prolongerArretMaladie(id, nouvelleDateFin, justificatif) {
    const list = this.getLeaveRequests();
    const index = list.findIndex(r => r.id === id);
    if (index === -1) return { success: false, error: 'Demande introuvable.' };
    const request = list[index];
    if (nouvelleDateFin <= request.dateFin) {
      return { success: false, error: 'La nouvelle date de fin doit être après la date de fin actuelle.' };
    }
    // Les jours nouvellement couverts par la prolongation doivent subir le même contrôle qu'à la
    // création (cf. hasActiveRequestOverlap côté app.js) : sans ce contrôle, un télétravail approuvé
    // APRÈS la création de l'arrêt (donc jamais vérifié contre lui) pourrait rester en conflit silencieux
    // une fois l'arrêt prolongé sur cette même date.
    const conflictingTelework = this.getTeleworkRequests().some(r =>
      r.employeeId === request.employeeId && r.statut !== 'Refusé' && r.statut !== 'Annulé' &&
      r.dateDebut <= nouvelleDateFin && r.dateFin >= request.dateFin);
    if (conflictingTelework) {
      return { success: false, error: 'Cette prolongation chevauche une demande de télétravail active pour ce salarié. Traitez-la d\'abord.' };
    }
    const employee = this.getEmployeeById(request.employeeId);
    const type = this.getLeaveTypeById(request.typeId);
    const prolongations = (request.prolongations || []).concat([{
      date: new Date().toISOString(),
      ancienneDateFin: request.dateFin,
      nouvelleDateFin,
      justificatif: justificatif || null
    }]);
    list[index] = Object.assign({}, request, {
      dateFin: nouvelleDateFin,
      nbJours: computeWorkingDays(request.dateDebut, nouvelleDateFin, false, employee.joursTravailles),
      prolongations,
      dateModification: new Date().toISOString()
    });
    this.saveLeaveRequests(list);
    this.logAudit('Modification', 'Prolongation arrêt', `${employee.prenom} ${employee.nom} · ${type.nom} · jusqu'au ${formatDate(nouvelleDateFin)}`);
    return { success: true, request: list[index] };
  },

  /** Ajustement manuel du compteur d'un salarié pour un type de congé donné (§ MODIFIER_COMPTEURS) —
   * s'ajoute (ou se retranche, si négatif) au calcul automatique dans getLeaveBalance(). Remplace la
   * valeur précédente pour ce type (pas un cumul) : le formulaire affiche toujours l'ajustement courant. */
  ajusterCompteurConge(employeeId, typeId, montant, motif) {
    const employee = this.getEmployeeById(employeeId);
    if (!employee) return { success: false, error: 'Salarié introuvable.' };
    const type = this.getLeaveTypeById(typeId);
    if (!type) return { success: false, error: 'Type de congé introuvable.' };
    const value = Number(montant);
    if (!Number.isFinite(value)) {
      return { success: false, error: 'Le montant doit être un nombre.' };
    }
    const compteurs = Object.assign({}, employee.compteurs, { [typeId]: value });
    this.updateEmployee(employeeId, { compteurs });
    this.logAudit('Modification', 'Compteur congé', `${employee.prenom} ${employee.nom} · ${type.nom} · ajustement ${value >= 0 ? '+' : ''}${formatNumberFR(value)} j${motif ? ' · ' + motif : ''}`);
    return { success: true };
  },

  /** Correction manuelle du nombre de tickets restaurant d'un salarié pour un mois donné
   * (§ CORRIGER_TICKETS_RESTAURANT) — remplace la correction précédente pour ce mois (pas un cumul). */
  ajusterTicketsRestaurant(employeeId, year, month, delta, motif) {
    const employee = this.getEmployeeById(employeeId);
    if (!employee) return { success: false, error: 'Salarié introuvable.' };
    const value = Number(delta);
    if (!Number.isInteger(value)) {
      return { success: false, error: 'La correction doit être un nombre entier de tickets.' };
    }
    const ticketsAjustements = Object.assign({}, employee.ticketsAjustements, { [ticketsMonthKey(year, month)]: value });
    this.updateEmployee(employeeId, { ticketsAjustements });
    this.logAudit('Modification', 'Tickets restaurant', `${employee.prenom} ${employee.nom} · ${ticketsMonthKey(year, month)} · correction ${value >= 0 ? '+' : ''}${value}${motif ? ' · ' + motif : ''}`);
    return { success: true };
  },

  /** Auto-service limité (§ MODIFIER_PROPRES_COORDONNEES) : seuls téléphone/adresse sont modifiables
   * par ce chemin — signature explicite (pas un patch générique) pour qu'il soit structurellement
   * impossible d'y glisser un autre champ (poste, contrat, salaire...) par erreur plus tard. */
  majPropresCoordonnees(employeeId, { telephone, rue, codePostal, ville }) {
    const employee = this.getEmployeeById(employeeId);
    if (!employee) return { success: false, error: 'Salarié introuvable.' };
    this.updateEmployee(employeeId, {
      telephone: telephone || '',
      adresse: { rue: rue || '', codePostal: codePostal || '', ville: ville || '' }
    });
    this.logAudit('Modification', 'Coordonnées', `${employee.prenom} ${employee.nom} (auto-modification)`);
    return { success: true };
  },

  /** § GERER_UTILISATEURS : débloque un compte verrouillé (5 tentatives échouées, cf. login()) sans
   * changer son mot de passe — utile quand le salarié se souvient de son mot de passe mais a été
   * bloqué par erreur (ex. faute de frappe répétée). */
  deverrouillerCompte(employeeId) {
    const employee = this.getEmployeeById(employeeId);
    if (!employee) return { success: false, error: 'Salarié introuvable.' };
    this.updateEmployee(employeeId, { verrouille: false, tentativesEchouees: 0 });
    this.logAudit('Modification', 'Compte', `${employee.prenom} ${employee.nom} (déverrouillé)`);
    return { success: true };
  },

  /** § GERER_UTILISATEURS : un RH/Directeur impose un nouveau mot de passe sans connaître l'ancien
   * (contrairement à changePassword, en libre-service) — débloque aussi le compte au passage, comme
   * resetPasswordWithToken (même effet final, chemin différent : ici pas de token, action directe). */
  forcerNouveauMotDePasse(employeeId, newPassword) {
    const employee = this.getEmployeeById(employeeId);
    if (!employee) return { success: false, error: 'Salarié introuvable.' };
    if (!newPassword || newPassword.length < 6) {
      return { success: false, error: 'Le nouveau mot de passe doit contenir au moins 6 caractères.' };
    }
    this.updateEmployee(employeeId, { motDePasse: newPassword, resetToken: null, tentativesEchouees: 0, verrouille: false });
    this.logAudit('Modification', 'Mot de passe', `${employee.prenom} ${employee.nom} (réinitialisé par un administrateur)`);
    return { success: true };
  },

  // ---- Demandes de télétravail ----

  getTeleworkRequests() {
    return this.getCurrentCompany().teleworkRequests.slice().sort((a, b) => new Date(b.dateCreation) - new Date(a.dateCreation));
  },

  saveTeleworkRequests(list) {
    const company = this.getCurrentCompany();
    company.teleworkRequests = list;
    this.saveCurrentCompany(company);
  },

  getTeleworkRequestById(id) {
    return this.getTeleworkRequests().find(r => r.id === id) || null;
  },

  getTeleworkRequestsForEmployee(employeeId) {
    return this.getTeleworkRequests().filter(r => r.employeeId === employeeId);
  },

  addTeleworkRequest(data) {
    const list = this.getTeleworkRequests();
    const now = new Date().toISOString();
    const workflow = this.getSettings().workflowTeletravail || [];
    const request = Object.assign(makeEmptyTeleworkRequest(), data, {
      id: generateId('tt'),
      workflow,
      etapeIndex: computeInitialWorkflowStep(workflow),
      statut: computeInitialWorkflowStatus(workflow) || 'Validé',
      historique: [{ date: now, action: 'Demande créée' }],
      dateCreation: now,
      dateModification: now
    });
    list.push(request);
    this.saveTeleworkRequests(list);
    const employee = this.getEmployeeById(request.employeeId);
    this.logAudit('Création', 'Demande de télétravail', employee ? `${employee.prenom} ${employee.nom}` : '—');
    return request;
  },

  updateTeleworkRequest(id, patch) {
    const list = this.getTeleworkRequests();
    const index = list.findIndex(r => r.id === id);
    if (index === -1) return null;
    list[index] = Object.assign({}, list[index], patch, { dateModification: new Date().toISOString() });
    this.saveTeleworkRequests(list);
    return list[index];
  },

  // ---- Notes de frais ----

  getExpenses() {
    return this.getCurrentCompany().expenses.slice().sort((a, b) => new Date(b.dateCreation) - new Date(a.dateCreation));
  },

  saveExpenses(list) {
    const company = this.getCurrentCompany();
    company.expenses = list;
    this.saveCurrentCompany(company);
  },

  getExpenseById(id) {
    return this.getExpenses().find(n => n.id === id) || null;
  },

  getExpensesForEmployee(employeeId) {
    return this.getExpenses().filter(n => n.employeeId === employeeId);
  },

  addExpense(data) {
    const list = this.getExpenses();
    const now = new Date().toISOString();
    const workflow = this.getSettings().workflowFrais || [];
    const expense = Object.assign(makeEmptyExpense(), data, {
      id: generateId('nf'),
      workflow,
      etapeIndex: computeInitialWorkflowStep(workflow),
      statut: computeInitialWorkflowStatus(workflow) || 'Remboursé',
      historique: [{ date: now, action: 'Note créée' }],
      dateCreation: now,
      dateModification: now
    });
    list.push(expense);
    this.saveExpenses(list);
    const employee = this.getEmployeeById(expense.employeeId);
    this.logAudit('Création', 'Note de frais', `${employee ? employee.prenom + ' ' + employee.nom : '—'} · ${expense.categorie}`);
    return expense;
  },

  updateExpense(id, patch) {
    const list = this.getExpenses();
    const index = list.findIndex(n => n.id === id);
    if (index === -1) return null;
    list[index] = Object.assign({}, list[index], patch, { dateModification: new Date().toISOString() });
    this.saveExpenses(list);
    return list[index];
  },

  // ---- Coffre-fort documents RH ----

  getDocuments() {
    return this.getCurrentCompany().documents || [];
  },

  saveDocuments(list) {
    const company = this.getCurrentCompany();
    company.documents = list;
    this.saveCurrentCompany(company);
  },

  getDocumentById(id) {
    return this.getDocuments().find(d => d.id === id) || null;
  },

  getDocumentsForEmployee(employeeId) {
    return this.getDocuments()
      .filter(d => d.employeeId === employeeId)
      .sort((a, b) => new Date(b.dateCreation) - new Date(a.dateCreation));
  },

  addDocument(data) {
    const list = this.getDocuments();
    const now = new Date().toISOString();
    const document_ = Object.assign(makeEmptyDocument(), data, {
      id: generateId('doc'),
      dateCreation: now,
      dateModification: now
    });
    list.push(document_);
    this.saveDocuments(list);
    const employee = this.getEmployeeById(document_.employeeId);
    this.logAudit('Création', 'Document', `${employee ? employee.prenom + ' ' + employee.nom : '—'} · ${document_.categorie} · ${document_.nom}`);
    return document_;
  },

  deleteDocument(id) {
    const doc = this.getDocumentById(id);
    this.saveDocuments(this.getDocuments().filter(d => d.id !== id));
    if (doc) {
      const employee = this.getEmployeeById(doc.employeeId);
      this.logAudit('Suppression', 'Document', `${employee ? employee.prenom + ' ' + employee.nom : '—'} · ${doc.categorie} · ${doc.nom}`);
    }
  },

  // ---- Journal d'audit ----

  getAuditLog() {
    return this.getCurrentCompany().auditLog.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  },

  /** Historique borné (2000 entrées) pour ne pas saturer le localStorage indéfiniment. */
  logAudit(action, entite, cible, details) {
    const company = this.getCurrentCompany();
    appendAuditLogEntry(company, action, entite, cible, details);
    this.saveCurrentCompany(company);
  },

  clearAuditLog() {
    const company = this.getCurrentCompany();
    company.auditLog = [];
    this.saveCurrentCompany(company);
  },

  // ---- Favoris ----

  /** Favoris personnels à l'utilisateur connecté (pas partagés avec le reste de l'entreprise). */
  getFavoriteEmployeeIds() {
    const user = this.getCurrentUser();
    if (!user) return [];
    const company = this.getCurrentCompany();
    if (!company.favorites || Array.isArray(company.favorites)) return [];
    return company.favorites[user.id] || [];
  },

  isFavoriteEmployee(id) {
    return this.getFavoriteEmployeeIds().includes(id);
  },

  toggleFavoriteEmployee(id) {
    const user = this.getCurrentUser();
    if (!user) return false;
    const company = this.getCurrentCompany();
    if (!company.favorites || Array.isArray(company.favorites)) company.favorites = {};
    const list = company.favorites[user.id] || [];
    const index = list.indexOf(id);
    if (index === -1) list.push(id); else list.splice(index, 1);
    company.favorites[user.id] = list;
    this.saveCurrentCompany(company);
    return list.includes(id);
  },

  // ---- Notifications ----

  /** Lu/archivé sont personnels à chaque utilisateur (luPar/archivePar, par id de salarié) : une même notification peut être lue par la RH et non lue par le Directeur. */
  getNotifications() {
    const user = this.getCurrentUser();
    const userId = user ? user.id : null;
    return this.getCurrentCompany().notifications
      .slice()
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .map(n => Object.assign({}, n, {
        lu: Boolean(n.luPar && n.luPar[userId]),
        archive: Boolean(n.archivePar && n.archivePar[userId])
      }));
  },

  saveNotifications(list) {
    const company = this.getCurrentCompany();
    company.notifications = list;
    this.saveCurrentCompany(company);
  },

  addNotificationsIfNew(candidates) {
    const existing = this.getCurrentCompany().notifications;
    const existingKeys = new Set(existing.map(n => n.sourceKey));
    const fresh = candidates.filter(c => !existingKeys.has(c.sourceKey));
    if (fresh.length === 0) return;
    const merged = [...fresh, ...existing].sort((a, b) => new Date(b.date) - new Date(a.date));
    this.saveNotifications(merged.length > NOTIF_STORAGE_LIMIT ? merged.slice(0, NOTIF_STORAGE_LIMIT) : merged);
  },

  markNotificationRead(id, read) {
    const user = this.getCurrentUser();
    if (!user) return;
    const list = this.getCurrentCompany().notifications;
    const index = list.findIndex(n => n.id === id);
    if (index === -1) return;
    list[index].luPar = Object.assign({}, list[index].luPar, { [user.id]: read });
    this.saveNotifications(list);
  },

  markAllNotificationsRead() {
    const user = this.getCurrentUser();
    if (!user) return;
    const list = this.getCurrentCompany().notifications.map(n =>
      Object.assign({}, n, { luPar: Object.assign({}, n.luPar, { [user.id]: true }) }));
    this.saveNotifications(list);
  },

  setNotificationArchived(id, archived) {
    const user = this.getCurrentUser();
    if (!user) return;
    const list = this.getCurrentCompany().notifications;
    const index = list.findIndex(n => n.id === id);
    if (index === -1) return;
    list[index].archivePar = Object.assign({}, list[index].archivePar, { [user.id]: archived });
    if (archived) list[index].luPar = Object.assign({}, list[index].luPar, { [user.id]: true });
    this.saveNotifications(list);
  },

  // ---- Authentification (simulation navigateur, voir avertissement sur ROLES) ----

  getCurrentUser() {
    let session;
    try {
      session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    } catch (err) {
      console.error('Session corrompue dans sessionStorage, déconnexion.', err);
      return null;
    }
    if (!session) return null;
    return this.getEmployeeById(session.employeeId);
  },

  isLoggedIn() {
    return this.getCurrentUser() !== null;
  },

  login(email, password) {
    // §36/§9.6 : une entreprise suspendue ou résiliée par BERTOLIS ne doit plus permettre la
    // connexion. "Impayé" reste volontairement non bloquant (période de grâce implicite, comme la
    // plupart des SaaS réels) — seuls suspendu/résilié bloquent. Ne touche à aucun compteur de
    // tentatives échouées : ce n'est pas un mauvais mot de passe, c'est l'entreprise qui est bloquée.
    const company = this.getCurrentCompany();
    const statutAbonnement = company && company.abonnement && company.abonnement.statut;
    if (statutAbonnement === 'suspendu' || statutAbonnement === 'resilie') {
      return {
        success: false,
        error: statutAbonnement === 'resilie'
          ? 'Cet abonnement a été résilié. Contactez BERTOLIS pour plus d\'informations.'
          : 'Cet abonnement est actuellement suspendu. Contactez BERTOLIS pour plus d\'informations.'
      };
    }

    const list = this.getEmployees();
    const index = list.findIndex(e => e.email.toLowerCase() === (email || '').toLowerCase().trim());
    if (index === -1) return { success: false, error: 'Email ou mot de passe incorrect.' };

    const employee = list[index];
    if (employee.verrouille) {
      return { success: false, error: 'Compte verrouillé après 5 tentatives échouées. Utilisez « Mot de passe oublié ? » pour le réinitialiser.' };
    }
    if (employee.motDePasse !== password) {
      list[index].tentativesEchouees = (employee.tentativesEchouees || 0) + 1;
      list[index].verrouille = list[index].tentativesEchouees >= 5;
      this.saveEmployees(list);
      this.logAudit('Connexion', 'Session', `Échec (${list[index].tentativesEchouees}/5) — ${employee.prenom} ${employee.nom}`);
      return {
        success: false,
        error: list[index].verrouille
          ? 'Compte verrouillé après 5 tentatives échouées. Utilisez « Mot de passe oublié ? » pour le réinitialiser.'
          : `Mot de passe incorrect (tentative ${list[index].tentativesEchouees}/5).`
      };
    }

    list[index].tentativesEchouees = 0;
    this.saveEmployees(list);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ employeeId: employee.id }));
    this.logAudit('Connexion', 'Session', `${employee.prenom} ${employee.nom} (${ROLE_LABELS[employee.role] || employee.role})`);
    return { success: true, employee };
  },

  logout() {
    const user = this.getCurrentUser();
    sessionStorage.removeItem(SESSION_KEY);
    if (user) this.logAudit('Déconnexion', 'Session', `${user.prenom} ${user.nom}`);
  },

  changePassword(employeeId, currentPassword, newPassword) {
    const employee = this.getEmployeeById(employeeId);
    if (!employee || employee.motDePasse !== currentPassword) {
      return { success: false, error: 'Mot de passe actuel incorrect.' };
    }
    if (!newPassword || newPassword.length < 6) {
      return { success: false, error: 'Le nouveau mot de passe doit contenir au moins 6 caractères.' };
    }
    const list = this.getEmployees();
    const index = list.findIndex(e => e.id === employeeId);
    list[index].motDePasse = newPassword;
    this.saveEmployees(list);
    this.logAudit('Modification', 'Mot de passe', `${employee.prenom} ${employee.nom}`);
    return { success: true };
  },

  /** Simule l'envoi d'un email : en production ce lien partirait par email, ici il est renvoyé directement. */
  requestPasswordReset(email) {
    const employee = this.getEmployees().find(e => e.email.toLowerCase() === (email || '').toLowerCase().trim());
    if (!employee) return { success: false, error: 'Aucun compte associé à cet email.' };
    const token = generateId('reset');
    this.updateEmployee(employee.id, { resetToken: token });
    return { success: true, token, employeeName: `${employee.prenom} ${employee.nom}` };
  },

  resetPasswordWithToken(token, newPassword) {
    const employee = this.getEmployees().find(e => e.resetToken === token);
    if (!employee) return { success: false, error: 'Lien de réinitialisation invalide ou expiré.' };
    if (!newPassword || newPassword.length < 6) {
      return { success: false, error: 'Le nouveau mot de passe doit contenir au moins 6 caractères.' };
    }
    this.updateEmployee(employee.id, { motDePasse: newPassword, resetToken: null, tentativesEchouees: 0, verrouille: false });
    this.logAudit('Modification', 'Mot de passe', `${employee.prenom} ${employee.nom} (réinitialisé)`);
    return { success: true };
  }
};

/**
 * Repositories (§5.3) — couche d'abstraction entre les vues et le stockage.
 * Chaque repository enveloppe les méthodes DB existantes (localStorage aujourd'hui)
 * sous un nom par entité. Le jour où le stockage devient une API REST, seul le corps
 * de ces méthodes change — aucun appelant dans app.js n'a besoin d'être modifié tant
 * qu'il passe par ces repositories plutôt que par DB.getXxx()/DB.addXxx() directement.
 * Migration progressive : le code existant continue d'appeler DB directement pour
 * l'instant (fonctionnellement identique), les nouveaux écrans doivent utiliser ces
 * repositories.
 */
const employeeRepository = {
  getAll: () => DB.getEmployees(),
  getById: (id) => DB.getEmployeeById(id),
  create: (data) => DB.addEmployee(data),
  update: (id, patch) => DB.updateEmployee(id, patch),
  archive: (id, archived = true) => DB.setArchived(id, archived),
  delete: (id) => DB.deleteEmployee(id),
  ajusterCompteur: (employeeId, typeId, montant, motif) => DB.ajusterCompteurConge(employeeId, typeId, montant, motif),
  ajusterTickets: (employeeId, year, month, delta, motif) => DB.ajusterTicketsRestaurant(employeeId, year, month, delta, motif),
  majCoordonnees: (employeeId, data) => DB.majPropresCoordonnees(employeeId, data),
  deverrouillerCompte: (employeeId) => DB.deverrouillerCompte(employeeId),
  forcerMotDePasse: (employeeId, newPassword) => DB.forcerNouveauMotDePasse(employeeId, newPassword)
};

const leaveRepository = {
  getAll: () => DB.getLeaveRequests(),
  getById: (id) => DB.getLeaveRequestById(id),
  getForEmployee: (employeeId) => DB.getLeaveRequestsForEmployee(employeeId),
  create: (data) => DB.addLeaveRequest(data),
  update: (id, patch) => DB.updateLeaveRequest(id, patch),
  prolonger: (id, nouvelleDateFin, justificatif) => DB.prolongerArretMaladie(id, nouvelleDateFin, justificatif)
};

const teleworkRepository = {
  getAll: () => DB.getTeleworkRequests(),
  getById: (id) => DB.getTeleworkRequestById(id),
  getForEmployee: (employeeId) => DB.getTeleworkRequestsForEmployee(employeeId),
  create: (data) => DB.addTeleworkRequest(data),
  update: (id, patch) => DB.updateTeleworkRequest(id, patch)
};

const expenseRepository = {
  getAll: () => DB.getExpenses(),
  getById: (id) => DB.getExpenseById(id),
  getForEmployee: (employeeId) => DB.getExpensesForEmployee(employeeId),
  create: (data) => DB.addExpense(data),
  update: (id, patch) => DB.updateExpense(id, patch)
};

const documentRepository = {
  getAll: () => DB.getDocuments(),
  getById: (id) => DB.getDocumentById(id),
  getForEmployee: (employeeId) => DB.getDocumentsForEmployee(employeeId),
  create: (data) => DB.addDocument(data),
  delete: (id) => DB.deleteDocument(id)
};

const serviceRepository = {
  getAll: () => DB.getServices(),
  getById: (id) => DB.getServiceById(id),
  create: (nom) => DB.addService(nom),
  rename: (id, nom) => DB.renameService(id, nom),
  delete: (id) => DB.deleteService(id)
};

const etablissementRepository = {
  getAll: () => DB.getEtablissements(),
  getById: (id) => DB.getEtablissementById(id),
  create: (data) => DB.addEtablissement(data),
  update: (id, patch) => DB.updateEtablissement(id, patch),
  delete: (id) => DB.deleteEtablissement(id)
};

const companyRepository = {
  getCurrent: () => DB.getCurrentCompany(),
  getProfile: () => DB.getCompanyProfile(),
  saveProfile: (profile) => DB.saveCompanyProfile(profile),
  createFromOnboarding: (payload) => DB.createCompanyFromOnboarding(payload)
};

/** Structure complète d'une fiche salarié (valeurs par défaut). */
function makeEmptyEmployee() {
  return {
    id: null,
    matricule: '',
    photo: null,
    civilite: 'M.',
    nom: '',
    prenom: '',
    email: '',
    telephone: '',
    adresse: { rue: '', codePostal: '', ville: '' },
    dateNaissance: '',
    lieuNaissance: '',
    nationalite: 'Française',
    numeroSecu: '',

    dateEmbauche: '',
    etablissementId: '', // §12 : chaque salarié doit être rattaché à un établissement
    service: '',
    equipe: '',
    poste: '',
    managerIds: [], // un salarié peut avoir zéro, un ou plusieurs managers
    conventionCollective: '',
    statutPro: 'Non cadre',

    typeContrat: 'CDI',
    dateFinContrat: '',
    dateFinPeriodeEssai: '',

    tempsTravail: 'Temps plein',
    pourcentageActivite: 100,
    horairesHebdo: 35,
    forfait: 'Aucun',
    regimeRTT: '',
    joursTravailles: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'],

    statut: 'Actif',
    dateDepart: '',
    archive: false,

    // Champs sensibles, réservés au Directeur, affichés uniquement si le réglage correspondant est activé
    salaireBrutMensuel: 0,
    genre: '',

    compteurs: {},
    ticketsAjustements: {}, // § CORRIGER_TICKETS_RESTAURANT : { 'AAAA-MM': delta } — voir calculateTicketsRestaurant()
    dateCreation: null,
    dateModification: null,

    // Accès / rôle (simulation navigateur — voir l'avertissement sur ROLES)
    role: 'salarie',
    motDePasse: '',
    tentativesEchouees: 0,
    verrouille: false,
    resetToken: null,
    permissionsOverrides: {} // surcharges individuelles §8, voir hasPermission()
  };
}

/** Une entreprise peut avoir plusieurs établissements (§12) ; chaque salarié est rattaché à l'un
 * d'eux (employee.etablissementId). Un seul établissement peut être `principal` à la fois — voir
 * DB.addEtablissement/updateEtablissement, qui maintiennent cette contrainte. */
function makeEmptyEtablissement() {
  return {
    id: null,
    nom: '',
    codeInterne: '',
    adresse: '',
    codePostal: '',
    ville: '',
    pays: 'France',
    email: '',
    telephone: '',
    responsableId: null,
    principal: false,
    actif: true
  };
}

/** Un service regroupe plusieurs équipes ; chaque équipe peut avoir un ou plusieurs managers. */
function makeEmptyService() {
  return { id: null, nom: '', equipes: [] };
}

function makeEmptyEquipe() {
  return { id: null, nom: '', managerIds: [] };
}

/** Catalogue de services/équipes par défaut, alignés sur les équipes des salariés de démonstration. */
function seedServices() {
  return [
    { id: generateId('svc'), nom: 'Direction', equipes: [{ id: generateId('eq'), nom: 'Direction générale', managerIds: [] }] },
    { id: generateId('svc'), nom: 'RH', equipes: [{ id: generateId('eq'), nom: 'Ressources humaines', managerIds: [] }] },
    { id: generateId('svc'), nom: 'Comptabilité', equipes: [{ id: generateId('eq'), nom: 'Finance', managerIds: [] }] },
    { id: generateId('svc'), nom: 'Commercial', equipes: [{ id: generateId('eq'), nom: 'Commerce', managerIds: [] }] },
    { id: generateId('svc'), nom: 'Production', equipes: [] },
    { id: generateId('svc'), nom: 'IT', equipes: [{ id: generateId('eq'), nom: 'Développement', managerIds: [] }] },
    { id: generateId('svc'), nom: 'Support client', equipes: [{ id: generateId('eq'), nom: 'Support', managerIds: [] }] }
  ];
}

function generateId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Calcule une ancienneté lisible ("3 ans, 2 mois") à partir d'une date d'embauche. */
function calculateAnciennete(dateEmbauche) {
  if (!dateEmbauche) return '—';
  const start = new Date(dateEmbauche);
  const now = new Date();
  if (Number.isNaN(start.getTime()) || start > now) return '—';

  let years = now.getFullYear() - start.getFullYear();
  let months = now.getMonth() - start.getMonth();
  if (now.getDate() < start.getDate()) months -= 1;
  if (months < 0) { years -= 1; months += 12; }

  const parts = [];
  if (years > 0) parts.push(`${years} an${years > 1 ? 's' : ''}`);
  parts.push(`${months} mois`);
  return parts.join(', ');
}

function calculateAge(dateNaissance) {
  if (!dateNaissance) return null;
  const birth = new Date(dateNaissance);
  const now = new Date();
  if (Number.isNaN(birth.getTime())) return null;
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age;
}

function formatDate(isoDate) {
  if (!isoDate) return '—';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR');
}

function formatDateTime(isoDate) {
  if (!isoDate) return '—';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR') + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/** Formats français centralisés (§17 du cahier des charges) : virgule décimale, espace des milliers,
 * jamais de point décimal visible. Toute nouvelle valeur numérique affichée doit passer par l'une de
 * ces fonctions plutôt que par un `.toFixed()`/`${x}` manuel dans une vue. */
function formatNumberFR(value, decimals = 2) {
  const n = Number(value);
  if (value === null || value === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatCurrencyFR(value) {
  const n = Number(value);
  if (value === null || value === undefined || Number.isNaN(n)) return '—';
  return `${formatNumberFR(n, 2)} €`;
}

/** maxDecimals borne le nombre de décimales affichées SANS forcer de zéros inutiles
 * (100 -> "100 %", 5.5 -> "5,5 %", 2.1 -> "2,1 %" avec maxDecimals=1). */
function formatPercentFR(value, maxDecimals = 1) {
  const n = Number(value);
  if (value === null || value === undefined || Number.isNaN(n)) return '—';
  return `${n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: maxDecimals })} %`;
}

/** unit reste l'abréviation "j" utilisée dans toute l'appli (cf. §16 pour le libellé complet
 * "jour"/"jours", non appliqué ici — question de formulation distincte, pas encore tranchée). */
function formatDurationFR(value, unit = 'j') {
  const n = Number(value);
  if (value === null || value === undefined || Number.isNaN(n)) return '—';
  return `${formatNumberFR(n, 2)} ${unit}`;
}

function getInitials(prenom, nom) {
  const a = (prenom || '').trim().charAt(0);
  const b = (nom || '').trim().charAt(0);
  return (a + b).toUpperCase() || '?';
}

// ---------------------------------------------------------------------------
// Congés — modèle de données
// ---------------------------------------------------------------------------

/** Structure complète d'un type de congé paramétrable. */
function makeEmptyLeaveType() {
  return {
    id: null,
    ordre: 0,
    actif: true,
    categorie: 'conge', // 'conge' (§14 : CP/RTT/ancienneté) | 'autre' (§15 : maladie, maternité, etc.)
    nom: '',
    icone: '🏖️',
    couleur: '#4f46e5',
    description: '',
    nombreAnnuel: 0,
    illimite: false,
    acquisition: 'Annuelle', // 'Mensuelle' | 'Annuelle' | 'Illimitée'
    paye: true,
    justificatifObligatoire: false,
    // Chaîne de validation ordonnée, ex. ['manager','rh'] ou ['rh'] ou ['manager','directeur'] ou [] (aucune validation).
    // Paramétrable par type de congé ; DEFAULT_SETTINGS.workflowCongesDefault sert de modèle pour un nouveau type.
    workflow: ['manager'],
    saisiParSalarie: true, // §15 : "saisi par le salarié" vs "saisi uniquement par les RH" (ex. arrêts maladie, §24)
    visibleSalarie: true,
    visibleRH: true,
    autoriserDemiJournee: true,
    autoriserPlusieursDemandes: true,
    deduireCompteur: true,
    deduireRTT: false,
    deduireCP: false,
    exportPaie: true
  };
}

/** Structure complète d'une demande de congé. */
function makeEmptyLeaveRequest() {
  return {
    id: null,
    employeeId: null,
    typeId: null,
    dateDebut: '',
    dateFin: '',
    demiJournee: null, // null | 'matin' | 'apres-midi'
    nbJours: 0,
    commentaire: '',
    justificatif: null, // { nom, dataUrl } | null
    statut: 'En attente', // 'En attente' | 'Validé' | 'Refusé' | 'Annulé'
    workflow: [], // copie de la chaîne du type au moment de la demande (les changements ultérieurs du type ne l'affectent pas)
    etapeIndex: -1, // index dans workflow ; -1 = terminé
    historique: [],
    dateCreation: null,
    dateModification: null
  };
}

/** Structure complète d'une demande de télétravail (chaîne de validation paramétrable par l'entreprise). */
function makeEmptyTeleworkRequest() {
  return {
    id: null,
    employeeId: null,
    dateDebut: '',
    dateFin: '',
    nbJours: 0,
    commentaire: '',
    statut: 'En attente', // 'En attente' | 'Validé' | 'Refusé' | 'Annulé'
    workflow: [],
    etapeIndex: -1,
    historique: [],
    dateCreation: null,
    dateModification: null
  };
}

/** Structure complète d'une note de frais. */
function makeEmptyExpense() {
  return {
    id: null,
    employeeId: null,
    categorie: '',
    date: '',
    libelle: '',
    montantTTC: 0,
    tauxTVA: 20,
    kilometrage: null, // { distanceKm, puissanceFiscale } | null — renseigné pour la catégorie "Kilométrique"
    justificatif: null, // { nom, dataUrl } | null
    commentaire: '',
    statut: 'En attente', // 'En attente' | 'Remboursé' | 'Refusé' | 'Annulé'
    workflow: [], // ex. ['manager','comptabilite'], copié depuis settings.workflowFrais à la création
    etapeIndex: -1,
    historique: [],
    dateCreation: null,
    dateModification: null
  };
}

/** Structure complète d'un document du coffre-fort RH d'un salarié. */
function makeEmptyDocument() {
  return {
    id: null,
    employeeId: null,
    categorie: '',
    nom: '',
    dateExpiration: '', // optionnel — utilisé pour les alertes d'échéance (permis, CNI, visite médicale...)
    fichier: null, // { nom, dataUrl } | null
    dateCreation: null,
    dateModification: null
  };
}

function computeMontantHT(montantTTC, tauxTVA) {
  return round2(montantTTC / (1 + (Number(tauxTVA) || 0) / 100));
}

function computeMontantTVA(montantTTC, tauxTVA) {
  return round2(montantTTC - computeMontantHT(montantTTC, tauxTVA));
}

/**
 * Barème kilométrique officiel (voitures), par tranche de puissance fiscale et de distance
 * annuelle. Stocké comme donnée paramétrable — le barème est republié chaque année par
 * l'administration fiscale et n'est donc jamais codé en dur dans le calcul lui-même.
 */
function getBaremeKilometrique() {
  return [
    { cvMax: 3, tranche1: 0.529, tranche2Coef: 0.316, tranche2Fixe: 1065, tranche3: 0.370 },
    { cvMax: 4, tranche1: 0.606, tranche2Coef: 0.340, tranche2Fixe: 1330, tranche3: 0.407 },
    { cvMax: 5, tranche1: 0.636, tranche2Coef: 0.357, tranche2Fixe: 1395, tranche3: 0.427 },
    { cvMax: 6, tranche1: 0.665, tranche2Coef: 0.374, tranche2Fixe: 1457, tranche3: 0.447 },
    { cvMax: Infinity, tranche1: 0.697, tranche2Coef: 0.394, tranche2Fixe: 1515, tranche3: 0.470 }
  ];
}

/** Calcule l'indemnité kilométrique due pour une distance et une puissance fiscale données. */
function calculateIndemniteKilometrique(distanceKm, puissanceFiscale) {
  const tier = getBaremeKilometrique().find(b => puissanceFiscale <= b.cvMax) || getBaremeKilometrique().slice(-1)[0];
  const d = Number(distanceKm) || 0;
  if (d <= 5000) return round2(d * tier.tranche1);
  if (d <= 20000) return round2(d * tier.tranche2Coef + tier.tranche2Fixe);
  return round2(d * tier.tranche3);
}

// ---------------------------------------------------------------------------
// Tickets restaurant — calcul automatique mensuel
// ---------------------------------------------------------------------------

/**
 * Calcule le nombre de tickets restaurant dus à un salarié pour un mois donné, à partir
 * des seules données réelles : jours travaillés, congés validés, télétravail validé et
 * jours fériés. Aucune saisie manuelle — uniquement paramétrable via les réglages.
 */
/** Clé de mois utilisée par employee.ticketsAjustements (§ CORRIGER_TICKETS_RESTAURANT), ex. "2026-07". */
function ticketsMonthKey(year, month) {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

function calculateTicketsRestaurant(employee, year, month, leaveRequests, teleworkRequests, settings) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = toISODate(new Date());
  const holidays = getFrenchPublicHolidays(year);
  const dayLabels = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  let nbTickets = 0;

  // Filtré une seule fois par salarié plutôt que de rescanner tous les congés/télétravail de l'entreprise à chaque jour du mois
  // (mesuré : ~35 000 comparaisons/salarié/mois sur toute l'entreprise -> quelques-unes seulement sur les demandes de CE salarié).
  const employeeLeaves = leaveRequests.filter(r => r.employeeId === employee.id && r.statut === 'Validé');
  const employeeTelework = teleworkRequests.filter(r => r.employeeId === employee.id && r.statut === 'Validé');

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const dateStr = toISODate(date);

    if (dateStr > today) continue; // jour pas encore travaillé
    if (employee.dateEmbauche && dateStr < employee.dateEmbauche) continue;
    if (employee.dateDepart && dateStr > employee.dateDepart) continue;
    if (!(employee.joursTravailles || []).includes(dayLabels[date.getDay()])) continue;
    if (holidays.some(h => h.date === dateStr)) continue;

    const onLeave = employeeLeaves.some(r => dateStr >= r.dateDebut && dateStr <= r.dateFin);
    if (onLeave) continue;

    const remote = employeeTelework.some(r => dateStr >= r.dateDebut && dateStr <= r.dateFin);
    if (remote && !settings.ticketsInclureTeletravail) continue;

    nbTickets += 1;
  }

  // Correction manuelle (§ CORRIGER_TICKETS_RESTAURANT) : ex. jour férié local non reconnu par le
  // calcul standard, déplacement professionnel sans droit à ticket... Remplace, n'ajoute pas, une
  // éventuelle correction précédente pour ce même mois — voir DB.ajusterTicketsRestaurant().
  const ajustement = (employee.ticketsAjustements && employee.ticketsAjustements[ticketsMonthKey(year, month)]) || 0;
  nbTickets = Math.max(0, nbTickets + ajustement);

  const montantTotal = round2(nbTickets * settings.ticketsValeurFaciale);
  const partEmployeur = round2(montantTotal * settings.ticketsPartEmployeurPct / 100);
  const partSalarie = round2(montantTotal - partEmployeur);
  return { nbTickets, montantTotal, partEmployeur, partSalarie, ajustement };
}

/**
 * Moteur de workflow générique : une "chaîne de validation" est un simple tableau ordonné
 * de rôles (ex. ['manager','rh'], ['rh'], ['manager','directeur'], ou [] pour une validation
 * automatique). Utilisé identiquement par les congés, le télétravail et les notes de frais —
 * chaque entreprise choisit sa chaîne dans Paramètres (ou par type pour les congés), sans
 * qu'aucun rôle ni ordre ne soit codé en dur dans le moteur lui-même.
 */
function computeInitialWorkflowStatus(workflow) {
  return (workflow && workflow.length > 0) ? 'En attente' : null;
}

function computeInitialWorkflowStep(workflow) {
  return (workflow && workflow.length > 0) ? 0 : -1;
}

/** Fait avancer une demande d'une étape ; `finalStatut` est le statut de fin de circuit propre au module. */
function advanceWorkflow(request, finalStatut) {
  const historique = (request.historique || []).slice();
  const now = new Date().toISOString();
  const workflow = request.workflow || [];
  const nextIndex = request.etapeIndex + 1;

  if (nextIndex < workflow.length) {
    const roleActuel = ROLE_LABELS[workflow[request.etapeIndex]] || workflow[request.etapeIndex];
    const roleSuivant = ROLE_LABELS[workflow[nextIndex]] || workflow[nextIndex];
    historique.push({ date: now, action: `Validé par ${roleActuel}, en attente de ${roleSuivant}` });
    return { statut: 'En attente', etapeIndex: nextIndex, historique };
  }

  historique.push({ date: now, action: finalStatut });
  return { statut: finalStatut, etapeIndex: -1, historique };
}

/** Refus/annulation génériques, communs aux congés et au télétravail (même forme de demande). */
function refuseRequest(request) {
  const historique = (request.historique || []).slice();
  historique.push({ date: new Date().toISOString(), action: 'Refusé' });
  return { statut: 'Refusé', historique };
}

function cancelRequest(request) {
  const historique = (request.historique || []).slice();
  historique.push({ date: new Date().toISOString(), action: 'Annulé' });
  return { statut: 'Annulé', historique };
}

/** Nombre de jours ouvrés décomptés pour une période, selon les jours travaillés du salarié. */
function computeWorkingDays(dateDebut, dateFin, demiJournee, joursTravailles) {
  if (!dateDebut || !dateFin) return 0;
  const start = new Date(dateDebut);
  const end = new Date(dateFin);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;

  const workedDays = joursTravailles && joursTravailles.length ? joursTravailles : ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'];
  const dayLabels = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

  let count = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    if (workedDays.includes(dayLabels[cursor.getDay()])) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }

  if (demiJournee && start.getTime() === end.getTime() && count === 1) {
    count = 0.5;
  }
  return count;
}

/**
 * Nombre de jours d'une demande (congé ou télétravail) qui tombent dans un mois donné,
 * en découpant la période aux bornes du mois. Réutilise computeWorkingDays plutôt que
 * de dupliquer la boucle de comptage — utilisé par l'export paie.
 */
function countRequestDaysInMonth(dateDebut, dateFin, demiJournee, year, month, joursTravailles) {
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  const start = new Date(dateDebut);
  const end = new Date(dateFin);
  const clippedStart = start < monthStart ? monthStart : start;
  const clippedEnd = end > monthEnd ? monthEnd : end;
  if (clippedStart > clippedEnd) return 0;

  const fullyWithinMonth = start >= monthStart && end <= monthEnd;
  return computeWorkingDays(toISODate(clippedStart), toISODate(clippedEnd), fullyWithinMonth && demiJournee, joursTravailles);
}

function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Acquisition automatique des droits à congé pour un salarié et un type donné,
 * au prorata de l'ancienneté dans l'année, du temps de travail, et selon le
 * mode d'acquisition défini sur le type (mensuelle / annuelle / illimitée).
 * Simplification volontaire : les règles exactes varient selon la convention
 * collective ; ce moteur fournit une base paramétrable, pas un calcul légal figé.
 */
function calculateAcquisition(employee, leaveType, refDate) {
  if (!leaveType || leaveType.illimite || leaveType.acquisition === 'Illimitée') return Infinity;

  const now = refDate ? new Date(refDate) : new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const yearEnd = new Date(now.getFullYear(), 11, 31);
  const hireDate = employee.dateEmbauche ? new Date(employee.dateEmbauche) : yearStart;
  const periodStart = hireDate > yearStart ? hireDate : yearStart;
  const departDate = employee.dateDepart ? new Date(employee.dateDepart) : null;
  const periodEnd = departDate && departDate < now ? departDate : now;

  if (periodStart > periodEnd) return 0;

  const activityRatio = (Number(employee.pourcentageActivite) || 100) / 100;
  const annualAmount = Number(leaveType.nombreAnnuel) || 0;

  if (leaveType.acquisition === 'Mensuelle') {
    let monthsElapsed = (periodEnd.getFullYear() - periodStart.getFullYear()) * 12 + (periodEnd.getMonth() - periodStart.getMonth());
    if (periodEnd.getDate() < periodStart.getDate()) monthsElapsed -= 1;
    monthsElapsed = Math.max(0, monthsElapsed);
    return round2(monthsElapsed * (annualAmount / 12) * activityRatio);
  }

  // Acquisition annuelle : prorata du nombre de jours travaillés sur l'année.
  const daysInYear = daysBetween(yearStart, yearEnd) + 1;
  const daysWorked = daysBetween(periodStart, periodEnd) + 1;
  const prorata = Math.min(Math.max(daysWorked / daysInYear, 0), 1);
  return round2(annualAmount * prorata * activityRatio);
}

/** Solde d'un salarié pour un type de congé : acquis, pris, en attente, disponible.
 * `employee.compteurs` (§ MODIFIER_COMPTEURS) porte un ajustement manuel optionnel par type de
 * congé (jours en plus ou en moins du calcul automatique — ex. reliquat repris d'un ancien SIRH,
 * correction d'erreur) : voir DB.ajusterCompteurConge(). Champ présent dans le schéma depuis le
 * début mais jamais lu avant ce câblage. */
function getLeaveBalance(employee, leaveType, allRequests) {
  const acquis = calculateAcquisition(employee, leaveType);
  const ajustement = (employee.compteurs && employee.compteurs[leaveType.id]) || 0;
  const requests = allRequests.filter(r =>
    r.employeeId === employee.id && r.typeId === leaveType.id && r.statut !== 'Refusé' && r.statut !== 'Annulé'
  );
  const pris = requests.filter(r => r.statut === 'Validé').reduce((sum, r) => sum + r.nbJours, 0);
  const enAttente = requests.filter(r => r.statut !== 'Validé').reduce((sum, r) => sum + r.nbJours, 0);
  const disponible = acquis === Infinity ? Infinity : round2(acquis - pris - enAttente + ajustement);
  return { acquis, pris, enAttente, disponible, ajustement };
}

// ---- Indicateurs du tableau de bord Directeur ----

const JOURS_OUVRES_PAR_AN = 218; // moyenne France (jours ouvrés hors fériés/congés), utilisée comme base de taux

function calculateAverageAnciennete(employees) {
  const actifs = employees.filter(e => e.statut === 'Actif' && e.dateEmbauche);
  if (!actifs.length) return 0;
  const now = new Date();
  const totalAnnees = actifs.reduce((sum, e) => {
    const start = new Date(e.dateEmbauche);
    if (Number.isNaN(start.getTime())) return sum;
    return sum + (now - start) / (365.25 * 24 * 3600 * 1000);
  }, 0);
  return round2(totalAnnees / actifs.length);
}

/** Simplification : sorties sur 12 mois / effectif moyen sur la période (effectif moyen = (début + fin) / 2). */
function calculateTurnoverRate(employees, refDate) {
  const ref = refDate || new Date();
  const depuis = addDays(toISODate(ref), -365);
  const sorties = employees.filter(e => e.dateDepart && e.dateDepart >= depuis && e.dateDepart <= toISODate(ref)).length;
  const entrees = employees.filter(e => e.dateEmbauche && e.dateEmbauche >= depuis && e.dateEmbauche <= toISODate(ref)).length;
  const effectifFin = employees.filter(e => e.statut === 'Actif').length;
  const effectifDebut = Math.max(0, effectifFin - entrees + sorties);
  const effectifMoyen = (effectifDebut + effectifFin) / 2;
  if (!effectifMoyen) return 0;
  return round2((sorties / effectifMoyen) * 100);
}

/** Simplification : les arrêts maladie validés servent de proxy à l'absentéisme, rapportés aux jours ouvrés théoriques de l'effectif actif. */
function calculateAbsenteeismRate(employees, leaveRequests, leaveTypes, year) {
  const maladieTypeIds = leaveTypes.filter(t => t.nom === 'Maladie').map(t => t.id);
  if (!maladieTypeIds.length) return 0;
  const actifsIds = new Set(employees.filter(e => e.statut === 'Actif').map(e => e.id));
  const joursAbsence = leaveRequests
    .filter(r => r.statut === 'Validé' && maladieTypeIds.includes(r.typeId) && actifsIds.has(r.employeeId) && String(r.dateDebut).startsWith(String(year)))
    .reduce((sum, r) => sum + (r.nbJours || 0), 0);
  const joursTheoriques = actifsIds.size * JOURS_OUVRES_PAR_AN;
  if (!joursTheoriques) return 0;
  return round2((joursAbsence / joursTheoriques) * 100);
}

function getAgePyramidBuckets(employees) {
  const buckets = [
    { label: '< 25 ans', min: 0, max: 24, hommes: 0, femmes: 0, autres: 0, total: 0 },
    { label: '25-34 ans', min: 25, max: 34, hommes: 0, femmes: 0, autres: 0, total: 0 },
    { label: '35-44 ans', min: 35, max: 44, hommes: 0, femmes: 0, autres: 0, total: 0 },
    { label: '45-54 ans', min: 45, max: 54, hommes: 0, femmes: 0, autres: 0, total: 0 },
    { label: '55 ans et +', min: 55, max: 999, hommes: 0, femmes: 0, autres: 0, total: 0 }
  ];
  employees.filter(e => e.statut === 'Actif' && e.dateNaissance).forEach(e => {
    const age = calculateAge(e.dateNaissance);
    if (age === null) return;
    const bucket = buckets.find(b => age >= b.min && age <= b.max);
    if (!bucket) return;
    bucket.total += 1;
    if (e.genre === 'Homme') bucket.hommes += 1;
    else if (e.genre === 'Femme') bucket.femmes += 1;
    // "Autre" et genre non renseigné : comptés dans total (toujours) et ici, pour que la vue par
    // genre (§ renderAgePyramidSVG) ne les fasse pas disparaître silencieusement du graphique.
    else bucket.autres += 1;
  });
  return buckets;
}

function getGenderBreakdown(employees) {
  const actifs = employees.filter(e => e.statut === 'Actif');
  const hommes = actifs.filter(e => e.genre === 'Homme').length;
  const femmes = actifs.filter(e => e.genre === 'Femme').length;
  const autre = actifs.filter(e => e.genre === 'Autre').length;
  const nonRenseigne = actifs.length - hommes - femmes - autre;
  const rows = [
    { label: 'Hommes', value: hommes, color: '#2563eb' },
    { label: 'Femmes', value: femmes, color: '#db2777' }
  ];
  // Distingue "Autre" (choix explicite du salarié) de "Non renseigné" (champ jamais rempli) —
  // les confondre sous une même étiquette effacerait un choix explicite de l'intéressé.
  if (autre > 0) rows.push({ label: 'Autre', value: autre, color: '#7c3aed' });
  if (nonRenseigne > 0) rows.push({ label: 'Non renseigné', value: nonRenseigne, color: '#94a3b8' });
  return rows;
}

/** Types de congés fournis par défaut (paramétrables ensuite via l'écran Congés). */
function seedLeaveTypes() {
  const rows = [
    ['Congés payés', '🏖️', '#2563eb', 25, 'Mensuelle', true, false, ['manager'], 'conge'],
    ['RTT', '⏱️', '#7c3aed', 12, 'Mensuelle', true, false, ['manager'], 'conge'],
    ['Ancienneté', '🎖️', '#0891b2', 2, 'Annuelle', true, false, ['manager'], 'conge'],
    ['Maladie', '🌡️', '#16a34a', 0, 'Illimitée', false, true, ['rh'], 'autre'],
    ['Mariage / PACS', '💍', '#db2777', 4, 'Annuelle', true, true, ['manager', 'rh'], 'autre'],
    ['Décès', '🕊️', '#4b5563', 5, 'Annuelle', true, true, ['rh'], 'autre'],
    ['Enfant malade', '🤒', '#f59e0b', 3, 'Annuelle', false, true, ['manager'], 'autre'],
    ['Formation', '📚', '#059669', 5, 'Annuelle', true, false, ['manager', 'rh'], 'autre'],
    ['Naissance / adoption', '👶', '#ec4899', 3, 'Annuelle', true, true, ['rh'], 'autre'],
    ['Proche aidant', '🤝', '#8b5cf6', 0, 'Illimitée', false, true, ['rh'], 'autre'],
    ['Sans solde', '🚫', '#6b7280', 0, 'Illimitée', false, false, ['manager', 'directeur'], 'autre'],
    ['Exceptionnel', '⭐', '#d97706', 3, 'Annuelle', true, false, ['rh'], 'autre']
  ];

  return rows.map((row, i) => {
    const [nom, icone, couleur, nombreAnnuel, acquisition, paye, justificatifObligatoire, workflow, categorie] = row;
    return Object.assign(makeEmptyLeaveType(), {
      id: generateId('lt'),
      ordre: i,
      nom, icone, couleur, nombreAnnuel, acquisition, paye, justificatifObligatoire, workflow, categorie,
      saisiParSalarie: nom.toLowerCase() !== 'maladie', // §24 : arrêts maladie saisis uniquement par les RH
      illimite: acquisition === 'Illimitée'
    });
  });
}

// ---------------------------------------------------------------------------
// Calendrier — jours fériés, vacances scolaires
// ---------------------------------------------------------------------------

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** Les 7 dates (Lundi → Dimanche) de la semaine contenant la date donnée. */
function getWeekDatesContaining(dateStr) {
  const d = new Date(dateStr);
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
}

/** Calcule la date de Pâques pour une année donnée (algorithme de Gauss). */
function getEasterDate(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/** Jours fériés légaux français, calculés automatiquement pour n'importe quelle année. */
function getFrenchPublicHolidays(year) {
  const easter = getEasterDate(year);
  const holidays = [
    [`${year}-01-01`, 'Jour de l\'an'],
    [toISODate(addDays(easter, 1)), 'Lundi de Pâques'],
    [`${year}-05-01`, 'Fête du travail'],
    [`${year}-05-08`, 'Victoire 1945'],
    [toISODate(addDays(easter, 39)), 'Ascension'],
    [toISODate(addDays(easter, 50)), 'Lundi de Pentecôte'],
    [`${year}-07-14`, 'Fête nationale'],
    [`${year}-08-15`, 'Assomption'],
    [`${year}-11-01`, 'Toussaint'],
    [`${year}-11-11`, 'Armistice 1918'],
    [`${year}-12-25`, 'Noël']
  ];
  return holidays.map(([date, label]) => ({ date, label }));
}

/** Retourne la période de vacances scolaires en cours pour une date et une zone, s'il y en a une. */
function findSchoolHolidayPeriod(dateStr, zone, schoolHolidays) {
  return schoolHolidays.periodes.find(p => p.zones.includes(zone) && dateStr >= p.debut && dateStr <= p.fin) || null;
}

/**
 * Vacances scolaires françaises par zone (données officielles, à mettre à jour chaque
 * année scolaire). Stockées comme données paramétrables plutôt que codées dans le calcul,
 * pour rester modifiables depuis un futur écran Paramètres.
 */
function seedSchoolHolidays() {
  return {
    anneeScolaire: '2025-2026',
    periodes: [
      { nom: 'Vacances de la Toussaint', debut: '2025-10-18', fin: '2025-11-02', zones: ['A', 'B', 'C'] },
      { nom: 'Vacances de Noël', debut: '2025-12-20', fin: '2026-01-04', zones: ['A', 'B', 'C'] },
      { nom: 'Vacances d\'hiver', debut: '2026-02-07', fin: '2026-02-22', zones: ['A'] },
      { nom: 'Vacances d\'hiver', debut: '2026-02-14', fin: '2026-03-01', zones: ['C'] },
      { nom: 'Vacances d\'hiver', debut: '2026-02-21', fin: '2026-03-08', zones: ['B'] },
      { nom: 'Vacances de printemps', debut: '2026-04-04', fin: '2026-04-19', zones: ['A'] },
      { nom: 'Vacances de printemps', debut: '2026-04-11', fin: '2026-04-26', zones: ['C'] },
      { nom: 'Vacances de printemps', debut: '2026-04-18', fin: '2026-05-03', zones: ['B'] },
      { nom: 'Vacances d\'été', debut: '2026-07-04', fin: '2026-08-31', zones: ['A', 'B', 'C'] }
    ]
  };
}

/** Données de démonstration chargées au premier lancement. */
function seedEmployees() {
  const base = [
    ['M.', 'Julien', 'Moreau', 'Direction', 'Direction générale', 'Directeur général', 'Cadre', 'CDI', '2015-03-02', 'Temps plein', 100, 39, 'Forfait jours', 'directeur'],
    ['Mme', 'Camille', 'Lefèvre', 'RH', 'Ressources humaines', 'Responsable RH', 'Cadre', 'CDI', '2018-09-10', 'Temps plein', 100, 37, 'Aucun', 'rh'],
    ['M.', 'Nicolas', 'Girard', 'IT', 'Développement', 'Responsable technique', 'Cadre', 'CDI', '2021-01-11', 'Temps plein', 100, 39, 'Aucun', 'manager'],
    ['Mme', 'Sarah', 'Benali', 'Commercial', 'Commerce', 'Commerciale', 'Non cadre', 'CDD', '2024-06-01', 'Temps plein', 100, 35, 'Aucun', 'salarie'],
    ['M.', 'Thomas', 'Petit', 'Comptabilité', 'Finance', 'Comptable', 'Non cadre', 'CDI', '2019-11-20', 'Temps partiel', 80, 28, 'Aucun', 'comptabilite'],
    ['Mme', 'Léa', 'Dubois', 'Support client', 'Support', 'Technicienne support', 'Non cadre', 'Alternance', '2025-09-01', 'Temps plein', 100, 35, 'Aucun', 'salarie']
  ];

  const employees = base.map((row, i) => {
    const [civilite, prenom, nom, service, equipe, poste, statutPro, typeContrat, dateEmbauche, tempsTravail, pourcentageActivite, horairesHebdo, forfait, role] = row;
    const emp = makeEmptyEmployee();
    const now = new Date().toISOString();
    return Object.assign(emp, {
      id: generateId('emp'),
      matricule: 'SRH-' + String(i + 1).padStart(4, '0'),
      civilite, prenom, nom,
      email: `${prenom}.${nom}`.toLowerCase().replace(/[éè]/g, 'e') + '@sevenrh.fr',
      telephone: '06 12 34 56 ' + String(10 + i).padStart(2, '0'),
      adresse: { rue: `${10 + i} rue des Lilas`, codePostal: '75000', ville: 'Paris' },
      dateNaissance: `19${80 + i}-0${(i % 9) + 1}-1${i}`,
      lieuNaissance: 'Paris',
      numeroSecu: `1 ${80 + i} 0${(i % 9) + 1} 75 001 00${i}`,
      dateEmbauche, service, equipe, poste, statutPro, typeContrat,
      tempsTravail, pourcentageActivite, horairesHebdo, forfait,
      managerIds: [],
      statut: 'Actif',
      dateCreation: now,
      dateModification: now,
      role,
      motDePasse: 'Demo1234'
    });
  });

  // Structure hiérarchique de démonstration : Julien (directeur) encadre Camille, Nicolas
  // et Thomas ; Nicolas (manager) encadre Sarah et Léa — de quoi tester un vrai cas
  // "manager avec équipe" plutôt qu'un rattachement uniforme au directeur.
  const [julien, camille, nicolas, sarah, thomas, lea] = employees;
  camille.managerIds = [julien.id];
  nicolas.managerIds = [julien.id];
  thomas.managerIds = [julien.id];
  sarah.managerIds = [nicolas.id];
  lea.managerIds = [nicolas.id];

  return employees;
}
