/**
 * Seven RH — Couche de données
 * Persistance localStorage + modèle de données + listes de référence.
 * Toute liste "métier" (services, postes, conventions...) vit dans DB.settings
 * pour rester paramétrable depuis un futur module Paramètres, plutôt que
 * codée en dur dans les vues.
 */

const ROOT_KEY = 'sevenrh_companies';
const CURRENT_COMPANY_KEY = 'sevenrh_current_company_id';
/** §retour QA du 26/08/2026 (point 2.6) : file d'attente de re-tentative pour les écritures
 * Supabase en arrière-plan qui échouent — voir DB._pendingSync/_pushInBackground plus bas. Clé
 * SÉPARÉE de ROOT_KEY (jamais imbriquée dans l'objet entreprise) : ROOT_KEY est déjà volumineux
 * (documents/logos en base64, historique d'audit qui ne fait que grossir) et flirte déjà avec le
 * quota localStorage (voir le gestionnaire QuotaExceededError de saveCompanies) — cette file ne
 * garde que des identifiants et de petits objets (jamais une liste de salariés/demandes entière),
 * pour ne jamais aggraver ce risque. */
const PENDING_SYNC_KEY = 'sevenrh_pending_sync';
/** Comptes de connexion gardés en parallèle (bascule multi-entreprise façon Gmail, demande du
 * 21/08/2026) — chaque entrée garde son propre jeton Supabase (access + refresh token), PAS de
 * rapport avec les "comptes de connexion" créés pour un salarié au sein d'UNE entreprise
 * (openCreerCompteConnexionModal) : ici il s'agit de plusieurs comptes Supabase Auth DIFFÉRENTS
 * (donc potentiellement dans des entreprises différentes) gardés utilisables sans ressaisir de mot
 * de passe. Voir DB.getSavedAccounts()/switchToSavedAccount()/logoutCurrentAccount() plus bas. */
const SAVED_ACCOUNTS_KEY = 'sevenrh_saved_accounts';
const NOTIF_STORAGE_LIMIT = 500; // même logique que le Journal d'audit (borné à 2000) : évite une croissance illimitée du blob localStorage au fil des années
/** §correctif retour QA du 27/08/2026 ("ce vestige mériterait d'être retiré", audit du 23/08/2026,
 * section 1) : contrairement à ROOT_KEY/CURRENT_COMPANY_KEY, jamais effacée par
 * _purgeLocalCompanyCache() — permet à DB.init() de distinguer un TOUT PREMIER lancement (avant
 * toute inscription/connexion réelle sur ce navigateur, où semer une entreprise de démonstration a
 * du sens) d'un cache simplement vidé après une déconnexion ou corrompu sur un appareil qui a déjà
 * servi à un vrai compte (où ressemer une fausse entreprise de démo n'a jamais de sens — voir DB.init). */
const HAS_RUN_BEFORE_KEY = 'sevenrh_has_run_before';

/**
 * Administrateur BERTOLIS (§9.6) — l'éditeur du logiciel, PAS un salarié d'une entreprise cliente.
 * Stocké hors de ROOT_KEY (aucune entreprise ne le "possède") avec sa propre clé de session, pour
 * qu'un accès BERTOLIS ne puisse jamais se confondre avec une session salarié d'entreprise.
 */
const BERTOLIS_ADMINS_KEY = 'sevenrh_bertolis_admins';
const BERTOLIS_SESSION_KEY = 'sevenrh_bertolis_session';

/**
 * Secret partagé avec l'Edge Function "bertolis-tickets" (voir supabase/functions/bertolis-tickets)
 * — la console BERTOLIS garde son login local (ci-dessus) plutôt qu'un vrai compte Supabase Auth,
 * donc elle ne peut pas passer par les policies RLS habituelles pour lire les tickets support de
 * TOUTES les entreprises. Ce secret joue ce rôle à sa place.
 *
 * ⚠️ COMPROMIS DE SÉCURITÉ ASSUMÉ : ce fichier est servi tel quel dans le bundle JS public
 * (GitHub Pages) — n'importe qui peut lire ce secret en inspectant app.js/data.js, et donc appeler
 * l'Edge Function pour lire/répondre aux tickets de toutes les entreprises clientes. Contrairement
 * au login BERTOLIS local (qui n'accède aujourd'hui à AUCUNE donnée réelle), ce secret donne un
 * accès réel en lecture/écriture via service-role. Acceptable pour une v1 avec peu de clients ; à
 * remplacer par un vrai compte Supabase Auth pour BERTOLIS si le nombre de clients grandit.
 * Doit correspondre EXACTEMENT au secret Supabase "BERTOLIS_TICKETS_SECRET" de la fonction.
 */
const BERTOLIS_TICKETS_SECRET = '9cedfffcd52b0afa010476d1bd528473a6eb267925ab8611';

/**
 * Rôles disponibles et niveau d'accès associé. IMPORTANT — ceci est une simulation
 * de rôles côté navigateur, pas un vrai contrôle d'accès serveur : toute personne
 * ouvrant les outils de développement peut lire/modifier localStorage directement.
 * Utile pour valider les écrans et le workflow, pas pour un déploiement multi-utilisateurs réel.
 */
// §correctif audit du 23/08/2026 (§5) : "directeur" renommé "proprietaire" — ce rôle cumulait
// toutes les permissions, la gestion de l'abonnement et une dérogation de self-service sans
// rapport avec un titre de "directeur" (beaucoup d'entreprises ont plusieurs directeurs — comm,
// commercial... — qui n'ont aucune raison de porter ce rôle). Unique par entreprise (contrainte
// SQL, voir migration 0033), transférable (voir DB.transferProprietaire / transfer_proprietaire).
const ROLES = {
  SALARIE: 'salarie',
  MANAGER: 'manager',
  RH: 'rh',
  COMPTABILITE: 'comptabilite',
  PROPRIETAIRE: 'proprietaire'
};

const ROLE_LABELS = {
  salarie: 'Salarié',
  manager: 'Manager',
  rh: 'RH',
  comptabilite: 'Comptabilité',
  proprietaire: 'Propriétaire'
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
  GERER_ABONNEMENTS: 'gererAbonnements',
  GERER_TICKETS: 'gererTickets',
  GERER_ENTRETIENS: 'gererEntretiens',
  GERER_IDEES: 'gererIdees'
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
    PERMISSIONS.GERER_UTILISATEURS, PERMISSIONS.VOIR_JOURNAL_AUDIT, PERMISSIONS.GERER_TICKETS,
    PERMISSIONS.GERER_ENTRETIENS, PERMISSIONS.GERER_IDEES
  ],
  comptabilite: [
    PERMISSIONS.VOIR_PROPRE_FICHE, PERMISSIONS.MODIFIER_PROPRES_COORDONNEES, PERMISSIONS.VOIR_COMPTEURS,
    PERMISSIONS.CREER_DEMANDE_ABSENCE, PERMISSIONS.CREER_NOTE_FRAIS, PERMISSIONS.VOIR_CALENDRIER_GENERAL,
    PERMISSIONS.CONTROLER_NOTE_FRAIS, PERMISSIONS.MARQUER_NOTE_REMBOURSEE,
    // Sans CORRIGER_TICKETS_RESTAURANT : la Comptabilité consulte/exporte les tickets restaurant mais
    // ne corrige pas manuellement le calcul (réservé à RH/Propriétaire, cf. les compteurs de congés).
    PERMISSIONS.CALCULER_TICKETS_RESTAURANT
  ],
  proprietaire: Object.values(PERMISSIONS)
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
  essentiel: { label: 'Essentiel', nombreSalariesMax: 10 },
  professionnel: { label: 'Professionnel', nombreSalariesMax: 25 },
  premium: { label: 'Premium', nombreSalariesMax: null },
  // À la carte (14/08/2026) : pas de plafond de salariés (voir hasModule()/upsertSubscriptionFromStripe
  // Subscription dans billing/index.ts) — présent ici surtout pour que tout code qui affiche
  // OFFRES_BERTOLIS[abo.offre] (console BERTOLIS, etc.) montre un libellé correct plutôt que de
  // retomber sur "Essai gratuit" par défaut.
  a_la_carte: { label: 'À la carte', nombreSalariesMax: null }
};

const ABONNEMENT_STATUT_LABELS = {
  actif: 'Actif',
  impaye: 'Impayé',
  suspendu: 'Suspendu',
  resilie: 'Résilié',
  non_souscrit: 'Non souscrit'
};

function makeEmptyAbonnement() {
  return {
    offre: 'essai', // clé de OFFRES_BERTOLIS, ou 'a_la_carte' (voir LANDING_ALACARTE_MODULES, app.js)
    periodicite: 'mensuel', // 'mensuel' | 'annuel'
    statut: 'actif', // voir ABONNEMENT_STATUT_LABELS
    dateDebut: toISODate(new Date()),
    dateRenouvellement: '',
    nombreSalariesMax: OFFRES_BERTOLIS.essai.nombreSalariesMax,
    modules: [] // [{ key, quantite }] — seulement rempli quand offre === 'a_la_carte'
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

// Garde en mémoire (pas persistée) les entreprises pour qui la migration des catégories de salarié
// a déjà été tentée cette session — évite de retenter l'écriture à chaque DB.getSettings() une fois
// que settings.categoriesSalarie existe déjà (le check normal suffit alors), et pendant le bref
// instant avant la fin du premier appel this.saveCurrentCompany() lui-même synchrone.
const _categoriesSalarieMigratedCompanyIds = new Set();

/** Catalogue des conventions collectives françaises avec leur code IDCC (Identifiant De Convention
 * Collective), sourcé du wiki travail-industrie.com (lui-même dérivé des brochures JORF/Légifrance)
 * — la liste officielle complète du Ministère du Travail dépasse 700 entrées, dont une grande partie
 * très régionales/obsolètes ; ce catalogue couvre les ~180 conventions les plus courantes pour une
 * PME/ETI française, classées par secteur. Non exhaustif par construction — si une entreprise ne
 * trouve pas la sienne, "Aucune" reste toujours disponible plutôt que d'obliger un choix erroné.
 *
 * §retour QA du 26/08/2026 (point 6.1) : "liste statique, jamais liée à la source" — recherché un
 * vrai jeu de données ouvert (même principe que seedSchoolHolidays, point 6.5) pour resynchroniser
 * automatiquement ; AUCUN n'existe en accès libre pour les conventions collectives (contrairement au
 * calendrier scolaire) — la base KALI officielle n'est accessible que via l'API Légifrance (PISTE),
 * qui exige un compte + des identifiants OAuth à enregistrer, hors de portée d'une simple correction
 * de données. Solution retenue à la place : pointer explicitement vers l'outil officiel de
 * vérification (voir le lien "Vérifier ma convention" dans Paramètres → Entreprise,
 * renderParametresEntreprise) plutôt que de laisser cette liste statique sans aucun moyen de la
 * confronter à la source réelle. Les codes IDCC changent occasionnellement (fusions de branches
 * professionnelles) — cette liste peut donc être en retard sur un IDCC précis, d'où l'importance du
 * lien de vérification plutôt qu'une confiance aveugle dans ce catalogue. */
const IDCC_CONVENTIONS = [
  // Industrie
  { code: '18', nom: 'Industries textiles', secteur: 'Industrie' },
  { code: '44', nom: 'Industries chimiques', secteur: 'Industrie' },
  { code: '45', nom: 'Caoutchouc', secteur: 'Industrie' },
  { code: '83', nom: 'Menuiseries et charpentes (ancienne convention)', secteur: 'Industrie' },
  { code: '87', nom: 'Carrières et matériaux', secteur: 'Industrie' },
  { code: '158', nom: 'Bois et scieries', secteur: 'Industrie' },
  { code: '176', nom: 'Industrie pharmaceutique', secteur: 'Industrie' },
  { code: '184', nom: 'Imprimerie de labeur', secteur: 'Industrie' },
  { code: '200', nom: 'Exploitations frigorifiques', secteur: 'Industrie' },
  { code: '207', nom: 'Cuirs et peaux', secteur: 'Industrie' },
  { code: '247', nom: 'Industries de l\'habillement', secteur: 'Industrie' },
  { code: '292', nom: 'Plasturgie', secteur: 'Industrie' },
  { code: '489', nom: 'Industries du cartonnage', secteur: 'Industrie' },
  { code: '567', nom: 'Bijouterie-joaillerie-orfèvrerie', secteur: 'Industrie' },
  { code: '637', nom: 'Industries et commerce de la récupération (recyclage)', secteur: 'Industrie' },
  { code: '650', nom: 'Métallurgie ingénieurs et cadres (ancienne)', secteur: 'Industrie' },
  { code: '669', nom: 'Fabrication mécanique du verre', secteur: 'Industrie' },
  { code: '700', nom: 'Papiers-cartons (cadres)', secteur: 'Industrie' },
  { code: '1090', nom: 'Services de l\'automobile', secteur: 'Industrie' },
  { code: '1170', nom: 'Tuiles et briques', secteur: 'Industrie' },
  { code: '1388', nom: 'Industrie du pétrole', secteur: 'Industrie' },
  { code: '1396', nom: 'Produits alimentaires élaborés (conserves, plats préparés)', secteur: 'Industrie' },
  { code: '1411', nom: 'Industrie de l\'ameublement', secteur: 'Industrie' },
  { code: '1492', nom: 'Production papiers-cartons (OETAM)', secteur: 'Industrie' },
  { code: '1534', nom: 'Industrie de la viande', secteur: 'Industrie' },
  { code: '1555', nom: 'Produits pharmaceutiques et vétérinaires (fabrication-commerce)', secteur: 'Industrie' },
  { code: '1558', nom: 'Industries céramiques de France', secteur: 'Industrie' },
  { code: '1580', nom: 'Industrie de la chaussure', secteur: 'Industrie' },
  { code: '1586', nom: 'Industries charcutières', secteur: 'Industrie' },
  { code: '1747', nom: 'Boulangerie-pâtisserie industrielle', secteur: 'Industrie' },
  { code: '1938', nom: 'Transformation des volailles', secteur: 'Industrie' },
  { code: '2003', nom: 'Métallurgie Vosges (ancienne convention territoriale)', secteur: 'Industrie' },
  { code: '2147', nom: 'Eau et assainissement', secteur: 'Industrie' },
  { code: '2528', nom: 'Maroquinerie', secteur: 'Industrie' },
  { code: '2728', nom: 'Sucreries et raffineries de sucre', secteur: 'Industrie' },
  { code: '3109', nom: 'Industries alimentaires diverses', secteur: 'Industrie' },
  { code: '3222', nom: 'Menuiseries et charpentes', secteur: 'Industrie' },
  { code: '3238', nom: 'Papiers et cartons (production et transformation)', secteur: 'Industrie' },
  { code: '3248', nom: 'Métallurgie', secteur: 'Industrie' },
  { code: '3249', nom: 'Industrie du béton', secteur: 'Industrie' },
  { code: '3255', nom: 'Boulangerie-pâtisserie industrielle et œuf', secteur: 'Industrie' },
  // BTP
  { code: '1412', nom: 'Génie climatique (installation aéraulique, thermique, frigorifique)', secteur: 'BTP' },
  { code: '1596', nom: 'Bâtiment ≤ 10 salariés (ouvriers)', secteur: 'BTP' },
  { code: '1597', nom: 'Bâtiment > 10 salariés (ouvriers)', secteur: 'BTP' },
  { code: '1702', nom: 'Travaux publics (ouvriers)', secteur: 'BTP' },
  { code: '2420', nom: 'Cadres du bâtiment', secteur: 'BTP' },
  { code: '2609', nom: 'ETAM du bâtiment', secteur: 'BTP' },
  { code: '2614', nom: 'ETAM des travaux publics', secteur: 'BTP' },
  { code: '3107', nom: 'ETAM BTP Martinique', secteur: 'BTP' },
  { code: '3212', nom: 'Cadres des travaux publics', secteur: 'BTP' },
  { code: '3216', nom: 'Négoce des matériaux de construction', secteur: 'BTP' },
  // Services
  { code: '86', nom: 'Publicité', secteur: 'Services' },
  { code: '218', nom: 'Organismes de sécurité sociale', secteur: 'Services' },
  { code: '240', nom: 'Greffes des tribunaux de commerce', secteur: 'Services' },
  { code: '454', nom: 'Remontées mécaniques & ski', secteur: 'Services' },
  { code: '478', nom: 'Sociétés financières', secteur: 'Services' },
  { code: '759', nom: 'Pompes funèbres', secteur: 'Services' },
  { code: '787', nom: 'Experts-comptables', secteur: 'Services' },
  { code: '1043', nom: 'Gardiens & concierges d\'immeubles', secteur: 'Services' },
  { code: '1266', nom: 'Restauration de collectivités', secteur: 'Services' },
  { code: '1285', nom: 'Entreprises artistiques et culturelles', secteur: 'Services' },
  { code: '1307', nom: 'Salles de cinéma', secteur: 'Services' },
  { code: '1316', nom: 'Tourisme social et familial', secteur: 'Services' },
  { code: '1351', nom: 'Prévention et sécurité', secteur: 'Services' },
  { code: '1413', nom: 'Permanents du travail temporaire', secteur: 'Services' },
  { code: '1468', nom: 'Crédit Mutuel', secteur: 'Services' },
  { code: '1480', nom: 'Journalistes', secteur: 'Services' },
  { code: '1486', nom: 'Bureaux d\'études techniques (Syntec)', secteur: 'Services' },
  { code: '1501', nom: 'Restauration rapide', secteur: 'Services' },
  { code: '1512', nom: 'Promotion immobilière', secteur: 'Services' },
  { code: '1516', nom: 'Organismes de formation', secteur: 'Services' },
  { code: '1518', nom: 'Animation - ÉCLAT', secteur: 'Services' },
  { code: '1527', nom: 'Immobilier', secteur: 'Services' },
  { code: '1631', nom: 'Hôtellerie de plein air', secteur: 'Services' },
  { code: '1672', nom: 'Sociétés d\'assurances', secteur: 'Services' },
  { code: '1710', nom: 'Agences de voyages', secteur: 'Services' },
  { code: '1794', nom: 'Institutions de prévoyance', secteur: 'Services' },
  { code: '1909', nom: 'Organismes de tourisme', secteur: 'Services' },
  { code: '1922', nom: 'Radiodiffusion', secteur: 'Services' },
  { code: '1951', nom: 'Experts en automobile', secteur: 'Services' },
  { code: '1979', nom: 'Hôtels, cafés, restaurants (HCR)', secteur: 'Services' },
  { code: '2002', nom: 'Blanchisserie, pressing et teinturerie', secteur: 'Services' },
  { code: '2098', nom: 'Prestataires de services tertiaire', secteur: 'Services' },
  { code: '2120', nom: 'Banques', secteur: 'Services' },
  { code: '2121', nom: 'Édition (livre)', secteur: 'Services' },
  { code: '2128', nom: 'Mutualité', secteur: 'Services' },
  { code: '2148', nom: 'Télécommunications', secteur: 'Services' },
  { code: '2149', nom: 'Activités du déchet', secteur: 'Services' },
  { code: '2150', nom: 'SA et fondations d\'HLM (ESH)', secteur: 'Services' },
  { code: '2152', nom: 'Personnel enseignant des CFA et CFC (UNETP/FNOGEC)', secteur: 'Services' },
  { code: '2190', nom: 'Missions locales et PAIO', secteur: 'Services' },
  { code: '2205', nom: 'Notariat', secteur: 'Services' },
  { code: '2247', nom: 'Courtage d\'assurances', secteur: 'Services' },
  { code: '2257', nom: 'Casinos', secteur: 'Services' },
  { code: '2272', nom: 'Assainissement et maintenance industrielle', secteur: 'Services' },
  { code: '2332', nom: 'Entreprises d\'architecture', secteur: 'Services' },
  { code: '2335', nom: 'Agences générales d\'assurances', secteur: 'Services' },
  { code: '2372', nom: 'Distribution directe', secteur: 'Services' },
  { code: '2378', nom: 'Travail temporaire (intérim)', secteur: 'Services' },
  { code: '2397', nom: 'Mannequins (agences de mannequins)', secteur: 'Services' },
  { code: '2511', nom: 'Sport', secteur: 'Services' },
  { code: '2543', nom: 'Géomètres-experts', secteur: 'Services' },
  { code: '2596', nom: 'Coiffure', secteur: 'Services' },
  { code: '2642', nom: 'Production audiovisuelle', secteur: 'Services' },
  { code: '2683', nom: 'Portage de presse', secteur: 'Services' },
  { code: '2691', nom: 'Enseignement privé indépendant (hors contrat)', secteur: 'Services' },
  { code: '2717', nom: 'Entreprises techniques au service de la création et de l\'événement', secteur: 'Services' },
  { code: '2785', nom: 'Ventes volontaires aux enchères / commissaires-priseurs', secteur: 'Services' },
  { code: '3016', nom: 'Ateliers et chantiers d\'insertion', secteur: 'Services' },
  { code: '3032', nom: 'Esthétique-cosmétique et parfumerie', secteur: 'Services' },
  { code: '3043', nom: 'Propreté et services associés', secteur: 'Services' },
  { code: '3090', nom: 'Spectacle vivant privé', secteur: 'Services' },
  { code: '3097', nom: 'Production cinématographique', secteur: 'Services' },
  { code: '3127', nom: 'Services à la personne (entreprises)', secteur: 'Services' },
  { code: '3218', nom: 'Enseignement privé non lucratif (EPNL)', secteur: 'Services' },
  { code: '3219', nom: 'Portage salarial', secteur: 'Services' },
  { code: '3220', nom: 'Habitat social (OPH et Coop\'HLM)', secteur: 'Services' },
  { code: '3239', nom: 'Particulier employeur', secteur: 'Services' },
  { code: '3250', nom: 'Commissaires de justice et sociétés de ventes volontaires', secteur: 'Services' },
  { code: '3253', nom: 'Salariés des cabinets d\'avocats', secteur: 'Services' },
  { code: '7501', nom: 'Caisses régionales du Crédit agricole', secteur: 'Services' },
  // Commerce
  { code: '43', nom: 'Import-export et commerce international', secteur: 'Commerce' },
  { code: '179', nom: 'Coopératives de consommation', secteur: 'Commerce' },
  { code: '493', nom: 'Vins et spiritueux — gros', secteur: 'Commerce' },
  { code: '573', nom: 'Commerces de gros (étendue)', secteur: 'Commerce' },
  { code: '675', nom: 'Succursales habillement', secteur: 'Commerce' },
  { code: '731', nom: 'Quincaillerie (cadres)', secteur: 'Commerce' },
  { code: '843', nom: 'Boulangerie-pâtisserie artisanale', secteur: 'Commerce' },
  { code: '992', nom: 'Boucherie & charcuterie', secteur: 'Commerce' },
  { code: '1267', nom: 'Pâtisserie artisanale', secteur: 'Commerce' },
  { code: '1383', nom: 'Quincaillerie (employés et agents de maîtrise)', secteur: 'Commerce' },
  { code: '1431', nom: 'Optique-lunetterie de détail', secteur: 'Commerce' },
  { code: '1483', nom: 'Commerce de l\'habillement', secteur: 'Commerce' },
  { code: '1487', nom: 'Horlogerie-bijouterie détail', secteur: 'Commerce' },
  { code: '1504', nom: 'Poissonnerie', secteur: 'Commerce' },
  { code: '1505', nom: 'Commerce alimentaire de proximité', secteur: 'Commerce' },
  { code: '1517', nom: 'Commerces de détail non alimentaires (CDNA)', secteur: 'Commerce' },
  { code: '1536', nom: 'Distributeurs conseils hors domicile (CHD)', secteur: 'Commerce' },
  { code: '1539', nom: 'Entreprises du bureau et du numérique', secteur: 'Commerce' },
  { code: '1557', nom: 'Commerce des articles de sport', secteur: 'Commerce' },
  { code: '1606', nom: 'Bricolage', secteur: 'Commerce' },
  { code: '1686', nom: 'Audiovisuel, électronique et équipement ménager', secteur: 'Commerce' },
  { code: '1760', nom: 'Jardineries et graineteries', secteur: 'Commerce' },
  { code: '1880', nom: 'Négoce de l\'ameublement', secteur: 'Commerce' },
  { code: '1947', nom: 'Négoce de bois d\'œuvre', secteur: 'Commerce' },
  { code: '1978', nom: 'Fleuristes & animaleries', secteur: 'Commerce' },
  { code: '2156', nom: 'Grands magasins et magasins populaires', secteur: 'Commerce' },
  { code: '2198', nom: 'Commerce à distance (VAD / e-commerce)', secteur: 'Commerce' },
  { code: '2216', nom: 'Commerce alimentaire (grande distribution)', secteur: 'Commerce' },
  { code: '3224', nom: 'Distribution et commerce de gros des papiers-cartons', secteur: 'Commerce' },
  { code: '3237', nom: 'Commerce de détail alimentaire spécialisé', secteur: 'Commerce' },
  { code: '3254', nom: 'Boucherie-poissonnerie', secteur: 'Commerce' },
  // Santé
  { code: '29', nom: 'FEHAP (CCN 51)', secteur: 'Santé' },
  { code: '413', nom: 'Établissements pour personnes handicapées (CCN 66)', secteur: 'Santé' },
  { code: '959', nom: 'Laboratoires de biologie médicale', secteur: 'Santé' },
  { code: '993', nom: 'Prothésistes dentaires', secteur: 'Santé' },
  { code: '1147', nom: 'Cabinets médicaux', secteur: 'Santé' },
  { code: '1261', nom: 'ALISFA (centres sociaux, accueil de jeunes enfants)', secteur: 'Santé' },
  { code: '1619', nom: 'Cabinets dentaires', secteur: 'Santé' },
  { code: '1621', nom: 'Répartition pharmaceutique', secteur: 'Santé' },
  { code: '1982', nom: 'Négoce médico-technique', secteur: 'Santé' },
  { code: '1996', nom: 'Pharmacie d\'officine', secteur: 'Santé' },
  { code: '2104', nom: 'Thermalisme', secteur: 'Santé' },
  { code: '2264', nom: 'Hospitalisation privée', secteur: 'Santé' },
  { code: '2564', nom: 'Vétérinaires praticiens salariés', secteur: 'Santé' },
  { code: '2941', nom: 'Aide à domicile (BAD)', secteur: 'Santé' },
  // Transports
  { code: '16', nom: 'Transport routier', secteur: 'Transports' },
  { code: '275', nom: 'Transport aérien (personnel au sol)', secteur: 'Transports' },
  { code: '538', nom: 'Manutention ferroviaire', secteur: 'Transports' },
  { code: '1424', nom: 'Transports publics urbains', secteur: 'Transports' },
  { code: '1612', nom: 'Travail aérien — navigants des essais et réceptions', secteur: 'Transports' },
  { code: '2480', nom: 'Manutention portuaire — Fort-de-France', secteur: 'Transports' },
  { code: '2583', nom: 'Sociétés d\'autoroutes', secteur: 'Transports' },
  { code: '3017', nom: 'Ports et manutention', secteur: 'Transports' },
  { code: '3217', nom: 'Branche ferroviaire', secteur: 'Transports' },
  // Agriculture
  { code: '112', nom: 'Industrie laitière', secteur: 'Agriculture' },
  { code: '1077', nom: 'Négoce agricole et engrais (produits du sol)', secteur: 'Agriculture' },
  { code: '1404', nom: 'Commerce et réparation de matériels agricoles', secteur: 'Agriculture' },
  { code: '1589', nom: 'Mareyeurs-expéditeurs', secteur: 'Agriculture' },
  { code: '1930', nom: 'Transformation des grains (meunerie)', secteur: 'Agriculture' },
  { code: '7018', nom: 'Entreprises du paysage', secteur: 'Agriculture' },
  { code: '7024', nom: 'Production agricole et CUMA', secteur: 'Agriculture' }
];

/** Format d'affichage standard "Nom (IDCC XXXX)" — utilisé pour peupler
 * DEFAULT_SETTINGS.conventionsCollectives ; gardé en fonction nommée au cas où un futur écran
 * aurait besoin de reconstruire ce même libellé (ex. recherche/filtre par secteur). */
function formatConventionCollective(c) {
  return `${c.nom} (IDCC ${c.code})`;
}

// Listes de référence par défaut (modifiables via DB.settings une fois le
// module Paramètres construit — elles ne sont donc pas figées dans le code).
const DEFAULT_SETTINGS = {
  // Les services/équipes ont leur propre catalogue structuré (company.services), pas une simple
  // liste de textes : voir makeEmptyService()/seedServices() et l'onglet Paramètres dédié.
  postes: ['Directeur·rice général·e', 'Responsable RH', 'Chargé·e RH', 'Comptable', 'Commercial·e', 'Développeur·se', 'Technicien·ne support'],
  conventionsCollectives: ['Aucune', ...IDCC_CONVENTIONS.map(formatConventionCollective)],
  statutsPro: ['Non cadre', 'Cadre', 'Agent de maîtrise', 'Dirigeant'],
  typesContrat: ['CDI', 'CDD', 'Stage', 'Alternance', 'Apprentissage', 'Intérim'],
  forfaits: ['Aucun', 'Forfait jours', 'Forfait heures'],
  joursOuvres: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'],
  schoolZone: 'C', // 'A' | 'B' | 'C' — code court, aligné avec LeaveType.zones / seedSchoolHolidays()
  // §correctif retour QA du 27/08/2026 : format des NOUVEAUX matricules (AAAA-NNNN par défaut, ex.
  // 2026-0001) — false retire le tiret (20260001). Purement cosmétique : voir formatMatricule ;
  // n'affecte jamais l'unicité, garantie côté serveur indépendamment de ce réglage.
  matriculeAvecTiret: true,
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
  categoriesDocuments: ['Contrat', 'Avenant', 'Permis', 'CNI', 'Passeport', 'Titre de séjour', 'Visite médicale', 'Habilitation', 'Diplôme', 'Attestation', 'Bulletin de paie', 'Autre'],
  // Jours fériés en plus des 11 fériés nationaux calculés automatiquement (getFrenchPublicHolidays)
  // — ex. jours fériés locaux (Alsace-Moselle), fermeture d'entreprise, pont. { date: 'AAAA-MM-JJ', label }.
  joursFeriesPersonnalises: [],
  // §8 sprint amélioration — personnalise un férié NATIONAL (jamais stocké tel quel, voir
  // getFrenchPublicHolidays) sans le dupliquer dans joursFeriesPersonnalises. Clé = date 'AAAA-MM-JJ'.
  feriesOverrides: {},
  // §9 sprint amélioration — fermetures d'entreprise (plage de dates, pas un jour isolé comme un
  // férié) : { id, nom, dateDebut, dateFin, exceptionsCategories }. Voir isJourTravaillePourSalarie().
  fermetures: [],
  // §10 sprint amélioration — voir makeEmptyCategorieSalarie()/deriveCategoriesSalarieFromStatutPro().
  categoriesSalarie: [],
  // Indicateurs sensibles du tableau de bord Propriétaire, désactivés par défaut (opt-in) :
  // la masse salariale, le genre et la pyramide des âges restent des données que l'entreprise
  // choisit de suivre ou non (cf. l'avertissement affiché juste au-dessus de ces cases à cocher).
  masseSalarialeActivee: false,
  suiviGenreActive: false,
  suiviAgeActive: false,
  // §34 — voir EXPORT_PAIE_MODELES ; exportPaieColonnes n'est utilisé que si exportPaieModele === 'personnalise'.
  exportPaieModele: 'generique',
  exportPaieColonnes: { conges: true, teletravail: true, tickets: true, frais: true },
  // Modèles de checklist d'intégration/de départ (demande du 18/08/2026) — copiés tels quels dans
  // employee.onboardingChecklist/offboardingChecklist au moment où la checklist démarre pour ce
  // salarié (voir ensureOnboardingChecklist/startOffboardingChecklist, app.js) : modifier le modèle
  // ensuite n'affecte jamais les checklists déjà en cours, seulement les prochaines.
  onboardingChecklistTemplate: ['DPAE envoyée', 'Contrat de travail signé', 'Visite médicale d\'embauche planifiée', 'Badge/accès remis', 'Compte informatique créé', 'Mutuelle souscrite', 'Règlement intérieur remis'],
  offboardingChecklistTemplate: ['Matériel récupéré', 'Accès informatiques désactivés', 'Solde de tout compte préparé', 'Certificat de travail remis', 'Attestation Pôle emploi remise', 'Portabilité mutuelle/prévoyance signalée'],
  // Périodicité par défaut du suivi médical (Code du travail — "suivi individuel simple" : 5 ans
  // maximum entre deux visites hors surveillance renforcée, non gérée ici) — configurable car un
  // accord de branche ou une exposition à risque particulière peut imposer un délai plus court.
  // Voir getUpcomingVisitesMedicales (app.js) : la toute première visite (à l'embauche) reste fixée
  // à 3 mois par la loi, non paramétrable, indépendamment de ce réglage.
  visiteMedicalePerioditeMois: 60,
  // Contingent annuel légal d'heures supplémentaires (Code du travail, à défaut d'accord de
  // branche/entreprise fixant un autre plafond) : 220h/salarié/an par défaut en 2026. Au-delà, un
  // repos compensateur obligatoire s'applique (taux variable selon l'effectif — voir
  // tauxReposCompensateur ci-dessous et getReposCompensateurSolde, app.js).
  contingentAnnuelHeuresSup: 220,
  // §retour QA du 26/08/2026 (point 7.21, "compteur en heures") : taux de conversion heures
  // supplémentaires -> repos compensateur, EN POURCENTAGE DE MAJORATION (25 = 1h travaillée devient
  // 1,25h de repos). Volontairement laissé à la charge de l'entreprise, jamais présumé par l'app :
  // le taux réel dépend de l'effectif, d'un accord de branche ou d'entreprise, et du régime retenu
  // (repos compensateur de remplacement vs contrepartie obligatoire en repos) — aucune valeur
  // générique ne serait correcte pour tout le monde. 25 par défaut (taux légal le plus courant pour
  // les 8 premières heures sup./semaine dans les entreprises de plus de 20 salariés, Code du travail
  // art. L3121-36), à vérifier et ajuster par chaque entreprise avec son gestionnaire de paie —
  // jamais une valeur à prendre pour argent comptant sans vérification.
  tauxReposCompensateur: 25,
  // Index de l'égalité professionnelle femmes-hommes (voir DB.enregistrerIndexEgalite) : { [année]:
  // { note, datePublication, mesuresCorrectives } }, une entrée par année civile déclarée.
  indexEgaliteProfessionnelle: {},
  // Postes actuellement recrutés (demande du 17/08/2026) — gérés depuis l'écran Embauche (pas
  // Paramètres) via le même composant chip-add/remove que les listes de référence
  // (renderSettingsListCard/bindChipListEvents). Proposés au candidat sur la page publique de
  // candidature (get_company_public_info) — simple liste de libellés, comme `postes` ci-dessus,
  // pas une entité à part avec ID (un poste ouvert n'a pas besoin d'identité stable au-delà de son
  // libellé, une candidature garde le libellé choisi tel quel).
  postesOuverts: []
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
    // §correctif retour QA du 27/08/2026 : obsolète — cette valeur n'était jamais persistée par
    // saveEmployees (seul saveCompanyProfile la pousse, jamais appelé à la création d'un salarié),
    // donc réinitialisée à chaque nouvelle session et source de matricules dupliqués. La numérotation
    // vient désormais d'un compteur atomique côté serveur (assign_matricule_number, voir
    // assignMatricule ci-dessous et 0040_matricule_atomique.sql) — ce champ ne sert plus qu'à ne pas
    // casser la lecture d'anciens blobs company déjà persistés.
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
    supportTickets: [],
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
 * perte de données (ne touche à rien si l'entreprise a déjà au moins un établissement). Appelée
 * par DB.init(), pour ne jamais laisser une entreprise sans établissement. */
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
 * champ. Heuristique par nom pour les 2 types "congés classiques" (congés payés, RTT) ; tout le
 * reste (dont ancienneté, cf. migrateAncienneteVersAutresAbsences) devient 'autre' par défaut —
 * l'entreprise peut reclasser ensuite depuis Paramètres. Idempotent : ne touche à rien si un type a
 * déjà une catégorie. */
function migrateLeaveTypeCategories(company) {
  const CONGE_NAMES = ['congés payés', 'rtt'];
  let changed = false;
  (company.leaveTypes || []).forEach(t => {
    if (t.categorie) return;
    t.categorie = CONGE_NAMES.includes(t.nom.trim().toLowerCase()) ? 'conge' : 'autre';
    changed = true;
  });
  return changed;
}

/** §correctif retour QA du 26/08/2026 (point 2) : les migrations client ci-dessous
 * (migrateAncienneteVersAutresAbsences etc.) ne s'appliquent qu'aux données déjà en cache
 * localStorage au moment de DB.init() — jamais à une entreprise hydratée depuis Supabase après une
 * VRAIE connexion (login/restoreSession/switchToSession/transferProprietaire/manageEmployeeAccount,
 * tous les appelants ci-dessous), qui remplacent directement _companiesCache sans jamais repasser
 * par DB.init(). C'est précisément pourquoi une entreprise réelle créée avant l'ajout du jeu de
 * types par défaut complet (ex. Seven Sept, retour du 26/08/2026) ne les a jamais vus apparaître :
 * aucune migration ne s'exécute jamais sur ses données réelles. Centralise donc l'appel à
 * hydrateCurrentCompany() ici, un seul endroit, plutôt que de dupliquer un appel de complément à
 * chacun des 7 emplacements où il était fait — risque d'en oublier un sinon.
 *
 * Les AUTRES migrations client (migrateCompanyAbonnement, migrateLeaveTypeSaisiParSalarie,
 * migrateAncienneteVersAutresAbsences) restent, elles, seulement dans DB.init() pour l'instant —
 * même limitation potentielle pour une entreprise réelle, non traitée ici volontairement (hors du
 * point signalé), à évaluer séparément. */
async function hydrateCurrentCompanyWithMigrations() {
  const company = await window.SupabaseSync.hydrateCurrentCompany();
  if (company) {
    // company._currentEmployeeId est déjà présent sur l'objet hydraté (voir les appelants), mais
    // this._currentEmployeeId (DB) ne l'est pas encore à ce stade — tous les appelants l'affectent
    // APRÈS avoir reçu ce retour. Retrouve donc l'utilisateur courant directement sur `company`.
    const currentUser = (company.employees || []).find(e => e.id === company._currentEmployeeId) || null;
    await ensureDefaultLeaveTypesBackfilled(company, currentUser);
  }
  return company;
}

/** Ajoute les types d'absence par défaut manquants (seedLeaveTypes) à une entreprise déjà créée
 * avant leur ajout au jeu par défaut complet — SANS jamais toucher à un type déjà présent, qu'il
 * soit actif ou non, ou déjà modifié par le client. Comparaison par nom (insensible à la casse),
 * seule clé stable disponible ici (les types par défaut n'ont pas d'identifiant fixe entre
 * entreprises).
 *
 * §correctif retour QA du 26/08/2026 (point B.2) : deux défauts corrigés.
 *   1. leave_types_write (RLS) exige gererParametres (RH/Propriétaire) — cette fonction tournait
 *      pourtant à CHAQUE connexion, quel que soit le rôle. Pour un salarié/manager, l'écriture
 *      Supabase était refusée, l'erreur avalée par le catch ci-dessous, et son CACHE LOCAL se
 *      retrouvait avec des types dont l'id n'existe pas en base — toute demande posée sur l'un
 *      d'eux était ensuite rejetée par le serveur (leave_types.id est une clé étrangère de
 *      leave_requests.type_id), sans qu'aucune trace ne remonte au-delà d'un "échec de
 *      synchronisation" générique. Ne tourne donc désormais que pour un utilisateur qui a
 *      RÉELLEMENT le droit d'écrire.
 *   2. La comparaison par nom seule ne distinguait pas "jamais eu ce type" de "l'a eu puis l'a
 *      supprimé volontairement" — un client retirant "Sans solde" le voyait ressusciter à la
 *      prochaine connexion RH. `company.defaultLeaveTypesSeeded` (liste APPEND-ONLY des noms déjà
 *      proposés au moins une fois, jamais retirée même si le type est ensuite supprimé) distingue
 *      maintenant les deux cas. */
async function ensureDefaultLeaveTypesBackfilled(company, currentUser) {
  if (!currentUser || !hasPermission(currentUser, PERMISSIONS.GERER_PARAMETRES)) return;

  const defaults = seedLeaveTypes();
  const allDefaultKeys = defaults.map(t => t.nom.trim().toLowerCase());
  const alreadySeeded = new Set(company.defaultLeaveTypesSeeded || []);
  const existingNames = new Set((company.leaveTypes || []).map(t => t.nom.trim().toLowerCase()));
  const manquants = defaults.filter(t => {
    const key = t.nom.trim().toLowerCase();
    return !existingNames.has(key) && !alreadySeeded.has(key);
  });

  const newSeededList = Array.from(new Set([...alreadySeeded, ...allDefaultKeys]));
  const seededChanged = newSeededList.length !== alreadySeeded.size;
  if (!manquants.length && !seededChanged) return;

  if (manquants.length) {
    const ordreDepart = (company.leaveTypes || []).reduce((max, t) => Math.max(max, t.ordre || 0), -1) + 1;
    manquants.forEach((t, i) => { t.ordre = ordreDepart + i; });
    company.leaveTypes = [...(company.leaveTypes || []), ...manquants];
  }
  company.defaultLeaveTypesSeeded = newSeededList;

  try {
    if (manquants.length) await window.SupabaseSync.pushLeaveTypes(company.leaveTypes, company.id);
    // defaultLeaveTypesSeeded est un champ d'ENTREPRISE (pas un type) — même exclusion de champs
    // que DB.saveCompanyProfile pour le pousser sans écraser le reste de companies.data, mais sans
    // son effet de bord de journalisation (ce marqueur interne n'a aucun intérêt dans le journal
    // d'audit du client).
    const { id, raisonSociale, employees, etablissements, services, settings, leaveTypes, leaveRequests,
      teleworkRequests, expenses, documents, schoolHolidays, auditLog, favorites, notifications,
      brouillons, _currentEmployeeId, abonnement, ...companyData } = company;
    await window.SupabaseSync.pushCompanyProfile(id, raisonSociale, companyData);
  } catch (err) {
    // Échec silencieux volontaire (ex. hors ligne) : `company` reste correct EN MÉMOIRE pour cette
    // session, et la synchronisation sera retentée à la prochaine connexion (cette fonction est
    // idempotente, donc sans risque de doublon si elle se déclenche plusieurs fois).
    console.error('ensureDefaultLeaveTypesBackfilled : échec de synchronisation, retentera à la prochaine connexion.', err);
  }
}

/** Évolution Sprint SIRH premium (§1) : le menu "Congés" ne doit plus contenir QUE congés payés/RTT
 * — "Ancienneté" bascule dans "Autres absences", pour les entreprises déjà créées avant ce
 * changement (la nouvelle valeur par défaut de seedLeaveTypes() couvre les nouvelles entreprises).
 * Idempotent : ne change que le type "Ancienneté" encore classé 'conge'. */
function migrateAncienneteVersAutresAbsences(company) {
  let changed = false;
  (company.leaveTypes || []).forEach(t => {
    if (t.nom.trim().toLowerCase() === 'ancienneté' && t.categorie === 'conge') {
      t.categorie = 'autre';
      changed = true;
    }
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
  const entry = {
    id: generateId('log'),
    date: new Date().toISOString(),
    action, entite,
    cible: cible || '',
    details: details || ''
  };
  list.push(entry);
  company.auditLog = list.length > 2000 ? list.slice(list.length - 2000) : list;
  return entry;
}

/** §retour QA du 26/08/2026 (point 2.6) : catalogues utilisés par la file de re-tentative
 * (DB._pendingSync/_pushInBackground plus bas) pour savoir COMMENT rejouer une écriture échouée.
 * Trois familles, jamais interchangeables :
 *
 * - FULL_RESYNC_TABLES : la liste locale ENTIÈRE est repoussée telle quelle via syncTable (upsert
 *   + balayage de suppression, voir supabase-client.js) — sûr à rejouer sans se souvenir de quoi
 *   avait précisément échoué, PARCE QUE ces tables sont déjà conçues pour un accès en lecture ET
 *   écriture identique pour tout le monde (voir le commentaire au-dessus d'insertRows dans
 *   supabase-client.js).
 * - ID_CLASSIFIED_TABLES : insertion et mise à jour restent VOLONTAIREMENT séparées, jamais un
 *   simple resync intégral — leurs policies RLS d'insertion et de mise à jour diffèrent selon le
 *   rôle (ex. un salarié met à jour sa propre fiche mais ne peut pas en CRÉER une). Un upsert
 *   unique exigerait de satisfaire les deux policies à la fois et échouerait pour exactement le
 *   rôle qui devrait pouvoir agir. On retient donc QUELS identifiants attendaient une insertion vs
 *   une mise à jour, jamais une copie figée de leur contenu — à la nouvelle tentative, on relit
 *   l'état ACTUEL du cache local pour ces identifiants, jamais une donnée périmée qui écraserait une
 *   modification plus récente faite entre-temps.
 * - INSERT_ONLY_TABLES : création unique, jamais mise à jour par ce mécanisme (idées, tickets,
 *   création d'un entretien — leurs mises à jour éventuelles passent par SINGLE_OBJECT_UPDATE_TABLES
 *   ci-dessous). Un doublon éventuel à la nouvelle tentative (la ligne a en fait déjà été créée) est
 *   traité comme un succès (23505, contrainte d'unicité sur l'id), jamais comme un échec permanent.
 */
const FULL_RESYNC_TABLES = {
  etablissements: { getRows: c => c.etablissements, push: (rows, cid) => window.SupabaseSync.pushEtablissements(rows, cid) },
  services: { getRows: c => c.services, push: (rows, cid) => window.SupabaseSync.pushServices(rows, cid) },
  leave_types: { getRows: c => c.leaveTypes, push: (rows, cid) => window.SupabaseSync.pushLeaveTypes(rows, cid) },
  documents: { getRows: c => c.documents, push: (rows, cid) => window.SupabaseSync.pushDocuments(rows, cid) },
  drafts: { getRows: c => c.brouillons, push: (rows, cid) => window.SupabaseSync.pushDrafts(rows, cid) },
  notifications: { getRows: c => c.notifications, push: (rows, cid) => window.SupabaseSync.pushNotifications(rows, cid) }
};

const ID_CLASSIFIED_TABLES = {
  employees: { getRows: c => c.employees, push: (added, modified, cid) => window.SupabaseSync.pushEmployees({ added, modified }, cid) },
  leave_requests: { getRows: c => c.leaveRequests, push: (added, modified, cid) => window.SupabaseSync.pushLeaveRequests({ added, modified }, cid) },
  telework_requests: { getRows: c => c.teleworkRequests, push: (added, modified, cid) => window.SupabaseSync.pushTeleworkRequests({ added, modified }, cid) },
  expenses: { getRows: c => c.expenses, push: (added, modified, cid) => window.SupabaseSync.pushExpenses({ added, modified }, cid) }
};

const INSERT_ONLY_TABLES = {
  support_tickets: { getRows: c => c.supportTickets, push: (rows, cid) => window.SupabaseSync.pushSupportTickets(rows, cid) },
  idees: { getRows: c => c.idees, push: (rows, cid) => window.SupabaseSync.pushIdees(rows, cid) },
  entretiens: { getRows: c => c.entretiens, push: (rows, cid) => window.SupabaseSync.pushEntretiens(rows, cid) }
};

/** Mises à jour d'objet unique déjà idempotentes par construction (un .update() par id ne fait
 * jamais que reposer les mêmes valeurs) — pas de séparation insert/update à gérer ici. */
const SINGLE_OBJECT_UPDATE_TABLES = {
  entretiens: { getRows: c => c.entretiens, push: (obj, cid) => window.SupabaseSync.updateEntretien(obj, cid) }
};

/** Erreur PostgREST/Postgres pour une violation de contrainte d'unicité (id déjà présent) — signe
 * qu'une insertion a en réalité déjà réussi lors d'une tentative précédente dont la réponse s'est
 * perdue (coupure réseau après écriture serveur mais avant réception de la confirmation) : jamais
 * une vraie erreur du point de vue de l'utilisateur, jamais une raison de réessayer indéfiniment. */
function isDuplicateKeyError(err) {
  return Boolean(err && err.code === '23505');
}

const DB = {
  /** Initialise le stockage au TOUT PREMIER lancement de ce navigateur (seed de démo) : une
   * entreprise, active par défaut. §correctif retour QA du 27/08/2026 : ne re-sème JAMAIS au-delà de
   * ce tout premier lancement (voir HAS_RUN_BEFORE_KEY) — auparavant, un cache vidé par
   * _purgeLocalCompanyCache() (déconnexion, connexion refusée) OU simplement corrompu sur un
   * appareil ayant déjà servi à un vrai compte retombait sur cette même fausse entreprise de
   * démonstration, comme si c'était un premier lancement. Sans conséquence pour restoreSession()
   * (qui écrase toujours ce cache par les vraies données Supabase si une session existe), mais un
   * vestige inutile et potentiellement déroutant sur un poste RH partagé entre deux connexions. */
  init() {
    this._loadPendingSync();
    const hasRunBefore = localStorage.getItem(HAS_RUN_BEFORE_KEY) !== null;
    if (!hasRunBefore) localStorage.setItem(HAS_RUN_BEFORE_KEY, '1');
    if (!hasRunBefore && (localStorage.getItem(ROOT_KEY) === null || this.getCompanies().length === 0)) {
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
    const migratedAnciennete = companies.map(c => migrateAncienneteVersAutresAbsences(c)).some(Boolean);
    if (migratedEtablissements || migratedLeaveCategories || migratedAbonnements || migratedSaisiParSalarie || migratedAnciennete) this.saveCompanies(companies);

    // §correctif audit du 23/08/2026 : cette clé contenait un identifiant BERTOLIS auto-semé avec
    // un mot de passe EN CLAIR, comparé côté client (bertolisLogin ci-dessous) — visible par
    // n'importe qui lisant data.js sur le dépôt public. Retiré activement (pas juste "ne plus
    // re-semer") pour purger aussi les navigateurs qui l'avaient déjà, y compris celui de l'équipe
    // BERTOLIS elle-même. La Console BERTOLIS (§9.6) reste d'ailleurs déconnectée des vraies
    // données Supabase (getAllCompaniesForBertolis lit le cache LOCAL, pas une vraie requête
    // multi-entreprises) — un vestige d'avant la migration, jamais reconnecté ni resécurisé depuis.
    // Tant qu'aucun remplacement par une vraie vérification serveur n'est fait, cet écran reste
    // volontairement inaccessible (aucun admin ne peut plus être créé par ce mécanisme).
    if (localStorage.getItem(BERTOLIS_ADMINS_KEY) !== null) {
      localStorage.removeItem(BERTOLIS_ADMINS_KEY);
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

  /** §retour QA du 26/08/2026 (point 2.6) : remplace l'ancien mécanisme (compter les échecs,
   * bloquer beforeunload, espérer qu'une écriture réussie ultérieure "rattrape" la précédente sans
   * jamais vraiment la rejouer — voir l'historique git pour ce commentaire tel qu'il était avant ce
   * correctif). `descriptor` (optionnel — voir _sectionKeyFor plus bas) permet de retenir CE QUI a
   * échoué, pas seulement COMBIEN, et de le rejouer plus tard : au prochain chargement de l'app, à
   * la reconnexion réseau, ou via le bouton "Réessayer" du bandeau (app.js). Le cache local reste
   * la source de vérité dans tous les cas — cette file ne fait que rattraper l'écart avec le
   * serveur, jamais l'inverse. */
  _pushInBackground(promise, descriptor) {
    const sectionKey = descriptor && this._sectionKeyFor(descriptor);
    promise.then(() => {
      if (descriptor && sectionKey) this._clearPendingSync(descriptor.companyId, sectionKey);
      if (this.onSaveSuccess) this.onSaveSuccess();
    }).catch(err => {
      console.error('Échec de synchronisation Supabase :', err);
      if (descriptor && sectionKey) this._markPendingSync(descriptor.companyId, sectionKey, existing => this._mergeDescriptor(existing, descriptor), err);
      if (this.onSaveError) this.onSaveError('Échec de synchronisation en ligne : cette modification n\'est peut-être enregistrée que dans ce navigateur, sans garantie d\'envoi au serveur. Ne fermez pas cette page tant que l\'avertissement en haut de l\'écran n\'a pas disparu.');
    });
  },

  _loadPendingSync() {
    try {
      const raw = localStorage.getItem(PENDING_SYNC_KEY);
      this._pendingSync = raw ? JSON.parse(raw) : {};
    } catch (err) {
      console.error('File de re-tentative corrompue dans localStorage, réinitialisation.', err);
      this._pendingSync = {};
    }
  },

  _savePendingSync() {
    try {
      localStorage.setItem(PENDING_SYNC_KEY, JSON.stringify(this._pendingSync || {}));
    } catch (err) {
      // Volontairement un simple log : cette file est conçue pour rester petite (voir le
      // commentaire sur PENDING_SYNC_KEY) — un échec ici ne doit jamais remonter comme une erreur
      // de sauvegarde à l'utilisateur, l'écriture locale principale a déjà réussi avant cet appel.
      console.error('Échec de l\'enregistrement de la file de re-tentative.', err);
    }
  },

  _sectionKeyFor(descriptor) {
    switch (descriptor.kind) {
      case 'fullResync': return `fullResync:${descriptor.table}`;
      case 'idClassified': return `idClassified:${descriptor.table}`;
      case 'insertOnly': return `insertOnly:${descriptor.table}`;
      case 'singleUpdate': return `singleUpdate:${descriptor.table}:${descriptor.id}`;
      case 'delete': return `delete:${descriptor.table}:${descriptor.id}`;
      case 'blob': return `blob:${descriptor.blob}`;
      case 'auditLogEntry': return `auditLogEntry:${descriptor.entry.id}`;
      default: return null;
    }
  },

  _mergeDescriptor(existing, descriptor) {
    switch (descriptor.kind) {
      case 'idClassified': {
        const insertIds = Array.from(new Set([...(existing.insertIds || []), ...(descriptor.insertIds || [])]));
        // Un id déjà connu comme "à insérer" le reste (voir le commentaire du catalogue plus haut
        // dans ce fichier) — ne jamais le redescendre en "à mettre à jour" même si une modification
        // ultérieure l'a aussi marqué modifié : tant qu'il n'a jamais été créé, seule une
        // insertion peut réussir.
        const updateIds = Array.from(new Set([...(existing.updateIds || []), ...(descriptor.updateIds || [])])).filter(id => !insertIds.includes(id));
        return { insertIds, updateIds };
      }
      case 'insertOnly':
        return { insertIds: Array.from(new Set([...(existing.insertIds || []), ...(descriptor.insertIds || [])])) };
      case 'singleUpdate':
      case 'delete':
        return { id: descriptor.id };
      case 'auditLogEntry':
        return { entry: descriptor.entry };
      default:
        return {};
    }
  },

  _markPendingSync(companyId, sectionKey, mergeFn, err) {
    if (!this._pendingSync) this._loadPendingSync();
    const company = this._pendingSync[companyId] || (this._pendingSync[companyId] = {});
    const existing = company[sectionKey] || { firstFailedAt: new Date().toISOString(), attempts: 0 };
    company[sectionKey] = Object.assign(existing, mergeFn(existing), {
      attempts: (existing.attempts || 0) + 1,
      lastAttemptAt: new Date().toISOString(),
      lastError: (err && err.message) || String(err)
    });
    this._savePendingSync();
  },

  _clearPendingSync(companyId, sectionKey) {
    if (!this._pendingSync || !this._pendingSync[companyId]) return;
    delete this._pendingSync[companyId][sectionKey];
    if (Object.keys(this._pendingSync[companyId]).length === 0) delete this._pendingSync[companyId];
    this._savePendingSync();
  },

  /** Nombre d'écritures distinctes encore en attente pour cette entreprise — lu par
   * renderSyncFailureBanner (app.js), survit à un rechargement de page (contrairement à l'ancien
   * _syncFailureCount, purement en mémoire). */
  getPendingSyncCount(companyId) {
    if (!this._pendingSync) this._loadPendingSync();
    const company = this._pendingSync[companyId];
    return company ? Object.keys(company).length : 0;
  },

  /** Rejoue toutes les écritures en attente pour cette entreprise, dans l'ordre (jamais en
   * parallèle : une mise à jour ne doit jamais dépasser une insertion encore en attente pour la
   * MÊME ligne). Appelé au chargement de l'app, à la reconnexion réseau (voir bindGlobalEvents,
   * app.js), et manuellement via le bandeau de synchronisation. */
  async retryPendingSyncNow(companyId) {
    if (!this._pendingSync) this._loadPendingSync();
    const pending = this._pendingSync[companyId];
    if (!pending) return { attempted: 0, resolved: 0 };
    const company = this.getCompanies().find(c => c.id === companyId);
    // Entreprise plus en cache localement (déconnexion/changement de compte entre-temps) : rien à
    // retenter depuis CE cache — la file, elle, reste persistée jusqu'à la prochaine connexion à
    // cette même entreprise sur ce navigateur.
    if (!company) return { attempted: 0, resolved: 0 };

    let attempted = 0, resolved = 0;
    for (const sectionKey of Object.keys(pending)) {
      attempted++;
      const ok = await this._retryPendingSyncSection(company, sectionKey, pending[sectionKey]);
      if (ok) { this._clearPendingSync(company.id, sectionKey); resolved++; }
    }
    if (this.onSaveSuccess) this.onSaveSuccess();
    return { attempted, resolved };
  },

  async _retryPendingSyncSection(company, sectionKey, data) {
    const [kind, ...rest] = sectionKey.split(':');
    try {
      if (kind === 'fullResync') {
        const cfg = FULL_RESYNC_TABLES[rest.join(':')];
        if (cfg) await cfg.push(cfg.getRows(company) || [], company.id);
        return true;
      }
      if (kind === 'idClassified') {
        const cfg = ID_CLASSIFIED_TABLES[rest.join(':')];
        if (cfg) {
          // !r._redacted : le cache local de leave_requests/telework_requests/expenses contient
          // aussi des versions tronquées des demandes d'autrui (calendrier général) — jamais des
          // données à renvoyer comme si c'était la fiche complète (voir saveLeaveRequests).
          const byId = new Map((cfg.getRows(company) || []).filter(r => !r._redacted).map(r => [r.id, r]));
          const added = (data.insertIds || []).map(id => byId.get(id)).filter(Boolean);
          const modified = (data.updateIds || []).map(id => byId.get(id)).filter(Boolean);
          // Les deux ont depuis été supprimées localement (ex. demande annulée avant que la
          // tentative précédente n'ait pu réussir) : rien à envoyer, mais un succès quand même —
          // l'état local et le but recherché (que le serveur reflète ce cache) sont déjà d'accord.
          if (added.length || modified.length) await cfg.push(added, modified, company.id);
        }
        return true;
      }
      if (kind === 'insertOnly') {
        const cfg = INSERT_ONLY_TABLES[rest.join(':')];
        if (cfg) {
          const byId = new Map((cfg.getRows(company) || []).map(r => [r.id, r]));
          const toInsert = (data.insertIds || []).map(id => byId.get(id)).filter(Boolean);
          if (toInsert.length) {
            try { await cfg.push(toInsert, company.id); }
            catch (err) { if (!isDuplicateKeyError(err)) throw err; }
          }
        }
        return true;
      }
      if (kind === 'singleUpdate') {
        const cfg = SINGLE_OBJECT_UPDATE_TABLES[rest[0]];
        if (cfg) {
          const obj = (cfg.getRows(company) || []).find(r => r.id === data.id);
          if (obj) await cfg.push(obj, company.id); // sinon : supprimé localement depuis, rien à mettre à jour.
        }
        return true;
      }
      if (kind === 'delete') {
        await window.SupabaseSync.deleteRow(rest[0], data.id, company.id);
        return true;
      }
      if (kind === 'blob') {
        await this._resyncBlob(company, rest.join(':'));
        return true;
      }
      if (kind === 'auditLogEntry') {
        try { await window.SupabaseSync.pushAuditLogEntry(data.entry, company.id); }
        catch (err) { if (!isDuplicateKeyError(err)) throw err; }
        return true;
      }
      return true; // clé inconnue (catalogue périmé) : ne bloque jamais indéfiniment sur de l'illisible.
    } catch (err) {
      console.error(`retryPendingSyncNow : nouvelle tentative échouée pour "${sectionKey}".`, err);
      this._markPendingSync(company.id, sectionKey, existing => existing, err);
      return false;
    }
  },

  /** Toujours dérivé de l'état ACTUEL de `company`, jamais d'une copie figée au moment de l'échec —
   * une mise à jour de profil/paramètres converge de la même façon quel que soit le nombre de
   * modifications locales intervenues entre l'échec initial et cette nouvelle tentative. */
  async _resyncBlob(company, blobName) {
    if (blobName === 'companyProfile') {
      const { id, raisonSociale, employees, etablissements, services, settings, leaveTypes, leaveRequests,
        teleworkRequests, expenses, documents, schoolHolidays, auditLog, favorites, notifications,
        brouillons, _currentEmployeeId, abonnement, ...companyData } = company;
      return window.SupabaseSync.pushCompanyProfile(id, raisonSociale, companyData);
    }
    if (blobName === 'settings') return window.SupabaseSync.pushSettings(company.id, company.settings);
    if (blobName === 'schoolHolidays') return window.SupabaseSync.pushSchoolHolidays(company.id, company.schoolHolidays);
    if (blobName === 'favorites') return window.SupabaseSync.pushFavorites(company.id, company.favorites);
    if (blobName === 'auditLogClear') return window.SupabaseSync.pushClearAuditLog(company.id);
  },

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
    // abonnement est exclu volontairement : depuis la migration 0010, il vit dans sa propre table
    // (subscriptions), jamais dans ce blob — le repousser ici écrirait une copie obsolète que
    // personne ne relit plus, mais mieux vaut ne jamais l'y remettre du tout.
    const { id, raisonSociale, employees, etablissements, services, settings, leaveTypes, leaveRequests,
      teleworkRequests, expenses, documents, schoolHolidays, auditLog, favorites, notifications,
      brouillons, _currentEmployeeId, abonnement, ...companyData } = company;
    this._pushInBackground(window.SupabaseSync.pushCompanyProfile(id, raisonSociale, companyData), { kind: 'blob', blob: 'companyProfile', companyId: id });
  },

  // ---- Salariés ----

  getEmployees() {
    return this.getCurrentCompany().employees.slice();
  },

  /** Ne pousse vers Supabase QUE les salariés réellement ajoutés/modifiés (pas toute la liste
   * visible localement) : le cache d'un manager contient aussi les fiches de son équipe qu'il ne
   * peut que LIRE, pas écrire — un renvoi intégral de la liste violerait la sécurité (RLS) même
   * quand seul SON PROPRE salarié a changé. Voir le plan de migration, limite du cache optimiste. */
  saveEmployees(list) {
    const company = this.getCurrentCompany();
    const previous = company.employees;
    company.employees = list;
    this.saveCurrentCompany(company);
    const added = list.filter(e => !previous.some(p => p.id === e.id));
    const modified = list.filter(e => {
      const old = previous.find(p => p.id === e.id);
      return old && JSON.stringify(old) !== JSON.stringify(e);
    });
    const removedIds = previous.filter(p => !list.some(e => e.id === p.id)).map(p => p.id);
    if (added.length || modified.length) this._pushInBackground(window.SupabaseSync.pushEmployees({ added, modified }, company.id),
      { kind: 'idClassified', table: 'employees', companyId: company.id, insertIds: added.map(e => e.id), updateIds: modified.map(e => e.id) });
    removedIds.forEach(id => this._pushInBackground(window.SupabaseSync.deleteRow('employees', id, company.id),
      { kind: 'delete', table: 'employees', companyId: company.id, id }));
  },

  getEmployeeById(id) {
    return this.getEmployees().find(e => e.id === id) || null;
  },

  async addEmployee(data) {
    const company = this.getCurrentCompany();
    const now = new Date().toISOString();
    const settings = this.getSettings();
    // data.matricule : déjà fourni tel quel par l'import Excel en mode "conserver les matricules du
    // fichier" (voir buildImportPreviewRows/importEmployeesRows, app.js) — sinon attribué par le
    // serveur, jamais recalculé localement (voir assignMatricule ci-dessous).
    const matricule = data.matricule || await assignMatricule(company.id, data.dateEmbauche);
    const employee = Object.assign(makeEmptyEmployee(), data, {
      id: generateId('emp'),
      matricule,
      dateCreation: now,
      dateModification: now,
      // Copie figée du modèle au moment de l'embauche (voir DEFAULT_SETTINGS.onboardingChecklistTemplate)
      // — data.onboardingChecklist n'est jamais fourni par le formulaire de création, sauf import.
      onboardingChecklist: data.onboardingChecklist || (settings.onboardingChecklistTemplate || []).map(label => ({ label, fait: false, dateFait: '' }))
    });
    // Passe par saveEmployees (pas un push direct sur company.employees) pour que la nouvelle
    // fiche soit bien envoyée à Supabase — un ajout direct au tableau contourne le diff qui
    // détermine quoi synchroniser.
    this.saveEmployees([...company.employees, employee]);
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
    // Remplace (pas mute) les fiches dont managerIds change : une mutation en place sur le même
    // objet que celui déjà référencé par le cache empêcherait saveEmployees de détecter le
    // changement (comparaison par référence/JSON avant/après toujours égale).
    const list = this.getEmployees().filter(e => e.id !== id).map(e =>
      (e.managerIds || []).includes(id) ? { ...e, managerIds: e.managerIds.filter(m => m !== id) } : e
    );
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
    // Sprint SIRH premium §10 : un brouillon appartient à son ownerId (qui a commencé la saisie),
    // mais peut aussi cibler un AUTRE salarié via champs.employeeId (un manager brouillonnant pour
    // un tiers) — un id fantôme dans l'un ou l'autre laisserait un brouillon inutilisable (repris,
    // son sélecteur de salarié ne proposerait plus personne de valide) traîner indéfiniment.
    this.saveBrouillons(this.getBrouillons().filter(b => b.ownerId !== id && (!b.champs || b.champs.employeeId !== id)));

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
    const settings = Object.assign({}, DEFAULT_SETTINGS, company.settings || {});
    // §10 sprint amélioration : migration silencieuse et unique (par entreprise, par session — pas
    // à chaque lecture) des catégories de salarié depuis les statutPro déjà utilisés. Persistée une
    // seule fois (pas juste calculée à la volée comme les jours fériés) car d'autres structures
    // (règles d'éligibilité de congé, exceptions jours fériés/fermetures) vont référencer ces ids —
    // ils doivent rester stables d'une lecture à l'autre. Écriture directe (pas this.saveSettings)
    // pour ne pas polluer le journal d'audit d'une entrée "Modification Paramètres" fantôme.
    if (company && !settings.categoriesSalarie.length && !_categoriesSalarieMigratedCompanyIds.has(company.id)) {
      _categoriesSalarieMigratedCompanyIds.add(company.id);
      settings.categoriesSalarie = deriveCategoriesSalarieFromStatutPro(this.getEmployees());
      company.settings = settings;
      this.saveCurrentCompany(company);
      this._pushInBackground(window.SupabaseSync.pushSettings(company.id, settings), { kind: 'blob', blob: 'settings', companyId: company.id });
    }
    return settings;
  },

  saveSettings(settings) {
    const company = this.getCurrentCompany();
    company.settings = settings;
    this.saveCurrentCompany(company);
    this.logAudit('Modification', 'Paramètres', 'Listes et réglages généraux');
    this._pushInBackground(window.SupabaseSync.pushSettings(company.id, settings), { kind: 'blob', blob: 'settings', companyId: company.id });
  },

  /** Index de l'égalité professionnelle femmes-hommes (Code du travail, art. L1142-8) — obligatoire
   * chaque année (publication au plus tard le 1er mars) pour toute entreprise d'au moins 50
   * salariés, amende jusqu'à 1% de la masse salariale annuelle en cas de manquement. Le calcul des
   * 4-5 indicateurs officiels nécessite des données de rémunération fines (bandes d'âge/catégorie)
   * que cette app ne modélise pas : on ne recalcule PAS la note ici (voir index-egapro.travail.gouv.fr
   * pour l'outil officiel), on trace seulement la note obtenue/publiée par année, pour ne plus
   * oublier l'échéance. Remplace l'enregistrement de l'année (pas un cumul). */
  enregistrerIndexEgalite(year, note, datePublication, mesuresCorrectives) {
    const settings = this.getSettings();
    const value = Number(note);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      return { success: false, error: 'La note doit être un nombre entre 0 et 100.' };
    }
    const indexEgaliteProfessionnelle = Object.assign({}, settings.indexEgaliteProfessionnelle, {
      [year]: { note: value, datePublication: datePublication || '', mesuresCorrectives: mesuresCorrectives || '' }
    });
    settings.indexEgaliteProfessionnelle = indexEgaliteProfessionnelle;
    this.saveSettings(settings);
    this.logAudit('Modification', 'Index égalité professionnelle', `Année ${year} · note ${value}/100${datePublication ? ' · publié le ' + formatDate(datePublication) : ''}`);
    return { success: true };
  },

  // ---- Catégories de salarié (§10 sprint amélioration) ----

  getCategoriesSalarie() {
    return this.getSettings().categoriesSalarie.slice().sort((a, b) => a.ordre - b.ordre);
  },

  addCategorieSalarie(data) {
    const settings = this.getSettings();
    const categorie = Object.assign(makeEmptyCategorieSalarie(), data, { id: generateId('cat'), ordre: settings.categoriesSalarie.length });
    settings.categoriesSalarie = [...settings.categoriesSalarie, categorie];
    this.saveSettings(settings);
    this.logAudit('Création', 'Catégorie de salarié', categorie.nom);
    return categorie;
  },

  updateCategorieSalarie(id, patch) {
    const settings = this.getSettings();
    settings.categoriesSalarie = settings.categoriesSalarie.map(c => c.id === id ? { ...c, ...patch } : c);
    this.saveSettings(settings);
    this.logAudit('Modification', 'Catégorie de salarié', patch.nom || id);
  },

  /** Retire aussi la référence chez tout salarié qui portait cette catégorie (categorieSalarieId
   * redevient null) plutôt que de laisser un id fantôme — même principe que deleteService/employeeId. */
  deleteCategorieSalarie(id) {
    const settings = this.getSettings();
    const categorie = settings.categoriesSalarie.find(c => c.id === id);
    settings.categoriesSalarie = settings.categoriesSalarie.filter(c => c.id !== id);
    this.saveSettings(settings);

    let employeesChanged = false;
    const employees = this.getEmployees().map(e => {
      if (e.categorieSalarieId !== id) return e;
      employeesChanged = true;
      return { ...e, categorieSalarieId: null };
    });
    if (employeesChanged) this.saveEmployees(employees);

    if (categorie) this.logAudit('Suppression', 'Catégorie de salarié', categorie.nom);
  },

  // ---- Services & équipes (catalogue structuré, pas une simple liste de textes) ----

  // ---- Établissements (§12) ----

  getEtablissements() {
    return (this.getCurrentCompany().etablissements || []).slice();
  },

  saveEtablissements(list) {
    const company = this.getCurrentCompany();
    company.etablissements = list;
    this.saveCurrentCompany(company);
    this._pushInBackground(window.SupabaseSync.pushEtablissements(list, company.id), { kind: 'fullResync', table: 'etablissements', companyId: company.id });
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
    return (this.getCurrentCompany().services || []).slice();
  },

  saveServices(list) {
    const company = this.getCurrentCompany();
    company.services = list;
    this.saveCurrentCompany(company);
    this._pushInBackground(window.SupabaseSync.pushServices(list, company.id), { kind: 'fullResync', table: 'services', companyId: company.id });
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
      // Remplace (pas mute) les fiches concernées : une mutation en place empêcherait le diff de
      // saveEmployees de détecter le changement (voir deleteEmployee pour le même correctif).
      let employeesChanged = false;
      const employees = this.getEmployees().map(e => {
        if (e.service !== oldNom) return e;
        employeesChanged = true;
        return { ...e, service: nom };
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
      let employeesChanged = false;
      const employees = this.getEmployees().map(e => {
        if (e.service !== service.nom) return e;
        employeesChanged = true;
        return { ...e, service: '', equipe: '' };
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
      let employeesChanged = false;
      const employees = this.getEmployees().map(e => {
        if (e.service !== service.nom || e.equipe !== equipe.nom) return e;
        employeesChanged = true;
        return { ...e, equipe: '' };
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
    this._pushInBackground(window.SupabaseSync.pushSchoolHolidays(company.id, data), { kind: 'blob', blob: 'schoolHolidays', companyId: company.id });
  },

  // ---- Types de congés (paramétrables) ----

  getLeaveTypes() {
    return this.getCurrentCompany().leaveTypes.slice().sort((a, b) => a.ordre - b.ordre);
  },

  saveLeaveTypes(list) {
    const company = this.getCurrentCompany();
    company.leaveTypes = list;
    this.saveCurrentCompany(company);
    this._pushInBackground(window.SupabaseSync.pushLeaveTypes(list, company.id), { kind: 'fullResync', table: 'leave_types', companyId: company.id });
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

  /** Même logique que saveEmployees : ne pousser que ce qui a changé — le cache local contient
   * aussi les demandes des collègues (lecture seule pour la plupart des rôles), et certaines de ces
   * entrées sont des versions "redactées" (calendrier général, voir supabase-client.js) qui ne
   * doivent JAMAIS être renvoyées comme si c'étaient des demandes complètes. */
  saveLeaveRequests(list) {
    const company = this.getCurrentCompany();
    const previous = company.leaveRequests;
    company.leaveRequests = list;
    this.saveCurrentCompany(company);
    const added = list.filter(r => !r._redacted && !previous.some(p => p.id === r.id));
    const modified = list.filter(r => {
      if (r._redacted) return false;
      const old = previous.find(p => p.id === r.id);
      return old && JSON.stringify(old) !== JSON.stringify(r);
    });
    const removedIds = previous.filter(p => !p._redacted && !list.some(r => r.id === p.id)).map(p => p.id);
    if (added.length || modified.length) this._pushInBackground(window.SupabaseSync.pushLeaveRequests({ added, modified }, company.id),
      { kind: 'idClassified', table: 'leave_requests', companyId: company.id, insertIds: added.map(r => r.id), updateIds: modified.map(r => r.id) });
    removedIds.forEach(id => this._pushInBackground(window.SupabaseSync.deleteRow('leave_requests', id, company.id),
      { kind: 'delete', table: 'leave_requests', companyId: company.id, id }));
  },

  getLeaveRequestById(id) {
    return this.getLeaveRequests().find(r => r.id === id) || null;
  },

  getLeaveRequestsForEmployee(employeeId) {
    return this.getLeaveRequests().filter(r => r.employeeId === employeeId);
  },

  async addLeaveRequest(data) {
    const list = this.getLeaveRequests();
    const now = new Date().toISOString();
    const leaveType = this.getLeaveTypeById(data.typeId);
    const rawWorkflow = (leaveType && leaveType.workflow) || [];
    const { workflow, overrides, escalated } = await resolveWorkflowWithFallback(data.employeeId, rawWorkflow, 'absence', leaveType && leaveType.workflowValidatorOverrides);
    const request = Object.assign(makeEmptyLeaveRequest(), data, {
      id: generateId('lr'),
      workflow,
      workflowValidatorOverrides: overrides,
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
    // Jamais .then/.catch chaîné sur _pushInBackground (déjà utilisé pour le sync cache ci-dessus,
    // sémantique différente) : un échec Slack ne doit produire NI toast NI blocage, juste un
    // .catch(()=>{}) silencieux — l'utilisateur n'a même pas besoin de savoir que Slack existe.
    if (request.statut === 'En attente' && employee) {
      window.SupabaseSync.notifySlack('🏖️', 'Nouvelle demande de congé', `${employee.prenom} ${employee.nom} · ${leaveType ? leaveType.nom : '—'}`).catch(() => {});
      notifyValidatorsByEmailForNewRequest(request.id, 'conge');
    }
    // §correctif audit du 23/08/2026 (2.3) : `workflowEscalated` n'est JAMAIS mis sur `request`
    // lui-même (donc jamais sauvegardé/poussé vers Supabase, uniquement sur la copie retournée ici)
    // — c'est un signal ponctuel pour que app.js prévienne l'auteur que la chaîne de validation a dû
    // être réajustée (aucun validateur "naturel" trouvé pour une étape), pas un champ durable.
    if (escalated) return Object.assign({}, request, { workflowEscalated: true });
    return request;
  },

  /** §correctif audit du 23/08/2026 (§7.5) : demande générée par une fermeture imposée (jamais
   * saisie par le salarié) — toujours Validé, aucune chaîne de validation (contrairement à
   * addLeaveRequest ci-dessus, qui reprend systématiquement le workflow configuré sur le type :
   * une fermeture décidée par l'entreprise n'a pas à repasser par une validation manager/RH). */
  addFermetureLeaveRequest(data) {
    const list = this.getLeaveRequests();
    const now = new Date().toISOString();
    const request = Object.assign(makeEmptyLeaveRequest(), data, {
      id: generateId('lr'),
      workflow: [],
      etapeIndex: -1,
      statut: 'Validé',
      historique: [{ date: now, action: 'Fermeture imposée (générée automatiquement)' }],
      dateCreation: now,
      dateModification: now
    });
    list.push(request);
    this.saveLeaveRequests(list);
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
      nbJours: computeWorkingDays(request.dateDebut, nouvelleDateFin, false, employee, this.getSettings()),
      prolongations,
      dateModification: new Date().toISOString()
    });
    this.saveLeaveRequests(list);
    this.logAudit('Modification', 'Prolongation arrêt', `${employee.prenom} ${employee.nom} · ${type.nom} · jusqu'au ${formatDate(nouvelleDateFin)}`);
    return { success: true, request: list[index] };
  },

  /** Régularisation d'une demande de congé/absence déjà VALIDÉE (typiquement pour corriger une
   * erreur de saisie ou refléter ce qui s'est réellement passé) : corrige type et/ou dates SUR LE
   * MÊME enregistrement (comme prolongerArretMaladie ci-dessus), en conservant l'historique de
   * chaque régularisation plutôt que d'écraser silencieusement l'ancienne valeur. Repasse par les
   * mêmes contrôles qu'à la création (période d'emploi, chevauchement congé/congé conscient des
   * demi-journées, chevauchement congé/télétravail) — répliqués ici plutôt que d'appeler les
   * fonctions équivalentes d'app.js, pour ne pas faire dépendre la couche données de la couche UI. */
  regulariserDemande(id, { typeId, dateDebut, dateFin, demiJournee, motif }) {
    const list = this.getLeaveRequests();
    const index = list.findIndex(r => r.id === id);
    if (index === -1) return { success: false, error: 'Demande introuvable.' };
    const request = list[index];
    const type = this.getLeaveTypeById(typeId);
    if (!type) return { success: false, error: 'Type de congé introuvable.' };
    if (!dateDebut || !dateFin || dateFin < dateDebut) {
      return { success: false, error: 'La date de fin ne peut pas être avant la date de début.' };
    }
    const employee = this.getEmployeeById(request.employeeId);
    if (employee.dateEmbauche && dateDebut < employee.dateEmbauche) {
      return { success: false, error: `La date de début ne peut pas être avant la date d'embauche (${formatDate(employee.dateEmbauche)}).` };
    }
    if (employee.dateDepart && dateFin > employee.dateDepart) {
      return { success: false, error: `La date de fin ne peut pas être après la date de départ (${formatDate(employee.dateDepart)}).` };
    }

    const demi = demiJournee || null;
    const bothSingleDay = dateDebut === dateFin;
    // Conflit sauf si les deux sont des demi-journées complémentaires sur une même date isolée
    // (même logique que hasConflictingLeaveRequest côté app.js).
    const isConflict = (r) => {
      if (!(r.dateDebut <= dateFin && r.dateFin >= dateDebut)) return false;
      const sameSingleDay = bothSingleDay && r.dateDebut === r.dateFin;
      if (!sameSingleDay) return true;
      if (!demi || !r.demiJournee) return true;
      return demi === r.demiJournee;
    };
    const hasCongeConflict = list.some(r =>
      r.id !== id && r.employeeId === request.employeeId && r.typeId !== typeId &&
      r.statut !== 'Refusé' && r.statut !== 'Annulé' && isConflict(r));
    if (hasCongeConflict) {
      return { success: false, error: 'Ces nouvelles dates chevauchent une autre demande de congé/absence active de ce salarié.' };
    }
    const hasTeleworkConflict = this.getTeleworkRequests().some(r =>
      r.employeeId === request.employeeId && r.statut !== 'Refusé' && r.statut !== 'Annulé' &&
      r.dateDebut <= dateFin && r.dateFin >= dateDebut);
    if (hasTeleworkConflict) {
      return { success: false, error: 'Ces nouvelles dates chevauchent une demande de télétravail active de ce salarié.' };
    }

    const nbJours = computeWorkingDays(dateDebut, dateFin, Boolean(demi), employee, this.getSettings(), type.uniteDecompte);
    if (nbJours <= 0) {
      return { success: false, error: 'Ces nouvelles dates ne couvrent aucun jour travaillé pour ce salarié.' };
    }

    const ancienType = this.getLeaveTypeById(request.typeId);
    const regularisations = (request.regularisations || []).concat([{
      date: new Date().toISOString(),
      ancienType: ancienType ? ancienType.nom : '—',
      ancienneDateDebut: request.dateDebut,
      ancienneDateFin: request.dateFin,
      motif: motif || ''
    }]);
    list[index] = Object.assign({}, request, {
      typeId, dateDebut, dateFin, demiJournee: demi,
      nbJours,
      regularisations,
      dateModification: new Date().toISOString()
    });
    this.saveLeaveRequests(list);
    this.logAudit('Modification', 'Régularisation congé', `${employee.prenom} ${employee.nom} · ${ancienType ? ancienType.nom : '—'} → ${type.nom} · ${formatDate(dateDebut)}${dateDebut !== dateFin ? ' au ' + formatDate(dateFin) : ''}`);
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

  /** Sprint SIRH premium §6 : "Variables" du récapitulatif de Préparation de paie (primes, heures
   * supplémentaires...) — aucun module dédié n'existe pour les calculer automatiquement, saisie
   * manuelle par mois, même principe que ajusterTicketsRestaurant ci-dessus (remplace la valeur du
   * mois, pas un cumul). */
  ajusterVariablesPaie(employeeId, year, month, montant, motif) {
    const employee = this.getEmployeeById(employeeId);
    if (!employee) return { success: false, error: 'Salarié introuvable.' };
    const value = Number(montant);
    if (!Number.isFinite(value)) {
      return { success: false, error: 'Le montant doit être un nombre.' };
    }
    const variablesPaie = Object.assign({}, employee.variablesPaie, { [ticketsMonthKey(year, month)]: value });
    this.updateEmployee(employeeId, { variablesPaie });
    this.logAudit('Modification', 'Variables de paie', `${employee.prenom} ${employee.nom} · ${ticketsMonthKey(year, month)} · ${formatCurrencyFR(value)}${motif ? ' · ' + motif : ''}`);
    return { success: true };
  },

  /** Heures supplémentaires du mois — même principe que ajusterVariablesPaie ci-dessus (remplace la
   * valeur du mois, pas un cumul) : aucun module de pointage n'existe dans l'app pour les détecter
   * automatiquement, saisie manuelle par le service RH/paie. */
  ajusterHeuresSupplementaires(employeeId, year, month, heures, motif) {
    const employee = this.getEmployeeById(employeeId);
    if (!employee) return { success: false, error: 'Salarié introuvable.' };
    const value = Number(heures);
    if (!Number.isFinite(value) || value < 0) {
      return { success: false, error: 'Le nombre d\'heures doit être un nombre positif ou nul.' };
    }
    const heuresSupplementaires = Object.assign({}, employee.heuresSupplementaires, { [ticketsMonthKey(year, month)]: value });
    this.updateEmployee(employeeId, { heuresSupplementaires });
    this.logAudit('Modification', 'Heures supplémentaires', `${employee.prenom} ${employee.nom} · ${ticketsMonthKey(year, month)} · ${formatNumberFR(value)} h${motif ? ' · ' + motif : ''}`);
    return { success: true };
  },

  /** §retour QA du 26/08/2026 (point 7.21) : heures de repos compensateur PRISES ce mois — même
   * principe que ajusterHeuresSupplementaires ci-dessus (remplace la valeur du mois, pas un cumul).
   * Aucune vérification que ça ne dépasse pas le solde disponible : comme le reste de ce module
   * (saisie manuelle, pas de moteur de paie), c'est à RH de vérifier le solde affiché
   * (getReposCompensateurSolde, app.js) avant de saisir — imposer un plafond ici supposerait que le
   * taux de conversion configuré est le bon, ce que l'app ne peut jamais garantir. */
  ajusterReposCompensateurPris(employeeId, year, month, heures, motif) {
    const employee = this.getEmployeeById(employeeId);
    if (!employee) return { success: false, error: 'Salarié introuvable.' };
    const value = Number(heures);
    if (!Number.isFinite(value) || value < 0) {
      return { success: false, error: 'Le nombre d\'heures doit être un nombre positif ou nul.' };
    }
    const reposCompensateurPris = Object.assign({}, employee.reposCompensateurPris, { [ticketsMonthKey(year, month)]: value });
    this.updateEmployee(employeeId, { reposCompensateurPris });
    this.logAudit('Modification', 'Repos compensateur pris', `${employee.prenom} ${employee.nom} · ${ticketsMonthKey(year, month)} · ${formatNumberFR(value)} h${motif ? ' · ' + motif : ''}`);
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

  /** § GERER_UTILISATEURS : crée le compte de connexion Supabase Auth d'un salarié qui n'en a
   * encore aucun (voir supabase/functions/manage-employee-account/index.ts) — remplace l'ancien
   * parcours d'auto-inscription "Créer un compte" (retiré, migration 0014). Mot de passe temporaire
   * généré côté serveur, renvoyé une seule fois pour être transmis au salarié par un autre canal. */
  async creerCompteConnexion(employeeId) {
    const employee = this.getEmployeeById(employeeId);
    if (!employee) return { success: false, error: 'Salarié introuvable.' };
    const result = await window.SupabaseSync.manageEmployeeAccount('create', employeeId);
    if (!result.success) return result;
    const company = await hydrateCurrentCompanyWithMigrations();
    if (company) this._companiesCache = [company];
    this.logAudit('Création', 'Compte de connexion', `${employee.prenom} ${employee.nom}`);
    return { success: true, password: result.password };
  },

  /** § GERER_UTILISATEURS : un RH/Propriétaire impose un nouveau mot de passe sans connaître l'ancien
   * (contrairement à changePassword, en libre-service) — appelle réellement Supabase Auth (voir
   * manage-employee-account/index.ts), contrairement à l'ancienne version qui n'écrivait que dans un
   * champ local (`motDePasse`) devenu sans effet depuis la migration vers Supabase Auth. */
  async forcerNouveauMotDePasse(employeeId, newPassword) {
    const employee = this.getEmployeeById(employeeId);
    if (!employee) return { success: false, error: 'Salarié introuvable.' };
    if (!newPassword || newPassword.length < 6) {
      return { success: false, error: 'Le nouveau mot de passe doit contenir au moins 6 caractères.' };
    }
    const result = await window.SupabaseSync.manageEmployeeAccount('reset', employeeId, newPassword);
    if (!result.success) return result;
    const company = await hydrateCurrentCompanyWithMigrations();
    if (company) this._companiesCache = [company];
    this.logAudit('Modification', 'Mot de passe', `${employee.prenom} ${employee.nom} (réinitialisé par un administrateur)`);
    return { success: true };
  },

  /** § GERER_UTILISATEURS : change le rôle d'un salarié existant (Salarié/Manager/RH/Comptabilité)
   * — jamais sur sa propre fiche (séparation des tâches, même principe que partout ailleurs dans
   * l'app : on ne s'accorde pas soi-même un droit).
   *
   * §correctif audit du 23/08/2026 (§5) : le rôle Propriétaire (ex-Directeur) ne se touche plus du
   * tout par ce chemin générique, ni pour l'attribuer ni pour le retirer — la policy serveur
   * (guard_employee_role_change, migration 0033) le refuse désormais dans tous les cas hors
   * transfert explicite. Voir DB.transferProprietaire ci-dessous, seul chemin valide. */
  changerRoleSalarie(employeeId, newRole, actingUserId) {
    const employee = this.getEmployeeById(employeeId);
    if (!employee) return { success: false, error: 'Salarié introuvable.' };
    if (employeeId === actingUserId) return { success: false, error: 'Vous ne pouvez pas changer votre propre rôle.' };
    if (!Object.values(ROLES).includes(newRole)) return { success: false, error: 'Rôle invalide.' };
    if (newRole === employee.role) return { success: false, error: 'Ce salarié a déjà ce rôle.' };
    if (newRole === ROLES.PROPRIETAIRE || employee.role === ROLES.PROPRIETAIRE) {
      return { success: false, error: 'Le rôle Propriétaire se transfère depuis "Transférer la propriété", pas depuis ce formulaire.' };
    }

    const ancienRole = employee.role;
    this.updateEmployee(employeeId, { role: newRole });
    this.logAudit('Modification', 'Rôle', `${employee.prenom} ${employee.nom} : ${ROLE_LABELS[ancienRole]} → ${ROLE_LABELS[newRole]}`);
    return { success: true };
  },

  /** Transfert de propriété (§5) : seul le Propriétaire actuel peut l'appeler. nouveauRoleAncien
   * est le rôle que L'ACTUEL Propriétaire prendra une fois le transfert effectué (jamais un rôle
   * "Directeur" décoratif implicite — il choisit explicitement). Toute la logique de garde
   * (unicité, self-service, dernier Propriétaire) vit côté serveur (transfer_proprietaire,
   * migration 0033) : ce wrapper ne fait qu'appeler la vraie fonction et rafraîchir le cache local. */
  async transferProprietaire(newProprietaireId, nouveauRoleAncien) {
    const result = await window.SupabaseSync.transferProprietaire(newProprietaireId, nouveauRoleAncien);
    if (!result.success) return result;
    const company = await hydrateCurrentCompanyWithMigrations();
    if (company) {
      this._companiesCache = [company];
      this._currentEmployeeId = company._currentEmployeeId || this._currentEmployeeId;
    }
    return { success: true };
  },

  /** §correctif audit du 23/08/2026 (§7.19) : jeton de MON PROPRE abonnement calendrier — jamais
   * mis en cache localement (contrairement au reste de DB._companiesCache), toujours redemandé au
   * serveur : c'est un secret, pas une donnée d'affichage habituelle. */
  async getIcalToken(scope) {
    return window.SupabaseSync.getOrCreateIcalToken(scope);
  },

  async regenerateIcalToken(scope) {
    return window.SupabaseSync.regenerateIcalToken(scope);
  },

  // ---- Demandes de télétravail ----

  getTeleworkRequests() {
    return this.getCurrentCompany().teleworkRequests.slice().sort((a, b) => new Date(b.dateCreation) - new Date(a.dateCreation));
  },

  saveTeleworkRequests(list) {
    const company = this.getCurrentCompany();
    const previous = company.teleworkRequests;
    company.teleworkRequests = list;
    this.saveCurrentCompany(company);
    const added = list.filter(r => !r._redacted && !previous.some(p => p.id === r.id));
    const modified = list.filter(r => {
      if (r._redacted) return false;
      const old = previous.find(p => p.id === r.id);
      return old && JSON.stringify(old) !== JSON.stringify(r);
    });
    const removedIds = previous.filter(p => !p._redacted && !list.some(r => r.id === p.id)).map(p => p.id);
    if (added.length || modified.length) this._pushInBackground(window.SupabaseSync.pushTeleworkRequests({ added, modified }, company.id),
      { kind: 'idClassified', table: 'telework_requests', companyId: company.id, insertIds: added.map(r => r.id), updateIds: modified.map(r => r.id) });
    removedIds.forEach(id => this._pushInBackground(window.SupabaseSync.deleteRow('telework_requests', id, company.id),
      { kind: 'delete', table: 'telework_requests', companyId: company.id, id }));
  },

  getTeleworkRequestById(id) {
    return this.getTeleworkRequests().find(r => r.id === id) || null;
  },

  getTeleworkRequestsForEmployee(employeeId) {
    return this.getTeleworkRequests().filter(r => r.employeeId === employeeId);
  },

  async addTeleworkRequest(data) {
    const list = this.getTeleworkRequests();
    const now = new Date().toISOString();
    const rawWorkflow = this.getSettings().workflowTeletravail || [];
    const { workflow, escalated } = await resolveWorkflowWithFallback(data.employeeId, rawWorkflow, 'absence');
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
    if (request.statut === 'En attente' && employee) {
      window.SupabaseSync.notifySlack('💻', 'Nouvelle demande de télétravail', `${employee.prenom} ${employee.nom}`).catch(() => {});
      notifyValidatorsByEmailForNewRequest(request.id, 'teletravail');
    }
    // §correctif audit du 23/08/2026 (2.3), même mécanisme que addLeaveRequest ci-dessus.
    if (escalated) return Object.assign({}, request, { workflowEscalated: true });
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
    const previous = company.expenses;
    company.expenses = list;
    this.saveCurrentCompany(company);
    const added = list.filter(e => !previous.some(p => p.id === e.id));
    const modified = list.filter(e => {
      const old = previous.find(p => p.id === e.id);
      return old && JSON.stringify(old) !== JSON.stringify(e);
    });
    const removedIds = previous.filter(p => !list.some(e => e.id === p.id)).map(p => p.id);
    if (added.length || modified.length) this._pushInBackground(window.SupabaseSync.pushExpenses({ added, modified }, company.id),
      { kind: 'idClassified', table: 'expenses', companyId: company.id, insertIds: added.map(e => e.id), updateIds: modified.map(e => e.id) });
    removedIds.forEach(id => this._pushInBackground(window.SupabaseSync.deleteRow('expenses', id, company.id),
      { kind: 'delete', table: 'expenses', companyId: company.id, id }));
  },

  getExpenseById(id) {
    return this.getExpenses().find(n => n.id === id) || null;
  },

  getExpensesForEmployee(employeeId) {
    return this.getExpenses().filter(n => n.employeeId === employeeId);
  },

  async addExpense(data) {
    const list = this.getExpenses();
    const now = new Date().toISOString();
    const rawWorkflow = this.getSettings().workflowFrais || [];
    const { workflow, escalated } = await resolveWorkflowWithFallback(data.employeeId, rawWorkflow, 'frais');
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
    if (expense.statut === 'En attente' && employee) {
      window.SupabaseSync.notifySlack('🧾', 'Nouvelle note de frais', `${employee.prenom} ${employee.nom} · ${expense.libelle || expense.categorie}`).catch(() => {});
      notifyValidatorsByEmailForNewRequest(expense.id, 'frais');
    }
    // §correctif audit du 23/08/2026 (2.3), même mécanisme que addLeaveRequest ci-dessus.
    if (escalated) return Object.assign({}, expense, { workflowEscalated: true });
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

  // ---- Sprint SIRH premium §10 : brouillons de demandes (congé/absence, télétravail, note de
  // frais) — `company.brouillons` ajouté après le lancement initial, lu défensivement (`|| []`,
  // même principe que `documents`) plutôt que migré, aucune entreprise existante n'en a besoin
  // avant la première sauvegarde d'un brouillon. `ownerId` = qui a commencé la saisie (pas
  // forcément `champs.employeeId` : un manager peut brouillonner une demande pour un tiers) — sert
  // à scoper "Mes brouillons" à la bonne personne.

  getBrouillons() {
    return (this.getCurrentCompany().brouillons || []).slice().sort((a, b) => new Date(b.dateModification) - new Date(a.dateModification));
  },

  saveBrouillons(list) {
    const company = this.getCurrentCompany();
    company.brouillons = list;
    this.saveCurrentCompany(company);
    this._pushInBackground(window.SupabaseSync.pushDrafts(list, company.id), { kind: 'fullResync', table: 'drafts', companyId: company.id });
  },

  getBrouillonById(id) {
    return this.getBrouillons().find(b => b.id === id) || null;
  },

  getBrouillonsForOwner(ownerId, type) {
    return this.getBrouillons().filter(b => b.ownerId === ownerId && (!type || b.type === type));
  },

  addBrouillon(data) {
    const list = this.getBrouillons();
    const now = new Date().toISOString();
    const brouillon = Object.assign({ id: generateId('draft'), dateCreation: now, dateModification: now }, data);
    list.push(brouillon);
    this.saveBrouillons(list);
    return brouillon;
  },

  deleteBrouillon(id) {
    this.saveBrouillons(this.getBrouillons().filter(b => b.id !== id));
  },

  // ---- Coffre-fort documents RH ----

  getDocuments() {
    return (this.getCurrentCompany().documents || []).slice();
  },

  saveDocuments(list) {
    const company = this.getCurrentCompany();
    company.documents = list;
    this.saveCurrentCompany(company);
    // Le contenu du fichier n'est jamais envoyé ici : seules les métadonnées + le chemin Storage
    // (une fois l'upload terminé, voir updateDocument ci-dessous) sont synchronisées.
    this._pushInBackground(window.SupabaseSync.pushDocuments(list, company.id), { kind: 'fullResync', table: 'documents', companyId: company.id });
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

  /** D1 (audit fiabilité 19/08/2026) : patche `fichier` avec {nom, path} une fois l'upload Storage
   * terminé (voir uploadJustificatifBestEffort, app.js) — appelé de façon best-effort, jamais dans
   * le flux synchrone de création. */
  updateDocument(id, patch) {
    const list = this.getDocuments();
    const index = list.findIndex(d => d.id === id);
    if (index === -1) return null;
    list[index] = Object.assign({}, list[index], patch, { dateModification: new Date().toISOString() });
    this.saveDocuments(list);
    return list[index];
  },

  deleteDocument(id) {
    const doc = this.getDocumentById(id);
    this.saveDocuments(this.getDocuments().filter(d => d.id !== id));
    if (doc) {
      const employee = this.getEmployeeById(doc.employeeId);
      this.logAudit('Suppression', 'Document', `${employee ? employee.prenom + ' ' + employee.nom : '—'} · ${doc.categorie} · ${doc.nom}`);
    }
  },

  // ---- Tickets support (Phase 2 sprint amélioration RH, §16-17) ----

  getSupportTickets() {
    return (this.getCurrentCompany().supportTickets || []).slice();
  },

  getTicketById(id) {
    return this.getSupportTickets().find(t => t.id === id) || null;
  },

  getMySupportTickets(employeeId) {
    return this.getSupportTickets()
      .filter(t => t.employeeId === employeeId)
      .sort((a, b) => new Date(b.dateCreation) - new Date(a.dateCreation));
  },

  /** Visibles par un salarié donné : ses propres tickets, ou tous ceux de l'entreprise s'il a
   * gererTickets (RH/Propriétaire) — cohérent avec la policy RLS support_tickets_select. */
  getSupportTicketsVisibleTo(employee) {
    const all = this.getSupportTickets().sort((a, b) => new Date(b.dateCreation) - new Date(a.dateCreation));
    if (hasPermission(employee, PERMISSIONS.GERER_TICKETS)) return all;
    return all.filter(t => t.employeeId === employee.id);
  },

  /** L'insertion doit réussir AVANT la notification email et l'analyse IA (les deux relisent le
   * ticket depuis la base par intégrité) — mais ces deux dernières ne dépendent PAS l'une de
   * l'autre, donc lancées en parallèle plutôt qu'en chaîne pour ne pas faire attendre l'email si
   * Claude est lent/indisponible (et vice-versa). Un échec de n'importe laquelle des trois étapes
   * prévient l'utilisateur (comme _pushInBackground) mais ne perd jamais le ticket, déjà
   * enregistré localement au moment de l'appel synchrone ci-dessous. Si l'analyse IA réussit, le
   * cache local est mis à jour pour que l'écran affiche la suggestion sans recharger la page. */
  addSupportTicket(data) {
    const list = this.getSupportTickets();
    const now = new Date().toISOString();
    const ticket = Object.assign(makeEmptyTicket(), data, {
      id: generateId('tick'),
      dateCreation: now,
      dateModification: now
    });
    list.push(ticket);
    const company = this.getCurrentCompany();
    company.supportTickets = list;
    this.saveCurrentCompany(company);
    this._pushInBackground(
      window.SupabaseSync.pushSupportTickets([ticket], company.id).then(() => Promise.all([
        window.SupabaseSync.notifyNewTicket(ticket.id),
        window.SupabaseSync.analyzeTicket(ticket.id).then(result => {
          if (!result.success) return;
          const c = this.getCurrentCompany();
          const t = (c.supportTickets || []).find(x => x.id === ticket.id);
          if (t) { t.aiAnalysis = result.analysis; this.saveCurrentCompany(c); }
        })
      ])),
      // §retour QA du 26/08/2026 (point 2.6) : si SEULS notifyNewTicket/analyzeTicket échouent (le
      // ticket lui-même est bien enregistré), la nouvelle tentative retentera pushSupportTickets
      // pour rien — sans danger (23505, traité comme un succès, voir INSERT_ONLY_TABLES) mais pas
      // les effets de bord manqués (email, analyse IA), volontairement jamais rejoués ici, même
      // convention que les autres notifications "best effort" de l'app (Slack, relance...).
      { kind: 'insertOnly', table: 'support_tickets', companyId: company.id, insertIds: [ticket.id] }
    );
    const employee = this.getEmployeeById(ticket.employeeId);
    this.logAudit('Création', 'Ticket support', `${employee ? employee.prenom + ' ' + employee.nom : '—'} · ${ticket.titre}`);
    return ticket;
  },

  /** Passe par la fonction SQL atomique update_ticket_statut (0018_ticket_suivi_livraison.sql) —
   * même raison qu'addTicketComment ci-dessous : jamais de lire-modifier-réécrire de la ligne
   * complète (écraserait `data.comments`/`data.historique` avec une version locale potentiellement
   * périmée). Alimente aussi l'historique horodaté et, pour le statut "livre", la date de
   * livraison (auto, une seule fois — coalesce côté SQL). Cache local mis à jour APRÈS confirmation
   * du serveur uniquement. */
  async updateSupportTicketStatus(id, statut) {
    const employee = this.getCurrentUser();
    const auteur = employee ? `${employee.prenom} ${employee.nom}` : 'Salarié';
    const result = await window.SupabaseSync.updateTicketStatus(id, statut, auteur);
    if (!result.success) return result;
    const company = this.getCurrentCompany();
    const ticket = (company.supportTickets || []).find(t => t.id === id);
    if (ticket) {
      const now = new Date().toISOString();
      ticket.statut = statut;
      ticket.dateLivraison = statut === 'livre' ? (ticket.dateLivraison || now) : null;
      // Libellé dupliqué localement (plutôt qu'importé d'app.js, couche UI) — reste correct même si
      // TICKET_STATUT_LABELS change de forme, seul le texte de l'historique en pâtirait.
      const statutLabels = { ouvert: 'Nouvelle demande', en_cours: 'En cours', resolu: 'Terminé', livre: 'Livré', ferme: 'Fermé' };
      ticket.historique = [...(ticket.historique || []), { date: now, action: `Statut changé en « ${statutLabels[statut] || statut} »`, auteur }];
      ticket.dateModification = now;
      this.saveCurrentCompany(company);
      this.logAudit('Modification', 'Ticket support', ticket.titre, `Statut changé en « ${statut} »`);
    }
    return result;
  },

  /** Passe par la fonction SQL atomique append_ticket_comment (voir 0017_support_tickets.sql) au
   * lieu de lire-modifier-réécrire toute la ligne : un fil de support est un échange rapide à deux
   * parties (salarié ↔ BERTOLIS), le cas le plus défavorable pour perdre un message en cas
   * d'écritures presque simultanées. Le cache local n'est mis à jour qu'APRÈS confirmation du
   * serveur, et seulement en local (le commentaire est déjà écrit côté serveur par la RPC — pas de
   * second push). */
  async addTicketComment(ticketId, texte) {
    const employee = this.getCurrentUser();
    const auteur = employee ? `${employee.prenom} ${employee.nom}` : 'Salarié';
    const result = await window.SupabaseSync.appendTicketComment(ticketId, auteur, texte);
    if (!result.success) return result;
    const company = this.getCurrentCompany();
    const ticket = (company.supportTickets || []).find(t => t.id === ticketId);
    if (ticket) {
      const comment = { auteur, texte, date: new Date().toISOString() };
      ticket.comments = [...(ticket.comments || []), comment];
      ticket.dateModification = comment.date;
      this.saveCurrentCompany(company);
    }
    return result;
  },

  // ---- Entretiens annuels (§14 modules futurs, construit — voir 0020_entretiens.sql) ----
  // Workflow à 3 statuts volontairement simple (pas le moteur advanceWorkflow des congés, conçu pour
  // une chaîne de VALIDATION configurable, pas une séquence de REMPLISSAGE fixe) : 'a_planifier' →
  // 'auto_evaluation_faite' (dès que le salarié soumet) → 'cloture' (RH décide de clôturer, que le
  // manager ait rempli son retour ou non — jamais bloquant). Le remplissage du retour manager n'a pas
  // son propre statut : sa présence (retourManager non vide) suffit à le signaler dans l'UI.

  getEntretiens() {
    return (this.getCurrentCompany().entretiens || []).slice();
  },

  getEntretienById(id) {
    return this.getEntretiens().find(e => e.id === id) || null;
  },

  getEntretiensForEmployee(employeeId) {
    return this.getEntretiens()
      .filter(e => e.employeeId === employeeId)
      .sort((a, b) => new Date(b.datePrevue) - new Date(a.datePrevue));
  },

  /** Visibles par un salarié donné : les siens, ceux de son équipe s'il est manager (managerIds sur
   * le salarié CIBLE, même relation que getVisibleEmployeeIdsForCurrentUser côté app.js), ou tous
   * s'il a gererEntretiens (RH/Propriétaire) — reflète entretiens_select (0020_entretiens.sql). */
  getEntretiensVisibleTo(employee) {
    const all = this.getEntretiens().sort((a, b) => new Date(b.datePrevue) - new Date(a.datePrevue));
    if (hasPermission(employee, PERMISSIONS.GERER_ENTRETIENS)) return all;
    return all.filter(e => {
      if (e.employeeId === employee.id) return true;
      const target = this.getEmployeeById(e.employeeId);
      return Boolean(target && (target.managerIds || []).includes(employee.id));
    });
  },

  /** Planification : réservée à RH/Propriétaire (voir entretiens_insert) — le salarié ne crée jamais sa
   * propre convocation. */
  addEntretien(data) {
    const now = new Date().toISOString();
    const entretien = {
      id: generateId('entr'),
      employeeId: data.employeeId,
      type: data.type || 'professionnel', // 'professionnel' | 'bilan'
      datePrevue: data.datePrevue,
      heurePrevue: data.heurePrevue || '', // 'HH:MM', optionnel — voir openPlanEntretienModal
      dateRealisee: null,
      statut: 'a_planifier',
      objectifs: data.objectifs || '',
      autoEvaluation: '',
      retourManager: '',
      historique: [{ date: now, action: `Entretien ${data.type === 'bilan' ? 'de bilan' : 'professionnel'} planifié pour le ${formatDate(data.datePrevue)}${data.heurePrevue ? ` à ${data.heurePrevue}` : ''}` }],
      dateCreation: now,
      dateModification: now
    };
    const company = this.getCurrentCompany();
    company.entretiens = [...(company.entretiens || []), entretien];
    this.saveCurrentCompany(company);
    this._pushInBackground(window.SupabaseSync.pushEntretiens([entretien], company.id), { kind: 'insertOnly', table: 'entretiens', companyId: company.id, insertIds: [entretien.id] });
    const employee = this.getEmployeeById(entretien.employeeId);
    this.logAudit('Création', 'Entretien', employee ? `${employee.prenom} ${employee.nom}` : '—', entretien.type);
    return entretien;
  },

  /** Rempli par le salarié concerné — fait avancer le statut une seule fois (jamais de retour en
   * arrière si le salarié modifie sa réponse après coup, tant que l'entretien n'est pas clôturé). */
  updateEntretienAutoEvaluation(id, texte) {
    const company = this.getCurrentCompany();
    const entretien = (company.entretiens || []).find(e => e.id === id);
    if (!entretien) return null;
    const now = new Date().toISOString();
    const premiereSoumission = !entretien.autoEvaluation;
    entretien.autoEvaluation = texte;
    if (entretien.statut === 'a_planifier') entretien.statut = 'auto_evaluation_faite';
    if (premiereSoumission) entretien.historique = [...(entretien.historique || []), { date: now, action: 'Auto-évaluation soumise par le salarié' }];
    entretien.dateModification = now;
    this.saveCurrentCompany(company);
    this._pushInBackground(window.SupabaseSync.updateEntretien(entretien, company.id), { kind: 'singleUpdate', table: 'entretiens', companyId: company.id, id: entretien.id });
    return entretien;
  },

  /** Rempli par le manager de la personne concernée — vérification d'appartenance à l'équipe déjà
   * faite côté UI (bouton visible seulement si canManageEntretienFor), ceci est la couche donnée. */
  updateEntretienRetourManager(id, texte) {
    const company = this.getCurrentCompany();
    const entretien = (company.entretiens || []).find(e => e.id === id);
    if (!entretien) return null;
    const now = new Date().toISOString();
    const premiereSoumission = !entretien.retourManager;
    entretien.retourManager = texte;
    if (premiereSoumission) entretien.historique = [...(entretien.historique || []), { date: now, action: 'Retour ajouté par le manager' }];
    entretien.dateModification = now;
    this.saveCurrentCompany(company);
    this._pushInBackground(window.SupabaseSync.updateEntretien(entretien, company.id), { kind: 'singleUpdate', table: 'entretiens', companyId: company.id, id: entretien.id });
    return entretien;
  },

  /** Clôture par RH/Propriétaire (gererEntretiens) — fige la date de réalisation si elle n'était pas
   * déjà renseignée (coalesce local, comme dateLivraison pour les tickets support). */
  clotureEntretien(id) {
    const company = this.getCurrentCompany();
    const entretien = (company.entretiens || []).find(e => e.id === id);
    if (!entretien) return null;
    const now = new Date().toISOString();
    entretien.statut = 'cloture';
    entretien.dateRealisee = entretien.dateRealisee || toISODate(new Date());
    entretien.historique = [...(entretien.historique || []), { date: now, action: 'Entretien clôturé' }];
    entretien.dateModification = now;
    this.saveCurrentCompany(company);
    this._pushInBackground(window.SupabaseSync.updateEntretien(entretien, company.id), { kind: 'singleUpdate', table: 'entretiens', companyId: company.id, id: entretien.id });
    const employee = this.getEmployeeById(entretien.employeeId);
    this.logAudit('Modification', 'Entretien', employee ? `${employee.prenom} ${employee.nom}` : '—', 'Clôturé');
    return entretien;
  },

  // ---- Boîte à idées (§14 modules futurs, construit — voir 0021_idees.sql) ----
  // Contrairement aux entretiens, visible par toute l'entreprise (tableau collectif) — pas de
  // getXxxVisibleTo ici, getIdees() suffit puisque la policy select côté serveur est déjà ouverte
  // à toute l'entreprise (voir 0021_idees.sql).

  getIdees() {
    return (this.getCurrentCompany().idees || []).slice().sort((a, b) => (b.votes || []).length - (a.votes || []).length || new Date(b.dateCreation) - new Date(a.dateCreation));
  },

  getIdeeById(id) {
    return (this.getCurrentCompany().idees || []).find(i => i.id === id) || null;
  },

  addIdee(data) {
    const now = new Date().toISOString();
    const idee = {
      id: generateId('idee'),
      employeeId: data.employeeId,
      titre: data.titre,
      description: data.description || '',
      statut: 'nouvelle',
      votes: [],
      historique: [{ date: now, action: 'Idée proposée' }],
      dateCreation: now,
      dateModification: now
    };
    const company = this.getCurrentCompany();
    company.idees = [...(company.idees || []), idee];
    this.saveCurrentCompany(company);
    this._pushInBackground(window.SupabaseSync.pushIdees([idee], company.id), { kind: 'insertOnly', table: 'idees', companyId: company.id, insertIds: [idee.id] });
    const employee = this.getEmployeeById(idee.employeeId);
    this.logAudit('Création', 'Idée', employee ? `${employee.prenom} ${employee.nom}` : '—', idee.titre);
    return idee;
  },

  /** Passe par la fonction SQL atomique toggle_idee_vote (0021_idees.sql) — jamais de lire-modifier-
   * réécrire du tableau `votes` côté client, qui écraserait le vote d'un autre salarié posé entre
   * l'hydratation locale et cet appel. Le cache local n'est mis à jour qu'APRÈS confirmation du
   * serveur (qui renvoie le tableau votes à jour), pas de mise à jour optimiste ici — contrairement
   * au reste de l'app, un double-clic sur "voter" ne doit jamais donner l'illusion d'un 2e vote. */
  async toggleIdeeVote(id) {
    const result = await window.SupabaseSync.toggleIdeeVote(id);
    if (!result.success) return result;
    const company = this.getCurrentCompany();
    const idee = (company.idees || []).find(i => i.id === id);
    if (idee) {
      idee.votes = result.votes;
      idee.dateModification = new Date().toISOString();
      this.saveCurrentCompany(company);
    }
    return result;
  },

  /** Passe par set_idee_statut (0021_idees.sql), qui vérifie lui-même gererIdees côté serveur —
   * défense en profondeur en plus du bouton masqué côté UI si l'utilisateur n'a pas la permission. */
  async setIdeeStatut(id, statut) {
    const employee = this.getCurrentUser();
    const auteur = employee ? `${employee.prenom} ${employee.nom}` : 'RH';
    const result = await window.SupabaseSync.setIdeeStatut(id, statut, auteur);
    if (!result.success) return result;
    const company = this.getCurrentCompany();
    const idee = (company.idees || []).find(i => i.id === id);
    if (idee) {
      const now = new Date().toISOString();
      idee.statut = statut;
      idee.historique = [...(idee.historique || []), { date: now, action: `Statut changé en « ${statut} »`, auteur }];
      idee.dateModification = now;
      this.saveCurrentCompany(company);
    }
    return result;
  },

  // ---- Journal d'audit ----

  getAuditLog() {
    return this.getCurrentCompany().auditLog.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  },

  /** Historique borné (2000 entrées) pour ne pas saturer le localStorage indéfiniment. */
  logAudit(action, entite, cible, details) {
    const company = this.getCurrentCompany();
    const entry = appendAuditLogEntry(company, action, entite, cible, details);
    this.saveCurrentCompany(company);
    this._pushInBackground(window.SupabaseSync.pushAuditLogEntry(entry, company.id), { kind: 'auditLogEntry', companyId: company.id, entry });
  },

  clearAuditLog() {
    const company = this.getCurrentCompany();
    company.auditLog = [];
    this.saveCurrentCompany(company);
    this._pushInBackground(window.SupabaseSync.pushClearAuditLog(company.id), { kind: 'blob', blob: 'auditLogClear', companyId: company.id });
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
    this._pushInBackground(window.SupabaseSync.pushFavorites(company.id, company.favorites), { kind: 'blob', blob: 'favorites', companyId: company.id });
    return list.includes(id);
  },

  // ---- Notifications ----

  /** Lu/archivé sont personnels à chaque utilisateur (luPar/archivePar, par id de salarié) : une même notification peut être lue par la RH et non lue par le Propriétaire. */
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
    this._pushInBackground(window.SupabaseSync.pushNotifications(list, company.id), { kind: 'fullResync', table: 'notifications', companyId: company.id });
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

  /** §correctif retour QA du 26/08/2026 : une notification "demande en attente" (ou sa relance/
   * remontée, §7.13) restait affichée indéfiniment — avec son libellé "en attente" devenu faux —
   * même une fois la demande réellement validée/refusée : addNotificationsIfNew n'est qu'additif,
   * rien ne retirait jamais une entrée devenue obsolète. Retire ici toute notification dont le
   * sourceKey est de la forme "leave-<id>"/"telework-<id>"/"expense-<id>"/"relance-<id>"/
   * "escalade-<id>" quand <id> ne correspond plus à AUCUNE demande encore "En attente" ;
   * n'importe quelle autre notification (anniversaires, tickets, entretiens...) n'est pas de ce
   * type et reste intouchée. */
  pruneResolvedRequestNotifications(pendingIds) {
    const STALE_PREFIXES = ['leave-', 'telework-', 'expense-', 'relance-', 'escalade-'];
    const list = this.getCurrentCompany().notifications;
    const cleaned = list.filter(n => {
      const prefix = STALE_PREFIXES.find(p => n.sourceKey && n.sourceKey.startsWith(p));
      if (!prefix) return true;
      return pendingIds.has(n.sourceKey.slice(prefix.length));
    });
    if (cleaned.length !== list.length) this.saveNotifications(cleaned);
  },

  // ---- Authentification réelle (Supabase Auth, voir supabase-client.js — remplace la simulation
  // navigateur précédente, qui comparait un mot de passe en clair stocké dans localStorage) ----

  _currentEmployeeId: null,

  getCurrentUser() {
    if (!this._currentEmployeeId) return null;
    return this.getEmployeeById(this._currentEmployeeId);
  },

  isLoggedIn() {
    return this._currentEmployeeId !== null;
  },

  // ---- Comptes gardés en parallèle (bascule multi-entreprise, voir SAVED_ACCOUNTS_KEY) ----

  getSavedAccounts() {
    try { return JSON.parse(localStorage.getItem(SAVED_ACCOUNTS_KEY) || '[]'); }
    catch (err) { return []; }
  },

  _saveSavedAccounts(accounts) {
    localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(accounts));
  },

  /** Enregistre/actualise l'entrée de ce compte après une connexion réussie (login, restauration de
   * session, création d'entreprise) — jamais appelé directement par l'UI, uniquement par les
   * méthodes ci-dessous qui viennent de réussir une hydratation complète. */
  _upsertSavedAccount(session, employee, company) {
    if (!session || !session.user) return;
    this._currentAuthUserId = session.user.id;
    const accounts = this.getSavedAccounts();
    const idx = accounts.findIndex(a => a.id === session.user.id);
    const entry = {
      id: session.user.id,
      email: session.user.email || '',
      prenom: employee ? employee.prenom : '',
      nom: employee ? employee.nom : '',
      companyName: (company && company.raisonSociale) || '',
      session: { access_token: session.access_token, refresh_token: session.refresh_token, expires_at: session.expires_at }
    };
    if (idx === -1) accounts.push(entry); else accounts[idx] = entry;
    this._saveSavedAccounts(accounts);
  },

  /** Le jeton d'accès est rotaté automatiquement par Supabase (TOKEN_REFRESHED) tant que l'onglet
   * reste ouvert — sans ça, le refresh_token stocké ici pour ce compte devient rapidement périmé et
   * la bascule échouerait la prochaine fois qu'on y revient, même resté connecté sans interruption.
   * Voir l'abonnement window.SupabaseSync.onSessionRefreshed dans app.js (DOMContentLoaded). */
  _touchSavedAccountToken(session) {
    if (!session || !session.user) return;
    const accounts = this.getSavedAccounts();
    const idx = accounts.findIndex(a => a.id === session.user.id);
    if (idx === -1) return;
    accounts[idx].session = { access_token: session.access_token, refresh_token: session.refresh_token, expires_at: session.expires_at };
    this._saveSavedAccounts(accounts);
  },

  removeSavedAccount(accountId) {
    this._saveSavedAccounts(this.getSavedAccounts().filter(a => a.id !== accountId));
  },

  /** Bascule vers un compte déjà enregistré (voir SAVED_ACCOUNTS_KEY) sans redemander de mot de
   * passe : réutilise son refresh_token stocké pour réactiver sa session Supabase, puis rehydrate
   * l'entreprise correspondante. Si le jeton s'avère périmé (session révoquée, mot de passe changé
   * depuis...), le compte est retiré de la liste plutôt que de rester bloqué en échec silencieux.
   *
   * LIMITE CONNUE : un seul client Supabase pour toute la page, donc UN SEUL onglet à la fois peut
   * avoir tel ou tel compte "actif" — Supabase synchronise sa session entre onglets du même
   * navigateur (stockage partagé), donc basculer ICI bascule aussi tout autre onglet déjà ouvert
   * sur ce site. Sans conséquence pour un usage à un seul onglet (le cas normal), mais un onglet
   * resté ouvert sur une autre entreprise se retrouverait basculé silencieusement en arrière-plan.
   * Isoler vraiment chaque onglet demanderait un client Supabase par onglet — hors scope ici. */
  async switchToSavedAccount(accountId) {
    const target = this.getSavedAccounts().find(a => a.id === accountId);
    if (!target) return { success: false, error: 'Compte introuvable.' };
    const switchResult = await window.SupabaseSync.switchToSession(target.session);
    if (!switchResult.success) {
      this.removeSavedAccount(accountId);
      return { success: false, error: 'Cette session a expiré. Reconnectez ce compte avec son mot de passe.' };
    }
    const company = await hydrateCurrentCompanyWithMigrations();
    if (!company) {
      this.removeSavedAccount(accountId);
      return { success: false, error: 'Aucun salarié associé à ce compte.' };
    }
    this._currentEmployeeId = company._currentEmployeeId;
    this._companiesCache = [company];
    this._currentAuthUserId = accountId;
    localStorage.setItem(CURRENT_COMPANY_KEY, company.id);
    const employee = this.getEmployeeById(this._currentEmployeeId);
    this.logAudit('Connexion', 'Session', `${employee.prenom} ${employee.nom} (${ROLE_LABELS[employee.role] || employee.role})`);
    return { success: true, employee };
  },

  /** Vide le cache de l'entreprise, en mémoire ET sur disque (correctif de la revue du 23/08/2026).
   * Sans la partie disque, tout le jeu de données (salariés, salaires, congés, journal d'audit)
   * restait lisible dans le localStorage après une déconnexion, sur un poste RH souvent partagé.
   * Rien n'est perdu : hydrateCurrentCompany() reconstruit le cache à la connexion suivante.
   *
   * À appeler sur TOUS les chemins de déconnexion, pas seulement le bouton "Se déconnecter" : une
   * connexion refusée (aucune fiche salarié, abonnement suspendu ou résilié) laissait sinon en
   * place le cache du salarié précédent sur cette machine, alors même qu'on vient de refuser
   * l'accès. */
  _purgeLocalCompanyCache() {
    this._currentEmployeeId = null;
    this._companiesCache = null;
    this._currentAuthUserId = null;
    localStorage.removeItem(ROOT_KEY);
    localStorage.removeItem(CURRENT_COMPANY_KEY);
  },

  /** Déconnexion "façon Gmail" (choix explicite du 21/08/2026) : ne révoque QUE le compte actif,
   * puis bascule automatiquement sur un autre compte déjà enregistré s'il en reste un — jamais de
   * déconnexion globale surprise pour les autres comptes gardés en parallèle. */
  async logoutCurrentAccount() {
    const user = this.getCurrentUser();
    if (user) this.logAudit('Déconnexion', 'Session', `${user.prenom} ${user.nom}`);
    const leavingAccountId = this._currentAuthUserId;
    await window.SupabaseSync.signOut();
    if (leavingAccountId) this.removeSavedAccount(leavingAccountId);
    this._purgeLocalCompanyCache();

    const remaining = this.getSavedAccounts();
    if (remaining.length > 0) {
      const switchResult = await this.switchToSavedAccount(remaining[0].id);
      if (switchResult.success) return { success: true, switchedTo: switchResult.employee };
    }
    return { success: true, switchedTo: null };
  },

  /** Point d'entrée asynchrone (le seul de toute l'authentification) : connexion Supabase Auth +
   * rapatriement complet de l'entreprise dans le cache mémoire. Une fois résolu, TOUT le reste de
   * l'app (getCurrentUser, getEmployees, etc.) reste synchrone comme avant — voir le plan de
   * migration (stratégie "cache local optimiste"). */
  async login(email, password) {
    const authResult = await window.SupabaseSync.signIn(email, password);
    if (!authResult.success) {
      return { success: false, error: 'Email ou mot de passe incorrect.' };
    }
    const company = await hydrateCurrentCompanyWithMigrations();
    if (!company) {
      await window.SupabaseSync.signOut();
      this._purgeLocalCompanyCache();
      return { success: false, error: 'Aucun salarié associé à ce compte.' };
    }
    const statutAbonnement = company.abonnement && company.abonnement.statut;
    if (statutAbonnement === 'suspendu' || statutAbonnement === 'resilie') {
      await window.SupabaseSync.signOut();
      this._purgeLocalCompanyCache();
      return {
        success: false,
        error: statutAbonnement === 'resilie'
          ? 'Cet abonnement a été résilié. Contactez BERTOLIS pour plus d\'informations.'
          : 'Cet abonnement est actuellement suspendu. Contactez BERTOLIS pour plus d\'informations.'
      };
    }

    this._currentEmployeeId = company._currentEmployeeId;
    this._companiesCache = [company];
    this._upsertSavedAccount(authResult.session, this.getEmployeeById(company._currentEmployeeId), company);
    localStorage.setItem(CURRENT_COMPANY_KEY, company.id);
    const employee = this.getEmployeeById(this._currentEmployeeId);
    this.logAudit('Connexion', 'Session', `${employee.prenom} ${employee.nom} (${ROLE_LABELS[employee.role] || employee.role})`);
    return { success: true, employee };
  },

  /** "Créer mon entreprise" (migration 0012) : crée un vrai compte marqué intent=creer_entreprise
   * (le trigger serveur ne tente alors aucun rattachement par domaine), puis, si une session est
   * déjà disponible (confirmation email désactivée sur ce projet), enchaîne directement sur la
   * création de l'entreprise. Sinon, la création est reportée à la prochaine restoreSession, une
   * fois l'email confirmé (voir _finalizeCompanySelfServiceCreation). */
  async signUpNewCompany(raisonSociale, email, password, nom, prenom) {
    if (!password || password.length < 6) {
      return { success: false, error: 'Le mot de passe doit contenir au moins 6 caractères.' };
    }
    if (!raisonSociale || !nom || !prenom) {
      return { success: false, error: 'Raison sociale, nom et prénom sont obligatoires.' };
    }
    const authResult = await window.SupabaseSync.signUpNewCompany(email, password, raisonSociale, nom, prenom);
    if (!authResult.success) {
      return { success: false, error: authResult.error };
    }
    if (authResult.emailAlreadyRegistered) {
      return { success: false, error: 'Un compte existe déjà pour cette adresse email. Connectez-vous, ou utilisez "Mot de passe oublié ?" si besoin.' };
    }
    if (authResult.needsEmailConfirmation) {
      return { success: true, needsEmailConfirmation: true };
    }
    return await this._finalizeCompanySelfServiceCreation();
  },

  /** Appelle la RPC create_company_self_service puis rapatrie l'entreprise créée. Rejouable sans
   * risque depuis restoreSession : si la fiche salarié existe déjà (création réussie lors d'un
   * appel précédent, seule l'hydratation avait échoué), la RPC renvoie une erreur "déjà associé"
   * qu'on traite ici comme un simple signal pour passer directement à l'hydratation plutôt qu'une
   * vraie erreur — dans ce cas, les données par défaut ne sont PAS re-semées (déjà faites). */
  async _finalizeCompanySelfServiceCreation() {
    const rpcResult = await window.SupabaseSync.createCompanySelfService();
    if (!rpcResult.success && !/déjà associé/i.test(rpcResult.error || '')) {
      return { success: false, error: rpcResult.error };
    }
    const company = await hydrateCurrentCompanyWithMigrations();
    if (!company) {
      return { success: false, error: 'Compte créé, mais la création de l\'entreprise a échoué. Reconnectez-vous pour réessayer.' };
    }
    this._currentEmployeeId = company._currentEmployeeId;
    this._companiesCache = [company];
    localStorage.setItem(CURRENT_COMPANY_KEY, company.id);
    const employee = this.getEmployeeById(this._currentEmployeeId);
    const session = await window.SupabaseSync.getSession();
    this._upsertSavedAccount(session, employee, company);
    if (rpcResult.success) {
      // §correctif audit du 23/08/2026 (2.2) : les 12 types par défaut doivent partir en UN SEUL
      // saveLeaveTypes(), pas 12 appels addLeaveType() séparés. addLeaveType() déclenche à chaque
      // fois un envoi en arrière-plan (_pushInBackground, jamais attendu) qui repousse TOUTE la
      // liste vers Supabase (syncTable = upsert + suppression de ce qui n'y figure pas) — 12 envois
      // partaient donc en parallèle avec des photos de longueurs différentes, et c'est la DERNIÈRE
      // suppression arrivée côté serveur qui décidait de ce qui survivait. Résultat aléatoire,
      // observé en pratique : une seule entreprise test s'est retrouvée avec "Congés payés" seul.
      const leaveTypes = seedLeaveTypes().map((lt, index) => Object.assign(makeEmptyLeaveType(), lt, { id: generateId('lt'), ordre: index }));
      this.saveLeaveTypes(leaveTypes);
      this.logAudit('Création', 'Types de congé', `${leaveTypes.length} types créés (jeu par défaut)`);
      this.saveSchoolHolidays(seedSchoolHolidays());
    }
    this.logAudit('Création', 'Entreprise', `${employee.prenom} ${employee.nom} · ${company.raisonSociale || ''}`);
    return { success: true, employee };
  },

  /** Renvoie l'email de confirmation (écran "vérifiez votre boîte mail", après signUp/signUpNewCompany)
   * — utile quand le premier email n'arrive jamais (spam, adresse mal tapée puis corrigée...), sans
   * avoir à recommencer toute l'inscription avec une autre adresse. */
  async resendSignupConfirmation(email) {
    return window.SupabaseSync.resendSignupConfirmation(email);
  },

  /** Restaure la session au chargement de la page si un jeton Supabase valide existe encore
   * (persisté par le client Supabase lui-même dans son propre coin de localStorage) — évite de
   * forcer une reconnexion à chaque rafraîchissement de page. Retourne true si une session a bien
   * été restaurée (auquel cas l'appelant peut passer directement à showApp()). */
  async restoreSession() {
    const session = await window.SupabaseSync.getSession();
    if (!session) return false;
    const company = await hydrateCurrentCompanyWithMigrations();
    if (company) {
      this._currentEmployeeId = company._currentEmployeeId;
      this._companiesCache = [company];
      this._currentAuthUserId = session.user.id;
      localStorage.setItem(CURRENT_COMPANY_KEY, company.id);
      this._upsertSavedAccount(session, this.getEmployeeById(company._currentEmployeeId), company);
      return true;
    }
    // Aucune fiche salarié trouvée : si ce compte vient d'un signUpNewCompany dont la création
    // d'entreprise avait échoué (ex. coupure réseau juste après confirmation d'email), on retente
    // ici — sans risque, voir _finalizeCompanySelfServiceCreation.
    const intent = session.user && session.user.user_metadata && session.user.user_metadata.intent;
    if (intent === 'creer_entreprise') {
      const result = await this._finalizeCompanySelfServiceCreation();
      return result.success;
    }
    // Session authentifiée sans fiche salarié correspondante — le cas le plus probable est une
    // connexion Google/Microsoft (§ intégrations SSO) avec une adresse qui ne correspond à aucun
    // salarié de l'entreprise. Jamais laisser une session à moitié valide traîner en silence
    // (l'utilisateur atterrirait muettement sur la page d'accueil publique, sans comprendre
    // pourquoi) : on déconnecte et on renseigne un message qu'app.js affichera à la place.
    await window.SupabaseSync.signOut();
    this._purgeLocalCompanyCache();
    this._lastAuthError = 'Aucun salarié associé à ce compte. Contactez votre RH pour obtenir un accès.';
    return false;
  },

  /** Lu puis effacé une seule fois — évite qu'un message d'erreur d'authentification périmé
   * réapparaisse après un rechargement de page qui n'a plus rien à voir. */
  getLastAuthError() {
    const msg = this._lastAuthError;
    this._lastAuthError = null;
    return msg;
  },

  async loginWithOAuth(provider) {
    return window.SupabaseSync.signInWithOAuth(provider);
  },

  /** Vérifie l'ancien mot de passe en retentant une connexion (l'API Supabase Auth n'expose pas de
   * simple "vérifier le mot de passe actuel" sans redemander une authentification complète). */
  async changePassword(employeeId, currentPassword, newPassword) {
    if (!newPassword || newPassword.length < 6) {
      return { success: false, error: 'Le nouveau mot de passe doit contenir au moins 6 caractères.' };
    }
    const employee = this.getEmployeeById(employeeId);
    const verify = await window.SupabaseSync.signIn(employee.email, currentPassword);
    if (!verify.success) return { success: false, error: 'Mot de passe actuel incorrect.' };
    const { error } = await window.SupabaseSync.updatePassword(newPassword);
    if (error) return { success: false, error: error.message };
    this.logAudit('Modification', 'Mot de passe', `${employee.prenom} ${employee.nom}`);
    return { success: true };
  },

  /** Envoie un vrai email de réinitialisation via Supabase Auth (fini le token affiché directement
   * à l'écran de la simulation précédente — l'utilisateur doit maintenant cliquer le lien reçu par
   * email, qui ramène sur cette même page en mode "récupération", voir bindGlobalEvents/app.js). */
  async requestPasswordReset(email) {
    const { error } = await window.SupabaseSync.sendPasswordResetEmail(email);
    if (error) return { success: false, error: error.message };
    return { success: true };
  },

  /** N'est valide que si l'utilisateur est arrivé via le lien de récupération envoyé par email
   * (Supabase crée alors une session temporaire "recovery" détectée par onAuthStateChange). */
  async resetPasswordWithToken(_token, newPassword) {
    if (!newPassword || newPassword.length < 6) {
      return { success: false, error: 'Le nouveau mot de passe doit contenir au moins 6 caractères.' };
    }
    const { error } = await window.SupabaseSync.updatePassword(newPassword);
    if (error) return { success: false, error: 'Lien de réinitialisation invalide ou expiré.' };
    return { success: true };
  },

  /** Après une première connexion avec un mot de passe temporaire (créé par un Propriétaire/RH via
   * creerCompteConnexion, ou réinitialisé via forcerNouveauMotDePasse) — pas besoin de l'ancien mot
   * de passe, la session en cours suffit (même principe que resetPasswordWithToken ci-dessus). Lève
   * ensuite le drapeau data.mustChangePassword (écriture normale, autorisée sur sa propre fiche). */
  async changerMotDePassePremiereConnexion(newPassword) {
    if (!newPassword || newPassword.length < 6) {
      return { success: false, error: 'Le nouveau mot de passe doit contenir au moins 6 caractères.' };
    }
    const { error } = await window.SupabaseSync.updatePassword(newPassword);
    if (error) return { success: false, error: error.message };
    const employee = this.getCurrentUser();
    this.updateEmployee(employee.id, { mustChangePassword: false });
    this.logAudit('Modification', 'Mot de passe', `${employee.prenom} ${employee.nom} (première connexion)`);
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
  ajusterVariables: (employeeId, year, month, montant, motif) => DB.ajusterVariablesPaie(employeeId, year, month, montant, motif),
  ajusterHeuresSup: (employeeId, year, month, heures, motif) => DB.ajusterHeuresSupplementaires(employeeId, year, month, heures, motif),
  ajusterReposCompensateurPris: (employeeId, year, month, heures, motif) => DB.ajusterReposCompensateurPris(employeeId, year, month, heures, motif),
  majCoordonnees: (employeeId, data) => DB.majPropresCoordonnees(employeeId, data),
  deverrouillerCompte: (employeeId) => DB.deverrouillerCompte(employeeId),
  forcerMotDePasse: (employeeId, newPassword) => DB.forcerNouveauMotDePasse(employeeId, newPassword),
  creerCompteConnexion: (employeeId) => DB.creerCompteConnexion(employeeId),
  changerRole: (employeeId, newRole, actingUserId) => DB.changerRoleSalarie(employeeId, newRole, actingUserId),
  transferProprietaire: (newProprietaireId, nouveauRoleAncien) => DB.transferProprietaire(newProprietaireId, nouveauRoleAncien),
  getIcalToken: (scope) => DB.getIcalToken(scope),
  regenerateIcalToken: (scope) => DB.regenerateIcalToken(scope)
};

const leaveRepository = {
  getAll: () => DB.getLeaveRequests(),
  getById: (id) => DB.getLeaveRequestById(id),
  getForEmployee: (employeeId) => DB.getLeaveRequestsForEmployee(employeeId),
  create: (data) => DB.addLeaveRequest(data),
  update: (id, patch) => DB.updateLeaveRequest(id, patch),
  prolonger: (id, nouvelleDateFin, justificatif) => DB.prolongerArretMaladie(id, nouvelleDateFin, justificatif),
  regulariser: (id, patch) => DB.regulariserDemande(id, patch),
  applyFermetureDecompte: (fermeture) => applyFermetureDecompte(fermeture)
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

const draftRepository = {
  getById: (id) => DB.getBrouillonById(id),
  getForOwner: (ownerId, type) => DB.getBrouillonsForOwner(ownerId, type),
  create: (data) => DB.addBrouillon(data),
  delete: (id) => DB.deleteBrouillon(id)
};

const documentRepository = {
  getAll: () => DB.getDocuments(),
  getById: (id) => DB.getDocumentById(id),
  getForEmployee: (employeeId) => DB.getDocumentsForEmployee(employeeId),
  create: (data) => DB.addDocument(data),
  update: (id, patch) => DB.updateDocument(id, patch),
  delete: (id) => DB.deleteDocument(id)
};

const supportTicketRepository = {
  getAll: () => DB.getSupportTickets(),
  getById: (id) => DB.getTicketById(id),
  getMine: (employeeId) => DB.getMySupportTickets(employeeId),
  getVisibleTo: (employee) => DB.getSupportTicketsVisibleTo(employee),
  create: (data) => DB.addSupportTicket(data),
  updateStatus: (id, statut) => DB.updateSupportTicketStatus(id, statut),
  addComment: (id, texte) => DB.addTicketComment(id, texte)
};

const entretienRepository = {
  getAll: () => DB.getEntretiens(),
  getById: (id) => DB.getEntretienById(id),
  getForEmployee: (employeeId) => DB.getEntretiensForEmployee(employeeId),
  getVisibleTo: (employee) => DB.getEntretiensVisibleTo(employee),
  create: (data) => DB.addEntretien(data),
  submitAutoEvaluation: (id, texte) => DB.updateEntretienAutoEvaluation(id, texte),
  submitRetourManager: (id, texte) => DB.updateEntretienRetourManager(id, texte),
  cloturer: (id) => DB.clotureEntretien(id)
};

const ideeRepository = {
  getAll: () => DB.getIdees(),
  getById: (id) => DB.getIdeeById(id),
  create: (data) => DB.addIdee(data),
  toggleVote: (id) => DB.toggleIdeeVote(id),
  setStatut: (id, statut) => DB.setIdeeStatut(id, statut)
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
  /** Affiché en haut de la page publique de candidature (Embauche) en plus du nom — voir
   * get_company_public_info. Upload direct (pas de cache local optimiste, comme les autres
   * uploads de fichiers de l'app) : la vraie URL publique ne peut venir que du serveur. */
  async uploadLogo(file) {
    const url = await window.SupabaseSync.uploadCompanyLogo(DB.getCurrentCompanyId(), file);
    DB.saveCompanyProfile({ logo: url });
    return url;
  }
};

const authRepository = {
  getCurrentUser: () => DB.getCurrentUser(),
  isLoggedIn: () => DB.isLoggedIn(),
  login: (email, password) => DB.login(email, password),
  loginWithOAuth: (provider) => DB.loginWithOAuth(provider),
  signUpNewCompany: (raisonSociale, email, password, nom, prenom) => DB.signUpNewCompany(raisonSociale, email, password, nom, prenom),
  resendSignupConfirmation: (email) => DB.resendSignupConfirmation(email),
  logout: () => DB.logoutCurrentAccount(),
  changePassword: (employeeId, currentPassword, newPassword) => DB.changePassword(employeeId, currentPassword, newPassword),
  requestPasswordReset: (email) => DB.requestPasswordReset(email),
  resetPasswordWithToken: (token, newPassword) => DB.resetPasswordWithToken(token, newPassword),
  changerMotDePassePremiereConnexion: (newPassword) => DB.changerMotDePassePremiereConnexion(newPassword),
  getSavedAccounts: () => DB.getSavedAccounts(),
  getCurrentAccountId: () => DB._currentAuthUserId,
  switchAccount: (accountId) => DB.switchToSavedAccount(accountId),
  removeSavedAccount: (accountId) => DB.removeSavedAccount(accountId)
};

const settingsRepository = {
  getSettings: () => DB.getSettings(),
  saveSettings: (settings) => DB.saveSettings(settings),
  enregistrerIndexEgalite: (year, note, datePublication, mesuresCorrectives) => DB.enregistrerIndexEgalite(year, note, datePublication, mesuresCorrectives)
};

/** Contrairement à settingsRepository, ne vit pas dans le cache local optimiste (company.settings) :
 * le webhook Slack est un secret protégé par RLS (0022_integrations.sql), jamais rapatrié à
 * l'hydratation pour un salarié sans gererParametres — ces deux appels vont donc lire/écrire
 * directement Supabase, pas de lecture locale "instantanée" possible ici (léger flash de chargement
 * assumé sur l'onglet Paramètres → Intégrations, seul endroit qui les appelle). */
const integrationsRepository = {
  get: () => window.SupabaseSync.getCompanyIntegrations(DB.getCurrentCompany().id),
  save: (patch) => window.SupabaseSync.saveCompanyIntegrations(DB.getCurrentCompany().id, patch)
};

/** Candidatures reçues via le QR code "Embauche" (voir renderEmbauche, app.js). Comme
 * integrationsRepository : jamais dans le cache local optimiste (company.*) — de nouvelles
 * candidatures peuvent arriver n'importe quand depuis le formulaire public, sans qu'aucun signal
 * temps réel ne prévienne l'onglet ouvert ; toujours une lecture fraîche à l'ouverture de l'écran. */
const candidatureRepository = {
  getAll: () => window.SupabaseSync.getCandidatures(DB.getCurrentCompany().id),
  marquerEmbauchee: (id, employeeId) => window.SupabaseSync.setCandidatureStatut(id, 'embauchee', employeeId),
  archiver: (id) => window.SupabaseSync.setCandidatureStatut(id, 'archivee', null),
  getFileUrl: (path) => window.SupabaseSync.getCandidatureFileUrl(path),
  /** "Pas intéressé" (demande du 17/08/2026) : envoie le message par email au candidat PUIS
   * archive — jamais un archivage silencieux (voir candidature-reject, Edge Function/Resend). */
  reject: (id, message) => window.SupabaseSync.rejectCandidature(id, message)
};

const categorieSalarieRepository = {
  getAll: () => DB.getCategoriesSalarie(),
  getById: (id) => DB.getCategoriesSalarie().find(c => c.id === id) || null,
  create: (data) => DB.addCategorieSalarie(data),
  update: (id, patch) => DB.updateCategorieSalarie(id, patch),
  delete: (id) => DB.deleteCategorieSalarie(id)
};

const leaveTypeRepository = {
  getLeaveTypes: () => DB.getLeaveTypes(),
  getLeaveTypeById: (id) => DB.getLeaveTypeById(id),
  addLeaveType: (data) => DB.addLeaveType(data),
  updateLeaveType: (id, patch) => DB.updateLeaveType(id, patch),
  duplicateLeaveType: (id) => DB.duplicateLeaveType(id),
  deleteLeaveType: (id) => DB.deleteLeaveType(id),
  reorderLeaveType: (id, direction) => DB.reorderLeaveType(id, direction)
};

/** Paiement Stripe réel (voir supabase/functions/billing) — chaque appel passe par le jeton de
 * connexion en cours, vérifié côté serveur (permission gererAbonnements) avant toute action.
 * returnBase (origin + chemin du dossier courant) permet à la fonction serveur de renvoyer vers
 * la bonne page même quand le site est servi depuis un sous-dossier (ex. GitHub Pages :
 * https://<compte>.github.io/SevenRH/), où se fier au seul en-tête "origin" échouerait. */
function currentReturnBase() {
  return window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
}

const billingRepository = {
  // modules : [{ key, declarants? }] — voir LANDING_ALACARTE_MODULES/renderParametresAbonnement
  // (app.js). declarants ne compte que pour le module "frais" (unité déclarant, pas salarié).
  checkout: (modules, periodicite) => window.SupabaseSync.invokeBilling('checkout', { modules, periodicite, returnBase: currentReturnBase() }),
  // Ajoute/retire des modules ou change leur quantité (déclarants) sur un abonnement à la carte
  // déjà actif — même forme de payload que checkout, mais modifie l'abonnement Stripe existant
  // (proration) au lieu d'en créer un nouveau. Jamais utilisé pour tout annuler (garder au moins un
  // module reste obligatoire côté serveur) — l'annulation complète reste réservée au portail Stripe.
  updateModules: (modules, periodicite) => window.SupabaseSync.invokeBilling('update-modules', { modules, periodicite }),
  // declarantOverrides : { [moduleKey]: nombre } — ne concerne que les modules en unité déclarant ;
  // les modules en unité salarié se réalignent automatiquement sur l'effectif réel côté serveur.
  resync: (declarantOverrides) => window.SupabaseSync.invokeBilling('resync', { declarants: declarantOverrides || {} }),
  portal: () => window.SupabaseSync.invokeBilling('portal', { returnBase: currentReturnBase() }),
  confirm: (sessionId) => window.SupabaseSync.invokeBilling('confirm', { sessionId })
};

const notificationRepository = {
  getNotifications: () => DB.getNotifications(),
  saveNotifications: (list) => DB.saveNotifications(list),
  addNotificationsIfNew: (candidates) => DB.addNotificationsIfNew(candidates),
  markNotificationRead: (id, read) => DB.markNotificationRead(id, read),
  markAllNotificationsRead: () => DB.markAllNotificationsRead(),
  setNotificationArchived: (id, archived) => DB.setNotificationArchived(id, archived),
  pruneResolvedRequestNotifications: (pendingIds) => DB.pruneResolvedRequestNotifications(pendingIds)
};

const favoriteRepository = {
  getFavoriteEmployeeIds: () => DB.getFavoriteEmployeeIds(),
  isFavoriteEmployee: (id) => DB.isFavoriteEmployee(id),
  toggleFavoriteEmployee: (id) => DB.toggleFavoriteEmployee(id)
};

const schoolHolidayRepository = {
  getSchoolHolidays: () => DB.getSchoolHolidays(),
  saveSchoolHolidays: (data) => DB.saveSchoolHolidays(data)
};

const auditLogRepository = {
  getAuditLog: () => DB.getAuditLog(),
  logAudit: (action, entite, cible, details) => DB.logAudit(action, entite, cible, details),
  clearAuditLog: () => DB.clearAuditLog()
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
    statutPro: 'Non cadre', // conservé pour compatibilité (affichage/exports existants) — voir categorieSalarieId
    categorieSalarieId: null, // §10 sprint amélioration — voir getEffectiveCategorieSalarieId()

    typeContrat: 'CDI',
    dateFinContrat: '',
    dateFinPeriodeEssai: '',
    dateDernierEntretienProfessionnel: '',
    dateDerniereVisiteMedicale: '', // suivi médecine du travail — voir getUpcomingVisitesMedicales
    // Checklists d'intégration/de départ (demande du 18/08/2026) : [{ label, fait, dateFait }] —
    // copie du modèle de Paramètres au démarrage, jamais une référence live à ce modèle (voir
    // ensureOnboardingChecklist/startOffboardingChecklist, app.js). onboardingChecklist démarre dès
    // la création du salarié ; offboardingChecklist reste vide (absent des exports/impressions) tant
    // qu'il n'est pas explicitement déclenché depuis la fiche salarié.
    onboardingChecklist: [],
    offboardingChecklist: [],
    // Historique des avenants (demande du 18/08/2026) : [{ id, date, type, description, dateEnregistrement }]
    // — trace manuelle ("un avenant a été signé, voici ce qu'il change"), pas une détection
    // automatique des modifications de champs (aurait exigé d'intercepter chaque chemin d'édition
    // de la fiche pour un signal beaucoup plus bruyant que ce qui compte réellement : les avenants
    // formels, pas chaque correction de coquille). Voir openAjouterAvenantModal (app.js).
    avenants: [],
    // §correctif audit du 23/08/2026 (§7.21) : périodes d'astreinte — [{ id, dateDebut, dateFin,
    // indemniteMontant, commentaire, interventions: [{id, date, heureDebut, heureFin, description}],
    // dateCreation }]. Même patron que avenants ci-dessus (champ sur l'employé, pas une table à part)
    // plutôt qu'une nouvelle table Supabase : employees_update (0002_rls_policies.sql) laisse déjà un
    // salarié modifier SA PROPRE ligne, ce qui suffit pour qu'il déclare lui-même une intervention sur
    // SA propre astreinte sans nouvelle policy à écrire. Voir openAjouterAstreinteModal (app.js).
    astreintes: [],

    tempsTravail: 'Temps plein',
    pourcentageActivite: 100,
    horairesHebdo: 35,
    forfait: 'Aucun',
    regimeRTT: '',
    joursTravailles: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'],
    // Sprint SIRH premium §3 : horaires matin/après-midi, identiques chaque jour travaillé pour
    // l'instant (pas de variante par jour de la semaine — cf. renderPlanningHoraires).
    horaireMatinDebut: '09:00',
    horaireMatinFin: '12:00',
    horaireApresMidiDebut: '13:00',
    horaireApresMidiFin: '17:00',

    statut: 'Actif',
    dateDepart: '',
    archive: false,

    // Champs sensibles, réservés au Propriétaire, affichés uniquement si le réglage correspondant est activé
    salaireBrutMensuel: 0,
    genre: '',

    compteurs: {},
    ticketsAjustements: {}, // § CORRIGER_TICKETS_RESTAURANT : { 'AAAA-MM': delta } — voir calculateTicketsRestaurant()
    variablesPaie: {}, // Sprint SIRH premium §6 : { 'AAAA-MM': montant } — éléments variables de paie (primes...), saisie manuelle par mois, voir DB.ajusterVariablesPaie()
    heuresSupplementaires: {}, // { 'AAAA-MM': heures } — heures supplémentaires du mois, saisie manuelle (voir DB.ajusterHeuresSupplementaires) ; le cumul sur l'année civile est comparé à settings.contingentAnnuelHeuresSup, voir getHeuresSupAnnee (app.js)
    // §retour QA du 26/08/2026 (point 7.21) : { 'AAAA-MM': heures } — heures de repos compensateur
    // PRISES ce mois-ci (saisie manuelle, même principe que heuresSupplementaires ci-dessus, aucun
    // module de pointage ne les détecte automatiquement). Le solde disponible se calcule en
    // combinant ce champ avec heuresSupplementaires × settings.tauxReposCompensateur, voir
    // getReposCompensateurSolde (app.js) — jamais stocké comme un solde à part, pour ne jamais
    // diverger silencieusement de son propre calcul si le taux de conversion change en cours de route.
    reposCompensateurPris: {},
    typesAbsenceDesactives: [], // Sprint SIRH premium SS1 : ids de types actifs/visibles au niveau entreprise
                                 // mais explicitement désactivés pour CE salarié (liste blanche par défaut : vide = tout ce que l'entreprise autorise)
    menusDesactives: [], // §retour du 21/08/2026 "pouvoir enlever l'accès à tous les menus" : clés NAV_ITEMS
                          // (app.js) explicitement retirées de la navigation de CE salarié, en plus de ce que
                          // son rôle/ses permissions/les modules souscrits par l'entreprise autoriseraient déjà
                          // normalement (liste blanche par défaut : vide = tout ce que son rôle autorise) —
                          // voir baseNavItemsForRole/navItemsForRole/renderMenusAutorisesCard (app.js)
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

/** Catégorie de salarié (cadre/non-cadre, ou toute autre catégorisation RH propre à l'entreprise) —
 * §10 sprint amélioration : remplace le simple statutPro (texte libre, jamais lu par aucune règle)
 * par une vraie petite entité référençable par id, pour que les règles d'éligibilité de congé
 * (§3), les jours fériés/fermetures par catégorie (§8/§9) puissent s'y accrocher de façon stable
 * (insensible à un renommage, contrairement à un rapprochement par texte). Vit dans
 * settings.categoriesSalarie (voir migrateCategoriesSalarieFromStatutPro ci-dessous) — pas de
 * nouvelle table Supabase, synchronisée avec le reste des réglages (pushSettings). */
function makeEmptyCategorieSalarie() {
  return { id: null, nom: '', description: '', ordre: 0 };
}

/** Migration de compatibilité — appelée depuis settingsRepository.getSettings() (donc pour TOUTE
 * entreprise, qu'elle vienne du cache local de démo ou de Supabase, contrairement aux migrateXxx(company)
 * historiques ci-dessous qui ne s'appliquent qu'au chemin de démo locale via DB.init()). Ne mute et
 * ne persiste rien : calcule à la volée, à chaque lecture, les catégories à partir des valeurs
 * distinctes de statutPro déjà utilisées par les salariés de l'entreprise — préserve exactement ce
 * que l'entreprise avait déjà personnalisé, plutôt que d'imposer un "Cadre/Non cadre" générique.
 * Idempotent et sans effet dès que settings.categoriesSalarie existe réellement (tableau non vide). */
function deriveCategoriesSalarieFromStatutPro(employees) {
  const noms = [...new Set((employees || []).map(e => (e.statutPro || '').trim()).filter(Boolean))];
  if (!noms.length) noms.push('Cadre', 'Non cadre'); // aucun salarié encore créé : valeurs de départ raisonnables, pas figées.
  return noms.map((nom, i) => ({ id: generateId('cat'), nom, description: '', ordre: i }));
}

/** categorieSalarieId n'est jamais rétro-écrit sur les fiches salarié existantes (éviterait une
 * réécriture en masse de potentiellement centaines de fiches) — calculé à la volée à partir de
 * l'ancien statutPro (dont le nom correspond exactement à une catégorie migrée, voir ci-dessus) tant
 * qu'une vraie sélection n'a pas été faite dans le nouveau champ du formulaire salarié. */
function getEffectiveCategorieSalarieId(employee, categoriesSalarie) {
  if (employee.categorieSalarieId) return employee.categorieSalarieId;
  const match = (categoriesSalarie || []).find(c => c.nom === (employee.statutPro || '').trim());
  return match ? match.id : null;
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
  const start = parseISODateLocal(dateEmbauche);
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
  const birth = parseISODateLocal(dateNaissance);
  const now = new Date();
  if (Number.isNaN(birth.getTime())) return null;
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age;
}

/** §correctif date/fuseau (bug sweep du 19/08/2026) : appelée à la fois avec des dates pures
 * ("2026-08-19", ex. date de naissance/embauche — aucune notion d'heure, ne doit JAMAIS être
 * réinterprétée en UTC sous peine de décalage d'un jour dans les fuseaux derrière UTC comme les
 * DOM-TOM) et avec des horodatages complets (ex. dateCreation d'un ticket/document, qui EUX
 * doivent bien s'afficher dans le jour calendaire local du fuseau du lecteur). Distingue les deux
 * plutôt que de traiter systématiquement l'argument comme un horodatage UTC. */
function formatDate(isoDate) {
  if (!isoDate) return '—';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(isoDate) ? parseISODateLocal(isoDate) : new Date(isoDate);
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

/** Palette d'avatars façon Slack/Trello (§passe couleur "premium ++, pas que les boutons" du
 * 21/08/2026) — une couleur stable par personne (hachage simple du nom complet, jamais aléatoire :
 * la même personne garde toujours la même couleur d'un rendu à l'autre) plutôt qu'un avatar marine
 * unique partout, pour que les listes de salariés/l'organigramme/les notifications donnent une vraie
 * impression de variété plutôt qu'une app en deux tons. Voir .avatar-color-0..6 (style.css) pour les
 * paires fond/texte, tenues à l'écart des teintes déjà prises par le sens fonctionnel (succès/alerte/
 * danger/info/marine/or). */
const AVATAR_COLOR_COUNT = 7;
function getAvatarColorClass(prenom, nom) {
  const name = `${prenom || ''}${nom || ''}`;
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return `avatar-color-${hash % AVATAR_COLOR_COUNT}`;
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
    // Chaîne de validation ordonnée, ex. ['manager','rh'] ou ['rh'] ou ['manager','proprietaire'] ou [] (aucune validation).
    // Paramétrable par type de congé ; DEFAULT_SETTINGS.workflowCongesDefault sert de modèle pour un nouveau type.
    workflow: ['manager'],
    // §retour QA du 26/08/2026 (point 6.7) : par étape (clé = index dans `workflow`, en texte —
    // ex. "0", "1"), une liste de salariés désignés nommément qui REMPLACE la résolution par rôle
    // pour cette étape précise (ex. "Manager" en théorie, mais en pratique toujours untel et untel).
    // {} = comportement historique, résolution par rôle sur toutes les étapes. Une étape non
    // présente ici (ou avec un tableau vide) reste résolue par rôle. Voir resolveWorkflowWithFallback
    // et isCurrentWorkflowStepFor (app.js) : lisible par tout salarié de l'entreprise sans risque —
    // ce n'est qu'une liste d'ids déjà choisis par un RH/Propriétaire, jamais une question
    // d'énumération d'employés filtrée par rôle comme l'était l'ancien hasEligibleValidatorForStep.
    workflowValidatorOverrides: {},
    saisiParSalarie: true, // §15 : "saisi par le salarié" vs "saisi uniquement par les RH" (ex. arrêts maladie, §24)
    visibleSalarie: true,
    visibleRH: true,
    autoriserDemiJournee: true,
    autoriserPlusieursDemandes: true,
    deduireCompteur: true,
    // deduireRTT/deduireCP : anciens champs (§14), conservés en lecture pour compatibilité (voir
    // getLeaveBalance) mais plus jamais écrits depuis le formulaire — remplacés par
    // compteurPartageAvecId (référence stable par id, voir §3 sprint amélioration).
    deduireRTT: false,
    deduireCP: false,
    compteurPartageAvecId: null,
    // Règles d'éligibilité (§3 sprint amélioration) — tableau vide = ouvert à tous les salariés
    // (comportement d'avant ce champ, inchangé). Voir RULE_CRITERIA/isLeaveTypeEligibleForEmployee.
    regles: [],
    // Clôture de compteur + report (§5 sprint amélioration) — dateClotureCompteur au format 'MM-JJ'
    // (ex. '05-31'), null = une seule période continue depuis l'embauche (comportement actuel).
    dateClotureCompteur: null,
    reportCompteur: 'aucun', // 'aucun' | 'limite' | 'illimite'
    reportLimiteJours: null,
    // §correctif audit du 23/08/2026 (§7.15) : même format MM-JJ que dateClotureCompteur — date
    // limite, DANS la nouvelle période, avant laquelle le report doit être consommé. null = pas
    // d'échéance (comportement actuel, le report reste disponible toute la période). Voir la
    // section "report" de getLeaveBalance (data.js) pour le calcul de la part perdue.
    dateLimiteReportMMJJ: null,
    // §correctif audit du 23/08/2026 (§7.8) : délai de prévenance — nombre minimum de jours entre
    // la saisie et la date de départ. null/0 = pas de délai (comportement actuel). 'alerte' informe
    // sans empêcher l'envoi, 'blocage' empêche la soumission (voir submitLeaveRequestForm, app.js).
    delaiPrevenanceJours: null,
    delaiPrevenanceMode: 'alerte', // 'alerte' | 'blocage'
    // §correctif audit du 23/08/2026 (§7.9) : 'ouvres' (défaut, comportement historique — le rythme
    // réel du salarié) ou 'ouvrables' (tous les jours sauf dimanche, notion légale utilisée pour
    // les congés payés — 30 jours ouvrables = 25 jours ouvrés). Voir computeWorkingDays (data.js).
    uniteDecompte: 'ouvres', // 'ouvres' | 'ouvrables'
    // §correctif audit du 23/08/2026 (§7.18) : paliers d'ancienneté dans UN SEUL type plutôt que 4
    // types distincts avec 4 règles d'éligibilité (lourd à paramétrer, illisible pour le salarié —
    // 4 lignes de compteur pour une seule réalité). [] = pas de palier, nombreAnnuel s'applique tel
    // quel (comportement actuel). Non vide : le palier le plus haut ATTEINT REMPLACE nombreAnnuel
    // (ce n'est pas cumulatif — "+2 jours à 10 ans" veut dire 2 jours au total, pas 1+2). Voir
    // resolveAncienneteAcquisAnnuel plus bas.
    paliersAnciennete: [], // [{ ancienneteMin: 5, jours: 1 }, ...] triés croissants par ancienneteMin
    // §correctif audit du 23/08/2026 (§7.17) : jours de fractionnement — règle supplétive française
    // (L3141-23) : +1 jour si 3 à 5 jours du congé principal sont pris hors du 1er mai-31 octobre,
    // +2 jours si 6 ou plus. Beaucoup d'accords l'écartent — interrupteur explicite, faux par défaut.
    // N'a d'effet que si dateClotureCompteur est renseigné (voir la section "report" de
    // getLeaveBalance, data.js, où le calcul est fait — même dépendance que le report lui-même).
    fractionnementActif: false,
    exportPaie: true,
    // §correctif retour QA du 27/08/2026 (point 2.4, confirmé par l'expert-comptable de l'entreprise) :
    // 'proportionnelle' (défaut, comportement historique) réduit l'acquisition au pourcentage
    // d'activité — correct pour un type sans réponse explicite, mais confirmé À TORT pour les congés
    // payés : la loi acquiert les CP en jours par mois travaillé, sans proratisation selon la durée
    // du travail (seul le décompte à la consommation doit refléter le temps partiel, jamais
    // l'acquisition). 'aucune' (CP) : acquisition toujours pleine, quel que soit le temps de travail.
    // 'exclu' (RTT) : nulle pour tout salarié à moins de 100 % — un temps partiel ne dépasse jamais
    // 35h/semaine par définition, donc n'a droit à aucun RTT (pas juste "moins"). Voir
    // resolveProratisationTempsPartiel (identifie CP/RTT par nom, comme deduireRTT/deduireCP déjà
    // existants) et calculateAcquisition.
    proratisationTempsPartiel: 'proportionnelle',
    // §correctif retour QA du 27/08/2026 (point 7.16, confirmé par l'expert-comptable : "ça dépend
    // des congés, il faut pouvoir le changer") : jusqu'ici l'acquisition ne dépendait QUE du temps
    // écoulé depuis l'embauche — un salarié en congé sabbatique ou en congé parental de 6 mois
    // continuait d'acquérir des CP comme s'il travaillait. Coché sur CE type d'ABSENCE (ex. "Sans
    // solde"), une demande validée de ce type suspend l'acquisition de TOUS les compteurs pendant sa
    // durée (voir calculateAcquisition/joursSuspendusAcquisition) — jamais coché par défaut,
    // volontairement : contrairement à proratisationTempsPartiel ci-dessus, l'expert-comptable n'a
    // PAS donné de liste "ceci suspend, cela non" (maternité = travail effectif, sabbatique = non,
    // mais rien de plus précis) — deviner un défaut par type serait aussi risqué que ce qu'on corrige.
    // Coché à la main, type par type, par l'entreprise.
    suspendAcquisitionAutresCompteurs: false
  };
}

/** Catalogue extensible des critères d'éligibilité disponibles pour un type de congé (§3 sprint
 * amélioration) — même esprit que PERMISSIONS/IMPORT_EMPLOYEE_FIELD_ALIASES : un seul endroit à
 * étendre pour ajouter un nouveau critère, sans toucher au moteur d'évaluation lui-même. */
const RULE_CRITERIA = {
  anciennete: { label: 'Ancienneté (années)', valueType: 'number', operators: ['>=', '<='] },
  categorieSalarieId: { label: 'Catégorie de salarié', valueType: 'categorieSalarie', operators: ['in'] },
  etablissementId: { label: 'Établissement', valueType: 'etablissement', operators: ['in'] },
  typeContrat: { label: 'Type de contrat', valueType: 'typeContrat', operators: ['in'] }
};

/** Un type sans règle reste ouvert à tous (comportement d'avant l'existence de ce champ). Toutes
 * les règles d'un type doivent être vraies (ET logique) pour que l'employé y soit éligible. */
function isLeaveTypeEligibleForEmployee(employee, leaveType, categoriesSalarie) {
  const regles = leaveType.regles || [];
  if (!regles.length) return true;
  return regles.every(regle => {
    switch (regle.critere) {
      case 'anciennete': {
        if (!employee.dateEmbauche) return false;
        const years = (new Date() - new Date(employee.dateEmbauche)) / (365.25 * 86400000);
        return regle.operateur === '>=' ? years >= Number(regle.valeur) : years <= Number(regle.valeur);
      }
      case 'categorieSalarieId':
        return (regle.valeur || []).includes(getEffectiveCategorieSalarieId(employee, categoriesSalarie));
      case 'etablissementId':
        return (regle.valeur || []).includes(employee.etablissementId);
      case 'typeContrat':
        return (regle.valeur || []).includes(employee.typeContrat);
      default:
        return true;
    }
  });
}

/** Structure complète d'une demande de congé. */
function makeEmptyLeaveRequest() {
  return {
    id: null,
    employeeId: null,
    typeId: null,
    dateDebut: '',
    dateFin: '',
    demiJournee: null, // null | 'matin' | 'apres-midi' — seulement si dateDebut === dateFin
    // §correctif audit du 23/08/2026 (§7.12) : demi-journée sur une période de plusieurs jours
    // (voir computeWorkingDays) — jamais renseignés en même temps que demiJournee ci-dessus.
    demiJourneeDebut: null, // null | 'apres-midi'
    demiJourneeFin: null, // null | 'matin'
    nbJours: 0,
    commentaire: '',
    justificatif: null, // { nom, dataUrl } | null
    statut: 'En attente', // 'En attente' | 'Validé' | 'Refusé' | 'Annulé'
    workflow: [], // copie de la chaîne du type au moment de la demande (les changements ultérieurs du type ne l'affectent pas)
    // §retour QA du 26/08/2026 (point 6.7) : copie de leaveType.workflowValidatorOverrides, réindexée
    // sur CE workflow (voir resolveWorkflowWithFallback) — même logique de snapshot que `workflow`
    // ci-dessus, pour la même raison (un changement ultérieur du type ne doit jamais affecter une
    // demande déjà créée).
    workflowValidatorOverrides: {},
    etapeIndex: -1, // index dans workflow ; -1 = terminé
    historique: [],
    // §correctif audit du 23/08/2026 (§7.5) : non-null seulement pour une demande générée
    // automatiquement par une fermeture d'entreprise imposée (voir applyFermetureDecompte) — permet
    // de la retrouver/l'annuler si la fermeture est ensuite modifiée ou supprimée, sans jamais
    // confondre une fermeture avec un congé posé normalement par le salarié.
    fermetureId: null,
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

/** Ticket support envoyé à BERTOLIS (Phase 2 sprint amélioration RH, §16-17) — voir
 * supabase/migrations/0017_support_tickets.sql. Les commentaires ne se manipulent JAMAIS en lisant
 * puis réécrivant ce tableau directement (risque de perte de message si salarié et BERTOLIS
 * répondent presque en même temps) : toujours passer par DB.addTicketComment(), qui appelle la
 * fonction SQL atomique append_ticket_comment(). */
function makeEmptyTicket() {
  return {
    id: null,
    employeeId: null,
    route: '',
    contexte: {}, // vue courante + éventuel identifiant déjà en state au moment de la création
    titre: '',
    description: '',
    categorie: '',
    priorite: 'normale', // 'basse' | 'normale' | 'haute'
    statut: 'ouvert', // 'ouvert' | 'en_cours' | 'resolu' | 'livre' | 'ferme'
    pieceJointe: null, // { nom, dataUrl } | null
    comments: [], // [{ auteur, texte, date }]
    historique: [], // [{ date, action, auteur }] — un changement de statut par entrée
    dateLivraison: null, // renseignée automatiquement quand statut passe à 'livre'
    aiAnalysis: null, // { categorieSuggeree, prioriteSuggeree, resume, pointsCles } | null — suggestion IA, jamais appliquée automatiquement
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
    if (!isJourTravaillePourSalarie(dateStr, employee, settings)) continue;

    // Une demi-journée (matin OU après-midi, sur une date isolée) ne prive pas du ticket restaurant
    // du jour — seule une absence sur la journée entière compte comme "non travaillé" ici.
    const onLeave = employeeLeaves.some(r =>
      dateStr >= r.dateDebut && dateStr <= r.dateFin && !(r.demiJournee && r.dateDebut === r.dateFin));
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
 * de rôles (ex. ['manager','rh'], ['rh'], ['manager','proprietaire'], ou [] pour une validation
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

/** §correctif régression du 26/08/2026 (retour QA, point 1) — remplace l'ancienne version de
 * resolveWorkflowWithFallback, qui décidait "existe-t-il un validateur pour cette étape" à partir
 * de DB.getEmployees(), c'est-à-dire le CACHE LOCAL de l'auteur de la demande. Ce cache est
 * lui-même filtré par la policy employees_select (0002_rls_policies.sql) : un salarié n'y voit que
 * sa propre fiche, un manager que son équipe — RH et Propriétaire n'y apparaissent JAMAIS pour ces
 * deux rôles. Conséquence réelle : pour toute demande créée par un salarié ou un manager, la
 * chaîne de validation était vidée (aucun validateur "visible"), le repli sur RH puis Propriétaire
 * échouait pour la même raison, et computeInitialWorkflowStatus(workflow) || 'Validé' (ou même
 * 'Remboursé' pour les notes de frais) auto-validait la demande sans qu'aucun validateur ne soit
 * jamais informé.
 *
 * Cette question ne peut être répondue de façon fiable QUE côté serveur (0037_workflow_resolution_
 * serveur.sql, security definer, visibilité complète et indépendante de l'appelant). Si l'appel
 * échoue ou est indisponible (hors ligne, mode démo sans Supabase), on NE retombe JAMAIS sur un
 * circuit vide : on conserve le circuit d'ORIGINE tel que configuré sur le type, sans le réduire.
 * Une demande qui reste "En attente" à tort est un désagrément ; une demande auto-validée à tort
 * est une faute. */
/** §retour QA du 26/08/2026 (point 6.7) : `overrides` (optionnel — objet {stepIndex: [employeeId]},
 * voir leaveType.workflowValidatorOverrides) désigne des valideurs nommés qui REMPLACENT la
 * résolution par rôle pour l'étape concernée. Une étape avec un valideur nommé est TOUJOURS
 * conservée (jamais envoyée au serveur pour la question "existe-t-il quelqu'un ?" — la réponse est
 * déjà écrite, littéralement, par un RH/Propriétaire sur le type) ; seules les étapes SANS valideur
 * nommé passent par la résolution serveur habituelle, inchangée. Les positions nominatives sont
 * réinsérées à leur place d'origine après la réponse serveur, avec leur propre index recalculé
 * (`overrides` en retour) — nécessaire car une étape par rôle intercalée peut être retirée par le
 * serveur, ce qui décale les index des étapes nominatives suivantes. */
async function resolveWorkflowWithFallback(employeeId, rawWorkflow, domain, overrides) {
  const workflow = rawWorkflow || [];
  if (!workflow.length) return { workflow: [], overrides: {}, escalated: false };
  const ov = overrides || {};
  const isOverridden = (i) => Array.isArray(ov[String(i)]) && ov[String(i)].length > 0;

  if (workflow.every((_, i) => isOverridden(i))) return { workflow, overrides: ov, escalated: false };

  const roleBasedRoles = workflow.filter((_, i) => !isOverridden(i));
  try {
    const result = await window.SupabaseSync.resolveWorkflowWithFallback(employeeId, roleBasedRoles, domain);
    if (!result.success) throw new Error(result.error || 'Réponse serveur invalide.');
    const serverKept = result.workflow || [];
    let serverIdx = 0;
    const merged = [];
    const mergedOverrides = {};
    workflow.forEach((role, i) => {
      if (isOverridden(i)) { mergedOverrides[String(merged.length)] = ov[String(i)]; merged.push(role); return; }
      if (serverIdx < serverKept.length && serverKept[serverIdx] === role) { merged.push(role); serverIdx++; }
      // sinon : étape retirée par le serveur (aucun valideur par rôle pour celle-ci), ignorée.
    });
    // Ce qui reste dans serverKept au-delà de serverIdx est l'ajout d'escalade du serveur (rh/
    // proprietaire, jamais dans roleBasedRoles) — pertinent seulement si aucune étape nominative n'a
    // déjà sauvé la chaîne (sinon la chaîne n'est pas réellement "vide", pas besoin d'escalader).
    if (merged.length === 0 && serverIdx < serverKept.length) merged.push(...serverKept.slice(serverIdx));
    return { workflow: merged, overrides: mergedOverrides, escalated: JSON.stringify(merged) !== JSON.stringify(workflow) };
  } catch (err) {
    console.error('resolveWorkflowWithFallback : résolution serveur indisponible, conservation du circuit d\'origine.', err);
    return { workflow, overrides: ov, escalated: false };
  }
}

/** Même correctif que resolveWorkflowWithFallback ci-dessus, pour le ciblage des emails de
 * notification (§7.4) plutôt que pour le calcul du circuit lui-même — resolve_validator_employee_
 * ids_for_step (0037) tourne côté serveur avec une visibilité complète. Si l'appel échoue, on ne
 * notifie personne plutôt que de deviner : mieux vaut une notification manquante (visible dans le
 * "Centre d'action" du validateur de toute façon) qu'une notification envoyée au hasard. */
/** §retour QA du 26/08/2026 (point 6.7) : `overrideIds`, si présent et non vide, désigne les
 * valideurs nommés de cette étape (voir request.workflowValidatorOverrides) — renvoyé directement,
 * sans appel serveur : c'est une liste déjà choisie par un RH/Propriétaire, jamais une énumération
 * d'employés à calculer, donc aucun des risques qui imposaient de déplacer §1 côté serveur. */
async function resolveValidatorEmployeeIdsForStep(employeeId, role, overrideIds) {
  if (Array.isArray(overrideIds) && overrideIds.length > 0) return overrideIds;
  try {
    const result = await window.SupabaseSync.resolveValidatorEmployeeIdsForStep(employeeId, role);
    if (!result.success) throw new Error(result.error || 'Réponse serveur invalide.');
    return result.ids;
  } catch (err) {
    console.error('resolveValidatorEmployeeIdsForStep : résolution serveur indisponible.', err);
    return [];
  }
}

/** §correctif retour QA du 27/08/2026 (bug matricules dupliqués) : contrairement à
 * resolveWorkflowWithFallback/resolveValidatorEmployeeIdsForStep ci-dessus, qui se replient TOUJOURS
 * sur un comportement dégradé plutôt que de bloquer l'utilisateur, l'attribution du matricule NE PEUT
 * PAS se replier sur un calcul local — c'est précisément l'ancien calcul local (company.matriculeSeq,
 * jamais persisté par saveEmployees) qui produisait des doublons à chaque nouvelle session, un
 * salarié sur deux sessions/appareils différents pouvant recevoir le même numéro. Le numéro doit venir
 * du compteur atomique serveur (assign_matricule_number, 0040_matricule_atomique.sql) — sinon la
 * création du salarié échoue avec un message clair (voir addEmployee, et submitEmployeeForm/
 * importEmployeesRows côté app.js qui affichent l'erreur) plutôt que de risquer un doublon silencieux.
 */
async function assignMatricule(companyId, hireDateISO) {
  const year = (hireDateISO && /^\d{4}/.test(hireDateISO)) ? parseInt(hireDateISO.slice(0, 4), 10) : new Date().getFullYear();
  const result = await window.SupabaseSync.assignMatriculeNumber(companyId, year);
  if (!result.success) throw new Error(result.error || 'Impossible d\'attribuer un matricule : connexion au serveur requise. Réessayez.');
  return formatMatricule(year, result.number);
}

// Format AAAA-NNNN (année sur 4 chiffres, jamais 2 : une PME peut avoir des salariés embauchés avant
// 2000, une ambiguïté qu'un format sur 2 chiffres réintroduirait pour rien). Le séparateur reste
// configurable (settings.matriculeAvecTiret) — la numérotation/l'unicité, garanties côté serveur, ne
// dépendent jamais de ce choix purement cosmétique.
function formatMatricule(year, seq) {
  const num = String(seq).padStart(4, '0');
  const settings = DB.getSettings();
  return (settings && settings.matriculeAvecTiret === false) ? `${year}${num}` : `${year}-${num}`;
}

/** §correctif audit du 23/08/2026 (§7.4) : notifie par email les validateurs de la PREMIÈRE étape
 * d'une demande qui vient d'être créée — factorisé ici, appelé depuis addLeaveRequest/
 * addTeleworkRequest/addExpense, plutôt que de tripler la même logique. Fire-and-forget comme
 * notifySlack juste au-dessus de chaque appelant : un échec email ne doit jamais remonter à
 * l'auteur de la demande, déjà bien créée à ce stade — d'où le .catch() silencieux malgré l'await.
 *
 * §correctif retour QA du 26/08/2026 (point 5.2) : ne résout plus les destinataires ici — la
 * fonction Edge notify-request-email relit désormais la VRAIE demande (requestId + domain) et en
 * dérive elle-même destinataires et contenu, jamais fait confiance à ce que le client fournirait. */
async function notifyValidatorsByEmailForNewRequest(requestId, domain) {
  try {
    await window.SupabaseSync.notifyRequestEmail(requestId, domain, 'a_valider');
  } catch (err) {
    // volontairement silencieux, voir commentaire ci-dessus.
  }
}

/** Fait avancer une demande d'une étape ; `finalStatut` est le statut de fin de circuit propre au module. */
/** §correctif QA du 26/08/2026 : `roleActuel` doit décrire qui a RÉELLEMENT validé, pas le rôle
 * SCHEDULED pour cette étape — un RH/Propriétaire peut valider en bypass (canActOnRequestFor,
 * app.js) sans que ce soit son tour dans le workflow, ce qui écrivait jusqu'ici "Validé par
 * Manager" alors que Manager n'avait jamais agi. `acteurRoleLabel` (le rôle de l'utilisateur
 * courant, fourni par l'appelant) prime donc sur le rôle programmé de l'étape ; à défaut, on
 * retombe sur l'ancien comportement (rôle programmé) pour ne pas casser un appel qui l'omettrait. */
function advanceWorkflow(request, finalStatut, acteurRoleLabel) {
  const historique = (request.historique || []).slice();
  const now = new Date().toISOString();
  const workflow = request.workflow || [];
  const nextIndex = request.etapeIndex + 1;
  const roleActuel = acteurRoleLabel || ROLE_LABELS[workflow[request.etapeIndex]] || workflow[request.etapeIndex];

  if (nextIndex < workflow.length) {
    const roleSuivant = ROLE_LABELS[workflow[nextIndex]] || workflow[nextIndex];
    historique.push({ date: now, action: `Validé par ${roleActuel}, en attente de ${roleSuivant}` });
    return { statut: 'En attente', etapeIndex: nextIndex, historique };
  }

  // §11 : le sprint liste explicitement "Validation manager" PUIS "Validation RH" comme étapes
  // distinctes de la timeline — l'étape finale doit donc nommer le rôle qui l'a validée, pas
  // seulement le statut générique ("Validé"/"Remboursé"), sinon on ne distingue plus qui a fait
  // cette dernière validation dans l'historique.
  historique.push({ date: now, action: roleActuel ? `${finalStatut} (par ${roleActuel})` : finalStatut });
  return { statut: finalStatut, etapeIndex: -1, historique };
}

/** Refus/annulation génériques, communs aux congés et au télétravail (même forme de demande). */
/** §correctif audit du 23/08/2026 (§7.7) : un refus était jusqu'ici muet — le salarié voyait sa
 * demande refusée sans explication, et rien n'en gardait la trace. motif est désormais obligatoire
 * côté UI (openRefuseModal, app.js) ; stocké deux fois par commodité — motifRefus pour l'affichage
 * direct au salarié, et dans historique pour rester cohérent avec les autres actions déjà tracées là. */
function refuseRequest(request, motif) {
  const historique = (request.historique || []).slice();
  historique.push({ date: new Date().toISOString(), action: 'Refusé', motif });
  return { statut: 'Refusé', motifRefus: motif, historique };
}

function cancelRequest(request) {
  const historique = (request.historique || []).slice();
  historique.push({ date: new Date().toISOString(), action: 'Annulé' });
  return { statut: 'Annulé', historique };
}

/** Nombre de jours décomptés pour une période, selon les jours travaillés du salarié — ET les
 * jours fériés/fermetures (settings), via isJourTravaillePourSalarie (data.js:3145), déjà
 * construite pour les tickets restaurant : un jour férié ou une fermeture ne doit pas être
 * décompté comme un jour d'absence, exactement comme il n'aurait pas été travaillé de toute façon.
 *
 * §correctif audit du 23/08/2026 (§7.9) : `unite` ('ouvres' par défaut, comportement inchangé pour
 * tout appelant qui ne le précise pas) — le Code du travail exprime les congés payés en jours
 * OUVRABLES (tous les jours sauf le dimanche, une notion calendaire), alors que la plupart des
 * conventions comptent en jours OUVRÉS (le rythme RÉEL du salarié, employee.joursTravailles). Seul
 * un congé (leaveType.uniteDecompte) peut valoir 'ouvrables' — télétravail/notes de frais restent
 * toujours en jours ouvrés, cette distinction n'a de sens légal que pour les congés.
 *
 * §correctif audit du 23/08/2026 (§7.12) : `demiJourneeDebut`('apres-midi'|falsy) et
 * `demiJourneeFin` ('matin'|falsy) — permettent une demi-journée sur une période de PLUSIEURS
 * jours (ex. vendredi après-midi au mercredi matin), là où `demiJournee` seul n'agit que si
 * dateDebut === dateFin. Ignorés si la période est mono-jour (demiJournee ci-dessus s'applique
 * alors seul) — les deux mécanismes ne se cumulent jamais sur le même jour. */
function computeWorkingDays(dateDebut, dateFin, demiJournee, employee, settings, unite = 'ouvres', demiJourneeDebut, demiJourneeFin) {
  if (!dateDebut || !dateFin) return 0;
  const start = parseISODateLocal(dateDebut);
  const end = parseISODateLocal(dateFin);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;

  const joursTravailles = employee && employee.joursTravailles;
  const workedDays = unite === 'ouvrables'
    ? ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']
    : (joursTravailles && joursTravailles.length ? joursTravailles : ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven']);
  const dayLabels = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

  let count = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    const dateStr = toISODate(cursor);
    if (workedDays.includes(dayLabels[cursor.getDay()]) && isJourTravaillePourSalarie(dateStr, employee, settings)) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }

  if (demiJournee && start.getTime() === end.getTime() && count === 1) {
    count = 0.5;
  } else if (start.getTime() !== end.getTime()) {
    // Ne retranche que si ce jour précis a effectivement été compté ci-dessus (jour travaillé, ni
    // férié ni fermeture) — sinon une demi-journée demandée un jour déjà non compté retrancherait
    // 0,5 en trop.
    const startCounted = workedDays.includes(dayLabels[start.getDay()]) && isJourTravaillePourSalarie(dateDebut, employee, settings);
    const endCounted = workedDays.includes(dayLabels[end.getDay()]) && isJourTravaillePourSalarie(dateFin, employee, settings);
    if (demiJourneeDebut === 'apres-midi' && startCounted) count -= 0.5;
    if (demiJourneeFin === 'matin' && endCounted) count -= 0.5;
  }
  return Math.max(0, count);
}

/**
 * Nombre de jours d'une demande (congé ou télétravail) qui tombent dans un mois donné,
 * en découpant la période aux bornes du mois. Réutilise computeWorkingDays plutôt que
 * de dupliquer la boucle de comptage — utilisé par l'export paie.
 */
function countRequestDaysInMonth(dateDebut, dateFin, demiJournee, year, month, employee, settings, unite = 'ouvres') {
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  const start = parseISODateLocal(dateDebut);
  const end = parseISODateLocal(dateFin);
  const clippedStart = start < monthStart ? monthStart : start;
  const clippedEnd = end > monthEnd ? monthEnd : end;
  if (clippedStart > clippedEnd) return 0;

  const fullyWithinMonth = start >= monthStart && end <= monthEnd;
  return computeWorkingDays(toISODate(clippedStart), toISODate(clippedEnd), fullyWithinMonth && demiJournee, employee, settings, unite);
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
/** §correctif bug sweep 19/08/2026 : getCompteurPeriodBounds/calculateAcquisition reçoivent
 * `refDate` sous 3 formes différentes selon l'appelant (undefined, un objet Date déjà construit,
 * ou une chaîne "YYYY-MM-DD" — ex. `monthEnd` passé depuis getPaieAnomalies) — `new Date(refDate)`
 * traitait une chaîne comme un horodatage UTC, décalant d'un jour dans les fuseaux derrière UTC et
 * faussant l'acquisition mensuelle calculée pour la Préparation de paie. */
function toRefDate(refDate) {
  if (!refDate) return new Date();
  if (refDate instanceof Date) return refDate;
  return parseISODateLocal(refDate);
}

/** Bornes [periodStart, periodEnd] de la période de compteur EN COURS pour une date de clôture
 * 'MM-JJ' donnée (ex. '05-31'), à un instant refDate — §5 sprint amélioration. Si refDate tombe
 * avant la clôture de cette année, on est encore dans la période ouverte l'année précédente. */
function getCompteurPeriodBounds(dateClotureMMJJ, refDate) {
  const [month, day] = dateClotureMMJJ.split('-').map(Number);
  const now = toRefDate(refDate);
  const clotureThisYear = new Date(now.getFullYear(), month - 1, day);
  if (now <= clotureThisYear) {
    return { periodStart: new Date(now.getFullYear() - 1, month - 1, day + 1), periodEnd: clotureThisYear };
  }
  return { periodStart: new Date(now.getFullYear(), month - 1, day + 1), periodEnd: new Date(now.getFullYear() + 1, month - 1, day) };
}

/** Ancienneté en années (nombres décimaux) à une date de référence — même convention que le
 * critère d'éligibilité 'anciennete' (isLeaveTypeEligibleForEmployee), pour rester cohérent : une
 * ancienneté qui rend éligible à un type doit être calculée de la même façon que celle qui
 * détermine SON palier. */
function calculateAncienneteYears(employee, refDate) {
  if (!employee.dateEmbauche) return 0;
  const now = toRefDate(refDate);
  return Math.max(0, (now - parseISODateLocal(employee.dateEmbauche)) / (365.25 * 86400000));
}

/** §7.18 : nombreAnnuel effectif, remplacé par le palier d'ancienneté le plus haut ATTEINT si le
 * type en définit (voir makeEmptyLeaveType) — sinon nombreAnnuel s'applique tel quel. */
function resolveAncienneteAcquisAnnuel(leaveType, employee, refDate) {
  const paliers = leaveType.paliersAnciennete || [];
  if (!paliers.length) return Number(leaveType.nombreAnnuel) || 0;
  const years = calculateAncienneteYears(employee, refDate);
  const atteints = paliers.filter(p => years >= Number(p.ancienneteMin)).sort((a, b) => b.ancienneteMin - a.ancienneteMin);
  return atteints.length ? Number(atteints[0].jours) || 0 : 0;
}

/** §correctif retour QA du 27/08/2026 (point 7.16) : nombre de jours calendaires, dans
 * [periodStart, periodEnd], couverts par une demande VALIDÉE d'un type marqué
 * suspendAcquisitionAutresCompteurs (voir makeEmptyLeaveType) — jamais calculé si allRequests/
 * allLeaveTypes ne sont pas fournis (0, comportement strictement inchangé), voir calculateAcquisition. */
function countSuspendedAcquisitionDays(employee, periodStart, periodEnd, allRequests, allLeaveTypes) {
  if (!allRequests || !allLeaveTypes) return 0;
  const suspendingTypeIds = new Set(allLeaveTypes.filter(t => t.suspendAcquisitionAutresCompteurs).map(t => t.id));
  if (!suspendingTypeIds.size) return 0;
  let days = 0;
  allRequests.forEach(r => {
    if (r.employeeId !== employee.id || r.statut !== 'Validé' || !suspendingTypeIds.has(r.typeId)) return;
    if (!r.dateDebut || !r.dateFin) return;
    const reqStart = parseISODateLocal(r.dateDebut);
    const reqEnd = parseISODateLocal(r.dateFin);
    const clippedStart = reqStart < periodStart ? periodStart : reqStart;
    const clippedEnd = reqEnd > periodEnd ? periodEnd : reqEnd;
    if (clippedStart > clippedEnd) return;
    days += daysBetween(clippedStart, clippedEnd) + 1;
  });
  return days;
}

/** §correctif retour QA du 27/08/2026 (trouvé en corrigeant le point 1) : nombre de mois CALENDAIRES
 * ENTIÈREMENT écoulés entre periodStart et periodEnd inclus — l'ancien calcul (simple différence
 * d'index de mois, -1 si le quantième de fin est inférieur à celui de début) sous-comptait TOUJOURS
 * d'un mois une période pile de 12 mois calendaires (ex. 1er juin au 31 mai) : 30 jours de CP
 * devenaient 27,5. Un mois ne compte comme entièrement écoulé que lorsque periodEnd atteint la
 * veille de l'anniversaire mensuel suivant (ex. 1er juin + 1 mois - 1 jour = 30 juin : juin compte
 * dès le 30 juin, pas seulement à partir du 1er juillet) — addMonths gère déjà le débordement de fin
 * de mois (ex. 31 janvier + 1 mois = 28/29 février), donc cette définition reste correcte même pour
 * une clôture configurée un jour qui n'existe pas dans tous les mois. Auto-corrective par petites
 * boucles (l'estimation de départ n'est jamais fausse de plus d'un mois) plutôt qu'une formule
 * fermée plus difficile à vérifier à l'œil. */
function countFullMonthsElapsed(periodStart, periodEnd) {
  let months = (periodEnd.getFullYear() - periodStart.getFullYear()) * 12 + (periodEnd.getMonth() - periodStart.getMonth());
  while (months > 0 && addDays(addMonths(periodStart, months), -1) > periodEnd) months -= 1;
  while (addDays(addMonths(periodStart, months + 1), -1) <= periodEnd) months += 1;
  return Math.max(0, months);
}

/** periodOverride ({periodStart, periodEnd}) : borne le calcul à une période de clôture personnalisée
 * (§5) au lieu de l'année civile par défaut — utilisé uniquement quand leaveType.dateClotureCompteur
 * est renseigné (voir getLeaveBalance), sinon comportement strictement inchangé.
 * allRequests/allLeaveTypes (§7.16, optionnels) : permettent de suspendre l'acquisition pendant une
 * absence validée d'un type marqué suspendAcquisitionAutresCompteurs — omis, le calcul reste
 * strictement celui d'avant ce correctif (voir countSuspendedAcquisitionDays). */
function calculateAcquisition(employee, leaveType, refDate, periodOverride, allRequests, allLeaveTypes) {
  if (!leaveType || leaveType.illimite || leaveType.acquisition === 'Illimitée') return Infinity;

  const now = toRefDate(refDate);
  const yearStart = periodOverride ? periodOverride.periodStart : new Date(now.getFullYear(), 0, 1);
  const yearEnd = periodOverride ? periodOverride.periodEnd : new Date(now.getFullYear(), 11, 31);
  const hireDate = employee.dateEmbauche ? parseISODateLocal(employee.dateEmbauche) : yearStart;
  const periodStart = hireDate > yearStart ? hireDate : yearStart;
  const departDate = employee.dateDepart ? parseISODateLocal(employee.dateDepart) : null;
  // Clamp à yearEnd : sans periodOverride, `now` tombe toujours dans [yearStart,yearEnd] par
  // construction (même année civile) — ce clamp ne change donc rien au comportement par défaut,
  // il ne devient utile qu'avec un periodOverride dont la borne de fin dépasse "aujourd'hui"
  // (ex. clôture au 31 mai alors qu'on est en janvier : la période en cours court jusqu'en mai
  // prochain, mais on ne peut évidemment pas compter des jours pas encore vécus).
  const periodEnd = departDate && departDate < now ? departDate : (now < yearEnd ? now : yearEnd);

  if (periodStart > periodEnd) return 0;

  // §correctif retour QA du 27/08/2026 (point 2.4, confirmé par l'expert-comptable) : la réduction
  // au pourcentage d'activité ne s'applique plus uniformément à tous les types — voir
  // resolveProratisationTempsPartiel et le commentaire de proratisationTempsPartiel (makeEmptyLeaveType).
  const rawActivityRatio = (Number(employee.pourcentageActivite) || 100) / 100;
  const proratisation = resolveProratisationTempsPartiel(leaveType);
  const activityRatio = proratisation === 'aucune' ? 1
    : proratisation === 'exclu' ? (rawActivityRatio >= 1 ? 1 : 0)
    : rawActivityRatio;
  const annualAmount = resolveAncienneteAcquisAnnuel(leaveType, employee, now);

  // §correctif retour QA du 27/08/2026 (point 7.16, confirmé par l'expert-comptable) : une absence
  // validée d'un type marqué suspendAcquisitionAutresCompteurs réduit le nombre de jours "travaillés"
  // du calcul, exactement comme le ferait un employeur qui ne compterait pas cette période comme du
  // temps de travail effectif — jamais d'effet si allRequests/allLeaveTypes ne sont pas fournis.
  const totalDaysInPeriod = daysBetween(periodStart, periodEnd) + 1;
  const joursSuspendus = countSuspendedAcquisitionDays(employee, periodStart, periodEnd, allRequests, allLeaveTypes);
  const suspensionRatio = totalDaysInPeriod > 0 ? Math.max(0, (totalDaysInPeriod - joursSuspendus) / totalDaysInPeriod) : 1;

  if (leaveType.acquisition === 'Mensuelle') {
    const monthsElapsed = countFullMonthsElapsed(periodStart, periodEnd);
    return round2(monthsElapsed * (annualAmount / 12) * activityRatio * suspensionRatio);
  }

  // Acquisition annuelle : prorata du nombre de jours travaillés sur l'année.
  const daysInYear = daysBetween(yearStart, yearEnd) + 1;
  const daysWorked = totalDaysInPeriod;
  const prorata = Math.min(Math.max(daysWorked / daysInYear, 0), 1);
  return round2(annualAmount * prorata * activityRatio * suspensionRatio);
}

/** Ids des types de congé/absence portant EXACTEMENT ce nom — utilisé partout où un calcul doit
 * s'ancrer sur un type "connu" (RTT/Congés payés/Maladie) plutôt que sur un id, qui varie d'une
 * entreprise à l'autre. Un seul endroit pour cet idiome, repris par calculateAbsenteeismRate,
 * getLeaveBalance et getPaieRows (app.js) — auparavant recopié séparément à chacun de ces 3 sites. */
/** Rapprochement tolérant par nom (insensible à la casse/aux espaces, accepte un suffixe du type
 * "RTT 2026") : un simple `===` cassait silencieusement dès qu'une entreprise renommait légèrement
 * son type (ex. "RTT" → "RTT 2026" lors d'un changement de millésime), faisant disparaître ces
 * jours de la préparation de paie sans aucune anomalie signalée. Reste une heuristique par nom, pas
 * un vrai identifiant stable — un renommage complet (ex. "RTT" → "Récupération") échapperait
 * toujours à ce rapprochement ; seul un champ dédié réglerait ça durablement. */
function leaveTypeNameMatches(nom, target) {
  const n = (nom || '').trim().toLowerCase();
  const t = target.trim().toLowerCase();
  return n === t || n.startsWith(t + ' ');
}

/** §correctif retour QA du 27/08/2026 (point 2.4) : leaveType.proratisationTempsPartiel n'existait
 * pas avant ce correctif — un type déjà en base (donc sans ce champ) retombe ici sur une inférence
 * par nom (même technique que deduireRTT/deduireCP au-dessus) plutôt qu'une migration d'écriture :
 * "Congés payés"/"RTT" retrouvent la règle confirmée par l'expert-comptable même sur une entreprise
 * dont les types n'ont jamais été resauvegardés depuis ce correctif ; tout AUTRE type (y compris un
 * type nommé "RTT" ou "Congés payés" par coïncidence après avoir explicitement choisi un autre
 * réglage) respecte la valeur explicitement enregistrée dès qu'elle existe. */
function resolveProratisationTempsPartiel(leaveType) {
  if (leaveType.proratisationTempsPartiel) return leaveType.proratisationTempsPartiel;
  if (leaveTypeNameMatches(leaveType.nom, 'Congés payés')) return 'aucune';
  if (leaveTypeNameMatches(leaveType.nom, 'RTT')) return 'exclu';
  return 'proportionnelle';
}

function getLeaveTypeIdsByName(leaveTypes, nom) {
  return leaveTypes.filter(t => leaveTypeNameMatches(t.nom, nom)).map(t => t.id);
}

/** Solde d'un salarié pour un type de congé : acquis, pris, en attente, disponible.
 * `employee.compteurs` (§ MODIFIER_COMPTEURS) porte un ajustement manuel optionnel par type de
 * congé (jours en plus ou en moins du calcul automatique — ex. reliquat repris d'un ancien SIRH,
 * correction d'erreur) : voir DB.ajusterCompteurConge(). Champ présent dans le schéma depuis le
 * début mais jamais lu avant ce câblage.
 *
 * Sprint SIRH premium §1 ("comptabilisé dans les congés") : `deduireRTT`/`deduireCP` existent sur
 * chaque type depuis le tout début (case à cocher "Déduire du compteur RTT/CP" déjà visible dans le
 * formulaire de type) mais n'étaient jamais lus nulle part — un type marqué ainsi (typiquement une
 * "autre absence" comme un congé sans solde ponctuel) vient maintenant EN PLUS s'imputer sur le
 * compteur RTT et/ou congés payés du salarié quand on calcule LE SOLDE DE CE COMPTEUR-LÀ. Identifié
 * par NOM de type ("RTT"/"Congés payés"), pas par id, pour rester robuste si l'entreprise recrée ses
 * types. Sans danger pour les entreprises existantes : ces cases étant restées sans effet jusqu'ici,
 * aucune n'a pu être cochée avec une attente réelle — tout type où elles restent décochées (le cas
 * par défaut) voit son calcul strictement inchangé.
 *
 * `allLeaveTypes` est optionnel : un appelant qui itère déjà sur DB.getLeaveTypes() (ex.
 * getPaieAnomalies, renderEmployeeBalances) doit le passer pour éviter de re-fetch/re-trier la
 * liste complète à CHAQUE appel — sinon on retombe sur DB.getLeaveTypes() comme avant. Doit rester
 * la liste COMPLÈTE (pas une liste déjà filtrée par actif/visibleSalarie) : un type "autre absence"
 * désactivé depuis doit quand même compter dans l'historique du solde.
 *
 * `refDate` est optionnel (défaut : aujourd'hui, comportement inchangé pour les écrans de solde
 * "en direct"). getPaieAnomalies doit impérativement passer la fin du mois qu'on prépare, sinon le
 * solde évalué est toujours celui d'AUJOURD'HUI — préparer la paie de mars en juillet vérifierait
 * alors le solde de juillet, pas celui de mars. */
function getLeaveBalance(employee, leaveType, allRequests, allLeaveTypes, refDate, categoriesSalarie) {
  const types = allLeaveTypes || DB.getLeaveTypes();

  // §3 sprint amélioration : un salarié inéligible (règles non satisfaites) n'a simplement rien
  // acquis sur ce type — pas d'erreur, pas de blocage ailleurs, juste un solde à 0/0/0.
  if (!isLeaveTypeEligibleForEmployee(employee, leaveType, categoriesSalarie || DB.getSettings().categoriesSalarie)) {
    return { acquis: 0, pris: 0, enAttente: 0, disponible: 0, ajustement: 0 };
  }

  const ajustement = (employee.compteurs && employee.compteurs[leaveType.id]) || 0;

  // Compteur partagé (§3) : tout type qui référence CELUI-CI par compteurPartageAvecId vient EN
  // PLUS s'imputer sur son solde — remplace l'ancien rapprochement par nom (deduireRTT/deduireCP),
  // gardé en lecture pour les types jamais migrés vers le nouveau champ (compatibilité, voir
  // makeEmptyLeaveType). Un type qui a lui-même déjà compteurPartageAvecId renseigné n'utilise plus
  // l'ancien mécanisme par nom, même si ses cases deduireRTT/deduireCP restent cochées en base.
  const typeIds = new Set([leaveType.id]);
  const typesPartageantVersMoi = types.filter(t => t.id !== leaveType.id && t.compteurPartageAvecId === leaveType.id);
  if (typesPartageantVersMoi.length) {
    typesPartageantVersMoi.forEach(t => typeIds.add(t.id));
  } else {
    const deducteurField = leaveTypeNameMatches(leaveType.nom, 'RTT') ? 'deduireRTT' : leaveTypeNameMatches(leaveType.nom, 'Congés payés') ? 'deduireCP' : null;
    if (deducteurField) {
      types.filter(t => t.id !== leaveType.id && !t.compteurPartageAvecId && t[deducteurField]).forEach(t => typeIds.add(t.id));
    }
  }

  // D17 (audit fiabilité du 19/08/2026) : une demande à cheval sur une clôture de compteur (ex. 28
  // mai → 4 juin, clôture au 31 mai) doit être répartie sur les deux périodes qu'elle traverse —
  // l'ancienne version classait la demande ENTIÈRE dans la période de sa date de début (isInPeriod
  // ne regardait que dateDebut) et créditait tout son nbJours là, faussant les deux soldes. Même
  // principe de découpe que countRequestDaysInMonth (déjà correct, utilisé par l'export paie).
  const overlapsPeriod = (r, start, end) => {
    if (!r.dateDebut || !r.dateFin) return false;
    if (start && r.dateFin < toISODate(start)) return false;
    if (end && r.dateDebut > toISODate(end)) return false;
    return true;
  };

  const settings = DB.getSettings();
  const daysInPeriod = (r, start, end) => {
    const reqStart = parseISODateLocal(r.dateDebut);
    const reqEnd = parseISODateLocal(r.dateFin);
    const fullyWithinPeriod = (!start || reqStart >= start) && (!end || reqEnd <= end);
    // Pas de découpe nécessaire : la valeur déjà calculée à la création de la demande reste la
    // bonne réponse, pas de recalcul qui pourrait dériver si les jours fériés/fermetures ont changé
    // depuis (et c'est le cas systématique quand start/end sont null : comportement strictement
    // inchangé pour une entreprise sans dateClotureCompteur).
    if (fullyWithinPeriod) return r.nbJours;
    const clippedStart = start && reqStart < start ? start : reqStart;
    const clippedEnd = end && reqEnd > end ? end : reqEnd;
    if (clippedStart > clippedEnd) return 0;
    // demiJournee non applicable ici : une demande à cheval sur une découpe est nécessairement
    // multi-jours (une demi-journée est toujours mono-jour, donc toujours "fullyWithinPeriod" si
    // elle chevauche du tout — voir ci-dessus).
    // §7.9 : le type réel de la demande r (pas forcément leaveType — cf. compteurPartageAvecId
    // ci-dessus, une demande d'un AUTRE type peut s'imputer sur ce compteur) fixe l'unité.
    const reqType = types.find(t => t.id === r.typeId) || leaveType;
    return computeWorkingDays(toISODate(clippedStart), toISODate(clippedEnd), false, employee, settings, reqType.uniteDecompte);
  };

  const requestsFor = (start, end) => allRequests.filter(r =>
    r.employeeId === employee.id && typeIds.has(r.typeId) && r.statut !== 'Refusé' && r.statut !== 'Annulé' && overlapsPeriod(r, start, end)
  );

  // §5 sprint amélioration : sans dateClotureCompteur, comportement strictement inchangé (une seule
  // période continue depuis l'embauche, comme avant ce champ).
  if (!leaveType.dateClotureCompteur) {
    const acquis = calculateAcquisition(employee, leaveType, refDate, undefined, allRequests, types);
    const requests = requestsFor(null, null);
    const pris = requests.filter(r => r.statut === 'Validé').reduce((sum, r) => sum + r.nbJours, 0);
    const enAttente = requests.filter(r => r.statut !== 'Validé').reduce((sum, r) => sum + r.nbJours, 0);
    const disponible = acquis === Infinity ? Infinity : round2(acquis - pris - enAttente + ajustement);
    return { acquis, pris, enAttente, disponible, ajustement };
  }

  // §correctif retour QA du 27/08/2026 (point 1, "les compteurs affichent 5 jours à quelqu'un qui en
  // a 30") : le droit du travail français distingue TOUJOURS deux compteurs vivants en même temps —
  // ce qui a été acquis sur la période CLOSE (immédiatement consommable) et ce qui s'acquiert sur la
  // période EN COURS (jamais consommable avant sa propre clôture). L'ancien code ne calculait que la
  // période contenant refDate et la traitait comme "le solde" : au passage d'une clôture, tout ce qui
  // avait été acquis avant disparaissait purement et simplement (report à 'aucun' par défaut).
  //
  // Le mécanisme report/reportPerdu/fractionnement (plafond, échéance, jours de fractionnement)
  // existait déjà, correct dans son fonctionnement mais branché au mauvais endroit : entre "en cours"
  // et "précédente". Ce lien-là doit être un report INTÉGRAL et INCONDITIONNEL (c'est la règle légale
  // elle-même, pas une exception à activer) — jamais plafonné, jamais expirable. Le mécanisme est
  // donc décalé d'un cran vers l'arrière : il relie désormais "précédente" (devenue LA période
  // disponible) à "encore avant" (previous2), exactement la même mécanique qu'avant ce correctif.
  const current = getCompteurPeriodBounds(leaveType.dateClotureCompteur, refDate);
  const previous = getCompteurPeriodBounds(leaveType.dateClotureCompteur, new Date(current.periodStart.getTime() - 86400000));
  const previous2 = getCompteurPeriodBounds(leaveType.dateClotureCompteur, new Date(previous.periodStart.getTime() - 86400000));

  // ---- Période EN COURS D'ACQUISITION (current) : purement informatif, jamais consommable avant sa
  //      propre clôture — jamais mélangé au solde disponible ci-dessous. ----
  const acquisEnCours = calculateAcquisition(employee, leaveType, refDate, current, allRequests, types);

  // ---- Report dans `previous` depuis `previous2` — même mécanique qu'avant ce correctif (plafond,
  //      échéance, fractionnement), simplement un cran plus loin dans le temps. ----
  let report = 0;
  if (leaveType.reportCompteur !== 'aucun') {
    const acquisPrecedent2 = calculateAcquisition(employee, leaveType, previous2.periodEnd, previous2, allRequests, types);
    const requestsPrecedent2 = requestsFor(previous2.periodStart, previous2.periodEnd);
    const prisPrecedent2 = requestsPrecedent2.reduce((sum, r) => sum + daysInPeriod(r, previous2.periodStart, previous2.periodEnd), 0);
    const soldeResiduel2 = Math.max(0, round2(acquisPrecedent2 - prisPrecedent2));
    report = leaveType.reportCompteur === 'limite' ? Math.min(soldeResiduel2, Number(leaveType.reportLimiteJours) || 0) : soldeResiduel2;
  }

  const requestsPrevious = requestsFor(previous.periodStart, previous.periodEnd);

  // §correctif audit du 23/08/2026 (§7.15), décalé d'un cran comme le report ci-dessus : le reliquat
  // reporté DANS `previous` doit être consommé avant l'échéance DANS `previous`, sous peine d'être perdu.
  let reportPerdu = 0;
  if (report > 0 && leaveType.dateLimiteReportMMJJ) {
    const echeance = resolveDeadlineInPeriod(leaveType.dateLimiteReportMMJJ, previous.periodStart, previous.periodEnd);
    const ref = toRefDate(refDate);
    if (ref > echeance) {
      const prisAvantEcheance = requestsPrevious.filter(r => r.statut === 'Validé')
        .reduce((sum, r) => sum + daysInPeriod(r, previous.periodStart, echeance), 0);
      reportPerdu = Math.max(0, round2(report - prisAvantEcheance));
    }
  }

  // §correctif audit du 23/08/2026 (§7.17), décalé d'un cran comme le report ci-dessus : jours de
  // fractionnement calculés sur `previous2` (la période qui vient de se clore avant `previous`),
  // crédités sur `previous` (désormais la période disponible).
  let fractionnement = 0;
  if (leaveType.fractionnementActif) {
    const joursHorsFenetre = requestsFor(previous2.periodStart, previous2.periodEnd)
      .filter(r => r.statut === 'Validé')
      .reduce((sum, r) => sum + countJoursHorsFenetreFractionnement(r, employee, settings, leaveType.uniteDecompte), 0);
    fractionnement = joursHorsFenetre >= 6 ? 2 : joursHorsFenetre >= 3 ? 1 : 0;
  }

  // ---- Période DISPONIBLE (previous) : ce qui reste réellement consommable maintenant. La
  //      consommation couvre TOUTE la fenêtre [previous.periodStart, current.periodEnd] — l'année où
  //      le solde a été acquis ET l'année suivante, celle où il est normalement pris — jamais
  //      seulement le calendrier de `previous` lui-même. ----
  const acquisPreviousBrut = calculateAcquisition(employee, leaveType, previous.periodEnd, previous, allRequests, types);
  const acquis = acquisPreviousBrut === Infinity ? Infinity : round2(acquisPreviousBrut + report - reportPerdu + fractionnement);
  const requestsDisponible = requestsFor(previous.periodStart, current.periodEnd);
  const pris = requestsDisponible.filter(r => r.statut === 'Validé').reduce((sum, r) => sum + daysInPeriod(r, previous.periodStart, current.periodEnd), 0);
  const enAttente = requestsDisponible.filter(r => r.statut !== 'Validé').reduce((sum, r) => sum + daysInPeriod(r, previous.periodStart, current.periodEnd), 0);
  const disponible = acquis === Infinity ? Infinity : round2(acquis - pris - enAttente + ajustement);

  return {
    acquis, pris, enAttente, disponible, ajustement, report, reportPerdu, fractionnement,
    periodeDisponible: { debut: toISODate(previous.periodStart), fin: toISODate(previous.periodEnd) },
    enCoursAcquisition: {
      acquis: acquisEnCours,
      periode: { debut: toISODate(current.periodStart), fin: toISODate(current.periodEnd) }
    }
  };
}

/** Jours d'une demande VALIDÉE qui tombent hors de la fenêtre légale du 1er mai au 31 octobre de
 * l'année de sa date de début — §7.17. Reconstruit via computeWorkingDays sur les sous-segments
 * avant le 1er mai / après le 31 octobre plutôt que de proratiser r.nbJours (qui ne dit rien de
 * QUELS jours précis sont concernés). */
function countJoursHorsFenetreFractionnement(request, employee, settings, unite) {
  const year = Number(request.dateDebut.slice(0, 4));
  const mai1 = `${year}-05-01`;
  const oct31 = `${year}-10-31`;
  let total = 0;
  if (request.dateDebut < mai1) {
    const finAvant = request.dateFin < mai1 ? request.dateFin : toISODate(addDays(parseISODateLocal(mai1), -1));
    total += computeWorkingDays(request.dateDebut, finAvant, false, employee, settings, unite);
  }
  if (request.dateFin > oct31) {
    const debutApres = request.dateDebut > oct31 ? request.dateDebut : toISODate(addDays(parseISODateLocal(oct31), 1));
    total += computeWorkingDays(debutApres, request.dateFin, false, employee, settings, unite);
  }
  return total;
}

/** Date d'échéance MM-JJ (ex. '03-31') résolue dans [periodStart, periodEnd] — §7.15. Prend
 * l'année de periodStart ; bascule à l'année suivante si ça tomberait avant periodStart (période
 * traversant le nouvel an civil, ex. période 01/06→31/05 avec échéance en mars). */
function resolveDeadlineInPeriod(mmjj, periodStart, periodEnd) {
  const [month, day] = mmjj.split('-').map(Number);
  let deadline = new Date(periodStart.getFullYear(), month - 1, day);
  if (deadline < periodStart) deadline = new Date(periodStart.getFullYear() + 1, month - 1, day);
  return deadline > periodEnd ? periodEnd : deadline;
}

// §correctif audit du 23/08/2026 (§7.20) : indemnité compensatrice de congés payés au départ —
// "au solde de tout compte, les jours acquis non pris se paient. Rien ne calcule ce montant ni ne
// le signale au moment où l'on renseigne une date de départ." ESTIMATION, pas un calcul légal figé
// (comme calculateAcquisition plus haut) : la vraie règle française retient le plus favorable entre
// le maintien de salaire (ce qu'on approxime ici) et la règle du dixième (nécessite l'historique
// complet des rémunérations sur la période de référence, hors périmètre ici) — à valider par
// l'expert-comptable du client avant tout virement réel, exactement comme les autres valeurs
// supplétives de ce fichier. Diviseur 26 pour un type en jours ouvrables, 22 en jours ouvrés —
// équivalences usuelles (mois moyen), pas une valeur légale unique.
function calculateIndemniteCompensatrice(employee, refDate) {
  if (!employee.salaireBrutMensuel) return { montant: 0, joursRestants: 0 };
  const types = DB.getLeaveTypes().filter(t => t.categorie === 'conge' && t.paye && t.actif);
  const requests = DB.getLeaveRequests();
  const allTypes = DB.getLeaveTypes();
  let joursRestants = 0;
  let montant = 0;
  types.forEach(t => {
    const balance = getLeaveBalance(employee, t, requests, allTypes, refDate);
    if (balance.disponible === Infinity || balance.disponible <= 0) return;
    const diviseur = t.uniteDecompte === 'ouvrables' ? 26 : 22;
    joursRestants = round2(joursRestants + balance.disponible);
    montant = round2(montant + balance.disponible * (employee.salaireBrutMensuel / diviseur));
  });
  return { montant, joursRestants };
}

// ---- Indicateurs du tableau de bord Propriétaire ----

const JOURS_OUVRES_PAR_AN = 218; // moyenne France (jours ouvrés hors fériés/congés), utilisée comme base de taux

function calculateAverageAnciennete(employees) {
  const actifs = employees.filter(e => e.statut === 'Actif' && e.dateEmbauche);
  if (!actifs.length) return 0;
  const now = new Date();
  const totalAnnees = actifs.reduce((sum, e) => {
    const start = parseISODateLocal(e.dateEmbauche);
    if (Number.isNaN(start.getTime())) return sum;
    return sum + (now - start) / (365.25 * 24 * 3600 * 1000);
  }, 0);
  return round2(totalAnnees / actifs.length);
}

/** Simplification : sorties sur 12 mois / effectif moyen sur la période (effectif moyen = (début + fin) / 2).
 * §correctif bug sweep 19/08/2026 : `depuis` doit rester une CHAÎNE ISO pour être comparable à
 * dateDepart/dateEmbauche (chaînes) — auparavant addDays() renvoyait un objet Date, comparé à des
 * chaînes via >=/<= (toujours faux après coercition), ce qui maintenait sorties/entrees à 0 et
 * affichait un taux de rotation systématiquement nul. */
function calculateTurnoverRate(employees, refDate) {
  const ref = refDate || new Date();
  const refStr = toISODate(ref);
  const depuis = toISODate(addDays(ref, -365));
  const sorties = employees.filter(e => e.dateDepart && e.dateDepart >= depuis && e.dateDepart <= refStr).length;
  const entrees = employees.filter(e => e.dateEmbauche && e.dateEmbauche >= depuis && e.dateEmbauche <= refStr).length;
  const effectifFin = employees.filter(e => e.statut === 'Actif').length;
  const effectifDebut = Math.max(0, effectifFin - entrees + sorties);
  const effectifMoyen = (effectifDebut + effectifFin) / 2;
  if (!effectifMoyen) return 0;
  return round2((sorties / effectifMoyen) * 100);
}

/** Simplification : les arrêts maladie validés servent de proxy à l'absentéisme, rapportés aux jours ouvrés théoriques de l'effectif actif. */
function calculateAbsenteeismRate(employees, leaveRequests, leaveTypes, year) {
  const maladieTypeIds = getLeaveTypeIdsByName(leaveTypes, 'Maladie');
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

/** Types de congés fournis par défaut (paramétrables ensuite via l'écran Congés).
 * §correctif audit du 23/08/2026 (§7.1) : jeu de règles standard confirmé par le client — Congés
 * payés/RTT/Ancienneté/Enfant malade ci-dessous suivent les valeurs qu'il nous a communiquées.
 * Toutes ces valeurs sont SUPPLÉTIVES : la convention collective d'un client peut les relever,
 * jamais les abaisser (à afficher dans l'interface, voir renderParametresTypesAbsences).
 *
 * §correctif retour QA du 26/08/2026 (point 5.1) : les 3 types "événements familiaux" (Mariage/
 * PACS, Décès, Naissance/adoption) SONT bien présents ci-dessous — le commentaire précédent ici
 * affirmait le contraire ("volontairement absents... en attente de l'expert-comptable"), ce qui
 * était faux et risquait de rester non vérifié. Décision : on les GARDE (les retirer supprimerait
 * une fonctionnalité déjà utilisable par des entreprises clientes existantes) mais on documente
 * explicitement, dans la description de chaque type concerné, ce qui reste une simplification à
 * vérifier au cas par cas.
 *
 * §correctif retour QA du 27/08/2026 (point 7.1, expert-comptable : "mettre le minimum légal et
 * que ce soit modifiable") : "Décès" masquait une vraie différence légale selon le lien de parenté
 * (une durée unique, 5 jours, pour un texte qui distingue 3 jours pour un proche et 12-14 jours
 * pour un enfant) — corrigé en 3 jours + un nouveau type dédié "Décès d'un enfant" (12 jours).
 * Ajout aussi de "Mariage d'un enfant" (1 jour) et "Annonce de handicap ou maladie grave d'un
 * enfant" (10 jours), absents jusqu'ici. Toutes les valeurs vérifiées en direct sur Légifrance
 * (Art. L3142-4, version en vigueur au 27/08/2026 — cet article a été modifié en 2026, donc jamais
 * présumées de mémoire) plutôt que devinées. Ces 3 nouveaux types sont automatiquement proposés aux
 * entreprises déjà existantes via ensureDefaultLeaveTypesBackfilled (ci-dessus) à leur prochaine
 * connexion — jamais en écrasant une valeur qu'une entreprise aurait déjà personnalisée sur un type
 * du même nom : seuls les types VRAIMENT ABSENTS sont ajoutés, jamais mis à jour. */
function seedLeaveTypes() {
  const rows = [
    ['Congés payés', '🏖️', '#2563eb', 30, 'Mensuelle', true, false, ['manager'], 'conge'],
    ['RTT', '⏱️', '#7c3aed', 12, 'Mensuelle', true, false, ['manager'], 'conge'],
    ['Ancienneté', '🎖️', '#0891b2', 0, 'Annuelle', true, false, ['manager'], 'autre'],
    ['Maladie', '🌡️', '#16a34a', 0, 'Illimitée', false, true, ['rh'], 'autre'],
    ['Mariage / PACS', '💍', '#db2777', 4, 'Annuelle', true, true, ['manager', 'rh'], 'autre'],
    ['Mariage d\'un enfant', '💍', '#db2777', 1, 'Annuelle', true, true, ['manager', 'rh'], 'autre'],
    ['Décès', '🕊️', '#4b5563', 3, 'Annuelle', true, true, ['rh'], 'autre'],
    ['Décès d\'un enfant', '🕊️', '#4b5563', 12, 'Annuelle', true, true, ['rh'], 'autre'],
    ['Annonce de handicap ou maladie grave d\'un enfant', '🎗️', '#dc2626', 10, 'Annuelle', true, true, ['rh'], 'autre'],
    ['Enfant malade', '🤒', '#f59e0b', 3, 'Annuelle', false, true, ['manager'], 'autre'],
    ['Formation', '📚', '#059669', 5, 'Annuelle', true, false, ['manager', 'rh'], 'autre'],
    ['Naissance / adoption', '👶', '#ec4899', 3, 'Annuelle', true, true, ['rh'], 'autre'],
    ['Proche aidant', '🤝', '#8b5cf6', 0, 'Illimitée', false, true, ['rh'], 'autre'],
    ['Sans solde', '🚫', '#6b7280', 0, 'Illimitée', false, false, ['manager', 'proprietaire'], 'autre'],
    ['Exceptionnel', '⭐', '#d97706', 3, 'Annuelle', true, false, ['rh'], 'autre']
  ];

  return rows.map((row, i) => {
    const [nom, icone, couleur, nombreAnnuel, acquisition, paye, justificatifObligatoire, workflow, categorie] = row;
    const type = Object.assign(makeEmptyLeaveType(), {
      id: generateId('lt'),
      ordre: i,
      nom, icone, couleur, nombreAnnuel, acquisition, paye, justificatifObligatoire, workflow, categorie,
      saisiParSalarie: nom.toLowerCase() !== 'maladie', // §24 : arrêts maladie saisis uniquement par les RH
      illimite: acquisition === 'Illimitée'
    });

    if (nom === 'Congés payés') {
      // 2,5 jours ouvrables/mois = 30 jours ouvrables/an (valeur par défaut ci-dessus), période de
      // référence légale du 1er juin au 31 mai, report nul par défaut (reportCompteur: 'aucun',
      // déjà la valeur par défaut de makeEmptyLeaveType — pas besoin de le répéter ici).
      type.uniteDecompte = 'ouvrables';
      type.dateClotureCompteur = '05-31';
      type.description = 'Règle légale par défaut, supplétive : 2,5 jours ouvrables par mois travaillé (30 j/an), période du 1er juin au 31 mai. Votre convention collective peut la relever, jamais l\'abaisser.';
    }
    if (nom === 'RTT') {
      // Créé mais INACTIF par défaut : aucune règle légale unique n'existe pour les RTT (contrairement
      // aux congés payés) — à activer et ajuster une fois la convention/l'accord d'entreprise connu.
      type.actif = false;
      type.description = 'Inactif par défaut : pas de règle légale unique. Ordres de grandeur usuels : environ 23 jours/an pour un forfait 39h hebdo, 10 à 12 jours/an pour un forfait 218 jours. Concerne en général les salariés au forfait ou au-delà de 35h/semaine. À activer et ajuster une fois votre accord d\'entreprise confirmé.';
    }
    if (nom === 'Ancienneté') {
      // §7.18 : paliers dans CE seul type plutôt que 4 types distincts — barème standard communiqué
      // par le client (+1j à 5 ans, +2 à 10, +3 à 15, +4 à 20 ; non cumulatif, voir
      // resolveAncienneteAcquisAnnuel). nombreAnnuel reste à 0, ignoré tant que des paliers existent.
      type.paliersAnciennete = [
        { ancienneteMin: 5, jours: 1 },
        { ancienneteMin: 10, jours: 2 },
        { ancienneteMin: 15, jours: 3 },
        { ancienneteMin: 20, jours: 4 }
      ];
      type.description = 'Barème standard, supplétif : +1 jour à 5 ans d\'ancienneté, +2 à 10 ans, +3 à 15 ans, +4 à 20 ans (non cumulatif). Votre convention collective peut le relever, jamais l\'abaisser.';
    }
    if (nom === 'Décès') {
      // §correctif retour QA du 27/08/2026 (points 2.4/7.1, confirmé par l'expert-comptable :
      // "mettre le minimum légal, modifiable") : Art. L3142-4 du Code du travail (dans sa version
      // en vigueur au 27/08/2026) fixe 3 jours pour le décès du conjoint/partenaire de PACS/
      // concubin/père/mère/beau-père/belle-mère/frère/sœur — DISTINCT du décès d'un enfant (durée
      // bien plus longue, voir le nouveau type "Décès d'un enfant" ci-dessous, qui existait
      // auparavant confondu dans une seule valeur "5 jours" ici). Vérifié en direct sur Légifrance
      // au moment du correctif plutôt que présumé de mémoire — cet article a été modifié en 2026.
      type.description = 'Minimum légal (Art. L3142-4, décès du conjoint/partenaire de PACS/concubin/père/mère/beau-parent/frère/sœur) : 3 jours ouvrables. Pour le décès d\'un enfant, voir le type dédié "Décès d\'un enfant" (durée légale bien plus longue). Votre convention collective peut relever cette durée, jamais l\'abaisser.';
    }
    if (nom === 'Décès d\'un enfant') {
      type.description = 'Minimum légal (Art. L3142-4) : 12 jours ouvrables, porté à 14 jours si l\'enfant avait moins de 25 ans OU si l\'enfant décédé était lui-même parent (quel que soit son âge dans ce cas). Ce deuxième seuil n\'est pas automatisé (l\'application ne connaît pas l\'âge de l\'enfant décédé ni sa situation familiale) : ajustez manuellement le nombre de jours de la demande au cas par cas.';
    }
    if (nom === 'Mariage d\'un enfant') {
      type.description = 'Minimum légal (Art. L3142-4) : 1 jour ouvrable. Distinct du mariage/PACS du salarié lui-même (voir le type "Mariage / PACS", 4 jours).';
    }
    if (nom === 'Annonce de handicap ou maladie grave d\'un enfant') {
      type.description = 'Minimum légal (Art. L3142-4) : 10 jours ouvrables, pour l\'annonce d\'un handicap, d\'une pathologie chronique nécessitant un apprentissage thérapeutique, ou d\'un cancer chez un enfant.';
    }
    if (nom === 'Mariage / PACS' || nom === 'Naissance / adoption') {
      type.description = 'Durée légale par défaut (Art. L3142-4), supplétive. Votre convention collective peut la relever, jamais l\'abaisser — à vérifier avec votre expert-comptable si vous n\'êtes pas certain(e) qu\'elle s\'applique telle quelle à votre situation.';
    }
    if (nom === 'Enfant malade') {
      // La bonification à 5 jours (enfant de moins d'1 an, ou salarié ayant 3 enfants de moins de
      // 16 ans) dépend de données sur les ENFANTS du salarié, qu'aucun champ de ce SIRH ne capture
      // aujourd'hui — l'ajouter serait un nouveau modèle de données, hors périmètre d'un simple jeu
      // de règles par défaut. Le cas échéant, un RH ajuste manuellement via DB.ajusterCompteurConge
      // (déjà existant) ; documenté ici plutôt que silencieusement absent.
      type.description = '3 jours par an, non rémunéré (valeur supplétive légale). Porté à 5 jours si l\'enfant a moins d\'un an ou si le salarié a 3 enfants de moins de 16 ans. Cette bonification n\'est pas automatisée (l\'application ne suit pas les enfants des salariés) : ajustez manuellement le compteur au cas par cas.';
    }
    return type;
  });
}

// ---------------------------------------------------------------------------
// Calendrier — jours fériés, vacances scolaires
// ---------------------------------------------------------------------------

/** `new Date("YYYY-MM-DD")` parse en UTC minuit (spécification ECMA-262), alors que .getDate()/
 * .setDate()/.getFullYear() etc. lisent/écrivent en heure LOCALE — pour un fuseau en retard sur
 * UTC, ce décalage peut faire lire la veille (ex. UTC minuit le 10 devient 19h locale le 9),
 * provoquant un jour de décalage dans tout calcul de date qui mélange les deux. Cette fonction
 * construit directement une date locale à partir des composants texte, sans jamais passer par
 * l'interprétation UTC de la chaîne — à utiliser à la place de `new Date(dateStr)` partout où
 * dateStr est un "YYYY-MM-DD" destiné à un calcul calendaire local (ajout/soustraction de jours,
 * calcul de semaine...). */
function parseISODateLocal(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

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

/** Ajoute des mois à une date en évitant le débordement de fin de mois (ex: 31 janvier + 1 mois
 * ne doit pas donner le 3 mars via un débordement silencieux — on cale sur le dernier jour du
 * mois cible, ex: 28/29 février). */
function addMonths(date, months) {
  const day = date.getDate();
  const d = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const daysInTargetMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, daysInTargetMonth));
  return d;
}

/** Les 7 dates (Lundi → Dimanche) de la semaine contenant la date donnée. */
function getWeekDatesContaining(dateStr) {
  const d = parseISODateLocal(dateStr);
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

/** getFrenchPublicHolidays() + les jours fériés ajoutés manuellement par l'entreprise
 * (settings.joursFeriesPersonnalises) — à utiliser partout où "les jours fériés de l'année" sont
 * consultés pour que l'ajout d'un jour se répercute vraiment partout (calendriers, tickets
 * restaurant...), pas seulement sur l'écran Paramètres où on l'a saisi.
 *
 * §8 sprint amélioration : chaque jour porte maintenant travaillable (par défaut personne ne
 * travaille, comme le comportement historique) et exceptionsCategories (ex. les Commerciaux
 * travaillent ce jour-là). settings.feriesOverrides permet de personnaliser un férié NATIONAL
 * (jamais stocké tel quel, seulement calculé) sans avoir à le dupliquer dans joursFeriesPersonnalises. */
function getAllPublicHolidays(year, settings) {
  const overrides = settings?.feriesOverrides || {};
  const national = getFrenchPublicHolidays(year).map(h => ({
    travaillable: false,
    exceptionsCategories: [],
    ...h,
    ...(overrides[h.date] || {})
  }));
  const custom = (settings?.joursFeriesPersonnalises || [])
    .filter(h => h.date && h.date.startsWith(String(year)))
    .map(h => ({ travaillable: false, exceptionsCategories: [], ...h, custom: true }));
  return national.concat(custom);
}

/** Un salarié travaille-t-il réellement ce jour ? (§8 jours fériés + §9 fermetures, tous deux
 * consultés ici) — centralise ce qui était avant un simple `holidays.some(h => h.date === dateStr)`
 * disséminé (calcul des tickets restaurant, calendriers). Une exception par catégorie de salarié
 * (ex. "les Commerciaux travaillent ce jour") l'emporte toujours sur la valeur par défaut du jour. */
function isJourTravaillePourSalarie(dateStr, employee, settings, categoriesSalarie) {
  const categories = categoriesSalarie || settings.categoriesSalarie || [];
  const empCategorieId = getEffectiveCategorieSalarieId(employee, categories);

  const year = Number(dateStr.slice(0, 4));
  const holiday = getAllPublicHolidays(year, settings).find(h => h.date === dateStr);
  if (holiday) {
    const exception = (holiday.exceptionsCategories || []).find(ex => ex.categorieSalarieId === empCategorieId);
    return exception ? exception.travaillable : holiday.travaillable;
  }

  const fermeture = (settings.fermetures || []).find(f => dateStr >= f.dateDebut && dateStr <= f.dateFin);
  if (fermeture) {
    const exception = (fermeture.exceptionsCategories || []).find(ex => ex.categorieSalarieId === empCategorieId);
    return exception ? exception.travaillable : false;
  }

  return true;
}

/** §correctif audit du 23/08/2026 (§7.5) : nombre de jours décomptés pour UN salarié sur la durée
 * d'une fermeture imposée. Ne peut PAS réutiliser computeWorkingDays tel quel : celui-ci s'appuie
 * sur isJourTravaillePourSalarie, qui exclut justement les jours de CETTE fermeture (c'est ce qui
 * la rend gratuite par défaut) — on retomberait systématiquement sur 0. On réévalue donc chaque
 * jour avec les MÊMES règles (jours travaillés du salarié, jours fériés et exceptions par
 * catégorie, AUTRES fermetures) en ignorant explicitement cette fermeture précise. */
function countFermetureDecompteDays(fermeture, employee, settings) {
  const settingsSansCetteFermeture = { ...settings, fermetures: (settings.fermetures || []).filter(f => f.id !== fermeture.id) };
  const start = parseISODateLocal(fermeture.dateDebut);
  const end = parseISODateLocal(fermeture.dateFin);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;
  const joursTravailles = employee.joursTravailles && employee.joursTravailles.length ? employee.joursTravailles : ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'];
  const dayLabels = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  let count = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    const dateStr = toISODate(cursor);
    if (joursTravailles.includes(dayLabels[cursor.getDay()]) && isJourTravaillePourSalarie(dateStr, employee, settingsSansCetteFermeture)) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

/** §correctif audit du 23/08/2026 (§7.5) : matérialise (ou retire) le décompte d'une fermeture
 * imposée en vraies demandes de congé Validé — getLeaveBalance() (plus bas) ne lit de "pris" que
 * dans de vraies demandes, il n'existe aucune comptabilité parallèle possible ici sans dupliquer
 * cette logique. Idempotent et rejouable à chaque enregistrement de la fermeture (dates, type
 * décompté ou salariés concernés modifiés) : repart des demandes déjà générées pour CETTE
 * fermeture (fermetureId), les annule, puis regénère au besoin — jamais de recalcul incrémental
 * fragile. N'annule jamais une demande qu'un humain a modifiée depuis (statut déjà différent de
 * Validé, ex. déjà annulée manuellement) : elle sort simplement du mécanisme automatique. */
async function applyFermetureDecompte(fermeture) {
  const dejaGenerees = DB.getLeaveRequests().filter(r => r.fermetureId === fermeture.id);
  for (const r of dejaGenerees) {
    if (r.statut === 'Validé') {
      DB.updateLeaveRequest(r.id, { statut: 'Annulé', fermetureId: null });
    }
  }

  if (!fermeture.decompteTypeId) return { genere: 0 };

  const settings = DB.getSettings();
  const categories = DB.getCategoriesSalarie();
  const employees = DB.getEmployees().filter(e => !e.archive && e.statut === 'Actif');
  let genere = 0;
  for (const employee of employees) {
    const empCategorieId = getEffectiveCategorieSalarieId(employee, categories);
    const exception = (fermeture.exceptionsCategories || []).find(ex => ex.categorieSalarieId === empCategorieId);
    if (exception && exception.travaillable) continue; // travaille malgré la fermeture : rien à décompter

    const nbJours = countFermetureDecompteDays(fermeture, employee, settings);
    if (nbJours <= 0) continue;

    DB.addFermetureLeaveRequest({
      employeeId: employee.id,
      typeId: fermeture.decompteTypeId,
      dateDebut: fermeture.dateDebut,
      dateFin: fermeture.dateFin,
      demiJournee: null,
      nbJours,
      commentaire: `Fermeture imposée : ${fermeture.nom}`,
      fermetureId: fermeture.id
    });
    genere += 1;
  }
  return { genere };
}

/** Retourne la période de vacances scolaires en cours pour une date et une zone, s'il y en a une. */
function findSchoolHolidayPeriod(dateStr, zone, schoolHolidays) {
  return schoolHolidays.periodes.find(p => p.zones.includes(zone) && dateStr >= p.debut && dateStr <= p.fin) || null;
}

/** §sprint refonte UX : le "bug d'octobre" venait de ce que le mois affiché tombait au-delà de la
 * dernière période connue de l'année scolaire configurée (le seed ne couvre qu'une seule année,
 * jamais mise à jour automatiquement — des dates de vacances scolaires officielles ne peuvent pas
 * être calculées, seulement saisies). Utilitaire GÉNÉRAL (pas spécifique à un mois) pour détecter ce
 * manque de couverture, réutilisé par le calendrier et par Paramètres → Vacances scolaires. */
function isMonthBeyondSchoolYearCoverage(year, month, schoolHolidays) {
  if (!schoolHolidays || !schoolHolidays.periodes || !schoolHolidays.periodes.length) return true;
  const coverageEnd = schoolHolidays.periodes.reduce((max, p) => (p.fin > max ? p.fin : max), schoolHolidays.periodes[0].fin);
  const monthStart = toISODate(new Date(year, month, 1));
  return monthStart > coverageEnd;
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
    ['M.', 'Julien', 'Moreau', 'Direction', 'Direction générale', 'Directeur général', 'Cadre', 'CDI', '2015-03-02', 'Temps plein', 100, 39, 'Forfait jours', 'proprietaire'],
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

  // Structure hiérarchique de démonstration : Julien (proprietaire) encadre Camille, Nicolas
  // et Thomas ; Nicolas (manager) encadre Sarah et Léa — de quoi tester un vrai cas
  // "manager avec équipe" plutôt qu'un rattachement uniforme au propriétaire.
  const [julien, camille, nicolas, sarah, thomas, lea] = employees;
  camille.managerIds = [julien.id];
  nicolas.managerIds = [julien.id];
  thomas.managerIds = [julien.id];
  sarah.managerIds = [nicolas.id];
  lea.managerIds = [nicolas.id];

  return employees;
}

/**
 * ===========================================================================
 * Sprint SIRH premium §13/§14 — Architecture préparée, PAS implémentée
 * ===========================================================================
 * Ces deux sections du sprint demandent explicitement de préparer le terrain
 * sans construire les fonctionnalités elles-mêmes. Ce qui suit documente OÙ et
 * COMMENT elles s'intégreraient dans l'architecture actuelle, pour qu'une
 * implémentation future n'ait pas à redécouvrir ces points d'ancrage.
 *
 * ---- §13 : IA (préparation) — pistes à coût maîtrisé, aucune clé API/appel réseau existant ----
 *
 * 1. Détection d'anomalies enrichie (Préparation de paie, §6) : getPaieAnomalies() dans app.js
 *    retourne déjà une liste structurée { severity, type, employee, message }. Un modèle pourrait
 *    s'y greffer en AJOUTANT des entrées (ex. schéma horaire inhabituel d'un salarié par rapport à
 *    son historique) sans toucher au format existant ni aux 3 catégories de sévérité déjà utilisées
 *    par l'UI (badges, sections Bloquantes/Avertissements/Informations).
 * 2. Recherche en langage naturel (Recherche globale, §8) : performGlobalSearch(term) fait déjà du
 *    matching par sous-chaîne sur plusieurs entités (salariés/congés/télétravail/frais/services/
 *    paramètres). Une version IA remplacerait uniquement l'étape de matching interne par un appel à
 *    un modèle qui reformule `term` en filtres structurés, en réutilisant la MÊME forme de résultat
 *    ({ icon, label, sublabel, nav, params }) pour ne rien changer côté rendu/navigation.
 * 3. Résumés (ex. un résumé en une phrase du Centre d'action §7, ou de la fiche salarié) :
 *    fonctionnerait en lecture seule sur des données déjà calculées (renderDashboardActionCenter,
 *    getPaieRows) — jamais de génération qui modifierait des données métier.
 * 4. Aide à la rédaction (champs commentaire/motif des demandes congé/télétravail/frais, §
 *    régularisation) : suggestion de texte optionnelle dans les modales existantes
 *    (openLeaveRequestModal/openTeleworkRequestModal/openExpenseModal), jamais auto-soumise.
 *
 * Dénominateur commun : dans les 4 cas, l'IA resterait un service STATELESS et OPTIONNEL branché en
 * périphérie d'une fonction existante (entrée = données déjà en mémoire, sortie = même format que
 * ce que la fonction produit aujourd'hui) — jamais une dépendance dans le chemin critique (une panne
 * du service IA ne doit jamais bloquer la préparation de paie, la recherche simple ou l'envoi d'une
 * demande). Le jour venu : un point d'entrée unique (ex. `AI.suggest(kind, payload)`) à ajouter dans
 * data.js, avec un flag de configuration (Paramètres) pour l'activer/désactiver par entreprise —
 * cohérent avec le fait que `settings` porte déjà tous les autres réglages activables (§ suivi âge/
 * genre, masse salariale...).
 *
 * ---- §14 : Modules futurs — architecture à anticiper, sans construire ----
 *
 * - Entretiens annuels : nouvelle entité au même niveau que leaveRequests/teleworkRequests/expenses
 *   (un repository dédié suivant EXACTEMENT le même patron que leaveRepository/expenseRepository —
 *   getAll/getById/getForEmployee/create/update), un nouveau NAV_ITEMS avec sa propre permission
 *   dans PERMISSIONS (catalogue §8 existant), un statut/workflow réutilisant advanceWorkflow/
 *   refuseRequest/cancelRequest (déjà génériques, pas spécifiques aux congés).
 * - Gestion des temps (pointage) : le sprint (§ Planning/Horaires, déjà construit) a déjà posé les
 *   horaireMatinDebut/Fin + horaireApresMidiDebut/Fin par salarié et computeDailyHours() — un vrai
 *   pointage ajouterait une entité "relevés" comparés à ces horaires théoriques, sans redéfinir la
 *   notion d'horaire elle-même.
 * - API publique : la couche repository (employeeRepository/leaveRepository/...) est déjà l'unique
 *   point de passage entre les vues et le stockage (voir le commentaire au-dessus de leur
 *   définition) — une API REST future implémenterait ces mêmes méthodes côté serveur sans que
 *   app.js ait à changer d'appelant, seulement la couche data.js changerait de backend
 *   (localStorage → HTTP).
 * - Application mobile : consommerait la même API publique ci-dessus ; aucune UI de ce dépôt n'a
 *   vocation à être réutilisée telle quelle (vanilla JS + rendu chaîne de caractères, pas de
 *   composants), mais le modèle de données et les règles métier (data.js) sont déjà la seule source
 *   de vérité et n'auraient pas à être dupliqués.
 */
