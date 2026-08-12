/**
 * Seven RH — Logique applicative
 * Navigation, rendu des vues, formulaires et interactions.
 * Dépend de data.js (DB, helpers de calcul, seed).
 */

const LIST_PAGE_SIZE = 20;

/** Jauge de force du mot de passe (§ simplification UX) — heuristique simple (longueur + variété de
 * caractères), pas de vérification contre une liste de mots de passe compromis (hors scope ici) :
 * juste un repère visuel pour encourager un mot de passe un peu plus solide que le minimum requis. */
function computePasswordStrengthLevel(password) {
  if (!password) return null;
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;
  if (score <= 1) return { level: 'weak', label: 'Faible' };
  if (score <= 3) return { level: 'medium', label: 'Moyen' };
  return { level: 'strong', label: 'Fort' };
}

/** Marque "Nexus" (logo.png) — réutilisée partout où le logo apparaît (écrans de connexion,
 * console BERTOLIS) pour n'avoir qu'un seul endroit à modifier. */
const NEXUS_LOGO_MARK = `<span class="logo-mark"><img class="logo-icon" src="logo.png" alt="Nexus"></span>`;

/** Un onglet oublié/épinglé ouvert sur l'écran "vérifiez vos emails" resterait sinon bloqué là
 * indéfiniment (sessionStorage ne s'efface qu'à la fermeture de l'onglet) même si l'inscription a
 * été abandonnée depuis longtemps — au-delà de ce délai, on retombe silencieusement sur l'écran de
 * connexion normal. */
const PENDING_SIGNUP_TTL_MS = 24 * 60 * 60 * 1000;

function setPendingSignupEmail(email, view = 'signup') {
  sessionStorage.setItem('sevenrh_pending_signup_email', JSON.stringify({ email, view, ts: Date.now() }));
}

/** Renvoie { email, view } ou null — `view` distingue "signup" (rejoindre une entreprise) de
 * "signup-company" (créer sa propre entreprise), pour réafficher le bon écran après un rechargement
 * pendant l'attente de confirmation d'email (voir showLoginScreen). */
function getPendingSignup() {
  const raw = sessionStorage.getItem('sevenrh_pending_signup_email');
  if (!raw) return null;
  try {
    const { email, view, ts } = JSON.parse(raw);
    if (!email || Date.now() - ts > PENDING_SIGNUP_TTL_MS) {
      sessionStorage.removeItem('sevenrh_pending_signup_email');
      return null;
    }
    return { email, view: view || 'signup' };
  } catch {
    sessionStorage.removeItem('sevenrh_pending_signup_email');
    return null;
  }
}

/** Élément qui avait le focus juste avant l'ouverture d'une modale — restauré par closeModal() à la fermeture. */
let lastFocusedBeforeModal = null;

// ---------------------------------------------------------------------------
// Thème (clair / sombre / système) — préférence de l'appareil, pas liée à un
// utilisateur (elle doit s'appliquer dès l'écran de connexion, avant tout login).
// ---------------------------------------------------------------------------

const THEME_KEY = 'sevenrh_theme';
const THEME_CYCLE = ['system', 'light', 'dark'];
const THEME_ICONS = { system: '🖥️', light: '☀️', dark: '🌙' };
const THEME_LABELS = { system: 'Système', light: 'Clair', dark: 'Sombre' };

function getThemePreference() {
  const stored = localStorage.getItem(THEME_KEY);
  return THEME_CYCLE.includes(stored) ? stored : 'system';
}

function applyTheme() {
  const pref = getThemePreference();
  if (pref === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = pref;

  const btn = document.getElementById('btn-theme-toggle');
  if (btn) {
    btn.textContent = THEME_ICONS[pref];
    btn.title = `Thème : ${THEME_LABELS[pref]} (cliquer pour changer)`;
  }
}

function cycleTheme() {
  const current = getThemePreference();
  const next = THEME_CYCLE[(THEME_CYCLE.indexOf(current) + 1) % THEME_CYCLE.length];
  localStorage.setItem(THEME_KEY, next);
  applyTheme();
}

applyTheme();

/** Filtres/pagination/onglets propres à une session de vue — voir showApp(), qui les réinitialise
 * à chaque entrée dans l'application pour éviter qu'un filtre (ex. fraisFilters.employeeId) ne
 * survive à un changement d'entreprise ou de compte et masque silencieusement des données réelles
 * dans la nouvelle session (le <select> correspondant retombe sur "Tous" sans option correspondante,
 * masquant qu'un filtre obsolète reste actif). */
function getInitialViewState() {
  return {
    view: 'dashboard',
    currentEmployeeId: null,
    search: '',
    filters: { etablissementId: '', service: '', statutContrat: '', statut: '', favorisOnly: false },
    organigrammeFilters: { search: '', etablissementId: '', service: '', equipe: '' },
    orgCollapsedIds: new Set(), // §12 : replier/déplier les branches — ids de salariés dont les enfants sont masqués
    sortBy: 'nom',
    sortDir: 'asc',
    employeesPage: 1,
    congesTab: 'demandes',
    congesFilters: { employeeId: '', typeId: '', statut: '' },
    congesPage: 1,
    autresAbsencesTab: 'demandes',
    autresAbsencesFilters: { employeeId: '', typeId: '', statut: '' },
    autresAbsencesPage: 1,
    pendingAttachment: null,
    editingDraftId: null, // Sprint SIRH premium §10 : brouillon en cours de reprise, converti/supprimé au submit
    calendarYear: new Date().getFullYear(),
    calendarMonth: new Date().getMonth(),
    parametresTab: 'listes',
    parametresTypesCategorie: 'conge', // Sprint SIRH premium §1 : sous-onglet de Paramètres > Types d'absences
    absencesHubTab: 'conges', // 'conges' | 'autres' | 'teletravail' — voir renderAbsencesHub
    parametresFeriesYear: new Date().getFullYear(),
    teletravailTab: 'demandes',
    teletravailFilters: { employeeId: '', statut: '' },
    teletravailPage: 1,
    teletravailWeekOffset: 0,
    fraisFilters: { employeeId: '', categorie: '', statut: '' },
    fraisPage: 1,
    ticketsYear: new Date().getFullYear(),
    ticketsMonth: new Date().getMonth(),
    ticketsRestaurantVue: 'equipe', // §sprint refonte UX §9-10 : 'equipe' | 'personnel' — même principe que calendrierVue/planningVue
    mesTicketsYear: new Date().getFullYear(),
    mesTicketsMonth: new Date().getMonth(),
    notifTab: 'non-lues',
    paieYear: new Date().getFullYear(),
    paieMonth: new Date().getMonth(),
    paieTab: 'preparation', // Sprint SIRH premium §6 : préparation/anomalies affichée par défaut, avant l'export
    authView: 'login', // 'login' | 'forgot' | 'reset' | 'signup'
    authError: '',
    pendingReset: null, // { token, employeeName } après une demande de réinitialisation
    pendingSignupConfirmation: null, // email en attente de confirmation après DB.signUp()
    resendConfirmationSent: null, // email confirmé après renderResendConfirmationView() (écran "email envoyé")
    onboarding: null, // brouillon de l'assistant de première installation, voir openOnboardingWizard()
    planningView: 'semaine', // 'semaine' | 'mois' | 'annee'
    planningFilters: { service: '' },
    planningWeekOffset: 0,
    planningYear: new Date().getFullYear(),
    planningMonth: new Date().getMonth(),
    auditFilters: { action: '', search: '', dateDebut: '', dateFin: '' },
    auditPage: 1,
    calendrierVue: 'entreprise', // Sprint SIRH premium §2 : 'entreprise' (vue équipe/entreprise selon le rôle) | 'personnel'
    horairesView: 'semaine', // Sprint SIRH premium §3 : 'jour' | 'semaine' | 'mois'
    horairesDay: toISODate(new Date()),
    planningVue: 'equipe' // Sprint SIRH premium §5 : 'equipe' | 'personnel' — même principe que calendrierVue
  };
}

const state = getInitialViewState();

/** Sprint SIRH premium §5/§7 : navParams "aller aux demandes en attente" — partagés entre l'entrée
 * de sidebar équipe (NAV_ITEMS) et le Centre d'action du tableau de bord (renderDashboardActionCenter),
 * pour que les deux points d'entrée vers le même filtre ne puissent pas silencieusement diverger. */
const NAVPARAMS_CONGES_A_VALIDER = { absencesHubTab: 'conges', congesTab: 'demandes', congesFilters: { employeeId: '', typeId: '', statut: 'En attente' } };
const NAVPARAMS_TELETRAVAIL_A_VALIDER = { absencesHubTab: 'teletravail', teletravailTab: 'demandes', teletravailFilters: { employeeId: '', statut: 'En attente' } };
const NAVPARAMS_FRAIS_A_VALIDER = { fraisFilters: { employeeId: '', categorie: '', statut: 'En attente' } };

/** roles: qui voit l'entrée de menu. 'employees' reste visible au manager, mais affiché et filtré
 * comme "Mon équipe" (voir renderEmployeesList).
 *
 * Sprint SIRH premium §5 : "Personnel" (mes propres congés/planning/calendrier/notes de frais) vs
 * "Équipe" (planning/calendrier équipe, ce qui reste à valider) — un même écran (`key`) peut
 * apparaître deux fois avec un `label` et un `navParams` différents (ex. "Mon calendrier" vs
 * "Calendrier équipe" pointent tous deux vers 'calendrier', juste avec calendrierVue différent) ;
 * voir renderSidebar()/navigateTo() pour la résolution. `group` est purement un indice d'affichage
 * (regroupement visuel) — n'affecte jamais qui voit quoi, ça reste `roles`/`permissions` seuls. */
const NAV_ITEMS = [
  { key: 'dashboard', label: 'Accueil', icon: '📊', roles: ['salarie', 'manager', 'rh', 'comptabilite', 'directeur'] },

  // ---- Personnel ----
  { key: 'planning', label: 'Planning', icon: '🗓️', roles: ['manager', 'rh', 'directeur'], group: 'personnel', navParams: { planningVue: 'personnel' } },
  { key: 'calendrier', label: 'Calendrier', icon: '📅', roles: ['salarie', 'manager', 'rh', 'comptabilite', 'directeur'], group: 'personnel', navParams: { calendrierVue: 'personnel' } },
  // §sprint refonte UX §7 : fusion de "Congés"/"Absences"/"Télétravail" (3 entrées pointant vers 3
  // écrans quasi identiques) en une seule, à onglets internes (voir renderAbsencesHub) — même
  // logique de regroupement que Planning/Calendrier ci-dessus, appliquée cette fois à 3 écrans
  // distincts plutôt qu'à 2 navParams du même écran.
  // comptabilite ajouté ici : DEFAULT_ROLE_PERMISSIONS (data.js) lui accorde CREER_DEMANDE_ABSENCE
  // comme à tous les autres rôles, mais cette entrée de nav (héritée de l'ancien menu Congés/
  // Autres absences/Télétravail, jamais mise à jour) était la seule à l'exclure, la privant de tout
  // moyen d'exercer cette permission — un salarié Comptabilité a autant besoin de poser des congés
  // que les autres.
  { key: 'absences', label: 'Congés & absences', icon: '🏖️', roles: ['salarie', 'manager', 'rh', 'comptabilite', 'directeur'], group: 'personnel' },
  { key: 'frais', label: 'Notes de frais', icon: '🧾', roles: ['salarie', 'manager', 'rh', 'comptabilite', 'directeur'], group: 'personnel' },
  { key: 'mes-documents', label: 'Mes documents', icon: '📁', roles: ['salarie'], group: 'personnel' },
  // Phase 2 sprint amélioration RH (§16-17) : accès ouvert à tous les rôles — tout salarié peut
  // avoir besoin de demander de l'aide, pas seulement les rôles ayant déjà un accès "Équipe".
  { key: 'mes-tickets', label: 'Mes tickets', icon: '🎫', roles: ['salarie', 'manager', 'rh', 'comptabilite', 'directeur'], group: 'personnel' },

  // ---- Équipe ----
  { key: 'employees', label: 'Salariés', icon: '👥', roles: ['manager', 'rh', 'directeur'], permissions: [PERMISSIONS.VOIR_SALARIES, PERMISSIONS.VOIR_EQUIPE], group: 'equipe' },
  { key: 'organigramme', label: 'Organigramme', icon: '🗂️', roles: ['manager', 'rh', 'directeur'], group: 'equipe' },
  // Retour utilisateur : plus qu'UNE seule entrée de menu par vue — "Planning équipe"/"Calendrier
  // équipe"/"Congés à valider"/"Télétravail à valider"/"Notes de frais à valider" pointaient déjà
  // vers exactement la même vue que leur pendant "Personnel", juste avec des navParams différents.
  // Planning/Calendrier ont déjà un bouton interne "Mon .../... équipe" (state.planningVue/
  // calendrierVue) ; Congés/Télétravail/Notes de frais ont désormais un bouton "Voir les demandes à
  // valider" dans leur propre vue (voir renderConges/renderTeletravail/renderFrais) plutôt qu'une
  // entrée de menu séparée pour un simple préréglage de filtre.
  // §sprint refonte UX §10 : ouvert à tous désormais (vue personnelle par défaut) — RH/Comptabilité/
  // Directeur gardent la vue équipe existante via la même bascule Moi/Équipe (§9), plutôt que 2 entrées
  // de menu distinctes pour un même écran.
  { key: 'tickets', label: 'Tickets restaurant', icon: '🍽️', roles: ['salarie', 'manager', 'rh', 'comptabilite', 'directeur'], group: 'personnel' },
  { key: 'export-paie', label: 'Préparation de paie', icon: '📤', roles: ['rh', 'directeur'], permissions: [PERMISSIONS.EXPORTER_PAIE], group: 'equipe' },

  // hideOnMobile (§sprint refonte UX §12) : ces deux entrées restent accessibles sur mobile via le
  // menu utilisateur (renderUserMenuPanel) — les dupliquer aussi dans la barre du bas, déjà à l'étroit
  // sur un petit écran, n'apporte rien. Desktop inchangé (renderSidebar filtre uniquement en dessous
  // de 860px, voir bindMobileNavVisibility).
  { key: 'parametres', label: 'Paramètres', icon: '⚙️', roles: ['rh', 'directeur'], permissions: [PERMISSIONS.GERER_PARAMETRES], hideOnMobile: true },
  // Entrée dédiée plutôt que caché dans Paramètres parmi 8 autres onglets (retour utilisateur :
  // "pas très facile d'accès") — même schéma que les concurrents SaaS (Stripe, Notion, Linear...),
  // qui donnent toujours à la facturation son propre accès direct. Réutilise la vue "parametres"
  // existante (navParams sélectionne directement l'onglet), pas une nouvelle vue.
  { key: 'parametres', label: 'Abonnement', icon: '💳', roles: ['directeur'], permissions: [PERMISSIONS.GERER_ABONNEMENTS], navParams: { parametresTab: 'abonnement' }, hideOnMobile: true }
];

/** user : l'objet salarié complet (pas juste son rôle), pour pouvoir consulter ses éventuelles
 * surcharges de permissions individuelles (§8) en plus du défaut de son rôle. */
function navItemsForRole(user) {
  return NAV_ITEMS.filter(item => {
    if (item.permissions) return item.permissions.some(p => hasPermission(user, p));
    return item.roles.includes(user.role);
  });
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  DB.onSaveError = (message) => showToast(message, 'error');
  DB.init();
  applyTheme();
  document.getElementById('btn-theme-toggle').addEventListener('click', cycleTheme);
  bindGlobalEvents();
  bindGlobalSearchEvents();
  bindNotificationEvents();
  bindUserMenuEvents();
  // §sprint refonte UX §12 : re-filtre la barre de nav au franchissement du seuil mobile (ex.
  // rotation d'un tablette, redimensionnement de fenêtre) — un seul listener posé une fois, jamais
  // par render() lui-même (qui tourne bien trop souvent pour ça).
  MOBILE_NAV_QUERY.addEventListener('change', renderSidebar);

  // La console BERTOLIS (super-admin multi-entreprise) est un système entièrement séparé, basé sur
  // localStorage, qui n'a besoin d'aucune donnée Supabase — une session BERTOLIS déjà active ne doit
  // pas rester bloquée par un souci réseau/extension qui empêcherait supabase-client.js de charger.
  if (DB.isBertolisLoggedIn()) {
    showBertolisConsole();
    return;
  }

  // Le module supabase-client.js charge son propre import réseau (CDN) avant de poser
  // window.SupabaseSync — si ça échoue (réseau lent, extension de navigateur, etc.), mieux vaut un
  // message d'erreur clair qu'un écran de connexion silencieusement figé (aucun bouton ne répond).
  if (!window.SupabaseSync) {
    document.getElementById('login-root').style.display = 'flex';
    document.getElementById('login-root').innerHTML = `
      <div class="login-card">
        <div class="login-logo">${NEXUS_LOGO_MARK} Nexus</div>
        <p class="login-error" role="alert">Impossible de charger le module de connexion (problème réseau ou extension de navigateur). Rechargez la page ; si le problème persiste, essayez sans bloqueur de publicité/traqueurs.</p>
        <button type="button" class="btn btn-primary" style="width: 100%;" onclick="location.reload()">Recharger la page</button>
      </div>
    `;
    return;
  }

  window.SupabaseSync.onPasswordRecovery(() => {
    state.authView = 'reset';
    state.authError = '';
    // Persisté : si l'onglet recharge pendant qu'on est sur l'écran "nouveau mot de passe" (avant
    // validation), la session de récupération reste valide mais state.authView (en mémoire) serait
    // perdu — sans ce flag, restoreSession() plus bas verrait une session valide et enverrait
    // directement dans l'appli, sautant le vrai changement de mot de passe.
    sessionStorage.setItem('sevenrh_password_recovery_pending', '1');
    renderLoginScreen();
  });

  const restored = await DB.restoreSession();
  // Une session de récupération de mot de passe est une session valide comme une autre : si
  // PASSWORD_RECOVERY a été détecté (maintenant ou lors d'un chargement précédent, via le flag
  // persisté), il ne faut jamais laisser restoreSession() envoyer directement dans l'appli.
  if (restored && !window.SupabaseSync.wasPasswordRecoveryDetected() && !sessionStorage.getItem('sevenrh_password_recovery_pending')) {
    showApp();
  } else {
    showLogin();
  }
});

function showLogin() {
  document.getElementById('app-shell').style.display = 'none';
  document.getElementById('bertolis-root').style.display = 'none';
  document.getElementById('login-root').style.display = 'flex';
  // Remet le bouton de thème en position flottante (coin haut-droit) : il n'y a pas de topbar sur l'écran de connexion.
  const themeToggle = document.getElementById('btn-theme-toggle');
  themeToggle.classList.remove('theme-toggle-inline');
  document.body.prepend(themeToggle);
  state.authError = '';
  // Si un rechargement survient pendant l'attente de confirmation d'email (typiquement parce que
  // l'utilisateur a changé d'appli pour consulter ses emails, ce qui peut faire recharger l'onglet
  // en arrière-plan sur mobile), on retrouve cet état au lieu de silencieusement revenir au simple
  // écran de connexion — voir le formulaire de signup dans bindLoginScreenEvents.
  const pendingSignup = getPendingSignup();
  const pendingResetEmail = sessionStorage.getItem('sevenrh_pending_reset_email');
  const recoveryPending = sessionStorage.getItem('sevenrh_password_recovery_pending');
  if (pendingSignup) {
    state.authView = pendingSignup.view;
    state.pendingSignupConfirmation = pendingSignup.email;
  } else if (recoveryPending) {
    // Priorité sur pendingResetEmail : cliquer le lien reçu par email fait progresser l'utilisateur
    // de "en attente de l'email" à "en train de choisir un nouveau mot de passe".
    state.authView = 'reset';
    state.authError = '';
  } else if (pendingResetEmail) {
    state.authView = 'forgot';
    state.pendingReset = { email: pendingResetEmail };
  } else {
    state.authView = 'login';
  }
  renderLoginScreen();
}

function showApp() {
  sessionStorage.removeItem('sevenrh_pending_signup_email');
  sessionStorage.removeItem('sevenrh_pending_reset_email');
  sessionStorage.removeItem('sevenrh_password_recovery_pending');
  Object.assign(state, getInitialViewState());
  document.getElementById('login-root').style.display = 'none';
  document.getElementById('bertolis-root').style.display = 'none';
  document.getElementById('app-shell').style.display = 'flex';
  renderSidebar();
  renderUserMenuButton();
  // Déplace le bouton de thème dans la topbar (à côté de la cloche/l'avatar) : en position fixe, il
  // se superposait à ces icônes et les rendait intouchables (repéré à toutes les largeurs d'écran).
  const themeToggle = document.getElementById('btn-theme-toggle');
  themeToggle.classList.add('theme-toggle-inline');
  document.querySelector('.topbar-user').prepend(themeToggle);
  navigateTo('dashboard');
  handleCheckoutReturn();
  const currentUser = authRepository.getCurrentUser();
  if (currentUser && currentUser.mustChangePassword) openForcedPasswordChangeModal();
}

/** Après une première connexion avec un mot de passe temporaire (voir openCreerCompteConnexionModal
 * / openForcerMotDePasseModal) — aucun bouton pour fermer sans valider (contrairement aux autres
 * modales) : closeModal() n'est jamais appelée tant que le nouveau mot de passe n'est pas accepté. */
function openForcedPasswordChangeModal() {
  const html = `
    <div class="modal modal-small" data-blocking="true">
      <div class="modal-header">
        <h2>Choisissez un nouveau mot de passe</h2>
      </div>
      <form id="forced-password-change-form">
        <div class="modal-body">
          <p class="text-muted">Vous vous êtes connecté avec un mot de passe temporaire — choisissez-en un nouveau avant de continuer.</p>
          <div class="form-field">
            <label for="f-forced-password">Nouveau mot de passe (6 caractères minimum) *</label>
            <div class="password-input-wrapper">
              <input class="input" type="password" id="f-forced-password" minlength="6" required autocomplete="new-password" data-strength-meter="true">
              <button type="button" class="btn-icon password-toggle" data-target="f-forced-password" tabindex="-1" aria-label="Afficher le mot de passe">👁️</button>
            </div>
            <div class="password-strength" id="f-forced-password-strength">
              <div class="password-strength-bar"><span></span><span></span><span></span></div>
              <span class="password-strength-label"></span>
            </div>
          </div>
          <div class="form-field">
            <label for="f-forced-password-confirm">Confirmation *</label>
            <div class="password-input-wrapper">
              <input class="input" type="password" id="f-forced-password-confirm" minlength="6" required autocomplete="new-password" data-match-source="f-forced-password">
              <button type="button" class="btn-icon password-toggle" data-target="f-forced-password-confirm" tabindex="-1" aria-label="Afficher le mot de passe">👁️</button>
            </div>
            <span class="password-match-indicator" id="f-forced-password-confirm-match"></span>
          </div>
          <p class="login-error" role="alert" id="forced-password-error" style="display: none;"></p>
        </div>
        <div class="modal-footer">
          <button type="submit" class="btn btn-primary" style="width: 100%;">Valider</button>
        </div>
      </form>
    </div>
  `;
  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = html;
  modalRoot.classList.add('open');

  document.getElementById('forced-password-change-form').addEventListener('submit', async (evt) => {
    evt.preventDefault();
    const p1 = document.getElementById('f-forced-password').value;
    const p2 = document.getElementById('f-forced-password-confirm').value;
    const errorEl = document.getElementById('forced-password-error');
    if (p1 !== p2) {
      errorEl.textContent = 'Les deux mots de passe ne correspondent pas.';
      errorEl.style.display = 'block';
      return;
    }
    const submitBtn = evt.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Validation...';
    const result = await authRepository.changerMotDePassePremiereConnexion(p1);
    if (!result.success) {
      errorEl.textContent = result.error;
      errorEl.style.display = 'block';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Valider';
      return;
    }
    closeModal();
    showToast('Mot de passe mis à jour.');
  });
}

/** Bandeau persistant app-wide pour les entreprises créées via "Créer mon entreprise" (migration
 * 0012) qui n'ont pas encore souscrit d'offre — pas de blocage total (le Directeur fondateur peut
 * explorer l'app normalement), seul l'ajout d'un 2ᵉ salarié est bloqué par le plafond existant. */
function renderNonSouscritBanner() {
  const banner = document.getElementById('non-souscrit-banner');
  if (!banner) return;
  const company = companyRepository.getCurrent();
  const abonnement = company && company.abonnement;
  if (!abonnement || abonnement.statut !== 'non_souscrit') {
    banner.style.display = 'none';
    banner.innerHTML = '';
    return;
  }
  const canGererAbonnement = hasPermission(authRepository.getCurrentUser(), PERMISSIONS.GERER_ABONNEMENTS);
  banner.style.display = 'flex';
  banner.innerHTML = `
    <span>🔒 Accès d'essai limité à 1 salarié. Souscrivez une offre pour inviter votre équipe.</span>
    ${canGererAbonnement ? `<button type="button" class="btn btn-sm btn-primary" id="btn-banner-abonnement">Voir les offres</button>` : ''}
  `;
  const btn = document.getElementById('btn-banner-abonnement');
  if (btn) btn.addEventListener('click', () => {
    state.parametresTab = 'abonnement';
    navigateTo('parametres');
  });
}

/** Retour depuis Stripe Checkout (voir billing/index.ts, success_url/cancel_url) — le webhook
 * Stripe met déjà à jour l'abonnement en arrière-plan, mais confirmer ici en plus donne un retour
 * immédiat à l'utilisateur sans dépendre du délai (parfois quelques secondes) du webhook. */
function handleCheckoutReturn() {
  const params = new URLSearchParams(window.location.search);
  const checkout = params.get('checkout');
  if (!checkout) return;
  const sessionId = params.get('session_id');
  history.replaceState({}, '', window.location.pathname);

  if (checkout === 'cancel') {
    showToast('Paiement annulé.');
    return;
  }
  if (checkout === 'success' && sessionId) {
    billingRepository.confirm(sessionId).then(async (result) => {
      if (!result.success) {
        showToast('Paiement reçu, mais l\'activation a échoué : ' + (result.error || 'réessayez depuis Paramètres.'), 'error');
        return;
      }
      await DB.restoreSession();
      showToast('Abonnement activé !');
      state.parametresTab = 'abonnement';
      navigateTo('parametres');
    });
  }
}

/** Console BERTOLIS (§9.6, §36) — écran totalement séparé de l'app-shell salarié : pas de sidebar,
 * pas de vues métier, uniquement la liste des entreprises clientes et la gestion des abonnements. */
function showBertolisConsole() {
  document.getElementById('login-root').style.display = 'none';
  document.getElementById('app-shell').style.display = 'none';
  document.getElementById('bertolis-root').style.display = 'block';
  renderBertolisConsole();
}

function renderBertolisConsole() {
  const admin = DB.getCurrentBertolisAdmin();
  const activeTab = state.bertolisTab || 'entreprises';
  const root = document.getElementById('bertolis-root');

  root.innerHTML = `
    <header class="bertolis-topbar">
      <div class="login-logo">${NEXUS_LOGO_MARK} Nexus <span class="badge badge-info">Console BERTOLIS</span></div>
      <div>
        <span class="text-muted">${escapeHtml(admin.prenom)} ${escapeHtml(admin.nom)}</span>
        <button type="button" class="btn btn-secondary btn-sm" id="btn-bertolis-logout" style="margin-left: 10px;">Déconnexion</button>
      </div>
    </header>
    <main class="bertolis-main">
      <div class="tabs">
        <button type="button" class="tab ${activeTab === 'entreprises' ? 'active' : ''}" data-bertolis-tab="entreprises">Entreprises clientes</button>
        <button type="button" class="tab ${activeTab === 'tickets' ? 'active' : ''}" data-bertolis-tab="tickets">Tickets support</button>
      </div>
      <div id="bertolis-tab-content">
        ${activeTab === 'entreprises' ? renderBertolisEntreprisesTab() : renderBertolisTicketsTab()}
      </div>
    </main>
  `;

  document.getElementById('btn-bertolis-logout').addEventListener('click', () => {
    DB.bertolisLogout();
    showLogin();
  });

  document.querySelectorAll('[data-bertolis-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.bertolisTab = btn.dataset.bertolisTab;
      state.bertolisCurrentTicketId = null;
      renderBertolisConsole();
    });
  });

  if (activeTab === 'entreprises') bindBertolisEntreprisesEvents();
  else bindBertolisTicketsEvents();
}

function renderBertolisEntreprisesTab() {
  const companies = DB.getAllCompaniesForBertolis();
  return `
    <div class="view-header">
      <h1>Entreprises clientes</h1>
      <p class="view-subtitle">${companies.length} entreprise${companies.length > 1 ? 's' : ''} · aperçu limité aux métadonnées d'abonnement (§9.6 : aucune donnée RH sensible n'est accessible depuis cette console)</p>
    </div>
    <div class="card table-card">
      <table class="table">
        <thead>
          <tr>
            <th>Entreprise</th>
            <th>Offre</th>
            <th>Statut</th>
            <th>Salariés</th>
            <th>Établissements</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${companies.map(c => {
            const offre = OFFRES_BERTOLIS[c.abonnement.offre] || OFFRES_BERTOLIS.essai;
            const statutBadge = { actif: 'success', impaye: 'warning', suspendu: 'warning', resilie: 'muted', non_souscrit: 'warning' }[c.abonnement.statut] || 'muted';
            return `
              <tr>
                <td>${escapeHtml(c.raisonSociale)}</td>
                <td>${escapeHtml(offre.label)}</td>
                <td><span class="badge badge-${statutBadge}">${escapeHtml(ABONNEMENT_STATUT_LABELS[c.abonnement.statut] || c.abonnement.statut)}</span></td>
                <td>${c.nombreSalaries}${c.abonnement.nombreSalariesMax !== null ? ` / ${c.abonnement.nombreSalariesMax}` : ''}</td>
                <td>${c.nombreEtablissements}</td>
                <td class="table-actions">
                  <select class="input" data-bertolis-statut="${c.id}" style="width: auto;">
                    ${Object.keys(ABONNEMENT_STATUT_LABELS).map(s => `<option value="${s}" ${c.abonnement.statut === s ? 'selected' : ''}>${escapeHtml(ABONNEMENT_STATUT_LABELS[s])}</option>`).join('')}
                  </select>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function bindBertolisEntreprisesEvents() {
  document.querySelectorAll('[data-bertolis-statut]').forEach(select => {
    select.addEventListener('change', (e) => {
      DB.updateCompanyAbonnementStatut(e.target.dataset.bertolisStatut, e.target.value);
      showToast('Statut de l\'abonnement mis à jour.');
      renderBertolisConsole();
    });
  });
}

/** Seul accès de la console BERTOLIS aux tickets support — cross-entreprises, donc jamais via le
 * cache local (qui ne connaît que la/les entreprises déjà visitées dans CE navigateur) : passe par
 * l'Edge Function bertolis-tickets (secret partagé, voir data.js:BERTOLIS_TICKETS_SECRET). Comme
 * rien dans ce projet ne rafraîchit les données en tâche de fond (tout se resynchronise à la
 * connexion), on déclenche ce chargement explicitement au premier affichage de l'onglet, puis à
 * chaque action (changement de statut, réponse) plutôt que de retoucher un cache local à la main. */
function renderBertolisTicketsTab() {
  if (!state.bertolisTicketsData && !state.bertolisTicketsLoading) {
    state.bertolisTicketsLoading = true;
    loadBertolisTickets();
  }
  if (state.bertolisCurrentTicketId && state.bertolisTicketsData && !state.bertolisTicketsData.error) {
    return renderBertolisTicketDetail();
  }
  if (state.bertolisTicketsLoading && !state.bertolisTicketsData) {
    return '<p class="text-muted">Chargement des tickets...</p>';
  }
  if (state.bertolisTicketsData.error) {
    return `<div class="empty-state"><p>Erreur lors du chargement des tickets : ${escapeHtml(state.bertolisTicketsData.error)}</p></div>`;
  }
  const tickets = state.bertolisTicketsData.tickets || [];
  return `
    <div class="view-header">
      <h1>Tickets support</h1>
      <p class="view-subtitle">${tickets.length} ticket${tickets.length > 1 ? 's' : ''} (fermés exclus)</p>
    </div>
    <div class="card table-card">
      <table class="table">
        <thead>
          <tr><th>Entreprise</th><th>Titre</th><th>Statut</th><th>Priorité</th><th>Créé le</th><th></th></tr>
        </thead>
        <tbody>
          ${tickets.length === 0 ? '<tr><td colspan="6" class="text-muted">Aucun ticket.</td></tr>' : tickets.map(t => `
            <tr>
              <td>${escapeHtml((t.companies && t.companies.raison_sociale) || '—')}</td>
              <td>${escapeHtml(t.titre)}</td>
              <td><span class="badge badge-${TICKET_STATUT_BADGE_CLASS[t.statut] || 'muted'}">${escapeHtml(TICKET_STATUT_LABELS[t.statut] || t.statut)}</span></td>
              <td>${escapeHtml(t.priorite)}</td>
              <td>${formatDate(t.created_at)}</td>
              <td class="table-actions"><button type="button" class="btn btn-secondary btn-sm" data-open-bertolis-ticket="${t.id}">Ouvrir</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function loadBertolisTickets() {
  const result = await window.SupabaseSync.invokeBertolisTickets(BERTOLIS_TICKETS_SECRET, 'list', {});
  state.bertolisTicketsLoading = false;
  state.bertolisTicketsData = result.success ? { tickets: result.tickets } : { error: result.error || 'Erreur inconnue.' };
  if (state.bertolisTab === 'tickets') renderBertolisConsole();
}

function renderBertolisTicketDetail() {
  const ticket = (state.bertolisTicketsData.tickets || []).find(t => t.id === state.bertolisCurrentTicketId);
  if (!ticket) return '<p class="text-muted">Ticket introuvable — il a peut-être été fermé.</p><button class="btn-link" id="btn-back-to-bertolis-tickets">← Retour aux tickets</button>';
  const data = ticket.data || {};
  const comments = data.comments || [];
  return `
    <button class="btn-link" id="btn-back-to-bertolis-tickets">← Retour aux tickets</button>
    <div class="view-header view-header-row">
      <div>
        <h1>${escapeHtml(ticket.titre)}</h1>
        <p class="view-subtitle">
          ${escapeHtml((ticket.companies && ticket.companies.raison_sociale) || '—')} · ${escapeHtml(ticket.categorie || '—')} · Priorité ${escapeHtml(ticket.priorite)} · ${formatDateTime(ticket.created_at)}
        </p>
      </div>
      <div class="detail-header-actions">
        <select class="input" id="f-bertolis-ticket-statut" style="width: auto;">
          ${Object.keys(TICKET_STATUT_LABELS).map(s => `<option value="${s}" ${s === ticket.statut ? 'selected' : ''}>${TICKET_STATUT_LABELS[s]}</option>`).join('')}
        </select>
      </div>
    </div>
    ${renderTicketDeliveryBanner(ticket.statut, ticket.date_livraison)}
    ${renderTicketDescriptionAndAi(ticket.description, data.contexte, data.pieceJointe, data.aiAnalysis, true)}
    <div class="card">
      <div class="ticket-thread">
        ${comments.length === 0 ? '<p class="text-muted">Aucune réponse pour le moment.</p>' : comments.map(c => renderTicketComment(c)).join('')}
      </div>
      <form id="bertolis-ticket-comment-form" class="ticket-comment-form">
        <textarea class="input" id="f-bertolis-ticket-comment" rows="2" placeholder="Répondre..." required></textarea>
        <button type="submit" class="btn btn-primary">Envoyer</button>
      </form>
    </div>
    ${renderTicketHistoryTimeline(data.historique)}
  `;
}

function bindBertolisTicketsEvents() {
  document.querySelectorAll('[data-open-bertolis-ticket]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.bertolisCurrentTicketId = btn.dataset.openBertolisTicket;
      renderBertolisConsole();
    });
  });

  const backBtn = document.getElementById('btn-back-to-bertolis-tickets');
  if (backBtn) backBtn.addEventListener('click', () => {
    state.bertolisCurrentTicketId = null;
    renderBertolisConsole();
  });

  const statutSelect = document.getElementById('f-bertolis-ticket-statut');
  if (statutSelect) {
    statutSelect.addEventListener('change', async () => {
      statutSelect.disabled = true;
      const result = await window.SupabaseSync.invokeBertolisTickets(BERTOLIS_TICKETS_SECRET, 'updateStatus', {
        ticketId: state.bertolisCurrentTicketId, statut: statutSelect.value
      });
      if (!result.success) { showToast(result.error || 'Erreur.', 'error'); statutSelect.disabled = false; return; }
      state.bertolisTicketsData = null;
      renderBertolisConsole();
    });
  }

  const commentForm = document.getElementById('bertolis-ticket-comment-form');
  if (commentForm) {
    commentForm.addEventListener('submit', async (evt) => {
      evt.preventDefault();
      const textarea = document.getElementById('f-bertolis-ticket-comment');
      const texte = textarea.value.trim();
      if (!texte) return;
      const submitBtn = commentForm.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      const result = await window.SupabaseSync.invokeBertolisTickets(BERTOLIS_TICKETS_SECRET, 'addComment', {
        ticketId: state.bertolisCurrentTicketId, texte
      });
      submitBtn.disabled = false;
      if (!result.success) { showToast(result.error || 'Erreur.', 'error'); return; }
      state.bertolisTicketsData = null;
      renderBertolisConsole();
    });
  }

  const applyAiBtn = document.getElementById('btn-ticket-apply-ai');
  if (applyAiBtn) {
    applyAiBtn.addEventListener('click', async () => {
      applyAiBtn.disabled = true;
      const result = await window.SupabaseSync.invokeBertolisTickets(BERTOLIS_TICKETS_SECRET, 'applyAiSuggestion', {
        ticketId: state.bertolisCurrentTicketId
      });
      if (!result.success) { showToast(result.error || 'Erreur.', 'error'); applyAiBtn.disabled = false; return; }
      showToast('Suggestion appliquée.');
      state.bertolisTicketsData = null;
      renderBertolisConsole();
    });
  }
}

// ---------------------------------------------------------------------------
// Authentification (simulation navigateur) — connexion, mot de passe oublié,
// changement de mot de passe, menu utilisateur
// ---------------------------------------------------------------------------

function renderLoginScreen() {
  const root = document.getElementById('login-root');

  if (state.authView === 'forgot') {
    root.innerHTML = renderForgotPasswordView();
  } else if (state.authView === 'reset') {
    root.innerHTML = renderResetPasswordView();
  } else if (state.authView === 'signup-company') {
    root.innerHTML = renderSignupCompanyView();
  } else if (state.authView === 'resend-confirmation') {
    root.innerHTML = renderResendConfirmationView();
  } else if (state.authView === 'bertolis') {
    root.innerHTML = renderBertolisLoginView();
  } else {
    root.innerHTML = renderLoginView();
  }

  bindLoginScreenEvents();
}

function renderLoginView() {
  return `
    <div class="login-card">
      <div class="login-logo">${NEXUS_LOGO_MARK} Nexus</div>
      <h1>Connexion</h1>
      <form id="login-form">
        <div class="form-field">
          <label for="f-login-email">Email</label>
          <input class="input" type="email" id="f-login-email" required autocomplete="username">
        </div>
        <div class="form-field">
          <label for="f-login-password">Mot de passe</label>
          <div class="password-input-wrapper">
            <input class="input" type="password" id="f-login-password" required autocomplete="current-password">
            <button type="button" class="btn-icon password-toggle" data-target="f-login-password" tabindex="-1" aria-label="Afficher le mot de passe">👁️</button>
          </div>
        </div>
        ${state.authError ? `<p class="login-error" role="alert">${escapeHtml(state.authError)}</p>` : ''}
        <button type="submit" class="btn btn-primary" id="btn-login-submit" style="width: 100%;">Se connecter</button>
      </form>
      <button type="button" class="btn-link" id="btn-forgot-password">Mot de passe oublié ?</button>
      <button type="button" class="btn-link" id="btn-goto-signup-company">Créer mon entreprise</button>
      <button type="button" class="btn-link" id="btn-goto-resend-confirmation">Vous n'avez pas reçu l'email de confirmation ?</button>

      <button type="button" class="btn-link" id="btn-bertolis-login" style="margin-top: 10px; opacity: 0.6;">🔧 Accès BERTOLIS (éditeur)</button>
    </div>
  `;
}

/** Crée une toute nouvelle entreprise dans Seven RH — voir DB.signUpNewCompany() / migration 0012.
 * Seul point d'entrée d'inscription libre-service (l'ancien "Créer un compte", qui rejoignait une
 * entreprise existante par correspondance de domaine d'email, a été retiré : chaque compte de
 * connexion est désormais créé explicitement par un Directeur/RH depuis la fiche du salarié, voir
 * renderCompteCard/openCreerCompteConnexionModal).
 * L'entreprise démarre en accès restreint (statut "non_souscrit", 1 seul salarié) jusqu'à
 * souscription d'une offre depuis Paramètres → Abonnement. */
function renderSignupCompanyView() {
  if (state.pendingSignupConfirmation) {
    return `
      <div class="login-card">
        <div class="login-logo">${NEXUS_LOGO_MARK} Nexus</div>
        <h1>Créer mon entreprise</h1>
        <p class="text-muted">
          Compte créé pour <strong>${escapeHtml(state.pendingSignupConfirmation)}</strong>.
          Vérifiez votre boîte mail et cliquez sur le lien de confirmation avant de vous connecter.
        </p>
        <button type="button" class="btn-link" id="btn-resend-confirmation">Renvoyer l'email de confirmation</button>
        <button type="button" class="btn-link" id="btn-back-to-login">Retour à la connexion</button>
      </div>
    `;
  }

  return `
    <div class="login-card">
      <div class="login-logo">${NEXUS_LOGO_MARK} Nexus</div>
      <h1>Créer mon entreprise</h1>
      <p class="text-muted">Vous démarrez avec un accès d'essai limité à 1 salarié (vous-même). Souscrivez une offre depuis Paramètres → Abonnement pour ajouter votre équipe.</p>
      <form id="signup-company-form">
        <div class="form-field">
          <label for="f-signup-company-raison-sociale">Nom de l'entreprise</label>
          <input class="input" type="text" id="f-signup-company-raison-sociale" required>
        </div>
        <div class="form-field">
          <label for="f-signup-company-prenom">Votre prénom</label>
          <input class="input" type="text" id="f-signup-company-prenom" required>
        </div>
        <div class="form-field">
          <label for="f-signup-company-nom">Votre nom</label>
          <input class="input" type="text" id="f-signup-company-nom" required>
        </div>
        <div class="form-field">
          <label for="f-signup-company-email">Email</label>
          <input class="input" type="email" id="f-signup-company-email" required autocomplete="username">
        </div>
        <div class="form-field">
          <label for="f-signup-company-password">Mot de passe</label>
          <div class="password-input-wrapper">
            <input class="input" type="password" id="f-signup-company-password" required minlength="6" autocomplete="new-password" data-strength-meter="true">
            <button type="button" class="btn-icon password-toggle" data-target="f-signup-company-password" tabindex="-1" aria-label="Afficher le mot de passe">👁️</button>
          </div>
          <div class="password-strength" id="f-signup-company-password-strength">
            <div class="password-strength-bar"><span></span><span></span><span></span></div>
            <span class="password-strength-label"></span>
          </div>
        </div>
        <div class="form-field">
          <label for="f-signup-company-password-confirm">Confirmation</label>
          <div class="password-input-wrapper">
            <input class="input" type="password" id="f-signup-company-password-confirm" required minlength="6" autocomplete="new-password" data-match-source="f-signup-company-password">
            <button type="button" class="btn-icon password-toggle" data-target="f-signup-company-password-confirm" tabindex="-1" aria-label="Afficher le mot de passe">👁️</button>
          </div>
          <span class="password-match-indicator" id="f-signup-company-password-confirm-match"></span>
        </div>
        ${state.authError ? `<p class="login-error" role="alert">${escapeHtml(state.authError)}</p>` : ''}
        <button type="submit" class="btn btn-primary" id="btn-signup-company-submit" style="width: 100%;">Créer mon entreprise</button>
      </form>
      <button type="button" class="btn-link" id="btn-back-to-login">Retour à la connexion</button>
    </div>
  `;
}

/** Point d'entrée indépendant de l'écran "vérifiez vos emails" (state.pendingSignupConfirmation,
 * éphémère — perdu si l'onglet est fermé ou après 24h, voir PENDING_SIGNUP_TTL_MS) : un vrai client
 * qui n'a jamais reçu son premier email de confirmation (spam, filtre d'entreprise...) et revient
 * sur le site plus tard doit pouvoir redemander l'envoi sans repasser par tout le formulaire
 * d'inscription. Message volontairement générique quel que soit le résultat réel (compte inconnu,
 * déjà confirmé, ou vraiment en attente) — ne révèle jamais si un compte existe pour cette adresse. */
function renderResendConfirmationView() {
  if (state.resendConfirmationSent) {
    return `
      <div class="login-card">
        <div class="login-logo">${NEXUS_LOGO_MARK} Nexus</div>
        <h1>Email de confirmation</h1>
        <p class="text-muted">
          Si un compte en attente de confirmation existe pour <strong>${escapeHtml(state.resendConfirmationSent)}</strong>,
          un nouvel email vient d'être envoyé. Vérifiez votre boîte mail (et les spams).
        </p>
        <button type="button" class="btn-link" id="btn-back-to-login">Retour à la connexion</button>
      </div>
    `;
  }

  return `
    <div class="login-card">
      <div class="login-logo">${NEXUS_LOGO_MARK} Nexus</div>
      <h1>Renvoyer l'email de confirmation</h1>
      <p class="text-muted">Vous vous êtes déjà inscrit mais n'avez jamais reçu l'email de confirmation ? Indiquez votre adresse ci-dessous pour qu'un nouvel envoi soit tenté.</p>
      <form id="resend-confirmation-form">
        <div class="form-field">
          <label for="f-resend-confirmation-email">Email</label>
          <input class="input" type="email" id="f-resend-confirmation-email" required autocomplete="username">
        </div>
        ${state.authError ? `<p class="login-error" role="alert">${escapeHtml(state.authError)}</p>` : ''}
        <button type="submit" class="btn btn-primary" id="btn-resend-confirmation-submit" style="width: 100%;">Renvoyer l'email</button>
      </form>
      <button type="button" class="btn-link" id="btn-back-to-login">Retour à la connexion</button>
    </div>
  `;
}

/** Écran de connexion séparé de celui des salariés d'entreprise (§9.6) — voir
 * DB.bertolisLogin()/showBertolisConsole(). */
function renderBertolisLoginView() {
  return `
    <div class="login-card">
      <div class="login-logo">${NEXUS_LOGO_MARK} Nexus <span class="badge badge-info">BERTOLIS</span></div>
      <h1>Accès éditeur</h1>
      <p class="text-muted">Réservé à l'équipe BERTOLIS — gestion des entreprises clientes et des abonnements (§9.6). Ce n'est pas un compte salarié.</p>
      <form id="bertolis-login-form">
        <div class="form-field">
          <label for="f-bertolis-email">Email</label>
          <input class="input" type="email" id="f-bertolis-email" required autocomplete="username">
        </div>
        <div class="form-field">
          <label for="f-bertolis-password">Mot de passe</label>
          <div class="password-input-wrapper">
            <input class="input" type="password" id="f-bertolis-password" required autocomplete="current-password">
            <button type="button" class="btn-icon password-toggle" data-target="f-bertolis-password" tabindex="-1" aria-label="Afficher le mot de passe">👁️</button>
          </div>
        </div>
        ${state.authError ? `<p class="login-error" role="alert">${escapeHtml(state.authError)}</p>` : ''}
        <button type="submit" class="btn btn-primary" style="width: 100%;">Se connecter</button>
      </form>
      <button type="button" class="btn-link" id="btn-back-to-login">← Retour à la connexion</button>
    </div>
  `;
}

function renderForgotPasswordView() {
  if (state.pendingReset) {
    return `
      <div class="login-card">
        <div class="login-logo">${NEXUS_LOGO_MARK} Nexus</div>
        <h1>Mot de passe oublié</h1>
        <p class="text-muted">
          Si un compte existe pour cet email, un lien de réinitialisation vient de lui être envoyé.
          Ouvrez cet email et cliquez sur le lien pour choisir un nouveau mot de passe.
        </p>
        <button type="button" class="btn-link" id="btn-back-to-login">Retour à la connexion</button>
      </div>
    `;
  }

  return `
    <div class="login-card">
      <div class="login-logo">${NEXUS_LOGO_MARK} Nexus</div>
      <h1>Mot de passe oublié</h1>
      <form id="forgot-password-form">
        <div class="form-field">
          <label for="f-forgot-email">Email</label>
          <input class="input" type="email" id="f-forgot-email" required autocomplete="username">
        </div>
        ${state.authError ? `<p class="login-error" role="alert">${escapeHtml(state.authError)}</p>` : ''}
        <button type="submit" class="btn btn-primary" style="width: 100%;">Envoyer le lien de réinitialisation</button>
      </form>
      <button type="button" class="btn-link" id="btn-back-to-login">Retour à la connexion</button>
    </div>
  `;
}

function renderResetPasswordView() {
  return `
    <div class="login-card">
      <div class="login-logo">${NEXUS_LOGO_MARK} Nexus</div>
      <h1>Nouveau mot de passe</h1>
      <form id="reset-password-form">
        <div class="form-field">
          <label for="f-reset-password">Nouveau mot de passe</label>
          <div class="password-input-wrapper">
            <input class="input" type="password" id="f-reset-password" required minlength="6" data-strength-meter="true">
            <button type="button" class="btn-icon password-toggle" data-target="f-reset-password" tabindex="-1" aria-label="Afficher le mot de passe">👁️</button>
          </div>
          <div class="password-strength" id="f-reset-password-strength">
            <div class="password-strength-bar"><span></span><span></span><span></span></div>
            <span class="password-strength-label"></span>
          </div>
        </div>
        <div class="form-field">
          <label for="f-reset-password-confirm">Confirmation</label>
          <div class="password-input-wrapper">
            <input class="input" type="password" id="f-reset-password-confirm" required minlength="6" data-match-source="f-reset-password">
            <button type="button" class="btn-icon password-toggle" data-target="f-reset-password-confirm" tabindex="-1" aria-label="Afficher le mot de passe">👁️</button>
          </div>
          <span class="password-match-indicator" id="f-reset-password-confirm-match"></span>
        </div>
        ${state.authError ? `<p class="login-error" role="alert">${escapeHtml(state.authError)}</p>` : ''}
        <button type="submit" class="btn btn-primary" style="width: 100%;">Valider</button>
      </form>
      <button type="button" class="btn-link" id="btn-back-to-login">Retour à la connexion</button>
    </div>
  `;
}

function bindLoginScreenEvents() {
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async (evt) => {
      evt.preventDefault();
      const email = document.getElementById('f-login-email').value;
      const password = document.getElementById('f-login-password').value;
      const submitBtn = document.getElementById('btn-login-submit');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Connexion...';
      const result = await authRepository.login(email, password);
      if (!result.success) {
        state.authError = result.error;
        renderLoginScreen();
        return;
      }
      showApp();
    });
  }

  const forgotBtn = document.getElementById('btn-forgot-password');
  if (forgotBtn) forgotBtn.addEventListener('click', () => {
    state.authView = 'forgot';
    state.authError = '';
    state.pendingReset = null;
    renderLoginScreen();
  });

  const bertolisBtn = document.getElementById('btn-bertolis-login');
  if (bertolisBtn) bertolisBtn.addEventListener('click', () => {
    state.authView = 'bertolis';
    state.authError = '';
    renderLoginScreen();
  });

  const bertolisForm = document.getElementById('bertolis-login-form');
  if (bertolisForm) bertolisForm.addEventListener('submit', (evt) => {
    evt.preventDefault();
    const email = document.getElementById('f-bertolis-email').value;
    const password = document.getElementById('f-bertolis-password').value;
    const result = DB.bertolisLogin(email, password);
    if (!result.success) {
      state.authError = result.error;
      renderLoginScreen();
      return;
    }
    showBertolisConsole();
  });

  const resendBtn = document.getElementById('btn-resend-confirmation');
  if (resendBtn) resendBtn.addEventListener('click', async () => {
    resendBtn.disabled = true;
    resendBtn.textContent = 'Envoi...';
    const result = await authRepository.resendSignupConfirmation(state.pendingSignupConfirmation);
    if (result.success) {
      resendBtn.textContent = 'Email renvoyé ✓';
      showToast('Email de confirmation renvoyé.');
    } else {
      resendBtn.textContent = "Renvoyer l'email de confirmation";
      resendBtn.disabled = false;
      showToast(result.error || "Impossible de renvoyer l'email pour le moment.", 'error');
    }
  });

  const backBtn = document.getElementById('btn-back-to-login');
  if (backBtn) backBtn.addEventListener('click', () => {
    state.authView = 'login';
    state.authError = '';
    state.pendingReset = null;
    state.pendingSignupConfirmation = null;
    state.resendConfirmationSent = null;
    sessionStorage.removeItem('sevenrh_pending_signup_email');
    sessionStorage.removeItem('sevenrh_pending_reset_email');
    sessionStorage.removeItem('sevenrh_password_recovery_pending');
    renderLoginScreen();
  });

  const gotoResendConfirmationBtn = document.getElementById('btn-goto-resend-confirmation');
  if (gotoResendConfirmationBtn) gotoResendConfirmationBtn.addEventListener('click', () => {
    state.authView = 'resend-confirmation';
    state.authError = '';
    state.resendConfirmationSent = null;
    renderLoginScreen();
  });

  const resendConfirmationForm = document.getElementById('resend-confirmation-form');
  if (resendConfirmationForm) resendConfirmationForm.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    const email = document.getElementById('f-resend-confirmation-email').value;
    const submitBtn = document.getElementById('btn-resend-confirmation-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Envoi...';
    await authRepository.resendSignupConfirmation(email);
    // Message générique dans tous les cas (voir commentaire de renderResendConfirmationView) : ne
    // révèle jamais si un compte existe, est déjà confirmé, ou vraiment en attente pour cette adresse.
    state.resendConfirmationSent = email;
    state.authError = '';
    renderLoginScreen();
  });

  const gotoSignupCompanyBtn = document.getElementById('btn-goto-signup-company');
  if (gotoSignupCompanyBtn) gotoSignupCompanyBtn.addEventListener('click', () => {
    state.authView = 'signup-company';
    state.authError = '';
    renderLoginScreen();
  });

  const signupCompanyForm = document.getElementById('signup-company-form');
  if (signupCompanyForm) signupCompanyForm.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    const raisonSociale = document.getElementById('f-signup-company-raison-sociale').value;
    const prenom = document.getElementById('f-signup-company-prenom').value;
    const nom = document.getElementById('f-signup-company-nom').value;
    const email = document.getElementById('f-signup-company-email').value;
    const p1 = document.getElementById('f-signup-company-password').value;
    const p2 = document.getElementById('f-signup-company-password-confirm').value;
    if (p1 !== p2) { state.authError = 'Les deux mots de passe ne correspondent pas.'; renderLoginScreen(); return; }
    const submitBtn = document.getElementById('btn-signup-company-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Création...';
    const result = await authRepository.signUpNewCompany(raisonSociale, email, p1, nom, prenom);
    if (!result.success) { state.authError = result.error; renderLoginScreen(); return; }
    if (result.needsEmailConfirmation) {
      state.pendingSignupConfirmation = email;
      state.authError = '';
      setPendingSignupEmail(email, 'signup-company');
      renderLoginScreen();
      return;
    }
    showApp();
  });

  const forgotForm = document.getElementById('forgot-password-form');
  if (forgotForm) forgotForm.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    const email = document.getElementById('f-forgot-email').value;
    const result = await authRepository.requestPasswordReset(email);
    if (!result.success) { state.authError = result.error; renderLoginScreen(); return; }
    state.authError = '';
    state.pendingReset = { email };
    // Même correctif que pour l'inscription : persiste au cas où l'utilisateur change d'appli
    // pour consulter ses emails et que l'onglet recharge en arrière-plan (fréquent sur mobile).
    sessionStorage.setItem('sevenrh_pending_reset_email', email);
    renderLoginScreen();
  });

  const resetForm = document.getElementById('reset-password-form');
  if (resetForm) resetForm.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    const p1 = document.getElementById('f-reset-password').value;
    const p2 = document.getElementById('f-reset-password-confirm').value;
    if (p1 !== p2) { state.authError = 'Les deux mots de passe ne correspondent pas.'; renderLoginScreen(); return; }
    const result = await authRepository.resetPasswordWithToken(null, p1);
    if (!result.success) { state.authError = result.error; renderLoginScreen(); return; }
    state.pendingReset = null;
    sessionStorage.removeItem('sevenrh_pending_reset_email');
    sessionStorage.removeItem('sevenrh_password_recovery_pending');
    state.authView = 'login';
    state.authError = '';
    renderLoginScreen();
    showToast('Mot de passe réinitialisé, vous pouvez vous connecter.');
  });
}

// ---- Menu utilisateur (topbar) : rôle, changement de mot de passe, déconnexion ----

function renderUserMenuButton() {
  const user = authRepository.getCurrentUser();
  const button = document.getElementById('btn-user-menu');
  button.textContent = user ? getInitials(user.prenom, user.nom) : '?';
}

function bindUserMenuEvents() {
  const button = document.getElementById('btn-user-menu');
  const panel = document.getElementById('user-menu-panel');

  button.addEventListener('click', (e) => {
    e.stopPropagation();
    if (panel.classList.contains('open')) { panel.classList.remove('open'); return; }
    renderUserMenuPanel();
    panel.classList.add('open');
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.user-menu-wrapper')) panel.classList.remove('open');
  });
}

function renderUserMenuPanel() {
  const user = authRepository.getCurrentUser();
  const panel = document.getElementById('user-menu-panel');
  if (!user) { panel.innerHTML = ''; return; }

  // "Abonnement" en plus de sa propre entrée de menu (retour utilisateur : toujours pas facile à
  // trouver au fond d'une longue liste) — le menu du compte est l'endroit où la quasi-totalité des
  // SaaS (Stripe lui-même, GitHub, Notion, Slack...) placent la facturation : toujours visible en
  // un clic sur l'avatar, jamais besoin de faire défiler quoi que ce soit.
  const canGererAbonnement = hasPermission(user, PERMISSIONS.GERER_ABONNEMENTS);
  const canGererParametres = ['rh', 'directeur'].includes(user.role) && hasPermission(user, PERMISSIONS.GERER_PARAMETRES);

  panel.innerHTML = `
    <div class="user-menu-header">
      <div class="user-menu-name">${escapeHtml(user.prenom)} ${escapeHtml(user.nom)}</div>
      <span class="badge badge-info">${escapeHtml(ROLE_LABELS[user.role] || user.role)}</span>
    </div>
    ${canGererParametres ? `<button type="button" class="user-menu-item" id="btn-user-menu-parametres">⚙️ Paramètres</button>` : ''}
    ${canGererAbonnement ? `<button type="button" class="user-menu-item" id="btn-user-menu-abonnement">💳 Abonnement</button>` : ''}
    <button type="button" class="user-menu-item" id="btn-user-menu-support">🎫 Aide / Signaler un problème</button>
    <button type="button" class="user-menu-item" id="btn-change-password">Modifier mon mot de passe</button>
    <button type="button" class="user-menu-item" id="btn-export-my-data">Télécharger mes données (RGPD)</button>
    <button type="button" class="user-menu-item" id="btn-logout">Se déconnecter</button>
  `;

  if (canGererParametres) {
    document.getElementById('btn-user-menu-parametres').addEventListener('click', () => {
      document.getElementById('user-menu-panel').classList.remove('open');
      navigateTo('parametres');
    });
  }
  if (canGererAbonnement) {
    document.getElementById('btn-user-menu-abonnement').addEventListener('click', () => {
      document.getElementById('user-menu-panel').classList.remove('open');
      state.parametresTab = 'abonnement';
      navigateTo('parametres');
    });
  }
  document.getElementById('btn-user-menu-support').addEventListener('click', () => {
    document.getElementById('user-menu-panel').classList.remove('open');
    openSupportTicketModal();
  });
  document.getElementById('btn-change-password').addEventListener('click', () => {
    document.getElementById('user-menu-panel').classList.remove('open');
    openChangePasswordModal();
  });
  document.getElementById('btn-export-my-data').addEventListener('click', () => {
    document.getElementById('user-menu-panel').classList.remove('open');
    exportMyDataRGPD();
  });
  document.getElementById('btn-logout').addEventListener('click', () => {
    authRepository.logout();
    showLogin();
  });
}

/** Droit d'accès/portabilité RGPD : export en libre-service de toutes les données personnelles
 * du salarié connecté (sa fiche + ses demandes de congé/télétravail/notes de frais/documents),
 * en format structuré lisible par machine (JSON). Exclut les champs de sécurité (mot de passe,
 * historique de verrouillage, surcharges de permissions) et le contenu binaire des pièces jointes
 * (juste leur nom) pour garder l'export lisible — ce ne sont pas des données que l'export RGPD
 * doit exposer ou qui apportent une valeur dans ce format. */
function exportMyDataRGPD() {
  const user = authRepository.getCurrentUser();
  const employee = user ? employeeRepository.getById(user.id) : null;
  if (!employee) {
    showToast('Impossible de charger vos données pour le moment. Réessayez dans un instant.', 'error');
    return;
  }
  const { motDePasse, resetToken, tentativesEchouees, verrouille, permissionsOverrides, ...salarie } = employee;

  const data = {
    exportGenereLe: formatDateTime(new Date().toISOString()),
    salarie,
    conges: leaveRepository.getForEmployee(user.id),
    teletravail: teleworkRepository.getForEmployee(user.id),
    notesDeFrais: expenseRepository.getForEmployee(user.id).map(({ justificatif, ...n }) => n),
    documents: documentRepository.getForEmployee(user.id).map(d => ({
      categorie: d.categorie, nom: d.nom, dateExpiration: d.dateExpiration,
      fichierJoint: d.fichier ? d.fichier.nom : null
    })),
    // Sprint SIRH premium §10 : les brouillons de demandes sont aussi des données personnelles
    // (l'utilisateur les a saisies, même si jamais envoyées) — même exclusion du contenu binaire de
    // la pièce jointe (juste son nom) que pour les notes de frais/documents ci-dessus.
    brouillons: draftRepository.getForOwner(user.id).map(b => ({
      type: b.type,
      champs: b.champs && b.champs.justificatif ? { ...b.champs, justificatif: b.champs.justificatif.nom } : b.champs,
      dateCreation: b.dateCreation,
      dateModification: b.dateModification
    }))
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mes-donnees-${employee.matricule || employee.id}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  auditLogRepository.logAudit('Export', 'Données personnelles (RGPD)', `${employee.prenom} ${employee.nom} (auto-export)`);
  showToast('Vos données ont été téléchargées.');
}

function openChangePasswordModal() {
  const html = `
    <div class="modal modal-small">
      <div class="modal-header">
        <h2>Modifier mon mot de passe</h2>
        <button class="btn-icon" id="btn-close-modal" aria-label="Fermer" title="Fermer">✕</button>
      </div>
      <form id="change-password-form">
        <div class="modal-body">
          <div class="form-field">
            <label for="f-current-password">Mot de passe actuel</label>
            <div class="password-input-wrapper">
              <input class="input" type="password" id="f-current-password" required>
              <button type="button" class="btn-icon password-toggle" data-target="f-current-password" tabindex="-1" aria-label="Afficher le mot de passe">👁️</button>
            </div>
          </div>
          <div class="form-field" style="margin-top: 12px;">
            <label for="f-new-password">Nouveau mot de passe</label>
            <div class="password-input-wrapper">
              <input class="input" type="password" id="f-new-password" required minlength="6" data-strength-meter="true">
              <button type="button" class="btn-icon password-toggle" data-target="f-new-password" tabindex="-1" aria-label="Afficher le mot de passe">👁️</button>
            </div>
            <div class="password-strength" id="f-new-password-strength">
              <div class="password-strength-bar"><span></span><span></span><span></span></div>
              <span class="password-strength-label"></span>
            </div>
          </div>
          <div class="form-field" style="margin-top: 12px;">
            <label for="f-new-password-confirm">Confirmation</label>
            <div class="password-input-wrapper">
              <input class="input" type="password" id="f-new-password-confirm" required minlength="6" data-match-source="f-new-password">
              <button type="button" class="btn-icon password-toggle" data-target="f-new-password-confirm" tabindex="-1" aria-label="Afficher le mot de passe">👁️</button>
            </div>
            <span class="password-match-indicator" id="f-new-password-confirm-match"></span>
          </div>
          <p class="login-error" role="alert" id="change-password-error" style="display: none;"></p>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Annuler</button>
          <button type="submit" class="btn btn-primary">Enregistrer</button>
        </div>
      </form>
    </div>
  `;

  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = html;
  modalRoot.classList.add('open');

  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
  document.getElementById('change-password-form').addEventListener('submit', (evt) => {
    evt.preventDefault();
    const current = document.getElementById('f-current-password').value;
    const p1 = document.getElementById('f-new-password').value;
    const p2 = document.getElementById('f-new-password-confirm').value;
    const errorEl = document.getElementById('change-password-error');

    if (p1 !== p2) {
      errorEl.textContent = 'Les deux mots de passe ne correspondent pas.';
      errorEl.style.display = 'block';
      return;
    }
    const result = authRepository.changePassword(authRepository.getCurrentUser().id, current, p1);
    if (!result.success) {
      errorEl.textContent = result.error;
      errorEl.style.display = 'block';
      return;
    }
    showToast('Mot de passe mis à jour.');
    closeModal();
  });
}

// ---------------------------------------------------------------------------
// Assistant de première installation — création d'une nouvelle entreprise
// ---------------------------------------------------------------------------

const ONBOARDING_STEP_TITLES = ['Entreprise', 'Convention', 'Établissement', 'Organisation', 'Administrateur', 'Résumé'];

function openOnboardingWizard() {
  state.onboarding = {
    step: 1,
    profile: { raisonSociale: '', logo: null, siret: '', tva: '', adresse: '', telephone: '', email: '' },
    conventionCollective: 'Aucune',
    etablissement: { nom: 'Siège', codeInterne: '', adresse: '', codePostal: '', ville: '', pays: 'France', email: '', telephone: '' },
    organisation: { horairesHebdo: 35, teletravailQuotaSemaine: 2, ticketsValeurFaciale: 9, ticketsPartEmployeurPct: 60 },
    admin: { prenom: '', nom: '', email: '', motDePasse: '' }
  };
  renderOnboardingWizard();
}

function renderOnboardingWizard() {
  const step = state.onboarding.step;
  const stepContent = step === 1 ? renderOnboardingStep1()
    : step === 2 ? renderOnboardingStep2()
    : step === 3 ? renderOnboardingStepEtablissement()
    : step === 4 ? renderOnboardingStep3()
    : step === 5 ? renderOnboardingStep4()
    : renderOnboardingStep5();

  const html = `
    <div class="modal modal-large">
      <div class="modal-header">
        <h2>Nouvelle entreprise</h2>
        <button class="btn-icon" id="btn-close-modal" aria-label="Fermer" title="Fermer">✕</button>
      </div>
      <div class="modal-body">
        <div class="onboarding-steps">
          ${ONBOARDING_STEP_TITLES.map((title, i) => `
            <div class="onboarding-step ${i + 1 === step ? 'active' : i + 1 < step ? 'done' : ''}">
              <span class="onboarding-step-dot">${i + 1 < step ? '✓' : i + 1}</span>
              <span class="onboarding-step-label">${escapeHtml(title)}</span>
            </div>
          `).join('')}
        </div>
        <h3>Étape ${step} — ${escapeHtml(ONBOARDING_STEP_TITLES[step - 1])}</h3>
        ${stepContent}
        <p class="login-error" role="alert" id="onboarding-error" style="display: none;"></p>
      </div>
      <div class="modal-footer">
        ${step > 1 ? '<button type="button" class="btn btn-secondary" id="btn-onboarding-back">← Précédent</button>' : '<button type="button" class="btn btn-secondary" id="btn-cancel-modal">Annuler</button>'}
        ${step < 6 ? '<button type="button" class="btn btn-primary" id="btn-onboarding-next">Suivant →</button>' : '<button type="button" class="btn btn-primary" id="btn-onboarding-finish">Créer l\'entreprise</button>'}
      </div>
    </div>
  `;

  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = html;
  modalRoot.classList.add('open');
  bindOnboardingWizardEvents();
}

function renderOnboardingStep1() {
  const p = state.onboarding.profile;
  return `
    <div class="form-grid">
      ${companyNameAutocompleteField('ob-raisonSociale', 'Raison sociale', p.raisonSociale, true, 'ob-siret', 'ob-adresse')}
      <div class="form-field">
        <label for="f-ob-siret">SIRET</label>
        <input class="input" type="text" id="f-ob-siret" name="ob-siret" value="${escapeHtml(p.siret || '')}"
          data-siret-autocomplete="true" data-fill-raison="f-ob-raisonSociale" data-fill-adresse="f-ob-adresse">
        <span class="field-hint-computed" id="f-ob-siret-hint"></span>
      </div>
      ${textField('ob-tva', 'N° TVA intracommunautaire', p.tva)}
      ${textField('ob-adresse', 'Adresse', p.adresse)}
      ${textField('ob-telephone', 'Téléphone', p.telephone)}
      ${textField('ob-email', 'Email', p.email, true, 'email')}
    </div>
  `;
}

function renderOnboardingStep2() {
  return `
    <div class="form-grid">
      ${selectField('ob-convention', 'Convention collective', DEFAULT_SETTINGS.conventionsCollectives, state.onboarding.conventionCollective)}
    </div>
  `;
}

function renderOnboardingStepEtablissement() {
  const e = state.onboarding.etablissement;
  return `
    <p class="text-muted">Cet établissement sera créé comme établissement principal — vous pourrez en ajouter d'autres ensuite depuis Paramètres.</p>
    <div class="form-grid">
      ${textField('ob-etab-nom', 'Nom', e.nom, true)}
      ${textField('ob-etab-code', 'Code interne', e.codeInterne)}
      ${addressAutocompleteField('ob-etab-adresse', 'Adresse', e.adresse, 'ob-etab-cp', 'ob-etab-ville')}
      ${textField('ob-etab-cp', 'Code postal', e.codePostal)}
      ${textField('ob-etab-ville', 'Ville', e.ville)}
      ${textField('ob-etab-pays', 'Pays', e.pays)}
      ${textField('ob-etab-email', 'Email', e.email, false, 'email')}
      ${textField('ob-etab-telephone', 'Téléphone', e.telephone)}
    </div>
  `;
}

function renderOnboardingStep3() {
  const o = state.onboarding.organisation;
  return `
    <div class="form-grid">
      ${textField('ob-horaires', 'Horaires hebdomadaires par défaut (h)', o.horairesHebdo, false, 'number')}
      ${textField('ob-teletravail-quota', 'Quota télétravail (jours / semaine)', o.teletravailQuotaSemaine, false, 'number')}
      ${textField('ob-tickets-valeur', 'Valeur faciale ticket restaurant (€)', o.ticketsValeurFaciale, false, 'number')}
      ${textField('ob-tickets-part', 'Part employeur tickets (%)', o.ticketsPartEmployeurPct, false, 'number')}
    </div>
  `;
}

function renderOnboardingStep4() {
  const a = state.onboarding.admin;
  return `
    <p class="text-muted">Ce compte aura tous les droits sur la nouvelle entreprise (rôle Directeur), pour pouvoir tout configurer ensuite.</p>
    <div class="form-grid">
      ${textField('ob-admin-prenom', 'Prénom', a.prenom, true)}
      ${textField('ob-admin-nom', 'Nom', a.nom, true)}
      ${textField('ob-admin-email', 'Email', a.email, true, 'email')}
      ${textField('ob-admin-password', 'Mot de passe', '', true, 'password')}
      ${textField('ob-admin-password-confirm', 'Confirmation', '', true, 'password')}
    </div>
  `;
}

function renderOnboardingStep5() {
  const { profile, conventionCollective, etablissement, organisation, admin } = state.onboarding;
  return `
    ${infoRow('Raison sociale', profile.raisonSociale)}
    ${infoRow('Email entreprise', profile.email)}
    ${infoRow('Convention collective', conventionCollective)}
    ${infoRow('Établissement principal', [etablissement.nom, etablissement.ville].filter(Boolean).join(' · '))}
    ${infoRow('Horaires hebdomadaires', formatNumberFR(organisation.horairesHebdo) + ' h')}
    ${infoRow('Télétravail', formatDurationFR(organisation.teletravailQuotaSemaine) + '/semaine')}
    ${infoRow('Tickets restaurant', `${formatCurrencyFR(organisation.ticketsValeurFaciale)} (${formatPercentFR(organisation.ticketsPartEmployeurPct)} employeur)`)}
    ${infoRow('Administrateur', `${admin.prenom} ${admin.nom} · ${admin.email}`)}
    <p class="text-muted" style="margin-top: 14px;">En créant l'entreprise, vous serez automatiquement connecté avec ce compte administrateur.</p>
  `;
}

/** Lit et valide les champs de l'étape courante dans state.onboarding. Retourne un message d'erreur, ou null si valide. */
function saveCurrentOnboardingStep() {
  const step = state.onboarding.step;

  if (step === 1) {
    const raisonSociale = document.getElementById('f-ob-raisonSociale').value.trim();
    const email = document.getElementById('f-ob-email').value.trim();
    if (!raisonSociale || !email) return 'Raison sociale et email sont obligatoires.';
    state.onboarding.profile = {
      raisonSociale, email,
      siret: document.getElementById('f-ob-siret').value,
      tva: document.getElementById('f-ob-tva').value,
      adresse: document.getElementById('f-ob-adresse').value,
      telephone: document.getElementById('f-ob-telephone').value,
      logo: null
    };
  } else if (step === 2) {
    state.onboarding.conventionCollective = document.getElementById('f-ob-convention').value;
  } else if (step === 3) {
    const nom = document.getElementById('f-ob-etab-nom').value.trim();
    if (!nom) return 'Le nom de l\'établissement est obligatoire.';
    state.onboarding.etablissement = {
      nom,
      codeInterne: document.getElementById('f-ob-etab-code').value,
      adresse: document.getElementById('f-ob-etab-adresse').value,
      codePostal: document.getElementById('f-ob-etab-cp').value,
      ville: document.getElementById('f-ob-etab-ville').value,
      pays: document.getElementById('f-ob-etab-pays').value,
      email: document.getElementById('f-ob-etab-email').value,
      telephone: document.getElementById('f-ob-etab-telephone').value
    };
  } else if (step === 4) {
    state.onboarding.organisation = {
      horairesHebdo: Number(document.getElementById('f-ob-horaires').value) || 35,
      teletravailQuotaSemaine: Number(document.getElementById('f-ob-teletravail-quota').value) || 0,
      ticketsValeurFaciale: Number(document.getElementById('f-ob-tickets-valeur').value) || 0,
      ticketsPartEmployeurPct: Number(document.getElementById('f-ob-tickets-part').value) || 0
    };
  } else if (step === 5) {
    const prenom = document.getElementById('f-ob-admin-prenom').value.trim();
    const nom = document.getElementById('f-ob-admin-nom').value.trim();
    const email = document.getElementById('f-ob-admin-email').value.trim();
    const password = document.getElementById('f-ob-admin-password').value;
    const confirm = document.getElementById('f-ob-admin-password-confirm').value;
    if (!prenom || !nom || !email || !password) return 'Tous les champs sont obligatoires.';
    if (password !== confirm) return 'Les mots de passe ne correspondent pas.';
    if (password.length < 6) return 'Le mot de passe doit contenir au moins 6 caractères.';
    state.onboarding.admin = { prenom, nom, email, motDePasse: password };
  }

  return null;
}

function bindOnboardingWizardEvents() {
  const closeBtn = document.getElementById('btn-close-modal');
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  const cancelBtn = document.getElementById('btn-cancel-modal');
  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

  const backBtn = document.getElementById('btn-onboarding-back');
  if (backBtn) backBtn.addEventListener('click', () => {
    state.onboarding.step -= 1;
    renderOnboardingWizard();
  });

  const nextBtn = document.getElementById('btn-onboarding-next');
  if (nextBtn) nextBtn.addEventListener('click', () => {
    const error = saveCurrentOnboardingStep();
    if (error) {
      const errorEl = document.getElementById('onboarding-error');
      errorEl.textContent = error;
      errorEl.style.display = 'block';
      return;
    }
    state.onboarding.step += 1;
    renderOnboardingWizard();
  });

  const finishBtn = document.getElementById('btn-onboarding-finish');
  if (finishBtn) finishBtn.addEventListener('click', () => {
    const { profile, conventionCollective, etablissement, organisation, admin } = state.onboarding;
    companyRepository.createFromOnboarding({ profile, conventionCollective, etablissement, organisation, admin });
    closeModal();
    authRepository.login(admin.email, admin.motDePasse);
    showApp();
    showToast(`Entreprise "${profile.raisonSociale}" créée avec succès.`);
  });
}

/** Sprint SIRH premium §12 : Centre d'aide contextuel — une entrée par écran (clé = state.view,
 * mêmes clés que NAV_ITEMS), 3 parties comme demandé (explication ; FAQ ; bonnes pratiques),
 * décrivant CE QUI EST RÉELLEMENT construit sur cet écran plutôt qu'une doc générique. Pas
 * d'entrée par rôle : le contenu est le même pour tout le monde, chacun ne voit de toute façon que
 * les écrans auxquels il a accès. `faq`/`bonnesPratiques` optionnels (pas tous les écrans n'ont
 * matière à FAQ/conseils utiles) — openHelpModal() masque une section vide plutôt que d'afficher un
 * titre suivi de rien. */
const HELP_CONTENT = {
  dashboard: {
    title: 'Accueil',
    body: `<p>Vue d'ensemble adaptée à votre rôle. Manager/RH/Directeur voient un <strong>Centre d'action</strong> (demandes à valider, anomalies de paie, contrats à échéance — cliquez une ligne pour aller directement au bon écran, filtré) et des indicateurs/graphiques. Un salarié voit son statut du jour, ses soldes de congés et ses demandes en cours.</p>
           <p>Le bouton <strong>🧩 Personnaliser</strong> permet de masquer les blocs qui ne vous intéressent pas — le réglage est propre à votre compte.</p>`,
    faq: [
      { q: 'Un bloc masqué est-il perdu ?', r: 'Non, "Personnaliser" ne fait que le masquer sur votre compte — aucune donnée n\'est supprimée, et vous pouvez le réafficher à tout moment.' },
      { q: 'Pourquoi je ne vois pas le Centre d\'action ?', r: 'Il n\'apparaît que pour les rôles Manager/RH/Directeur, et seulement s\'il y a au moins un élément à signaler (aucun bruit si tout est à jour).' }
    ],
    bonnesPratiques: ['Passez par le Centre d\'action plutôt que par la recherche pour traiter vos demandes en attente — les filtres sont déjà appliqués.', 'Consultez la Préparation de paie depuis son raccourci ici avant chaque export, pas seulement le jour de la paie.']
  },
  employees: {
    title: 'Salariés',
    body: `<p>Liste des salariés visibles selon votre périmètre (toute l'entreprise pour RH/Directeur, votre équipe pour un manager). Filtrez par établissement/service/statut, cliquez une ligne pour ouvrir la fiche complète (coordonnées, contrat, documents, compteurs de congés, historique).</p>`,
    faq: [{ q: 'Pourquoi certains salariés n\'apparaissent pas ?', r: 'Un manager ne voit que son équipe. Un salarié archivé n\'apparaît plus par défaut — utilisez le filtre de statut pour le retrouver.' }],
    bonnesPratiques: ['Utilisez les filtres établissement/service avant de chercher un nom : la liste peut être longue sur une grande entreprise.']
  },
  organigramme: {
    title: 'Organigramme',
    body: `<p>Arbre hiérarchique basé sur les rattachements managers de chaque salarié. Filtrez par établissement/service/équipe, repliez/dépliez les branches, cliquez une personne pour ouvrir sa fiche.</p>`,
    faq: [{ q: 'Un salarié apparaît au mauvais endroit ?', r: 'L\'arbre suit strictement le champ "Manager(s)" de la fiche salarié — corrigez-le depuis sa fiche, l\'organigramme se met à jour automatiquement.' }]
  },
  absences: {
    title: 'Congés & absences',
    body: `<p>3 onglets : <strong>Congés</strong> (congés payés, RTT, ancienneté...), <strong>Absences</strong> (maladie, événements familiaux, et tout autre type paramétrable), <strong>Télétravail</strong> (demandes + planning hebdomadaire). Dans Congés/Absences, créez une demande (+ Nouvelle demande), suivez/validez celles de votre équipe. Un brouillon en cours (bouton "Enregistrer comme brouillon") apparaît dans "Mes brouillons" et peut être repris plus tard. Chaque ligne a un bouton <strong>Historique</strong> qui retrace création/validations/rectifications.</p>
           <p>La gestion des <strong>types</strong> (congés payés, RTT, maladie...) — règles d'acquisition, workflow de validation, justificatif obligatoire — se fait désormais uniquement dans Paramètres > Types d'absences.</p>`,
    faq: [
      { q: 'Pourquoi je ne peux pas créer un congé dans le passé ?', r: 'Un salarié ne peut jamais saisir/modifier une période déjà passée — seuls Manager/RH/Directeur le peuvent, pour garder une trace fiable de qui a autorisé quoi.' },
      { q: 'Comment corriger une demande déjà validée ?', r: 'Utilisez "Régulariser" sur la ligne concernée plutôt que de l\'annuler puis recréer — l\'historique garde la trace de la correction et le motif.' },
      { q: 'Un salarié ne voit pas un type dans son formulaire ?', r: 'Vérifiez l\'onglet "Types d\'absences" de sa fiche — un type peut être désactivé individuellement même s\'il est actif pour l\'entreprise.' },
      { q: 'Le quota de télétravail semble faux ?', r: 'Il se recalcule par semaine ISO (lundi à dimanche) en cumulant toutes les demandes Validées/En attente de cette semaine, pas seulement la demande en cours de saisie.' }
    ],
    bonnesPratiques: ['Enregistrez en brouillon dès que les dates ne sont pas encore certaines, plutôt que d\'attendre d\'avoir toutes les informations pour ouvrir le formulaire.', 'Vérifiez le solde affiché dans le formulaire avant de valider une demande d\'équipe — un compteur négatif remontera de toute façon en Préparation de paie.', 'Cochez "Justificatif obligatoire" sur les types qui légalement en exigent un (arrêt maladie...) — cela remonte comme anomalie en Préparation de paie si oublié.']
  },
  calendrier: {
    title: 'Calendrier',
    body: `<p>Bascule <strong>Mon calendrier</strong> / <strong>Calendrier équipe</strong> (visible si vous encadrez une équipe). Les congés/absences/télétravail validés s'affichent avec leur icône de type ; les demandes encore en attente apparaissent en semi-transparent avec un badge distinct. Cliquez un jour pour voir le détail complet (qui, quel type, statut).</p>`,
    faq: [{ q: 'Quelle différence avec le Planning ?', r: 'Le Calendrier est une vue mensuelle classique (comme un agenda) ; le Planning affiche les salariés en lignes/jours en colonnes, pour comparer rapidement toute une équipe et corriger par glisser-déposer.' }]
  },
  planning: {
    title: 'Planning',
    body: `<p>4 vues : <strong>Semaine/Mois</strong> (qui est absent, par jour, groupé par service — une case de congé/télétravail validé se glisse-dépose vers un autre jour du même salarié pour déplacer toute la période), <strong>Année</strong> (total de jours validés par salarié/mois) et <strong>Horaires</strong> (heures de travail réelles par salarié — matin/après-midi, modifiables sur la fiche salarié, cliquez une case pour ajuster un jour précis). Bascule <strong>Mon planning</strong> / <strong>Planning équipe</strong> en haut d'écran.</p>`,
    faq: [
      { q: 'Pourquoi je ne peux pas glisser une case ?', r: 'Seule une case de congé/télétravail déjà VALIDÉ peut être déplacée — une demande en attente doit d\'abord être validée.' },
      { q: 'Le glisser-déposer est refusé, pourquoi ?', r: 'Les mêmes règles qu\'à la création s\'appliquent (chevauchement, quota télétravail hebdomadaire, période contractuelle) — le message affiché indique la règle précise en cause.' }
    ],
    bonnesPratiques: ['Utilisez la vue Mois pour repérer un déséquilibre de service en un coup d\'œil, puis la vue Semaine pour ajuster au jour près.']
  },
  frais: {
    title: 'Notes de frais',
    body: `<p>Créez une note (standard avec justificatif, ou kilométrique avec calcul automatique de l'indemnité selon distance/puissance fiscale). Le workflow de validation est paramétrable (Paramètres). Le total remboursé du mois alimente automatiquement l'export paie.</p>`,
    faq: [{ q: 'Comment fonctionne le calcul kilométrique ?', r: 'Indiquez la distance et la puissance fiscale du véhicule : le montant est calculé automatiquement selon le barème, vous n\'avez rien à saisir manuellement.' }],
    bonnesPratiques: ['Joignez toujours le justificatif dès la création de la note — une note validée sans justificatif ressort comme anomalie avant l\'export de paie.']
  },
  'mes-documents': {
    title: 'Mes documents',
    body: `<p>Vos documents personnels déposés par RH (contrat, avenants, attestations...) et l'export RGPD de vos données personnelles, en libre-service.</p>`,
    faq: [{ q: 'Un document semble manquant ?', r: 'Seuls les documents que RH a explicitement partagés avec vous apparaissent ici — contactez RH s\'il en manque un.' }]
  },
  tickets: {
    title: 'Tickets restaurant',
    body: `<p>Calcul automatique du nombre de tickets par salarié selon ses jours travaillés du mois, déduction faite des congés/télétravail validés. Un ajustement manuel ponctuel reste possible par salarié si besoin.</p>`,
    faq: [{ q: 'Pourquoi le nombre semble faux pour un salarié ?', r: 'Vérifiez ses jours travaillés (fiche salarié) et ses congés/télétravail validés du mois — le calcul se base uniquement sur ces deux éléments, pas sur une saisie manuelle.' }]
  },
  'export-paie': {
    title: 'Préparation de paie',
    body: `<p>Onglet <strong>Préparation &amp; anomalies</strong> (à consulter avant tout export) : signale les soldes négatifs, dates hors période contractuelle, justificatifs manquants, données administratives incomplètes et fins de contrat du mois, classés Bloquantes/Avertissements/Informations, avec un récapitulatif par salarié (Congés payés/RTT/Maladie/Télétravail/Notes de frais/<strong>Variables</strong>/Tickets restaurant — le bouton ✎ sur la colonne Variables permet de saisir une prime ou un autre élément ponctuel du mois).</p>
           <p>Onglet <strong>Export CSV</strong> : génère le fichier consolidé (congés, télétravail, tickets, notes de frais, variables) au format de votre logiciel de paie.</p>`,
    faq: [
      { q: 'Une anomalie "Bloquante" empêche-t-elle l\'export ?', r: 'Non, le bouton "Exporter CSV" reste actif volontairement (un blocage technique dur serait risqué un jour de paie) — mais une anomalie bloquante doit être corrigée avant de considérer l\'export fiable.' },
      { q: 'Que signifie "comptabilisé dans les congés" pour un type ?', r: 'Défini sur le type dans Paramètres > Types d\'absences (case "Déduire du compteur RTT/CP") : les jours de ce type viennent en plus s\'imputer sur le compteur RTT ou congés payés du salarié.' },
      { q: 'D\'où viennent les "Variables" ?', r: 'Aucun module ne les calcule automatiquement (primes, heures supplémentaires...) — saisissez le montant du mois via le bouton ✎ sur la colonne Variables du récapitulatif.' }
    ],
    bonnesPratiques: ['Ouvrez cet écran systématiquement avant l\'export, pas seulement quand une anomalie est suspectée — l\'onglet par défaut est volontairement "Préparation" et non "Export".']
  },
  parametres: {
    title: 'Paramètres',
    body: `<p>Configuration de l'entreprise : établissements, services &amp; équipes, <strong>types d'absences</strong> (créer/modifier/désactiver un type, justificatif obligatoire, comptabilisation sur le compteur RTT/congés payés — même écran que l'onglet "Types" de Congés/Autres absences), listes de référence (postes, catégories de frais...), vacances scolaires, jours fériés, et le journal d'audit si vous y avez accès.</p>`,
    faq: [{ q: 'Un salarié voit un type d\'absence que je viens de désactiver ?', r: 'La désactivation empêche les NOUVELLES demandes sur ce type mais préserve l\'historique des demandes déjà créées — normal, ce n\'est pas un bug.' }],
    bonnesPratiques: ['Désactivez un type plutôt que de le supprimer si des demandes existantes s\'y réfèrent encore — la suppression est destinée aux types jamais utilisés.']
  }
};

function openHelpModal() {
  const help = HELP_CONTENT[state.view] || { title: 'Aide', body: '<p class="text-muted">Aucune aide spécifique n\'est disponible pour cet écran.</p>' };
  const faqSection = help.faq && help.faq.length ? `
    <div class="help-section">
      <div class="search-section-label" style="padding-left: 0;">FAQ</div>
      ${help.faq.map(item => `<p><strong>${escapeHtml(item.q)}</strong><br>${escapeHtml(item.r)}</p>`).join('')}
    </div>
  ` : '';
  const bonnesPratiquesSection = help.bonnesPratiques && help.bonnesPratiques.length ? `
    <div class="help-section">
      <div class="search-section-label" style="padding-left: 0;">Bonnes pratiques</div>
      <ul class="help-tips">${help.bonnesPratiques.map(tip => `<li>${escapeHtml(tip)}</li>`).join('')}</ul>
    </div>
  ` : '';
  const html = `
    <div class="modal modal-small">
      <div class="modal-header">
        <h2>❓ ${escapeHtml(help.title)}</h2>
        <button class="btn-icon" id="btn-close-modal" aria-label="Fermer" title="Fermer">✕</button>
      </div>
      <div class="modal-body">${help.body}${faqSection}${bonnesPratiquesSection}</div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Fermer</button>
      </div>
    </div>
  `;
  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = html;
  modalRoot.classList.add('open');
  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
}

function bindGlobalEvents() {
  document.getElementById('btn-help').addEventListener('click', openHelpModal);

  const modalRoot = document.getElementById('modal-root');
  // Une modale marquée data-blocking (ex. changement de mot de passe obligatoire) ne doit pouvoir
  // se fermer QUE via son propre bouton de validation — ni le clic sur le fond sombre, ni Échap.
  modalRoot.addEventListener('click', (e) => {
    if (e.target.id === 'modal-root' && !modalRoot.querySelector('.modal[data-blocking]')) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modalRoot.querySelector('.modal[data-blocking]')) closeModal();
  });

  // Bouton "œil" — bascule l'affichage en clair de n'importe quel champ mot de passe marqué
  // .password-toggle (délégué une seule fois ici : ces champs apparaissent dans des vues/modales
  // qui se réécrivent entièrement à chaque rendu, pas la peine de re-lier à chaque fois).
  document.addEventListener('click', (e) => {
    const toggle = e.target.closest('.password-toggle');
    if (!toggle) return;
    const input = document.getElementById(toggle.dataset.target);
    if (!input) return;
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    toggle.textContent = showing ? '👁️' : '🙈';
    toggle.setAttribute('aria-label', showing ? 'Afficher le mot de passe' : 'Masquer le mot de passe');
  });

  // Indicateur vert/rouge sous un champ de confirmation (data-match-source pointe vers le champ
  // "mot de passe" à comparer) — recalculé à chaque frappe sur l'un OU l'autre des deux champs.
  document.addEventListener('input', (e) => {
    const id = e.target.id;
    if (!id) return;
    const isConfirmField = e.target.hasAttribute('data-match-source');
    const isSourceField = !isConfirmField && !!document.querySelector(`[data-match-source="${id}"]`);
    if (!isConfirmField && !isSourceField) return;
    document.querySelectorAll('[data-match-source]').forEach(confirmInput => {
      const sourceInput = document.getElementById(confirmInput.dataset.matchSource);
      const indicator = document.getElementById(confirmInput.id + '-match');
      if (!sourceInput || !indicator) return;
      if (!confirmInput.value) { indicator.className = 'password-match-indicator'; indicator.textContent = ''; return; }
      const match = sourceInput.value === confirmInput.value;
      indicator.textContent = match ? '✓ Les mots de passe correspondent' : '✕ Les mots de passe sont différents';
      indicator.className = 'password-match-indicator ' + (match ? 'match-ok' : 'match-bad');
    });
  });

  // Jauge de force (data-strength-meter) sur les champs "nouveau mot de passe" uniquement — jamais
  // sur un mot de passe déjà existant (connexion), qui n'a plus de sens à évaluer.
  document.addEventListener('input', (e) => {
    if (!e.target.hasAttribute('data-strength-meter')) return;
    const meter = document.getElementById(e.target.id + '-strength');
    if (!meter) return;
    const result = computePasswordStrengthLevel(e.target.value);
    if (!result) {
      meter.style.display = 'none';
      meter.className = 'password-strength';
      return;
    }
    meter.style.display = 'flex';
    meter.className = 'password-strength level-' + result.level;
    meter.querySelector('.password-strength-label').textContent = result.label;
  });

  // Autocomplétion d'adresse (API Adresse gouv.fr) — délégué une seule fois ici, comme les
  // gestionnaires mot de passe ci-dessus, car ces champs vivent dans des formulaires/modales
  // entièrement réécrits à chaque ouverture.
  let addressAutocompleteTimer = null;
  document.addEventListener('input', (e) => {
    if (!e.target.hasAttribute('data-address-autocomplete')) return;
    const input = e.target;
    const suggestionsEl = document.getElementById(input.id + '-suggestions');
    if (!suggestionsEl) return;
    clearTimeout(addressAutocompleteTimer);
    const query = input.value.trim();
    if (query.length < 3) {
      suggestionsEl.style.display = 'none';
      suggestionsEl.innerHTML = '';
      return;
    }
    addressAutocompleteTimer = setTimeout(async () => {
      let data;
      try {
        const res = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&limit=5`);
        data = await res.json();
      } catch {
        // Silencieux : l'autocomplétion n'est qu'un confort, la saisie manuelle reste toujours
        // possible si l'API est indisponible (réseau, panne côté gouv.fr...).
        return;
      }
      const features = data?.features || [];
      if (!features.length) {
        suggestionsEl.style.display = 'none';
        suggestionsEl.innerHTML = '';
        return;
      }
      suggestionsEl._features = features;
      suggestionsEl.innerHTML = features
        .map((f, i) => `<div class="address-suggestion-item" data-index="${i}">${escapeHtml(f.properties.label)}</div>`)
        .join('');
      suggestionsEl.style.display = 'block';
    }, 300);
  });

  document.addEventListener('click', (e) => {
    const item = e.target.closest('.address-suggestion-item');
    if (item) {
      const suggestionsEl = item.parentElement;
      const feature = suggestionsEl._features?.[Number(item.dataset.index)];
      const input = document.getElementById(suggestionsEl.id.replace(/-suggestions$/, ''));
      if (feature && input) {
        input.value = feature.properties.name || feature.properties.label;
        const cpField = document.getElementById(input.dataset.fillCodepostal);
        const villeField = document.getElementById(input.dataset.fillVille);
        if (cpField) cpField.value = feature.properties.postcode || '';
        if (villeField) villeField.value = feature.properties.city || '';
      }
      suggestionsEl.style.display = 'none';
      suggestionsEl.innerHTML = '';
      return;
    }
    // Clic ailleurs que dans un champ d'adresse : referme toute liste de suggestions ouverte.
    if (!e.target.closest('.address-autocomplete-field')) {
      document.querySelectorAll('.address-suggestions').forEach(el => { el.style.display = 'none'; });
    }
  });

  // Surligne en rouge tout champ obligatoire resté vide/invalide après une tentative de
  // soumission — l'événement "invalid" (déclenché par le navigateur juste avant de bloquer un
  // submit HTML5 classique) ne remonte pas (bubble) par défaut, d'où la phase de capture ci-dessous
  // plutôt qu'un simple addEventListener('input'...). Se retire dès que le champ est corrigé.
  document.addEventListener('invalid', (e) => {
    if (e.target.classList && e.target.classList.contains('input')) e.target.classList.add('field-invalid');
  }, true);
  document.addEventListener('input', (e) => {
    if (e.target.classList && e.target.classList.contains('field-invalid') && e.target.checkValidity()) {
      e.target.classList.remove('field-invalid');
    }
  });

  // Âge / ancienneté calculés en direct sous les champs de date correspondants — évite d'avoir à
  // ouvrir la fiche imprimable juste pour voir un chiffre qu'on peut calculer soi-même à la volée.
  document.addEventListener('input', (e) => {
    if (e.target.hasAttribute('data-live-age')) {
      const hint = document.getElementById(e.target.id + '-age');
      if (!hint) return;
      const age = calculateAge(e.target.value);
      hint.textContent = age !== null ? `${age} an${age > 1 ? 's' : ''}` : '';
    }
    if (e.target.hasAttribute('data-live-anciennete')) {
      const hint = document.getElementById(e.target.id + '-anciennete');
      if (!hint) return;
      const anciennete = calculateAnciennete(e.target.value);
      hint.textContent = anciennete && anciennete !== '—' ? `Ancienneté : ${anciennete}` : '';
    }
  });

  // Détection en direct d'un email déjà utilisé par un autre salarié de l'entreprise (plutôt que
  // de laisser échouer la sauvegarde en silence ou avec une erreur générique après coup).
  let duplicateEmailTimer = null;
  document.addEventListener('input', (e) => {
    if (!e.target.hasAttribute('data-check-duplicate-email')) return;
    const input = e.target;
    const warning = document.getElementById(input.id + '-duplicate-warning');
    if (!warning) return;
    clearTimeout(duplicateEmailTimer);
    duplicateEmailTimer = setTimeout(() => {
      const email = input.value.trim().toLowerCase();
      const excludeId = input.dataset.excludeId;
      const duplicate = email && employeeRepository.getAll().some(emp =>
        emp.id !== excludeId && !emp.archive && (emp.email || '').toLowerCase() === email
      );
      warning.classList.toggle('visible', !!duplicate);
    }, 250);
  });

  // Autocomplétion SIRET (API Recherche d'entreprises gouv.fr, gratuite/sans clé) — dès que 14
  // chiffres valides sont saisis, remplit automatiquement la raison sociale et l'adresse du siège.
  let siretAutocompleteTimer = null;
  document.addEventListener('input', (e) => {
    if (!e.target.hasAttribute('data-siret-autocomplete')) return;
    const input = e.target;
    const hint = document.getElementById(input.id + '-hint');
    clearTimeout(siretAutocompleteTimer);
    const digits = input.value.replace(/\s/g, '');
    if (!/^\d{14}$/.test(digits)) {
      if (hint) hint.textContent = '';
      return;
    }
    if (hint) hint.textContent = 'Recherche...';
    siretAutocompleteTimer = setTimeout(async () => {
      let data;
      try {
        const res = await fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${digits}&per_page=1`);
        data = await res.json();
      } catch {
        if (hint) hint.textContent = '';
        return;
      }
      const result = data?.results?.[0];
      if (!result || !result.siege) {
        if (hint) hint.textContent = 'Aucune entreprise trouvée pour ce SIRET.';
        return;
      }
      const raisonField = document.getElementById(input.dataset.fillRaison);
      const adresseField = document.getElementById(input.dataset.fillAdresse);
      if (raisonField && !raisonField.value) raisonField.value = result.nom_complet || '';
      if (adresseField && !adresseField.value) adresseField.value = result.siege.adresse || '';
      if (hint) hint.textContent = `✓ ${result.nom_complet || ''}`;
    }, 400);
  });

  // Autocomplétion "Raison sociale" par nom (même API que le SIRET ci-dessus, sens inverse) —
  // choisir une suggestion remplit aussi le SIRET et l'adresse. Même mécanique que l'autocomplétion
  // d'adresse (suggestions sous le champ, stockées sur le nœud DOM le temps du clic).
  let companyAutocompleteTimer = null;
  document.addEventListener('input', (e) => {
    if (!e.target.hasAttribute('data-company-autocomplete')) return;
    const input = e.target;
    const suggestionsEl = document.getElementById(input.id + '-suggestions');
    if (!suggestionsEl) return;
    clearTimeout(companyAutocompleteTimer);
    const query = input.value.trim();
    if (query.length < 3) {
      suggestionsEl.style.display = 'none';
      suggestionsEl.innerHTML = '';
      return;
    }
    companyAutocompleteTimer = setTimeout(async () => {
      let data;
      try {
        const res = await fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(query)}&per_page=5`);
        data = await res.json();
      } catch {
        return; // Silencieux : confort seulement, la saisie manuelle reste possible.
      }
      const results = (data?.results || []).filter(r => r.siege);
      if (!results.length) {
        suggestionsEl.style.display = 'none';
        suggestionsEl.innerHTML = '';
        return;
      }
      suggestionsEl._companies = results;
      suggestionsEl.innerHTML = results
        .map((r, i) => `<div class="company-suggestion-item" data-company-index="${i}">${escapeHtml(r.nom_complet || '')} — ${escapeHtml(r.siege.siret || '')}<br><span class="text-muted">${escapeHtml(r.siege.adresse || '')}</span></div>`)
        .join('');
      suggestionsEl.style.display = 'block';
    }, 300);
  });

  document.addEventListener('click', (e) => {
    const companyItem = e.target.closest('[data-company-index]');
    if (!companyItem) return;
    const suggestionsEl = companyItem.parentElement;
    const company = suggestionsEl._companies?.[Number(companyItem.dataset.companyIndex)];
    const input = document.getElementById(suggestionsEl.id.replace(/-suggestions$/, ''));
    if (company && input) {
      input.value = company.nom_complet || '';
      const siretField = document.getElementById(input.dataset.fillSiret);
      const adresseField = document.getElementById(input.dataset.fillAdresse);
      if (siretField) siretField.value = company.siege.siret || '';
      if (adresseField) adresseField.value = company.siege.adresse || '';
    }
    suggestionsEl.style.display = 'none';
    suggestionsEl.innerHTML = '';
  });

  /** Active au clavier (Entrée/Espace) n'importe quel élément focusable marqué role="button" — évite d'ajouter un gestionnaire keydown à chaque ligne/carte cliquable (salariés, organigramme, favoris, notifications...). */
  document.addEventListener('keydown', (e) => {
    if ((e.key !== 'Enter' && e.key !== ' ') || document.activeElement?.getAttribute('role') !== 'button') return;
    e.preventDefault();
    document.activeElement.click();
  });

  /** Piège le focus (Tab/Shift+Tab) à l'intérieur de la modale ouverte : sans ça, Tab finit par sortir vers la sidebar/topbar/liste en arrière-plan, ce qui n'a pas de sens tant qu'une modale bloque l'interaction. */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || !modalRoot.classList.contains('open')) return;
    const focusables = [...modalRoot.querySelectorAll('input, select, textarea, button, a[href]')]
      .filter(el => !el.disabled && el.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  /**
   * Focus automatique du premier champ dès qu'une modale apparaît (évite de toucher chacun des ~15 points
   * d'ouverture), et mémorisation de l'élément qui avait le focus juste avant — pour le lui rendre à la
   * fermeture (closeModal) plutôt que de perdre le focus clavier quelque part sur la page.
   */
  let wasModalOpen = false;
  new MutationObserver(() => {
    const isOpen = modalRoot.classList.contains('open');
    if (isOpen && !wasModalOpen) lastFocusedBeforeModal = document.activeElement;
    wasModalOpen = isOpen;
    if (!isOpen) return;
    const firstField = modalRoot.querySelector('input, select, textarea');
    if (firstField) firstField.focus();
  }).observe(modalRoot, { childList: true });
}

// ---------------------------------------------------------------------------
// Recherche globale (topbar) — instantanée, tous modules, avec favoris
// ---------------------------------------------------------------------------

/** Sprint SIRH premium §8 : sections de Paramètres indexées pour la recherche globale — un item par
 * onglet plutôt que par champ individuel (rester simple : la recherche amène sur le bon onglet,
 * pas jusqu'au champ précis). `permission` optionnelle pour les onglets eux-mêmes restreints
 * (Journal d'audit) au-delà du GERER_PARAMETRES déjà requis pour l'écran Paramètres. */
const PARAMETRES_SEARCH_SECTIONS = [
  { label: 'Entreprise', tab: 'entreprise', keywords: ['société', 'raison sociale', 'siret'] },
  { label: 'Établissements', tab: 'etablissements', keywords: ['site', 'agence', 'adresse'] },
  { label: 'Services & équipes', tab: 'services', keywords: ['service', 'équipe', 'organisation'] },
  { label: "Types d'absences", tab: 'types-absences', keywords: ['types de congés', 'rtt', 'justificatif', 'comptabilisé dans les congés'] },
  { label: 'Listes de référence', tab: 'listes', keywords: ['catégories de frais', 'postes'] },
  { label: 'Vacances scolaires', tab: 'vacances', keywords: ['zone', 'scolaire'] },
  { label: 'Jours fériés', tab: 'feries', keywords: ['férié', 'jour chômé'] },
  { label: "Journal d'audit", tab: 'audit', keywords: ['audit', 'historique', 'log'], permission: PERMISSIONS.VOIR_JOURNAL_AUDIT }
];

function performGlobalSearch(term) {
  const q = normalizeForSearch(term.trim());
  if (!q) return [];
  const results = [];
  const user = authRepository.getCurrentUser();
  const visibleIds = getVisibleEmployeeIdsForCurrentUser();
  const isVisible = (employeeId) => visibleIds === null || visibleIds.includes(employeeId);

  employeeRepository.getAll().filter(e => !e.archive && isVisible(e.id)).forEach(e => {
    const haystack = normalizeForSearch(`${e.prenom} ${e.nom} ${e.matricule} ${e.email} ${e.poste} ${e.service}`);
    if (haystack.includes(q)) {
      results.push({
        icon: favoriteRepository.isFavoriteEmployee(e.id) ? '⭐' : '👤',
        label: `${e.prenom} ${e.nom}`,
        sublabel: e.poste || e.service || 'Salarié',
        nav: 'employee-detail',
        params: { currentEmployeeId: e.id }
      });
    }
  });

  leaveRepository.getAll().forEach(r => {
    const employee = employeeRepository.getById(r.employeeId);
    const type = leaveTypeRepository.getLeaveTypeById(r.typeId);
    if (!employee || !type || !isVisible(employee.id)) return;
    const haystack = normalizeForSearch(`${employee.prenom} ${employee.nom} ${type.nom} congé`);
    if (haystack.includes(q)) {
      results.push({
        icon: type.icone,
        label: `${employee.prenom} ${employee.nom} · ${type.nom}`,
        sublabel: `Congé · ${formatDate(r.dateDebut)} · ${r.statut}`,
        nav: 'absences',
        params: { absencesHubTab: 'conges', congesTab: 'demandes' }
      });
    }
  });

  teleworkRepository.getAll().forEach(r => {
    const employee = employeeRepository.getById(r.employeeId);
    if (!employee || !isVisible(employee.id)) return;
    if (normalizeForSearch(`${employee.prenom} ${employee.nom} télétravail`).includes(q)) {
      results.push({
        icon: '💻',
        label: `${employee.prenom} ${employee.nom}`,
        sublabel: `Télétravail · ${formatDate(r.dateDebut)} · ${r.statut}`,
        nav: 'absences',
        params: { absencesHubTab: 'teletravail', teletravailTab: 'demandes' }
      });
    }
  });

  expenseRepository.getAll().forEach(n => {
    const employee = employeeRepository.getById(n.employeeId);
    if (!employee || !isVisible(employee.id)) return;
    const haystack = normalizeForSearch(`${employee.prenom} ${employee.nom} ${n.categorie} ${n.libelle}`);
    if (haystack.includes(q)) {
      results.push({
        icon: '🧾',
        label: `${employee.prenom} ${employee.nom} · ${n.libelle}`,
        sublabel: `Note de frais · ${formatCurrencyFR(n.montantTTC)} · ${n.statut}`,
        nav: 'frais',
        params: {}
      });
    }
  });

  // Sprint SIRH premium §8 : services/équipes/paramètres — mêmes écrans que la navigation normale
  // (Organigramme réservé manager/RH/directeur, Paramètres réservé GERER_PARAMETRES), pour ne
  // jamais faire remonter un résultat de recherche vers un écran que l'utilisateur ne peut pas ouvrir.
  if ([ROLES.MANAGER, ROLES.RH, ROLES.DIRECTEUR].includes(user.role)) {
    serviceRepository.getAll().forEach(s => {
      if (normalizeForSearch(s.nom).includes(q)) {
        results.push({
          icon: '🏢',
          label: s.nom,
          sublabel: 'Service',
          nav: 'organigramme',
          params: { organigrammeFilters: { search: '', etablissementId: '', service: s.nom, equipe: '' } }
        });
      }
      (s.equipes || []).forEach(eq => {
        if (normalizeForSearch(eq.nom).includes(q)) {
          results.push({
            icon: '🧑‍🤝‍🧑',
            label: eq.nom,
            sublabel: `Équipe · ${s.nom}`,
            nav: 'organigramme',
            params: { organigrammeFilters: { search: '', etablissementId: '', service: s.nom, equipe: eq.nom } }
          });
        }
      });
    });
  }

  if (hasPermission(user, PERMISSIONS.GERER_PARAMETRES)) {
    PARAMETRES_SEARCH_SECTIONS
      .filter(s => !s.permission || hasPermission(user, s.permission))
      .filter(s => normalizeForSearch(s.label).includes(q) || s.keywords.some(k => normalizeForSearch(k).includes(q)))
      .forEach(s => results.push({ icon: '⚙️', label: s.label, sublabel: 'Paramètres', nav: 'parametres', params: { parametresTab: s.tab } }));
  }

  return results.slice(0, 8);
}

function searchResultItemHTML(result, index, isHighlighted) {
  return `
    <div class="search-result-item ${isHighlighted ? 'highlighted' : ''}" data-result-index="${index}">
      <span class="search-result-icon">${escapeHtml(result.icon)}</span>
      <div>
        <div class="search-result-label">${escapeHtml(result.label)}</div>
        <div class="search-result-sublabel">${escapeHtml(result.sublabel)}</div>
      </div>
    </div>
  `;
}

function renderFavoritesDropdown(resultsBox) {
  const visibleIds = getVisibleEmployeeIdsForCurrentUser();
  const favorites = favoriteRepository.getFavoriteEmployeeIds()
    .map(id => employeeRepository.getById(id))
    .filter(e => e && (visibleIds === null || visibleIds.includes(e.id)));

  if (favorites.length === 0) {
    resultsBox.innerHTML = `<div class="search-empty">Tapez pour rechercher, ou ajoutez des favoris depuis une fiche salarié.</div>`;
    resultsBox.classList.add('open');
    return;
  }

  resultsBox.innerHTML = `
    <div class="search-section-label">Favoris</div>
    ${favorites.map(e => `
      <div class="search-result-item" data-favorite-id="${e.id}" tabindex="0" role="button" aria-label="Voir la fiche de ${escapeHtml(e.prenom)} ${escapeHtml(e.nom)}">
        <span class="search-result-icon">⭐</span>
        <div>
          <div class="search-result-label">${escapeHtml(e.prenom)} ${escapeHtml(e.nom)}</div>
          <div class="search-result-sublabel">${escapeHtml(e.poste || '—')}</div>
        </div>
      </div>
    `).join('')}
  `;
  resultsBox.classList.add('open');
  resultsBox.querySelectorAll('[data-favorite-id]').forEach(el => {
    el.addEventListener('click', () => {
      navigateTo('employee-detail', { currentEmployeeId: el.dataset.favoriteId });
      document.getElementById('global-search-input').value = '';
      resultsBox.classList.remove('open');
    });
  });
}

function bindGlobalSearchEvents() {
  const input = document.getElementById('global-search-input');
  const resultsBox = document.getElementById('global-search-results');
  let currentResults = [];
  let highlightedIndex = -1;

  function updateHighlight() {
    resultsBox.querySelectorAll('.search-result-item').forEach((el, i) => {
      el.classList.toggle('highlighted', i === highlightedIndex);
    });
  }

  function selectResult(index) {
    const result = currentResults[index];
    if (!result) return;
    navigateTo(result.nav, result.params || {});
    input.value = '';
    resultsBox.classList.remove('open');
  }

  function renderResults(term) {
    if (!term.trim()) {
      currentResults = [];
      renderFavoritesDropdown(resultsBox);
      return;
    }
    currentResults = performGlobalSearch(term);
    highlightedIndex = currentResults.length ? 0 : -1;

    if (currentResults.length === 0) {
      resultsBox.innerHTML = `<div class="search-empty">Aucun résultat pour « ${escapeHtml(term)} ».</div>`;
      resultsBox.classList.add('open');
      return;
    }

    resultsBox.innerHTML = currentResults.map((r, i) => searchResultItemHTML(r, i, i === highlightedIndex)).join('');
    resultsBox.classList.add('open');
    resultsBox.querySelectorAll('[data-result-index]').forEach(el => {
      el.addEventListener('click', () => selectResult(Number(el.dataset.resultIndex)));
    });
  }

  input.addEventListener('input', () => renderResults(input.value));
  input.addEventListener('focus', () => renderResults(input.value));

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && currentResults.length) {
      e.preventDefault();
      highlightedIndex = Math.min(highlightedIndex + 1, currentResults.length - 1);
      updateHighlight();
    } else if (e.key === 'ArrowUp' && currentResults.length) {
      e.preventDefault();
      highlightedIndex = Math.max(highlightedIndex - 1, 0);
      updateHighlight();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      selectResult(highlightedIndex);
    } else if (e.key === 'Escape') {
      resultsBox.classList.remove('open');
      input.blur();
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.topbar-search')) resultsBox.classList.remove('open');
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });
}

// ---------------------------------------------------------------------------
// Notifications (topbar) — générées à partir des événements réels de l'app
// ---------------------------------------------------------------------------

function makeNotification(sourceKey, icon, title, message, nav, params, employeeId) {
  return {
    id: generateId('notif'),
    sourceKey, icon, title, message, nav,
    params: params || {},
    employeeId: employeeId || null, // salarié concerné : sert à restreindre la visibilité au même périmètre que le reste de l'app
    luPar: {},
    archivePar: {},
    date: new Date().toISOString()
  };
}

/** Notifications visibles par l'utilisateur courant : restreint au même périmètre que les listes de congés/frais/salariés (self / équipe / tout, selon le rôle). */
function getVisibleNotificationsForCurrentUser() {
  const visibleIds = getVisibleEmployeeIdsForCurrentUser();
  return notificationRepository.getNotifications().filter(n => !n.employeeId || visibleIds === null || visibleIds.includes(n.employeeId));
}

/** Détecte les événements notifiables actuels et crée les notifications manquantes (idempotent). */
function syncNotifications() {
  const candidates = [];

  leaveRepository.getAll().filter(r => r.statut === 'En attente').forEach(r => {
    const employee = employeeRepository.getById(r.employeeId);
    const type = leaveTypeRepository.getLeaveTypeById(r.typeId);
    if (!employee || !type) return;
    candidates.push(makeNotification(`leave-${r.id}`, '🏖️', 'Demande de congé en attente',
      `${employee.prenom} ${employee.nom} · ${type.nom}`, 'absences', { absencesHubTab: type.categorie === 'autre' ? 'autres' : 'conges', congesTab: 'demandes' }, employee.id));
  });

  teleworkRepository.getAll().filter(r => r.statut === 'En attente').forEach(r => {
    const employee = employeeRepository.getById(r.employeeId);
    if (!employee) return;
    candidates.push(makeNotification(`telework-${r.id}`, '💻', 'Demande de télétravail en attente',
      `${employee.prenom} ${employee.nom}`, 'absences', { absencesHubTab: 'teletravail', teletravailTab: 'demandes' }, employee.id));
  });

  expenseRepository.getAll().filter(n => n.statut === 'En attente').forEach(n => {
    const employee = employeeRepository.getById(n.employeeId);
    if (!employee) return;
    candidates.push(makeNotification(`expense-${n.id}`, '🧾', 'Note de frais en attente',
      `${employee.prenom} ${employee.nom} · ${n.libelle}`, 'frais', {}, employee.id));
  });

  // Infinity : la génération de notifications ne doit jamais plafonner à 5 (contrairement aux
  // widgets d'aperçu du tableau de bord) — sinon le 6e salarié et au-delà n'est simplement jamais notifié.
  getUpcomingBirthdays(7, undefined, Infinity).forEach(x => {
    candidates.push(makeNotification(`birthday-${x.employee.id}-${x.next.getFullYear()}`, '🎂', 'Anniversaire à venir',
      `${x.employee.prenom} ${x.employee.nom} · ${formatDate(toISODate(x.next))}`, 'employee-detail', { currentEmployeeId: x.employee.id }, x.employee.id));
  });

  getUpcomingSeniorityAnniversaries(30, undefined, Infinity).forEach(x => {
    candidates.push(makeNotification(`seniority-${x.employee.id}-${x.years}`, '🏅', `${x.years} ans d'ancienneté`,
      `${x.employee.prenom} ${x.employee.nom} · ${formatDate(toISODate(x.next))}`, 'employee-detail', { currentEmployeeId: x.employee.id }, x.employee.id));
  });

  getUpcomingContractEnds(14, undefined, Infinity).forEach(e => {
    candidates.push(makeNotification(`contract-end-${e.id}-${e.dateFinContrat}`, '📄', 'Fin de contrat proche',
      `${e.prenom} ${e.nom} · ${formatDate(e.dateFinContrat)}`, 'employee-detail', { currentEmployeeId: e.id }, e.id));
  });

  getUpcomingProbationEnds(14, undefined, Infinity).forEach(e => {
    candidates.push(makeNotification(`probation-end-${e.id}-${e.dateFinPeriodeEssai}`, '📄', 'Fin de période d\'essai proche',
      `${e.prenom} ${e.nom} · ${formatDate(e.dateFinPeriodeEssai)}`, 'employee-detail', { currentEmployeeId: e.id }, e.id));
  });

  getUpcomingEntretiensProfessionnels(30, undefined, Infinity).forEach(x => {
    candidates.push(makeNotification(`entretien-pro-${x.employee.id}-${toISODate(x.next)}`, '🗒️', 'Entretien professionnel à programmer',
      `${x.employee.prenom} ${x.employee.nom} · ${formatDate(toISODate(x.next))}`, 'employee-detail', { currentEmployeeId: x.employee.id }, x.employee.id));
  });

  getUpcomingBilansSixAns(30, undefined, Infinity).forEach(x => {
    candidates.push(makeNotification(`bilan-six-ans-${x.employee.id}-${x.years}`, '🗒️', 'Bilan à 6 ans à réaliser',
      `${x.employee.prenom} ${x.employee.nom} · ${formatDate(toISODate(x.next))}`, 'employee-detail', { currentEmployeeId: x.employee.id }, x.employee.id));
  });

  documentRepository.getAll().filter(d => d.dateExpiration).forEach(d => {
    // Comparer au même format des deux côtés (date-only, via toISODate) plutôt qu'à l'instant
    // courant — sinon la fraction de journée déjà écoulée décale daysUntil d'un jour selon l'heure
    // qu'il est (même bug que celui corrigé sur getUpcomingBirthdays cette session).
    const daysUntil = Math.round((new Date(d.dateExpiration) - new Date(toISODate(new Date()))) / 86400000);
    if (daysUntil > 30) return;
    const employee = employeeRepository.getById(d.employeeId);
    if (!employee) return;
    const title = daysUntil < 0 ? 'Document expiré' : 'Document arrivant à expiration';
    candidates.push(makeNotification(`document-expiry-${d.id}`, '📄', title,
      `${employee.prenom} ${employee.nom} · ${d.categorie} · ${d.nom} · ${formatDate(d.dateExpiration)}`,
      'employee-detail', { currentEmployeeId: employee.id }, employee.id));
  });

  notificationRepository.addNotificationsIfNew(candidates);
}

function updateNotifBadge() {
  const badge = document.getElementById('notif-badge');
  const count = getVisibleNotificationsForCurrentUser().filter(n => !n.archive && !n.lu).length;
  badge.textContent = count > 9 ? '9+' : String(count);
  badge.style.display = count > 0 ? 'flex' : 'none';
}

function bindNotificationEvents() {
  const bell = document.getElementById('btn-notifications');
  const panel = document.getElementById('notif-panel');

  bell.addEventListener('click', (e) => {
    e.stopPropagation();
    if (panel.classList.contains('open')) {
      panel.classList.remove('open');
      return;
    }
    renderNotifPanel();
    panel.classList.add('open');
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.notif-wrapper')) panel.classList.remove('open');
  });
}

const NOTIF_PANEL_LIMIT = 50;

function renderNotifPanel() {
  const panel = document.getElementById('notif-panel');
  const all = getVisibleNotificationsForCurrentUser();
  const filtered = state.notifTab === 'archivees' ? all.filter(n => n.archive)
    : state.notifTab === 'toutes' ? all.filter(n => !n.archive)
    : all.filter(n => !n.archive && !n.lu);
  const list = filtered.slice(0, NOTIF_PANEL_LIMIT);

  panel.innerHTML = `
    <div class="notif-header">
      <div class="tabs notif-tabs">
        <button class="tab ${state.notifTab === 'non-lues' ? 'active' : ''}" data-notif-tab="non-lues">Non lues</button>
        <button class="tab ${state.notifTab === 'toutes' ? 'active' : ''}" data-notif-tab="toutes">Toutes</button>
        <button class="tab ${state.notifTab === 'archivees' ? 'active' : ''}" data-notif-tab="archivees">Archivées</button>
      </div>
      ${state.notifTab !== 'archivees' ? `<button class="btn-link" id="btn-mark-all-read">Tout marquer lu</button>` : ''}
    </div>
    <div class="notif-list">
      ${list.length === 0 ? `<div class="search-empty">Rien à signaler ici.</div>` : list.map(renderNotifItem).join('')}
      ${filtered.length > list.length ? `<p class="text-muted" style="padding: 10px 16px; font-size: 12px;">Affichage limité aux ${list.length} plus récentes (${filtered.length} au total).</p>` : ''}
    </div>
  `;

  panel.querySelectorAll('[data-notif-tab]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.notifTab = btn.dataset.notifTab;
      renderNotifPanel();
    });
  });

  const markAllBtn = document.getElementById('btn-mark-all-read');
  if (markAllBtn) {
    markAllBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      notificationRepository.markAllNotificationsRead();
      updateNotifBadge();
      renderNotifPanel();
    });
  }

  bindNotifItemEvents();
}

function renderNotifItem(n) {
  return `
    <div class="notif-item ${n.lu ? '' : 'unread'}">
      <span class="notif-icon">${escapeHtml(n.icon)}</span>
      <div class="notif-body" data-notif-open="${n.id}" tabindex="0" role="button" aria-label="${escapeHtml(n.title)}">
        <div class="notif-title">${escapeHtml(n.title)}</div>
        <div class="notif-message">${escapeHtml(n.message)}</div>
        <div class="notif-date">${formatDateTime(n.date)}</div>
      </div>
      <div class="notif-actions">
        ${n.archive
          ? `<button class="btn-icon" data-notif-unarchive="${n.id}" title="Désarchiver">↩️</button>`
          : `<button class="btn-icon" data-notif-archive="${n.id}" title="Archiver">🗄️</button>`}
      </div>
    </div>
  `;
}

function bindNotifItemEvents() {
  document.querySelectorAll('[data-notif-open]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const notif = notificationRepository.getNotifications().find(n => n.id === el.dataset.notifOpen);
      notificationRepository.markNotificationRead(el.dataset.notifOpen, true);
      document.getElementById('notif-panel').classList.remove('open');
      updateNotifBadge();
      if (notif) navigateTo(notif.nav, notif.params);
    });
  });

  document.querySelectorAll('[data-notif-archive]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      notificationRepository.setNotificationArchived(el.dataset.notifArchive, true);
      updateNotifBadge();
      renderNotifPanel();
    });
  });

  document.querySelectorAll('[data-notif-unarchive]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      notificationRepository.setNotificationArchived(el.dataset.notifUnarchive, false);
      updateNotifBadge();
      renderNotifPanel();
    });
  });
}

function navigateTo(view, params = {}) {
  const user = authRepository.getCurrentUser();
  const allowedKeys = navItemsForRole(user || { role: ROLES.SALARIE }).map(i => i.key);
  // Toujours autoriser les vues qui ne sont pas des entrées de menu (détail salarié, coming-soon...).
  const isNavView = NAV_ITEMS.some(i => i.key === view);
  state.view = isNavView && !allowedKeys.includes(view) ? 'dashboard' : view;
  Object.assign(state, params);
  renderSidebar();
  syncNotifications();
  updateNotifBadge();
  render();
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function navParamValueMatches(actual, expected) {
  if (expected && typeof expected === 'object') {
    return actual && typeof actual === 'object' && Object.keys(expected).every(k => actual[k] === expected[k]);
  }
  return actual === expected;
}

/** Un item est actif s'il pointe vers l'écran courant ET, s'il porte un navParams (cas des entrées
 * dupliquées "Mon calendrier"/"Calendrier équipe" etc., §5), que ce navParams correspond bien à
 * l'état courant. Un item SANS navParams (ex. "Congés", entrée générique de l'écran) reste actif
 * sauf si un "raccourci" du même écran (ex. "Congés à valider") correspond exactement à l'état
 * courant — sinon les deux s'allumeraient en même temps quand le filtre du raccourci est actif. */
function isNavItemActive(item, allItems) {
  if (state.view !== item.key) return false;
  if (item.navParams) {
    return Object.keys(item.navParams).every(k => navParamValueMatches(state[k], item.navParams[k]));
  }
  const moreSpecificSiblingActive = allItems.some(other => other !== item && other.key === item.key && other.navParams &&
    Object.keys(other.navParams).every(k => navParamValueMatches(state[k], other.navParams[k])));
  return !moreSpecificSiblingActive;
}

const MOBILE_NAV_QUERY = window.matchMedia('(max-width: 860px)');

function renderSidebar() {
  const user = authRepository.getCurrentUser();
  if (!user) return;
  // §sprint refonte UX §12 : sur mobile, "Paramètres"/"Abonnement" restent accessibles via le menu
  // utilisateur (renderUserMenuPanel) — pas besoin de les dupliquer dans une barre du bas déjà à
  // l'étroit. Desktop (même #sidebar-nav, juste réorienté en CSS) n'est jamais filtré.
  const items = navItemsForRole(user).filter(i => !(i.hideOnMobile && MOBILE_NAV_QUERY.matches));
  const nav = document.getElementById('sidebar-nav');

  const renderItem = (item, index) => {
    const label = item.key === 'employees' && user.role === 'manager' ? 'Mon équipe' : item.label;
    return `
    <button class="nav-item ${isNavItemActive(item, items) ? 'active' : ''}" data-nav-index="${index}" aria-label="${escapeHtml(label)}">
      <span class="nav-icon">${item.icon}</span>
      <span class="nav-label">${escapeHtml(label)}</span>
    </button>
  `;
  };

  // Sprint SIRH premium §5 : regroupement visuel "Personnel"/"Équipe" — seulement si le rôle a
  // vraiment les deux (un salarié n'a que des items "personnel" → liste plate, comportement inchangé).
  const withIndex = items.map((item, index) => ({ item, index }));
  const showGroups = items.some(i => i.group === 'personnel') && items.some(i => i.group === 'equipe');

  if (showGroups) {
    const dashboard = withIndex.filter(x => !x.item.group && x.item.key === 'dashboard');
    const personnel = withIndex.filter(x => x.item.group === 'personnel');
    const equipe = withIndex.filter(x => x.item.group === 'equipe');
    const reste = withIndex.filter(x => !x.item.group && x.item.key !== 'dashboard');
    nav.innerHTML =
      dashboard.map(x => renderItem(x.item, x.index)).join('') +
      '<div class="nav-section-label">Personnel</div>' +
      personnel.map(x => renderItem(x.item, x.index)).join('') +
      '<div class="nav-section-label">Équipe</div>' +
      equipe.map(x => renderItem(x.item, x.index)).join('') +
      reste.map(x => renderItem(x.item, x.index)).join('');
  } else {
    nav.innerHTML = withIndex.map(x => renderItem(x.item, x.index)).join('');
  }

  nav.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = items[Number(btn.dataset.navIndex)];
      navigateTo(item.key, item.navParams || {});
    });
  });
}

// ---------------------------------------------------------------------------
// Rendu principal
// ---------------------------------------------------------------------------

function render() {
  renderNonSouscritBanner();
  const root = document.getElementById('view-root');
  switch (state.view) {
    case 'dashboard':
      root.innerHTML = renderDashboard();
      bindDashboardEvents();
      break;
    case 'employees':
      root.innerHTML = renderEmployeesList();
      bindEmployeesListEvents();
      break;
    case 'organigramme':
      root.innerHTML = renderOrganigramme();
      bindOrganigrammeEvents();
      break;
    case 'mes-documents':
      root.innerHTML = renderMesDocuments();
      bindMesDocumentsEvents();
      break;
    case 'mes-tickets':
      root.innerHTML = renderMesTickets();
      bindMesTicketsEvents();
      break;
    case 'ticket-detail':
      root.innerHTML = renderTicketDetail(state.currentTicketId);
      bindTicketDetailEvents();
      break;
    case 'employee-detail':
      root.innerHTML = renderEmployeeDetail(state.currentEmployeeId);
      bindEmployeeDetailEvents();
      break;
    case 'absences':
      root.innerHTML = renderAbsencesHub();
      bindAbsencesHubEvents();
      break;
    case 'calendrier':
      root.innerHTML = renderCalendrier();
      bindCalendrierEvents();
      break;
    case 'planning':
      root.innerHTML = renderPlanning();
      bindPlanningEvents();
      break;
    case 'parametres':
      root.innerHTML = renderParametres();
      bindParametresEvents();
      break;
    case 'frais':
      root.innerHTML = renderFrais();
      bindFraisEvents();
      break;
    case 'tickets':
      root.innerHTML = renderTicketsHub();
      bindTicketsHubEvents();
      break;
    case 'export-paie':
      root.innerHTML = renderExportPaie();
      bindExportPaieEvents();
      break;
    default:
      root.innerHTML = renderDashboard();
  }
}

// ---------------------------------------------------------------------------
// Vue : Tableau de bord (aperçu, module complet à venir)
// ---------------------------------------------------------------------------

/** Sprint SIRH premium §9 : tableau de bord personnalisable — chaque widget peut être masqué par
 * l'utilisateur courant. Stocké sur SA PROPRE fiche employé (dashboardWidgetsMasques), pas au
 * niveau entreprise : deux RH peuvent avoir des préférences différentes. Défaut = liste vide = tout
 * visible, lu défensivement partout (même principe que typesAbsenceDesactives, §1 — pas de
 * migration nécessaire). */
const DASHBOARD_WIDGETS = {
  actionCenter: { label: "Centre d'action", roles: [ROLES.MANAGER, ROLES.RH, ROLES.DIRECTEUR] },
  kpis: { label: 'Indicateurs clés (KPI)', roles: [ROLES.MANAGER, ROLES.RH, ROLES.DIRECTEUR] },
  charts: { label: 'Graphiques (services, contrats, congés, tickets)', roles: [ROLES.MANAGER, ROLES.RH, ROLES.DIRECTEUR] },
  echeances: { label: 'Anniversaires & fins de contrat', roles: [ROLES.MANAGER, ROLES.RH, ROLES.DIRECTEUR] },
  presence: { label: 'Présence du jour', roles: [ROLES.MANAGER, ROLES.RH, ROLES.DIRECTEUR] },
  indicateursDirection: { label: 'Indicateurs Direction (avancé)', roles: [ROLES.DIRECTEUR] },
  soldes: { label: 'Mes soldes de congés', roles: [ROLES.SALARIE] },
  mesDemandes: { label: 'Mes demandes (en attente / à venir)', roles: [ROLES.SALARIE] },
  shortcuts: { label: 'Raccourcis', roles: [ROLES.MANAGER, ROLES.RH, ROLES.DIRECTEUR, ROLES.SALARIE] }
};

function isDashboardWidgetVisible(user, widgetId) {
  return !(user.dashboardWidgetsMasques || []).includes(widgetId);
}

function widgetsForRole(role) {
  return Object.entries(DASHBOARD_WIDGETS).filter(([, w]) => w.roles.includes(role)).map(([id, w]) => ({ id, label: w.label }));
}

function renderDashboardCustomizeButton() {
  return `<button class="btn btn-secondary btn-sm" id="btn-customize-dashboard">🧩 Personnaliser</button>`;
}

function bindDashboardEvents() {
  const btn = document.getElementById('btn-customize-dashboard');
  if (btn) btn.addEventListener('click', openDashboardCustomizeModal);
}

function openDashboardCustomizeModal() {
  const user = authRepository.getCurrentUser();
  const widgets = widgetsForRole(user.role);
  const hidden = user.dashboardWidgetsMasques || [];

  const html = `
    <div class="modal modal-small">
      <div class="modal-header">
        <h2>Personnaliser le tableau de bord</h2>
        <button class="btn-icon" id="btn-close-modal" aria-label="Fermer" title="Fermer">✕</button>
      </div>
      <form id="dashboard-customize-form">
        <div class="modal-body">
          <p class="text-muted">Décochez les blocs que vous ne souhaitez pas voir sur votre tableau de bord.</p>
          <div class="form-grid">
            ${widgets.map(w => checkboxField(`widget-${w.id}`, w.label, !hidden.includes(w.id))).join('')}
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Annuler</button>
          <button type="submit" class="btn btn-primary">Enregistrer</button>
        </div>
      </form>
    </div>
  `;

  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = html;
  modalRoot.classList.add('open');

  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
  document.getElementById('dashboard-customize-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const dashboardWidgetsMasques = widgets.filter(w => !document.getElementById(`f-widget-${w.id}`).checked).map(w => w.id);
    employeeRepository.update(user.id, { dashboardWidgetsMasques });
    closeModal();
    showToast('Accueil personnalisé.');
    render();
  });
}

/** Le tableau de bord est différent par rôle : vue personnelle (Salarié), vue équipe (Manager), vue entreprise (RH/Comptabilité), vue entreprise + indicateurs avancés (Directeur). */
function renderDashboard() {
  const user = authRepository.getCurrentUser();
  if (!user) return '';
  if (user.role === ROLES.SALARIE) return renderDashboardSalarie(user);
  if (user.role === ROLES.MANAGER) return renderDashboardManager();
  if (user.role === ROLES.DIRECTEUR) return renderDashboardDirecteur();
  return renderDashboardRH();
}

/** Bloc KPI + graphiques + naissances/fins de contrat + présence, partagé par les vues RH/Manager/Directeur. `employeeIds` = null pour l'entreprise entière, sinon liste restreinte (équipe d'un manager). */
function renderOperationalDashboardBody(employees, employeeIds) {
  const actifs = employees.filter(e => e.statut === 'Actif');
  const cdi = actifs.filter(e => e.typeContrat === 'CDI').length;
  const cdd = actifs.filter(e => e.typeContrat === 'CDD').length;
  const services = new Set(actifs.map(e => e.service).filter(Boolean)).size;
  let demandesEnAttente = leaveRepository.getAll().filter(r => r.statut === 'En attente');
  let notesEnAttente = expenseRepository.getAll().filter(n => n.statut === 'En attente');
  let teletravailAujourdhui = teleworkRepository.getAll().filter(r => r.statut === 'Validé');
  if (employeeIds) {
    demandesEnAttente = demandesEnAttente.filter(r => employeeIds.includes(r.employeeId));
    notesEnAttente = notesEnAttente.filter(n => employeeIds.includes(n.employeeId));
    teletravailAujourdhui = teletravailAujourdhui.filter(r => employeeIds.includes(r.employeeId));
  }
  const today = toISODate(new Date());
  teletravailAujourdhui = teletravailAujourdhui.filter(r => today >= r.dateDebut && today <= r.dateFin);
  const now = new Date();
  const settings = settingsRepository.getSettings();
  const leaveRequests = leaveRepository.getAll();
  const teleworkRequests = teleworkRepository.getAll();
  const ticketsCeMois = actifs
    .reduce((sum, e) => sum + calculateTicketsRestaurant(e, now.getFullYear(), now.getMonth(), leaveRequests, teleworkRequests, settings).nbTickets, 0);

  const serviceBreakdown = getServiceBreakdown(actifs);
  const contratBreakdown = getContratBreakdown(actifs);
  const congesParType = getCongesParType(employeeIds);
  const ticketsCostTrend = getTicketsCostTrend(actifs);
  const birthdays = getUpcomingBirthdays(60, employees);
  const contractEnds = getUpcomingContractEnds(60, employees);
  const seniorityAnniversaries = getUpcomingSeniorityAnniversaries(60, employees);
  const entretiensProfessionnels = getUpcomingEntretiensProfessionnels(60, employees);
  const bilansSixAns = getUpcomingBilansSixAns(60, employees);

  const user = authRepository.getCurrentUser();
  const showPresenceCard = user && [ROLES.MANAGER, ROLES.RH, ROLES.DIRECTEUR].includes(user.role) && isDashboardWidgetVisible(user, 'presence');
  const isVisible = (widgetId) => isDashboardWidgetVisible(user, widgetId);

  return `
    ${isVisible('kpis') ? `
    <div class="kpi-grid">
      ${kpiCard('Salariés actifs', actifs.length, '👥')}
      ${kpiCard('Contrats CDI', cdi, '📄')}
      ${kpiCard('Contrats CDD', cdd, '⏳')}
      ${kpiCard('Services', services, '🏢')}
      ${kpiCard('Demandes de congé en attente', demandesEnAttente.length, '🏖️')}
      ${kpiCard('En télétravail aujourd\'hui', teletravailAujourdhui.length, '💻')}
      ${kpiCard('Notes de frais en attente', notesEnAttente.length, '🧾')}
      ${kpiCard('Tickets restaurant ce mois', ticketsCeMois, '🍽️')}
    </div>
    ` : ''}

    ${isVisible('charts') ? `
    <div class="dashboard-grid">
      ${chartCard('Répartition par service', serviceBreakdown.length === 0
        ? emptyChartMessage()
        : renderBarChartSVG(serviceBreakdown))}
      ${chartCard('Répartition par type de contrat', contratBreakdown.length === 0
        ? emptyChartMessage()
        : renderDonutChartSVG(contratBreakdown) + chartLegend(contratBreakdown))}
      ${chartCard('Congés pris par type', `Année ${new Date().getFullYear()} · jours validés`, congesParType.length === 0
        ? emptyChartMessage()
        : renderBarChartSVG(congesParType))}
      ${chartCard('Coût tickets restaurant', 'Part employeur, 6 derniers mois', renderLineChartSVG(ticketsCostTrend))}
    </div>
    ` : ''}

    ${isVisible('echeances') ? `
    <div class="dashboard-grid">
      ${renderUpcomingBirthdaysCard(birthdays)}
      ${renderUpcomingContractEndsCard(contractEnds)}
      ${renderUpcomingSeniorityCard(seniorityAnniversaries)}
      ${renderUpcomingEntretiensCard(entretiensProfessionnels, bilansSixAns)}
    </div>
    ` : ''}

    ${showPresenceCard ? renderPresenceCard() : ''}
  `;
}

/** Sprint SIRH premium §7 : centre d'action cliquable du tableau de bord — chaque ligne pointe vers
 * l'écran concerné avec le filtre "En attente" déjà présélectionné (mêmes navParams que les
 * raccourcis sidebar équipe, §5, pour rester cohérent). `employeeIds` = null (RH/Directeur, toute
 * l'entreprise) ou liste restreinte (équipe d'un manager) — même convention que
 * renderOperationalDashboardBody. Une ligne n'apparaît que si elle a effectivement quelque chose à
 * signaler (liste vide = pas de bruit), sauf "Préparation de paie" qui reste visible même à 0
 * anomalie pour confirmer explicitement que la paie est prête. */
function renderDashboardActionCenter(employees, employeeIds) {
  const user = authRepository.getCurrentUser();
  // Congés/télétravail/contrats : seuls manager/RH/directeur valident ou gèrent des contrats — la
  // comptabilité (qui tombe aussi sur renderDashboardRH) n'a ni ces écrans ni ces entrées sidebar
  // (§5), un item cliquable ici la ramènerait juste vers le dashboard sans rien ouvrir.
  const managesEquipe = [ROLES.MANAGER, ROLES.RH, ROLES.DIRECTEUR].includes(user.role);
  // "En attente", éventuellement restreint à l'équipe visible (employeeIds) — même filtre répété
  // pour congés/télétravail/frais, factorisé une seule fois ici.
  const pendingFor = (repo) => {
    const list = repo.getAll().filter(r => r.statut === 'En attente');
    return employeeIds ? list.filter(r => employeeIds.includes(r.employeeId)) : list;
  };

  const items = [];

  if (managesEquipe) {
    const congesEnAttente = pendingFor(leaveRepository);
    const teletravailEnAttente = pendingFor(teleworkRepository);
    const contractEnds = getUpcomingContractEnds(60, employees, Infinity);
    if (congesEnAttente.length) items.push({ icon: '🏖️', label: `${congesEnAttente.length} demande${congesEnAttente.length > 1 ? 's' : ''} de congé à valider`, nav: 'absences', navParams: NAVPARAMS_CONGES_A_VALIDER });
    if (teletravailEnAttente.length) items.push({ icon: '💻', label: `${teletravailEnAttente.length} demande${teletravailEnAttente.length > 1 ? 's' : ''} de télétravail à valider`, nav: 'absences', navParams: NAVPARAMS_TELETRAVAIL_A_VALIDER });
    if (contractEnds.length) items.push({ icon: '📄', label: `${contractEnds.length} contrat${contractEnds.length > 1 ? 's' : ''} arrivant à échéance (60 jours)`, nav: 'employees', navParams: {} });
  }

  const fraisEnAttente = pendingFor(expenseRepository);
  if (fraisEnAttente.length) items.push({ icon: '🧾', label: `${fraisEnAttente.length} note${fraisEnAttente.length > 1 ? 's' : ''} de frais à valider`, nav: 'frais', navParams: NAVPARAMS_FRAIS_A_VALIDER });

  if (hasPermission(user, PERMISSIONS.EXPORTER_PAIE)) {
    const now = new Date();
    const bloquantes = getPaieAnomalies(now.getFullYear(), now.getMonth()).filter(a => a.severity === 'bloquante');
    items.push(bloquantes.length
      ? { icon: '🚫', label: `${bloquantes.length} anomalie${bloquantes.length > 1 ? 's' : ''} bloquante${bloquantes.length > 1 ? 's' : ''} avant l'export paie`, nav: 'export-paie', navParams: { paieTab: 'preparation' } }
      : { icon: '📤', label: `Préparation de paie : aucune anomalie ce mois-ci`, nav: 'export-paie', navParams: { paieTab: 'preparation' } });
  }

  if (hasPermission(user, PERMISSIONS.CALCULER_TICKETS_RESTAURANT)) {
    const now = new Date();
    // Récupérés une seule fois avant la boucle : sinon chaque salarié actif re-fetch/re-trie
    // l'intégralité des congés/télétravail de l'entreprise pour rien (calculateTicketsRestaurant
    // n'a besoin que de filtrer ces mêmes listes, déjà identiques à chaque itération).
    const leaveRequests = leaveRepository.getAll();
    const teleworkRequests = teleworkRepository.getAll();
    const settings = settingsRepository.getSettings();
    const totalTickets = employees.filter(e => e.statut === 'Actif')
      .reduce((sum, e) => sum + calculateTicketsRestaurant(e, now.getFullYear(), now.getMonth(), leaveRequests, teleworkRequests, settings).nbTickets, 0);
    items.push({ icon: '🍽️', label: `${totalTickets} tickets restaurant ce mois-ci à vérifier`, nav: 'tickets', navParams: {} });
  }

  if (!items.length) return '';

  return `
    <div class="card action-center">
      <h2>Centre d'action</h2>
      <div class="action-center-list">
        ${items.map(i => `
          <button type="button" class="action-center-item" data-nav="${i.nav}" data-nav-params='${escapeHtml(JSON.stringify(i.navParams))}'>
            <span class="action-center-icon">${i.icon}</span>
            <span class="action-center-label">${escapeHtml(i.label)}</span>
            <span class="action-center-arrow">→</span>
          </button>
        `).join('')}
      </div>
    </div>
  `;
}

function renderDashboardShortcuts() {
  return `
    <div class="card">
      <h2>Raccourcis</h2>
      <button class="btn btn-primary" data-nav="employees">Gérer les salariés</button>
      <button class="btn btn-secondary" data-nav="conges">Gérer les congés</button>
      <button class="btn btn-secondary" data-nav="teletravail">Gérer le télétravail</button>
      <button class="btn btn-secondary" data-nav="frais">Gérer les notes de frais</button>
      <button class="btn btn-secondary" data-nav="tickets">Voir les tickets restaurant</button>
    </div>
  `;
}

function renderDashboardRH() {
  const employees = employeeRepository.getAll().filter(e => !e.archive);
  const user = authRepository.getCurrentUser();
  return `
    <div class="view-header-row">
      <div>
        <h1>Accueil</h1>
        <p class="view-subtitle">Vue d'ensemble de votre effectif</p>
      </div>
      <div class="detail-header-actions">${renderDashboardCustomizeButton()}</div>
    </div>
    ${isDashboardWidgetVisible(user, 'actionCenter') ? renderDashboardActionCenter(employees, null) : ''}
    ${renderOperationalDashboardBody(employees, null)}
    ${isDashboardWidgetVisible(user, 'shortcuts') ? renderDashboardShortcuts() : ''}
  `;
}

function renderDashboardManager() {
  const visibleIds = getVisibleEmployeeIdsForCurrentUser();
  const employees = employeeRepository.getAll().filter(e => !e.archive && visibleIds.includes(e.id));
  const user = authRepository.getCurrentUser();
  return `
    <div class="view-header-row">
      <div>
        <h1>Accueil</h1>
        <p class="view-subtitle">Vue d'ensemble de votre équipe</p>
      </div>
      <div class="detail-header-actions">${renderDashboardCustomizeButton()}</div>
    </div>
    ${isDashboardWidgetVisible(user, 'actionCenter') ? renderDashboardActionCenter(employees, visibleIds) : ''}
    ${renderOperationalDashboardBody(employees, visibleIds)}
    ${isDashboardWidgetVisible(user, 'shortcuts') ? renderDashboardShortcuts() : ''}
  `;
}

function renderDashboardSalarie(user) {
  const today = getTodayPresenceStatus(user);
  const requests = [
    ...leaveRepository.getAll().filter(r => r.employeeId === user.id).map(r => {
      const type = leaveTypeRepository.getLeaveTypeById(r.typeId);
      return { label: type ? type.nom : 'Congé', icon: type ? type.icone : '🏖️', date: r.dateDebut, statut: r.statut };
    }),
    ...teleworkRepository.getAll().filter(r => r.employeeId === user.id).map(r => ({ label: 'Télétravail', icon: '💻', date: r.dateDebut, statut: r.statut })),
    ...expenseRepository.getAll().filter(n => n.employeeId === user.id).map(n => ({ label: n.libelle || 'Note de frais', icon: '🧾', date: n.date, statut: n.statut }))
  ];
  const enAttente = requests.filter(r => r.statut === 'En attente').sort((a, b) => a.date.localeCompare(b.date));
  const aVenir = requests
    .filter(r => r.statut === 'Validé' && r.date >= toISODate(new Date()))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5);

  return `
    <div class="view-header-row">
      <div>
        <h1>Bonjour ${escapeHtml(user.prenom)}</h1>
        <p class="view-subtitle">Votre espace personnel</p>
      </div>
      <div class="detail-header-actions">${renderDashboardCustomizeButton()}</div>
    </div>

    <div class="kpi-grid">
      ${kpiCard('Statut aujourd\'hui', `${today.icon} ${today.label}`, '📅')}
      ${kpiCard('Demandes en attente', enAttente.length, '⏳')}
      ${kpiCard('Ancienneté', calculateAnciennete(user.dateEmbauche), '🎂')}
    </div>

    ${isDashboardWidgetVisible(user, 'soldes') ? `
    <div class="card">
      <h2>Mes soldes de congés</h2>
      ${renderEmployeeBalances(user)}
    </div>
    ` : ''}

    ${isDashboardWidgetVisible(user, 'mesDemandes') ? `
    <div class="dashboard-grid">
      <div class="card">
        <h2>Mes demandes en attente</h2>
        ${enAttente.length === 0 ? '<p class="text-muted">Aucune demande en attente.</p>' : `
          <div class="mini-list">
            ${enAttente.map(r => `
              <div class="mini-list-item">
                <span>${escapeHtml(r.icon)} ${escapeHtml(r.label)} · ${formatDate(r.date)}</span>
                <span class="badge badge-warning">En attente</span>
              </div>
            `).join('')}
          </div>
        `}
      </div>
      <div class="card">
        <h2>À venir</h2>
        ${aVenir.length === 0 ? '<p class="text-muted">Rien de prévu prochainement.</p>' : `
          <div class="mini-list">
            ${aVenir.map(r => `
              <div class="mini-list-item">
                <span>${escapeHtml(r.icon)} ${escapeHtml(r.label)}</span>
                <span class="text-muted">${formatDate(r.date)}</span>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    </div>
    ` : ''}

    ${isDashboardWidgetVisible(user, 'shortcuts') ? `
    <div class="card">
      <h2>Raccourcis</h2>
      <button class="btn btn-primary" data-nav="conges">Demander un congé</button>
      <button class="btn btn-secondary" data-nav="teletravail">Déclarer du télétravail</button>
      <button class="btn btn-secondary" data-nav="frais">Déposer une note de frais</button>
      <button class="btn btn-secondary" data-nav="mes-documents">Mes documents</button>
    </div>
    ` : ''}
  `;
}

function renderDashboardDirecteur() {
  const employees = employeeRepository.getAll().filter(e => !e.archive);
  const settings = settingsRepository.getSettings();
  const leaveTypes = leaveTypeRepository.getLeaveTypes();
  const leaveRequests = leaveRepository.getAll();
  const expenses = expenseRepository.getAll();
  const actifs = employees.filter(e => e.statut === 'Actif');
  const year = new Date().getFullYear();

  const turnover = calculateTurnoverRate(employees);
  const anciennete = calculateAverageAnciennete(employees);
  const absenteisme = calculateAbsenteeismRate(employees, leaveRequests, leaveTypes, year);
  const fraisValides = expenses.filter(n => (n.statut === 'Remboursé') && String(n.date).startsWith(String(year)));
  const coutFrais = fraisValides.reduce((sum, n) => sum + n.montantTTC, 0);
  const now = new Date();
  const teleworkRequests = teleworkRepository.getAll();
  const coutTickets = actifs.reduce((sum, e) => sum + calculateTicketsRestaurant(e, now.getFullYear(), now.getMonth(), leaveRequests, teleworkRequests, settings).partEmployeur, 0);
  const enAttenteToutesEtapes = [...leaveRequests, ...teleworkRepository.getAll(), ...expenses].filter(r => r.statut === 'En attente').length;

  const masseSalariale = settings.masseSalarialeActivee
    ? actifs.reduce((sum, e) => sum + (e.salaireBrutMensuel || 0), 0)
    : null;
  const ageBuckets = settings.suiviAgeActive ? getAgePyramidBuckets(employees) : null;
  const genderBreakdown = settings.suiviGenreActive ? getGenderBreakdown(employees) : null;

  const user = authRepository.getCurrentUser();
  return `
    <div class="view-header-row">
      <div>
        <h1>Accueil</h1>
        <p class="view-subtitle">Vue d'ensemble de votre effectif</p>
      </div>
      <div class="detail-header-actions">${renderDashboardCustomizeButton()}</div>
    </div>
    ${isDashboardWidgetVisible(user, 'actionCenter') ? renderDashboardActionCenter(employees, null) : ''}
    ${renderOperationalDashboardBody(employees, null)}

    ${isDashboardWidgetVisible(user, 'indicateursDirection') ? `
    <div class="view-header" style="margin-top: 8px;">
      <h2 style="margin:0;">Indicateurs Direction</h2>
      <p class="view-subtitle">Pilotage RH avancé</p>
    </div>

    <div class="kpi-grid">
      ${kpiCard('Effectif actif', actifs.length, '👥')}
      ${kpiCard('Turn-over (12 mois)', formatPercentFR(turnover), '🔄')}
      ${kpiCard('Ancienneté moyenne', `${formatNumberFR(anciennete)} an${anciennete >= 2 ? 's' : ''}`, '🎖️')}
      ${kpiCard('Absentéisme (maladie)', formatPercentFR(absenteisme), '🌡️')}
      ${kpiCard('Coût notes de frais', formatCurrencyFR(coutFrais), '🧾')}
      ${kpiCard('Coût tickets restaurant', formatCurrencyFR(coutTickets), '🍽️')}
      ${kpiCard('Demandes en attente (tous types)', enAttenteToutesEtapes, '⏳')}
      ${masseSalariale !== null ? kpiCard('Masse salariale mensuelle', formatCurrencyFR(masseSalariale), '💰') : ''}
    </div>

    <div class="dashboard-grid">
      ${ageBuckets
        ? chartCard('Pyramide des âges', genderBreakdown ? 'Par tranche d\'âge, hommes/femmes' : 'Par tranche d\'âge', renderAgePyramidSVG(ageBuckets, !!genderBreakdown))
        : chartCard('Pyramide des âges', '<p class="text-muted">Suivi désactivé dans les paramètres.</p>')}
      ${genderBreakdown ? chartCard('Répartition Hommes / Femmes', genderBreakdown.every(d => d.value === 0)
        ? emptyChartMessage()
        : renderDonutChartSVG(genderBreakdown.filter(d => d.value > 0)) + chartLegend(genderBreakdown.filter(d => d.value > 0)))
        : chartCard('Répartition Hommes / Femmes', '<p class="text-muted">Suivi désactivé dans les paramètres.</p>')}
    </div>
    ` : ''}

    ${isDashboardWidgetVisible(user, 'shortcuts') ? renderDashboardShortcuts() : ''}
  `;
}

// ---- Préparation des données des graphiques ----

const CHART_COLORS = ['var(--color-primary)', 'var(--color-success)', 'var(--color-warning)', 'var(--color-info)', 'var(--color-danger)', 'var(--color-text-muted)'];

function getServiceBreakdown(employees) {
  employees = employees || employeeRepository.getAll().filter(e => !e.archive && e.statut === 'Actif');
  const counts = {};
  employees.forEach(e => {
    const key = e.service || 'Non renseigné';
    counts[key] = (counts[key] || 0) + 1;
  });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value], i) => ({ label, value, color: CHART_COLORS[i % CHART_COLORS.length] }));
}

function getContratBreakdown(employees) {
  employees = employees || employeeRepository.getAll().filter(e => !e.archive && e.statut === 'Actif');
  const counts = {};
  employees.forEach(e => { counts[e.typeContrat] = (counts[e.typeContrat] || 0) + 1; });
  return Object.entries(counts).map(([label, value], i) => ({ label, value, color: CHART_COLORS[i % CHART_COLORS.length] }));
}

function getCongesParType(employeeIds) {
  const types = leaveTypeRepository.getLeaveTypes();
  let requests = leaveRepository.getAll().filter(r => r.statut === 'Validé');
  if (employeeIds) requests = requests.filter(r => employeeIds.includes(r.employeeId));
  const year = String(new Date().getFullYear());
  return types
    .map(t => {
      const value = requests
        .filter(r => r.typeId === t.id && r.dateDebut.startsWith(year))
        .reduce((sum, r) => sum + r.nbJours, 0);
      return { label: t.nom, value, color: t.couleur };
    })
    .filter(d => d.value > 0)
    .sort((a, b) => b.value - a.value);
}

function getTicketsCostTrend(employees) {
  employees = employees || employeeRepository.getAll().filter(e => !e.archive && e.statut === 'Actif');
  const settings = settingsRepository.getSettings();
  const leaveRequests = leaveRepository.getAll();
  const teleworkRequests = teleworkRepository.getAll();
  const now = new Date();
  const points = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const total = employees.reduce((sum, e) =>
      sum + calculateTicketsRestaurant(e, d.getFullYear(), d.getMonth(), leaveRequests, teleworkRequests, settings).partEmployeur, 0);
    points.push({ label: MONTH_NAMES[d.getMonth()].slice(0, 3), value: round2(total) });
  }
  return points;
}

function getUpcomingBirthdays(daysAhead = 60, employees, limit = 5) {
  employees = (employees || employeeRepository.getAll()).filter(e => !e.archive && e.statut === 'Actif' && e.dateNaissance);
  const now = new Date();
  // Comparé à minuit (pas l'instant courant) : sinon, le jour de son anniversaire, `next` (calculé à
  // minuit) est toujours "avant" `today` (l'heure qu'il est déjà) dès la première seconde passée
  // minuit, ce qui le fait passer directement à l'année suivante — l'employé ne serait jamais détecté
  // "aujourd'hui", et daysUntil serait faussé (fraction de journée) pour tous les autres cas aussi.
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return employees
    .map(e => {
      const birth = new Date(e.dateNaissance);
      let next = new Date(today.getFullYear(), birth.getMonth(), birth.getDate());
      if (next < today) next = new Date(today.getFullYear() + 1, birth.getMonth(), birth.getDate());
      return { employee: e, next, daysUntil: Math.round((next - today) / 86400000) };
    })
    .filter(x => x.daysUntil <= daysAhead)
    .sort((a, b) => a.daysUntil - b.daysUntil)
    .slice(0, limit);
}

function getUpcomingContractEnds(daysAhead = 60, employees, limit = 5) {
  employees = (employees || employeeRepository.getAll()).filter(e => !e.archive && e.statut === 'Actif' && e.dateFinContrat);
  const todayStr = toISODate(new Date());
  const limitStr = toISODate(addDays(new Date(), daysAhead));
  return employees
    .filter(e => e.dateFinContrat >= todayStr && e.dateFinContrat <= limitStr)
    .sort((a, b) => a.dateFinContrat.localeCompare(b.dateFinContrat))
    .slice(0, limit);
}

// Paliers "médaille du travail" usuels (20/30/35/40 ans, médailles officielles) + jalons informels
// (5/10/15/25 ans) que beaucoup d'entreprises marquent aussi — pas de liste paramétrable ici, valeur
// symbolique plutôt que légale, contrairement aux autres échéances de ce fichier.
const SENIORITY_MILESTONES = [5, 10, 15, 20, 25, 30, 35, 40];

/** Même principe que getUpcomingBirthdays (anniversaire de naissance), pour l'anniversaire
 * d'embauche — ne retient que les salariés dont le PROCHAIN anniversaire d'embauche tombe
 * exactement sur un des paliers ci-dessus (les autres années n'ont rien à fêter). */
function getUpcomingSeniorityAnniversaries(daysAhead = 60, employees, limit = 5) {
  employees = (employees || employeeRepository.getAll()).filter(e => !e.archive && e.statut === 'Actif' && e.dateEmbauche);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return employees
    .map(e => {
      const hire = new Date(e.dateEmbauche);
      let next = new Date(today.getFullYear(), hire.getMonth(), hire.getDate());
      if (next < today) next = new Date(today.getFullYear() + 1, hire.getMonth(), hire.getDate());
      const years = next.getFullYear() - hire.getFullYear();
      return { employee: e, next, years, daysUntil: Math.round((next - today) / 86400000) };
    })
    .filter(x => SENIORITY_MILESTONES.includes(x.years) && x.daysUntil <= daysAhead)
    .sort((a, b) => a.daysUntil - b.daysUntil)
    .slice(0, limit);
}

/** Entretien professionnel obligatoire (Code du travail, art. L6315-1) : au moins tous les 2 ans,
 * à défaut de date connue on part de l'embauche (= "jamais fait" équivaut à "le premier est dû 2 ans
 * après l'arrivée"). Contrairement à getUpcomingBilansSixAns, on ne recalcule pas une échéance
 * future à partir d'un jalon manqué : un entretien en retard doit apparaître EN RETARD (daysUntil
 * négatif, trié en premier), pas être silencieusement reporté à la prochaine échéance théorique. */
function getUpcomingEntretiensProfessionnels(daysAhead = 60, employees, limit = 5) {
  employees = (employees || employeeRepository.getAll()).filter(e => !e.archive && e.statut === 'Actif' && e.dateEmbauche);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return employees
    .map(e => {
      const baseline = new Date(e.dateDernierEntretienProfessionnel || e.dateEmbauche);
      const next = new Date(baseline.getFullYear() + 2, baseline.getMonth(), baseline.getDate());
      return { employee: e, next, daysUntil: Math.round((next - today) / 86400000) };
    })
    .filter(x => x.daysUntil <= daysAhead)
    .sort((a, b) => a.daysUntil - b.daysUntil)
    .slice(0, limit);
}

/** Bilan à 6 ans (Code du travail, art. L6315-1 II) : récapitulatif obligatoire tous les 6 ans
 * d'ancienneté, distinct de l'entretien biennal — pénalités (abondement CPF) si manqué dans les
 * entreprises de 50 salariés et plus. Calculé sur des multiples de 6 ans depuis l'embauche. */
function getUpcomingBilansSixAns(daysAhead = 60, employees, limit = 5) {
  employees = (employees || employeeRepository.getAll()).filter(e => !e.archive && e.statut === 'Actif' && e.dateEmbauche);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return employees
    .map(e => {
      const hire = new Date(e.dateEmbauche);
      let years = 6;
      let next = new Date(hire.getFullYear() + years, hire.getMonth(), hire.getDate());
      while (next < today) { years += 6; next = new Date(hire.getFullYear() + years, hire.getMonth(), hire.getDate()); }
      return { employee: e, next, years, daysUntil: Math.round((next - today) / 86400000) };
    })
    .filter(x => x.daysUntil <= daysAhead)
    .sort((a, b) => a.daysUntil - b.daysUntil)
    .slice(0, limit);
}

/** Contrôles de cohérence sur les salariés actifs — pas des règles bloquantes à la saisie (certains
 * champs sont volontairement facultatifs, ex. un salarié en cours d'onboarding), juste une vue qui
 * signale ce qui traînerait sinon silencieusement jusqu'à casser une paie ou une déclaration. */
function getDataQualityIssues() {
  const allEmployees = employeeRepository.getAll();
  const employees = allEmployees.filter(e => !e.archive && e.statut === 'Actif');
  const issues = [];

  const byEmail = {};
  employees.forEach(e => {
    const key = (e.email || '').trim().toLowerCase();
    if (!key) return;
    (byEmail[key] = byEmail[key] || []).push(e);
  });
  Object.values(byEmail).filter(list => list.length > 1).forEach(list => {
    issues.push({ severity: 'error', label: `Email en doublon (${list[0].email})`, employees: list });
  });

  const cddSansFin = employees.filter(e => (e.typeContrat === 'CDD' || e.typeContrat === 'Intérim') && !e.dateFinContrat);
  if (cddSansFin.length) issues.push({ severity: 'error', label: 'CDD/Intérim sans date de fin de contrat', employees: cddSansFin });

  const allById = new Map(allEmployees.map(e => [e.id, e]));
  const managerOrphelin = employees.filter(e => (e.managerIds || []).some(mid => {
    const m = allById.get(mid);
    return !m || m.archive;
  }));
  if (managerOrphelin.length) issues.push({ severity: 'warning', label: 'Manager introuvable ou archivé', employees: managerOrphelin });

  const sansEtab = employees.filter(e => !e.etablissementId);
  if (sansEtab.length) issues.push({ severity: 'warning', label: 'Sans établissement', employees: sansEtab });

  const sansService = employees.filter(e => !e.service);
  if (sansService.length) issues.push({ severity: 'warning', label: 'Sans service', employees: sansService });

  const sansNaissance = employees.filter(e => !e.dateNaissance);
  if (sansNaissance.length) issues.push({ severity: 'info', label: 'Sans date de naissance', employees: sansNaissance });

  const sansNumSecu = employees.filter(e => !e.numeroSecu);
  if (sansNumSecu.length) issues.push({ severity: 'info', label: 'Sans numéro de sécurité sociale', employees: sansNumSecu });

  return issues;
}

/** Même principe que getUpcomingContractEnds, pour la fin de période d'essai — champ existant
 * depuis le début (formulaire + fiche salarié) mais jamais consulté par le moteur de notifications. */
function getUpcomingProbationEnds(daysAhead = 60, employees, limit = 5) {
  employees = (employees || employeeRepository.getAll()).filter(e => !e.archive && e.statut === 'Actif' && e.dateFinPeriodeEssai);
  const todayStr = toISODate(new Date());
  const limitStr = toISODate(addDays(new Date(), daysAhead));
  return employees
    .filter(e => e.dateFinPeriodeEssai >= todayStr && e.dateFinPeriodeEssai <= limitStr)
    .sort((a, b) => a.dateFinPeriodeEssai.localeCompare(b.dateFinPeriodeEssai))
    .slice(0, limit);
}

// ---- Rendu des graphiques SVG (aucune librairie externe) ----

function emptyChartMessage() {
  return `<p class="text-muted">Pas encore de données.</p>`;
}

function chartCard(title, subtitleOrContent, maybeContent) {
  const hasSubtitle = maybeContent !== undefined;
  const subtitle = hasSubtitle ? subtitleOrContent : '';
  const content = hasSubtitle ? maybeContent : subtitleOrContent;
  return `
    <div class="card chart-card">
      <h2>${escapeHtml(title)}</h2>
      ${subtitle ? `<p class="text-muted chart-subtitle">${escapeHtml(subtitle)}</p>` : ''}
      ${content}
    </div>
  `;
}

function renderBarChartSVG(data) {
  const width = 480;
  const barHeight = 22;
  const gap = 12;
  const labelWidth = 130;
  const maxValue = Math.max(...data.map(d => d.value), 1);
  const chartWidth = width - labelWidth - 46;
  const height = data.length * (barHeight + gap) + gap;

  const bars = data.map((d, i) => {
    const y = gap + i * (barHeight + gap);
    const barW = Math.max((d.value / maxValue) * chartWidth, 2);
    return `
      <text x="${labelWidth - 8}" y="${y + barHeight / 2 + 4}" text-anchor="end" class="chart-label">${escapeHtml(d.label)}</text>
      <rect x="${labelWidth}" y="${y}" width="${barW}" height="${barHeight}" rx="4" fill="${escapeHtml(d.color)}" />
      <text x="${labelWidth + barW + 8}" y="${y + barHeight / 2 + 4}" class="chart-value">${d.value}</text>
    `;
  }).join('');

  return `<svg viewBox="0 0 ${width} ${height}" class="chart-svg">${bars}</svg>`;
}

function renderDonutChartSVG(data) {
  const size = 160;
  const strokeWidth = 22;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = data.reduce((sum, d) => sum + d.value, 0) || 1;
  let offset = 0;

  const segments = data.map(d => {
    const dash = (d.value / total) * circumference;
    const circle = `<circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="${escapeHtml(d.color)}" stroke-width="${strokeWidth}" stroke-dasharray="${dash} ${circumference - dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${size / 2} ${size / 2})" />`;
    offset += dash;
    return circle;
  }).join('');

  return `
    <svg viewBox="0 0 ${size} ${size}" class="chart-svg chart-donut">
      ${segments}
      <text x="${size / 2}" y="${size / 2}" text-anchor="middle" dominant-baseline="middle" class="chart-donut-total">${total}</text>
    </svg>
  `;
}

function chartLegend(data) {
  return `
    <div class="chart-legend">
      ${data.map(d => `
        <span class="chart-legend-item">
          <span class="chart-legend-swatch" style="background:${escapeHtml(d.color)}"></span>${escapeHtml(d.label)} (${d.value})
        </span>
      `).join('')}
    </div>
  `;
}

function renderLineChartSVG(points) {
  const width = 480;
  const height = 160;
  const padding = 30;
  const maxValue = Math.max(...points.map(p => p.value), 1);
  const stepX = (width - padding * 2) / (points.length - 1 || 1);

  const coords = points.map((p, i) => ({
    x: padding + i * stepX,
    y: height - padding - (p.value / maxValue) * (height - padding * 2),
    label: p.label,
    value: p.value
  }));

  const pathD = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');
  const areaD = `${pathD} L ${coords[coords.length - 1].x} ${height - padding} L ${coords[0].x} ${height - padding} Z`;
  const dots = coords.map(c => `<circle cx="${c.x}" cy="${c.y}" r="3.5" fill="var(--color-primary)" />`).join('');
  const labels = coords.map(c => `<text x="${c.x}" y="${height - padding + 18}" text-anchor="middle" class="chart-axis-label">${escapeHtml(c.label)}</text>`).join('');

  return `
    <svg viewBox="0 0 ${width} ${height}" class="chart-svg">
      <path d="${areaD}" fill="var(--color-primary-soft)" stroke="none" />
      <path d="${pathD}" fill="none" stroke="var(--color-primary)" stroke-width="2" />
      ${dots}
      ${labels}
    </svg>
  `;
}

/** Pyramide des âges : une barre par tranche si le genre n'est pas suivi, sinon deux barres miroir (hommes/femmes) de part et d'autre de l'étiquette d'âge. */
function renderAgePyramidSVG(buckets, splitByGender) {
  if (!splitByGender) {
    const data = buckets.map(b => ({ label: b.label, value: b.total, color: 'var(--color-primary)' }));
    if (data.every(d => d.value === 0)) return emptyChartMessage();
    return renderBarChartSVG(data);
  }

  if (buckets.every(b => b.hommes === 0 && b.femmes === 0 && b.autres === 0)) return emptyChartMessage();

  const width = 520;
  const barHeight = 20;
  const gap = 14;
  const centerGap = 100;
  const sideWidth = (width - centerGap) / 2 - 34;
  const centerLeft = width / 2 - centerGap / 2;
  const centerRight = width / 2 + centerGap / 2;
  const maxValue = Math.max(...buckets.map(b => Math.max(b.hommes, b.femmes)), 1);
  const height = buckets.length * (barHeight + gap) + gap;

  const rows = buckets.map((b, i) => {
    const y = gap + i * (barHeight + gap);
    const wH = Math.max((b.hommes / maxValue) * sideWidth, b.hommes > 0 ? 2 : 0);
    const wF = Math.max((b.femmes / maxValue) * sideWidth, b.femmes > 0 ? 2 : 0);
    // La pyramide n'a que 2 côtés (hommes/femmes) : plutôt que de faire disparaître silencieusement
    // les salariés "Autre"/non renseigné (cf. audit), leur nombre est annoté sur l'étiquette centrale.
    const centerLabel = `${b.label}${b.autres ? ` · +${b.autres} autre${b.autres > 1 ? 's' : ''}` : ''}`;
    return `
      <rect x="${centerLeft - wH}" y="${y}" width="${wH}" height="${barHeight}" rx="4" fill="#2563eb" />
      <text x="${centerLeft - wH - 6}" y="${y + barHeight / 2 + 4}" text-anchor="end" class="chart-value">${b.hommes || ''}</text>
      <rect x="${centerRight}" y="${y}" width="${wF}" height="${barHeight}" rx="4" fill="#db2777" />
      <text x="${centerRight + wF + 6}" y="${y + barHeight / 2 + 4}" class="chart-value">${b.femmes || ''}</text>
      <text x="${width / 2}" y="${y + barHeight / 2 + 4}" text-anchor="middle" class="chart-label">${escapeHtml(centerLabel)}</text>
    `;
  }).join('');

  return `<svg viewBox="0 0 ${width} ${height}" class="chart-svg">${rows}</svg>`;
}

// ---- Listes pratiques (anniversaires, fins de contrat) ----

function renderUpcomingBirthdaysCard(birthdays) {
  return `
    <div class="card">
      <h2>Prochains anniversaires</h2>
      ${birthdays.length === 0 ? `<p class="text-muted">Aucun anniversaire dans les 60 prochains jours.</p>` : `
        <div class="mini-list">
          ${birthdays.map(x => `
            <div class="mini-list-item">
              <span>${escapeHtml(x.employee.prenom)} ${escapeHtml(x.employee.nom)}</span>
              <span class="text-muted">${x.daysUntil === 0 ? 'Aujourd\'hui 🎂' : formatDate(toISODate(x.next))}</span>
            </div>
          `).join('')}
        </div>
      `}
    </div>
  `;
}

function renderUpcomingSeniorityCard(seniorityAnniversaries) {
  return `
    <div class="card">
      <h2>Anniversaires d'ancienneté</h2>
      ${seniorityAnniversaries.length === 0 ? `<p class="text-muted">Aucune médaille du travail dans les 30 prochains jours.</p>` : `
        <div class="mini-list">
          ${seniorityAnniversaries.map(x => `
            <div class="mini-list-item">
              <span>${escapeHtml(x.employee.prenom)} ${escapeHtml(x.employee.nom)} · ${x.years} ans</span>
              <span class="text-muted">${x.daysUntil === 0 ? 'Aujourd\'hui 🏅' : formatDate(toISODate(x.next))}</span>
            </div>
          `).join('')}
        </div>
      `}
    </div>
  `;
}

function renderUpcomingEntretiensCard(entretiens, bilans) {
  const items = [
    ...entretiens.map(x => ({ employee: x.employee, next: x.next, daysUntil: x.daysUntil, label: 'Entretien professionnel' })),
    ...bilans.map(x => ({ employee: x.employee, next: x.next, daysUntil: x.daysUntil, label: `Bilan à ${x.years} ans` }))
  ].sort((a, b) => a.daysUntil - b.daysUntil);
  return `
    <div class="card">
      <h2>Entretiens professionnels à programmer</h2>
      ${items.length === 0 ? `<p class="text-muted">Aucun entretien professionnel ou bilan à 6 ans dans les 60 prochains jours.</p>` : `
        <div class="mini-list">
          ${items.map(x => `
            <div class="mini-list-item">
              <span>${escapeHtml(x.employee.prenom)} ${escapeHtml(x.employee.nom)} · ${escapeHtml(x.label)}</span>
              <span class="${x.daysUntil < 0 ? 'text-danger' : 'text-muted'}">${x.daysUntil < 0 ? 'En retard · ' + formatDate(toISODate(x.next)) : formatDate(toISODate(x.next))}</span>
            </div>
          `).join('')}
        </div>
      `}
    </div>
  `;
}

function renderUpcomingContractEndsCard(contractEnds) {
  return `
    <div class="card">
      <h2>Fins de contrat à venir</h2>
      ${contractEnds.length === 0 ? `<p class="text-muted">Aucune fin de contrat dans les 60 prochains jours.</p>` : `
        <div class="mini-list">
          ${contractEnds.map(e => `
            <div class="mini-list-item">
              <span>${escapeHtml(e.prenom)} ${escapeHtml(e.nom)} · ${escapeHtml(e.typeContrat)}</span>
              <span class="text-muted">${formatDate(e.dateFinContrat)}</span>
            </div>
          `).join('')}
        </div>
      `}
    </div>
  `;
}

/**
 * Statut du jour d'un salarié, déduit des vraies données (congés/télétravail validés du
 * jour, jours travaillés) — aucune saisie manuelle. "Mission" n'est pas modélisée comme une
 * absence (le salarié reste présent, juste ailleurs) et n'apparaît donc pas ici.
 */
/** leaveRequests/teleworkRequests optionnels : à passer quand on appelle cette fonction en boucle (ex. renderPresenceCard) pour éviter de relire/re-trier tout le localStorage à chaque salarié. */
function getTodayPresenceStatus(employee, leaveRequests, teleworkRequests) {
  const today = toISODate(new Date());
  const weekday = WEEKDAY_LABELS[(new Date().getDay() + 6) % 7];

  if (!(employee.joursTravailles || []).includes(weekday)) {
    return { label: 'Repos', icon: '⚪', level: 'muted' };
  }

  const onLeave = (leaveRequests || leaveRepository.getAll()).find(r =>
    r.employeeId === employee.id && r.statut === 'Validé' && today >= r.dateDebut && today <= r.dateFin);
  if (onLeave) {
    const type = leaveTypeRepository.getLeaveTypeById(onLeave.typeId);
    return { label: type ? type.nom : 'Congé', icon: type ? type.icone : '🏖️', level: 'warning' };
  }

  const onTelework = (teleworkRequests || teleworkRepository.getAll()).find(r =>
    r.employeeId === employee.id && r.statut === 'Validé' && today >= r.dateDebut && today <= r.dateFin);
  if (onTelework) {
    return { label: 'Télétravail', icon: '💻', level: 'info' };
  }

  return { label: 'Présent', icon: '🏢', level: 'success' };
}

const PRESENCE_CARD_LIMIT = 30;

function renderPresenceCard() {
  const visibleIds = getVisibleEmployeeIdsForCurrentUser();
  let employees = employeeRepository.getAll().filter(e => !e.archive && e.statut === 'Actif');
  if (visibleIds !== null) employees = employees.filter(e => visibleIds.includes(e.id));

  // Récupérés une seule fois puis passés à chaque salarié — sinon getTodayPresenceStatus relit et re-trie tout le localStorage à chaque appel (mesuré : ~300ms pour 300 salariés au lieu de <5ms).
  const leaveRequests = leaveRepository.getAll();
  const teleworkRequests = teleworkRepository.getAll();

  const rows = employees
    .map(e => ({ employee: e, status: getTodayPresenceStatus(e, leaveRequests, teleworkRequests) }))
    .sort((a, b) => a.status.label === 'Présent' ? 1 : b.status.label === 'Présent' ? -1 : 0);

  const counts = {};
  rows.forEach(r => { counts[r.status.label] = (counts[r.status.label] || 0) + 1; });
  const visibleRows = rows.slice(0, PRESENCE_CARD_LIMIT);

  return `
    <div class="card">
      <h2>Présence aujourd'hui</h2>
      <p class="text-muted" style="margin-bottom: 12px;">${formatDate(toISODate(new Date()))}</p>
      <div class="badge-row" style="margin-bottom: 14px; flex-wrap: wrap;">
        ${Object.entries(counts).map(([label, count]) => `<span class="badge badge-muted">${count} ${escapeHtml(label)}</span>`).join('')}
      </div>
      ${rows.length === 0 ? '<p class="text-muted">Aucun salarié à afficher.</p>' : `
        <div class="mini-list">
          ${visibleRows.map(r => `
            <div class="mini-list-item">
              <span>${escapeHtml(r.employee.prenom)} ${escapeHtml(r.employee.nom)}</span>
              <span class="badge badge-${r.status.level}">${escapeHtml(r.status.icon)} ${escapeHtml(r.status.label)}</span>
            </div>
          `).join('')}
        </div>
        ${rows.length > visibleRows.length ? `<p class="text-muted" style="margin-top: 10px; font-size: 12px;">Affichage limité aux ${visibleRows.length} premiers (${rows.length} au total) — voir le Planning pour le détail complet.</p>` : ''}
      `}
    </div>
  `;
}

function kpiCard(label, value, icon) {
  // value/icon peuvent provenir de texte libre saisi par un administrateur (ex. nom/icône d'un
  // type de congé) — jamais interpolés sans échappement, sinon une valeur malveillante s'exécute
  // chez tout salarié dont le tableau de bord affiche cette carte.
  return `
    <div class="kpi-card">
      <div class="kpi-icon">${escapeHtml(icon)}</div>
      <div class="kpi-value">${escapeHtml(String(value))}</div>
      <div class="kpi-label">${escapeHtml(label)}</div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Vue : Liste des salariés
// ---------------------------------------------------------------------------

/**
 * Portée des salariés visibles par l'utilisateur courant selon son rôle :
 * null = aucune restriction (RH/Directeur/Comptabilité voient tout le monde),
 * sinon la liste exacte des ids autorisés (soi-même, + son équipe pour un manager).
 */
/** Salariés à proposer dans un filtre/sélecteur, restreints au périmètre de l'utilisateur courant. */
function getScopedEmployeesForFilters() {
  const employees = employeeRepository.getAll().filter(e => !e.archive);
  const visibleIds = getVisibleEmployeeIdsForCurrentUser();
  return visibleIds === null ? employees : employees.filter(e => visibleIds.includes(e.id));
}

function getVisibleEmployeeIdsForCurrentUser() {
  const user = authRepository.getCurrentUser();
  if (!user) return [];
  if ([ROLES.RH, ROLES.DIRECTEUR, ROLES.COMPTABILITE].includes(user.role)) return null;
  if (user.role === ROLES.MANAGER) {
    const team = employeeRepository.getAll().filter(e => (e.managerIds || []).includes(user.id)).map(e => e.id);
    return [user.id, ...team];
  }
  return [user.id];
}

function getFilteredSortedEmployees() {
  const settings = settingsRepository.getSettings();
  let list = employeeRepository.getAll();

  const visibleIds = getVisibleEmployeeIdsForCurrentUser();
  if (visibleIds !== null) list = list.filter(e => visibleIds.includes(e.id));

  const term = normalizeForSearch(state.search.trim());
  if (term) {
    list = list.filter(e =>
      normalizeForSearch(`${e.prenom} ${e.nom} ${e.matricule} ${e.email} ${e.poste}`).includes(term)
    );
  }
  if (state.filters.etablissementId) list = list.filter(e => e.etablissementId === state.filters.etablissementId);
  if (state.filters.service) list = list.filter(e => e.service === state.filters.service);
  if (state.filters.statutContrat) list = list.filter(e => e.typeContrat === state.filters.statutContrat);
  if (state.filters.statut) list = list.filter(e => e.statut === state.filters.statut);
  if (state.filters.favorisOnly) list = list.filter(e => favoriteRepository.isFavoriteEmployee(e.id));

  list.sort((a, b) => {
    const dir = state.sortDir === 'asc' ? 1 : -1;
    const av = (a[state.sortBy] || '').toString().toLowerCase();
    const bv = (b[state.sortBy] || '').toString().toLowerCase();
    return av.localeCompare(bv) * dir;
  });

  return { list, settings };
}

function renderEmployeesList() {
  const { list, settings } = getFilteredSortedEmployees();
  const visible = list.filter(e => !e.archive);
  const user = authRepository.getCurrentUser();
  const isManager = user.role === ROLES.MANAGER;
  const canCreate = hasPermission(user, PERMISSIONS.CREER_SALARIE);

  const { pageItems, totalPages, page, pageStart } = paginate(visible, 'employeesPage');

  return `
    <div class="view-header view-header-row">
      <div>
        <h1>${isManager ? 'Mon équipe' : 'Salariés'}</h1>
        <p class="view-subtitle">${visible.length} salarié${visible.length > 1 ? 's' : ''}</p>
      </div>
      <div class="detail-header-actions">
        <button class="btn btn-secondary" id="btn-export-employees">Exporter CSV</button>
        ${canCreate ? '<button class="btn btn-secondary" id="btn-import-employees">Importer CSV</button>' : ''}
        ${canCreate ? '<button class="btn btn-primary" id="btn-new-employee">+ Nouveau salarié</button>' : ''}
      </div>
    </div>

    <div class="toolbar card">
      <input type="text" id="filter-search" class="input" placeholder="Rechercher un nom, un poste, un matricule..." value="${escapeHtml(state.search)}">
      <select id="filter-etablissement" class="input">
        <option value="">Tous les établissements</option>
        ${etablissementRepository.getAll().map(e => `<option value="${e.id}" ${state.filters.etablissementId === e.id ? 'selected' : ''}>${escapeHtml(e.nom)}</option>`).join('')}
      </select>
      <select id="filter-service" class="input">
        <option value="">Tous les services</option>
        ${serviceRepository.getAll().map(s => `<option value="${escapeHtml(s.nom)}" ${state.filters.service === s.nom ? 'selected' : ''}>${escapeHtml(s.nom)}</option>`).join('')}
      </select>
      <select id="filter-contrat" class="input">
        <option value="">Tous les contrats</option>
        ${settings.typesContrat.map(t => `<option value="${escapeHtml(t)}" ${state.filters.statutContrat === t ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}
      </select>
      <select id="filter-statut" class="input">
        <option value="">Tous les statuts</option>
        <option value="Actif" ${state.filters.statut === 'Actif' ? 'selected' : ''}>Actif</option>
        <option value="Inactif" ${state.filters.statut === 'Inactif' ? 'selected' : ''}>Inactif</option>
      </select>
      <button type="button" class="btn ${state.filters.favorisOnly ? 'btn-primary' : 'btn-secondary'} btn-sm" id="btn-toggle-favoris-filter">⭐ Favoris</button>
    </div>

    <div class="card table-card">
      ${visible.length === 0 ? renderEmptyState() : `
        <table class="table">
          <thead>
            <tr>
              <th data-sort="nom">Salarié</th>
              <th data-sort="poste">Poste</th>
              <th data-sort="service">Service</th>
              <th data-sort="typeContrat">Contrat</th>
              <th>Ancienneté</th>
              <th data-sort="statut">Statut</th>
            </tr>
          </thead>
          <tbody>
            ${pageItems.map(renderEmployeeRow).join('')}
          </tbody>
        </table>
        ${renderPaginationControls(page, totalPages, pageStart, pageItems.length, visible.length)}
      `}
    </div>
  `;
}

/** Pagination générique réutilisée par toute liste longue (salariés, demandes de congé, notes de frais...). Corrige au passage une page hors bornes (ex. après un filtre qui réduit le nombre de résultats). */
function paginate(list, pageStateKey) {
  const totalPages = Math.max(1, Math.ceil(list.length / LIST_PAGE_SIZE));
  if (state[pageStateKey] > totalPages) state[pageStateKey] = totalPages;
  if (state[pageStateKey] < 1) state[pageStateKey] = 1;
  const page = state[pageStateKey];
  const pageStart = (page - 1) * LIST_PAGE_SIZE;
  return { pageItems: list.slice(pageStart, pageStart + LIST_PAGE_SIZE), totalPages, page, pageStart };
}

function renderPaginationControls(page, totalPages, pageStart, pageCount, total) {
  if (totalPages <= 1) return '';
  return `
    <div class="pagination-bar">
      <p class="text-muted">${pageStart + 1}–${pageStart + pageCount} sur ${total}</p>
      <div class="pagination-controls">
        <button type="button" class="btn btn-secondary btn-sm" id="btn-page-prev" ${page <= 1 ? 'disabled' : ''}>← Précédent</button>
        <span class="text-muted">Page ${page} / ${totalPages}</span>
        <button type="button" class="btn btn-secondary btn-sm" id="btn-page-next" ${page >= totalPages ? 'disabled' : ''}>Suivant →</button>
      </div>
    </div>
  `;
}

function renderEmployeeRow(e) {
  return `
    <tr class="table-row" data-id="${e.id}" tabindex="0" role="button" aria-label="Voir la fiche de ${escapeHtml(e.prenom)} ${escapeHtml(e.nom)}">
      <td>
        <div class="employee-cell">
          ${renderAvatar(e)}
          <div>
            <div class="employee-name">${favoriteRepository.isFavoriteEmployee(e.id) ? '⭐ ' : ''}${escapeHtml(e.prenom)} ${escapeHtml(e.nom)}</div>
            <div class="employee-matricule">${escapeHtml(e.matricule)}</div>
          </div>
        </div>
      </td>
      <td>${escapeHtml(e.poste || '—')}</td>
      <td>${escapeHtml(e.service || '—')}</td>
      <td>${renderContratBadge(e.typeContrat)}</td>
      <td>${calculateAnciennete(e.dateEmbauche)}</td>
      <td>${renderStatutBadge(e.statut)}</td>
    </tr>
  `;
}

/** Exporte la liste visible (déjà filtrée/scopée par rôle) — pas les archivés, pas les champs confidentiels. */
// ---------------------------------------------------------------------------
// Import de masse de salariés (CSV) — même esprit que l'export ci-dessous mais dans l'autre sens :
// gros gain à l'arrivée d'une nouvelle entreprise sur Nexus (dizaines de salariés à saisir un par
// un sinon). Volontairement CSV uniquement pour cette v1 (pas de .xlsx : nécessiterait une
// dépendance externe — SheetJS ou équivalent — non présente dans ce projet 100% vanilla JS ; un
// export Excel→CSV reste à un clic pour l'utilisateur).
// ---------------------------------------------------------------------------

/** Alias reconnus par en-tête (normalisés via normalizeForSearch, donc déjà insensibles à la casse
 * et aux accents) — couvre le format généré par exportEmployeesCSV ci-dessous ET quelques
 * variantes anglophones/informelles courantes dans un tableur importé de l'extérieur. */
const IMPORT_EMPLOYEE_FIELD_ALIASES = {
  matricule: ['matricule', 'id', 'employee id', 'identifiant'],
  nom: ['nom', 'lastname', 'last name', 'surname', 'nom de famille'],
  prenom: ['prenom', 'firstname', 'first name', 'given name'],
  email: ['email', 'e-mail', 'mail', 'adresse email', 'adresse e-mail'],
  telephone: ['telephone', 'tel', 'phone', 'mobile', 'portable'],
  poste: ['poste', 'job title', 'fonction', 'metier', 'job'],
  service: ['service', 'department', 'departement'],
  equipe: ['equipe', 'team'],
  typeContrat: ['type de contrat', 'contrat', 'contract type', 'contract'],
  dateEmbauche: ["date d'embauche", 'date embauche', 'hire date', "date d'entree", 'date entree'],
  dateNaissance: ['date de naissance', 'birthdate', 'date naissance', 'date of birth']
};

function parseCSVText(text) {
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'));
  const delimiter = firstLine.includes(';') ? ';' : ',';
  const lines = text.split(/\r?\n/).filter(l => l.length > 0);
  const parseLine = (line) => {
    const cells = [];
    let cur = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; } }
        else cur += c;
      } else if (c === '"') inQuotes = true;
      else if (c === delimiter) { cells.push(cur); cur = ''; }
      else cur += c;
    }
    cells.push(cur);
    return cells;
  };
  return lines.map(parseLine);
}

function guessEmployeeColumnMapping(headers) {
  const mapping = {};
  headers.forEach((h, i) => {
    const norm = normalizeForSearch(h);
    for (const [field, aliases] of Object.entries(IMPORT_EMPLOYEE_FIELD_ALIASES)) {
      if (mapping[field] === undefined && aliases.some(a => normalizeForSearch(a) === norm)) { mapping[field] = i; break; }
    }
  });
  return mapping;
}

/** Aucune date d'un tableur externe n'arrive garantie au format ISO (YYYY-MM-DD) attendu partout
 * ailleurs dans Nexus — accepte aussi le format français JJ/MM/AAAA le plus courant à l'export
 * Excel, sans quoi la quasi-totalité des lignes importées échoueraient sur ce seul champ. */
function parseImportDate(value) {
  if (!value) return '';
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const frMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (frMatch) return `${frMatch[3]}-${frMatch[2].padStart(2, '0')}-${frMatch[1].padStart(2, '0')}`;
  return '';
}

const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Construit l'aperçu ligne par ligne : statut 'ok' (prêt à créer), 'duplicate' (email déjà utilisé
 * par un salarié actif — ignoré par défaut, jamais de doublon silencieux) ou 'error' (champ
 * obligatoire manquant/invalide). N'écrit rien — la création réelle se fait dans importEmployeesRows. */
function buildImportPreviewRows(dataRows, mapping) {
  const existingEmails = new Set(
    employeeRepository.getAll().filter(e => !e.archive && e.email).map(e => normalizeForSearch(e.email))
  );
  const seenInFile = new Set();
  return dataRows.map((cells, i) => {
    const get = (field) => (mapping[field] !== undefined ? (cells[mapping[field]] || '').trim() : '');
    const record = {
      matricule: get('matricule'),
      nom: get('nom'),
      prenom: get('prenom'),
      email: get('email'),
      telephone: get('telephone'),
      poste: get('poste'),
      service: get('service'),
      equipe: get('equipe'),
      typeContrat: get('typeContrat') || 'CDI',
      dateEmbauche: parseImportDate(get('dateEmbauche')),
      dateNaissance: parseImportDate(get('dateNaissance'))
    };
    let status = 'ok', message = '';
    const emailKey = normalizeForSearch(record.email);
    if (!record.nom || !record.prenom || !record.email || !record.dateEmbauche) {
      status = 'error'; message = 'Nom, prénom, email et date d\'embauche sont obligatoires.';
    } else if (!EMAIL_FORMAT_REGEX.test(record.email)) {
      status = 'error'; message = 'Email invalide.';
    } else if (existingEmails.has(emailKey) || seenInFile.has(emailKey)) {
      status = 'duplicate'; message = 'Email déjà utilisé — ligne ignorée.';
    }
    if (status !== 'error' && emailKey) seenInFile.add(emailKey);
    return { rowIndex: i + 2, record, status, message }; // +2 : ligne 1 = en-têtes, humains comptent depuis 1
  });
}

function importEmployeesRows(previewRows) {
  const results = { created: 0, skipped: 0, errors: 0 };
  previewRows.filter(r => r.status === 'ok').forEach(r => {
    employeeRepository.create(r.record);
    results.created++;
  });
  results.skipped = previewRows.filter(r => r.status === 'duplicate').length;
  results.errors = previewRows.filter(r => r.status === 'error').length;
  return results;
}

function openImportSalariesModal() {
  const html = `
    <div class="modal modal-large">
      <div class="modal-header">
        <h2>Importer des salariés (CSV)</h2>
        <button class="btn-icon" id="btn-close-modal" aria-label="Fermer" title="Fermer">✕</button>
      </div>
      <div class="modal-body">
        <p class="text-muted">Fichier CSV (export Excel/Google Sheets). Colonnes reconnues automatiquement par en-tête : Nom, Prénom, Email, Téléphone, Poste, Service, Équipe, Type de contrat, Date d'embauche, Date de naissance — Nom/Prénom/Email/Date d'embauche sont obligatoires.</p>
        <input type="file" id="f-import-file" accept=".csv,text/csv">
        <div id="import-preview-zone" style="margin-top: 16px;"></div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Fermer</button>
        <button type="button" class="btn btn-primary" id="btn-confirm-import" style="display: none;">Importer</button>
      </div>
    </div>
  `;
  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = html;
  modalRoot.classList.add('open');
  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);

  let currentPreview = [];

  document.getElementById('f-import-file').addEventListener('change', (evt) => {
    const file = evt.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCSVText(String(reader.result));
      if (rows.length < 2) {
        document.getElementById('import-preview-zone').innerHTML = `<p class="login-error" role="alert">Fichier vide ou illisible (au moins une ligne d'en-têtes + une ligne de données attendues).</p>`;
        return;
      }
      const [headerRow, ...dataRows] = rows;
      const mapping = guessEmployeeColumnMapping(headerRow);
      currentPreview = buildImportPreviewRows(dataRows, mapping);
      renderImportPreview(currentPreview, mapping, headerRow);
    };
    reader.readAsText(file, 'UTF-8');
  });

  function renderImportPreview(preview, mapping, headerRow) {
    const okCount = preview.filter(r => r.status === 'ok').length;
    const dupCount = preview.filter(r => r.status === 'duplicate').length;
    const errCount = preview.filter(r => r.status === 'error').length;
    // Colonnes présentes dans le FICHIER qui ne correspondent à aucun champ reconnu (ex. en-tête mal
    // orthographié) — pas l'inverse (un champ optionnel simplement absent du fichier, ex. téléphone,
    // n'est jamais une anomalie à signaler ici).
    const mappedIndexes = new Set(Object.values(mapping));
    const unmapped = headerRow.filter((h, i) => !mappedIndexes.has(i));
    document.getElementById('import-preview-zone').innerHTML = `
      ${unmapped.length ? `<p class="field-warning visible">⚠ Colonnes non reconnues dans le fichier : ${unmapped.map(f => escapeHtml(f)).join(', ')} — ces colonnes seront ignorées.</p>` : ''}
      <p><span class="badge badge-success">${okCount} à créer</span> <span class="badge badge-warning">${dupCount} doublon${dupCount > 1 ? 's' : ''} ignoré${dupCount > 1 ? 's' : ''}</span> <span class="badge badge-danger">${errCount} erreur${errCount > 1 ? 's' : ''}</span></p>
      <div class="table-scroll">
        <table class="table">
          <thead><tr><th>Ligne</th><th>Nom</th><th>Prénom</th><th>Email</th><th>Date d'embauche</th><th>Statut</th></tr></thead>
          <tbody>
            ${preview.map(r => `
              <tr>
                <td>${r.rowIndex}</td>
                <td>${escapeHtml(r.record.nom)}</td>
                <td>${escapeHtml(r.record.prenom)}</td>
                <td>${escapeHtml(r.record.email)}</td>
                <td>${escapeHtml(r.record.dateEmbauche)}</td>
                <td>${r.status === 'ok'
                  ? '<span class="badge badge-success">OK</span>'
                  : r.status === 'duplicate'
                    ? `<span class="badge badge-warning" title="${escapeHtml(r.message)}">Doublon</span>`
                    : `<span class="badge badge-danger" title="${escapeHtml(r.message)}">Erreur</span>`}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
    const confirmBtn = document.getElementById('btn-confirm-import');
    confirmBtn.style.display = okCount > 0 ? 'inline-block' : 'none';
    confirmBtn.textContent = `Importer ${okCount} salarié${okCount > 1 ? 's' : ''}`;
    confirmBtn.onclick = () => {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Import en cours...';
      const results = importEmployeesRows(currentPreview);
      auditLogRepository.logAudit('Création', 'Salariés (import CSV)', `${results.created} créé${results.created > 1 ? 's' : ''}, ${results.skipped} doublon${results.skipped > 1 ? 's' : ''} ignoré${results.skipped > 1 ? 's' : ''}, ${results.errors} erreur${results.errors > 1 ? 's' : ''}`);
      document.getElementById('import-preview-zone').innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">✅</div>
          <p><strong>${results.created}</strong> salarié${results.created > 1 ? 's' : ''} créé${results.created > 1 ? 's' : ''}, ${results.skipped} doublon${results.skipped > 1 ? 's' : ''} ignoré${results.skipped > 1 ? 's' : ''}, ${results.errors} erreur${results.errors > 1 ? 's' : ''}.</p>
        </div>
      `;
      confirmBtn.style.display = 'none';
      document.getElementById('f-import-file').style.display = 'none';
      render();
    };
  }
}

function exportEmployeesCSV() {
  const { list } = getFilteredSortedEmployees();
  const visible = list.filter(e => !e.archive);
  const headers = ['Matricule', 'Nom', 'Prénom', 'Email', 'Téléphone', 'Poste', 'Service', 'Équipe', 'Type de contrat', 'Date d\'embauche', 'Ancienneté', 'Statut'];
  const rows = visible.map(e => [
    e.matricule, e.nom, e.prenom, e.email, e.telephone, e.poste, e.service, e.equipe,
    e.typeContrat, formatDate(e.dateEmbauche), calculateAnciennete(e.dateEmbauche), e.statut
  ]);
  exportRowsToCSV(headers, rows, 'salaries.csv');
  auditLogRepository.logAudit('Export', 'Salariés', `${visible.length} salarié${visible.length > 1 ? 's' : ''}`);
}

function renderAvatar(e) {
  if (e.photo) {
    return `<img class="avatar" src="${e.photo}" alt="">`;
  }
  return `<div class="avatar avatar-initials">${escapeHtml(getInitials(e.prenom, e.nom))}</div>`;
}

function renderContratBadge(type) {
  const map = { CDI: 'success', CDD: 'warning', Stage: 'info', Alternance: 'info', Apprentissage: 'info', Intérim: 'muted' };
  return `<span class="badge badge-${map[type] || 'muted'}">${escapeHtml(type || '—')}</span>`;
}

function renderStatutBadge(statut) {
  return `<span class="badge badge-${statut === 'Actif' ? 'success' : 'muted'}">${escapeHtml(statut)}</span>`;
}

function renderEmptyState() {
  return `
    <div class="empty-state">
      <div class="empty-icon">🔍</div>
      <p>Aucun salarié ne correspond à votre recherche.</p>
    </div>
  `;
}

function bindEmployeesListEvents() {
  const searchInput = document.getElementById('filter-search');
  searchInput.addEventListener('input', (e) => {
    state.search = e.target.value;
    state.employeesPage = 1;
    render();
    document.getElementById('filter-search').focus();
    const pos = e.target.selectionStart;
    document.getElementById('filter-search').setSelectionRange(pos, pos);
  });

  document.getElementById('filter-etablissement').addEventListener('change', (e) => {
    state.filters.etablissementId = e.target.value;
    state.employeesPage = 1;
    render();
  });
  document.getElementById('filter-service').addEventListener('change', (e) => {
    state.filters.service = e.target.value;
    state.employeesPage = 1;
    render();
  });
  document.getElementById('filter-contrat').addEventListener('change', (e) => {
    state.filters.statutContrat = e.target.value;
    state.employeesPage = 1;
    render();
  });
  document.getElementById('filter-statut').addEventListener('change', (e) => {
    state.filters.statut = e.target.value;
    state.employeesPage = 1;
    render();
  });
  document.getElementById('btn-toggle-favoris-filter').addEventListener('click', () => {
    state.filters.favorisOnly = !state.filters.favorisOnly;
    state.employeesPage = 1;
    render();
  });

  const prevPageBtn = document.getElementById('btn-page-prev');
  if (prevPageBtn) prevPageBtn.addEventListener('click', () => { state.employeesPage -= 1; render(); });
  const nextPageBtn = document.getElementById('btn-page-next');
  if (nextPageBtn) nextPageBtn.addEventListener('click', () => { state.employeesPage += 1; render(); });

  const newEmployeeBtn = document.getElementById('btn-new-employee');
  if (newEmployeeBtn) newEmployeeBtn.addEventListener('click', () => openEmployeeModal(null));
  const importEmployeesBtn = document.getElementById('btn-import-employees');
  if (importEmployeesBtn) importEmployeesBtn.addEventListener('click', openImportSalariesModal);

  document.getElementById('btn-export-employees').addEventListener('click', exportEmployeesCSV);

  document.querySelectorAll('.table-row').forEach(row => {
    row.addEventListener('click', () => navigateTo('employee-detail', { currentEmployeeId: row.dataset.id }));
  });

  document.querySelectorAll('[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (state.sortBy === col) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortBy = col;
        state.sortDir = 'asc';
      }
      render();
    });
  });
}

// ---------------------------------------------------------------------------
// Vue : Organigramme
// ---------------------------------------------------------------------------

/**
 * Construit l'arbre hiérarchique à partir des managers réels des salariés. Un salarié avec
 * plusieurs managers apparaît sous le premier de sa liste (ligne hiérarchique principale) ;
 * les autres restent visibles sur sa fiche mais ne dupliquent pas le nœud dans l'arbre.
 */
function buildOrgTree(employees) {
  const byId = new Map(employees.map(e => [e.id, e]));
  const childrenOf = new Map();
  const roots = [];

  employees.forEach(e => {
    const primaryManagerId = (e.managerIds || [])[0];
    if (primaryManagerId && byId.has(primaryManagerId)) {
      if (!childrenOf.has(primaryManagerId)) childrenOf.set(primaryManagerId, []);
      childrenOf.get(primaryManagerId).push(e);
    } else {
      roots.push(e);
    }
  });

  // Défense contre un cycle manager<->manager (ex. A manager de B ET B manager de A) : sans ça, les
  // membres du cycle ne sont jamais atteignables depuis `roots`, et disparaissent silencieusement.
  // Remonte la chaîne de managers de chaque salarié ; si elle boucle sur elle-même, casse le cycle
  // À UN SEUL ENDROIT précis (le salarié où la boucle est détectée devient une racine, retiré de la
  // liste des enfants de SON manager) — sans toucher aux autres membres du cycle ni à leurs
  // subordonnés légitimes, qui restent correctement rattachés (une première version de ce
  // correctif détachait À TORT tout le monde en aval d'un manager pris dans le cycle).
  const resolved = new Set(); // remonte correctement jusqu'à un vrai root, rien à faire
  const brokenAt = new Set(); // déjà promu en racine pour casser un cycle

  employees.forEach(start => {
    if (resolved.has(start.id) || brokenAt.has(start.id)) return;
    const path = [];
    let current = start;
    while (true) {
      if (resolved.has(current.id) || brokenAt.has(current.id)) {
        path.forEach(id => resolved.add(id));
        return;
      }
      const cycleIndex = path.indexOf(current.id);
      if (cycleIndex !== -1) {
        const cycleStartId = path[cycleIndex];
        const cycleStart = byId.get(cycleStartId);
        const managerId = (cycleStart.managerIds || [])[0];
        if (managerId && childrenOf.has(managerId)) {
          childrenOf.set(managerId, childrenOf.get(managerId).filter(c => c.id !== cycleStartId));
        }
        roots.push(cycleStart);
        brokenAt.add(cycleStartId);
        path.forEach(id => { if (id !== cycleStartId) resolved.add(id); });
        return;
      }
      path.push(current.id);
      const managerId = (current.managerIds || [])[0];
      if (!managerId || !byId.has(managerId)) {
        path.forEach(id => resolved.add(id));
        return;
      }
      current = byId.get(managerId);
    }
  });

  return { roots, childrenOf };
}

function renderOrganigramme() {
  const f = state.organigrammeFilters;
  let employees = employeeRepository.getAll().filter(e => !e.archive && e.statut === 'Actif');

  const term = normalizeForSearch(f.search.trim());
  if (term) employees = employees.filter(e => normalizeForSearch(`${e.prenom} ${e.nom} ${e.poste}`).includes(term));
  if (f.etablissementId) employees = employees.filter(e => e.etablissementId === f.etablissementId);
  if (f.service) employees = employees.filter(e => e.service === f.service);
  if (f.equipe) employees = employees.filter(e => e.equipe === f.equipe);

  const { roots, childrenOf } = buildOrgTree(employees);
  const allEquipes = Array.from(new Set(serviceRepository.getAll().flatMap(s => s.equipes.map(eq => eq.nom))));

  return `
    <div class="view-header">
      <h1>Organigramme</h1>
      <p class="view-subtitle">${employees.length} salarié${employees.length > 1 ? 's' : ''} actif${employees.length > 1 ? 's' : ''}</p>
    </div>
    <div class="toolbar card">
      <input type="text" id="org-filter-search" class="input" placeholder="Rechercher une personne..." value="${escapeHtml(f.search)}">
      <select id="org-filter-etablissement" class="input">
        <option value="">Tous les établissements</option>
        ${etablissementRepository.getAll().map(e => `<option value="${e.id}" ${f.etablissementId === e.id ? 'selected' : ''}>${escapeHtml(e.nom)}</option>`).join('')}
      </select>
      <select id="org-filter-service" class="input">
        <option value="">Tous les services</option>
        ${serviceRepository.getAll().map(s => `<option value="${escapeHtml(s.nom)}" ${f.service === s.nom ? 'selected' : ''}>${escapeHtml(s.nom)}</option>`).join('')}
      </select>
      <select id="org-filter-equipe" class="input">
        <option value="">Toutes les équipes</option>
        ${allEquipes.map(nom => `<option value="${escapeHtml(nom)}" ${f.equipe === nom ? 'selected' : ''}>${escapeHtml(nom)}</option>`).join('')}
      </select>
    </div>
    <div class="card org-chart-card">
      ${employees.length === 0 ? `<div class="empty-state"><div class="empty-icon">🗂️</div><p>Aucun salarié ne correspond à ces filtres.</p></div>` : `
        <ul class="org-tree">
          ${roots.map(r => renderOrgNode(r, childrenOf)).join('')}
        </ul>
      `}
    </div>
  `;
}

function renderOrgNode(employee, childrenOf) {
  const children = childrenOf.get(employee.id) || [];
  const hasChildren = children.length > 0;
  const isCollapsed = state.orgCollapsedIds.has(employee.id);
  return `
    <li>
      <div class="org-node" data-org-employee="${employee.id}" tabindex="0" role="button" aria-label="Voir la fiche de ${escapeHtml(employee.prenom)} ${escapeHtml(employee.nom)}">
        ${hasChildren ? `<button type="button" class="org-node-toggle" data-org-toggle="${employee.id}" aria-label="${isCollapsed ? 'Déplier' : 'Replier'} les subordonnés" title="${isCollapsed ? 'Déplier' : 'Replier'}">${isCollapsed ? '▸' : '▾'}</button>` : ''}
        ${renderAvatar(employee)}
        <div class="org-node-name">${escapeHtml(employee.prenom)} ${escapeHtml(employee.nom)}</div>
        <div class="org-node-poste">${escapeHtml(employee.poste || '—')}</div>
        <span class="badge badge-info">${escapeHtml(ROLE_LABELS[employee.role] || employee.role)}</span>
      </div>
      ${hasChildren && !isCollapsed ? `<ul>${children.map(c => renderOrgNode(c, childrenOf)).join('')}</ul>` : ''}
    </li>
  `;
}

function bindOrganigrammeEvents() {
  document.querySelectorAll('[data-org-employee]').forEach(node => {
    node.addEventListener('click', () => navigateTo('employee-detail', { currentEmployeeId: node.dataset.orgEmployee }));
  });

  document.querySelectorAll('[data-org-toggle]').forEach(btn => {
    btn.addEventListener('click', (evt) => {
      evt.stopPropagation(); // ne doit pas déclencher l'ouverture de la fiche du nœud parent
      const id = btn.dataset.orgToggle;
      if (state.orgCollapsedIds.has(id)) state.orgCollapsedIds.delete(id); else state.orgCollapsedIds.add(id);
      render();
    });
  });

  const searchInput = document.getElementById('org-filter-search');
  searchInput.addEventListener('input', (e) => {
    state.organigrammeFilters.search = e.target.value;
    render();
    document.getElementById('org-filter-search').focus();
    const pos = e.target.selectionStart;
    document.getElementById('org-filter-search').setSelectionRange(pos, pos);
  });
  document.getElementById('org-filter-etablissement').addEventListener('change', (e) => {
    state.organigrammeFilters.etablissementId = e.target.value;
    render();
  });
  document.getElementById('org-filter-service').addEventListener('change', (e) => {
    state.organigrammeFilters.service = e.target.value;
    render();
  });
  document.getElementById('org-filter-equipe').addEventListener('change', (e) => {
    state.organigrammeFilters.equipe = e.target.value;
    render();
  });
}

// ---------------------------------------------------------------------------
// Coffre-fort documents RH — partagé entre la fiche salarié et "Mes documents"
// ---------------------------------------------------------------------------

/** Upload/suppression réservés à RH et Directeur ; la consultation suit l'accès normal à la fiche. */
function canManageDocumentsFor() {
  const user = authRepository.getCurrentUser();
  return Boolean(user && (user.role === ROLES.RH || user.role === ROLES.DIRECTEUR));
}

function documentExpirationInfo(dateExpiration) {
  if (!dateExpiration) return null;
  // Même correction que syncNotifications : comparer au format date-only des deux côtés.
  const daysUntil = Math.round((new Date(dateExpiration) - new Date(toISODate(new Date()))) / 86400000);
  if (daysUntil < 0) return { label: `Expiré le ${formatDate(dateExpiration)}`, level: 'danger' };
  if (daysUntil <= 30) return { label: `Expire le ${formatDate(dateExpiration)}`, level: 'warning' };
  return { label: `Expire le ${formatDate(dateExpiration)}`, level: 'muted' };
}

function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function renderDocumentRow(doc, canManage) {
  const expiration = documentExpirationInfo(doc.dateExpiration);
  return `
    <div class="mini-list-item">
      <span>${escapeHtml(doc.categorie)} · ${escapeHtml(doc.nom)}</span>
      <span class="detail-header-actions">
        ${expiration ? `<span class="badge badge-${expiration.level}">${escapeHtml(expiration.label)}</span>` : ''}
        ${doc.fichier ? `<button type="button" class="btn-link" data-download-document="${doc.id}">Télécharger</button>` : ''}
        ${canManage ? `<button type="button" class="btn-link btn-link-danger" data-delete-document="${doc.id}">Supprimer</button>` : ''}
      </span>
    </div>
  `;
}

function bindDocumentRowEvents(scopeSelector) {
  document.querySelectorAll(`${scopeSelector} [data-download-document]`).forEach(btn => {
    btn.addEventListener('click', () => {
      const doc = documentRepository.getById(btn.dataset.downloadDocument);
      if (doc && doc.fichier) downloadDataUrl(doc.fichier.dataUrl, doc.fichier.nom);
    });
  });
  document.querySelectorAll(`${scopeSelector} [data-delete-document]`).forEach(btn => {
    btn.addEventListener('click', () => {
      const doc = documentRepository.getById(btn.dataset.deleteDocument);
      openConfirm({
        title: 'Supprimer ce document ?',
        message: `"${doc.nom}" sera définitivement supprimé.`,
        confirmLabel: 'Supprimer',
        danger: true,
        onConfirm: () => {
          documentRepository.delete(doc.id);
          showToast('Document supprimé.');
          render();
        }
      });
    });
  });
}

function renderEmployeeDocumentsCard(employee) {
  const documents = documentRepository.getForEmployee(employee.id);
  const canManage = canManageDocumentsFor();

  return `
    <div class="card">
      <div class="view-header-row">
        <h2>Documents</h2>
        ${canManage ? '<button class="btn btn-secondary btn-sm" id="btn-add-document">+ Ajouter un document</button>' : ''}
      </div>
      <div id="employee-documents-list">
        ${documents.length === 0 ? '<p class="text-muted">Aucun document.</p>' : documents.map(d => renderDocumentRow(d, canManage)).join('')}
      </div>
    </div>
  `;
}

function bindEmployeeDocumentsEvents(employeeId) {
  const addBtn = document.getElementById('btn-add-document');
  if (addBtn) addBtn.addEventListener('click', () => openDocumentModal(employeeId));
  bindDocumentRowEvents('#employee-documents-list');
}

function openDocumentModal(employeeId) {
  const settings = settingsRepository.getSettings();
  state.pendingAttachment = null;

  const html = `
    <div class="modal">
      <div class="modal-header">
        <h2>Ajouter un document</h2>
        <button class="btn-icon" id="btn-close-modal" aria-label="Fermer" title="Fermer">✕</button>
      </div>
      <form id="document-form">
        <div class="modal-body">
          <div class="form-grid">
            ${selectField('categorie', 'Catégorie', settings.categoriesDocuments, settings.categoriesDocuments[0])}
            ${textField('nom', 'Nom du document', '', true)}
            ${textField('dateExpiration', 'Date d\'expiration (optionnel)', '', false, 'date')}
          </div>
          <div class="form-field" style="margin-top: 14px;">
            <label for="f-fichier">Fichier</label>
            <input class="input" type="file" id="f-fichier" required>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Annuler</button>
          <button type="submit" class="btn btn-primary">Ajouter</button>
        </div>
      </form>
    </div>
  `;

  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = html;
  modalRoot.classList.add('open');

  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
  document.getElementById('f-fichier').addEventListener('change', handleAttachmentChange);
  document.getElementById('document-form').addEventListener('submit', (evt) => {
    evt.preventDefault();
    if (!state.pendingAttachment) {
      showToast('Sélectionnez un fichier.', 'error');
      return;
    }
    const formData = new FormData(evt.target);
    documentRepository.create({
      employeeId,
      categorie: formData.get('categorie'),
      nom: formData.get('nom'),
      dateExpiration: formData.get('dateExpiration') || '',
      fichier: state.pendingAttachment
    });
    showToast('Document ajouté.');
    closeModal();
    navigateTo('employee-detail', { currentEmployeeId: employeeId });
  });
}

// ---- Vue : Mes documents (libre-service Salarié, lecture + téléchargement uniquement) ----

function renderMesDocuments() {
  const user = authRepository.getCurrentUser();
  const documents = documentRepository.getForEmployee(user.id);

  return `
    <div class="view-header">
      <h1>Mes documents</h1>
      <p class="view-subtitle">${documents.length} document${documents.length > 1 ? 's' : ''}</p>
    </div>
    <div class="card">
      <div id="mes-documents-list">
        ${documents.length === 0 ? '<p class="text-muted">Aucun document pour le moment.</p>' : documents.map(d => renderDocumentRow(d, false)).join('')}
      </div>
    </div>
  `;
}

function bindMesDocumentsEvents() {
  bindDocumentRowEvents('#mes-documents-list');
}

// ---------------------------------------------------------------------------
// Tickets support (Phase 2 sprint amélioration RH, §16-17) — envoyés à BERTOLIS
// ---------------------------------------------------------------------------

// §sprint suivi de livraison : ouvert/en_cours/resolu/ferme existaient déjà (0017), "livre" est
// nouveau (0018) — ferme devient une clôture hors parcours normal (annulé/doublon), pas une étape.
const TICKET_STATUT_LABELS = { ouvert: 'Nouvelle demande', en_cours: 'En cours', resolu: 'Terminé', livre: 'Livré', ferme: 'Fermé' };
const TICKET_STATUT_BADGE_CLASS = { ouvert: 'info', en_cours: 'warning', resolu: 'success', livre: 'success', ferme: 'muted' };
const TICKET_CATEGORIES = ['Anomalie', 'Question', 'Suggestion', 'Autre'];

/** Libellé humain de l'écran courant, utilisé comme contexte auto-capturé à la création d'un
 * ticket — pas de capture d'écran (décision actée précédemment pour des raisons de confidentialité
 * RH), juste de quoi orienter BERTOLIS sans que le salarié ait à le décrire lui-même. */
function currentViewLabel() {
  const item = NAV_ITEMS.find(i => i.key === state.view);
  return item ? item.label : state.view;
}

function openSupportTicketModal() {
  state.pendingAttachment = null;
  const contexteLabel = currentViewLabel();
  const html = `
    <div class="modal modal-small">
      <div class="modal-header">
        <h2>Signaler un problème / demander de l'aide</h2>
        <button class="btn-icon" id="btn-close-modal" aria-label="Fermer" title="Fermer">✕</button>
      </div>
      <form id="support-ticket-form">
        <div class="modal-body">
          <p class="text-muted" style="margin-top:0;">Contexte transmis automatiquement : <strong>${escapeHtml(contexteLabel)}</strong></p>
          <div class="form-field">
            <label for="f-ticket-titre">Titre *</label>
            <input class="input" type="text" id="f-ticket-titre" placeholder="Résumez votre problème en quelques mots" required>
          </div>
          <div class="form-field" style="margin-top:12px;">
            <label for="f-ticket-description">Description</label>
            <textarea class="input" id="f-ticket-description" rows="4" placeholder="Décrivez le problème, ce que vous attendiez, ce qui s'est passé..."></textarea>
          </div>
          <div class="form-grid" style="margin-top:12px;">
            <div class="form-field">
              <label for="f-ticket-categorie">Catégorie</label>
              <select class="input" id="f-ticket-categorie">
                ${TICKET_CATEGORIES.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
              </select>
            </div>
            <div class="form-field">
              <label for="f-ticket-priorite">Priorité</label>
              <select class="input" id="f-ticket-priorite">
                <option value="basse">Basse</option>
                <option value="normale" selected>Normale</option>
                <option value="haute">Haute</option>
              </select>
            </div>
          </div>
          <div class="form-field" style="margin-top:12px;">
            <label for="f-ticket-fichier">Pièce jointe (optionnel, 2 Mo max)</label>
            <input class="input" type="file" id="f-ticket-fichier">
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Annuler</button>
          <button type="submit" class="btn btn-primary">Envoyer</button>
        </div>
      </form>
    </div>
  `;
  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = html;
  modalRoot.classList.add('open');
  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
  document.getElementById('f-ticket-fichier').addEventListener('change', handleAttachmentChange);
  document.getElementById('support-ticket-form').addEventListener('submit', (evt) => {
    evt.preventDefault();
    const titre = document.getElementById('f-ticket-titre').value.trim();
    if (!titre) return;
    const user = authRepository.getCurrentUser();
    supportTicketRepository.create({
      employeeId: user.id,
      titre,
      description: document.getElementById('f-ticket-description').value.trim(),
      categorie: document.getElementById('f-ticket-categorie').value,
      priorite: document.getElementById('f-ticket-priorite').value,
      route: state.view,
      contexte: { vue: contexteLabel },
      pieceJointe: state.pendingAttachment
    });
    closeModal();
    showToast('Ticket envoyé — vous pouvez suivre sa réponse dans « Mes tickets ».');
    if (state.view === 'mes-tickets') render();
  });
}

function renderTicketRow(t, showAuthor) {
  const author = showAuthor ? employeeRepository.getById(t.employeeId) : null;
  return `
    <div class="mini-list-item ticket-row" data-open-ticket="${t.id}">
      <span>
        <span class="badge badge-${TICKET_STATUT_BADGE_CLASS[t.statut] || 'muted'}">${escapeHtml(TICKET_STATUT_LABELS[t.statut] || t.statut)}</span>
        ${escapeHtml(t.titre)}
        ${author ? ` · ${escapeHtml(author.prenom + ' ' + author.nom)}` : ''}
      </span>
      <span class="detail-header-actions">
        <span class="text-muted">${formatDate(t.dateCreation)}</span>
      </span>
    </div>
  `;
}

function renderMesTickets() {
  const user = authRepository.getCurrentUser();
  const tickets = supportTicketRepository.getVisibleTo(user);
  const canSeeAll = hasPermission(user, PERMISSIONS.GERER_TICKETS);

  return `
    <div class="view-header view-header-row">
      <div>
        <h1>Mes tickets</h1>
        <p class="view-subtitle">${tickets.length} ticket${tickets.length > 1 ? 's' : ''}</p>
      </div>
      <div class="detail-header-actions">
        <button class="btn btn-primary" id="btn-nouveau-ticket">+ Nouveau ticket</button>
      </div>
    </div>
    <div class="card">
      <div id="tickets-list">
        ${tickets.length === 0 ? '<p class="text-muted">Aucun ticket pour le moment.</p>' : tickets.map(t => renderTicketRow(t, canSeeAll)).join('')}
      </div>
    </div>
  `;
}

function bindMesTicketsEvents() {
  document.getElementById('btn-nouveau-ticket').addEventListener('click', () => openSupportTicketModal());
  document.querySelectorAll('[data-open-ticket]').forEach(el => {
    el.addEventListener('click', () => navigateTo('ticket-detail', { currentTicketId: el.dataset.openTicket }));
  });
}

function renderTicketComment(c) {
  const isBertolis = c.auteur === 'Support BERTOLIS';
  return `
    <div class="ticket-comment ${isBertolis ? 'ticket-comment-bertolis' : 'ticket-comment-salarie'}">
      <div class="ticket-comment-meta"><strong>${escapeHtml(c.auteur)}</strong> · ${formatDateTime(c.date)}</div>
      <div class="ticket-comment-body">${escapeHtml(c.texte).replace(/\n/g, '<br>')}</div>
    </div>
  `;
}

/** "Livré le ..." bien visible dès que le statut est "livre" — la date est renseignée
 * automatiquement côté serveur (update_ticket_statut, 0018_ticket_suivi_livraison.sql). */
function renderTicketDeliveryBanner(statut, dateLivraison) {
  if (statut !== 'livre' || !dateLivraison) return '';
  return `<p class="text-muted" style="margin-top:0;">📦 Livré le ${formatDateTime(dateLivraison)}</p>`;
}

/** Historique horodaté des changements de statut (0018_ticket_suivi_livraison.sql) — même
 * composant `.timeline` déjà utilisé ailleurs dans l'app pour ce genre de suivi chronologique. */
function renderTicketHistoryTimeline(historique) {
  if (!historique || !historique.length) return '';
  return `
    <div class="card">
      <div class="search-section-label" style="padding-left:0;">Historique</div>
      <div class="timeline">
        ${historique.map(h => `
          <div class="timeline-item">
            <div class="timeline-date text-muted">${formatDateTime(h.date)}</div>
            <div class="timeline-label">${escapeHtml(h.action)}${h.auteur ? ` · ${escapeHtml(h.auteur)}` : ''}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

/** Suggestion IA (§sprint analyse automatique) — encart visuellement distinct, jamais confondu avec
 * les données saisies par le salarié : ne modifie jamais categorie/priorite tout seul. Le bouton
 * "Appliquer" (BERTOLIS uniquement, showApplyButton) reste une action manuelle explicite. */
function renderTicketAiSuggestion(aiAnalysis, showApplyButton) {
  if (!aiAnalysis) return '';
  return `
    <div class="card" style="border: 1px dashed var(--color-primary); background: var(--color-primary-soft);">
      <div class="search-section-label" style="padding-left:0;">🤖 Suggestion de l'IA — n'a pas modifié votre demande</div>
      <p style="margin:6px 0;"><strong>Catégorie suggérée :</strong> ${escapeHtml(aiAnalysis.categorieSuggeree || '—')} · <strong>Priorité suggérée :</strong> ${escapeHtml(aiAnalysis.prioriteSuggeree || '—')}</p>
      ${aiAnalysis.resume ? `<p style="margin:6px 0;">${escapeHtml(aiAnalysis.resume)}</p>` : ''}
      ${Array.isArray(aiAnalysis.pointsCles) && aiAnalysis.pointsCles.length ? `<ul style="margin:6px 0;">${aiAnalysis.pointsCles.map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul>` : ''}
      ${showApplyButton ? `<button type="button" class="btn btn-secondary btn-sm" id="btn-ticket-apply-ai">Appliquer la suggestion</button>` : ''}
    </div>
  `;
}

/** §sprint refonte UX §11 : description et suggestion IA côte à côte sur desktop large (contenu
 * court, comparaison naturelle) — seulement quand l'IA a une suggestion à montrer, sinon la
 * description reste seule (pas de grille à une seule case). Partagé entre la vue salarié
 * (renderTicketDetail) et la vue BERTOLIS (renderBertolisTicketDetail). */
function renderTicketDescriptionAndAi(description, contexte, pieceJointe, aiAnalysis, showApplyButton) {
  const descriptionCard = `
    <div class="card">
      ${description ? `<p>${escapeHtml(description).replace(/\n/g, '<br>')}</p>` : ''}
      ${contexte && contexte.vue ? `<p class="text-muted">Contexte : ${escapeHtml(contexte.vue)}</p>` : ''}
      ${pieceJointe ? `<p><a href="${pieceJointe.dataUrl}" download="${escapeHtml(pieceJointe.nom)}" class="btn-link">📎 ${escapeHtml(pieceJointe.nom)}</a></p>` : ''}
    </div>
  `;
  if (!aiAnalysis) return descriptionCard;
  return `<div class="detail-grid">${descriptionCard}${renderTicketAiSuggestion(aiAnalysis, showApplyButton)}</div>`;
}

function renderTicketDetail(id) {
  const ticket = supportTicketRepository.getById(id);
  if (!ticket) return `<button class="btn-link" id="btn-back-to-tickets">← Retour</button><div class="empty-state"><p>Ticket introuvable.</p></div>`;

  const user = authRepository.getCurrentUser();
  const canManage = hasPermission(user, PERMISSIONS.GERER_TICKETS);
  const isAuthor = ticket.employeeId === user.id;
  if (!canManage && !isAuthor) {
    return `<button class="btn-link" id="btn-back-to-tickets">← Retour</button><div class="empty-state"><p>Vous n'avez pas accès à ce ticket.</p></div>`;
  }

  const author = employeeRepository.getById(ticket.employeeId);
  const comments = ticket.comments || [];

  // Un salarié ne peut pas se fermer lui-même un ticket encore ouvert/en cours (voir décision de
  // conception : le statut resolu/livre/ferme reste piloté par BERTOLIS ou RH via gererTickets) —
  // un auteur ordinaire ne peut que rouvrir un ticket terminé/livré, ou confirmer sa clôture.
  const statutControls = canManage
    ? `<select class="input" id="f-ticket-statut" style="width:auto;">
        ${Object.keys(TICKET_STATUT_LABELS).map(s => `<option value="${s}" ${s === ticket.statut ? 'selected' : ''}>${TICKET_STATUT_LABELS[s]}</option>`).join('')}
      </select>`
    : ['resolu', 'livre'].includes(ticket.statut)
      ? `<button type="button" class="btn btn-secondary btn-sm" id="btn-ticket-reopen">Rouvrir</button>
         <button type="button" class="btn btn-primary btn-sm" id="btn-ticket-close">Confirmer et clôturer</button>`
      : '';

  return `
    <button class="btn-link" id="btn-back-to-tickets">← Retour à mes tickets</button>
    <div class="view-header view-header-row">
      <div>
        <h1>${escapeHtml(ticket.titre)}</h1>
        <p class="view-subtitle">
          <span class="badge badge-${TICKET_STATUT_BADGE_CLASS[ticket.statut] || 'muted'}">${escapeHtml(TICKET_STATUT_LABELS[ticket.statut] || ticket.statut)}</span>
          · ${escapeHtml(ticket.categorie || '—')} · Priorité ${escapeHtml(ticket.priorite)}
          ${canManage && author ? ` · ${escapeHtml(author.prenom + ' ' + author.nom)}` : ''}
          · ${formatDateTime(ticket.dateCreation)}
        </p>
      </div>
      <div class="detail-header-actions">${statutControls}</div>
    </div>
    ${renderTicketDeliveryBanner(ticket.statut, ticket.dateLivraison)}
    ${renderTicketDescriptionAndAi(ticket.description, ticket.contexte, ticket.pieceJointe, ticket.aiAnalysis, false)}
    <div class="card">
      <div id="ticket-thread" class="ticket-thread">
        ${comments.length === 0 ? '<p class="text-muted">Aucune réponse pour le moment.</p>' : comments.map(c => renderTicketComment(c)).join('')}
      </div>
      <form id="ticket-comment-form" class="ticket-comment-form">
        <textarea class="input" id="f-ticket-comment" rows="2" placeholder="Répondre..." required></textarea>
        <button type="submit" class="btn btn-primary">Envoyer</button>
      </form>
    </div>
    ${renderTicketHistoryTimeline(ticket.historique)}
  `;
}

function bindTicketDetailEvents() {
  const backBtn = document.getElementById('btn-back-to-tickets');
  if (backBtn) backBtn.addEventListener('click', () => navigateTo('mes-tickets'));
  if (!supportTicketRepository.getById(state.currentTicketId)) return;

  const changeStatut = async (statut) => {
    const result = await supportTicketRepository.updateStatus(state.currentTicketId, statut);
    if (!result.success) { showToast(result.error || 'Erreur lors du changement de statut.', 'error'); return; }
    render();
  };
  const statutSelect = document.getElementById('f-ticket-statut');
  if (statutSelect) statutSelect.addEventListener('change', () => changeStatut(statutSelect.value));
  const reopenBtn = document.getElementById('btn-ticket-reopen');
  if (reopenBtn) reopenBtn.addEventListener('click', () => changeStatut('ouvert'));
  const closeBtn = document.getElementById('btn-ticket-close');
  if (closeBtn) closeBtn.addEventListener('click', () => changeStatut('ferme'));

  const form = document.getElementById('ticket-comment-form');
  if (form) {
    form.addEventListener('submit', async (evt) => {
      evt.preventDefault();
      const textarea = document.getElementById('f-ticket-comment');
      const texte = textarea.value.trim();
      if (!texte) return;
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      const result = await supportTicketRepository.addComment(state.currentTicketId, texte);
      submitBtn.disabled = false;
      if (!result.success) { showToast(result.error || 'Erreur lors de l\'envoi.', 'error'); return; }
      render();
    });
  }
}

// ---------------------------------------------------------------------------
// Vue : Fiche salarié (détail)
// ---------------------------------------------------------------------------

/** Un RH ne peut pas modifier sa propre fiche sensible ; seul le Directeur le peut. */
function canEditEmployeeRecord(employee) {
  const user = authRepository.getCurrentUser();
  if (!user) return false;
  if (hasPermission(user, PERMISSIONS.MODIFIER_SALARIE)) {
    if (user.role !== ROLES.DIRECTEUR && user.id === employee.id) return false; // §9.3 : seul le Directeur modifie sa propre fiche
    return true;
  }
  if (user.role === ROLES.MANAGER) return (employee.managerIds || []).includes(user.id);
  return false;
}

/** Même règle que canEditEmployeeRecord, mais pour l'archivage (permission distincte au §8). */
function canArchiveEmployeeRecord(employee) {
  const user = authRepository.getCurrentUser();
  if (!user) return false;
  if (hasPermission(user, PERMISSIONS.ARCHIVER_SALARIE)) {
    if (user.role !== ROLES.DIRECTEUR && user.id === employee.id) return false;
    return true;
  }
  return false;
}

function canDeleteEmployeeRecord() {
  const user = authRepository.getCurrentUser();
  return hasPermission(user, PERMISSIONS.SUPPRIMER_SALARIE);
}

function renderEmployeeDetail(id) {
  const e = employeeRepository.getById(id);
  if (!e) return `<button class="btn-link" id="btn-back-to-list">← Retour à la liste</button><div class="empty-state"><p>Salarié introuvable.</p></div>`;

  const visibleIds = getVisibleEmployeeIdsForCurrentUser();
  if (visibleIds !== null && !visibleIds.includes(id)) {
    return `<button class="btn-link" id="btn-back-to-list">← Retour à la liste</button><div class="empty-state"><p>Vous n'avez pas accès à la fiche de ce salarié.</p></div>`;
  }

  const age = calculateAge(e.dateNaissance);
  const user = authRepository.getCurrentUser();
  const canEdit = canEditEmployeeRecord(e);
  const canDelete = canDeleteEmployeeRecord();
  const selfRhBlocked = user.role === ROLES.RH && user.id === e.id;
  // Auto-service limité (téléphone/adresse uniquement) pour qui n'a pas déjà l'édition complète sur
  // sa propre fiche — sinon le bouton "Modifier" fait déjà tout, pas besoin d'un second bouton.
  const canEditCoordonnees = !canEdit && user.id === e.id && hasPermission(user, PERMISSIONS.MODIFIER_PROPRES_COORDONNEES);
  // § VOIR_INFOS_CONTRACTUELLES : scope restreint à convention collective/statut pro/dates de fin
  // de contrat et de période d'essai — PAS type de contrat/date d'embauche/ancienneté, que
  // exportEmployeesCSV (cf. son commentaire) déclare déjà explicitement non confidentiels.
  const canSeeContractuel = user.id === e.id || hasPermission(user, PERMISSIONS.VOIR_INFOS_CONTRACTUELLES);

  return `
    <button class="btn-link" id="btn-back-to-list">← Retour à la liste</button>

    <div class="detail-header card">
      ${renderAvatar(e)}
      <div class="detail-header-info">
        <h1>${escapeHtml(e.prenom)} ${escapeHtml(e.nom)}</h1>
        <p class="view-subtitle">${escapeHtml(e.poste || '—')} · ${escapeHtml(e.service || '—')}</p>
        <div class="badge-row">
          ${renderContratBadge(e.typeContrat)}
          ${renderStatutBadge(e.statut)}
          ${canSeeContractuel ? `<span class="badge badge-info">${escapeHtml(e.statutPro)}</span>` : ''}
        </div>
        ${selfRhBlocked ? '<p class="text-muted" style="margin-top: 6px;">Seul un Directeur peut modifier votre propre fiche.</p>' : ''}
      </div>
      <div class="detail-header-actions">
        <button class="btn btn-secondary" id="btn-toggle-favorite">${favoriteRepository.isFavoriteEmployee(e.id) ? '⭐ Favori' : '☆ Favori'}</button>
        <button class="btn btn-secondary" id="btn-print-employee-fiche">🖨️ Fiche PDF</button>
        ${canEdit ? '<button class="btn btn-secondary" id="btn-print-attestation">Attestation employeur</button>' : ''}
        ${canEdit ? '<button class="btn btn-secondary" id="btn-print-certificat-travail">Certificat de travail</button>' : ''}
        ${canEditCoordonnees ? '<button class="btn btn-secondary" id="btn-edit-coordonnees">Modifier mes coordonnées</button>' : ''}
        ${canEdit ? '<button class="btn btn-secondary" id="btn-edit-employee">Modifier</button>' : ''}
        ${canArchiveEmployeeRecord(e) ? `<button class="btn btn-secondary" id="btn-archive-employee">${e.archive ? 'Réactiver' : 'Archiver'}</button>` : ''}
        ${canDelete ? '<button class="btn btn-danger" id="btn-delete-employee">Supprimer</button>' : ''}
      </div>
    </div>

    <div class="detail-grid">
      <div class="card">
        <h2>Identité</h2>
        ${infoRow('Matricule', e.matricule)}
        ${infoRow('Email', e.email)}
        ${infoRow('Téléphone', e.telephone)}
        ${infoRow('Adresse', [e.adresse.rue, e.adresse.codePostal, e.adresse.ville].filter(Boolean).join(', '))}
        ${infoRow('Date de naissance', `${formatDate(e.dateNaissance)}${age !== null ? ' (' + age + ' ans)' : ''}`)}
        ${infoRow('Lieu de naissance', e.lieuNaissance)}
        ${infoRow('Nationalité', e.nationalite)}
        ${infoRow('N° sécurité sociale', e.numeroSecu)}
      </div>

      <div class="card">
        <h2>Contrat &amp; poste</h2>
        ${infoRow('Service', e.service)}
        ${infoRow('Équipe', e.equipe)}
        ${infoRow('Poste', e.poste)}
        ${infoRow('Manager(s)', managerNames(e.managerIds))}
        ${canSeeContractuel ? infoRow('Convention collective', e.conventionCollective) : ''}
        ${canSeeContractuel ? infoRow('Statut professionnel', e.statutPro) : ''}
        ${infoRow('Type de contrat', e.typeContrat)}
        ${infoRow('Date d\'embauche', formatDate(e.dateEmbauche))}
        ${infoRow('Ancienneté', calculateAnciennete(e.dateEmbauche))}
        ${canSeeContractuel && (e.typeContrat === 'CDD' || e.typeContrat === 'Intérim') ? infoRow('Date de fin de contrat', formatDate(e.dateFinContrat)) : ''}
        ${canSeeContractuel && e.dateFinPeriodeEssai ? infoRow('Fin de période d\'essai', formatDate(e.dateFinPeriodeEssai)) : ''}
        ${canSeeContractuel && e.dateDernierEntretienProfessionnel ? infoRow('Dernier entretien professionnel', formatDate(e.dateDernierEntretienProfessionnel)) : ''}
      </div>

      <div class="card">
        <h2>Temps de travail</h2>
        ${infoRow('Temps de travail', e.tempsTravail)}
        ${infoRow('Pourcentage d\'activité', formatPercentFR(e.pourcentageActivite))}
        ${infoRow('Heures hebdomadaires', formatNumberFR(e.horairesHebdo) + ' h')}
        ${infoRow('Forfait', e.forfait)}
        ${infoRow('Jours travaillés', (e.joursTravailles || []).join(', '))}
        ${infoRow('Régime RTT', e.regimeRTT || '—')}
      </div>

      <div class="card">
        <div class="view-header-row">
          <h2>Compteurs de congés</h2>
          <div class="detail-header-actions">
            <button class="btn btn-secondary btn-sm" id="btn-request-leave">Demander un congé</button>
            <button class="btn btn-secondary btn-sm" id="btn-request-telework">Demander du télétravail</button>
          </div>
        </div>
        ${user.id === e.id || hasPermission(user, PERMISSIONS.VOIR_COMPTEURS)
          ? renderEmployeeBalances(e, user.id !== e.id && hasPermission(user, PERMISSIONS.MODIFIER_COMPTEURS))
          : '<p class="text-muted">Vous n\'avez pas accès aux compteurs de ce salarié.</p>'}
      </div>

      ${renderTypesAbsenceCard(e, user)}

      ${renderConfidentialEmployeeCard(e, user)}

      ${renderCompteCard(e, user)}

      ${renderPermissionsCard(e, user)}

      ${renderEmployeeDocumentsCard(e)}
    </div>
  `;
}

/** Sprint SIRH premium §1 : liste blanche par salarié des types d'absence actifs/visibles au
 * niveau entreprise — décocher un type ici l'empêche de le demander lui-même, même si l'entreprise
 * l'autorise en général (ex. "Télétravail" ou "Congé sans solde" désactivés pour un salarié précis).
 * Réutilise canEditEmployeeRecord (MODIFIER_SALARIE) plutôt que d'inventer une nouvelle permission —
 * le catalogue des 31 du §8 reste fermé. */
function renderTypesAbsenceCard(e, user) {
  if (!canEditEmployeeRecord(e)) return '';
  const types = leaveTypeRepository.getLeaveTypes().filter(t => t.actif && t.visibleSalarie);
  if (types.length === 0) return '';
  const desactives = new Set(e.typesAbsenceDesactives || []);
  return `
    <div class="card">
      <h2>Types d'absences autorisés</h2>
      <p class="text-muted">Décochez un type pour empêcher ce salarié de le demander lui-même, même si l'entreprise l'autorise en général.</p>
      <div class="form-grid checkbox-grid">
        ${types.map(t => `
          <div class="form-field form-field-checkbox">
            <label>
              <input type="checkbox" data-type-absence-autorise="${t.id}" ${desactives.has(t.id) ? '' : 'checked'}>
              ${escapeHtml(t.icone)} ${escapeHtml(t.nom)}
            </label>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function bindTypesAbsenceCardEvents(employeeId) {
  document.querySelectorAll('[data-type-absence-autorise]').forEach(checkbox => {
    checkbox.addEventListener('change', (evt) => {
      const typeId = evt.target.dataset.typeAbsenceAutorise;
      const employee = employeeRepository.getById(employeeId);
      const desactives = new Set(employee.typesAbsenceDesactives || []);
      if (evt.target.checked) desactives.delete(typeId); else desactives.add(typeId);
      employeeRepository.update(employeeId, { typesAbsenceDesactives: [...desactives] });
      const type = leaveTypeRepository.getLeaveTypeById(typeId);
      auditLogRepository.logAudit('Modification', 'Types d\'absence autorisés', `${employee.prenom} ${employee.nom} · ${type.nom} ${evt.target.checked ? 'autorisé' : 'désactivé'}`);
      showToast('Mis à jour.');
    });
  });
}

/** § GERER_UTILISATEURS : déverrouillage de compte et réinitialisation de mot de passe par un
 * administrateur — jamais sur sa propre fiche (on gère son propre mot de passe via le menu
 * utilisateur, DB.changePassword, qui exige de connaître l'ancien). */
function renderCompteCard(e, user) {
  if (!hasPermission(user, PERMISSIONS.GERER_UTILISATEURS) || user.id === e.id) return '';
  return `
    <div class="card">
      <h2>Compte</h2>
      <div class="badge-row" style="margin-bottom: 10px;">
        <span class="badge badge-${e.authUserId ? 'success' : 'warning'}">${e.authUserId ? 'Compte actif' : 'Pas de compte de connexion'}</span>
      </div>
      <p class="text-muted" style="margin-bottom: 10px;">Rôle actuel : <strong>${escapeHtml(ROLE_LABELS[e.role] || e.role)}</strong></p>
      <div class="detail-header-actions">
        ${e.authUserId
          ? '<button class="btn btn-secondary btn-sm" id="btn-forcer-mot-de-passe">Réinitialiser le mot de passe</button>'
          : '<button class="btn btn-primary btn-sm" id="btn-creer-compte-connexion">Créer les identifiants de connexion</button>'}
        <button class="btn btn-secondary btn-sm" id="btn-changer-role">Changer le rôle</button>
      </div>
    </div>
  `;
}

/** Le rôle Directeur est traité à part (option désactivée dans le select + message explicite)
 * plutôt que de laisser l'utilisateur découvrir le refus seulement après avoir soumis — les
 * vraies règles (un seul Directeur peut toucher ce rôle, jamais retirer le dernier) restent
 * appliquées côté serveur (DB.changerRoleSalarie + trigger Postgres, migration 0011), ceci n'est
 * qu'un confort d'affichage. */
function openChangeRoleModal(employeeId) {
  const employee = employeeRepository.getById(employeeId);
  if (!employee) { showToast('Ce salarié n\'est plus disponible.', 'error'); return; }
  const actingUser = authRepository.getCurrentUser();
  const actingIsDirecteur = actingUser.role === ROLES.DIRECTEUR;
  const directeurBloque = !actingIsDirecteur;
  const roleOptions = Object.values(ROLES).filter(r => r !== employee.role);

  const html = `
    <div class="modal modal-small">
      <div class="modal-header">
        <h2>Changer le rôle</h2>
        <button class="btn-icon" id="btn-close-modal" aria-label="Fermer" title="Fermer">✕</button>
      </div>
      <form id="changer-role-form">
        <div class="modal-body">
          <p class="text-muted">${escapeHtml(employee.prenom)} ${escapeHtml(employee.nom)} — rôle actuel : <strong>${escapeHtml(ROLE_LABELS[employee.role] || employee.role)}</strong>.</p>
          <div class="form-field">
            <label for="f-nouveau-role">Nouveau rôle *</label>
            <select class="input" id="f-nouveau-role" name="nouveauRole" required>
              <option value="">—</option>
              ${roleOptions.map(r => `<option value="${r}" ${r === ROLES.DIRECTEUR && directeurBloque ? 'disabled' : ''}>${escapeHtml(ROLE_LABELS[r])}${r === ROLES.DIRECTEUR && directeurBloque ? ' (réservé à un Directeur)' : ''}</option>`).join('')}
            </select>
          </div>
          ${employee.role === ROLES.DIRECTEUR && directeurBloque ? `<p class="login-error" role="alert">Seul un Directeur peut retirer le rôle Directeur à quelqu'un.</p>` : ''}
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Annuler</button>
          <button type="submit" class="btn btn-primary" ${employee.role === ROLES.DIRECTEUR && directeurBloque ? 'disabled' : ''}>Changer le rôle</button>
        </div>
      </form>
    </div>
  `;

  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = html;
  modalRoot.classList.add('open');

  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
  document.getElementById('changer-role-form').addEventListener('submit', (evt) => {
    evt.preventDefault();
    const newRole = document.getElementById('f-nouveau-role').value;
    const result = employeeRepository.changerRole(employeeId, newRole, actingUser.id);
    if (!result.success) { showToast(result.error, 'error'); return; }
    showToast('Rôle mis à jour.');
    closeModal();
    render();
  });
}

function openForcerMotDePasseModal(employeeId) {
  const employee = employeeRepository.getById(employeeId);
  if (!employee) { showToast('Ce salarié n\'est plus disponible.', 'error'); return; }
  const html = `
    <div class="modal modal-small">
      <div class="modal-header">
        <h2>Réinitialiser le mot de passe</h2>
        <button class="btn-icon" id="btn-close-modal" aria-label="Fermer" title="Fermer">✕</button>
      </div>
      <form id="forcer-mdp-form">
        <div class="modal-body">
          <p class="text-muted">${escapeHtml(employee.prenom)} ${escapeHtml(employee.nom)} — communiquez ce nouveau mot de passe au salarié par un autre moyen que cette application.</p>
          <div class="form-field">
            <label for="f-nouveau-mdp">Nouveau mot de passe (6 caractères minimum) *</label>
            <input class="input" type="text" id="f-nouveau-mdp" name="nouveauMotDePasse" minlength="6" required>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Annuler</button>
          <button type="submit" class="btn btn-primary">Réinitialiser</button>
        </div>
      </form>
    </div>
  `;

  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = html;
  modalRoot.classList.add('open');

  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
  document.getElementById('forcer-mdp-form').addEventListener('submit', async (evt) => {
    evt.preventDefault();
    const submitBtn = evt.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Réinitialisation...';
    const result = await employeeRepository.forcerMotDePasse(employeeId, document.getElementById('f-nouveau-mdp').value);
    if (!result.success) { showToast(result.error, 'error'); submitBtn.disabled = false; submitBtn.textContent = 'Réinitialiser'; return; }
    showToast('Mot de passe réinitialisé.');
    closeModal();
    render();
  });
}

/** § GERER_UTILISATEURS : crée le compte de connexion d'un salarié qui n'en a pas encore (voir
 * DB.creerCompteConnexion / manage-employee-account) — remplace l'ancien parcours d'auto-inscription
 * "Créer un compte" (retiré). Mot de passe généré côté serveur, affiché une seule fois ensuite via
 * showGeneratedPasswordModal. */
function openCreerCompteConnexionModal(employeeId) {
  const employee = employeeRepository.getById(employeeId);
  if (!employee) { showToast('Ce salarié n\'est plus disponible.', 'error'); return; }
  const html = `
    <div class="modal modal-small">
      <div class="modal-header">
        <h2>Créer les identifiants de connexion</h2>
        <button class="btn-icon" id="btn-close-modal" aria-label="Fermer" title="Fermer">✕</button>
      </div>
      <div class="modal-body">
        <p class="text-muted">
          Un compte de connexion sera créé pour <strong>${escapeHtml(employee.prenom)} ${escapeHtml(employee.nom)}</strong>
          (${escapeHtml(employee.email)}), avec un mot de passe temporaire généré automatiquement.
          Vous devrez le transmettre vous-même au salarié (oral, SMS...) ; il devra le changer dès sa première connexion.
        </p>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Annuler</button>
        <button type="button" class="btn btn-primary" id="btn-confirm-creer-compte">Créer le compte</button>
      </div>
    </div>
  `;

  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = html;
  modalRoot.classList.add('open');

  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
  document.getElementById('btn-confirm-creer-compte').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirm-creer-compte');
    btn.disabled = true;
    btn.textContent = 'Création...';
    const result = await employeeRepository.creerCompteConnexion(employeeId);
    if (!result.success) { showToast(result.error, 'error'); closeModal(); return; }
    showGeneratedPasswordModal(employee, result.password);
    render();
  });
}

/** Affiche une seule fois le mot de passe temporaire généré par creerCompteConnexion/
 * forcerNouveauMotDePasse — Supabase ne le renvoie plus jamais ensuite (par sécurité). */
function showGeneratedPasswordModal(employee, password) {
  const html = `
    <div class="modal modal-small">
      <div class="modal-header">
        <h2>Compte créé</h2>
      </div>
      <div class="modal-body">
        <p class="text-muted">Communiquez ces identifiants à <strong>${escapeHtml(employee.prenom)} ${escapeHtml(employee.nom)}</strong> par un autre moyen que cette application. Ce mot de passe ne sera plus jamais affiché.</p>
        <div class="form-field">
          <label for="f-generated-email">Email</label>
          <input class="input" type="text" id="f-generated-email" readonly value="${escapeHtml(employee.email)}">
        </div>
        <div class="form-field">
          <label for="f-generated-password">Mot de passe temporaire</label>
          <input class="input" type="text" id="f-generated-password" readonly value="${escapeHtml(password)}">
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-primary" id="btn-close-password-modal">J'ai noté le mot de passe</button>
      </div>
    </div>
  `;
  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = html;
  modalRoot.classList.add('open');
  document.getElementById('btn-close-password-modal').addEventListener('click', closeModal);
}

/** Surcharges individuelles (§8) pour les permissions déjà réellement câblées dans l'app — voir
 * hasPermission() dans data.js. Réservé à qui a la permission GERER_PERMISSIONS (Directeur par
 * défaut, §9.3) ; personne ne modifie ses propres permissions, pour éviter un auto-verrouillage. */
function renderPermissionsCard(e, user) {
  if (!hasPermission(user, PERMISSIONS.GERER_PERMISSIONS)) return '';
  if (user.id === e.id) {
    return `
      <div class="card">
        <h2>Permissions individuelles</h2>
        <p class="text-muted">Vous ne pouvez pas modifier vos propres permissions.</p>
      </div>
    `;
  }

  const wired = [
    { key: PERMISSIONS.MODIFIER_PROPRES_COORDONNEES, label: 'Modifier ses propres coordonnées (téléphone/adresse)' },
    { key: PERMISSIONS.VOIR_SALARIES, label: 'Voir les salariés' },
    { key: PERMISSIONS.VOIR_EQUIPE, label: 'Voir son équipe' },
    { key: PERMISSIONS.VOIR_COMPTEURS, label: 'Voir les compteurs de congés d\'un autre salarié' },
    { key: PERMISSIONS.MODIFIER_COMPTEURS, label: 'Ajuster manuellement un compteur de congés' },
    { key: PERMISSIONS.VALIDER_ABSENCE, label: 'Valider une absence' },
    { key: PERMISSIONS.REFUSER_ABSENCE, label: 'Refuser une absence (congé ou télétravail)' },
    { key: PERMISSIONS.ANNULER_ABSENCE, label: 'Annuler une absence' },
    { key: PERMISSIONS.VALIDER_NOTE_FRAIS, label: 'Valider une note de frais (RH/Directeur)' },
    { key: PERMISSIONS.CONTROLER_NOTE_FRAIS, label: 'Contrôler une note de frais (étape non finale du circuit)' },
    { key: PERMISSIONS.MARQUER_NOTE_REMBOURSEE, label: 'Marquer une note de frais remboursée (étape finale du circuit)' },
    { key: PERMISSIONS.VOIR_INFOS_FINANCIERES, label: 'Voir les informations financières (salaire)' },
    { key: PERMISSIONS.VOIR_INFOS_CONTRACTUELLES, label: 'Voir la convention collective/statut pro/dates de fin de contrat et d\'essai' },
    { key: PERMISSIONS.GERER_PARAMETRES, label: 'Gérer les paramètres' },
    { key: PERMISSIONS.GERER_ABONNEMENTS, label: 'Voir/gérer l\'abonnement de l\'entreprise' },
    { key: PERMISSIONS.GERER_UTILISATEURS, label: 'Déverrouiller un compte / réinitialiser un mot de passe' },
    { key: PERMISSIONS.EXPORTER_PAIE, label: 'Exporter la paie' },
    { key: PERMISSIONS.CALCULER_TICKETS_RESTAURANT, label: 'Accéder aux tickets restaurant' },
    { key: PERMISSIONS.CORRIGER_TICKETS_RESTAURANT, label: 'Corriger manuellement les tickets restaurant' },
    { key: PERMISSIONS.CREER_SALARIE, label: 'Créer un salarié' },
    { key: PERMISSIONS.MODIFIER_SALARIE, label: 'Modifier un salarié' },
    { key: PERMISSIONS.ARCHIVER_SALARIE, label: 'Archiver un salarié' },
    { key: PERMISSIONS.SUPPRIMER_SALARIE, label: 'Supprimer définitivement un salarié' },
    { key: PERMISSIONS.VOIR_JOURNAL_AUDIT, label: 'Voir le journal d\'audit' }
  ];
  const overrides = e.permissionsOverrides || {};
  const roleDefaults = DEFAULT_ROLE_PERMISSIONS[e.role] || [];

  return `
    <div class="card">
      <h2>Permissions individuelles</h2>
      <p class="text-muted">Surcharge le défaut du rôle « ${escapeHtml(ROLE_LABELS[e.role] || e.role)} » pour ce salarié uniquement. Seules les permissions ci-dessous ont un effet réel aujourd'hui ; le reste du catalogue (§8) sera câblé progressivement.</p>
      <div class="form-grid">
        ${wired.map(p => {
          const current = Object.prototype.hasOwnProperty.call(overrides, p.key) ? String(overrides[p.key]) : '';
          const defaultLabel = roleDefaults.includes(p.key) ? 'autorisé' : 'refusé';
          return `
            <div class="form-field">
              <label for="perm-${p.key}">${escapeHtml(p.label)}</label>
              <select class="input" id="perm-${p.key}" data-permission-key="${p.key}">
                <option value="" ${current === '' ? 'selected' : ''}>Par défaut du rôle (${defaultLabel})</option>
                <option value="true" ${current === 'true' ? 'selected' : ''}>Toujours autorisé</option>
                <option value="false" ${current === 'false' ? 'selected' : ''}>Toujours refusé</option>
              </select>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function bindPermissionsCardEvents(employeeId) {
  document.querySelectorAll('[data-permission-key]').forEach(select => {
    select.addEventListener('change', (evt) => {
      const key = evt.target.dataset.permissionKey;
      const employee = employeeRepository.getById(employeeId);
      const overrides = Object.assign({}, employee.permissionsOverrides);
      if (evt.target.value === '') delete overrides[key];
      else overrides[key] = evt.target.value === 'true';
      employeeRepository.update(employeeId, { permissionsOverrides: overrides });
      auditLogRepository.logAudit('Modification', 'Permissions', `${employee.prenom} ${employee.nom} · ${key} = ${evt.target.value || 'défaut du rôle'}`);
      showToast('Permission mise à jour.');
      navigateTo('employee-detail', { currentEmployeeId: employeeId });
    });
  });
}

/** Salaire/genre : données sensibles, réservées au Directeur, et seulement si l'entreprise a activé le suivi correspondant. */
function renderConfidentialEmployeeCard(e, user) {
  if (!hasPermission(user, PERMISSIONS.VOIR_INFOS_FINANCIERES)) return '';
  const settings = settingsRepository.getSettings();
  if (!settings.masseSalarialeActivee && !settings.suiviGenreActive) return '';
  return `
    <div class="card">
      <h2>Confidentiel</h2>
      ${settings.masseSalarialeActivee ? infoRow('Salaire brut mensuel', formatCurrencyFR(e.salaireBrutMensuel || 0)) : ''}
      ${settings.suiviGenreActive ? infoRow('Genre', e.genre || '—') : ''}
    </div>
  `;
}

function renderEmployeeBalances(employee, canAdjust = false) {
  // Liste complète (pas seulement les types actifs/visibles ci-dessous) : getLeaveBalance en a besoin
  // pour retrouver les types "deduireRTT/CP" même désactivés depuis, sans re-fetch à chaque type.
  const allLeaveTypes = leaveTypeRepository.getLeaveTypes();
  const types = allLeaveTypes.filter(t => t.actif && t.visibleSalarie);
  if (types.length === 0) return `<p class="text-muted">Aucun type de congé actif.</p>`;

  const requests = leaveRepository.getAll();
  return `
    <div class="balance-grid">
      ${types.map(t => {
        const balance = getLeaveBalance(employee, t, requests, allLeaveTypes);
        const disponibleLabel = balance.disponible === Infinity ? 'Illimité' : formatDurationFR(balance.disponible);
        return `
          <div class="balance-card" style="--type-color:${escapeHtml(t.couleur)}">
            ${canAdjust ? `<button type="button" class="btn-link balance-adjust-btn" data-adjust-compteur="${t.id}" title="Ajuster ce compteur">✎</button>` : ''}
            <div class="balance-icon">${escapeHtml(t.icone)}</div>
            <div class="balance-name">${escapeHtml(t.nom)}</div>
            <div class="balance-value">${disponibleLabel}</div>
            <div class="balance-sub">disponible${balance.enAttente ? ` · ${formatDurationFR(balance.enAttente)} en attente` : ''}${balance.ajustement ? ` · ajustement ${balance.ajustement >= 0 ? '+' : ''}${formatDurationFR(balance.ajustement)}` : ''}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function openAjusterCompteurModal(employeeId, typeId) {
  const employee = employeeRepository.getById(employeeId);
  const type = leaveTypeRepository.getLeaveTypeById(typeId);
  if (!employee || !type) { showToast('Ce salarié ou ce type n\'est plus disponible.', 'error'); return; }
  const current = (employee.compteurs && employee.compteurs[typeId]) || 0;

  const html = `
    <div class="modal modal-small">
      <div class="modal-header">
        <h2>Ajuster le compteur — ${escapeHtml(type.nom)}</h2>
        <button class="btn-icon" id="btn-close-modal" aria-label="Fermer" title="Fermer">✕</button>
      </div>
      <form id="adjust-compteur-form">
        <div class="modal-body">
          <p class="text-muted">${escapeHtml(employee.prenom)} ${escapeHtml(employee.nom)} — cet ajustement s'ajoute (ou se retranche, si négatif) au solde calculé automatiquement. Il remplace l'ajustement précédent pour ce type de congé.</p>
          <div class="form-field">
            <label for="f-montant">Ajustement (jours, + ou -) *</label>
            <input class="input" type="number" id="f-montant" name="montant" step="0.5" value="${current}" required>
          </div>
          <div class="form-field" style="margin-top: 12px;">
            <label for="f-motif">Motif</label>
            <input class="input" type="text" id="f-motif" name="motif" placeholder="Ex. reliquat repris de l'ancien SIRH">
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Annuler</button>
          <button type="submit" class="btn btn-primary">Enregistrer</button>
        </div>
      </form>
    </div>
  `;

  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = html;
  modalRoot.classList.add('open');

  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
  document.getElementById('adjust-compteur-form').addEventListener('submit', (evt) => {
    evt.preventDefault();
    const montant = document.getElementById('f-montant').value;
    const motif = document.getElementById('f-motif').value;
    const result = employeeRepository.ajusterCompteur(employeeId, typeId, montant, motif);
    if (!result.success) { showToast(result.error, 'error'); return; }
    showToast('Compteur ajusté.');
    closeModal();
    render();
  });
}

function infoRow(label, value) {
  return `
    <div class="info-row">
      <span class="info-label">${escapeHtml(label)}</span>
      <span class="info-value">${escapeHtml(value || '—')}</span>
    </div>
  `;
}

function managerNames(managerIds) {
  const names = (managerIds || [])
    .map(id => employeeRepository.getById(id))
    .filter(Boolean)
    .map(m => `${m.prenom} ${m.nom}`);
  return names.length ? names.join(', ') : '—';
}

/** Auto-service limité (§ MODIFIER_PROPRES_COORDONNEES) : seulement téléphone/adresse, jamais le
 * reste de la fiche (poste, contrat, salaire...) qui reste réservé à MODIFIER_SALARIE/manager. */
function openCoordonneesModal(employeeId) {
  const employee = employeeRepository.getById(employeeId);
  if (!employee) { showToast('Ce salarié n\'est plus disponible.', 'error'); return; }

  const html = `
    <div class="modal modal-small">
      <div class="modal-header">
        <h2>Modifier mes coordonnées</h2>
        <button class="btn-icon" id="btn-close-modal" aria-label="Fermer" title="Fermer">✕</button>
      </div>
      <form id="coordonnees-form">
        <div class="modal-body">
          <div class="form-grid">
            ${textField('telephone', 'Téléphone', employee.telephone)}
            ${addressAutocompleteField('adresse.rue', 'Adresse', employee.adresse.rue, 'adresse.codePostal', 'adresse.ville')}
            ${textField('adresse.codePostal', 'Code postal', employee.adresse.codePostal)}
            ${textField('adresse.ville', 'Ville', employee.adresse.ville)}
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Annuler</button>
          <button type="submit" class="btn btn-primary">Enregistrer</button>
        </div>
      </form>
    </div>
  `;

  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = html;
  modalRoot.classList.add('open');

  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
  document.getElementById('coordonnees-form').addEventListener('submit', (evt) => {
    evt.preventDefault();
    const result = employeeRepository.majCoordonnees(employeeId, {
      telephone: document.getElementById('f-telephone').value,
      rue: document.getElementById('f-adresse.rue').value,
      codePostal: document.getElementById('f-adresse.codePostal').value,
      ville: document.getElementById('f-adresse.ville').value
    });
    if (!result.success) { showToast(result.error, 'error'); return; }
    showToast('Coordonnées mises à jour.');
    closeModal();
    render();
  });
}

// ---- Modale : Fiche salarié imprimable / export PDF ----

function openEmployeePrintModal(id) {
  const e = employeeRepository.getById(id);
  const age = calculateAge(e.dateNaissance);
  const user = authRepository.getCurrentUser();
  const canSeeContractuel = user.id === e.id || hasPermission(user, PERMISSIONS.VOIR_INFOS_CONTRACTUELLES);

  const html = `
    <div class="modal modal-large">
      <div class="modal-header">
        <h2>Fiche salarié</h2>
        <button class="btn-icon" id="btn-close-modal" aria-label="Fermer" title="Fermer">✕</button>
      </div>
      <div class="modal-body">
        <div class="print-area print-document">
          <div class="print-header">
            <h1>${escapeHtml(e.prenom)} ${escapeHtml(e.nom)}</h1>
            <p class="text-muted">Matricule ${escapeHtml(e.matricule)} · Fiche générée le ${formatDate(toISODate(new Date()))}</p>
          </div>

          <h3>Identité</h3>
          ${infoRow('Email', e.email)}
          ${infoRow('Téléphone', e.telephone)}
          ${infoRow('Adresse', [e.adresse.rue, e.adresse.codePostal, e.adresse.ville].filter(Boolean).join(', '))}
          ${infoRow('Date de naissance', `${formatDate(e.dateNaissance)}${age !== null ? ' (' + age + ' ans)' : ''}`)}
          ${infoRow('Lieu de naissance', e.lieuNaissance)}
          ${infoRow('Nationalité', e.nationalite)}
          ${infoRow('N° sécurité sociale', e.numeroSecu)}

          <h3>Contrat &amp; poste</h3>
          ${infoRow('Service', e.service)}
          ${infoRow('Équipe', e.equipe)}
          ${infoRow('Poste', e.poste)}
          ${infoRow('Manager(s)', managerNames(e.managerIds))}
          ${canSeeContractuel ? infoRow('Convention collective', e.conventionCollective) : ''}
          ${canSeeContractuel ? infoRow('Statut professionnel', e.statutPro) : ''}
          ${infoRow('Type de contrat', e.typeContrat)}
          ${infoRow('Date d\'embauche', formatDate(e.dateEmbauche))}
          ${infoRow('Ancienneté', calculateAnciennete(e.dateEmbauche))}

          <h3>Temps de travail</h3>
          ${infoRow('Temps de travail', e.tempsTravail)}
          ${infoRow('Pourcentage d\'activité', formatPercentFR(e.pourcentageActivite))}
          ${infoRow('Heures hebdomadaires', formatNumberFR(e.horairesHebdo) + ' h')}
          ${infoRow('Forfait', e.forfait)}
          ${infoRow('Jours travaillés', (e.joursTravailles || []).join(', '))}
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Fermer</button>
        <button type="button" class="btn btn-primary" id="btn-print-employee">Imprimer / Export PDF</button>
      </div>
    </div>
  `;

  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = html;
  modalRoot.classList.add('open');

  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
  document.getElementById('btn-print-employee').addEventListener('click', () => {
    auditLogRepository.logAudit('Export', 'Fiche salarié', `${e.prenom} ${e.nom}`);
    window.print();
  });
}

/** Générateurs de documents RH (attestation employeur, certificat de travail) — même mécanique
 * d'impression que openEmployeePrintModal ci-dessus (.print-area + window.print(), pas de .docx :
 * aucune dépendance externe fiable pour ça dans ce projet 100% vanilla JS, et le risque vécu — "un
 * .docx généré peut être accepté par la lib mais refusé par Word" — n'existe pas avec Imprimer/PDF
 * natif du navigateur). Toujours une AIDE À LA PRÉPARATION : texte type à relire avant remise, un
 * humain reste responsable du contenu final et de la signature. */
function openAttestationEmployeurModal(id) {
  const e = employeeRepository.getById(id);
  if (!e) { showToast('Ce salarié n\'est plus disponible.', 'error'); return; }
  const profile = companyRepository.getProfile();
  const today = toISODate(new Date());

  const html = `
    <div class="modal modal-large">
      <div class="modal-header">
        <h2>Attestation employeur</h2>
        <button class="btn-icon" id="btn-close-modal" aria-label="Fermer" title="Fermer">✕</button>
      </div>
      <div class="modal-body">
        <p class="text-muted">Modèle type à relire avant remise — complétez/ajustez si besoin avant impression.</p>
        <div class="print-area print-document">
          <p style="text-align: right;">${escapeHtml(profile.raisonSociale || 'Entreprise')}${profile.adresse ? ', ' + escapeHtml(profile.adresse) : ''}</p>
          <p style="text-align: right;">${formatDate(today)}</p>
          <h1>Attestation employeur</h1>
          <p>
            Je soussigné(e), représentant de la société ${escapeHtml(profile.raisonSociale || '____________________')}${profile.siret ? ' (SIRET ' + escapeHtml(profile.siret) + ')' : ''},
            atteste que ${escapeHtml(e.civilite)} ${escapeHtml(e.prenom)} ${escapeHtml(e.nom)}, né(e) le ${formatDate(e.dateNaissance) || '____________________'},
            est employé(e) au sein de notre entreprise depuis le ${formatDate(e.dateEmbauche)}, en qualité de ${escapeHtml(e.poste || '____________________')},
            sous contrat ${escapeHtml(e.typeContrat)}${e.tempsTravail ? ', à ' + escapeHtml(e.tempsTravail).toLowerCase() : ''}.
          </p>
          <p>Cette attestation est délivrée à la demande de l'intéressé(e) pour servir et valoir ce que de droit.</p>
          <p style="margin-top: 48px;">Fait pour servir et valoir ce que de droit.</p>
          <p style="margin-top: 48px;">Signature et cachet de l'entreprise :</p>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Fermer</button>
        <button type="button" class="btn btn-primary" id="btn-print-document">Imprimer / Export PDF</button>
      </div>
    </div>
  `;
  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = html;
  modalRoot.classList.add('open');
  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
  document.getElementById('btn-print-document').addEventListener('click', () => {
    auditLogRepository.logAudit('Export', 'Attestation employeur', `${e.prenom} ${e.nom}`);
    window.print();
  });
}

function openCertificatTravailModal(id) {
  const e = employeeRepository.getById(id);
  if (!e) { showToast('Ce salarié n\'est plus disponible.', 'error'); return; }
  const profile = companyRepository.getProfile();
  const today = toISODate(new Date());
  // Le certificat de travail (Code du travail, art. L1234-19) est obligatoire à la SORTIE — reste
  // générable pour un contrat en cours (préparation à l'avance), juste avec un avertissement.
  const dateSortie = e.dateFinContrat || (e.statut !== 'Actif' ? today : '');

  const html = `
    <div class="modal modal-large">
      <div class="modal-header">
        <h2>Certificat de travail</h2>
        <button class="btn-icon" id="btn-close-modal" aria-label="Fermer" title="Fermer">✕</button>
      </div>
      <div class="modal-body">
        ${!dateSortie ? `<p class="field-warning visible">⚠ Aucune date de fin de contrat renseignée sur cette fiche — ce salarié semble toujours en poste. Le certificat de travail est obligatoire à la sortie (Code du travail, art. L1234-19) ; vérifiez la date avant remise.</p>` : ''}
        <p class="text-muted">Modèle type à relire avant remise — complétez/ajustez si besoin avant impression.</p>
        <div class="print-area print-document">
          <p style="text-align: right;">${escapeHtml(profile.raisonSociale || 'Entreprise')}${profile.adresse ? ', ' + escapeHtml(profile.adresse) : ''}</p>
          <p style="text-align: right;">${formatDate(today)}</p>
          <h1>Certificat de travail</h1>
          <p>
            Je soussigné(e), représentant de la société ${escapeHtml(profile.raisonSociale || '____________________')}${profile.siret ? ' (SIRET ' + escapeHtml(profile.siret) + ')' : ''},
            certifie que ${escapeHtml(e.civilite)} ${escapeHtml(e.prenom)} ${escapeHtml(e.nom)} a été employé(e) au sein de notre entreprise
            du ${formatDate(e.dateEmbauche)} au ${dateSortie ? formatDate(dateSortie) : '____________________'},
            en qualité de ${escapeHtml(e.poste || '____________________')}${e.service ? ' au sein du service ' + escapeHtml(e.service) : ''}.
          </p>
          <p>Le salarié est libre de tout engagement à l'issue de cette période.</p>
          <p style="margin-top: 48px;">Fait pour servir et valoir ce que de droit.</p>
          <p style="margin-top: 48px;">Signature et cachet de l'entreprise :</p>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Fermer</button>
        <button type="button" class="btn btn-primary" id="btn-print-document">Imprimer / Export PDF</button>
      </div>
    </div>
  `;
  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = html;
  modalRoot.classList.add('open');
  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
  document.getElementById('btn-print-document').addEventListener('click', () => {
    auditLogRepository.logAudit('Export', 'Certificat de travail', `${e.prenom} ${e.nom}`);
    window.print();
  });
}

function bindEmployeeDetailEvents() {
  document.getElementById('btn-back-to-list').addEventListener('click', () => navigateTo('employees'));

  const favoriteBtn = document.getElementById('btn-toggle-favorite');
  if (!favoriteBtn) return; // fiche introuvable ou accès non autorisé : seul le lien de retour existe sur cet état
  favoriteBtn.addEventListener('click', () => {
    favoriteRepository.toggleFavoriteEmployee(state.currentEmployeeId);
    render();
  });
  document.getElementById('btn-print-employee-fiche').addEventListener('click', () => openEmployeePrintModal(state.currentEmployeeId));
  const attestationBtn = document.getElementById('btn-print-attestation');
  if (attestationBtn) attestationBtn.addEventListener('click', () => openAttestationEmployeurModal(state.currentEmployeeId));
  const certificatBtn = document.getElementById('btn-print-certificat-travail');
  if (certificatBtn) certificatBtn.addEventListener('click', () => openCertificatTravailModal(state.currentEmployeeId));
  bindEmployeeDocumentsEvents(state.currentEmployeeId);
  bindPermissionsCardEvents(state.currentEmployeeId);
  bindTypesAbsenceCardEvents(state.currentEmployeeId);

  const forcerMdpBtn = document.getElementById('btn-forcer-mot-de-passe');
  if (forcerMdpBtn) forcerMdpBtn.addEventListener('click', () => openForcerMotDePasseModal(state.currentEmployeeId));

  const creerCompteBtn = document.getElementById('btn-creer-compte-connexion');
  if (creerCompteBtn) creerCompteBtn.addEventListener('click', () => openCreerCompteConnexionModal(state.currentEmployeeId));

  const changerRoleBtn = document.getElementById('btn-changer-role');
  if (changerRoleBtn) changerRoleBtn.addEventListener('click', () => openChangeRoleModal(state.currentEmployeeId));

  const editBtn = document.getElementById('btn-edit-employee');
  if (editBtn) editBtn.addEventListener('click', () => openEmployeeModal(state.currentEmployeeId));

  const editCoordonneesBtn = document.getElementById('btn-edit-coordonnees');
  if (editCoordonneesBtn) editCoordonneesBtn.addEventListener('click', () => openCoordonneesModal(state.currentEmployeeId));

  document.getElementById('btn-request-leave').addEventListener('click', () => openLeaveRequestModal(state.currentEmployeeId, 'conge'));
  document.getElementById('btn-request-telework').addEventListener('click', () => openTeleworkRequestModal(state.currentEmployeeId));

  document.querySelectorAll('[data-adjust-compteur]').forEach(btn => {
    btn.addEventListener('click', () => openAjusterCompteurModal(state.currentEmployeeId, btn.dataset.adjustCompteur));
  });

  const archiveBtn = document.getElementById('btn-archive-employee');
  if (archiveBtn) archiveBtn.addEventListener('click', () => {
    const e = employeeRepository.getById(state.currentEmployeeId);
    const willArchive = !e.archive;
    openConfirm({
      title: willArchive ? 'Archiver ce salarié ?' : 'Réactiver ce salarié ?',
      message: willArchive
        ? `${e.prenom} ${e.nom} sera marqué comme inactif et archivé. Ses données restent conservées.`
        : `${e.prenom} ${e.nom} sera réactivé et repassera au statut actif.`,
      confirmLabel: willArchive ? 'Archiver' : 'Réactiver',
      onConfirm: () => {
        employeeRepository.archive(e.id, willArchive);
        showToast(willArchive ? 'Salarié archivé.' : 'Salarié réactivé.');
        render();
      }
    });
  });

  const deleteBtn = document.getElementById('btn-delete-employee');
  if (deleteBtn) deleteBtn.addEventListener('click', () => {
    const e = employeeRepository.getById(state.currentEmployeeId);
    openConfirm({
      title: 'Supprimer définitivement ?',
      message: `Cette action est irréversible. La fiche de ${e.prenom} ${e.nom} sera définitivement supprimée.`,
      confirmLabel: 'Supprimer',
      danger: true,
      onConfirm: () => {
        employeeRepository.delete(e.id);
        showToast('Salarié supprimé.');
        navigateTo('employees');
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Vue : Congés (demandes + types paramétrables)
// ---------------------------------------------------------------------------

/** §sprint refonte UX §7+8 : fusion Congés/Absences/Télétravail (nav "absences") — un seul écran à
 * 3 onglets de premier niveau, chacun réutilisant tel quel son moteur existant (renderCongesDemandes/
 * renderTeletravail*). L'onglet "Types" disparaît ici : la gestion des types reste UNIQUEMENT dans
 * Paramètres > Types d'absences (renderParametresTypesAbsences, déjà en place) — une seule source de
 * vérité, comme demandé (§8). Télétravail garde son propre sous-onglet Demandes/Planning en 2ᵉ niveau
 * (pas un doublon : le Planning hebdomadaire n'existe pas pour Congés/Absences). */
function renderAbsencesHub() {
  const user = authRepository.getCurrentUser();
  const canValider = ['manager', 'rh', 'directeur'].includes(user.role);
  const tab = state.absencesHubTab || 'conges';
  const TABS = {
    conges: { label: 'Congés', subtitle: 'Demandes de congés payés, RTT, ancienneté...', btnId: 'btn-conges-a-valider' },
    autres: { label: 'Absences', subtitle: 'Maladie, événements familiaux et autres absences paramétrables', btnId: 'btn-autres-absences-a-valider' },
    teletravail: { label: 'Télétravail', subtitle: 'Demandes, validations et planning hebdomadaire', btnId: 'btn-teletravail-a-valider' }
  };

  return `
    <div class="view-header view-header-row">
      <div>
        <h1>Congés & absences</h1>
        <p class="view-subtitle">${TABS[tab].subtitle}</p>
      </div>
      ${canValider ? `<div class="detail-header-actions"><button type="button" class="btn btn-secondary btn-sm" id="${TABS[tab].btnId}">Voir les demandes à valider</button></div>` : ''}
    </div>
    <div class="tabs">
      ${Object.keys(TABS).map(key => `<button class="tab ${tab === key ? 'active' : ''}" data-absences-hub-tab="${key}">${TABS[key].label}</button>`).join('')}
    </div>
    <div id="absences-hub-tab-content">
      ${tab === 'conges' ? renderCongesDemandes('conge') : tab === 'autres' ? renderCongesDemandes('autre') : renderAbsencesHubTeletravail()}
    </div>
  `;
}

function renderAbsencesHubTeletravail() {
  return `
    <div class="tabs" style="margin-bottom: 14px;">
      <button class="tab ${state.teletravailTab === 'demandes' ? 'active' : ''}" data-teletravail-tab="demandes">Demandes</button>
      <button class="tab ${state.teletravailTab === 'planning' ? 'active' : ''}" data-teletravail-tab="planning">Planning</button>
    </div>
    ${state.teletravailTab === 'planning' ? renderTeletravailPlanning() : renderTeletravailDemandes()}
  `;
}

function bindAbsencesHubEvents() {
  const tab = state.absencesHubTab || 'conges';

  document.querySelectorAll('[data-absences-hub-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.absencesHubTab = btn.dataset.absencesHubTab;
      render();
    });
  });

  const btnAValider = document.getElementById('btn-conges-a-valider') || document.getElementById('btn-autres-absences-a-valider') || document.getElementById('btn-teletravail-a-valider');
  if (btnAValider) {
    btnAValider.addEventListener('click', () => {
      if (tab === 'teletravail') Object.assign(state, NAVPARAMS_TELETRAVAIL_A_VALIDER);
      else Object.assign(state, NAVPARAMS_CONGES_A_VALIDER);
      render();
    });
  }

  if (tab === 'conges') bindCongesDemandesEvents('conge');
  else if (tab === 'autres') bindCongesDemandesEvents('autre');
  else {
    document.querySelectorAll('[data-teletravail-tab]').forEach(btn => {
      btn.addEventListener('click', () => { state.teletravailTab = btn.dataset.teletravailTab; render(); });
    });
    if (state.teletravailTab === 'planning') bindTeletravailPlanningEvents();
    else bindTeletravailDemandesEvents();
  }
}

// ---- Sous-vue : Demandes ----

function getFilteredLeaveRequests(categorie = 'conge') {
  const filters = categorie === 'conge' ? state.congesFilters : state.autresAbsencesFilters;
  let list = leaveRepository.getAll().filter(r => {
    const type = leaveTypeRepository.getLeaveTypeById(r.typeId);
    return type && type.categorie === categorie;
  });
  const visibleIds = getVisibleEmployeeIdsForCurrentUser();
  if (visibleIds !== null) list = list.filter(r => visibleIds.includes(r.employeeId));
  if (filters.employeeId) list = list.filter(r => r.employeeId === filters.employeeId);
  if (filters.typeId) list = list.filter(r => r.typeId === filters.typeId);
  if (filters.statut) list = list.filter(r => r.statut === filters.statut);
  return list;
}

function renderCongesDemandes(categorie = 'conge') {
  const filters = categorie === 'conge' ? state.congesFilters : state.autresAbsencesFilters;
  const pageKey = categorie === 'conge' ? 'congesPage' : 'autresAbsencesPage';
  const employees = getScopedEmployeesForFilters();
  const types = leaveTypeRepository.getLeaveTypes().filter(t => t.categorie === categorie);
  const requests = getFilteredLeaveRequests(categorie);
  const { pageItems, totalPages, page, pageStart } = paginate(requests, pageKey);

  return `
    <div class="view-header-row">
      <p class="view-subtitle">${requests.length} demande${requests.length > 1 ? 's' : ''}</p>
      <div class="detail-header-actions">
        <button class="btn btn-secondary" id="btn-export-conges">Exporter CSV</button>
        <button class="btn btn-primary" id="btn-new-leave-request">+ Nouvelle demande</button>
      </div>
    </div>

    ${renderDraftsCard(categorie === 'conge' ? 'conge' : 'autre-absence')}

    <div class="toolbar card">
      <select id="conges-filter-employee" class="input">
        <option value="">Tous les salariés</option>
        ${employees.map(e => `<option value="${e.id}" ${filters.employeeId === e.id ? 'selected' : ''}>${escapeHtml(e.prenom)} ${escapeHtml(e.nom)}</option>`).join('')}
      </select>
      <select id="conges-filter-type" class="input">
        <option value="">Tous les types</option>
        ${types.map(t => `<option value="${t.id}" ${filters.typeId === t.id ? 'selected' : ''}>${escapeHtml(t.nom)}</option>`).join('')}
      </select>
      <select id="conges-filter-statut" class="input">
        <option value="">Tous les statuts</option>
        ${['En attente', 'Validé', 'Refusé', 'Annulé'].map(s => `<option value="${s}" ${filters.statut === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
    </div>

    <div class="card table-card">
      ${requests.length === 0 ? `<div class="empty-state"><div class="empty-icon">🏖️</div><p>Aucune demande ne correspond à ces filtres.</p></div>` : `
        <table class="table">
          <thead>
            <tr>
              <th>Salarié</th>
              <th>Type</th>
              <th>Période</th>
              <th>Jours</th>
              <th>Statut</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${pageItems.map(renderLeaveRequestRow).join('')}
          </tbody>
        </table>
        ${renderPaginationControls(page, totalPages, pageStart, pageItems.length, requests.length)}
      `}
    </div>
  `;
}

function renderLeaveRequestRow(r) {
  const employee = employeeRepository.getById(r.employeeId);
  const type = leaveTypeRepository.getLeaveTypeById(r.typeId);
  if (!employee || !type) return '';

  const periode = r.dateDebut === r.dateFin
    ? formatDate(r.dateDebut) + (r.demiJournee ? ` (${r.demiJournee === 'matin' ? 'matin' : 'après-midi'})` : '')
    : `${formatDate(r.dateDebut)} → ${formatDate(r.dateFin)}`;

  return `
    <tr data-request-id="${r.id}">
      <td>${escapeHtml(employee.prenom)} ${escapeHtml(employee.nom)}</td>
      <td><span class="badge badge-muted"><span class="type-swatch" style="background:${escapeHtml(type.couleur)}"></span>${escapeHtml(type.icone)} ${escapeHtml(type.nom)}</span></td>
      <td>${periode}</td>
      <td>${formatDurationFR(r.nbJours)}</td>
      <td>${renderRequestStatutBadge(r)}</td>
      <td class="table-actions">${renderRequestActions(r, type)}</td>
    </tr>
  `;
}

/** Badge de statut générique, réutilisé par Congés, Télétravail et Notes de frais (même moteur de workflow). */
function renderRequestStatutBadge(r) {
  const map = { 'En attente': 'warning', 'Validé': 'success', 'Remboursé': 'success', 'Refusé': 'muted', 'Annulé': 'muted' };
  const currentRole = r.statut === 'En attente' && r.workflow && r.workflow[r.etapeIndex];
  const suffix = currentRole ? ` (${ROLE_LABELS[currentRole] || currentRole})` : '';
  return `<span class="badge badge-${map[r.statut] || 'muted'}">${escapeHtml(r.statut)}${suffix}</span>`;
}

/**
 * Un salarié ne peut jamais valider de demande. Un manager ne peut agir que sur
 * les demandes de membres de son équipe. RH et Directeur peuvent toujours agir.
 * `allowComptabilite` ouvre l'action à la Comptabilité (utilisé pour les notes de frais).
 */
/**
 * Un utilisateur ne peut valider une demande que si c'est actuellement le tour de son rôle
 * dans la chaîne de validation de la demande (`request.workflow[request.etapeIndex]`).
 * RH et Directeur peuvent toujours agir (accès complet) ; un manager uniquement sur son équipe.
 *
 * domain: 'absence' (congés/télétravail, défaut) consulte hasPermission(VALIDER_ABSENCE) ;
 * 'frais' (notes de frais) consulte hasPermission(VALIDER_NOTE_FRAIS) — dans les deux cas
 * surchargeable individuellement (§8). Le bypass ne concerne que RH/Directeur par défaut :
 * Comptabilité n'a pas VALIDER_NOTE_FRAIS et continue de ne passer qu'à son étage du workflow
 * (`requiredRole === 'comptabilite'`), exactement comme avant.
 *
 * Pour 'frais' spécifiquement, une fois l'étape de workflow confirmée (rôle + équipe le cas échéant),
 * une seconde permission plus fine s'applique SANS élargir l'accès à d'autres étapes : CONTROLER_NOTE_FRAIS
 * pour toute étape non finale (vérification), MARQUER_NOTE_REMBOURSEE pour la dernière étape (paiement).
 * Contrairement à VALIDER_NOTE_FRAIS ci-dessus, ces deux permissions ne sont PAS vérifiées avant le
 * rôle/l'équipe : elles ne font que restreindre davantage un accès déjà accordé par l'étape du workflow,
 * jamais l'élargir à une autre étape — sinon on recrée le même bypass company-wide déjà corrigé pour
 * VALIDER_ABSENCE/VALIDER_NOTE_FRAIS chez le manager.
 */
/** Étape de workflow en cours (rôle courant + équipe le cas échéant + granularité frais), SANS bypass —
 * factorisé entre canActOnRequestFor (Valider) et canRefuserRequestFor (Refuser) ci-dessous, qui ne
 * diffèrent que par la permission de bypass consultée avant d'en arriver là. */
function isCurrentWorkflowStepFor(request, user, domain) {
  const requiredRole = request.workflow[request.etapeIndex];
  if (user.role !== requiredRole) return false;
  if (domain === 'frais') {
    const derniereEtape = request.etapeIndex === request.workflow.length - 1;
    if (!hasPermission(user, derniereEtape ? PERMISSIONS.MARQUER_NOTE_REMBOURSEE : PERMISSIONS.CONTROLER_NOTE_FRAIS)) return false;
  }
  if (requiredRole === ROLES.MANAGER) {
    const emp = employeeRepository.getById(request.employeeId);
    return Boolean(emp && (emp.managerIds || []).includes(user.id));
  }
  return true;
}

/** Le Directeur n'a personne au-dessus de lui dans la hiérarchie pour valider ses propres congés —
 * seul cas où la séparation des tâches est levée, et seulement pour les congés/absences/télétravail
 * (domain 'absence'), jamais pour les notes de frais : le circuit financier reste séparé même pour lui. */
function canSelfServiceAsDirecteur(user, domain) {
  return domain === 'absence' && user.role === ROLES.DIRECTEUR;
}

function canActOnRequestFor(request, domain = 'absence') {
  const user = authRepository.getCurrentUser();
  if (!user || !request.workflow || request.etapeIndex < 0 || request.etapeIndex >= request.workflow.length) return false;
  // séparation des tâches : personne ne valide sa propre demande, même RH — sauf le Directeur (§ci-dessus).
  if (request.employeeId === user.id && !canSelfServiceAsDirecteur(user, domain)) return false;
  if (hasPermission(user, domain === 'frais' ? PERMISSIONS.VALIDER_NOTE_FRAIS : PERMISSIONS.VALIDER_ABSENCE)) return true;
  return isCurrentWorkflowStepFor(request, user, domain);
}

/** Refuser une demande (§8) : REFUSER_ABSENCE est une permission distincte de VALIDER_ABSENCE pour
 * congés/télétravail — un Directeur peut ainsi accorder (ou retirer) le droit de refuser
 * indépendamment de celui de valider. Pas de permission "refuser une note de frais" distincte au
 * catalogue : même règle que Valider pour le domaine 'frais'. */
function canRefuserRequestFor(request, domain = 'absence') {
  const user = authRepository.getCurrentUser();
  if (!user || !request.workflow || request.etapeIndex < 0 || request.etapeIndex >= request.workflow.length) return false;
  if (request.employeeId === user.id && !canSelfServiceAsDirecteur(user, domain)) return false;
  if (hasPermission(user, domain === 'frais' ? PERMISSIONS.VALIDER_NOTE_FRAIS : PERMISSIONS.REFUSER_ABSENCE)) return true;
  return isCurrentWorkflowStepFor(request, user, domain);
}

/** Pour les actions post-validation (ex. Annuler) qui ne dépendent plus de l'étape de workflow.
 * Même logique de domain que canActOnRequestFor ci-dessus. */
function canManageRequestFor(employeeId, domain = 'absence') {
  const user = authRepository.getCurrentUser();
  if (!user) return false;
  // séparation des tâches : personne ne gère sa propre demande, même RH — sauf le Directeur (congés/absences).
  if (employeeId === user.id && !canSelfServiceAsDirecteur(user, domain)) return false;
  if (hasPermission(user, domain === 'frais' ? PERMISSIONS.VALIDER_NOTE_FRAIS : PERMISSIONS.ANNULER_ABSENCE)) return true;
  if (user.role === ROLES.MANAGER) {
    const emp = employeeRepository.getById(employeeId);
    return Boolean(emp && (emp.managerIds || []).includes(user.id));
  }
  return false;
}

function renderRequestActions(r, type) {
  const historyBtn = `<button class="btn-link" data-history="${r.id}">Historique</button>`;
  if (r.statut === 'En attente') {
    return `
      ${historyBtn}
      ${canActOnRequestFor(r) ? `<button class="btn-link" data-approve="${r.id}">Valider</button>` : ''}
      ${canRefuserRequestFor(r) ? `<button class="btn-link btn-link-danger" data-refuse="${r.id}">Refuser</button>` : ''}
    `;
  }
  if (r.statut === 'Validé') {
    // §24 : "Prolonger l'arrêt" — réservé aux types "saisie réservée RH" (maladie et assimilés,
    // voir SS15) et à qui a la permission PROLONGER_MALADIE.
    const canProlonger = !type.saisiParSalarie && hasPermission(authRepository.getCurrentUser(), PERMISSIONS.PROLONGER_MALADIE);
    return `
      ${historyBtn}
      <button class="btn-link" data-attestation="${r.id}">Attestation</button>
      ${canProlonger ? `<button class="btn-link" data-prolonger="${r.id}">Prolonger</button>` : ''}
      ${canManageRequestFor(r.employeeId) ? `<button class="btn-link" data-regulariser="${r.id}">Régulariser</button>` : ''}
      ${canManageRequestFor(r.employeeId) ? `<button class="btn-link btn-link-danger" data-cancel="${r.id}">Annuler</button>` : ''}
    `;
  }
  return historyBtn;
}

/** Sprint SIRH premium §11 : Historique — fusionne `historique` (création/étapes de validation du
 * workflow/refus/annulation, déjà alimenté à chaque action) et `regularisations` (rectifications
 * après validation, § régularisation) en une seule timeline chronologique, lecture seule. Le
 * télétravail et les notes de frais n'ont pas de mécanisme de régularisation — `regularisations` y
 * est simplement absent/vide, la fusion le gère nativement sans code spécifique par type. */
function buildRequestTimeline(request) {
  const entries = [
    ...(request.historique || []).map(h => ({ date: h.date, label: h.action })),
    ...(request.regularisations || []).map(r => ({
      date: r.date,
      label: `Rectifiée : ${r.ancienType} du ${formatDate(r.ancienneDateDebut)}${r.ancienneDateDebut !== r.ancienneDateFin ? ' au ' + formatDate(r.ancienneDateFin) : ''}${r.motif ? ' — ' + r.motif : ''}`
    }))
  ];
  return entries.sort((a, b) => new Date(a.date) - new Date(b.date));
}

function openRequestHistoryModal(request) {
  if (!request) { showToast('Cette demande n\'est plus disponible.', 'error'); return; }
  const timeline = buildRequestTimeline(request);
  const html = `
    <div class="modal modal-small">
      <div class="modal-header">
        <h2>Historique de la demande</h2>
        <button class="btn-icon" id="btn-close-modal" aria-label="Fermer" title="Fermer">✕</button>
      </div>
      <div class="modal-body">
        ${timeline.length === 0 ? '<p class="text-muted">Aucun historique disponible.</p>' : `
          <div class="timeline">
            ${timeline.map(e => `
              <div class="timeline-item">
                <div class="timeline-date text-muted">${formatDateTime(e.date)}</div>
                <div class="timeline-label">${escapeHtml(e.label)}</div>
              </div>
            `).join('')}
          </div>
        `}
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Fermer</button>
      </div>
    </div>
  `;
  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = html;
  modalRoot.classList.add('open');
  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
}

/** Bouton "Historique" réutilisé identiquement par Congés/Autres absences, Télétravail et Notes de
 * frais (un seul `data-history`, un seul point de câblage — les 3 écrans ne rendent jamais leurs
 * lignes en même temps, donc aucun risque de collision d'attribut entre eux). `repo` est le
 * repository dont dépendent les lignes affichées (leaveRepository/teleworkRepository/
 * expenseRepository), pour retrouver la bonne demande par id. */
function bindHistoryButtons(repo) {
  document.querySelectorAll('[data-history]').forEach(btn => {
    btn.addEventListener('click', () => openRequestHistoryModal(repo.getById(btn.dataset.history)));
  });
}

// ---- Modale : Prolonger un arrêt (§24) ----

function openProlongerModal(requestId) {
  const request = leaveRepository.getById(requestId);
  if (!request) { showToast('Cette demande n\'est plus disponible.', 'error'); return; }
  const employee = employeeRepository.getById(request.employeeId);
  const type = leaveTypeRepository.getLeaveTypeById(request.typeId);

  const html = `
    <div class="modal modal-small">
      <div class="modal-header">
        <h2>Prolonger l'arrêt</h2>
        <button class="btn-icon" id="btn-close-modal" aria-label="Fermer" title="Fermer">✕</button>
      </div>
      <form id="prolonger-form">
        <div class="modal-body">
          <p class="text-muted">${escapeHtml(employee.prenom)} ${escapeHtml(employee.nom)} · ${escapeHtml(type.nom)} · actuellement jusqu'au ${formatDate(request.dateFin)}</p>
          ${textField('nouvelleDateFin', 'Nouvelle date de fin', '', true, 'date')}
          <div class="form-field" style="margin-top: 12px;">
            <label for="f-prolongation-justificatif">Nouveau justificatif (optionnel)</label>
            <input class="input" type="file" id="f-prolongation-justificatif">
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Annuler</button>
          <button type="submit" class="btn btn-primary">Prolonger</button>
        </div>
      </form>
    </div>
  `;

  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = html;
  modalRoot.classList.add('open');
  state.pendingAttachment = null;

  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
  document.getElementById('f-prolongation-justificatif').addEventListener('change', handleAttachmentChange);
  document.getElementById('prolonger-form').addEventListener('submit', (evt) => {
    evt.preventDefault();
    const nouvelleDateFin = document.getElementById('f-nouvelleDateFin').value;
    const result = leaveRepository.prolonger(requestId, nouvelleDateFin, state.pendingAttachment);
    if (!result.success) { showToast(result.error, 'error'); return; }
    showToast('Arrêt prolongé.');
    closeModal();
    render();
  });
}

/** Régularisation (§ demandée en cours de session) d'une demande déjà validée : corrige le type
 * et/ou les dates après coup (erreur de saisie, ou pour formaliser ce qui s'est réellement passé),
 * réservée à qui peut déjà gérer la demande (même contrôle que "Annuler"). Le type proposé reste
 * dans la MÊME catégorie (congé ou autre absence) que le type actuel — changer de catégorie via
 * une régularisation mélangerait des règles de saisie différentes (§15) sans raison claire. */
function openRegulariserModal(requestId) {
  const request = leaveRepository.getById(requestId);
  if (!request) { showToast('Cette demande n\'est plus disponible.', 'error'); return; }
  const employee = employeeRepository.getById(request.employeeId);
  const currentType = leaveTypeRepository.getLeaveTypeById(request.typeId);
  // Inclut le type ACTUEL même s'il a été désactivé depuis (sinon le select retombe sur le fallback
  // générique de selectField, qui affiche l'id brut plutôt qu'un nom lisible — même bug déjà corrigé
  // pour les établissements désactivés).
  const typesMemeCategorie = leaveTypeRepository.getLeaveTypes().filter(t =>
    t.categorie === currentType.categorie && (t.actif || t.id === currentType.id));

  const html = `
    <div class="modal modal-small">
      <div class="modal-header">
        <h2>Régulariser la demande</h2>
        <button class="btn-icon" id="btn-close-modal" aria-label="Fermer" title="Fermer">✕</button>
      </div>
      <form id="regulariser-form">
        <div class="modal-body">
          <p class="text-muted">${escapeHtml(employee.prenom)} ${escapeHtml(employee.nom)} — actuellement ${escapeHtml(currentType.nom)}, du ${formatDate(request.dateDebut)} au ${formatDate(request.dateFin)}.</p>
          ${selectField('typeId', 'Type', null, request.typeId, typesMemeCategorie.map(t => ({ value: t.id, label: t.actif ? t.nom : `${t.nom} (désactivé)` })))}
          <div class="form-grid" style="margin-top: 12px;">
            ${textField('dateDebut', 'Date de début', request.dateDebut, true, 'date')}
            ${textField('dateFin', 'Date de fin', request.dateFin, true, 'date')}
          </div>
          <div class="form-field" id="field-demi-journee-regul" style="margin-top: 12px; display:none;">
            <label for="f-demiJournee">Demi-journée</label>
            <select class="input" id="f-demiJournee" name="demiJournee">
              <option value="">Journée entière</option>
              <option value="matin" ${request.demiJournee === 'matin' ? 'selected' : ''}>Matin</option>
              <option value="apres-midi" ${request.demiJournee === 'apres-midi' ? 'selected' : ''}>Après-midi</option>
            </select>
          </div>
          <div class="form-field" style="margin-top: 12px;">
            <label for="f-motif">Motif de la régularisation</label>
            <input class="input" type="text" id="f-motif" name="motif" placeholder="Ex. erreur de saisie initiale, absence reclassée">
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Annuler</button>
          <button type="submit" class="btn btn-primary">Régulariser</button>
        </div>
      </form>
    </div>
  `;

  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = html;
  modalRoot.classList.add('open');

  // Même condition que updateLeaveRequestHints (création) : la demi-journée n'a de sens que sur
  // une seule journée ET si le type la permet — évite de la proposer puis de l'ignorer en silence.
  const updateDemiJourneeVisibility = () => {
    const type = leaveTypeRepository.getLeaveTypeById(document.getElementById('f-typeId').value);
    const dateDebut = document.getElementById('f-dateDebut').value;
    const dateFin = document.getElementById('f-dateFin').value;
    document.getElementById('field-demi-journee-regul').style.display =
      type && type.autoriserDemiJournee && dateDebut && dateDebut === dateFin ? 'block' : 'none';
  };
  updateDemiJourneeVisibility();
  ['f-typeId', 'f-dateDebut', 'f-dateFin'].forEach(fieldId => {
    document.getElementById(fieldId).addEventListener('change', updateDemiJourneeVisibility);
  });

  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
  document.getElementById('regulariser-form').addEventListener('submit', (evt) => {
    evt.preventDefault();
    const typeId = document.getElementById('f-typeId').value;
    const dateDebut = document.getElementById('f-dateDebut').value;
    const dateFin = document.getElementById('f-dateFin').value;
    const demiJournee = document.getElementById('field-demi-journee-regul').style.display === 'block' ? (document.getElementById('f-demiJournee').value || null) : null;
    const motif = document.getElementById('f-motif').value;
    const result = leaveRepository.regulariser(requestId, { typeId, dateDebut, dateFin, demiJournee, motif });
    if (!result.success) { showToast(result.error, 'error'); return; }
    showToast('Demande régularisée.');
    closeModal();
    render();
  });
}

function exportLeaveRequestsCSV(categorie = 'conge') {
  const requests = getFilteredLeaveRequests(categorie);
  const headers = ['Salarié', 'Type', 'Début', 'Fin', 'Jours', 'Payé', 'Statut'];
  const rows = requests.map(r => {
    const employee = employeeRepository.getById(r.employeeId);
    const type = leaveTypeRepository.getLeaveTypeById(r.typeId);
    return [
      employee ? `${employee.prenom} ${employee.nom}` : '—',
      type ? type.nom : '—',
      r.dateDebut, r.dateFin, formatNumberFR(r.nbJours),
      type && type.paye ? 'Oui' : 'Non',
      r.statut
    ];
  });
  exportRowsToCSV(headers, rows, categorie === 'conge' ? 'conges.csv' : 'autres-absences.csv');
  auditLogRepository.logAudit('Export', categorie === 'conge' ? 'Demandes de congé' : 'Demandes d\'autre absence', `${requests.length} ligne${requests.length > 1 ? 's' : ''}`);
}

function bindCongesDemandesEvents(categorie = 'conge') {
  const filters = categorie === 'conge' ? state.congesFilters : state.autresAbsencesFilters;
  const pageKey = categorie === 'conge' ? 'congesPage' : 'autresAbsencesPage';

  document.getElementById('btn-new-leave-request').addEventListener('click', () => openLeaveRequestModal(undefined, categorie));
  document.getElementById('btn-export-conges').addEventListener('click', () => exportLeaveRequestsCSV(categorie));
  bindDraftsCardEvents((draft) => openLeaveRequestModal(undefined, categorie, draft));

  document.getElementById('conges-filter-employee').addEventListener('change', (e) => {
    filters.employeeId = e.target.value;
    state[pageKey] = 1;
    render();
  });
  document.getElementById('conges-filter-type').addEventListener('change', (e) => {
    filters.typeId = e.target.value;
    state[pageKey] = 1;
    render();
  });
  document.getElementById('conges-filter-statut').addEventListener('change', (e) => {
    filters.statut = e.target.value;
    state[pageKey] = 1;
    render();
  });

  const congesPrevBtn = document.getElementById('btn-page-prev');
  if (congesPrevBtn) congesPrevBtn.addEventListener('click', () => { state[pageKey] -= 1; render(); });
  const congesNextBtn = document.getElementById('btn-page-next');
  if (congesNextBtn) congesNextBtn.addEventListener('click', () => { state[pageKey] += 1; render(); });

  document.querySelectorAll('[data-approve]').forEach(btn => {
    btn.addEventListener('click', () => handleApproveRequest(btn.dataset.approve));
  });
  document.querySelectorAll('[data-refuse]').forEach(btn => {
    btn.addEventListener('click', () => handleRefuseRequest(btn.dataset.refuse));
  });
  document.querySelectorAll('[data-cancel]').forEach(btn => {
    btn.addEventListener('click', () => handleCancelRequest(btn.dataset.cancel));
  });
  document.querySelectorAll('[data-attestation]').forEach(btn => {
    btn.addEventListener('click', () => openLeaveAttestationModal(btn.dataset.attestation));
  });

  document.querySelectorAll('[data-prolonger]').forEach(btn => {
    btn.addEventListener('click', () => openProlongerModal(btn.dataset.prolonger));
  });
  document.querySelectorAll('[data-regulariser]').forEach(btn => {
    btn.addEventListener('click', () => openRegulariserModal(btn.dataset.regulariser));
  });
  bindHistoryButtons(leaveRepository);
}

// ---- Modale : Attestation de congé (imprimable / export PDF) ----

function openLeaveAttestationModal(requestId) {
  const r = leaveRepository.getById(requestId);
  if (!r) { showToast('Cette demande n\'est plus disponible.', 'error'); return; }
  const employee = employeeRepository.getById(r.employeeId);
  const type = leaveTypeRepository.getLeaveTypeById(r.typeId);
  const periode = r.dateDebut === r.dateFin
    ? formatDate(r.dateDebut) + (r.demiJournee ? ` (${r.demiJournee === 'matin' ? 'matin' : 'après-midi'})` : '')
    : `du ${formatDate(r.dateDebut)} au ${formatDate(r.dateFin)}`;

  const html = `
    <div class="modal">
      <div class="modal-header">
        <h2>Attestation de congé</h2>
        <button class="btn-icon" id="btn-close-modal" aria-label="Fermer" title="Fermer">✕</button>
      </div>
      <div class="modal-body">
        <div class="print-area print-document">
          <div class="print-header">
            <h1>Attestation de congés</h1>
            <p class="text-muted">Émise le ${formatDate(toISODate(new Date()))}</p>
          </div>
          <p class="print-attestation-text">
            Nexus atteste que <strong>${escapeHtml(employee.prenom)} ${escapeHtml(employee.nom)}</strong>
            (matricule ${escapeHtml(employee.matricule)}), ${escapeHtml(employee.poste || 'salarié·e')},
            a bénéficié d'un congé de type <strong>${escapeHtml(type.nom)}</strong> ${periode},
            soit ${formatNumberFR(r.nbJours)} jour${r.nbJours > 1 ? 's' : ''}.
          </p>
          <div class="print-signature">
            <span>Fait pour valoir ce que de droit.</span>
            <span class="print-signature-line">Signature RH</span>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Fermer</button>
        <button type="button" class="btn btn-primary" id="btn-print-attestation">Imprimer / Export PDF</button>
      </div>
    </div>
  `;

  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = html;
  modalRoot.classList.add('open');

  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
  document.getElementById('btn-print-attestation').addEventListener('click', () => {
    auditLogRepository.logAudit('Export', 'Attestation de congé', `${employee.prenom} ${employee.nom}`);
    window.print();
  });
}

function auditLabelForEmployee(employeeId) {
  const employee = employeeRepository.getById(employeeId);
  return employee ? `${employee.prenom} ${employee.nom}` : '—';
}

function handleApproveRequest(id) {
  const request = leaveRepository.getById(id);
  // Défense en profondeur : le bouton n'est déjà rendu que si canActOnRequestFor(request) est vrai,
  // mais cette fonction reste appelable directement (devtools/console) — revérifie ici. La vraie
  // barrière est de toute façon côté serveur (policies RLS Supabase), mais éviter une mise à jour
  // optimiste locale trompeuse (que Supabase rejetterait silencieusement) reste plus honnête pour l'UI.
  if (!request || !canActOnRequestFor(request)) { showToast('Action non autorisée.', 'error'); return; }
  leaveRepository.update(id, advanceWorkflow(request, 'Validé'));
  auditLogRepository.logAudit('Validation', 'Demande de congé', auditLabelForEmployee(request.employeeId));
  showToast('Demande validée.');
  render();
}

function handleRefuseRequest(id) {
  const request = leaveRepository.getById(id);
  if (!request || !canRefuserRequestFor(request)) { showToast('Action non autorisée.', 'error'); return; }
  openConfirm({
    title: 'Refuser cette demande ?',
    message: 'Le salarié sera informé du refus. Ses jours ne seront pas décomptés.',
    confirmLabel: 'Refuser',
    danger: true,
    onConfirm: () => {
      leaveRepository.update(id, refuseRequest(request));
      auditLogRepository.logAudit('Refus', 'Demande de congé', auditLabelForEmployee(request.employeeId));
      showToast('Demande refusée.');
      render();
    }
  });
}

function handleCancelRequest(id) {
  const request = leaveRepository.getById(id);
  if (!request || !canManageRequestFor(request.employeeId)) { showToast('Action non autorisée.', 'error'); return; }
  openConfirm({
    title: 'Annuler cette demande ?',
    message: 'Les jours seront recrédités sur le compteur du salarié.',
    confirmLabel: 'Annuler la demande',
    danger: true,
    onConfirm: () => {
      leaveRepository.update(id, cancelRequest(request));
      auditLogRepository.logAudit('Annulation', 'Demande de congé', auditLabelForEmployee(request.employeeId));
      showToast('Demande annulée.');
      render();
    }
  });
}

/** Sprint SIRH premium §10 : les 3 modales de demande (congé/absence, télétravail, note de frais)
 * peuvent s'ouvrir sur un brouillon repris — beginDraftEdit()/finalizeDraftEdit() portent les 2
 * lignes autrement copiées-collées dans chacune des 3 modales (au open) et chacun des 3 submit
 * handlers (au succès), pour que "reprendre un brouillon" reste un seul mécanisme à faire évoluer. */
function beginDraftEdit(draft) {
  state.editingDraftId = draft ? draft.id : null;
}

function finalizeDraftEdit() {
  if (state.editingDraftId) { draftRepository.delete(state.editingDraftId); state.editingDraftId = null; }
}

/** Sprint SIRH premium §10 : enregistre l'état ACTUEL du formulaire comme brouillon, sans aucune
 * validation (un brouillon peut être incomplet par définition — c'est tout l'intérêt). `extra`
 * porte les champs qui ne sont pas de simples <input name="…"> (catégorie congé/absence, pièce
 * jointe déjà lue en dataURL via state.pendingAttachment). Un brouillon en cours de reprise
 * (state.editingDraftId) est écrasé plutôt que dupliqué. */
function saveDraftFromForm(form, type, extra) {
  const formData = new FormData(form);
  const champs = {};
  for (const [key, value] of formData.entries()) champs[key] = value;
  Object.assign(champs, extra || {});
  finalizeDraftEdit();
  draftRepository.create({ ownerId: authRepository.getCurrentUser().id, type, champs });
  closeModal();
  showToast('Brouillon enregistré.');
  render();
}

/** Sprint SIRH premium §10 : carte "Mes brouillons", réutilisée par Congés/Autres absences,
 * Télétravail et Notes de frais — ne montre que les brouillons de L'UTILISATEUR COURANT (peu
 * importe pour qui la demande est destinée, cf. saveDraftFromForm) et du type demandé. Pas de carte
 * du tout si la liste est vide, pour ne jamais ajouter de bruit à un écran qui n'en a pas besoin. */
function renderDraftsCard(type) {
  const drafts = draftRepository.getForOwner(authRepository.getCurrentUser().id, type);
  if (!drafts.length) return '';
  return `
    <div class="card">
      <h2>Mes brouillons</h2>
      <div class="mini-list">
        ${drafts.map(d => `
          <div class="mini-list-item">
            <span>${draftSummaryLabel(d)} <span class="text-muted">· modifié le ${formatDate(d.dateModification)}</span></span>
            <span class="table-actions">
              <button type="button" class="btn btn-secondary btn-sm" data-draft-resume="${d.id}">Reprendre</button>
              <button type="button" class="btn btn-secondary btn-sm" data-draft-delete="${d.id}">Supprimer</button>
            </span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function draftSummaryLabel(draft) {
  const c = draft.champs || {};
  if (draft.type === 'conge' || draft.type === 'autre-absence') {
    const type = c.typeId ? leaveTypeRepository.getLeaveTypeById(c.typeId) : null;
    return `${type ? escapeHtml(type.icone) + ' ' + escapeHtml(type.nom) : 'Type non choisi'}${c.dateDebut ? ' · ' + formatDate(c.dateDebut) : ''}`;
  }
  if (draft.type === 'teletravail') {
    return `💻 Télétravail${c.dateDebut ? ' · ' + formatDate(c.dateDebut) : ''}`;
  }
  if (draft.type === 'frais') {
    return `🧾 ${escapeHtml(c.libelle || c.categorie || 'Note de frais')}${c.montantTTC ? ' · ' + formatCurrencyFR(Number(c.montantTTC)) : ''}`;
  }
  return 'Brouillon';
}

function bindDraftsCardEvents(resumeHandler) {
  document.querySelectorAll('[data-draft-resume]').forEach(btn => {
    btn.addEventListener('click', () => resumeHandler(draftRepository.getById(btn.dataset.draftResume)));
  });
  document.querySelectorAll('[data-draft-delete]').forEach(btn => {
    btn.addEventListener('click', () => {
      const draftId = btn.dataset.draftDelete;
      openConfirm({
        title: 'Supprimer ce brouillon ?',
        message: 'Cette action est irréversible.',
        confirmLabel: 'Supprimer',
        danger: true,
        onConfirm: () => { draftRepository.delete(draftId); showToast('Brouillon supprimé.'); render(); }
      });
    });
  });
}

// ---- Modale : Nouvelle demande de congé ----

/**
 * Champ "Salarié" des modales de demande : un Salarié ne peut demander que pour
 * lui-même (champ verrouillé), les autres rôles gardent le sélecteur, restreint
 * à leur périmètre visible (équipe pour un manager, tout le monde pour RH/Directeur).
 */
function employeeFieldForRequest(presetEmployeeId, employees) {
  const user = authRepository.getCurrentUser();
  if (user.role === ROLES.SALARIE) {
    return `
      <input type="hidden" id="f-employeeId" name="employeeId" value="${escapeHtml(user.id)}">
      <div class="form-field">
        <label>Salarié</label>
        <input class="input" type="text" value="${escapeHtml(user.prenom)} ${escapeHtml(user.nom)}" disabled>
      </div>
    `;
  }
  const visibleIds = getVisibleEmployeeIdsForCurrentUser();
  const scoped = visibleIds === null ? employees : employees.filter(e => visibleIds.includes(e.id));
  return selectField('employeeId', 'Salarié', null, presetEmployeeId || '', scoped.map(e => ({ value: e.id, label: `${e.prenom} ${e.nom}` })));
}

/** Sprint SIRH premium §10 : `draft` (optionnel) = brouillon repris via "Reprendre" dans la liste
 * "Mes brouillons" — préremplit le formulaire et fait passer le futur submit en mode "convertir le
 * brouillon" (state.editingDraftId) plutôt que "créer depuis zéro" ; supprimé automatiquement une
 * fois la demande réellement envoyée. */
/** presetDate : préremplit début ET fin (clic sur une case du calendrier, §sprint calendrier
 * interactif) — ignoré si un brouillon fournit déjà ses propres dates. */
function openLeaveRequestModal(presetEmployeeId, categorie, draft, presetDate) {
  const employees = employeeRepository.getAll().filter(e => !e.archive);
  // §15/§24 : un type marqué "saisie réservée aux RH" (ex. Maladie) ne doit pas être proposé à qui
  // n'a pas SAISIR_MALADIE — sinon un salarié pourrait se déclarer lui-même en arrêt maladie alors
  // que le cahier des charges l'attribue exclusivement au service RH.
  const canSaisirRestreint = hasPermission(authRepository.getCurrentUser(), PERMISSIONS.SAISIR_MALADIE);
  const currentUser = authRepository.getCurrentUser();
  // Sprint SIRH premium §1 : un salarié (uniquement en libre-service sur SA PROPRE fiche — jamais
  // un manager/RH créant une demande pour le compte d'un tiers, qui agit à titre administratif, cf.
  // le même principe que le contournement SAISIR_MALADIE ci-dessus) ne peut demander que les types
  // que l'entreprise ET sa propre fiche autorisent (cf. renderTypesAbsenceCard).
  const typesDesactivesPourSoi = currentUser.role === ROLES.SALARIE
    ? new Set(currentUser.typesAbsenceDesactives || [])
    : new Set();
  // §3 sprint amélioration : si on connaît déjà le salarié cible (cas le plus courant, libre-
  // service), on ne lui propose même pas un type pour lequel il n'est pas éligible — le contrôle à
  // la soumission (submitLeaveRequestForm) reste le filet de sécurité pour le cas où un RH/manager
  // choisit le salarié dans un menu déroulant du formulaire, pas encore connu ici.
  const presetEmployee = presetEmployeeId ? employeeRepository.getById(presetEmployeeId) : null;
  const categoriesSalarie = categorieSalarieRepository.getAll();
  const types = leaveTypeRepository.getLeaveTypes().filter(t =>
    t.actif && t.visibleSalarie && (!categorie || t.categorie === categorie) &&
    (t.saisiParSalarie || canSaisirRestreint) && !typesDesactivesPourSoi.has(t.id) &&
    (!presetEmployee || isLeaveTypeEligibleForEmployee(presetEmployee, t, categoriesSalarie)));
  const champs = (draft && draft.champs) || {};
  if (!draft && presetDate) {
    champs.dateDebut = presetDate;
    champs.dateFin = presetDate;
  }
  state.pendingAttachment = champs.justificatif || null;
  beginDraftEdit(draft);

  // Bandeau informatif si le jour préselectionné est férié/en vacances scolaires — pour ne pas
  // perdre cette information en passant du calendrier (où elle est visible) à ce formulaire.
  let contextBanner = '';
  if (presetDate) {
    const settings = settingsRepository.getSettings();
    const ferie = getAllPublicHolidays(Number(presetDate.slice(0, 4)), settings).find(h => h.date === presetDate);
    const schoolHolidays = schoolHolidayRepository.getSchoolHolidays();
    const vacances = schoolHolidays ? findSchoolHolidayPeriod(presetDate, settings.schoolZone, schoolHolidays) : null;
    if (ferie) contextBanner = `<p class="text-muted" style="margin-top:0;">📅 ${escapeHtml(formatDate(presetDate))} est un jour férié (${escapeHtml(ferie.label)}).</p>`;
    else if (vacances) contextBanner = `<p class="text-muted" style="margin-top:0;">🎒 ${escapeHtml(formatDate(presetDate))} est en période de vacances scolaires (${escapeHtml(vacances.nom)}).</p>`;
  }

  const html = `
    <div class="modal">
      <div class="modal-header">
        <h2>${categorie === 'autre' ? 'Nouvelle demande d\'absence' : categorie === 'conge' ? 'Nouvelle demande de congé' : 'Nouvelle demande'}</h2>
        <button class="btn-icon" id="btn-close-modal" aria-label="Fermer" title="Fermer">✕</button>
      </div>
      <form id="leave-request-form">
        <div class="modal-body">
          ${contextBanner}
          <div class="form-grid">
            ${employeeFieldForRequest(presetEmployeeId || champs.employeeId, employees)}
            ${selectField('typeId', categorie === 'autre' ? 'Type d\'absence' : 'Type de congé', null, champs.typeId || '', types.map(t => ({ value: t.id, label: `${t.icone} ${t.nom}` })))}
            ${textField('dateDebut', 'Date de début', champs.dateDebut || '', true, 'date')}
            ${textField('dateFin', 'Date de fin', champs.dateFin || '', true, 'date')}
          </div>
          <div class="form-field" id="field-demi-journee" style="margin-top:14px; display:none;">
            <label>Demi-journée</label>
            <select class="input" id="f-demiJournee" name="demiJournee">
              <option value="" ${!champs.demiJournee ? 'selected' : ''}>Journée complète</option>
              <option value="matin" ${champs.demiJournee === 'matin' ? 'selected' : ''}>Matin</option>
              <option value="apres-midi" ${champs.demiJournee === 'apres-midi' ? 'selected' : ''}>Après-midi</option>
            </select>
          </div>
          <div class="form-field" style="margin-top:14px;">
            <label for="f-commentaire">Commentaire</label>
            <textarea class="input" id="f-commentaire" name="commentaire" rows="2">${escapeHtml(champs.commentaire || '')}</textarea>
          </div>
          <div class="form-field" style="margin-top:14px;">
            <label for="f-justificatif">Pièce justificative (optionnel)</label>
            <input class="input" type="file" id="f-justificatif">
            ${champs.justificatif ? `<p class="text-muted" style="margin-top:4px;">Fichier repris du brouillon : ${escapeHtml(champs.justificatif.nom)}</p>` : ''}
          </div>
          <p class="text-muted" id="leave-balance-hint" style="margin-top:12px;"></p>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Annuler</button>
          <button type="button" class="btn btn-secondary" id="btn-save-draft">Enregistrer comme brouillon</button>
          <button type="submit" class="btn btn-primary">Envoyer la demande</button>
        </div>
      </form>
    </div>
  `;

  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = html;
  modalRoot.classList.add('open');

  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
  document.getElementById('f-justificatif').addEventListener('change', handleAttachmentChange);
  document.getElementById('leave-request-form').addEventListener('submit', submitLeaveRequestForm);
  document.getElementById('btn-save-draft').addEventListener('click', () => {
    saveDraftFromForm(document.getElementById('leave-request-form'), categorie === 'autre' ? 'autre-absence' : 'conge', { categorie: categorie || 'conge', justificatif: state.pendingAttachment });
  });

  ['f-employeeId', 'f-typeId', 'f-dateDebut', 'f-dateFin'].forEach(fieldId => {
    const el = document.getElementById(fieldId);
    if (el) el.addEventListener('change', updateLeaveRequestHints);
  });
  updateLeaveRequestHints();
}

const MAX_ATTACHMENT_SIZE_BYTES = 2 * 1024 * 1024; // 2 Mo — les fichiers sont stockés en base64 dans localStorage (quota navigateur limité)

function handleAttachmentChange(e) {
  const file = e.target.files[0];
  if (!file) { state.pendingAttachment = null; return; }
  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
    showToast(`Fichier trop volumineux (${formatNumberFR(file.size / (1024 * 1024), 1)} Mo) — 2 Mo maximum.`, 'error');
    e.target.value = '';
    state.pendingAttachment = null;
    return;
  }
  const reader = new FileReader();
  reader.onload = () => { state.pendingAttachment = { nom: file.name, dataUrl: reader.result }; };
  reader.readAsDataURL(file);
}

function updateLeaveRequestHints() {
  const typeId = document.getElementById('f-typeId').value;
  const employeeId = document.getElementById('f-employeeId').value;
  const dateDebut = document.getElementById('f-dateDebut').value;
  const dateFin = document.getElementById('f-dateFin').value;
  const demiField = document.getElementById('field-demi-journee');
  const hint = document.getElementById('leave-balance-hint');

  const type = typeId ? leaveTypeRepository.getLeaveTypeById(typeId) : null;
  demiField.style.display = type && type.autoriserDemiJournee && dateDebut && dateDebut === dateFin ? 'block' : 'none';

  if (!type || !employeeId) { hint.textContent = ''; return; }
  const employee = employeeRepository.getById(employeeId);
  const balance = getLeaveBalance(employee, type, leaveRepository.getAll());
  const disponibleLabel = balance.disponible === Infinity ? 'illimité' : formatDurationFR(balance.disponible);

  let nbJoursLabel = '';
  if (dateDebut && dateFin) {
    const demiJournee = demiField.style.display === 'block' ? document.getElementById('f-demiJournee').value : '';
    const nbJours = computeWorkingDays(dateDebut, dateFin, Boolean(demiJournee), employee, settingsRepository.getSettings());
    nbJoursLabel = ` · ${formatDurationFR(nbJours)} décomptés pour cette demande`;
  }

  hint.textContent = `Solde disponible : ${disponibleLabel}${nbJoursLabel}${type.justificatifObligatoire ? ' · Justificatif obligatoire pour ce type' : ''}`;
}

function submitLeaveRequestForm(evt) {
  evt.preventDefault();
  const form = evt.target;
  const formData = new FormData(form);
  const employeeId = formData.get('employeeId');
  const typeId = formData.get('typeId');
  const dateDebut = formData.get('dateDebut');
  const dateFin = formData.get('dateFin');
  const demiJournee = document.getElementById('field-demi-journee').style.display === 'block' ? (formData.get('demiJournee') || null) : null;

  if (!employeeId || !typeId) {
    showToast('Sélectionnez un salarié et un type de congé.', 'error');
    return;
  }

  if (dateDebut && dateFin && dateFin < dateDebut) {
    showToast('La date de fin ne peut pas être avant la date de début.', 'error');
    return;
  }

  // Sprint SIRH premium §1 : "Seuls RH/Manager/Directeur peuvent créer une absence dans le passé
  // [...] Les salariés ne peuvent jamais modifier une période antérieure à aujourd'hui." — la
  // création couvre aussi la saisie initiale, pas seulement la modification d'une demande existante
  // (déjà couverte par canManageRequestFor, qui exclut systématiquement le demandeur lui-même).
  if (authRepository.getCurrentUser().role === ROLES.SALARIE && dateDebut < toISODate(new Date())) {
    showToast('Vous ne pouvez pas saisir une absence dont la date de début est déjà passée.', 'error');
    return;
  }

  const employee = employeeRepository.getById(employeeId);
  const type = leaveTypeRepository.getLeaveTypeById(typeId);

  // §15/§24 : ne fait pas confiance au seul filtrage du menu déroulant (contournable en modifiant
  // le DOM) — revérifie ici que l'utilisateur courant a le droit de saisir ce type restreint.
  if (!type.saisiParSalarie && !hasPermission(authRepository.getCurrentUser(), PERMISSIONS.SAISIR_MALADIE)) {
    showToast(`La saisie du type « ${type.nom} » est réservée aux RH.`, 'error');
    return;
  }

  // Sprint SIRH premium §1 : même principe — ne fait pas confiance au seul filtrage du menu
  // déroulant pour la liste blanche de types autorisés par salarié.
  const currentUser = authRepository.getCurrentUser();
  if (currentUser.role === ROLES.SALARIE && (currentUser.typesAbsenceDesactives || []).includes(typeId)) {
    showToast(`Le type « ${type.nom} » n'est pas autorisé pour votre profil.`, 'error');
    return;
  }

  // §3 sprint amélioration : règles d'éligibilité (ancienneté, catégorie de salarié, établissement,
  // type de contrat) — même principe défensif, ne fait pas confiance au seul filtrage de la liste
  // proposée dans le formulaire (qui ne connaît le salarié cible qu'en libre-service).
  if (!isLeaveTypeEligibleForEmployee(employee, type, categorieSalarieRepository.getAll())) {
    showToast(`« ${type.nom} » n'est pas disponible pour ce salarié (règles d'éligibilité du type).`, 'error');
    return;
  }

  // Une demande hors de la période d'emploi fausserait le solde : calculateAcquisition borne déjà
  // l'acquisition à [dateEmbauche, dateDepart], mais getLeaveBalance somme TOUTES les demandes
  // Validé/En attente sans cette même borne — un congé avant l'embauche (ou après le départ) se
  // déduirait d'un solde qui n'a jamais pu l'acquérir.
  if (employee.dateEmbauche && dateDebut < employee.dateEmbauche) {
    showToast(`La date de début ne peut pas être avant la date d'embauche (${formatDate(employee.dateEmbauche)}).`, 'error');
    return;
  }
  if (employee.dateDepart && dateFin > employee.dateDepart) {
    showToast(`La date de fin ne peut pas être après la date de départ (${formatDate(employee.dateDepart)}).`, 'error');
    return;
  }

  const nbJours = computeWorkingDays(dateDebut, dateFin, Boolean(demiJournee), employee, settingsRepository.getSettings());

  if (nbJours <= 0) {
    showToast('La période sélectionnée ne comporte aucun jour travaillé.', 'error');
    return;
  }

  if (type.justificatifObligatoire && !state.pendingAttachment) {
    showToast('Un justificatif est requis pour ce type de congé.', 'error');
    return;
  }

  if (!type.autoriserPlusieursDemandes) {
    const bothSingleDay = dateDebut === dateFin;
    const overlapping = leaveRepository.getAll().some(r => {
      if (r.employeeId !== employeeId || r.typeId !== typeId) return false;
      if (r.statut === 'Refusé' || r.statut === 'Annulé') return false;
      if (!(r.dateDebut <= dateFin && r.dateFin >= dateDebut)) return false;
      // Même exception que hasConflictingLeaveRequest : deux demi-journées complémentaires (matin +
      // après-midi) d'une même date isolée ne sont pas un vrai chevauchement.
      const sameSingleDay = bothSingleDay && r.dateDebut === r.dateFin;
      if (!sameSingleDay) return true;
      if (!demiJournee || !r.demiJournee) return true;
      return demiJournee === r.demiJournee;
    });
    if (overlapping) {
      showToast(`Une demande "${type.nom}" existe déjà sur une période qui chevauche ces dates.`, 'error');
      return;
    }
  }

  // On ne peut pas être sur deux congés/absences de TYPES DIFFÉRENTS en même temps (ex. RTT et congés
  // payés le même jour) — sauf demi-journées complémentaires, gérées par hasConflictingLeaveRequest.
  if (hasConflictingLeaveRequest(employeeId, typeId, dateDebut, dateFin, demiJournee)) {
    showToast('Ce salarié a déjà une autre demande de congé/absence active sur cette période.', 'error');
    return;
  }

  if (hasActiveRequestOverlap(teleworkRepository.getAll(), employeeId, dateDebut, dateFin)) {
    showToast('Ce salarié a déjà une demande de télétravail active sur cette période.', 'error');
    return;
  }

  leaveRepository.create({
    employeeId, typeId, dateDebut, dateFin, demiJournee, nbJours,
    commentaire: formData.get('commentaire') || '',
    justificatif: state.pendingAttachment
  });

  finalizeDraftEdit();
  showToast('Demande envoyée.');
  closeModal();
  // Ouverte depuis un clic sur le calendrier (§sprint calendrier interactif) : on y retourne au lieu
  // de filer vers la liste des demandes, pour que l'utilisateur voie tout de suite son jour rempli.
  if (state._leaveRequestReturnToCalendar) {
    state._leaveRequestReturnToCalendar = false;
    navigateTo('calendrier');
  } else if (type.categorie === 'conge') navigateTo('absences', { absencesHubTab: 'conges', congesTab: 'demandes' });
  else navigateTo('absences', { absencesHubTab: 'autres', congesTab: 'demandes' });
}

// ---- Sous-vue : Types de congés ----

function renderCongesTypes(categorie = 'conge') {
  const types = leaveTypeRepository.getLeaveTypes().filter(t => t.categorie === categorie);
  const noun = categorie === 'conge' ? 'de congé' : 'd\'absence';
  const plural = types.length > 1 ? 's' : '';

  return `
    <div class="view-header-row">
      <p class="view-subtitle">${types.length} type${plural} ${noun} configuré${plural}</p>
      <button class="btn btn-primary" id="btn-new-leave-type">+ Nouveau type</button>
    </div>
    <div class="card table-card">
      <table class="table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Acquisition</th>
            <th>Rémunération</th>
            <th>Validation</th>
            <th>Statut</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${types.map(renderLeaveTypeRow).join('')}
        </tbody>
      </table>
    </div>
  `;
}

/** Décrit une chaîne de workflow pour affichage, ex. ['manager','rh'] → "Manager puis RH". */
function describeWorkflow(workflow) {
  if (!workflow || workflow.length === 0) return 'Automatique';
  return workflow.map(role => ROLE_LABELS[role] || role).join(' puis ');
}

// Chaînes de validation proposées (ordre = ordre d'approbation). Un menu à préréglages plutôt
// qu'une sélection multiple : l'ORDRE des rôles est essentiel et une simple multi-sélection
// ne le garantirait pas.
const WORKFLOW_PRESETS_CONGES = [
  { value: '[]', label: 'Aucune validation requise' },
  { value: '["manager"]', label: 'Manager uniquement' },
  { value: '["rh"]', label: 'RH uniquement' },
  { value: '["manager","rh"]', label: 'Manager puis RH' },
  { value: '["manager","directeur"]', label: 'Manager puis Directeur' },
  { value: '["directeur"]', label: 'Directeur uniquement' }
];

const WORKFLOW_PRESETS_FRAIS = [
  { value: '[]', label: 'Aucune validation requise' },
  { value: '["manager"]', label: 'Manager uniquement' },
  { value: '["comptabilite"]', label: 'Comptabilité uniquement' },
  { value: '["manager","comptabilite"]', label: 'Manager puis Comptabilité' },
  { value: '["manager","directeur"]', label: 'Manager puis Directeur' }
];

function workflowSelectField(name, label, presets, currentWorkflow) {
  const currentValue = JSON.stringify(currentWorkflow || []);
  return `
    <div class="form-field">
      <label for="f-${name}">${escapeHtml(label)}</label>
      <select class="input" id="f-${name}" name="${name}">
        ${presets.map(p => `<option value='${p.value}' ${p.value === currentValue ? 'selected' : ''}>${escapeHtml(p.label)}</option>`).join('')}
      </select>
    </div>
  `;
}

function renderLeaveTypeRow(t) {
  const validationLabel = describeWorkflow(t.workflow);
  const acquisitionLabel = t.illimite ? 'Illimitée' : `${t.acquisition} · ${formatDurationFR(t.nombreAnnuel)}/an`;

  return `
    <tr>
      <td>
        <span class="type-swatch" style="background:${escapeHtml(t.couleur)}"></span>
        ${escapeHtml(t.icone)} <strong>${escapeHtml(t.nom)}</strong>
      </td>
      <td>${escapeHtml(acquisitionLabel)}</td>
      <td><span class="badge badge-${t.paye ? 'success' : 'muted'}">${t.paye ? 'Payé' : 'Non payé'}</span></td>
      <td>${escapeHtml(validationLabel)}</td>
      <td><span class="badge badge-${t.actif ? 'success' : 'muted'}">${t.actif ? 'Actif' : 'Inactif'}</span></td>
      <td class="table-actions">
        <button class="btn-link" data-reorder-up="${t.id}" title="Monter">↑</button>
        <button class="btn-link" data-reorder-down="${t.id}" title="Descendre">↓</button>
        <button class="btn-link" data-edit-type="${t.id}">Modifier</button>
        <button class="btn-link" data-duplicate-type="${t.id}">Dupliquer</button>
        <button class="btn-link" data-toggle-type="${t.id}">${t.actif ? 'Désactiver' : 'Activer'}</button>
        <button class="btn-link btn-link-danger" data-delete-type="${t.id}">Supprimer</button>
      </td>
    </tr>
  `;
}

function bindCongesTypesEvents(categorie = 'conge') {
  document.getElementById('btn-new-leave-type').addEventListener('click', () => openLeaveTypeModal(null, categorie));

  document.querySelectorAll('[data-edit-type]').forEach(btn => btn.addEventListener('click', () => openLeaveTypeModal(btn.dataset.editType)));
  document.querySelectorAll('[data-duplicate-type]').forEach(btn => btn.addEventListener('click', () => {
    leaveTypeRepository.duplicateLeaveType(btn.dataset.duplicateType);
    showToast('Type de congé dupliqué.');
    render();
  }));
  document.querySelectorAll('[data-toggle-type]').forEach(btn => btn.addEventListener('click', () => {
    const t = leaveTypeRepository.getLeaveTypeById(btn.dataset.toggleType);
    leaveTypeRepository.updateLeaveType(t.id, { actif: !t.actif });
    render();
  }));
  document.querySelectorAll('[data-reorder-up]').forEach(btn => btn.addEventListener('click', () => {
    leaveTypeRepository.reorderLeaveType(btn.dataset.reorderUp, 'up');
    render();
  }));
  document.querySelectorAll('[data-reorder-down]').forEach(btn => btn.addEventListener('click', () => {
    leaveTypeRepository.reorderLeaveType(btn.dataset.reorderDown, 'down');
    render();
  }));
  document.querySelectorAll('[data-delete-type]').forEach(btn => btn.addEventListener('click', () => {
    const t = leaveTypeRepository.getLeaveTypeById(btn.dataset.deleteType);
    openConfirm({
      title: 'Supprimer ce type de congé ?',
      message: `"${t.nom}" et toutes ses demandes associées seront définitivement supprimés.`,
      confirmLabel: 'Supprimer',
      danger: true,
      onConfirm: () => {
        leaveTypeRepository.deleteLeaveType(t.id);
        showToast('Type de congé supprimé.');
        render();
      }
    });
  }));
}

// ---- Modale : Type de congé (création / édition) ----

function openLeaveTypeModal(id, categorie = 'conge') {
  const isEdit = Boolean(id);
  const type = isEdit ? leaveTypeRepository.getLeaveTypeById(id) : Object.assign(makeEmptyLeaveType(), { workflow: settingsRepository.getSettings().workflowCongesDefault, categorie });
  // En édition, la catégorie du type lui-même fait foi plutôt que le paramètre reçu — l'appelant
  // (bouton "Modifier") ne le passait pas toujours correctement, ce qui renvoyait vers le mauvais
  // écran ("Congés" au lieu d'"Autres absences") après enregistrement. Ne dépend plus du contexte
  // d'ouverture, seulement de la donnée réelle du type.
  const effectiveCategorie = isEdit ? type.categorie : categorie;

  // §3 sprint amélioration : liste des AUTRES types actifs, pour "Partager le compteur avec" —
  // jamais soi-même (un type ne peut pas partager son propre compteur).
  const autresTypes = leaveTypeRepository.getLeaveTypes().filter(t => t.id !== id);
  // État de travail des règles d'éligibilité, modifié en mémoire tant que la modale reste ouverte
  // (ajout/suppression de ligne) — re-rendu seulement dans son propre conteneur (#regles-rows), pas
  // toute la modale, pour ne jamais perdre les autres champs déjà saisis par l'utilisateur.
  let currentRegles = (type.regles || []).map(r => ({ ...r }));
  const [clotureMoisInit, clotureJourInit] = (type.dateClotureCompteur || '').split('-').map(Number);

  const html = `
    <div class="modal modal-large">
      <div class="modal-header">
        <h2>${isEdit ? 'Modifier le type de congé' : 'Nouveau type de congé'}</h2>
        <button class="btn-icon" id="btn-close-modal" aria-label="Fermer" title="Fermer">✕</button>
      </div>
      <form id="leave-type-form">
        <div class="modal-body">
          <fieldset class="form-section">
            <legend>Informations générales</legend>
            <div class="form-grid">
              ${textField('nom', 'Nom', type.nom, true)}
              ${textField('icone', 'Icône (emoji)', type.icone)}
              <div class="form-field">
                <label for="f-couleur">Couleur</label>
                <div style="display:flex; align-items:center; gap:8px;">
                  <input type="color" id="f-couleur" name="couleur" value="${escapeHtml(type.couleur)}" style="width:44px; height:36px; padding:2px; border:1px solid var(--color-border); border-radius:var(--radius-sm); cursor:pointer;">
                  <span id="couleur-preview-hex" class="text-muted" style="font-size:13px;">${escapeHtml(type.couleur)}</span>
                </div>
              </div>
              ${checkboxField('actif', 'Type actif', type.actif)}
            </div>
            <div class="form-field" style="margin-top:14px;">
              <label for="f-description">Description</label>
              <textarea class="input" id="f-description" name="description" rows="2">${escapeHtml(type.description)}</textarea>
            </div>
          </fieldset>

          <fieldset class="form-section">
            <legend>Acquisition des droits</legend>
            <div class="form-grid">
              ${selectField('acquisition', 'Mode d\'acquisition', ['Mensuelle', 'Annuelle', 'Illimitée'], type.acquisition)}
              <div class="form-field" id="field-nombre-annuel">
                <label for="f-nombreAnnuel" id="label-nombre-annuel">Nombre de jours par an</label>
                <input class="input" type="number" step="any" id="f-nombreAnnuel" name="nombreAnnuel" value="${escapeHtml(type.nombreAnnuel)}">
              </div>
            </div>
            <div class="form-grid" style="margin-top:14px;">
              <div class="form-field">
                <label>Clôture du compteur (optionnel)</label>
                <div style="display:flex; gap:8px;">
                  <select class="input" id="f-cloture-mois" style="flex:1;">
                    <option value="">Jamais (une seule période continue)</option>
                    ${MONTH_NAMES.map((m, i) => `<option value="${i + 1}" ${clotureMoisInit === i + 1 ? 'selected' : ''}>${m}</option>`).join('')}
                  </select>
                  <input class="input" type="number" id="f-cloture-jour" min="1" max="31" placeholder="Jour" value="${clotureJourInit || ''}" style="flex:0 0 80px;">
                </div>
                <p class="form-hint">Ex. mai / 31 pour un compteur CP calé sur l'année de référence française.</p>
              </div>
              <div class="form-field" id="field-report" style="display:${type.dateClotureCompteur ? 'flex' : 'none'};">
                <label for="f-reportCompteur">Report des jours non pris à la clôture</label>
                <select class="input" id="f-reportCompteur" name="reportCompteur">
                  <option value="aucun" ${type.reportCompteur === 'aucun' ? 'selected' : ''}>Aucun report (perdus)</option>
                  <option value="limite" ${type.reportCompteur === 'limite' ? 'selected' : ''}>Report plafonné</option>
                  <option value="illimite" ${type.reportCompteur === 'illimite' ? 'selected' : ''}>Report intégral</option>
                </select>
              </div>
              <div class="form-field" id="field-report-limite" style="display:${type.reportCompteur === 'limite' ? 'flex' : 'none'};">
                <label for="f-reportLimiteJours">Plafond de report (jours)</label>
                <input class="input" type="number" step="any" min="0" id="f-reportLimiteJours" name="reportLimiteJours" value="${escapeHtml(type.reportLimiteJours || '')}">
              </div>
            </div>
          </fieldset>

          <fieldset class="form-section">
            <legend>Chaîne de validation</legend>
            <div class="form-grid">
              ${workflowSelectField('workflow', 'Validation requise', WORKFLOW_PRESETS_CONGES, type.workflow)}
            </div>
          </fieldset>

          <fieldset class="form-section">
            <legend>Règles</legend>
            <div class="form-grid checkbox-grid">
              ${checkboxField('paye', 'Congé payé', type.paye)}
              ${checkboxField('justificatifObligatoire', 'Justificatif obligatoire', type.justificatifObligatoire)}
              ${checkboxField('visibleSalarie', 'Visible par le salarié', type.visibleSalarie)}
              ${checkboxField('visibleRH', 'Visible par les RH', type.visibleRH)}
              ${checkboxField('saisiParSalarie', 'Le salarié peut créer lui-même une demande (§15)', type.saisiParSalarie)}
              ${checkboxField('autoriserDemiJournee', 'Autoriser la demi-journée', type.autoriserDemiJournee)}
              ${checkboxField('autoriserPlusieursDemandes', 'Autoriser plusieurs demandes simultanées', type.autoriserPlusieursDemandes)}
              ${checkboxField('exportPaie', 'Inclure dans l\'export paie', type.exportPaie)}
            </div>
            <div class="form-field" style="margin-top:14px;">
              ${selectField('compteurPartageAvecId', 'Partager le compteur avec (optionnel)', null, type.compteurPartageAvecId, autresTypes.map(t => ({ value: t.id, label: t.nom })))}
              <p class="form-hint">« — » = compteur propre à ce type (par défaut). Sinon, les demandes de CE type viennent en plus s'imputer sur le solde du type choisi (ex. un congé sans solde qui entame le compteur CP).</p>
            </div>
            <div class="form-field" style="margin-top:14px;">
              <label>Règles d'éligibilité (optionnel)</label>
              <p class="form-hint">Aucune règle = proposé à tous les salariés. Toutes les règles ajoutées doivent être vraies à la fois.</p>
              <div id="regles-rows"></div>
              <button type="button" class="btn btn-secondary btn-sm" id="btn-add-regle" style="margin-top:8px;">+ Ajouter une règle</button>
            </div>
          </fieldset>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Annuler</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Enregistrer' : 'Créer le type'}</button>
        </div>
      </form>
    </div>
  `;

  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = html;
  modalRoot.classList.add('open');

  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);

  // #1 : aperçu couleur en direct — pas de bouton de validation séparé (incohérent avec le reste du
  // formulaire, qui n'a qu'un seul bouton Enregistrer global) : juste un retour visuel immédiat.
  document.getElementById('f-couleur').addEventListener('input', (e) => {
    document.getElementById('couleur-preview-hex').textContent = e.target.value;
  });

  // #2 + #4 : libellé du nombre de jours adapté au mode, champ masqué entièrement si Illimitée
  // (aucun nombre ne doit être demandé dans ce cas).
  const updateAcquisitionUI = () => {
    const mode = document.getElementById('f-acquisition').value;
    const field = document.getElementById('field-nombre-annuel');
    const label = document.getElementById('label-nombre-annuel');
    if (mode === 'Illimitée') {
      field.style.display = 'none';
    } else {
      field.style.display = '';
      label.textContent = mode === 'Mensuelle' ? 'Nombre de jours par mois' : 'Nombre de jours par an';
    }
  };
  document.getElementById('f-acquisition').addEventListener('change', updateAcquisitionUI);
  updateAcquisitionUI();

  // #5 : le champ de report n'a de sens que si une clôture est définie ; le plafond n'a de sens que
  // si le report est "limite".
  const updateClotureUI = () => {
    const hasCloture = Boolean(document.getElementById('f-cloture-mois').value);
    document.getElementById('field-report').style.display = hasCloture ? 'flex' : 'none';
  };
  document.getElementById('f-cloture-mois').addEventListener('change', updateClotureUI);
  document.getElementById('f-reportCompteur').addEventListener('change', (e) => {
    document.getElementById('field-report-limite').style.display = e.target.value === 'limite' ? 'flex' : 'none';
  });

  // #3 : constructeur de règles générique — un critère du catalogue RULE_CRITERIA par ligne, avec
  // son opérateur et sa valeur (nombre, ou multi-sélection selon le type de critère). Re-rendu
  // localement (pas toute la modale) à chaque ajout/suppression pour préserver le reste du formulaire.
  const categoriesSalarieOptions = categorieSalarieRepository.getAll();
  const etablissementsOptions = etablissementRepository.getAll();
  function renderRegleValueInput(regle, index) {
    const criterion = RULE_CRITERIA[regle.critere];
    if (criterion.valueType === 'number') {
      return `<input class="input" type="number" step="any" data-regle-valeur="${index}" value="${escapeHtml(regle.valeur ?? '')}" style="flex:1;">`;
    }
    const options = criterion.valueType === 'categorieSalarie' ? categoriesSalarieOptions.map(c => ({ value: c.id, label: c.nom }))
      : criterion.valueType === 'etablissement' ? etablissementsOptions.map(e => ({ value: e.id, label: e.nom }))
      : settingsRepository.getSettings().typesContrat.map(v => ({ value: v, label: v }));
    const selected = new Set(regle.valeur || []);
    return `<select class="input" multiple data-regle-valeur="${index}" style="flex:1; min-height:70px;">
      ${options.map(o => `<option value="${escapeHtml(o.value)}" ${selected.has(o.value) ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
    </select>`;
  }
  function renderReglesRows() {
    document.getElementById('regles-rows').innerHTML = currentRegles.map((regle, index) => `
      <div class="form-grid" style="grid-template-columns: 1.2fr 0.8fr 1.4fr auto; align-items:start; margin-top:8px;" data-regle-row="${index}">
        <select class="input" data-regle-critere="${index}">
          ${Object.entries(RULE_CRITERIA).map(([key, c]) => `<option value="${key}" ${regle.critere === key ? 'selected' : ''}>${escapeHtml(c.label)}</option>`).join('')}
        </select>
        <select class="input" data-regle-operateur="${index}">
          ${RULE_CRITERIA[regle.critere].operators.map(op => `<option value="${op}" ${regle.operateur === op ? 'selected' : ''}>${op === '>=' ? 'au moins' : op === '<=' ? 'au plus' : 'parmi'}</option>`).join('')}
        </select>
        ${renderRegleValueInput(regle, index)}
        <button type="button" class="btn-icon" data-remove-regle="${index}" aria-label="Retirer" title="Retirer">✕</button>
      </div>
    `).join('');
    bindReglesRowEvents();
  }
  function readCurrentRegleValue(index) {
    const regle = currentRegles[index];
    const criterion = RULE_CRITERIA[regle.critere];
    const el = document.querySelector(`[data-regle-valeur="${index}"]`);
    if (!el) return regle.valeur;
    return criterion.valueType === 'number' ? Number(el.value) || 0 : Array.from(el.selectedOptions).map(o => o.value);
  }
  function bindReglesRowEvents() {
    document.querySelectorAll('[data-regle-critere]').forEach(sel => sel.addEventListener('change', (e) => {
      const index = Number(e.target.dataset.regleCritere);
      currentRegles[index] = { critere: e.target.value, operateur: RULE_CRITERIA[e.target.value].operators[0], valeur: RULE_CRITERIA[e.target.value].valueType === 'number' ? 0 : [] };
      renderReglesRows();
    }));
    document.querySelectorAll('[data-regle-operateur]').forEach(sel => sel.addEventListener('change', (e) => {
      currentRegles[Number(e.target.dataset.regleOperateur)].valeur = readCurrentRegleValue(Number(e.target.dataset.regleOperateur));
      currentRegles[Number(e.target.dataset.regleOperateur)].operateur = e.target.value;
    }));
    document.querySelectorAll('[data-regle-valeur]').forEach(el => el.addEventListener('change', (e) => {
      const index = Number(e.target.dataset.regleValeur);
      currentRegles[index].valeur = readCurrentRegleValue(index);
    }));
    document.querySelectorAll('[data-remove-regle]').forEach(btn => btn.addEventListener('click', () => {
      currentRegles.splice(Number(btn.dataset.removeRegle), 1);
      renderReglesRows();
    }));
  }
  document.getElementById('btn-add-regle').addEventListener('click', () => {
    currentRegles.push({ critere: 'anciennete', operateur: '>=', valeur: 0 });
    renderReglesRows();
  });
  renderReglesRows();

  document.getElementById('leave-type-form').addEventListener('submit', (evt) => submitLeaveTypeForm(evt, id, effectiveCategorie, currentRegles));
}

function checkboxField(name, label, checked) {
  return `
    <div class="form-field form-field-checkbox">
      <label>
        <input type="checkbox" id="f-${name}" name="${name}" ${checked ? 'checked' : ''}>
        ${escapeHtml(label)}
      </label>
    </div>
  `;
}

function submitLeaveTypeForm(evt, id, categorie = 'conge', regles = []) {
  evt.preventDefault();
  const form = evt.target;
  const formData = new FormData(form);
  const checkboxNames = ['paye', 'justificatifObligatoire', 'visibleSalarie', 'visibleRH', 'saisiParSalarie', 'autoriserDemiJournee', 'autoriserPlusieursDemandes', 'exportPaie', 'actif'];

  const acquisition = formData.get('acquisition');
  // #4 : Illimitée masque le champ mais un <input> masqué reste dans FormData — on force explicitement
  // à 0 plutôt que de conserver une valeur périmée qui n'a plus aucun effet sur le calcul mais
  // resterait trompeuse dans les exports/imports.
  const nombreAnnuel = acquisition === 'Illimitée' ? 0 : Number(formData.get('nombreAnnuel')) || 0;
  if (nombreAnnuel < 0) {
    showToast('Le nombre de jours ne peut pas être négatif.', 'error');
    return;
  }

  // §5 : clôture de compteur optionnelle — 'MM-JJ' seulement si un mois ET un jour sont renseignés.
  const clotureMois = document.getElementById('f-cloture-mois').value;
  const clotureJour = document.getElementById('f-cloture-jour').value;
  const dateClotureCompteur = clotureMois && clotureJour ? `${String(clotureMois).padStart(2, '0')}-${String(clotureJour).padStart(2, '0')}` : null;
  const reportCompteur = dateClotureCompteur ? formData.get('reportCompteur') : 'aucun';
  const reportLimiteJours = reportCompteur === 'limite' ? Number(formData.get('reportLimiteJours')) || 0 : null;

  const patch = {
    nom: formData.get('nom'),
    icone: formData.get('icone') || '🏖️',
    couleur: formData.get('couleur'),
    description: formData.get('description') || '',
    acquisition,
    nombreAnnuel,
    workflow: JSON.parse(formData.get('workflow') || '[]'),
    compteurPartageAvecId: formData.get('compteurPartageAvecId') || null,
    regles: regles.filter(r => r.critere), // ligne ajoutée puis jamais configurée = ignorée plutôt que sauvegardée à moitié
    dateClotureCompteur,
    reportCompteur,
    reportLimiteJours
  };
  patch.illimite = patch.acquisition === 'Illimitée';
  checkboxNames.forEach(name => { patch[name] = form.querySelector(`#f-${name}`).checked; });
  patch.deduireCompteur = true;

  if (id) {
    leaveTypeRepository.updateLeaveType(id, patch);
    showToast('Type de congé mis à jour.');
  } else {
    patch.categorie = categorie;
    leaveTypeRepository.addLeaveType(patch);
    showToast('Type de congé créé.');
  }
  closeModal();
  // §sprint refonte UX §8 : la gestion des types ne vit plus que dans Paramètres (plus de sous-onglet
  // "Types" dans Congés & absences) — seul point d'entrée restant vers ce formulaire.
  navigateTo('parametres', { parametresTab: 'types-absences', parametresTypesCategorie: categorie });
}

// ---------------------------------------------------------------------------
// Vue : Calendrier
// ---------------------------------------------------------------------------

const MONTH_NAMES = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

/** Sprint SIRH premium §2 : "Calendrier des valideurs / Créer un calendrier spécifique pour RH/
 * Managers/Directeur. Ce calendrier affiche : leurs propres congés ; leurs événements personnels ;
 * leurs validations." — "Mon calendrier" couvre déjà les 2 premiers points pour tout le monde ;
 * cette carte ajoute le 3e (validations en attente), visible uniquement pour les rôles concernés en
 * vue personnelle. Mêmes navParams que le Centre d'action (§7)/les raccourcis sidebar (§5) — un seul
 * endroit où ces filtres sont définis (NAVPARAMS_*). */
function renderCalendrierValidationsCard(user) {
  if (![ROLES.MANAGER, ROLES.RH, ROLES.DIRECTEUR].includes(user.role)) return '';
  const visibleIds = getVisibleEmployeeIdsForCurrentUser();
  const pendingFor = (repo) => {
    const list = repo.getAll().filter(r => r.statut === 'En attente');
    return visibleIds ? list.filter(r => visibleIds.includes(r.employeeId)) : list;
  };
  const congesEnAttente = pendingFor(leaveRepository).length;
  const teletravailEnAttente = pendingFor(teleworkRepository).length;
  const fraisEnAttente = pendingFor(expenseRepository).length;
  if (!congesEnAttente && !teletravailEnAttente && !fraisEnAttente) return '';

  const item = (count, label, nav, navParams) => !count ? '' : `
    <button type="button" class="action-center-item" data-nav="${nav}" data-nav-params='${escapeHtml(JSON.stringify(navParams))}'>
      <span class="action-center-icon">✅</span>
      <span class="action-center-label">${count} ${label}${count > 1 ? 's' : ''} en attente de validation</span>
      <span class="action-center-arrow">→</span>
    </button>
  `;

  return `
    <div class="card action-center" style="margin-bottom: 16px;">
      <h2>Vos validations</h2>
      <div class="action-center-list">
        ${item(congesEnAttente, 'demande de congé', 'absences', NAVPARAMS_CONGES_A_VALIDER)}
        ${item(teletravailEnAttente, 'demande de télétravail', 'absences', NAVPARAMS_TELETRAVAIL_A_VALIDER)}
        ${item(fraisEnAttente, 'note de frais', 'frais', NAVPARAMS_FRAIS_A_VALIDER)}
      </div>
    </div>
  `;
}

/** Sprint SIRH premium §2 : factorisé hors de renderCalendrier() pour que openCalendarDayModal()
 * (§4, reprise) puisse recalculer le même `sharedData` pour une seule date sans dupliquer cette
 * logique de périmètre/scope. */
function buildCalendarSharedData(cells) {
  const settings = settingsRepository.getSettings();
  const user = authRepository.getCurrentUser();
  // Sprint SIRH premium §2 : "Créer un calendrier spécifique pour RH/Managers/Directeur [...] leurs
  // propres congés, leurs événements personnels, leurs validations" — un salarié voit déjà
  // uniquement son propre calendrier par défaut (getVisibleEmployeeIdsForCurrentUser), donc le
  // bascule n'a de sens que pour les rôles qui voient plus large (équipe pour un manager, toute
  // l'entreprise pour RH/Directeur/Comptabilité).
  const hasWiderView = user.role !== ROLES.SALARIE;
  const vuePersonnelle = hasWiderView && state.calendrierVue === 'personnel';

  // Récupérés une seule fois pour toute la grille plutôt qu'à chaque cellule (~35-42 fois) — mesuré : 128ms -> ~15ms pour 300 salariés.
  const visibleIds = vuePersonnelle ? [user.id] : getVisibleEmployeeIdsForCurrentUser();
  let employees = employeeRepository.getAll().filter(e => !e.archive);
  if (visibleIds !== null) employees = employees.filter(e => visibleIds.includes(e.id));
  const leaveTypes = leaveTypeRepository.getLeaveTypes();
  const leaveRequests = leaveRepository.getAll().filter(r => r.statut === 'Validé' || r.statut === 'En attente');
  const teleworkRequests = teleworkRepository.getAll().filter(r => r.statut === 'Validé' || r.statut === 'En attente');
  const schoolHolidays = schoolHolidayRepository.getSchoolHolidays();
  const years = [...new Set(cells.map(c => c.date.getFullYear()))];
  const publicHolidays = years.flatMap(y => getAllPublicHolidays(y, settings));
  return {
    employees, leaveTypes, leaveRequests, teleworkRequests, schoolHolidays, publicHolidays, schoolZone: settings.schoolZone,
    // §sprint calendrier interactif : seule la vue personnelle (soi-même, jamais ambigu) autorise le
    // clic sur une case vide à créer une demande — voir renderCalendarCell/bindCalendrierEvents.
    vuePersonnelle: !hasWiderView || vuePersonnelle,
    currentUserId: user.id
  };
}

// ---------------------------------------------------------------------------
// Composant partagé "Moi / Équipe" (§sprint refonte UX §9) — Calendrier, Planning et Tickets
// restaurant utilisaient chacun leur propre bascule dupliquée ; un seul composant maintenant, même
// style/comportement partout. `stateKey` est le nom de la clé d'état ('calendrierVue',
// 'planningVue', 'ticketsRestaurantVue'), `teamValue`/`teamLabel` restent propres à chaque écran
// (ex. "Calendrier équipe" pour un manager, "Calendrier entreprise" pour RH/Directeur) pour ne pas
// avoir à renommer les valeurs d'état déjà lues ailleurs dans le code (buildCalendarSharedData...).
// ---------------------------------------------------------------------------

function renderMoiEquipeToggle(stateKey, teamValue, teamLabel) {
  const user = authRepository.getCurrentUser();
  if (user.role === ROLES.SALARIE) return '';
  const isPersonnel = state[stateKey] === 'personnel';
  return `
    <div class="tabs moi-equipe-toggle" style="margin-bottom: 12px;">
      <button class="tab ${!isPersonnel ? 'active' : ''}" data-moi-equipe="${stateKey}" data-moi-equipe-value="${teamValue}">${escapeHtml(teamLabel)}</button>
      <button class="tab ${isPersonnel ? 'active' : ''}" data-moi-equipe="${stateKey}" data-moi-equipe-value="personnel">Moi</button>
    </div>
  `;
}

function bindMoiEquipeToggleEvents() {
  document.querySelectorAll('[data-moi-equipe]').forEach(btn => {
    btn.addEventListener('click', () => {
      state[btn.dataset.moiEquipe] = btn.dataset.moiEquipeValue;
      render();
    });
  });
}

/** Catalogue des catégories filtrables du calendrier (légende + filtres cliquables, §sprint
 * calendrier légende/filtres) — une seule source de vérité pour le libellé, l'icône et la classe de
 * couleur, réutilisée à la fois par la légende et par les badges de case pour rester cohérentes. */
const CALENDAR_FILTER_CATEGORIES = [
  { key: 'conge', label: 'Congé', icon: '🏖️', swatchClass: 'legend-conge' },
  { key: 'anniversaire', label: 'Anniversaire', icon: '🎂', swatchClass: 'legend-anniversaire' },
  { key: 'teletravail', label: 'Télétravail', icon: '💻', swatchClass: 'legend-teletravail' },
  // §sprint refonte UX : 🎉 remplacé par 🚀, moins ambigu (fête générique vs prise de poste).
  { key: 'arrivee', label: 'Arrivée', icon: '🚀', swatchClass: 'legend-arrivee' },
  { key: 'depart', label: 'Départ', icon: '👋', swatchClass: 'legend-depart' },
  { key: 'ferie', label: 'Jour férié', icon: null, swatchClass: 'legend-holiday' },
  { key: 'vacances', label: 'Vacances scolaires', icon: null, swatchClass: 'legend-school' }
];

/** Toutes les catégories actives par défaut — un filtre désactivé n'efface jamais la donnée sous-
 * jacente (getCalendarDayInfo ne change pas), seul l'affichage des badges/tags en tient compte. */
function getCalendarFilters() {
  if (!state.calendarFilters) {
    state.calendarFilters = {};
    CALENDAR_FILTER_CATEGORIES.forEach(c => { state.calendarFilters[c.key] = true; });
  }
  return state.calendarFilters;
}

/** §sprint refonte UX §3-4 : bande compacte toujours visible (pastilles seules) — le détail
 * (libellés + toggle) vit désormais dans le popover "Filtres" (`renderCalendarFiltersPanelContent`),
 * jamais affiché en permanence. Logique de filtrage inchangée (`state.calendarFilters`). */
function renderCalendarFilterBar() {
  const filters = getCalendarFilters();
  return `
    <div class="calendar-filter-bar">
      <div class="calendar-filter-dots">
        ${CALENDAR_FILTER_CATEGORIES.map(c => `<span class="calendar-filter-dot ${c.swatchClass}${filters[c.key] === false ? ' legend-item-inactive' : ''}" title="${escapeHtml(c.label)}"></span>`).join('')}
      </div>
      <div class="dropdown-wrapper">
        <button type="button" class="btn btn-secondary btn-sm" id="btn-calendar-filters">Filtres</button>
        <div class="dropdown-panel" id="calendar-filters-panel"></div>
      </div>
    </div>
  `;
}

function renderCalendarFiltersPanelContent(settings) {
  const filters = getCalendarFilters();
  return CALENDAR_FILTER_CATEGORIES.map(c => {
    const active = filters[c.key] !== false;
    const label = c.key === 'vacances' ? `Vacances scolaires (Zone ${escapeHtml(settings.schoolZone)})` : c.label;
    return `
      <button type="button" class="legend-item${active ? '' : ' legend-item-inactive'}" data-calendar-filter="${c.key}" aria-pressed="${active}" title="Afficher/masquer : ${escapeHtml(c.label)}">
        <span class="legend-swatch ${c.swatchClass}"></span>${c.icon ? ` ${c.icon}` : ''} ${label}
      </button>
    `;
  }).join('');
}

function renderCalendrier() {
  const cells = buildMonthGridCells(state.calendarYear, state.calendarMonth);
  const sharedData = buildCalendarSharedData(cells);
  const settings = settingsRepository.getSettings();
  const user = authRepository.getCurrentUser();
  const hasWiderView = user.role !== ROLES.SALARIE;
  // §sprint refonte UX §2 : signale un manque de couverture des vacances scolaires de façon
  // générale (n'importe quel mois hors couverture), jamais une correction figée pour "octobre".
  const schoolHolidays = schoolHolidayRepository.getSchoolHolidays();
  const coverageGap = isMonthBeyondSchoolYearCoverage(state.calendarYear, state.calendarMonth, schoolHolidays);

  return `
    <div class="view-header-row">
      <div class="calendar-month-nav">
        <button type="button" class="calendar-month-nav-btn" id="btn-cal-prev" aria-label="Mois précédent" title="Mois précédent">‹</button>
        <div>
          <h1 style="margin: 0;">Calendrier</h1>
          <p class="view-subtitle">${MONTH_NAMES[state.calendarMonth]} ${state.calendarYear}</p>
        </div>
        <button type="button" class="calendar-month-nav-btn" id="btn-cal-next" aria-label="Mois suivant" title="Mois suivant">›</button>
      </div>
      <div class="calendar-nav">
        <button class="btn btn-secondary btn-sm" id="btn-cal-today">Aujourd'hui</button>
      </div>
    </div>

    ${hasWiderView ? renderMoiEquipeToggle('calendrierVue', 'entreprise', user.role === ROLES.MANAGER ? 'Calendrier équipe' : 'Calendrier entreprise') : ''}

    ${hasWiderView && state.calendrierVue === 'personnel' ? renderCalendrierValidationsCard(user) : ''}

    <div class="card calendar-card">
      <div class="calendar-grid calendar-grid-header">
        ${WEEKDAY_LABELS.map(l => `<div class="calendar-weekday">${l}</div>`).join('')}
      </div>
      <div class="calendar-grid">
        ${cells.map(cell => renderCalendarCell(cell, sharedData)).join('')}
      </div>
    </div>

    ${renderCalendarFilterBar()}
    ${coverageGap ? `<p class="text-muted" style="margin-top: 10px;">📅 Les vacances scolaires ne sont pas encore renseignées pour cette période. <button type="button" class="btn-link" id="btn-cal-goto-vacances-settings">Ajouter l'année scolaire suivante</button></p>` : ''}
  `;
}

function bindCalendrierEvents() {
  document.getElementById('btn-cal-prev').addEventListener('click', () => shiftCalendarMonth(-1));
  document.getElementById('btn-cal-next').addEventListener('click', () => shiftCalendarMonth(1));
  document.getElementById('btn-cal-today').addEventListener('click', () => {
    const now = new Date();
    state.calendarYear = now.getFullYear();
    state.calendarMonth = now.getMonth();
    render();
  });
  bindMoiEquipeToggleEvents();

  const btnGotoVacances = document.getElementById('btn-cal-goto-vacances-settings');
  if (btnGotoVacances) {
    btnGotoVacances.addEventListener('click', () => navigateTo('parametres', { parametresTab: 'vacances' }));
  }

  const filtersBtn = document.getElementById('btn-calendar-filters');
  const filtersPanel = document.getElementById('calendar-filters-panel');
  if (filtersBtn && filtersPanel) {
    filtersBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (filtersPanel.classList.contains('open')) { filtersPanel.classList.remove('open'); return; }
      filtersPanel.innerHTML = renderCalendarFiltersPanelContent(settingsRepository.getSettings());
      bindCalendarFilterToggles();
      filtersPanel.classList.add('open');
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.dropdown-wrapper')) filtersPanel.classList.remove('open');
    });
  }

  document.querySelectorAll('[data-calendar-day]').forEach(cell => {
    cell.addEventListener('click', () => {
      const dateStr = cell.dataset.calendarDay;
      if (cell.dataset.calendarCreate) {
        openCalendarQuickAddModal(dateStr);
      } else {
        openCalendarDayModal(dateStr);
      }
    });
  });
}

/** Extrait de bindCalendrierEvents : le contenu du popover Filtres est régénéré à chaque ouverture
 * (voir bindCalendrierEvents), donc ses propres écouteurs doivent être re-posés à chaque fois. */
function bindCalendarFilterToggles() {
  document.querySelectorAll('[data-calendar-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      const filters = getCalendarFilters();
      const key = btn.dataset.calendarFilter;
      filters[key] = filters[key] === false; // toggle : false -> true, sinon -> false
      render();
    });
  });
}

/** §sprint refonte UX §6 : petit choix rapide (Congé/absence vs Télétravail) au clic sur un jour
 * vide, plutôt qu'ouvrir directement openLeaveRequestModal — réutilise le patron modal existant. */
function openCalendarQuickAddModal(dateStr) {
  const user = authRepository.getCurrentUser();
  const html = `
    <div class="modal modal-small">
      <div class="modal-header">
        <h2>${escapeHtml(formatDate(dateStr))}</h2>
        <button class="btn-icon" id="btn-close-modal" aria-label="Fermer" title="Fermer">✕</button>
      </div>
      <div class="modal-body">
        <p class="text-muted" style="margin-top: 0;">Que souhaitez-vous ajouter ?</p>
        <button type="button" class="legend-item" id="btn-quick-add-conge" style="margin-bottom: 8px;">
          🏖️ Congé / absence
        </button>
        <button type="button" class="legend-item" id="btn-quick-add-teletravail">
          💻 Télétravail
        </button>
      </div>
    </div>
  `;
  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = html;
  modalRoot.classList.add('open');

  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-quick-add-conge').addEventListener('click', () => {
    state._leaveRequestReturnToCalendar = true;
    openLeaveRequestModal(user.id, undefined, undefined, dateStr);
  });
  document.getElementById('btn-quick-add-teletravail').addEventListener('click', () => {
    state._leaveRequestReturnToCalendar = true;
    openTeleworkRequestModal(user.id, undefined, dateStr);
  });
}

function shiftCalendarMonth(delta) {
  let month = state.calendarMonth + delta;
  let year = state.calendarYear;
  if (month < 0) { month = 11; year -= 1; }
  if (month > 11) { month = 0; year += 1; }
  state.calendarMonth = month;
  state.calendarYear = year;
  render();
}

/** Construit les cellules du mois affiché, en complétant les semaines avec les mois voisins. */
function buildMonthGridCells(year, month) {
  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = (firstOfMonth.getDay() + 6) % 7; // 0 = Lundi
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];

  for (let i = 0; i < startWeekday; i++) {
    cells.push({ date: new Date(year, month, 1 - (startWeekday - i)), inMonth: false });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ date: new Date(year, month, day), inMonth: true });
  }
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1].date;
    cells.push({ date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1), inMonth: false });
  }
  return cells;
}

/** Agrège toutes les informations RH réelles concernant une date donnée, restreintes au périmètre visible par l'utilisateur courant. */
function getCalendarDayInfo(dateStr, sharedData) {
  const { employees, leaveTypes, leaveRequests, teleworkRequests, schoolHolidays, publicHolidays, schoolZone } = sharedData;

  const conges = leaveRequests
    .filter(r => dateStr >= r.dateDebut && dateStr <= r.dateFin)
    .map(r => {
      const emp = employees.find(e => e.id === r.employeeId);
      const type = leaveTypes.find(t => t.id === r.typeId);
      return emp && type ? { emp, type, statut: r.statut, demiJournee: r.demiJournee || null } : null;
    })
    .filter(Boolean);

  const anniversaires = employees.filter(e => e.dateNaissance && e.dateNaissance.slice(5, 10) === dateStr.slice(5, 10));
  const arrivees = employees.filter(e => e.dateEmbauche === dateStr);
  const departs = employees.filter(e => e.dateDepart === dateStr);

  const teletravail = teleworkRequests
    .filter(r => dateStr >= r.dateDebut && dateStr <= r.dateFin)
    .map(r => {
      const emp = employees.find(e => e.id === r.employeeId);
      return emp ? { emp, statut: r.statut } : null;
    })
    .filter(Boolean);

  const ferie = publicHolidays.find(h => h.date === dateStr) || null;
  const vacances = findSchoolHolidayPeriod(dateStr, schoolZone, schoolHolidays);

  return { conges, anniversaires, arrivees, departs, teletravail, ferie, vacances };
}

function renderCalendarCell(cell, sharedData) {
  const dateStr = toISODate(cell.date);
  const info = getCalendarDayInfo(dateStr, sharedData);
  const isToday = dateStr === toISODate(new Date());
  const isWeekend = [0, 6].includes(cell.date.getDay());
  // §sprint calendrier légende/filtres : un filtre désactivé ne touche jamais getCalendarDayInfo
  // (la donnée reste intacte) — il retire seulement l'affichage correspondant ci-dessous.
  const filters = getCalendarFilters();
  const ferieVisible = Boolean(info.ferie) && filters.ferie !== false;
  const vacancesVisible = Boolean(info.vacances) && filters.vacances !== false;

  const classes = ['calendar-cell'];
  if (!cell.inMonth) classes.push('out-month');
  if (isToday) classes.push('today');
  if (isWeekend) classes.push('weekend');
  if (ferieVisible) classes.push('holiday');
  if (vacancesVisible) classes.push('school-holiday');

  // Sprint SIRH premium §2 : "Les demandes non validées doivent être visibles [...] facilement
  // identifiables" — séparées des demandes validées dans un badge distinct, semi-transparent
  // (cf. .calendar-badge-pending), plutôt que mélangées sans distinction dans le même badge.
  const congesValides = info.conges.filter(c => c.statut === 'Validé');
  const congesEnAttente = info.conges.filter(c => c.statut !== 'Validé');
  const teletravailValide = info.teletravail.filter(t => t.statut === 'Validé');
  const teletravailEnAttente = info.teletravail.filter(t => t.statut !== 'Validé');

  const badges = [
    congesValides.length && filters.conge !== false ? calendarBadge('conge', '🏖️', congesValides.map(c => `${c.emp.prenom} ${c.emp.nom} · ${c.type.nom}${c.demiJournee ? ` (${c.demiJournee === 'matin' ? 'matin' : 'après-midi'})` : ''}`)) : '',
    congesEnAttente.length && filters.conge !== false ? calendarBadge('conge', '🏖️', congesEnAttente.map(c => `${c.emp.prenom} ${c.emp.nom} · ${c.type.nom}${c.demiJournee ? ` (${c.demiJournee === 'matin' ? 'matin' : 'après-midi'})` : ''} (en attente)`), true) : '',
    teletravailValide.length && filters.teletravail !== false ? calendarBadge('teletravail', '💻', teletravailValide.map(t => `${t.emp.prenom} ${t.emp.nom}`)) : '',
    teletravailEnAttente.length && filters.teletravail !== false ? calendarBadge('teletravail', '💻', teletravailEnAttente.map(t => `${t.emp.prenom} ${t.emp.nom} (en attente)`), true) : '',
    info.anniversaires.length && filters.anniversaire !== false ? calendarBadge('anniversaire', '🎂', info.anniversaires.map(e => `${e.prenom} ${e.nom}`)) : '',
    info.arrivees.length && filters.arrivee !== false ? calendarBadge('arrivee', '🚀', info.arrivees.map(e => `${e.prenom} ${e.nom} (arrivée)`)) : '',
    info.departs.length && filters.depart !== false ? calendarBadge('depart', '👋', info.departs.map(e => `${e.prenom} ${e.nom} (départ)`)) : ''
  ].join('');

  // §4 (reprise) : le survol des badges (.calendar-tooltip) reste utile sur desktop mais est
  // inutilisable au tactile et cache vite plusieurs infos à la fois sur un jour chargé — une case
  // avec du contenu est en plus rendue cliquable (clavier/tactile inclus, cf. le gestionnaire
  // role="button" générique déjà en place) pour ouvrir le détail complet du jour dans une modale.
  const hasContent = Boolean(badges || info.ferie || info.vacances);
  const hasAbsence = Boolean(congesValides.length || congesEnAttente.length || teletravailValide.length || teletravailEnAttente.length);

  // §sprint calendrier interactif : un jour sans absence, en vue personnelle (jamais en vue
  // équipe/entreprise — une case y mélange plusieurs salariés, sans salarié cible évident), devient
  // cliquable pour CRÉER une demande plutôt que pour consulter — voir bindCalendrierEvents.
  const isCreateTarget = sharedData.vuePersonnelle && cell.inMonth && !hasAbsence;
  const isClickable = hasContent || isCreateTarget;

  return `
    <div class="${classes.join(' ')}${isClickable ? ' calendar-cell-clickable' : ''}"
      ${isClickable ? `role="button" tabindex="0" data-calendar-day="${dateStr}" ${isCreateTarget ? 'data-calendar-create="1"' : ''} aria-label="${isCreateTarget ? 'Créer une demande le' : 'Détail du'} ${escapeHtml(formatDate(dateStr))}"` : ''}>
      <div class="calendar-cell-header">
        <span class="calendar-day-number">${cell.date.getDate()}</span>
      </div>
      ${ferieVisible ? `<div class="calendar-tag calendar-tag-holiday">${escapeHtml(info.ferie.label)}</div>` : ''}
      <div class="calendar-badges">${badges}</div>
    </div>
  `;
}

function calendarBadge(category, icon, names, pending = false) {
  return `
    <span class="calendar-badge calendar-badge-${category}${pending ? ' calendar-badge-pending' : ''}" ${pending ? 'title="En attente de validation"' : ''}>
      ${icon}${names.length > 1 ? names.length : ''}
      <span class="calendar-tooltip">${names.map(escapeHtml).join('<br>')}</span>
    </span>
  `;
}

/** Sprint SIRH premium §4 (reprise) : détail complet d'un jour du calendrier, dans une modale plutôt
 * qu'au survol (.calendar-tooltip) — accessible au clavier/tactile, et lisible même quand plusieurs
 * catégories d'évènements se superposent le même jour (un badge par catégorie devient vite illisible
 * une fois qu'il y a beaucoup de monde). Recalcule son propre `sharedData` (une seule date, donc bon
 * marché) via buildCalendarSharedData plutôt que de dépendre d'un état capturé au rendu précédent. */
function openCalendarDayModal(dateStr) {
  const sharedData = buildCalendarSharedData([{ date: new Date(dateStr) }]);
  const info = getCalendarDayInfo(dateStr, sharedData);

  const sections = [
    { label: 'Congés / absences', items: info.conges.map(c => `${c.emp.prenom} ${c.emp.nom} · ${c.type.icone} ${c.type.nom}${c.demiJournee ? ` (${c.demiJournee === 'matin' ? 'matin' : 'après-midi'})` : ''}${c.statut !== 'Validé' ? ' (en attente)' : ''}`) },
    { label: 'Télétravail', items: info.teletravail.map(t => `${t.emp.prenom} ${t.emp.nom}${t.statut !== 'Validé' ? ' (en attente)' : ''}`) },
    { label: 'Anniversaires', items: info.anniversaires.map(e => `🎂 ${e.prenom} ${e.nom}`) },
    { label: 'Arrivées', items: info.arrivees.map(e => `🚀 ${e.prenom} ${e.nom}`) },
    { label: 'Départs', items: info.departs.map(e => `👋 ${e.prenom} ${e.nom}`) }
  ].filter(s => s.items.length);

  const html = `
    <div class="modal modal-small">
      <div class="modal-header">
        <h2>${escapeHtml(formatDate(dateStr))}</h2>
        <button class="btn-icon" id="btn-close-modal" aria-label="Fermer" title="Fermer">✕</button>
      </div>
      <div class="modal-body">
        ${info.ferie ? `<span class="badge badge-danger" style="margin-bottom: 10px;">${escapeHtml(info.ferie.label)}</span>` : ''}
        ${info.vacances ? `<span class="badge badge-info" style="margin-bottom: 10px;">🎒 ${escapeHtml(info.vacances.nom)}</span>` : ''}
        ${sections.length === 0 ? '<p class="text-muted">Rien de particulier à signaler ce jour-là.</p>' : sections.map(s => `
          <div style="margin-bottom: 14px;">
            <div class="search-section-label" style="padding-left: 0;">${escapeHtml(s.label)}</div>
            <div class="mini-list">
              ${s.items.map(i => `<div class="mini-list-item"><span>${escapeHtml(i)}</span></div>`).join('')}
            </div>
          </div>
        `).join('')}
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Fermer</button>
      </div>
    </div>
  `;
  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = html;
  modalRoot.classList.add('open');
  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
}

// ---------------------------------------------------------------------------
// Vue : Paramètres (listes de référence, vacances scolaires, jours fériés)
// ---------------------------------------------------------------------------

const SETTINGS_LISTS = [
  { key: 'postes', label: 'Postes' },
  { key: 'conventionsCollectives', label: 'Conventions collectives' },
  { key: 'statutsPro', label: 'Statuts professionnels' },
  { key: 'typesContrat', label: 'Types de contrat' },
  { key: 'forfaits', label: 'Forfaits' },
  { key: 'categoriesFrais', label: 'Catégories de notes de frais' },
  { key: 'categoriesDocuments', label: 'Catégories de documents' }
];

/** Avant de retirer une valeur de ces listes de référence, vérifie qu'aucun enregistrement ne la
 * référence encore — sinon cet enregistrement se retrouve avec une valeur orpheline, invisible
 * dans tout futur select (même défaut déjà corrigé pour établissements/services/équipes). */
const SETTINGS_LIST_USAGE_CHECK = {
  postes: (value) => employeeRepository.getAll().some(e => e.poste === value),
  conventionsCollectives: (value) => employeeRepository.getAll().some(e => e.conventionCollective === value),
  statutsPro: (value) => employeeRepository.getAll().some(e => e.statutPro === value),
  typesContrat: (value) => employeeRepository.getAll().some(e => e.typeContrat === value),
  forfaits: (value) => employeeRepository.getAll().some(e => e.forfait === value),
  categoriesFrais: (value) => expenseRepository.getAll().some(n => n.categorie === value),
  categoriesDocuments: (value) => documentRepository.getAll().some(d => d.categorie === value)
};

function renderParametres() {
  const canSeeAudit = hasPermission(authRepository.getCurrentUser(), PERMISSIONS.VOIR_JOURNAL_AUDIT);
  const canGererAbonnement = hasPermission(authRepository.getCurrentUser(), PERMISSIONS.GERER_ABONNEMENTS);
  if (state.parametresTab === 'audit' && !canSeeAudit) state.parametresTab = 'listes';
  if (state.parametresTab === 'abonnement' && !canGererAbonnement) state.parametresTab = 'listes';
  return `
    <div class="view-header">
      <h1>Paramètres</h1>
      <p class="view-subtitle">Entreprise, types d'absences, listes de référence, vacances scolaires, jours fériés et journal d'audit</p>
    </div>
    <div class="tabs">
      <button class="tab ${state.parametresTab === 'entreprise' ? 'active' : ''}" data-parametres-tab="entreprise">Entreprise</button>
      ${canGererAbonnement ? `<button class="tab ${state.parametresTab === 'abonnement' ? 'active' : ''}" data-parametres-tab="abonnement">Abonnement</button>` : ''}
      <button class="tab ${state.parametresTab === 'etablissements' ? 'active' : ''}" data-parametres-tab="etablissements">Établissements</button>
      <button class="tab ${state.parametresTab === 'services' ? 'active' : ''}" data-parametres-tab="services">Services &amp; équipes</button>
      <button class="tab ${state.parametresTab === 'types-absences' ? 'active' : ''}" data-parametres-tab="types-absences">Types d'absences</button>
      <button class="tab ${state.parametresTab === 'listes' ? 'active' : ''}" data-parametres-tab="listes">Listes de référence</button>
      <button class="tab ${state.parametresTab === 'vacances' ? 'active' : ''}" data-parametres-tab="vacances">Vacances scolaires</button>
      <button class="tab ${state.parametresTab === 'feries' ? 'active' : ''}" data-parametres-tab="feries">Jours fériés</button>
      <button class="tab ${state.parametresTab === 'fermetures' ? 'active' : ''}" data-parametres-tab="fermetures">Fermetures</button>
      <button class="tab ${state.parametresTab === 'categories-salarie' ? 'active' : ''}" data-parametres-tab="categories-salarie">Catégories de salariés</button>
      <button class="tab ${state.parametresTab === 'qualite' ? 'active' : ''}" data-parametres-tab="qualite">Qualité des données</button>
      ${canSeeAudit ? `<button class="tab ${state.parametresTab === 'audit' ? 'active' : ''}" data-parametres-tab="audit">Journal d'audit</button>` : ''}
    </div>
    <div id="parametres-tab-content">
      ${state.parametresTab === 'entreprise' ? renderParametresEntreprise()
        : state.parametresTab === 'abonnement' && canGererAbonnement ? renderParametresAbonnement()
        : state.parametresTab === 'etablissements' ? renderParametresEtablissements()
        : state.parametresTab === 'services' ? renderParametresServices()
        : state.parametresTab === 'types-absences' ? renderParametresTypesAbsences()
        : state.parametresTab === 'vacances' ? renderParametresVacances()
        : state.parametresTab === 'feries' ? renderParametresFeries()
        : state.parametresTab === 'fermetures' ? renderParametresFermetures()
        : state.parametresTab === 'categories-salarie' ? renderParametresCategoriesSalarie()
        : state.parametresTab === 'qualite' ? renderParametresQualite()
        : state.parametresTab === 'audit' && canSeeAudit ? renderParametresAudit()
        : renderParametresListes()}
    </div>
  `;
}

/** Sprint SIRH premium §1 : le prompt d'origine demandait la gestion des types d'absences
 * "dans les paramètres RH" — jusqu'ici construite uniquement sous les onglets "Types" de Congés/
 * Autres absences (§1 déjà livré, fonctionnellement complet, mais au mauvais endroit). Corrigé en
 * réutilisant TEL QUEL renderCongesTypes()/bindCongesTypesEvents() (déjà génériques par catégorie)
 * comme nouveau point d'entrée sous Paramètres, sans dupliquer cette logique ni retirer les onglets
 * "Types" existants (qui restent un raccourci valide depuis l'écran Congés/Autres absences). */
function renderParametresTypesAbsences() {
  const categorie = state.parametresTypesCategorie || 'conge';
  return `
    <div class="tabs" style="margin-bottom: 14px;">
      <button class="tab ${categorie === 'conge' ? 'active' : ''}" data-parametres-types-categorie="conge">Congés payés / RTT</button>
      <button class="tab ${categorie === 'autre' ? 'active' : ''}" data-parametres-types-categorie="autre">Autres absences</button>
    </div>
    ${renderCongesTypes(categorie)}
  `;
}

function bindParametresTypesAbsencesEvents() {
  const categorie = state.parametresTypesCategorie || 'conge';
  document.querySelectorAll('[data-parametres-types-categorie]').forEach(btn => {
    btn.addEventListener('click', () => { state.parametresTypesCategorie = btn.dataset.parametresTypesCategorie; render(); });
  });
  bindCongesTypesEvents(categorie);
}

function bindParametresEvents() {
  document.querySelectorAll('[data-parametres-tab]').forEach(btn => {
    // renderSidebar() en plus de render() : "Abonnement" a maintenant sa propre entrée de menu
    // (même vue "parametres", distinguée par navParams) — sans ça, passer d'un onglet à l'autre ne
    // met jamais à jour quel item du menu doit rester surligné.
    btn.addEventListener('click', () => { state.parametresTab = btn.dataset.parametresTab; render(); renderSidebar(); });
  });

  if (state.parametresTab === 'entreprise') bindParametresEntrepriseEvents();
  else if (state.parametresTab === 'abonnement') bindParametresAbonnementEvents();
  else if (state.parametresTab === 'etablissements') bindParametresEtablissementsEvents();
  else if (state.parametresTab === 'services') bindParametresServicesEvents();
  else if (state.parametresTab === 'types-absences') bindParametresTypesAbsencesEvents();
  else if (state.parametresTab === 'vacances') bindParametresVacancesEvents();
  else if (state.parametresTab === 'feries') bindParametresFeriesEvents();
  else if (state.parametresTab === 'fermetures') bindParametresFermeturesEvents();
  else if (state.parametresTab === 'categories-salarie') bindParametresCategoriesSalarieEvents();
  else if (state.parametresTab === 'qualite') bindParametresQualiteEvents();
  else if (state.parametresTab === 'audit') bindParametresAuditEvents();
  else bindParametresListesEvents();
}

// ---- Sous-vue : Entreprise (profil, multi-entreprise) ----

function renderParametresEntreprise() {
  const profile = companyRepository.getProfile();
  const settings = settingsRepository.getSettings();
  const user = authRepository.getCurrentUser();

  return `
    <div class="card">
      <h2>Profil de l'entreprise</h2>
      <form id="entreprise-form">
        <div class="form-grid">
          ${companyNameAutocompleteField('raisonSociale', 'Raison sociale', profile.raisonSociale, true, 'siret', 'adresse')}
          <div class="form-field">
            <label for="f-siret">SIRET</label>
            <input class="input" type="text" id="f-siret" name="siret" value="${escapeHtml(profile.siret || '')}"
              data-siret-autocomplete="true" data-fill-raison="f-raisonSociale" data-fill-adresse="f-adresse">
            <span class="field-hint-computed" id="f-siret-hint"></span>
          </div>
          ${textField('tva', 'N° TVA intracommunautaire', profile.tva)}
          ${textField('adresse', 'Adresse', profile.adresse)}
          ${textField('telephone', 'Téléphone', profile.telephone)}
          ${textField('email', 'Email', profile.email, true, 'email')}
          ${selectField('conventionCollective', 'Convention collective', settings.conventionsCollectives, profile.conventionCollective)}
        </div>
        <button type="submit" class="btn btn-primary" style="margin-top: 14px;">Enregistrer</button>
      </form>
    </div>
    <div class="card">
      <div class="view-header-row">
        <div>
          <h2>Multi-entreprise</h2>
          <p class="text-muted">Chaque entreprise a ses propres salariés, congés, paramètres et historique, complètement isolés.</p>
        </div>
        <button class="btn btn-secondary" id="btn-new-company">+ Nouvelle entreprise</button>
      </div>
      <div class="mini-list">
        ${DB.getCompanies().map(c => `
          <div class="mini-list-item">
            <span>${escapeHtml(c.raisonSociale)}${c.id === DB.getCurrentCompanyId() ? ' <span class="badge badge-success">Active</span>' : ''}</span>
            <span>${c.employees.length} salarié${c.employees.length > 1 ? 's' : ''}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

/** Tarifs affichés (mensuel/annuel, remise ~2 mois offerts sur l'annuel) — doivent correspondre
 * exactement aux Price ID Stripe configurés dans supabase/functions/billing/index.ts. Offre "essai"
 * volontairement absente ici : gratuite, jamais "souscrite" via Stripe. */
const OFFRE_TARIFS = {
  essentiel: { label: 'Essentiel', mensuel: 29, annuel: 290 },
  professionnel: { label: 'Professionnel', mensuel: 79, annuel: 790 },
  premium: { label: 'Premium', mensuel: 149, annuel: 1490 }
};

/** Présentation (icône, accroche, mise en avant) — purement visuel, séparé de OFFRE_TARIFS/
 * OFFRES_BERTOLIS pour ne pas mélanger la donnée de facturation avec le texte marketing. Pas de
 * fonctionnalité listée par offre : le produit ne différencie réellement les offres que par le
 * nombre de salariés (voir le commentaire au-dessus de OFFRES_BERTOLIS, data.js) — toutes les
 * fonctionnalités du logiciel sont incluses dans les 3 offres payantes, inutile de le prétendre autrement. */
const OFFRE_PRESENTATION = {
  essentiel: { icon: '🌱', accroche: "Pour démarrer avec une petite équipe." },
  professionnel: { icon: '🚀', accroche: 'Pour une entreprise en croissance.', misEnAvant: true },
  // conditionLabel : nombreSalariesMax vaut null (illimité) pour Premium, mais "50 salariés et
  // plus" reflète mieux à qui l'offre s'adresse (au-delà du plafond Professionnel) qu'un vague
  // "illimité" — voir renderParametresAbonnement, qui l'utilise à la place du texte générique.
  premium: { icon: '👑', accroche: 'Pour une grande structure, sans limite de salariés.', conditionLabel: '50 salariés et plus' }
};

/** Paiement réel via Stripe (voir billingRepository/supabase/functions/billing) — remplace
 * l'ancien aperçu en lecture seule : l'entreprise cliente choisit et paie elle-même son offre,
 * la gestion (changer d'offre, annuler, moyen de paiement) passe par le portail Stripe hébergé. */
function renderParametresAbonnement() {
  const company = companyRepository.getCurrent();
  const abo = company.abonnement;
  if (!abo) return '<p class="text-muted">Abonnement indisponible.</p>';
  const offre = OFFRES_BERTOLIS[abo.offre] || OFFRES_BERTOLIS.essai;
  const statutBadge = { actif: 'success', impaye: 'warning', suspendu: 'warning', resilie: 'muted', non_souscrit: 'warning' }[abo.statut] || 'muted';
  const nbSalaries = employeeRepository.getAll().filter(e => !e.archive).length;
  const plafondActuel = abo.nombreSalariesMax;
  const plafondLabel = plafondActuel === null ? `${nbSalaries} (illimité)` : `${nbSalaries} / ${plafondActuel}`;
  const jaugePct = plafondActuel === null ? 0 : Math.min(100, Math.round((nbSalaries / plafondActuel) * 100));
  const dejaAbonne = abo.offre !== 'essai' && abo.statut !== 'resilie';
  const periodicite = state.abonnementPeriodicite === 'annuel' ? 'annuel' : 'mensuel';

  return `
    <div class="card abonnement-summary-card">
      <div class="abonnement-summary-header">
        <div class="abonnement-summary-icon">${escapeHtml((OFFRE_PRESENTATION[abo.offre] || {}).icon || '💳')}</div>
        <div>
          <h2 style="margin-bottom: 4px;">${escapeHtml(offre.label)}</h2>
          <div class="badge-row">
            <span class="badge badge-${statutBadge}">${escapeHtml(ABONNEMENT_STATUT_LABELS[abo.statut] || abo.statut)}</span>
            <span class="badge badge-info">${abo.periodicite === 'annuel' ? 'Facturation annuelle' : 'Facturation mensuelle'}</span>
          </div>
        </div>
      </div>
      <div class="detail-grid" style="margin-top: 16px;">
        ${infoRow('Date de début', formatDate(abo.dateDebut))}
        ${infoRow('Prochain renouvellement', abo.dateRenouvellement ? formatDate(abo.dateRenouvellement) : '—')}
      </div>
      <div class="abonnement-jauge">
        <div class="abonnement-jauge-label">
          <span>Salariés actifs</span>
          <strong>${plafondLabel}</strong>
        </div>
        ${plafondActuel !== null ? `<div class="abonnement-jauge-bar"><div class="abonnement-jauge-fill" style="width: ${jaugePct}%;"></div></div>` : ''}
      </div>
      ${dejaAbonne ? `<button class="btn btn-secondary" id="btn-gerer-abonnement" style="margin-top: 16px;">Gérer mon abonnement</button>` : ''}
    </div>
    <div class="card">
      <h2>Changer d'offre</h2>
      <p class="text-muted">Paiement sécurisé par Stripe. Toutes les fonctionnalités du logiciel sont incluses dans chaque offre — seul le nombre de salariés change. Annulation possible à tout moment depuis "Gérer mon abonnement".</p>
      <div class="tabs" style="margin: 12px 0;">
        <button class="tab ${periodicite === 'mensuel' ? 'active' : ''}" data-abonnement-periodicite="mensuel">Mensuel</button>
        <button class="tab ${periodicite === 'annuel' ? 'active' : ''}" data-abonnement-periodicite="annuel">Annuel (2 mois offerts)</button>
      </div>
      <div class="offres-grid">
        ${Object.entries(OFFRE_TARIFS).map(([key, o]) => {
          const presentation = OFFRE_PRESENTATION[key] || {};
          const plafondOffre = OFFRES_BERTOLIS[key] ? OFFRES_BERTOLIS[key].nombreSalariesMax : null;
          const estActuelle = abo.offre === key && abo.periodicite === periodicite && dejaAbonne;
          const mensualise = periodicite === 'annuel' ? `soit ${formatCurrencyFR(o.annuel / 12)}/mois` : '';
          return `
            <div class="offre-card ${estActuelle ? 'offre-card-active' : ''} ${presentation.misEnAvant ? 'offre-card-recommandee' : ''}">
              ${presentation.misEnAvant ? '<div class="offre-card-ribbon">Recommandée</div>' : ''}
              <div class="offre-card-icon">${escapeHtml(presentation.icon || '💳')}</div>
              <h3>${escapeHtml(o.label)}</h3>
              <p class="text-muted offre-card-accroche">${escapeHtml(presentation.accroche || '')}</p>
              <p class="offre-prix">${o[periodicite]} € <span class="text-muted">/ ${periodicite === 'annuel' ? 'an' : 'mois'}</span></p>
              ${mensualise ? `<p class="text-muted offre-card-mensualise">${mensualise}</p>` : ''}
              <div class="offre-card-condition">
                <span>👥</span> ${presentation.conditionLabel || (plafondOffre === null ? 'Salariés illimités' : `Jusqu'à ${plafondOffre} salariés`)}
              </div>
              ${estActuelle
                ? `<span class="badge badge-success" style="margin-top: 12px;">Offre actuelle</span>`
                : `<button class="btn ${presentation.misEnAvant ? 'btn-primary' : 'btn-secondary'}" data-souscrire-offre="${key}" data-souscrire-periodicite="${periodicite}" style="margin-top: 12px;">Souscrire</button>`}
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function bindParametresAbonnementEvents() {
  document.querySelectorAll('[data-abonnement-periodicite]').forEach(btn => {
    btn.addEventListener('click', () => { state.abonnementPeriodicite = btn.dataset.abonnementPeriodicite; render(); });
  });

  const gererBtn = document.getElementById('btn-gerer-abonnement');
  if (gererBtn) gererBtn.addEventListener('click', async () => {
    gererBtn.disabled = true;
    gererBtn.textContent = 'Redirection...';
    const result = await billingRepository.portal();
    if (!result.success) {
      showToast(result.error || 'Impossible d\'ouvrir le portail de gestion.', 'error');
      gererBtn.disabled = false;
      gererBtn.textContent = 'Gérer mon abonnement';
      return;
    }
    window.location.href = result.url;
  });

  document.querySelectorAll('[data-souscrire-offre]').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Redirection...';
      const result = await billingRepository.checkout(btn.dataset.souscrireOffre, btn.dataset.souscrirePeriodicite);
      if (!result.success) {
        showToast(result.error || 'Impossible de démarrer le paiement.', 'error');
        btn.disabled = false;
        btn.textContent = 'Souscrire';
        return;
      }
      window.location.href = result.url;
    });
  });
}

function bindParametresEntrepriseEvents() {
  document.getElementById('entreprise-form').addEventListener('submit', (evt) => {
    evt.preventDefault();
    const formData = new FormData(evt.target);
    companyRepository.saveProfile({
      raisonSociale: formData.get('raisonSociale'),
      siret: formData.get('siret'),
      tva: formData.get('tva'),
      adresse: formData.get('adresse'),
      telephone: formData.get('telephone'),
      email: formData.get('email'),
      conventionCollective: formData.get('conventionCollective')
    });
    showToast('Profil de l\'entreprise mis à jour.');
    render();
  });

  document.getElementById('btn-new-company').addEventListener('click', () => openOnboardingWizard());
}

// ---- Sous-vue : Établissements (§12) ----

function renderParametresEtablissements() {
  const etablissements = etablissementRepository.getAll();
  return `
    <div class="view-header-row">
      <p class="view-subtitle">${etablissements.length} établissement${etablissements.length > 1 ? 's' : ''}</p>
      <button class="btn btn-primary" id="btn-new-etablissement">+ Nouvel établissement</button>
    </div>
    <div class="settings-lists-grid">
      ${etablissements.map(renderEtablissementCard).join('')}
    </div>
  `;
}

function renderEtablissementCard(etab) {
  const responsable = etab.responsableId ? employeeRepository.getById(etab.responsableId) : null;
  return `
    <div class="card">
      <div class="view-header-row">
        <h2>${escapeHtml(etab.nom)}</h2>
        <div class="detail-header-actions">
          <button class="btn-link" data-edit-etablissement="${etab.id}">Modifier</button>
          <button class="btn-link btn-link-danger" data-delete-etablissement="${etab.id}">Supprimer</button>
        </div>
      </div>
      <div class="badge-row" style="margin-bottom: 10px;">
        ${etab.principal ? '<span class="badge badge-info">Principal</span>' : ''}
        <span class="badge badge-${etab.actif ? 'success' : 'muted'}">${etab.actif ? 'Actif' : 'Inactif'}</span>
      </div>
      ${infoRow('Code interne', etab.codeInterne)}
      ${infoRow('Adresse', [etab.adresse, etab.codePostal, etab.ville, etab.pays].filter(Boolean).join(', '))}
      ${infoRow('Email', etab.email)}
      ${infoRow('Téléphone', etab.telephone)}
      ${infoRow('Responsable', responsable ? `${responsable.prenom} ${responsable.nom}` : '—')}
    </div>
  `;
}

function bindParametresEtablissementsEvents() {
  document.getElementById('btn-new-etablissement').addEventListener('click', () => openEtablissementModal(null));

  document.querySelectorAll('[data-edit-etablissement]').forEach(btn => btn.addEventListener('click', () => openEtablissementModal(btn.dataset.editEtablissement)));

  document.querySelectorAll('[data-delete-etablissement]').forEach(btn => btn.addEventListener('click', () => {
    const etab = etablissementRepository.getById(btn.dataset.deleteEtablissement);
    openConfirm({
      title: 'Supprimer cet établissement ?',
      message: `"${etab.nom}" sera définitivement supprimé.`,
      confirmLabel: 'Supprimer',
      danger: true,
      onConfirm: () => {
        const result = etablissementRepository.delete(etab.id);
        if (!result.success) { showToast(result.error, 'error'); return; }
        showToast('Établissement supprimé.');
        render();
      }
    });
  }));
}

function openEtablissementModal(id) {
  const isEdit = Boolean(id);
  const etab = isEdit ? etablissementRepository.getById(id) : makeEmptyEtablissement();
  const employees = employeeRepository.getAll().filter(e => !e.archive);

  const html = `
    <div class="modal modal-large">
      <div class="modal-header">
        <h2>${isEdit ? 'Modifier l\'établissement' : 'Nouvel établissement'}</h2>
        <button class="btn-icon" id="btn-close-modal" aria-label="Fermer" title="Fermer">✕</button>
      </div>
      <form id="etablissement-form">
        <div class="modal-body">
          <div class="form-grid">
            ${textField('nom', 'Nom', etab.nom, true)}
            ${textField('codeInterne', 'Code interne', etab.codeInterne)}
            ${addressAutocompleteField('adresse', 'Adresse', etab.adresse, 'codePostal', 'ville')}
            ${textField('codePostal', 'Code postal', etab.codePostal)}
            ${textField('ville', 'Ville', etab.ville)}
            ${textField('pays', 'Pays', etab.pays)}
            ${textField('email', 'Email', etab.email, false, 'email')}
            ${textField('telephone', 'Téléphone', etab.telephone)}
            ${selectField('responsableId', 'Responsable', null, etab.responsableId, employees.map(e => ({ value: e.id, label: `${e.prenom} ${e.nom}` })))}
          </div>
          <div class="form-grid" style="margin-top: 12px;">
            ${checkboxField('principal', 'Établissement principal', etab.principal)}
            ${checkboxField('actif', 'Actif', etab.actif)}
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Annuler</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Enregistrer' : 'Créer'}</button>
        </div>
      </form>
    </div>
  `;

  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = html;
  modalRoot.classList.add('open');

  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
  document.getElementById('etablissement-form').addEventListener('submit', (evt) => {
    evt.preventDefault();
    const formData = new FormData(evt.target);
    const nom = formData.get('nom').trim();
    if (!nom) return;
    const data = {
      nom,
      codeInterne: formData.get('codeInterne').trim(),
      adresse: formData.get('adresse').trim(),
      codePostal: formData.get('codePostal').trim(),
      ville: formData.get('ville').trim(),
      pays: formData.get('pays').trim(),
      email: formData.get('email').trim(),
      telephone: formData.get('telephone').trim(),
      responsableId: formData.get('responsableId') || null,
      principal: formData.get('principal') === 'on',
      actif: formData.get('actif') === 'on'
    };
    if (isEdit) etablissementRepository.update(id, data); else etablissementRepository.create(data);
    showToast(isEdit ? 'Établissement mis à jour.' : 'Établissement créé.');
    closeModal();
    navigateTo('parametres', { parametresTab: 'etablissements' });
  });
}

// ---- Sous-vue : Services & équipes ----

function renderParametresServices() {
  const services = serviceRepository.getAll();
  return `
    <div class="view-header-row">
      <p class="view-subtitle">${services.length} service${services.length > 1 ? 's' : ''}</p>
      <button class="btn btn-primary" id="btn-new-service">+ Nouveau service</button>
    </div>
    <div class="settings-lists-grid">
      ${services.map(renderServiceCard).join('')}
    </div>
  `;
}

function renderServiceCard(service) {
  return `
    <div class="card">
      <div class="view-header-row">
        <h2>${escapeHtml(service.nom)}</h2>
        <div class="detail-header-actions">
          <button class="btn-link" data-rename-service="${service.id}">Renommer</button>
          <button class="btn-link btn-link-danger" data-delete-service="${service.id}">Supprimer</button>
        </div>
      </div>
      <div class="chip-list">
        ${service.equipes.length === 0 ? '<p class="text-muted">Aucune équipe.</p>' : service.equipes.map(eq => `
          <span class="chip">
            ${escapeHtml(eq.nom)}${eq.managerIds.length ? ` · ${escapeHtml(eq.managerIds.map(id => managerShortName(id)).join(', '))}` : ''}
            <button type="button" class="chip-remove" data-manage-equipe="${service.id}:${eq.id}" title="Gérer les managers">👤</button>
            <button type="button" class="chip-remove" data-delete-equipe="${service.id}:${eq.id}" title="Supprimer">✕</button>
          </span>
        `).join('')}
      </div>
      <form class="chip-add-form" data-add-equipe-service="${service.id}">
        <input type="text" class="input" placeholder="Nouvelle équipe..." required>
        <button type="submit" class="btn btn-secondary btn-sm">Ajouter</button>
      </form>
    </div>
  `;
}

function managerShortName(employeeId) {
  const m = employeeRepository.getById(employeeId);
  return m ? `${m.prenom} ${m.nom}` : '?';
}

function bindParametresServicesEvents() {
  document.getElementById('btn-new-service').addEventListener('click', () => openServiceModal(null));

  document.querySelectorAll('[data-rename-service]').forEach(btn => btn.addEventListener('click', () => openServiceModal(btn.dataset.renameService)));

  document.querySelectorAll('[data-delete-service]').forEach(btn => btn.addEventListener('click', () => {
    const service = serviceRepository.getById(btn.dataset.deleteService);
    openConfirm({
      title: 'Supprimer ce service ?',
      message: `"${service.nom}" et ses équipes seront définitivement supprimés. Les salariés déjà rattachés à ce service conservent leur donnée actuelle.`,
      confirmLabel: 'Supprimer',
      danger: true,
      onConfirm: () => {
        serviceRepository.delete(service.id);
        showToast('Service supprimé.');
        render();
      }
    });
  }));

  document.querySelectorAll('[data-add-equipe-service]').forEach(form => form.addEventListener('submit', (evt) => {
    evt.preventDefault();
    const input = form.querySelector('input');
    const nom = input.value.trim();
    if (!nom) return;
    DB.addEquipe(form.dataset.addEquipeService, nom);
    showToast('Équipe ajoutée.');
    render();
  }));

  document.querySelectorAll('[data-delete-equipe]').forEach(btn => btn.addEventListener('click', () => {
    const [serviceId, equipeId] = btn.dataset.deleteEquipe.split(':');
    const service = serviceRepository.getById(serviceId);
    const equipe = service.equipes.find(e => e.id === equipeId);
    openConfirm({
      title: 'Supprimer cette équipe ?',
      message: `"${equipe.nom}" sera retirée de "${service.nom}".`,
      confirmLabel: 'Supprimer',
      danger: true,
      onConfirm: () => {
        DB.deleteEquipe(serviceId, equipeId);
        showToast('Équipe supprimée.');
        render();
      }
    });
  }));

  document.querySelectorAll('[data-manage-equipe]').forEach(btn => btn.addEventListener('click', () => {
    const [serviceId, equipeId] = btn.dataset.manageEquipe.split(':');
    openEquipeManagersModal(serviceId, equipeId);
  }));
}

function openServiceModal(id) {
  const isEdit = Boolean(id);
  const service = isEdit ? serviceRepository.getById(id) : { nom: '' };

  const html = `
    <div class="modal modal-small">
      <div class="modal-header">
        <h2>${isEdit ? 'Renommer le service' : 'Nouveau service'}</h2>
        <button class="btn-icon" id="btn-close-modal" aria-label="Fermer" title="Fermer">✕</button>
      </div>
      <form id="service-form">
        <div class="modal-body">
          ${textField('nom', 'Nom du service', service.nom, true)}
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Annuler</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Enregistrer' : 'Créer'}</button>
        </div>
      </form>
    </div>
  `;

  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = html;
  modalRoot.classList.add('open');

  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
  document.getElementById('service-form').addEventListener('submit', (evt) => {
    evt.preventDefault();
    const nom = new FormData(evt.target).get('nom').trim();
    if (!nom) return;
    if (isEdit) serviceRepository.rename(id, nom); else serviceRepository.create(nom);
    showToast(isEdit ? 'Service renommé.' : 'Service créé.');
    closeModal();
    navigateTo('parametres', { parametresTab: 'services' });
  });
}

function openEquipeManagersModal(serviceId, equipeId) {
  const service = serviceRepository.getById(serviceId);
  const equipe = service.equipes.find(e => e.id === equipeId);
  const employees = employeeRepository.getAll().filter(e => !e.archive);

  const html = `
    <div class="modal modal-small">
      <div class="modal-header">
        <h2>Managers de "${escapeHtml(equipe.nom)}"</h2>
        <button class="btn-icon" id="btn-close-modal" aria-label="Fermer" title="Fermer">✕</button>
      </div>
      <form id="equipe-managers-form">
        <div class="modal-body">
          ${multiSelectField('managerIds', 'Managers de l\'équipe', employees.map(e => ({ value: e.id, label: `${e.prenom} ${e.nom}` })), equipe.managerIds)}
          <p class="text-muted" style="margin-top: 10px;">Ceci renseigne l'organisation de l'équipe ; pour changer le(s) manager(s) d'un salarié précis, modifiez sa fiche.</p>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Annuler</button>
          <button type="submit" class="btn btn-primary">Enregistrer</button>
        </div>
      </form>
    </div>
  `;

  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = html;
  modalRoot.classList.add('open');

  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
  document.getElementById('equipe-managers-form').addEventListener('submit', (evt) => {
    evt.preventDefault();
    const managerIds = new FormData(evt.target).getAll('managerIds');
    DB.setEquipeManagers(serviceId, equipeId, managerIds);
    showToast('Managers de l\'équipe mis à jour.');
    closeModal();
    render();
  });
}

// ---- Sous-vue : Listes de référence ----

function renderParametresListes() {
  const settings = settingsRepository.getSettings();
  return `
    <div class="card">
      <h2>Règles générales</h2>
      <div class="form-grid" style="max-width: 700px;">
        <div class="form-field">
          <label for="f-teletravail-quota">Quota de télétravail (jours / semaine)</label>
          <input class="input" type="number" min="0" max="7" id="f-teletravail-quota" value="${escapeHtml(settings.teletravailQuotaSemaine)}">
        </div>
        <div class="form-field">
          <label for="f-tickets-valeur">Valeur faciale du ticket restaurant (€)</label>
          <input class="input" type="number" min="0" step="0.01" id="f-tickets-valeur" value="${escapeHtml(settings.ticketsValeurFaciale)}">
        </div>
        <div class="form-field">
          <label for="f-tickets-part">Part employeur (%)</label>
          <input class="input" type="number" step="any" min="0" max="100" id="f-tickets-part" value="${escapeHtml(settings.ticketsPartEmployeurPct)}">
        </div>
        <div class="form-field form-field-checkbox" style="justify-content: flex-end;">
          <label><input type="checkbox" id="f-tickets-teletravail" ${settings.ticketsInclureTeletravail ? 'checked' : ''}> Le télétravail donne droit à un ticket</label>
        </div>
      </div>
    </div>
    <div class="card">
      <h2>Indicateurs Direction</h2>
      <p class="text-muted">Ces indicateurs reposent sur des données sensibles ; ils restent désactivés tant que l'entreprise ne choisit pas explicitement de les suivre.</p>
      <div class="form-grid" style="max-width: 700px;">
        <div class="form-field form-field-checkbox">
          <label><input type="checkbox" id="f-masse-salariale" ${settings.masseSalarialeActivee ? 'checked' : ''}> Suivre la masse salariale (salaire brut mensuel par salarié)</label>
        </div>
        <div class="form-field form-field-checkbox">
          <label><input type="checkbox" id="f-suivi-genre" ${settings.suiviGenreActive ? 'checked' : ''}> Suivre la répartition Hommes / Femmes</label>
        </div>
        <div class="form-field form-field-checkbox">
          <label><input type="checkbox" id="f-suivi-age" ${settings.suiviAgeActive ? 'checked' : ''}> Suivre la pyramide des âges</label>
        </div>
      </div>
    </div>
    <div class="card">
      <h2>Chaînes de validation</h2>
      <p class="text-muted">Modèle par défaut pour un nouveau type de congé (chaque type garde ensuite sa propre chaîne, modifiable dans Congés → Types), et chaîne appliquée au télétravail et aux notes de frais.</p>
      <div class="form-grid" style="max-width: 700px;">
        ${workflowSelectField('workflow-conges-default', 'Congés (modèle par défaut)', WORKFLOW_PRESETS_CONGES, settings.workflowCongesDefault)}
        ${workflowSelectField('workflow-teletravail', 'Télétravail', WORKFLOW_PRESETS_CONGES, settings.workflowTeletravail)}
        ${workflowSelectField('workflow-frais', 'Notes de frais', WORKFLOW_PRESETS_FRAIS, settings.workflowFrais)}
      </div>
    </div>
    <div class="settings-lists-grid">
      ${SETTINGS_LISTS.map(l => renderSettingsListCard(l, settings[l.key] || [])).join('')}
    </div>
  `;
}

function renderSettingsListCard(listDef, items) {
  return `
    <div class="card">
      <h2>${escapeHtml(listDef.label)}</h2>
      <div class="chip-list">
        ${items.map((item, i) => `
          <span class="chip">
            ${escapeHtml(item)}
            <button type="button" class="chip-remove" data-list-key="${listDef.key}" data-index="${i}" title="Retirer">✕</button>
          </span>
        `).join('')}
      </div>
      <form class="chip-add-form" data-list-key="${listDef.key}">
        <input type="text" class="input" placeholder="Ajouter un élément..." required>
        <button type="submit" class="btn btn-secondary btn-sm">Ajouter</button>
      </form>
    </div>
  `;
}

function bindParametresListesEvents() {
  document.getElementById('f-teletravail-quota').addEventListener('change', (e) => {
    const settings = settingsRepository.getSettings();
    settings.teletravailQuotaSemaine = Number(e.target.value) || 0;
    settingsRepository.saveSettings(settings);
    showToast('Quota mis à jour.');
  });
  document.getElementById('f-tickets-valeur').addEventListener('change', (e) => {
    const settings = settingsRepository.getSettings();
    settings.ticketsValeurFaciale = Number(e.target.value) || 0;
    settingsRepository.saveSettings(settings);
    showToast('Valeur faciale mise à jour.');
  });
  document.getElementById('f-tickets-part').addEventListener('change', (e) => {
    const settings = settingsRepository.getSettings();
    settings.ticketsPartEmployeurPct = Number(e.target.value) || 0;
    settingsRepository.saveSettings(settings);
    showToast('Part employeur mise à jour.');
  });
  document.getElementById('f-tickets-teletravail').addEventListener('change', (e) => {
    const settings = settingsRepository.getSettings();
    settings.ticketsInclureTeletravail = e.target.checked;
    settingsRepository.saveSettings(settings);
    showToast('Règle mise à jour.');
  });
  document.getElementById('f-masse-salariale').addEventListener('change', (e) => {
    const settings = settingsRepository.getSettings();
    settings.masseSalarialeActivee = e.target.checked;
    settingsRepository.saveSettings(settings);
    showToast('Réglage mis à jour.');
  });
  document.getElementById('f-suivi-genre').addEventListener('change', (e) => {
    const settings = settingsRepository.getSettings();
    settings.suiviGenreActive = e.target.checked;
    settingsRepository.saveSettings(settings);
    showToast('Réglage mis à jour.');
  });
  document.getElementById('f-suivi-age').addEventListener('change', (e) => {
    const settings = settingsRepository.getSettings();
    settings.suiviAgeActive = e.target.checked;
    settingsRepository.saveSettings(settings);
    showToast('Réglage mis à jour.');
  });
  document.getElementById('f-workflow-conges-default').addEventListener('change', (e) => {
    const settings = settingsRepository.getSettings();
    settings.workflowCongesDefault = JSON.parse(e.target.value);
    settingsRepository.saveSettings(settings);
    showToast('Modèle de validation des congés mis à jour.');
  });
  document.getElementById('f-workflow-teletravail').addEventListener('change', (e) => {
    const settings = settingsRepository.getSettings();
    settings.workflowTeletravail = JSON.parse(e.target.value);
    settingsRepository.saveSettings(settings);
    showToast('Chaîne de validation du télétravail mise à jour.');
  });
  document.getElementById('f-workflow-frais').addEventListener('change', (e) => {
    const settings = settingsRepository.getSettings();
    settings.workflowFrais = JSON.parse(e.target.value);
    settingsRepository.saveSettings(settings);
    showToast('Chaîne de validation des notes de frais mise à jour.');
  });

  document.querySelectorAll('.chip-remove[data-list-key]').forEach(btn => {
    btn.addEventListener('click', () => {
      const settings = settingsRepository.getSettings();
      const key = btn.dataset.listKey;
      const index = Number(btn.dataset.index);
      const value = settings[key][index];
      const checkUsage = SETTINGS_LIST_USAGE_CHECK[key];
      if (checkUsage && checkUsage(value)) {
        showToast(`« ${value} » est encore utilisé et ne peut pas être retiré de la liste.`, 'error');
        return;
      }
      settings[key] = settings[key].filter((_, i) => i !== index);
      settingsRepository.saveSettings(settings);
      render();
    });
  });

  document.querySelectorAll('.chip-add-form').forEach(form => {
    form.addEventListener('submit', (evt) => {
      evt.preventDefault();
      const key = form.dataset.listKey;
      const input = form.querySelector('input');
      const value = input.value.trim();
      if (!value) return;

      const settings = settingsRepository.getSettings();
      if (settings[key].includes(value)) {
        showToast('Cet élément existe déjà.', 'error');
        return;
      }
      settings[key] = [...settings[key], value];
      settingsRepository.saveSettings(settings);
      showToast('Liste mise à jour.');
      render();
    });
  });
}

// ---- Sous-vue : Vacances scolaires ----

function renderParametresVacances() {
  const settings = settingsRepository.getSettings();
  const schoolData = schoolHolidayRepository.getSchoolHolidays();
  // §sprint refonte UX §2 : avertissement général (pas propre à un mois précis) — se déclenche dès
  // que le calendrier affiché aujourd'hui sort de la couverture des périodes saisies.
  const coverageGap = isMonthBeyondSchoolYearCoverage(new Date().getFullYear(), new Date().getMonth(), schoolData);

  return `
    ${coverageGap ? `
      <div class="card" style="border-color: var(--color-warning); background: var(--color-warning-soft); margin-bottom: 16px;">
        <p style="margin: 0;">⚠️ Aucune période de vacances scolaires n'est définie pour le mois en cours. Ajoutez l'année scolaire suivante ci-dessous pour que le calendrier reste à jour.</p>
      </div>
    ` : ''}
    <div class="card">
      <h2>Zone de l'entreprise</h2>
      <p class="text-muted">Détermine quelles vacances scolaires apparaissent dans le calendrier et les compteurs.</p>
      <select class="input" id="f-school-zone" style="max-width: 200px; margin-top: 10px;">
        ${['A', 'B', 'C'].map(z => `<option value="${z}" ${settings.schoolZone === z ? 'selected' : ''}>Zone ${z}</option>`).join('')}
      </select>
    </div>

    <div class="card table-card">
      <div class="view-header-row" style="padding: 20px 20px 0;">
        <h2>Périodes — année scolaire ${escapeHtml(schoolData.anneeScolaire)}</h2>
        <button class="btn btn-secondary btn-sm" id="btn-new-school-period">+ Nouvelle période</button>
      </div>
      <table class="table">
        <thead>
          <tr><th>Période</th><th>Début</th><th>Fin</th><th>Zones</th><th></th></tr>
        </thead>
        <tbody>
          ${schoolData.periodes.map((p, i) => `
            <tr>
              <td>${escapeHtml(p.nom)}</td>
              <td>${formatDate(p.debut)}</td>
              <td>${formatDate(p.fin)}</td>
              <td>${p.zones.map(escapeHtml).join(', ')}</td>
              <td class="table-actions">
                <button class="btn-link" data-edit-period="${i}">Modifier</button>
                <button class="btn-link btn-link-danger" data-delete-period="${i}">Supprimer</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function bindParametresVacancesEvents() {
  document.getElementById('f-school-zone').addEventListener('change', (e) => {
    const settings = settingsRepository.getSettings();
    settings.schoolZone = e.target.value;
    settingsRepository.saveSettings(settings);
    showToast('Zone de vacances scolaires mise à jour.');
  });

  document.getElementById('btn-new-school-period').addEventListener('click', () => openSchoolPeriodModal());
  document.querySelectorAll('[data-edit-period]').forEach(btn => {
    btn.addEventListener('click', () => openSchoolPeriodModal(Number(btn.dataset.editPeriod)));
  });
  document.querySelectorAll('[data-delete-period]').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = Number(btn.dataset.deletePeriod);
      const schoolData = schoolHolidayRepository.getSchoolHolidays();
      const period = schoolData.periodes[index];
      openConfirm({
        title: 'Supprimer cette période ?',
        message: `"${period.nom}" sera retirée du calendrier.`,
        confirmLabel: 'Supprimer',
        danger: true,
        onConfirm: () => {
          schoolData.periodes.splice(index, 1);
          schoolHolidayRepository.saveSchoolHolidays(schoolData);
          showToast('Période supprimée.');
          render();
        }
      });
    });
  });
}

function openSchoolPeriodModal(index) {
  const isEdit = index !== undefined;
  const schoolData = schoolHolidayRepository.getSchoolHolidays();
  const period = isEdit ? schoolData.periodes[index] : { nom: '', debut: '', fin: '', zones: ['A', 'B', 'C'] };

  const html = `
    <div class="modal">
      <div class="modal-header">
        <h2>${isEdit ? 'Modifier la période' : 'Nouvelle période de vacances'}</h2>
        <button class="btn-icon" id="btn-close-modal" aria-label="Fermer" title="Fermer">✕</button>
      </div>
      <form id="school-period-form">
        <div class="modal-body">
          <div class="form-grid">
            ${textField('nom', 'Nom', period.nom, true)}
            ${textField('debut', 'Date de début', period.debut, true, 'date')}
            ${textField('fin', 'Date de fin', period.fin, true, 'date')}
          </div>
          <div class="form-field form-field-checkbox" style="margin-top: 14px; display: flex; gap: 16px;">
            ${['A', 'B', 'C'].map(z => `<label><input type="checkbox" name="zone-${z}" ${period.zones.includes(z) ? 'checked' : ''}> Zone ${z}</label>`).join('')}
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Annuler</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Enregistrer' : 'Créer'}</button>
        </div>
      </form>
    </div>
  `;

  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = html;
  modalRoot.classList.add('open');

  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
  document.getElementById('school-period-form').addEventListener('submit', (evt) => submitSchoolPeriodForm(evt, index));
}

function submitSchoolPeriodForm(evt, index) {
  evt.preventDefault();
  const form = evt.target;
  const zones = ['A', 'B', 'C'].filter(z => form.querySelector(`[name="zone-${z}"]`).checked);
  const patch = {
    nom: form.querySelector('#f-nom').value,
    debut: form.querySelector('#f-debut').value,
    fin: form.querySelector('#f-fin').value,
    zones
  };

  if (patch.debut && patch.fin && patch.fin < patch.debut) {
    showToast('La date de fin ne peut pas être avant la date de début.', 'error');
    return;
  }

  const schoolData = schoolHolidayRepository.getSchoolHolidays();
  if (index !== undefined) {
    schoolData.periodes[index] = patch;
  } else {
    schoolData.periodes.push(patch);
  }
  schoolHolidayRepository.saveSchoolHolidays(schoolData);
  showToast(index !== undefined ? 'Période mise à jour.' : 'Période créée.');
  closeModal();
  navigateTo('parametres', { parametresTab: 'vacances' });
}

// ---- Sous-vue : Jours fériés (calculés automatiquement, lecture seule) ----

function renderParametresFeries() {
  const year = state.parametresFeriesYear;
  const settings = settingsRepository.getSettings();
  const holidays = getAllPublicHolidays(year, settings).slice().sort((a, b) => a.date.localeCompare(b.date));

  return `
    <div class="card table-card">
      <div class="view-header-row" style="padding: 20px 20px 0;">
        <div>
          <h2>Jours fériés ${year}</h2>
          <p class="text-muted">Les 11 fériés nationaux sont calculés automatiquement — ajoutez-en d'autres si besoin (jour férié local, fermeture d'entreprise...), ils s'appliquent partout : calendriers, planning, tickets restaurant. Par défaut, personne ne travaille un jour férié — configurez des exceptions par catégorie si certains salariés doivent le travailler.</p>
        </div>
        <div class="calendar-nav">
          <button class="btn btn-secondary btn-sm" id="btn-feries-prev">← ${year - 1}</button>
          <button class="btn btn-secondary btn-sm" id="btn-feries-next">${year + 1} →</button>
          <button class="btn btn-primary btn-sm" id="btn-add-jour-ferie">+ Ajouter un jour férié</button>
        </div>
      </div>
      <table class="table">
        <thead><tr><th>Date</th><th>Jour férié</th><th>Travaillé</th><th></th><th></th></tr></thead>
        <tbody>
          ${holidays.map(h => `
            <tr>
              <td>${formatDate(h.date)}</td>
              <td>${escapeHtml(h.label)}</td>
              <td>${h.travaillable
                ? '<span class="badge badge-warning">Oui</span>'
                : (h.exceptionsCategories || []).length
                  ? '<span class="badge badge-info">Selon catégorie</span>'
                  : '<span class="badge badge-muted">Non</span>'}</td>
              <td>${h.custom ? '<span class="badge badge-info">Ajouté</span>' : ''}</td>
              <td>
                <button type="button" class="btn-link" data-configure-jour-ferie="${escapeHtml(h.date)}">Configurer</button>
                ${h.custom ? `<button type="button" class="btn-link" data-remove-jour-ferie="${escapeHtml(h.date)}" data-remove-jour-ferie-label="${escapeHtml(h.label)}">Supprimer</button>` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function bindParametresFeriesEvents() {
  document.getElementById('btn-feries-prev').addEventListener('click', () => { state.parametresFeriesYear -= 1; render(); });
  document.getElementById('btn-feries-next').addEventListener('click', () => { state.parametresFeriesYear += 1; render(); });
  document.getElementById('btn-add-jour-ferie').addEventListener('click', () => openJourFerieModal());
  document.querySelectorAll('[data-configure-jour-ferie]').forEach(btn => {
    const year = state.parametresFeriesYear;
    const holiday = getAllPublicHolidays(year, settingsRepository.getSettings()).find(h => h.date === btn.dataset.configureJourFerie);
    btn.addEventListener('click', () => openJourFerieModal(holiday));
  });
  document.querySelectorAll('[data-remove-jour-ferie]').forEach(btn => {
    btn.addEventListener('click', () => {
      const settings = settingsRepository.getSettings();
      settings.joursFeriesPersonnalises = (settings.joursFeriesPersonnalises || [])
        .filter(h => !(h.date === btn.dataset.removeJourFerie && h.label === btn.dataset.removeJourFerieLabel));
      settingsRepository.saveSettings(settings);
      showToast('Jour férié supprimé.');
      render();
    });
  });
}

/** Construit un multi-select "catégories qui font exception à la règle par défaut" — coché =
 * comportement inverse de defaultTravaillable pour cette catégorie. Réutilisé pour les jours
 * fériés (§8) ET les fermetures (§9), mêmes exceptionsCategories : [{categorieSalarieId, travaillable}]. */
function renderExceptionsCategoriesField(exceptions, categoriesSalarie) {
  const exceptionIds = new Set((exceptions || []).map(ex => ex.categorieSalarieId));
  if (!categoriesSalarie.length) return '<p class="form-hint">Aucune catégorie de salarié paramétrée (Paramètres → Catégories de salariés).</p>';
  return `
    <select class="input" id="f-exceptions-categories" multiple style="min-height:80px;">
      ${categoriesSalarie.map(c => `<option value="${escapeHtml(c.id)}" ${exceptionIds.has(c.id) ? 'selected' : ''}>${escapeHtml(c.nom)}</option>`).join('')}
    </select>
  `;
}

/** Ajoute un jour férié personnalisé (settings.joursFeriesPersonnalises) OU configure travaillable/
 * exceptionsCategories d'un jour existant — national (settings.feriesOverrides, jamais stocké tel
 * quel sinon) ou déjà ajouté (édition directe de l'entrée). Voir getAllPublicHolidays(),
 * isJourTravaillePourSalarie() — consultés partout où "les jours fériés" comptent. */
function openJourFerieModal(existingHoliday) {
  const isNew = !existingHoliday;
  const categoriesSalarie = categorieSalarieRepository.getAll();
  const html = `
    <div class="modal modal-small">
      <div class="modal-header">
        <h2>${isNew ? 'Ajouter un jour férié' : 'Configurer ce jour férié'}</h2>
        <button class="btn-icon" id="btn-close-modal" aria-label="Fermer" title="Fermer">✕</button>
      </div>
      <form id="jour-ferie-form">
        <div class="modal-body">
          <div class="form-field">
            <label for="f-jour-ferie-date">Date *</label>
            <input class="input" type="date" id="f-jour-ferie-date" value="${escapeHtml(existingHoliday?.date || '')}" ${isNew ? 'required' : 'readonly'}>
          </div>
          <div class="form-field" style="margin-top: 12px;">
            <label for="f-jour-ferie-label">Libellé *</label>
            <input class="input" type="text" id="f-jour-ferie-label" value="${escapeHtml(existingHoliday?.label || '')}" placeholder="Ex. Vendredi Saint, Fermeture entreprise..." ${!isNew && !existingHoliday.custom ? 'readonly' : ''} required>
          </div>
          <div class="form-field form-field-checkbox" style="margin-top: 12px;">
            <input type="checkbox" id="f-jour-ferie-travaillable" ${existingHoliday?.travaillable ? 'checked' : ''}>
            <label for="f-jour-ferie-travaillable">Ce jour est travaillé normalement (par défaut personne ne travaille)</label>
          </div>
          <div class="form-field" style="margin-top: 12px;">
            <label>Catégories qui font exception à la règle ci-dessus</label>
            ${renderExceptionsCategoriesField(existingHoliday?.exceptionsCategories, categoriesSalarie)}
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Annuler</button>
          <button type="submit" class="btn btn-primary">${isNew ? 'Ajouter' : 'Enregistrer'}</button>
        </div>
      </form>
    </div>
  `;
  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = html;
  modalRoot.classList.add('open');
  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
  document.getElementById('jour-ferie-form').addEventListener('submit', (evt) => {
    evt.preventDefault();
    const date = document.getElementById('f-jour-ferie-date').value;
    const label = document.getElementById('f-jour-ferie-label').value.trim();
    const travaillable = document.getElementById('f-jour-ferie-travaillable').checked;
    const exceptionsSelect = document.getElementById('f-exceptions-categories');
    const exceptionsCategories = exceptionsSelect
      ? Array.from(exceptionsSelect.selectedOptions).map(o => ({ categorieSalarieId: o.value, travaillable: !travaillable }))
      : [];

    const settings = settingsRepository.getSettings();
    if (isNew || existingHoliday.custom) {
      settings.joursFeriesPersonnalises = [
        ...(settings.joursFeriesPersonnalises || []).filter(h => !(existingHoliday && h.date === existingHoliday.date && h.label === existingHoliday.label)),
        { date, label, travaillable, exceptionsCategories }
      ];
    } else {
      settings.feriesOverrides = { ...(settings.feriesOverrides || {}), [date]: { travaillable, exceptionsCategories } };
    }
    settingsRepository.saveSettings(settings);
    state.parametresFeriesYear = Number(date.slice(0, 4));
    closeModal();
    showToast(isNew ? 'Jour férié ajouté.' : 'Jour férié mis à jour.');
    render();
  });
}

// ---- Sous-vue : Fermetures d'entreprise (§9 sprint amélioration) ----

/** Module dédié plutôt que fondu dans les jours fériés ou les absences (voir le plan) : couvre une
 * PLAGE de dates (pas un jour isolé comme un férié), n'a aucune portée légale/CP, et ne doit jamais
 * entamer le solde de congés d'un salarié concerné — contrairement à une absence classique.
 * settings.fermetures : { id, nom, dateDebut, dateFin, exceptionsCategories }. Consulté par
 * isJourTravaillePourSalarie() (data.js), donc pris en compte partout (tickets restaurant, calendriers). */
function renderParametresFermetures() {
  const settings = settingsRepository.getSettings();
  const fermetures = (settings.fermetures || []).slice().sort((a, b) => a.dateDebut.localeCompare(b.dateDebut));
  return `
    <div class="card table-card">
      <div class="view-header-row" style="padding: 20px 20px 0;">
        <div>
          <h2>Fermetures d'entreprise</h2>
          <p class="text-muted">Fermeture exceptionnelle, pont, fermeture annuelle... — une plage de dates où personne (ou seulement certaines catégories) ne travaille, sans jamais entamer le solde de congés des salariés concernés.</p>
        </div>
        <button class="btn btn-primary btn-sm" id="btn-add-fermeture">+ Ajouter une fermeture</button>
      </div>
      ${fermetures.length === 0 ? `<div class="empty-state"><div class="empty-icon">🏢</div><p>Aucune fermeture programmée.</p></div>` : `
        <table class="table">
          <thead><tr><th>Nom</th><th>Du</th><th>Au</th><th></th></tr></thead>
          <tbody>
            ${fermetures.map(f => `
              <tr>
                <td>${escapeHtml(f.nom)}</td>
                <td>${formatDate(f.dateDebut)}</td>
                <td>${formatDate(f.dateFin)}</td>
                <td>
                  <button type="button" class="btn-link" data-edit-fermeture="${escapeHtml(f.id)}">Modifier</button>
                  <button type="button" class="btn-link" data-delete-fermeture="${escapeHtml(f.id)}" data-nom="${escapeHtml(f.nom)}">Supprimer</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>
  `;
}

function bindParametresFermeturesEvents() {
  document.getElementById('btn-add-fermeture').addEventListener('click', () => openFermetureModal());
  document.querySelectorAll('[data-edit-fermeture]').forEach(btn => {
    btn.addEventListener('click', () => {
      const settings = settingsRepository.getSettings();
      const fermeture = (settings.fermetures || []).find(f => f.id === btn.dataset.editFermeture);
      openFermetureModal(fermeture);
    });
  });
  document.querySelectorAll('[data-delete-fermeture]').forEach(btn => {
    btn.addEventListener('click', () => {
      openConfirm({
        title: 'Supprimer cette fermeture ?',
        message: `«${btn.dataset.nom}» ne sera plus prise en compte.`,
        confirmLabel: 'Supprimer',
        danger: true,
        onConfirm: () => {
          const settings = settingsRepository.getSettings();
          settings.fermetures = (settings.fermetures || []).filter(f => f.id !== btn.dataset.deleteFermeture);
          settingsRepository.saveSettings(settings);
          showToast('Fermeture supprimée.');
          render();
        }
      });
    });
  });
}

function openFermetureModal(existing) {
  const isEdit = Boolean(existing);
  const categoriesSalarie = categorieSalarieRepository.getAll();
  const html = `
    <div class="modal modal-small">
      <div class="modal-header">
        <h2>${isEdit ? 'Modifier la fermeture' : 'Nouvelle fermeture'}</h2>
        <button class="btn-icon" id="btn-close-modal" aria-label="Fermer" title="Fermer">✕</button>
      </div>
      <form id="fermeture-form">
        <div class="modal-body">
          <div class="form-field">
            <label for="f-fermeture-nom">Nom *</label>
            <input class="input" type="text" id="f-fermeture-nom" value="${escapeHtml(existing?.nom || '')}" placeholder="Ex. Fermeture annuelle août" required>
          </div>
          <div class="form-grid" style="margin-top:12px;">
            <div class="form-field">
              <label for="f-fermeture-debut">Du *</label>
              <input class="input" type="date" id="f-fermeture-debut" value="${escapeHtml(existing?.dateDebut || '')}" required>
            </div>
            <div class="form-field">
              <label for="f-fermeture-fin">Au *</label>
              <input class="input" type="date" id="f-fermeture-fin" value="${escapeHtml(existing?.dateFin || '')}" required>
            </div>
          </div>
          <div class="form-field" style="margin-top:12px;">
            <label>Catégories qui travaillent malgré tout pendant cette fermeture</label>
            ${renderExceptionsCategoriesField(existing?.exceptionsCategories, categoriesSalarie)}
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Annuler</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Enregistrer' : 'Créer'}</button>
        </div>
      </form>
    </div>
  `;
  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = html;
  modalRoot.classList.add('open');
  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
  document.getElementById('fermeture-form').addEventListener('submit', (evt) => {
    evt.preventDefault();
    const nom = document.getElementById('f-fermeture-nom').value.trim();
    const dateDebut = document.getElementById('f-fermeture-debut').value;
    const dateFin = document.getElementById('f-fermeture-fin').value;
    if (dateFin < dateDebut) {
      showToast('La date de fin ne peut pas être avant la date de début.', 'error');
      return;
    }
    const exceptionsSelect = document.getElementById('f-exceptions-categories');
    const exceptionsCategories = exceptionsSelect
      ? Array.from(exceptionsSelect.selectedOptions).map(o => ({ categorieSalarieId: o.value, travaillable: true }))
      : [];

    const settings = settingsRepository.getSettings();
    if (isEdit) {
      settings.fermetures = (settings.fermetures || []).map(f => f.id === existing.id ? { ...f, nom, dateDebut, dateFin, exceptionsCategories } : f);
    } else {
      settings.fermetures = [...(settings.fermetures || []), { id: generateId('ferm'), nom, dateDebut, dateFin, exceptionsCategories }];
    }
    settingsRepository.saveSettings(settings);
    closeModal();
    showToast(isEdit ? 'Fermeture mise à jour.' : 'Fermeture créée.');
    render();
  });
}

// ---- Sous-vue : Catégories de salariés (§10 sprint amélioration) ----

/** Remplace statutPro (texte libre, jamais lu par aucune règle) par une vraie liste paramétrable
 * référençable par id — utilisée par les règles d'éligibilité de congé, les exceptions jours
 * fériés/fermetures, etc. (voir getEffectiveCategorieSalarieId, data.js). Migrée automatiquement
 * depuis les statutPro déjà utilisés (DB.getSettings()) — jamais vide à l'affichage. */
function renderParametresCategoriesSalarie() {
  const categories = categorieSalarieRepository.getAll();
  return `
    <div class="card table-card">
      <div class="view-header-row" style="padding: 20px 20px 0;">
        <div>
          <h2>Catégories de salariés</h2>
          <p class="text-muted">Ex. Cadre, Non cadre, ou toute autre catégorisation propre à votre entreprise — utilisable dans les règles de congés, jours fériés et fermetures.</p>
        </div>
        <button class="btn btn-primary btn-sm" id="btn-add-categorie-salarie">+ Ajouter une catégorie</button>
      </div>
      <table class="table">
        <thead><tr><th>Nom</th><th>Description</th><th></th></tr></thead>
        <tbody>
          ${categories.map(c => `
            <tr>
              <td>${escapeHtml(c.nom)}</td>
              <td>${escapeHtml(c.description || '—')}</td>
              <td>
                <button type="button" class="btn-link" data-edit-categorie-salarie="${escapeHtml(c.id)}">Modifier</button>
                <button type="button" class="btn-link" data-delete-categorie-salarie="${escapeHtml(c.id)}" data-nom="${escapeHtml(c.nom)}">Supprimer</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function bindParametresCategoriesSalarieEvents() {
  document.getElementById('btn-add-categorie-salarie').addEventListener('click', () => openCategorieSalarieModal());
  document.querySelectorAll('[data-edit-categorie-salarie]').forEach(btn => {
    btn.addEventListener('click', () => openCategorieSalarieModal(btn.dataset.editCategorieSalarie));
  });
  document.querySelectorAll('[data-delete-categorie-salarie]').forEach(btn => {
    btn.addEventListener('click', () => {
      openConfirm({
        title: 'Supprimer cette catégorie ?',
        message: `«${btn.dataset.nom}» sera retirée de la fiche de tout salarié qui la porte actuellement.`,
        confirmLabel: 'Supprimer',
        danger: true,
        onConfirm: () => {
          categorieSalarieRepository.delete(btn.dataset.deleteCategorieSalarie);
          showToast('Catégorie supprimée.');
          render();
        }
      });
    });
  });
}

function openCategorieSalarieModal(id) {
  const isEdit = Boolean(id);
  const categorie = isEdit ? categorieSalarieRepository.getById(id) : makeEmptyCategorieSalarie();
  if (isEdit && !categorie) { showToast('Cette catégorie n\'est plus disponible.', 'error'); return; }

  const html = `
    <div class="modal modal-small">
      <div class="modal-header">
        <h2>${isEdit ? 'Modifier la catégorie' : 'Nouvelle catégorie de salarié'}</h2>
        <button class="btn-icon" id="btn-close-modal" aria-label="Fermer" title="Fermer">✕</button>
      </div>
      <form id="categorie-salarie-form">
        <div class="modal-body">
          <div class="form-field">
            <label for="f-cat-nom">Nom *</label>
            <input class="input" type="text" id="f-cat-nom" value="${escapeHtml(categorie.nom)}" required>
          </div>
          <div class="form-field" style="margin-top: 12px;">
            <label for="f-cat-description">Description</label>
            <input class="input" type="text" id="f-cat-description" value="${escapeHtml(categorie.description)}">
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Annuler</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Enregistrer' : 'Créer'}</button>
        </div>
      </form>
    </div>
  `;
  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = html;
  modalRoot.classList.add('open');
  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
  document.getElementById('categorie-salarie-form').addEventListener('submit', (evt) => {
    evt.preventDefault();
    const patch = {
      nom: document.getElementById('f-cat-nom').value.trim(),
      description: document.getElementById('f-cat-description').value.trim()
    };
    if (isEdit) categorieSalarieRepository.update(id, patch);
    else categorieSalarieRepository.create(patch);
    closeModal();
    showToast(isEdit ? 'Catégorie mise à jour.' : 'Catégorie créée.');
    render();
  });
}

// ---- Sous-vue : Journal d'audit (lecture seule) ----

const AUDIT_ACTIONS = ['Création', 'Modification', 'Suppression', 'Validation', 'Refus', 'Annulation', 'Export', 'Connexion', 'Déconnexion'];

/** Le journal complet peut atteindre 2000 entrées (cf. appendAuditLogEntry) : la recherche/les
 * filtres sont indispensables pour retrouver un événement précis plutôt que de ne montrer que les
 * 200 plus récents sans aucun moyen d'aller plus loin. */
function getFilteredAuditLog() {
  const filters = state.auditFilters;
  let list = auditLogRepository.getAuditLog();
  if (filters.action) list = list.filter(e => e.action === filters.action);
  if (filters.dateDebut) list = list.filter(e => toISODate(new Date(e.date)) >= filters.dateDebut);
  if (filters.dateFin) list = list.filter(e => toISODate(new Date(e.date)) <= filters.dateFin);
  const term = normalizeForSearch((filters.search || '').trim());
  if (term) list = list.filter(e => normalizeForSearch(`${e.entite} ${e.cible} ${e.details || ''}`).includes(term));
  return list;
}

function renderParametresQualite() {
  const issues = getDataQualityIssues();
  return `
    <div class="card">
      <h2>Qualité des données</h2>
      <p class="text-muted">Contrôles automatiques sur les salariés actifs — à corriger avant que ça ne pose problème en paie ou en déclaration.</p>
      ${issues.length === 0 ? `<div class="empty-state"><div class="empty-icon">✅</div><p>Aucun problème détecté.</p></div>` : `
        <div class="mini-list" style="margin-top: 12px;">
          ${issues.map(issue => `
            <div class="mini-list-item quality-issue-row">
              <div class="quality-issue-header">
                <span class="badge badge-${issue.severity === 'error' ? 'danger' : issue.severity === 'warning' ? 'warning' : 'info'}">${issue.employees.length}</span>
                <strong>${escapeHtml(issue.label)}</strong>
              </div>
              <div class="quality-issue-employees">
                ${issue.employees.map(e => `<button type="button" class="btn-link quality-issue-link" data-employee-id="${escapeHtml(e.id)}">${escapeHtml(e.prenom)} ${escapeHtml(e.nom)}</button>`).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      `}
    </div>
  `;
}

function bindParametresQualiteEvents() {
  document.querySelectorAll('.quality-issue-link').forEach(btn => {
    btn.addEventListener('click', () => navigateTo('employee-detail', { currentEmployeeId: btn.dataset.employeeId }));
  });
}

function renderParametresAudit() {
  const filters = state.auditFilters;
  const total = auditLogRepository.getAuditLog().length;
  const log = getFilteredAuditLog();
  const { pageItems, totalPages, page, pageStart } = paginate(log, 'auditPage');

  return `
    <div class="card table-card">
      <div class="view-header-row" style="padding: 20px 20px 0;">
        <div>
          <h2>Journal d'audit</h2>
          <p class="text-muted">${log.length} événement${log.length > 1 ? 's' : ''} sur ${total} au total</p>
        </div>
        <button class="btn btn-secondary btn-sm" id="btn-export-audit">Exporter CSV</button>
      </div>
      <div class="toolbar card" style="margin: 12px 20px 0;">
        <input type="text" id="audit-filter-search" class="input" placeholder="Rechercher (entité, cible, détails)..." value="${escapeHtml(filters.search)}">
        <select id="audit-filter-action" class="input">
          <option value="">Toutes les actions</option>
          ${AUDIT_ACTIONS.map(a => `<option value="${a}" ${filters.action === a ? 'selected' : ''}>${a}</option>`).join('')}
        </select>
        <input type="date" id="audit-filter-date-debut" class="input" value="${escapeHtml(filters.dateDebut)}" title="Depuis le">
        <input type="date" id="audit-filter-date-fin" class="input" value="${escapeHtml(filters.dateFin)}" title="Jusqu'au">
      </div>
      ${log.length === 0 ? `<div class="empty-state"><div class="empty-icon">🗂️</div><p>Aucun événement ne correspond à ces filtres.</p></div>` : `
        <table class="table">
          <thead><tr><th>Date</th><th>Action</th><th>Entité</th><th>Cible</th></tr></thead>
          <tbody>
            ${pageItems.map(entry => `
              <tr>
                <td>${formatDateTime(entry.date)}</td>
                <td>${auditActionBadge(entry.action)}</td>
                <td>${escapeHtml(entry.entite)}</td>
                <td>${escapeHtml(entry.cible)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        ${renderPaginationControls(page, totalPages, pageStart, pageItems.length, log.length)}
      `}
    </div>
  `;
}

function auditActionBadge(action) {
  const map = { 'Création': 'success', 'Modification': 'info', 'Suppression': 'warning', 'Validation': 'success', 'Refus': 'muted', 'Annulation': 'muted', 'Export': 'info', 'Connexion': 'warning' };
  return `<span class="badge badge-${map[action] || 'muted'}">${escapeHtml(action)}</span>`;
}

function bindParametresAuditEvents() {
  document.getElementById('btn-export-audit').addEventListener('click', exportAuditLogCSV);

  document.getElementById('audit-filter-search').addEventListener('input', (e) => {
    state.auditFilters.search = e.target.value;
    state.auditPage = 1;
    render();
    document.getElementById('audit-filter-search').focus();
    const pos = e.target.selectionStart;
    document.getElementById('audit-filter-search').setSelectionRange(pos, pos);
  });
  document.getElementById('audit-filter-action').addEventListener('change', (e) => {
    state.auditFilters.action = e.target.value;
    state.auditPage = 1;
    render();
  });
  document.getElementById('audit-filter-date-debut').addEventListener('change', (e) => {
    state.auditFilters.dateDebut = e.target.value;
    state.auditPage = 1;
    render();
  });
  document.getElementById('audit-filter-date-fin').addEventListener('change', (e) => {
    state.auditFilters.dateFin = e.target.value;
    state.auditPage = 1;
    render();
  });

  const prevBtn = document.getElementById('btn-page-prev');
  if (prevBtn) prevBtn.addEventListener('click', () => { state.auditPage -= 1; render(); });
  const nextBtn = document.getElementById('btn-page-next');
  if (nextBtn) nextBtn.addEventListener('click', () => { state.auditPage += 1; render(); });
}

function exportAuditLogCSV() {
  const log = getFilteredAuditLog();
  const headers = ['Date', 'Action', 'Entité', 'Cible', 'Détails'];
  const rows = log.map(e => [formatDateTime(e.date), e.action, e.entite, e.cible, e.details]);
  exportRowsToCSV(headers, rows, 'journal-audit.csv');
  auditLogRepository.logAudit('Export', 'Journal d\'audit', `${log.length} événements`);
}

// ---------------------------------------------------------------------------
// Vue : Planning des absences (semaine / mois / année, tous types confondus)
// ---------------------------------------------------------------------------

/** Statut d'un salarié à une date donnée, tous types d'absence confondus (congé ou télétravail).
 * Sprint SIRH premium §2 : `leaveRequests`/`teleworkRequests` peuvent désormais inclure des demandes
 * "En attente" (pas seulement "Validé") — `pending: true` permet à l'affichage de les distinguer
 * visuellement (semi-transparent) plutôt que de les rendre invisibles comme avant. */
function getStatusForDate(employee, dateStr, leaveRequests, teleworkRequests) {
  const weekday = WEEKDAY_LABELS[(parseISODateLocal(dateStr).getDay() + 6) % 7];
  if (!(employee.joursTravailles || []).includes(weekday)) {
    return { icon: '—', level: 'off', title: 'Non travaillé' };
  }

  const onLeave = leaveRequests.find(r => r.employeeId === employee.id && dateStr >= r.dateDebut && dateStr <= r.dateFin);
  if (onLeave) {
    const type = leaveTypeRepository.getLeaveTypeById(onLeave.typeId);
    const pending = onLeave.statut !== 'Validé';
    return { icon: type ? type.icone : '🏖️', level: 'leave', title: `${type ? type.nom : 'Congé'}${pending ? ' (en attente)' : ''}`, pending, requestId: onLeave.id, requestType: 'leave' };
  }

  const onTelework = teleworkRequests.find(r => r.employeeId === employee.id && dateStr >= r.dateDebut && dateStr <= r.dateFin);
  if (onTelework) {
    const pending = onTelework.statut !== 'Validé';
    return { icon: '💻', level: 'remote', title: `Télétravail${pending ? ' (en attente)' : ''}`, pending, requestId: onTelework.id, requestType: 'telework' };
  }

  return { icon: '🏢', level: 'office', title: 'Présent' };
}

/** Un salarié a-t-il été en poste à un moment quelconque de [periodStart, periodEnd] (dates ISO) ?
 * Utilisé partout où l'on peut naviguer vers une période PASSÉE (export paie, tickets restaurant,
 * plannings) — filtrer sur le statut ACTUEL du salarié y ferait disparaître à tort quelqu'un parti
 * (ou pas encore arrivé) qui était pourtant bien présent durant la période affichée. */
function isEmployedDuringPeriod(employee, periodStart, periodEnd) {
  return Boolean(employee.dateEmbauche) && employee.dateEmbauche <= periodEnd &&
    (!employee.dateDepart || employee.dateDepart >= periodStart);
}

function getPlanningEmployees(periodStart, periodEnd) {
  const user = authRepository.getCurrentUser();
  // Sprint SIRH premium §5 : "Mon planning" (espace Personnel) restreint à l'utilisateur courant
  // seul, quel que soit son rôle — même principe que calendrierVue (§2).
  const visibleIds = (user.role !== ROLES.SALARIE && state.planningVue === 'personnel') ? [user.id] : getVisibleEmployeeIdsForCurrentUser();
  let employees = employeeRepository.getAll().filter(e => !e.archive && isEmployedDuringPeriod(e, periodStart, periodEnd));
  if (visibleIds !== null) employees = employees.filter(e => visibleIds.includes(e.id));
  if (state.planningFilters.service) employees = employees.filter(e => e.service === state.planningFilters.service);
  return employees;
}

function renderPlanning() {
  return `
    <div class="view-header">
      <h1>Planning</h1>
      <p class="view-subtitle">Absences (semaine, mois, année) et horaires de travail — congés et télétravail validés</p>
    </div>
    ${renderMoiEquipeToggle('planningVue', 'equipe', 'Planning équipe')}
    <div class="tabs">
      <button class="tab ${state.planningView === 'semaine' ? 'active' : ''}" data-planning-view="semaine">Semaine</button>
      <button class="tab ${state.planningView === 'mois' ? 'active' : ''}" data-planning-view="mois">Mois</button>
      <button class="tab ${state.planningView === 'annee' ? 'active' : ''}" data-planning-view="annee">Année</button>
      <button class="tab ${state.planningView === 'horaires' ? 'active' : ''}" data-planning-view="horaires">Horaires</button>
    </div>
    <div class="toolbar card">
      <select id="planning-filter-service" class="input">
        <option value="">Tous les services</option>
        ${serviceRepository.getAll().map(s => `<option value="${escapeHtml(s.nom)}" ${state.planningFilters.service === s.nom ? 'selected' : ''}>${escapeHtml(s.nom)}</option>`).join('')}
      </select>
    </div>
    <div id="planning-content">
      ${state.planningView === 'mois' ? renderPlanningMois()
        : state.planningView === 'annee' ? renderPlanningAnnee()
        : state.planningView === 'horaires' ? renderPlanningHoraires()
        : renderPlanningSemaine()}
    </div>
  `;
}

/** Sprint SIRH premium §2 : "Regrouper automatiquement les salariés par service" — le filtre
 * planning-filter-service permet toujours de se concentrer sur un seul service, mais la vue par
 * défaut ("Tous les services") doit regrouper visuellement plutôt que lister à plat. Tri
 * alphabétique par nom de service, "Sans service" en dernier. */
function groupEmployeesByService(employees) {
  const groups = {};
  employees.forEach(e => {
    const key = e.service || 'Sans service';
    (groups[key] = groups[key] || []).push(e);
  });
  return Object.keys(groups)
    .sort((a, b) => (a === 'Sans service') - (b === 'Sans service') || a.localeCompare(b))
    .map(service => ({ service, employees: groups[service] }));
}

/** Sprint SIRH premium §3 : "modification par glisser-déposer" — une case de congé/télétravail
 * VALIDÉ (jamais une case en attente, ni "Présent"/"Non travaillé"/"Repos" : rien à déplacer) devient
 * la SOURCE d'un glisser ; TOUTE case du même salarié est une cible de dépôt valide (la case cible
 * n'a pas besoin d'avoir un statut particulier — la validation métier existante, réutilisée telle
 * quelle via bindPlanningDragEvents, refuse déjà les dates invalides avec un message clair). */
function renderPlanningStatusCell(employee, dateStr, leaveRequests, teleworkRequests) {
  const status = getStatusForDate(employee, dateStr, leaveRequests, teleworkRequests);
  const draggable = (status.level === 'leave' || status.level === 'remote') && !status.pending;
  return `<td class="planning-cell planning-${status.level}${status.pending ? ' planning-pending' : ''}"
    title="${escapeHtml(status.title)}"
    data-drop-employee="${employee.id}" data-drop-date="${dateStr}"
    ${draggable ? `draggable="true" data-drag-request-id="${status.requestId}" data-drag-request-type="${status.requestType}" data-drag-employee="${employee.id}" data-drag-date="${dateStr}"` : ''}
  >${status.icon}</td>`;
}

function renderPlanningSemaine() {
  const weekDates = getWeekDates(state.planningWeekOffset);
  const employees = getPlanningEmployees(toISODate(weekDates[0]), toISODate(weekDates[6]));
  // Sprint SIRH premium §2 : les demandes en attente doivent rester visibles (semi-transparentes,
  // cf. getStatusForDate/renderPlanningStatusCell), pas totalement absentes du planning.
  const leaveRequests = leaveRepository.getAll().filter(r => r.statut === 'Validé' || r.statut === 'En attente');
  const teleworkRequests = teleworkRepository.getAll().filter(r => r.statut === 'Validé' || r.statut === 'En attente');

  return `
    <div class="view-header-row">
      <p class="view-subtitle">Semaine du ${formatDate(toISODate(weekDates[0]))} au ${formatDate(toISODate(weekDates[6]))}</p>
      <div class="calendar-nav">
        <button class="btn btn-secondary btn-sm" id="btn-planning-week-prev">← Précédente</button>
        <button class="btn btn-secondary btn-sm" id="btn-planning-week-today">Cette semaine</button>
        <button class="btn btn-secondary btn-sm" id="btn-planning-week-next">Suivante →</button>
      </div>
    </div>
    <div class="card table-card planning-scroll-card">
      ${employees.length === 0 ? `<div class="empty-state"><div class="empty-icon">🗓️</div><p>Aucun salarié à afficher.</p></div>` : `
        <table class="table planning-table">
          <thead><tr><th>Salarié</th>${weekDates.map(d => `<th>${WEEKDAY_LABELS[(d.getDay() + 6) % 7]} ${d.getDate()}</th>`).join('')}</tr></thead>
          <tbody>
            ${groupEmployeesByService(employees).map(g => `
              <tr class="planning-service-header"><td colspan="${weekDates.length + 1}">${escapeHtml(g.service)} <span class="text-muted">(${g.employees.length})</span></td></tr>
              ${g.employees.map(e => `
                <tr>
                  <td>${escapeHtml(e.prenom)} ${escapeHtml(e.nom)}</td>
                  ${weekDates.map(d => renderPlanningStatusCell(e, toISODate(d), leaveRequests, teleworkRequests)).join('')}
                </tr>
              `).join('')}
            `).join('')}
          </tbody>
        </table>
      `}
    </div>
  `;
}

function renderPlanningMois() {
  const year = state.planningYear;
  const month = state.planningMonth;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const employees = getPlanningEmployees(`${year}-${String(month + 1).padStart(2, '0')}-01`, toISODate(new Date(year, month, daysInMonth)));
  const leaveRequests = leaveRepository.getAll().filter(r => r.statut === 'Validé' || r.statut === 'En attente');
  const teleworkRequests = teleworkRepository.getAll().filter(r => r.statut === 'Validé' || r.statut === 'En attente');

  return `
    <div class="view-header-row">
      <p class="view-subtitle">${MONTH_NAMES[month]} ${year}</p>
      <div class="calendar-nav">
        <button class="btn btn-secondary btn-sm" id="btn-planning-month-prev">← Précédent</button>
        <button class="btn btn-secondary btn-sm" id="btn-planning-month-today">Ce mois-ci</button>
        <button class="btn btn-secondary btn-sm" id="btn-planning-month-next">Suivant →</button>
      </div>
    </div>
    <div class="card table-card planning-scroll-card">
      ${employees.length === 0 ? `<div class="empty-state"><div class="empty-icon">🗓️</div><p>Aucun salarié à afficher.</p></div>` : `
        <table class="table planning-table">
          <thead><tr><th>Salarié</th>${Array.from({ length: daysInMonth }, (_, i) => `<th>${i + 1}</th>`).join('')}</tr></thead>
          <tbody>
            ${groupEmployeesByService(employees).map(g => `
              <tr class="planning-service-header"><td colspan="${daysInMonth + 1}">${escapeHtml(g.service)} <span class="text-muted">(${g.employees.length})</span></td></tr>
              ${g.employees.map(e => `
                <tr>
                  <td>${escapeHtml(e.prenom)} ${escapeHtml(e.nom)}</td>
                  ${Array.from({ length: daysInMonth }, (_, i) => renderPlanningStatusCell(e, toISODate(new Date(year, month, i + 1)), leaveRequests, teleworkRequests)).join('')}
                </tr>
              `).join('')}
            `).join('')}
          </tbody>
        </table>
      `}
    </div>
  `;
}

/** Vue année : nombre de jours de congé validés par mois (le détail jour par jour n'a pas de sens sur 365 colonnes). */
function renderPlanningAnnee() {
  const year = state.planningYear;
  const employees = getPlanningEmployees(`${year}-01-01`, `${year}-12-31`);
  const leaveRequests = leaveRepository.getAll().filter(r => r.statut === 'Validé');
  const settings = settingsRepository.getSettings();

  return `
    <div class="view-header-row">
      <p class="view-subtitle">Jours de congé validés par mois — ${year}</p>
      <div class="calendar-nav">
        <button class="btn btn-secondary btn-sm" id="btn-planning-year-prev">← ${year - 1}</button>
        <button class="btn btn-secondary btn-sm" id="btn-planning-year-next">${year + 1} →</button>
      </div>
    </div>
    <div class="card table-card planning-scroll-card">
      ${employees.length === 0 ? `<div class="empty-state"><div class="empty-icon">🗓️</div><p>Aucun salarié à afficher.</p></div>` : `
        <table class="table planning-table">
          <thead><tr><th>Salarié</th>${MONTH_NAMES.map(m => `<th>${m.slice(0, 3)}</th>`).join('')}<th>Total</th></tr></thead>
          <tbody>
            ${employees.map(e => {
              const monthCounts = MONTH_NAMES.map((_, monthIndex) =>
                leaveRequests
                  .filter(r => r.employeeId === e.id)
                  .reduce((sum, r) => sum + countRequestDaysInMonth(r.dateDebut, r.dateFin, r.demiJournee, year, monthIndex, e, settings), 0)
              );
              const total = monthCounts.reduce((a, b) => a + b, 0);
              return `
                <tr>
                  <td>${escapeHtml(e.prenom)} ${escapeHtml(e.nom)}</td>
                  ${monthCounts.map(c => `<td>${c || ''}</td>`).join('')}
                  <td><strong>${total}</strong></td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `}
    </div>
  `;
}

/** Sprint SIRH premium §3 : différence en heures entre deux horaires "HH:MM". */
function timeRangeToHours(debut, fin) {
  if (!debut || !fin) return 0;
  const [dh, dm] = debut.split(':').map(Number);
  const [fh, fm] = fin.split(':').map(Number);
  return Math.max(0, (fh * 60 + fm - (dh * 60 + dm)) / 60);
}

/** Heures planifiées d'un salarié pour une date donnée : 0 si jour non travaillé ou congé validé,
 * sinon somme des horaires matin+après-midi (identiques chaque jour travaillé, cf.
 * employee.horaireMatinDebut etc.) — le télétravail reste travaillé (mêmes horaires), juste signalé
 * différemment à l'affichage. */
function computeDailyHours(employee, dateStr, leaveRequests, teleworkRequests) {
  const weekday = WEEKDAY_LABELS[(parseISODateLocal(dateStr).getDay() + 6) % 7];
  if (!(employee.joursTravailles || []).includes(weekday)) return { heures: 0, label: '—', level: 'off' };

  const leaveToday = leaveRequests.find(r => r.employeeId === employee.id && dateStr >= r.dateDebut && dateStr <= r.dateFin);
  // Une demi-journée (matin OU après-midi, sur une date isolée) ne doit faire disparaître que la
  // moitié concernée des heures, pas la journée entière.
  const isHalfDayLeave = Boolean(leaveToday && leaveToday.demiJournee && leaveToday.dateDebut === leaveToday.dateFin);
  if (leaveToday && !isHalfDayLeave) return { heures: 0, label: '🏖️', level: 'leave' };

  const matinHeures = timeRangeToHours(employee.horaireMatinDebut, employee.horaireMatinFin);
  const apremHeures = timeRangeToHours(employee.horaireApresMidiDebut, employee.horaireApresMidiFin);
  const heures = round2(isHalfDayLeave
    ? (leaveToday.demiJournee === 'matin' ? apremHeures : matinHeures)
    : matinHeures + apremHeures);
  const onTelework = teleworkRequests.some(r => r.employeeId === employee.id && dateStr >= r.dateDebut && dateStr <= r.dateFin);
  const label = `${formatNumberFR(heures)} h${isHalfDayLeave ? ' 🏖️' : ''}${onTelework ? ' 💻' : ''}`;
  return { heures, label, level: isHalfDayLeave ? 'leave' : (onTelework ? 'remote' : 'office') };
}

/** Sprint SIRH premium §3 : "Créer trois vues : Jour / Semaine / Mois" pour le planning d'horaires
 * — sous-onglets propres au planning Horaires (indépendants des onglets Semaine/Mois/Année du
 * planning d'absences, qui restent inchangés). */
function renderPlanningHoraires() {
  return `
    <div class="tabs" style="margin-bottom: 12px;">
      <button class="tab ${state.horairesView === 'jour' ? 'active' : ''}" data-horaires-view="jour">Jour</button>
      <button class="tab ${state.horairesView === 'mois' ? 'active' : ''}" data-horaires-view="mois">Mois</button>
      <button class="tab ${state.horairesView !== 'jour' && state.horairesView !== 'mois' ? 'active' : ''}" data-horaires-view="semaine">Semaine</button>
    </div>
    ${state.horairesView === 'jour' ? renderHorairesJour() : state.horairesView === 'mois' ? renderHorairesMois() : renderHorairesSemaine()}
  `;
}

function renderHorairesSemaine() {
  const weekDates = getWeekDates(state.planningWeekOffset);
  const employees = getPlanningEmployees(toISODate(weekDates[0]), toISODate(weekDates[6]));
  const leaveRequests = leaveRepository.getAll().filter(r => r.statut === 'Validé');
  const teleworkRequests = teleworkRepository.getAll().filter(r => r.statut === 'Validé');
  const groups = groupEmployeesByService(employees);
  const totalSemaine = (e) => weekDates.reduce((sum, d) => sum + computeDailyHours(e, toISODate(d), leaveRequests, teleworkRequests).heures, 0);

  return `
    <div class="view-header-row">
      <p class="view-subtitle">Semaine du ${formatDate(toISODate(weekDates[0]))} au ${formatDate(toISODate(weekDates[6]))} — total automatique des heures</p>
      <div class="calendar-nav">
        <button class="btn btn-secondary btn-sm" id="btn-planning-week-prev">← Précédente</button>
        <button class="btn btn-secondary btn-sm" id="btn-planning-week-today">Cette semaine</button>
        <button class="btn btn-secondary btn-sm" id="btn-planning-week-next">Suivante →</button>
      </div>
    </div>
    <div class="card table-card planning-scroll-card">
      ${employees.length === 0 ? `<div class="empty-state"><div class="empty-icon">🗓️</div><p>Aucun salarié à afficher.</p></div>` : `
        <table class="table planning-table">
          <thead><tr><th>Salarié</th>${weekDates.map(d => `<th>${WEEKDAY_LABELS[(d.getDay() + 6) % 7]} ${d.getDate()}</th>`).join('')}<th>Total</th></tr></thead>
          <tbody>
            ${groups.map(g => {
              const serviceTotal = g.employees.reduce((sum, e) => sum + totalSemaine(e), 0);
              return `
                <tr class="planning-service-header"><td colspan="${weekDates.length + 2}">${escapeHtml(g.service)} <span class="text-muted">(${g.employees.length})</span></td></tr>
                ${g.employees.map(e => `
                  <tr>
                    <td>${escapeHtml(e.prenom)} ${escapeHtml(e.nom)} <button type="button" class="btn-link" data-edit-horaires="${e.id}" title="Modifier les horaires">✎</button></td>
                    ${weekDates.map(d => {
                      const info = computeDailyHours(e, toISODate(d), leaveRequests, teleworkRequests);
                      return `<td class="planning-cell planning-${info.level}">${info.label}</td>`;
                    }).join('')}
                    <td><strong>${formatNumberFR(totalSemaine(e))} h</strong></td>
                  </tr>
                `).join('')}
                <tr class="planning-summary-row">
                  <td>Total ${escapeHtml(g.service)}</td>
                  ${weekDates.map(d => `<td>${formatNumberFR(g.employees.reduce((sum, e) => sum + computeDailyHours(e, toISODate(d), leaveRequests, teleworkRequests).heures, 0))} h</td>`).join('')}
                  <td><strong>${formatNumberFR(serviceTotal)} h</strong></td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `}
    </div>
  `;
}

/** Vue Jour : le détail heure par heure (matin/après-midi) n'a de sens que sur UNE seule date à la
 * fois — la vue Semaine ne montre qu'un total agrégé par jour, celle-ci montre les vraies plages
 * horaires. */
function renderHorairesJour() {
  const dateStr = state.horairesDay;
  const date = parseISODateLocal(dateStr);
  const weekday = WEEKDAY_LABELS[(date.getDay() + 6) % 7];
  const employees = getPlanningEmployees(dateStr, dateStr);
  const leaveRequests = leaveRepository.getAll().filter(r => r.statut === 'Validé');
  const teleworkRequests = teleworkRepository.getAll().filter(r => r.statut === 'Validé');
  const groups = groupEmployeesByService(employees);

  return `
    <div class="view-header-row">
      <p class="view-subtitle">${formatDate(dateStr)}</p>
      <div class="calendar-nav">
        <button class="btn btn-secondary btn-sm" id="btn-horaires-day-prev">← Précédent</button>
        <button class="btn btn-secondary btn-sm" id="btn-horaires-day-today">Aujourd'hui</button>
        <button class="btn btn-secondary btn-sm" id="btn-horaires-day-next">Suivant →</button>
      </div>
    </div>
    <div class="card table-card planning-scroll-card">
      ${employees.length === 0 ? `<div class="empty-state"><div class="empty-icon">🗓️</div><p>Aucun salarié à afficher.</p></div>` : `
        <table class="table planning-table">
          <thead><tr><th>Salarié</th><th>Matin</th><th>Après-midi</th><th>Total</th></tr></thead>
          <tbody>
            ${groups.map(g => `
              <tr class="planning-service-header"><td colspan="4">${escapeHtml(g.service)} <span class="text-muted">(${g.employees.length})</span></td></tr>
              ${g.employees.map(e => {
                const travaille = (e.joursTravailles || []).includes(weekday);
                if (!travaille) return `<tr><td>${escapeHtml(e.prenom)} ${escapeHtml(e.nom)}</td><td colspan="3" class="text-muted">Non travaillé</td></tr>`;
                const info = computeDailyHours(e, dateStr, leaveRequests, teleworkRequests);
                if (info.level === 'leave') return `<tr><td>${escapeHtml(e.prenom)} ${escapeHtml(e.nom)}</td><td colspan="3">🏖️ Congé</td></tr>`;
                return `
                  <tr>
                    <td>${escapeHtml(e.prenom)} ${escapeHtml(e.nom)}${info.level === 'remote' ? ' 💻' : ''} <button type="button" class="btn-link" data-edit-horaires="${e.id}" title="Modifier les horaires">✎</button></td>
                    <td>${escapeHtml(e.horaireMatinDebut || '—')} – ${escapeHtml(e.horaireMatinFin || '—')}</td>
                    <td>${escapeHtml(e.horaireApresMidiDebut || '—')} – ${escapeHtml(e.horaireApresMidiFin || '—')}</td>
                    <td><strong>${formatNumberFR(info.heures)} h</strong></td>
                  </tr>
                `;
              }).join('')}
            `).join('')}
          </tbody>
        </table>
      `}
    </div>
  `;
}

/** Vue Mois : même principe que le planning d'absences Mois, mais les cellules montrent des heures
 * (ou l'icône congé/non-travaillé) plutôt qu'un statut, avec un total mensuel par salarié. */
function renderHorairesMois() {
  const year = state.planningYear;
  const month = state.planningMonth;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const employees = getPlanningEmployees(`${year}-${String(month + 1).padStart(2, '0')}-01`, toISODate(new Date(year, month, daysInMonth)));
  const leaveRequests = leaveRepository.getAll().filter(r => r.statut === 'Validé');
  const teleworkRequests = teleworkRepository.getAll().filter(r => r.statut === 'Validé');
  const groups = groupEmployeesByService(employees);
  const totalMois = (e) => Array.from({ length: daysInMonth }, (_, i) =>
    computeDailyHours(e, toISODate(new Date(year, month, i + 1)), leaveRequests, teleworkRequests).heures).reduce((a, b) => a + b, 0);

  return `
    <div class="view-header-row">
      <p class="view-subtitle">${MONTH_NAMES[month]} ${year} — total automatique des heures</p>
      <div class="calendar-nav">
        <button class="btn btn-secondary btn-sm" id="btn-planning-month-prev">← Précédent</button>
        <button class="btn btn-secondary btn-sm" id="btn-planning-month-today">Ce mois-ci</button>
        <button class="btn btn-secondary btn-sm" id="btn-planning-month-next">Suivant →</button>
      </div>
    </div>
    <div class="card table-card planning-scroll-card">
      ${employees.length === 0 ? `<div class="empty-state"><div class="empty-icon">🗓️</div><p>Aucun salarié à afficher.</p></div>` : `
        <table class="table planning-table">
          <thead><tr><th>Salarié</th>${Array.from({ length: daysInMonth }, (_, i) => `<th>${i + 1}</th>`).join('')}<th>Total</th></tr></thead>
          <tbody>
            ${groups.map(g => `
              <tr class="planning-service-header"><td colspan="${daysInMonth + 2}">${escapeHtml(g.service)} <span class="text-muted">(${g.employees.length})</span></td></tr>
              ${g.employees.map(e => `
                <tr>
                  <td>${escapeHtml(e.prenom)} ${escapeHtml(e.nom)} <button type="button" class="btn-link" data-edit-horaires="${e.id}" title="Modifier les horaires">✎</button></td>
                  ${Array.from({ length: daysInMonth }, (_, i) => {
                    const info = computeDailyHours(e, toISODate(new Date(year, month, i + 1)), leaveRequests, teleworkRequests);
                    return `<td class="planning-cell planning-${info.level}" style="font-size:11px;">${info.level === 'off' ? '—' : info.level === 'leave' ? '🏖️' : formatNumberFR(info.heures)}</td>`;
                  }).join('')}
                  <td><strong>${formatNumberFR(totalMois(e))} h</strong></td>
                </tr>
              `).join('')}
            `).join('')}
          </tbody>
        </table>
      `}
    </div>
  `;
}

function openHorairesModal(employeeId) {
  const employee = employeeRepository.getById(employeeId);
  if (!employee) { showToast('Ce salarié n\'est plus disponible.', 'error'); return; }
  const html = `
    <div class="modal modal-small">
      <div class="modal-header">
        <h2>Horaires — ${escapeHtml(employee.prenom)} ${escapeHtml(employee.nom)}</h2>
        <button class="btn-icon" id="btn-close-modal" aria-label="Fermer" title="Fermer">✕</button>
      </div>
      <form id="horaires-form">
        <div class="modal-body">
          <div class="form-grid">
            ${textField('horaireMatinDebut', 'Matin — début', employee.horaireMatinDebut || '09:00', true, 'time')}
            ${textField('horaireMatinFin', 'Matin — fin', employee.horaireMatinFin || '12:00', true, 'time')}
            ${textField('horaireApresMidiDebut', 'Après-midi — début', employee.horaireApresMidiDebut || '13:00', true, 'time')}
            ${textField('horaireApresMidiFin', 'Après-midi — fin', employee.horaireApresMidiFin || '17:00', true, 'time')}
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Annuler</button>
          <button type="submit" class="btn btn-primary">Enregistrer</button>
        </div>
      </form>
    </div>
  `;

  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = html;
  modalRoot.classList.add('open');

  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
  document.getElementById('horaires-form').addEventListener('submit', (evt) => {
    evt.preventDefault();
    const patch = {
      horaireMatinDebut: document.getElementById('f-horaireMatinDebut').value,
      horaireMatinFin: document.getElementById('f-horaireMatinFin').value,
      horaireApresMidiDebut: document.getElementById('f-horaireApresMidiDebut').value,
      horaireApresMidiFin: document.getElementById('f-horaireApresMidiFin').value
    };
    if (timeRangeToHours(patch.horaireMatinDebut, patch.horaireMatinFin) <= 0 && timeRangeToHours(patch.horaireApresMidiDebut, patch.horaireApresMidiFin) <= 0) {
      showToast('Les horaires doivent représenter au moins une plage valide.', 'error');
      return;
    }
    employeeRepository.update(employeeId, patch);
    auditLogRepository.logAudit('Modification', 'Horaires', `${employee.prenom} ${employee.nom}`);
    showToast('Horaires mis à jour.');
    closeModal();
    render();
  });
}

function bindPlanningEvents() {
  document.querySelectorAll('[data-planning-view]').forEach(btn => {
    btn.addEventListener('click', () => { state.planningView = btn.dataset.planningView; render(); });
  });
  bindMoiEquipeToggleEvents();

  document.getElementById('planning-filter-service').addEventListener('change', (e) => {
    state.planningFilters.service = e.target.value;
    render();
  });

  const horairesSemaineActive = state.planningView === 'horaires' && state.horairesView !== 'jour' && state.horairesView !== 'mois';
  if (state.planningView === 'semaine' || horairesSemaineActive) {
    document.getElementById('btn-planning-week-prev').addEventListener('click', () => { state.planningWeekOffset -= 1; render(); });
    document.getElementById('btn-planning-week-next').addEventListener('click', () => { state.planningWeekOffset += 1; render(); });
    document.getElementById('btn-planning-week-today').addEventListener('click', () => { state.planningWeekOffset = 0; render(); });
  }
  if (state.planningView === 'horaires') {
    document.querySelectorAll('[data-horaires-view]').forEach(btn => {
      btn.addEventListener('click', () => { state.horairesView = btn.dataset.horairesView; render(); });
    });
    document.querySelectorAll('[data-edit-horaires]').forEach(btn => {
      btn.addEventListener('click', () => openHorairesModal(btn.dataset.editHoraires));
    });
    if (state.horairesView === 'jour') {
      document.getElementById('btn-horaires-day-prev').addEventListener('click', () => { state.horairesDay = toISODate(addDays(new Date(state.horairesDay), -1)); render(); });
      document.getElementById('btn-horaires-day-next').addEventListener('click', () => { state.horairesDay = toISODate(addDays(new Date(state.horairesDay), 1)); render(); });
      document.getElementById('btn-horaires-day-today').addEventListener('click', () => { state.horairesDay = toISODate(new Date()); render(); });
    }
    if (state.horairesView === 'mois') {
      document.getElementById('btn-planning-month-prev').addEventListener('click', () => { shiftPlanningMonth(-1); });
      document.getElementById('btn-planning-month-next').addEventListener('click', () => { shiftPlanningMonth(1); });
      document.getElementById('btn-planning-month-today').addEventListener('click', () => {
        const now = new Date();
        state.planningYear = now.getFullYear();
        state.planningMonth = now.getMonth();
        render();
      });
    }
  }
  if (state.planningView === 'mois') {
    document.getElementById('btn-planning-month-prev').addEventListener('click', () => { shiftPlanningMonth(-1); });
    document.getElementById('btn-planning-month-next').addEventListener('click', () => { shiftPlanningMonth(1); });
    document.getElementById('btn-planning-month-today').addEventListener('click', () => {
      const now = new Date();
      state.planningYear = now.getFullYear();
      state.planningMonth = now.getMonth();
      render();
    });
  } else if (state.planningView === 'annee') {
    document.getElementById('btn-planning-year-prev').addEventListener('click', () => { state.planningYear -= 1; render(); });
    document.getElementById('btn-planning-year-next').addEventListener('click', () => { state.planningYear += 1; render(); });
  }

  // Sprint SIRH premium §3 : "modification par glisser-déposer" — uniquement les vues Semaine/Mois
  // (celles qui affichent une case par jour via renderPlanningStatusCell) ; Année/Horaires n'ont pas
  // de case "un salarié, un jour" de ce type.
  if (state.planningView === 'semaine' || state.planningView === 'mois') bindPlanningDragEvents();
}

/** Sprint SIRH premium §3 : glisser une case de congé/télétravail VALIDÉ (renderPlanningStatusCell
 * ne rend draggable que celles-là) vers une autre case du MÊME salarié déplace toute la période
 * (en conservant sa durée) de "delta" jours, où delta = date cible - date de la case source. Réutilise
 * leaveRepository.regulariser (déjà validé/testé, §régularisation) pour les congés et
 * moveTeleworkRequest (même niveau de validation, écrit pour cette fonctionnalité) pour le
 * télétravail — aucune nouvelle règle métier inventée, juste un nouveau point d'entrée vers les
 * règles existantes. */
function bindPlanningDragEvents() {
  let dragData = null;

  document.querySelectorAll('.planning-cell[data-drag-request-id]').forEach(cell => {
    cell.addEventListener('dragstart', (e) => {
      dragData = {
        requestId: cell.dataset.dragRequestId,
        requestType: cell.dataset.dragRequestType,
        employeeId: cell.dataset.dragEmployee,
        dateStr: cell.dataset.dragDate
      };
      e.dataTransfer.effectAllowed = 'move';
      cell.classList.add('planning-cell-dragging');
    });
    cell.addEventListener('dragend', () => cell.classList.remove('planning-cell-dragging'));
  });

  document.querySelectorAll('.planning-cell[data-drop-employee]').forEach(cell => {
    cell.addEventListener('dragover', (e) => {
      if (!dragData || cell.dataset.dropEmployee !== dragData.employeeId) return;
      e.preventDefault();
      cell.classList.add('planning-cell-drop-target');
    });
    cell.addEventListener('dragleave', () => cell.classList.remove('planning-cell-drop-target'));
    cell.addEventListener('drop', (e) => {
      e.preventDefault();
      cell.classList.remove('planning-cell-drop-target');
      if (!dragData || cell.dataset.dropEmployee !== dragData.employeeId) return;
      const targetDate = cell.dataset.dropDate;
      if (targetDate === dragData.dateStr) return;
      handlePlanningDrop(dragData, targetDate);
      dragData = null;
    });
  });
}

function handlePlanningDrop(dragData, targetDate) {
  // parseISODateLocal (pas `new Date(string)`, qui parse en UTC alors que getDate()/setDate()
  // lisent/écrivent en heure locale — décalage d'un jour possible selon le fuseau) : voir data.js.
  const deltaJours = daysBetween(parseISODateLocal(dragData.dateStr), parseISODateLocal(targetDate));

  if (dragData.requestType === 'leave') {
    const request = leaveRepository.getById(dragData.requestId);
    if (!request) return;
    // Même règle que le bouton "Régulariser" (canManageRequestFor exclut déjà le demandeur
    // lui-même) — sans ce contrôle, glisser-déposer sur "Mon planning" laissait n'importe qui
    // déplacer sa PROPRE demande déjà validée, contournant la séparation des tâches.
    if (!canManageRequestFor(request.employeeId)) { showToast('Action non autorisée.', 'error'); return; }
    const nouvelleDateDebut = toISODate(addDays(parseISODateLocal(request.dateDebut), deltaJours));
    const nouvelleDateFin = toISODate(addDays(parseISODateLocal(request.dateFin), deltaJours));
    const result = leaveRepository.regulariser(dragData.requestId, {
      typeId: request.typeId, dateDebut: nouvelleDateDebut, dateFin: nouvelleDateFin,
      demiJournee: request.demiJournee, motif: 'Déplacé par glisser-déposer (Planning)'
    });
    if (!result.success) { showToast(result.error, 'error'); return; }
    showToast('Demande déplacée.');
    render();
  } else if (dragData.requestType === 'telework') {
    const request = teleworkRepository.getById(dragData.requestId);
    if (!request) return;
    if (!canManageRequestFor(request.employeeId)) { showToast('Action non autorisée.', 'error'); return; }
    const nouvelleDateDebut = toISODate(addDays(parseISODateLocal(request.dateDebut), deltaJours));
    const nouvelleDateFin = toISODate(addDays(parseISODateLocal(request.dateFin), deltaJours));
    const result = moveTeleworkRequest(dragData.requestId, nouvelleDateDebut, nouvelleDateFin);
    if (!result.success) { showToast(result.error, 'error'); return; }
    showToast('Télétravail déplacé.');
    render();
  }
}

function shiftPlanningMonth(delta) {
  let month = state.planningMonth + delta;
  let year = state.planningYear;
  if (month < 0) { month = 11; year -= 1; }
  if (month > 11) { month = 0; year += 1; }
  state.planningMonth = month;
  state.planningYear = year;
  render();
}

// ---------------------------------------------------------------------------
// Vue : Télétravail (demandes + planning)
// ---------------------------------------------------------------------------

// ---- Sous-vue : Demandes ----

function getFilteredTeleworkRequests() {
  let list = teleworkRepository.getAll();
  const visibleIds = getVisibleEmployeeIdsForCurrentUser();
  if (visibleIds !== null) list = list.filter(r => visibleIds.includes(r.employeeId));
  if (state.teletravailFilters.employeeId) list = list.filter(r => r.employeeId === state.teletravailFilters.employeeId);
  if (state.teletravailFilters.statut) list = list.filter(r => r.statut === state.teletravailFilters.statut);
  return list;
}

function renderTeletravailDemandes() {
  const employees = getScopedEmployeesForFilters();
  const requests = getFilteredTeleworkRequests();
  const { pageItems, totalPages, page, pageStart } = paginate(requests, 'teletravailPage');

  return `
    <div class="view-header-row">
      <p class="view-subtitle">${requests.length} demande${requests.length > 1 ? 's' : ''}</p>
      <button class="btn btn-primary" id="btn-new-telework-request">+ Nouvelle demande</button>
    </div>

    ${renderDraftsCard('teletravail')}

    <div class="toolbar card">
      <select id="tt-filter-employee" class="input">
        <option value="">Tous les salariés</option>
        ${employees.map(e => `<option value="${e.id}" ${state.teletravailFilters.employeeId === e.id ? 'selected' : ''}>${escapeHtml(e.prenom)} ${escapeHtml(e.nom)}</option>`).join('')}
      </select>
      <select id="tt-filter-statut" class="input">
        <option value="">Tous les statuts</option>
        ${['En attente', 'Validé', 'Refusé', 'Annulé'].map(s => `<option value="${s}" ${state.teletravailFilters.statut === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
    </div>

    <div class="card table-card">
      ${requests.length === 0 ? `<div class="empty-state"><div class="empty-icon">💻</div><p>Aucune demande de télétravail.</p></div>` : `
        <table class="table">
          <thead><tr><th>Salarié</th><th>Période</th><th>Jours</th><th>Statut</th><th></th></tr></thead>
          <tbody>${pageItems.map(renderTeleworkRequestRow).join('')}</tbody>
        </table>
        ${renderPaginationControls(page, totalPages, pageStart, pageItems.length, requests.length)}
      `}
    </div>
  `;
}

function renderTeleworkRequestRow(r) {
  const employee = employeeRepository.getById(r.employeeId);
  if (!employee) return '';

  const periode = r.dateDebut === r.dateFin ? formatDate(r.dateDebut) : `${formatDate(r.dateDebut)} → ${formatDate(r.dateFin)}`;
  const actions = r.statut === 'En attente'
    ? `${canActOnRequestFor(r) ? `<button class="btn-link" data-approve-tt="${r.id}">Valider</button>` : ''}${canRefuserRequestFor(r) ? `<button class="btn-link btn-link-danger" data-refuse-tt="${r.id}">Refuser</button>` : ''}`
    : r.statut === 'Validé' && canManageRequestFor(r.employeeId) ? `<button class="btn-link btn-link-danger" data-cancel-tt="${r.id}">Annuler</button>` : '';

  return `
    <tr>
      <td>${escapeHtml(employee.prenom)} ${escapeHtml(employee.nom)}</td>
      <td>${periode}</td>
      <td>${formatDurationFR(r.nbJours)}</td>
      <td>${renderRequestStatutBadge(r)}</td>
      <td class="table-actions">
        <button class="btn-link" data-history="${r.id}">Historique</button>
        ${actions}
      </td>
    </tr>
  `;
}

function bindTeletravailDemandesEvents() {
  document.getElementById('btn-new-telework-request').addEventListener('click', () => openTeleworkRequestModal());
  bindDraftsCardEvents((draft) => openTeleworkRequestModal(undefined, draft));

  document.getElementById('tt-filter-employee').addEventListener('change', (e) => {
    state.teletravailFilters.employeeId = e.target.value;
    state.teletravailPage = 1;
    render();
  });
  document.getElementById('tt-filter-statut').addEventListener('change', (e) => {
    state.teletravailFilters.statut = e.target.value;
    state.teletravailPage = 1;
    render();
  });

  const ttPrevBtn = document.getElementById('btn-page-prev');
  if (ttPrevBtn) ttPrevBtn.addEventListener('click', () => { state.teletravailPage -= 1; render(); });
  const ttNextBtn = document.getElementById('btn-page-next');
  if (ttNextBtn) ttNextBtn.addEventListener('click', () => { state.teletravailPage += 1; render(); });

  document.querySelectorAll('[data-approve-tt]').forEach(btn => btn.addEventListener('click', () => handleApproveTelework(btn.dataset.approveTt)));
  document.querySelectorAll('[data-refuse-tt]').forEach(btn => btn.addEventListener('click', () => handleRefuseTelework(btn.dataset.refuseTt)));
  document.querySelectorAll('[data-cancel-tt]').forEach(btn => btn.addEventListener('click', () => handleCancelTelework(btn.dataset.cancelTt)));
  bindHistoryButtons(teleworkRepository);
}

function handleApproveTelework(id) {
  const request = teleworkRepository.getById(id);
  if (!request || !canActOnRequestFor(request)) { showToast('Action non autorisée.', 'error'); return; }
  teleworkRepository.update(id, advanceWorkflow(request, 'Validé'));
  auditLogRepository.logAudit('Validation', 'Demande de télétravail', auditLabelForEmployee(request.employeeId));
  showToast('Télétravail validé.');
  render();
}

function handleRefuseTelework(id) {
  const request = teleworkRepository.getById(id);
  if (!request || !canRefuserRequestFor(request)) { showToast('Action non autorisée.', 'error'); return; }
  openConfirm({
    title: 'Refuser cette demande ?',
    message: 'Le salarié sera informé du refus.',
    confirmLabel: 'Refuser',
    danger: true,
    onConfirm: () => {
      teleworkRepository.update(id, refuseRequest(request));
      auditLogRepository.logAudit('Refus', 'Demande de télétravail', auditLabelForEmployee(request.employeeId));
      showToast('Demande refusée.');
      render();
    }
  });
}

function handleCancelTelework(id) {
  const request = teleworkRepository.getById(id);
  if (!request || !canManageRequestFor(request.employeeId)) { showToast('Action non autorisée.', 'error'); return; }
  openConfirm({
    title: 'Annuler ce télétravail ?',
    message: 'Ce jour redeviendra un jour de présence au bureau.',
    confirmLabel: 'Annuler',
    danger: true,
    onConfirm: () => {
      teleworkRepository.update(id, cancelRequest(request));
      auditLogRepository.logAudit('Annulation', 'Demande de télétravail', auditLabelForEmployee(request.employeeId));
      showToast('Demande annulée.');
      render();
    }
  });
}

// ---- Modale : Nouvelle demande de télétravail ----

/** presetDate : préremplit début ET fin (choix rapide "Télétravail" depuis une case du calendrier,
 * §sprint refonte UX) — ignoré si un brouillon fournit déjà ses propres dates. Contrairement aux
 * congés/absences, une demande de télétravail n'a pas de notion de demi-journée dans ce modèle
 * (champ absent de makeEmptyTeleworkRequest) — pas ajouté ici pour ne pas étendre le modèle de
 * données au-delà de ce qui est demandé. */
function openTeleworkRequestModal(presetEmployeeId, draft, presetDate) {
  const employees = employeeRepository.getAll().filter(e => !e.archive);
  const champs = (draft && draft.champs) || {};
  if (!draft && presetDate) {
    champs.dateDebut = presetDate;
    champs.dateFin = presetDate;
  }
  beginDraftEdit(draft);

  const html = `
    <div class="modal">
      <div class="modal-header">
        <h2>Nouvelle demande de télétravail</h2>
        <button class="btn-icon" id="btn-close-modal" aria-label="Fermer" title="Fermer">✕</button>
      </div>
      <form id="telework-request-form">
        <div class="modal-body">
          <div class="form-grid">
            ${employeeFieldForRequest(presetEmployeeId || champs.employeeId, employees)}
            ${textField('dateDebut', 'Date de début', champs.dateDebut || '', true, 'date')}
            ${textField('dateFin', 'Date de fin', champs.dateFin || '', true, 'date')}
          </div>
          <div class="form-field" style="margin-top: 14px;">
            <label for="f-commentaire">Commentaire</label>
            <textarea class="input" id="f-commentaire" name="commentaire" rows="2">${escapeHtml(champs.commentaire || '')}</textarea>
          </div>
          <p class="text-muted" id="telework-quota-hint" style="margin-top: 12px;"></p>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Annuler</button>
          <button type="button" class="btn btn-secondary" id="btn-save-draft">Enregistrer comme brouillon</button>
          <button type="submit" class="btn btn-primary">Envoyer la demande</button>
        </div>
      </form>
    </div>
  `;

  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = html;
  modalRoot.classList.add('open');

  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
  document.getElementById('telework-request-form').addEventListener('submit', submitTeleworkRequestForm);
  document.getElementById('btn-save-draft').addEventListener('click', () => {
    saveDraftFromForm(document.getElementById('telework-request-form'), 'teletravail');
  });

  ['f-employeeId', 'f-dateDebut', 'f-dateFin'].forEach(fieldId => {
    document.getElementById(fieldId).addEventListener('change', updateTeleworkQuotaHint);
  });
  updateTeleworkQuotaHint();
}

function updateTeleworkQuotaHint() {
  const employeeId = document.getElementById('f-employeeId').value;
  const dateDebut = document.getElementById('f-dateDebut').value;
  const dateFin = document.getElementById('f-dateFin').value;
  const hint = document.getElementById('telework-quota-hint');
  if (!employeeId || !dateDebut) { hint.textContent = ''; return; }

  const employee = employeeRepository.getById(employeeId);
  const quota = settingsRepository.getSettings().teletravailQuotaSemaine;
  const weekDates = getWeekDatesContaining(dateDebut);
  const weekStart = toISODate(weekDates[0]);
  const weekEnd = toISODate(weekDates[6]);

  const activeRequests = teleworkRepository.getAll().filter(r => r.employeeId === employeeId && (r.statut === 'Validé' || r.statut === 'En attente'));
  let usedThisWeek = 0;
  activeRequests.forEach(r => {
    for (let cursor = new Date(r.dateDebut); toISODate(cursor) <= r.dateFin; cursor.setDate(cursor.getDate() + 1)) {
      const ds = toISODate(cursor);
      if (ds >= weekStart && ds <= weekEnd) usedThisWeek += 1;
    }
  });

  let nbJoursLabel = '';
  if (dateFin) {
    const nbJours = computeWorkingDays(dateDebut, dateFin, false, employee, settingsRepository.getSettings());
    nbJoursLabel = ` · ${formatDurationFR(nbJours)} décomptés pour cette demande`;
  }

  hint.textContent = `Quota hebdomadaire : ${formatDurationFR(quota)}/semaine · déjà ${formatDurationFR(usedThisWeek)} utilisés cette semaine${nbJoursLabel}`;
}

/** Chevauchement actif (statut Validé ou En attente, comme le contrôle autoriserPlusieursDemandes)
 * entre [dateDebut, dateFin] et une demande existante d'un AUTRE domaine (congé/absence <-> télétravail)
 * pour le même salarié — on ne peut pas être à la fois en congé/absence et en télétravail le même jour.
 * Le télétravail n'a pas de notion de demi-journée : la présence d'un congé ce jour-là, même en
 * demi-journée, suffit à bloquer un télétravail (forcément journée entière) sur cette même date, et
 * réciproquement. Utilisé par submitLeaveRequestForm et submitTeleworkRequestForm. */
function hasActiveRequestOverlap(requests, employeeId, dateDebut, dateFin, excludeRequestId) {
  return requests.some(r =>
    r.id !== excludeRequestId && r.employeeId === employeeId && r.statut !== 'Refusé' && r.statut !== 'Annulé' &&
    r.dateDebut <= dateFin && r.dateFin >= dateDebut);
}

/** Chevauchement entre DEUX congés/absences de TYPES DIFFÉRENTS pour le même salarié — distinct du
 * contrôle autoriserPlusieursDemandes (qui ne compare que les demandes du MÊME type, et dont le
 * réglage par type doit rester seul maître sur ce cas : exclu ici via `typeId !== r.typeId`, sinon
 * on écraserait un autoriserPlusieursDemandes=true explicitement configuré par l'admin). On ne peut
 * pas être à la fois en RTT et en congés payés le même jour, sauf sur des demi-journées
 * complémentaires (matin + après-midi) d'une même date isolée — cas réel qu'un blocage brut
 * casserait. Toute demande qui s'étend sur plusieurs jours, ou une demi-journée qui chevauche une
 * journée entière, reste un conflit direct. */
function hasConflictingLeaveRequest(employeeId, typeId, dateDebut, dateFin, demiJournee, excludeRequestId) {
  return leaveRepository.getAll().some(r => {
    if (r.id === excludeRequestId) return false;
    if (r.employeeId !== employeeId) return false;
    if (r.typeId === typeId) return false;
    if (r.statut === 'Refusé' || r.statut === 'Annulé') return false;
    if (!(r.dateDebut <= dateFin && r.dateFin >= dateDebut)) return false;
    const bothSingleDay = r.dateDebut === r.dateFin && dateDebut === dateFin;
    if (!bothSingleDay) return true;
    if (!demiJournee || !r.demiJournee) return true;
    return demiJournee === r.demiJournee;
  });
}

/** Semaine (lundi ISO) où la demande [dateDebut, dateFin] ferait dépasser le quota hebdomadaire, en tenant
 * compte des demandes déjà actives (Validé/En attente) ; ne compte que les jours travaillés de l'employé,
 * comme nbJours. Retourne null si aucun dépassement. */
function findTeleworkWeekOverQuota(employeeId, dateDebut, dateFin, employee, quota, excludeRequestId) {
  const workedDays = employee.joursTravailles && employee.joursTravailles.length ? employee.joursTravailles : ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'];
  const dayLabels = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  const usageByWeek = {};

  const tally = (start, end) => {
    for (let cursor = new Date(start); toISODate(cursor) <= end; cursor.setDate(cursor.getDate() + 1)) {
      if (!workedDays.includes(dayLabels[cursor.getDay()])) continue;
      const weekStart = toISODate(getWeekDatesContaining(toISODate(cursor))[0]);
      usageByWeek[weekStart] = (usageByWeek[weekStart] || 0) + 1;
    }
  };

  // excludeRequestId : la demande qu'on est en train de déplacer (§3, glisser-déposer) ne doit pas
  // se compter elle-même deux fois (une fois à son ancienne date via getAll(), une fois à sa nouvelle
  // date via l'appel tally(dateDebut, dateFin) ci-dessous).
  teleworkRepository.getAll()
    .filter(r => r.employeeId === employeeId && r.id !== excludeRequestId && (r.statut === 'Validé' || r.statut === 'En attente'))
    .forEach(r => tally(r.dateDebut, r.dateFin));
  tally(dateDebut, dateFin);

  const overWeek = Object.entries(usageByWeek).find(([, count]) => count > quota);
  return overWeek ? { weekStart: overWeek[0], used: overWeek[1] } : null;
}

/** Sprint SIRH premium §3 : déplace une demande de télétravail validée par glisser-déposer (Planning
 * Semaine/Mois) — mêmes règles de validation que submitTeleworkRequestForm (période d'emploi, jour
 * travaillé, chevauchement congé/autre télétravail, quota hebdomadaire), pas de raccourci. Pas
 * d'équivalent "régulariser" pour le télétravail (contrairement aux congés, §régularisation) : cette
 * fonction en tient lieu, sous une forme bornée au strict nécessaire pour le déplacement. */
function moveTeleworkRequest(id, nouvelleDateDebut, nouvelleDateFin) {
  const request = teleworkRepository.getById(id);
  if (!request) return { success: false, error: 'Demande introuvable.' };
  const employee = employeeRepository.getById(request.employeeId);
  if (!employee) return { success: false, error: 'Salarié introuvable.' };

  if (nouvelleDateFin < nouvelleDateDebut) {
    return { success: false, error: 'La date de fin ne peut pas être avant la date de début.' };
  }
  if (employee.dateEmbauche && nouvelleDateDebut < employee.dateEmbauche) {
    return { success: false, error: `La date de début ne peut pas être avant la date d'embauche (${formatDate(employee.dateEmbauche)}).` };
  }
  if (employee.dateDepart && nouvelleDateFin > employee.dateDepart) {
    return { success: false, error: `La date de fin ne peut pas être après la date de départ (${formatDate(employee.dateDepart)}).` };
  }

  const nbJours = computeWorkingDays(nouvelleDateDebut, nouvelleDateFin, false, employee, settingsRepository.getSettings());
  if (nbJours <= 0) {
    return { success: false, error: 'La période cible ne comporte aucun jour travaillé.' };
  }

  const quota = settingsRepository.getSettings().teletravailQuotaSemaine;
  const overQuota = findTeleworkWeekOverQuota(request.employeeId, nouvelleDateDebut, nouvelleDateFin, employee, quota, id);
  if (overQuota) {
    return { success: false, error: `Quota de télétravail dépassé pour la semaine du ${formatDate(overQuota.weekStart)} (${formatDurationFR(overQuota.used)}/${formatDurationFR(quota)}).` };
  }

  if (hasActiveRequestOverlap(leaveRepository.getAll(), request.employeeId, nouvelleDateDebut, nouvelleDateFin)) {
    return { success: false, error: 'Ce salarié a déjà une demande de congé/absence active sur cette période.' };
  }
  if (hasActiveRequestOverlap(teleworkRepository.getAll(), request.employeeId, nouvelleDateDebut, nouvelleDateFin, id)) {
    return { success: false, error: 'Ce salarié a déjà une autre demande de télétravail active sur cette période.' };
  }

  const historique = (request.historique || []).concat([{
    date: new Date().toISOString(),
    action: `Déplacé (glisser-déposer) : ${formatDate(request.dateDebut)}${request.dateDebut !== request.dateFin ? ' → ' + formatDate(request.dateFin) : ''} devient ${formatDate(nouvelleDateDebut)}${nouvelleDateDebut !== nouvelleDateFin ? ' → ' + formatDate(nouvelleDateFin) : ''}`
  }]);
  teleworkRepository.update(id, { dateDebut: nouvelleDateDebut, dateFin: nouvelleDateFin, nbJours, historique });
  auditLogRepository.logAudit('Modification', 'Télétravail déplacé (glisser-déposer)', `${employee.prenom} ${employee.nom} · ${formatDate(nouvelleDateDebut)}${nouvelleDateDebut !== nouvelleDateFin ? ' au ' + formatDate(nouvelleDateFin) : ''}`);
  return { success: true };
}

function submitTeleworkRequestForm(evt) {
  evt.preventDefault();
  const form = evt.target;
  const formData = new FormData(form);
  const employeeId = formData.get('employeeId');
  const dateDebut = formData.get('dateDebut');
  const dateFin = formData.get('dateFin');

  if (!employeeId) {
    showToast('Sélectionnez un salarié.', 'error');
    return;
  }

  if (dateDebut && dateFin && dateFin < dateDebut) {
    showToast('La date de fin ne peut pas être avant la date de début.', 'error');
    return;
  }

  const employee = employeeRepository.getById(employeeId);
  const nbJours = computeWorkingDays(dateDebut, dateFin, false, employee, settingsRepository.getSettings());

  if (nbJours <= 0) {
    showToast('La période sélectionnée ne comporte aucun jour travaillé.', 'error');
    return;
  }

  const quota = settingsRepository.getSettings().teletravailQuotaSemaine;
  const overQuota = findTeleworkWeekOverQuota(employeeId, dateDebut, dateFin, employee, quota);
  if (overQuota) {
    showToast(`Quota de télétravail dépassé pour la semaine du ${formatDate(overQuota.weekStart)} (${formatDurationFR(overQuota.used)}/${formatDurationFR(quota)}).`, 'error');
    return;
  }

  if (hasActiveRequestOverlap(leaveRepository.getAll(), employeeId, dateDebut, dateFin)) {
    showToast('Ce salarié a déjà une demande de congé/absence active sur cette période.', 'error');
    return;
  }
  if (hasActiveRequestOverlap(teleworkRepository.getAll(), employeeId, dateDebut, dateFin)) {
    showToast('Ce salarié a déjà une autre demande de télétravail active sur cette période.', 'error');
    return;
  }

  teleworkRepository.create({ employeeId, dateDebut, dateFin, nbJours, commentaire: formData.get('commentaire') || '' });

  finalizeDraftEdit();
  showToast('Demande de télétravail envoyée.');
  closeModal();
  // Ouverte depuis un clic sur le calendrier : on y retourne (même logique que openLeaveRequestModal).
  if (state._leaveRequestReturnToCalendar) {
    state._leaveRequestReturnToCalendar = false;
    navigateTo('calendrier');
  } else {
    navigateTo('absences', { absencesHubTab: 'teletravail', teletravailTab: 'demandes' });
  }
}

// ---- Sous-vue : Planning hebdomadaire ----

function getWeekDates(weekOffset) {
  return getWeekDatesContaining(toISODate(addDays(new Date(), weekOffset * 7)));
}

function renderTeletravailPlanning() {
  const weekDates = getWeekDates(state.teletravailWeekOffset);
  const visibleIds = getVisibleEmployeeIdsForCurrentUser();
  let employees = employeeRepository.getAll().filter(e => !e.archive && isEmployedDuringPeriod(e, toISODate(weekDates[0]), toISODate(weekDates[6])));
  if (visibleIds !== null) employees = employees.filter(e => visibleIds.includes(e.id));
  const teleworkRequests = teleworkRepository.getAll().filter(r => r.statut === 'Validé' || r.statut === 'En attente');
  const leaveRequests = leaveRepository.getAll().filter(r => r.statut === 'Validé');

  return `
    <div class="view-header-row">
      <p class="view-subtitle">Semaine du ${formatDate(toISODate(weekDates[0]))} au ${formatDate(toISODate(weekDates[6]))}</p>
      <div class="calendar-nav">
        <button class="btn btn-secondary btn-sm" id="btn-week-prev">← Précédente</button>
        <button class="btn btn-secondary btn-sm" id="btn-week-today">Cette semaine</button>
        <button class="btn btn-secondary btn-sm" id="btn-week-next">Suivante →</button>
      </div>
    </div>
    <div class="card table-card planning-scroll-card">
      <table class="table planning-table">
        <thead>
          <tr>
            <th>Salarié</th>
            ${weekDates.map(d => `<th>${WEEKDAY_LABELS[(d.getDay() + 6) % 7]} ${d.getDate()}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${employees.map(e => renderPlanningRow(e, weekDates, teleworkRequests, leaveRequests)).join('')}
          <tr class="planning-summary-row">
            <td><strong>Présents au bureau</strong></td>
            ${weekDates.map(d => `<td>${countPresentOnDate(d, employees, teleworkRequests, leaveRequests)}</td>`).join('')}
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

function renderPlanningRow(employee, weekDates, teleworkRequests, leaveRequests) {
  return `
    <tr>
      <td>${escapeHtml(employee.prenom)} ${escapeHtml(employee.nom)}</td>
      ${weekDates.map(d => renderPlanningCell(employee, d, teleworkRequests, leaveRequests)).join('')}
    </tr>
  `;
}

function renderPlanningCell(employee, date, teleworkRequests, leaveRequests) {
  const dateStr = toISODate(date);
  const weekday = WEEKDAY_LABELS[(date.getDay() + 6) % 7];

  if (!(employee.joursTravailles || []).includes(weekday)) {
    return `<td class="planning-cell planning-off">—</td>`;
  }
  if (leaveRequests.some(r => r.employeeId === employee.id && dateStr >= r.dateDebut && dateStr <= r.dateFin)) {
    return `<td class="planning-cell planning-leave" title="Congé">🏖️</td>`;
  }
  if (teleworkRequests.some(r => r.employeeId === employee.id && dateStr >= r.dateDebut && dateStr <= r.dateFin)) {
    return `<td class="planning-cell planning-remote" title="Télétravail">🏠</td>`;
  }
  return `<td class="planning-cell planning-office" title="Présent au bureau">🏢</td>`;
}

function countPresentOnDate(date, employees, teleworkRequests, leaveRequests) {
  const dateStr = toISODate(date);
  const weekday = WEEKDAY_LABELS[(date.getDay() + 6) % 7];
  return employees.filter(e => {
    if (!(e.joursTravailles || []).includes(weekday)) return false;
    const onLeave = leaveRequests.some(r => r.employeeId === e.id && dateStr >= r.dateDebut && dateStr <= r.dateFin);
    if (onLeave) return false;
    const remote = teleworkRequests.some(r => r.employeeId === e.id && dateStr >= r.dateDebut && dateStr <= r.dateFin);
    return !remote;
  }).length;
}

function bindTeletravailPlanningEvents() {
  document.getElementById('btn-week-prev').addEventListener('click', () => { state.teletravailWeekOffset -= 1; render(); });
  document.getElementById('btn-week-next').addEventListener('click', () => { state.teletravailWeekOffset += 1; render(); });
  document.getElementById('btn-week-today').addEventListener('click', () => { state.teletravailWeekOffset = 0; render(); });
}

// ---------------------------------------------------------------------------
// Export CSV — utilitaire générique réutilisé par Congés et Notes de frais
// ---------------------------------------------------------------------------

function csvEscape(value) {
  const str = String(value === null || value === undefined ? '' : value);
  return /[;"\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
}

function downloadTextFile(content, filename, mimeType) {
  const blob = new Blob(['﻿' + content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportRowsToCSV(headers, rows, filename) {
  const csv = [headers, ...rows].map(row => row.map(csvEscape).join(';')).join('\r\n');
  downloadTextFile(csv, filename, 'text/csv;charset=utf-8;');
}

// ---------------------------------------------------------------------------
// Vue : Notes de frais
// ---------------------------------------------------------------------------

function getFilteredExpenses() {
  let list = expenseRepository.getAll();
  const visibleIds = getVisibleEmployeeIdsForCurrentUser();
  if (visibleIds !== null) list = list.filter(n => visibleIds.includes(n.employeeId));
  if (state.fraisFilters.employeeId) list = list.filter(n => n.employeeId === state.fraisFilters.employeeId);
  if (state.fraisFilters.categorie) list = list.filter(n => n.categorie === state.fraisFilters.categorie);
  if (state.fraisFilters.statut) list = list.filter(n => n.statut === state.fraisFilters.statut);
  return list;
}

function renderFrais() {
  const employees = getScopedEmployeesForFilters();
  const settings = settingsRepository.getSettings();
  const expenses = getFilteredExpenses();
  const total = expenses.reduce((sum, n) => sum + n.montantTTC, 0);
  const { pageItems, totalPages, page, pageStart } = paginate(expenses, 'fraisPage');
  const user = authRepository.getCurrentUser();
  const canValider = ['manager', 'rh', 'directeur', 'comptabilite'].includes(user.role);

  return `
    <div class="view-header-row">
      <div>
        <h1>Notes de frais</h1>
        <p class="view-subtitle">${expenses.length} note${expenses.length > 1 ? 's' : ''} · ${formatCurrencyFR(total)} TTC</p>
      </div>
      <div class="detail-header-actions">
        ${canValider ? `<button type="button" class="btn btn-secondary" id="btn-frais-a-valider">Voir les notes à valider</button>` : ''}
        <button class="btn btn-secondary" id="btn-export-frais">Exporter CSV</button>
        <button class="btn btn-primary" id="btn-new-expense">+ Nouvelle note</button>
      </div>
    </div>

    ${renderDraftsCard('frais')}

    <div class="toolbar card">
      <select id="frais-filter-employee" class="input">
        <option value="">Tous les salariés</option>
        ${employees.map(e => `<option value="${e.id}" ${state.fraisFilters.employeeId === e.id ? 'selected' : ''}>${escapeHtml(e.prenom)} ${escapeHtml(e.nom)}</option>`).join('')}
      </select>
      <select id="frais-filter-categorie" class="input">
        <option value="">Toutes les catégories</option>
        ${settings.categoriesFrais.map(c => `<option value="${escapeHtml(c)}" ${state.fraisFilters.categorie === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
      </select>
      <select id="frais-filter-statut" class="input">
        <option value="">Tous les statuts</option>
        ${['En attente', 'Remboursé', 'Refusé', 'Annulé'].map(s => `<option value="${s}" ${state.fraisFilters.statut === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
    </div>

    <div class="card table-card">
      ${expenses.length === 0 ? `<div class="empty-state"><div class="empty-icon">🧾</div><p>Aucune note de frais ne correspond à ces filtres.</p></div>` : `
        <table class="table">
          <thead>
            <tr><th>Salarié</th><th>Date</th><th>Catégorie</th><th>Libellé</th><th>Montant TTC</th><th>Statut</th><th></th></tr>
          </thead>
          <tbody>${pageItems.map(renderExpenseRow).join('')}</tbody>
        </table>
        ${renderPaginationControls(page, totalPages, pageStart, pageItems.length, expenses.length)}
      `}
    </div>
  `;
}

function renderExpenseRow(n) {
  const employee = employeeRepository.getById(n.employeeId);
  if (!employee) return '';

  const actions = n.statut === 'En attente'
    ? `${canActOnRequestFor(n, 'frais') ? `<button class="btn-link" data-approve-nf="${n.id}">Valider</button>` : ''}${canRefuserRequestFor(n, 'frais') ? `<button class="btn-link btn-link-danger" data-refuse-nf="${n.id}">Refuser</button>` : ''}`
    : n.statut === 'Remboursé' && canManageRequestFor(n.employeeId, 'frais') ? `<button class="btn-link btn-link-danger" data-cancel-nf="${n.id}">Annuler</button>` : '';

  return `
    <tr>
      <td>${escapeHtml(employee.prenom)} ${escapeHtml(employee.nom)}</td>
      <td>${formatDate(n.date)}</td>
      <td>${escapeHtml(n.categorie)}</td>
      <td>${escapeHtml(n.libelle)}</td>
      <td>${formatCurrencyFR(n.montantTTC)}</td>
      <td>${renderRequestStatutBadge(n)}</td>
      <td class="table-actions">
        <button class="btn-link" data-view-nf="${n.id}">Détail</button>
        <button class="btn-link" data-history="${n.id}">Historique</button>
        ${actions}
      </td>
    </tr>
  `;
}

function bindFraisEvents() {
  document.getElementById('btn-new-expense').addEventListener('click', () => openExpenseModal());
  document.getElementById('btn-export-frais').addEventListener('click', exportExpensesCSV);
  bindDraftsCardEvents((draft) => openExpenseModal(undefined, draft));

  const btnAValider = document.getElementById('btn-frais-a-valider');
  if (btnAValider) {
    btnAValider.addEventListener('click', () => {
      Object.assign(state, NAVPARAMS_FRAIS_A_VALIDER);
      state.fraisPage = 1;
      render();
    });
  }

  document.getElementById('frais-filter-employee').addEventListener('change', (e) => {
    state.fraisFilters.employeeId = e.target.value;
    state.fraisPage = 1;
    render();
  });
  document.getElementById('frais-filter-categorie').addEventListener('change', (e) => {
    state.fraisFilters.categorie = e.target.value;
    state.fraisPage = 1;
    render();
  });
  document.getElementById('frais-filter-statut').addEventListener('change', (e) => {
    state.fraisFilters.statut = e.target.value;
    state.fraisPage = 1;
    render();
  });

  const fraisPrevBtn = document.getElementById('btn-page-prev');
  if (fraisPrevBtn) fraisPrevBtn.addEventListener('click', () => { state.fraisPage -= 1; render(); });
  const fraisNextBtn = document.getElementById('btn-page-next');
  if (fraisNextBtn) fraisNextBtn.addEventListener('click', () => { state.fraisPage += 1; render(); });

  document.querySelectorAll('[data-view-nf]').forEach(btn => btn.addEventListener('click', () => openExpenseDetailModal(btn.dataset.viewNf)));
  document.querySelectorAll('[data-approve-nf]').forEach(btn => btn.addEventListener('click', () => handleApproveExpense(btn.dataset.approveNf)));
  document.querySelectorAll('[data-refuse-nf]').forEach(btn => btn.addEventListener('click', () => handleRefuseExpense(btn.dataset.refuseNf)));
  document.querySelectorAll('[data-cancel-nf]').forEach(btn => btn.addEventListener('click', () => handleCancelExpense(btn.dataset.cancelNf)));
  bindHistoryButtons(expenseRepository);
}

function handleApproveExpense(id) {
  const expense = expenseRepository.getById(id);
  if (!expense || !canActOnRequestFor(expense, 'frais')) { showToast('Action non autorisée.', 'error'); return; }
  const patch = advanceWorkflow(expense, 'Remboursé');
  expenseRepository.update(id, patch);
  auditLogRepository.logAudit('Validation', 'Note de frais', auditLabelForEmployee(expense.employeeId));
  showToast(patch.statut === 'Remboursé' ? 'Note de frais remboursée.' : 'Étape de validation suivante en attente.');
  render();
}

function handleRefuseExpense(id) {
  const expense = expenseRepository.getById(id);
  if (!expense || !canRefuserRequestFor(expense, 'frais')) { showToast('Action non autorisée.', 'error'); return; }
  openConfirm({
    title: 'Refuser cette note de frais ?',
    message: 'Le salarié sera informé du refus.',
    confirmLabel: 'Refuser',
    danger: true,
    onConfirm: () => {
      expenseRepository.update(id, refuseRequest(expense));
      auditLogRepository.logAudit('Refus', 'Note de frais', auditLabelForEmployee(expense.employeeId));
      showToast('Note de frais refusée.');
      render();
    }
  });
}

function handleCancelExpense(id) {
  const expense = expenseRepository.getById(id);
  if (!expense || !canManageRequestFor(expense.employeeId, 'frais')) { showToast('Action non autorisée.', 'error'); return; }
  openConfirm({
    title: 'Annuler cette note de frais ?',
    message: 'La validation sera annulée.',
    confirmLabel: 'Annuler',
    danger: true,
    onConfirm: () => {
      expenseRepository.update(id, cancelRequest(expense));
      auditLogRepository.logAudit('Annulation', 'Note de frais', auditLabelForEmployee(expense.employeeId));
      showToast('Note de frais annulée.');
      render();
    }
  });
}

function exportExpensesCSV() {
  const expenses = getFilteredExpenses();
  const headers = ['Salarié', 'Date', 'Catégorie', 'Libellé', 'Montant HT', 'TVA', 'Montant TTC', 'Statut'];
  const rows = expenses.map(n => {
    const employee = employeeRepository.getById(n.employeeId);
    return [
      employee ? `${employee.prenom} ${employee.nom}` : '—',
      n.date,
      n.categorie,
      n.libelle,
      formatNumberFR(computeMontantHT(n.montantTTC, n.tauxTVA)),
      formatNumberFR(computeMontantTVA(n.montantTTC, n.tauxTVA)),
      formatNumberFR(n.montantTTC),
      n.statut
    ];
  });
  exportRowsToCSV(headers, rows, 'notes-de-frais.csv');
  auditLogRepository.logAudit('Export', 'Notes de frais', `${expenses.length} ligne${expenses.length > 1 ? 's' : ''}`);
}

// ---- Modale : Nouvelle note de frais ----

function openExpenseModal(presetEmployeeId, draft) {
  const employees = employeeRepository.getAll().filter(e => !e.archive);
  const settings = settingsRepository.getSettings();
  const champs = (draft && draft.champs) || {};
  state.pendingAttachment = champs.justificatif || null;
  beginDraftEdit(draft);

  const html = `
    <div class="modal">
      <div class="modal-header">
        <h2>Nouvelle note de frais</h2>
        <button class="btn-icon" id="btn-close-modal" aria-label="Fermer" title="Fermer">✕</button>
      </div>
      <form id="expense-form">
        <div class="modal-body">
          <div class="form-grid">
            ${employeeFieldForRequest(presetEmployeeId || champs.employeeId, employees)}
            ${selectField('categorie', 'Catégorie', settings.categoriesFrais, champs.categorie || settings.categoriesFrais[0])}
            ${textField('date', 'Date de la dépense', champs.date || '', true, 'date')}
            ${textField('libelle', 'Libellé', champs.libelle || '', true)}
          </div>

          <div class="form-grid" id="expense-standard-fields" style="margin-top: 14px;">
            ${textField('montantTTC', 'Montant TTC (€)', champs.montantTTC || '', false, 'number')}
            <div class="form-field">
              <label for="f-tauxTVA">Taux de TVA</label>
              <select class="input" id="f-tauxTVA" name="tauxTVA">
                ${TVA_RATES.map(t => `<option value="${t}" ${champs.tauxTVA !== undefined && Number(champs.tauxTVA) === t ? 'selected' : ''}>${formatPercentFR(t)}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="form-grid" id="expense-km-fields" style="margin-top: 14px; display: none;">
            ${textField('distanceKm', 'Distance (km, aller-retour inclus)', champs.distanceKm || '', false, 'number')}
            ${textField('puissanceFiscale', 'Puissance fiscale (CV)', champs.puissanceFiscale || '', false, 'number')}
          </div>
          <p class="text-muted" id="expense-km-hint" style="margin-top: 8px;"></p>

          <div class="form-field" style="margin-top: 14px;">
            <label for="f-commentaire">Commentaire</label>
            <textarea class="input" id="f-commentaire" name="commentaire" rows="2">${escapeHtml(champs.commentaire || '')}</textarea>
          </div>
          <div class="form-field" style="margin-top: 14px;">
            <label for="f-justificatif">Justificatif (optionnel)</label>
            <input class="input" type="file" id="f-justificatif">
            ${champs.justificatif ? `<p class="text-muted" style="margin-top:4px;">Fichier repris du brouillon : ${escapeHtml(champs.justificatif.nom)}</p>` : ''}
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Annuler</button>
          <button type="button" class="btn btn-secondary" id="btn-save-draft">Enregistrer comme brouillon</button>
          <button type="submit" class="btn btn-primary">Envoyer la note</button>
        </div>
      </form>
    </div>
  `;

  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = html;
  modalRoot.classList.add('open');

  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
  document.getElementById('f-justificatif').addEventListener('change', handleAttachmentChange);
  document.getElementById('f-categorie').addEventListener('change', updateExpenseCategoryFields);
  document.getElementById('f-distanceKm').addEventListener('input', updateExpenseKmHint);
  document.getElementById('f-puissanceFiscale').addEventListener('input', updateExpenseKmHint);
  document.getElementById('expense-form').addEventListener('submit', submitExpenseForm);
  document.getElementById('btn-save-draft').addEventListener('click', () => {
    saveDraftFromForm(document.getElementById('expense-form'), 'frais', { justificatif: state.pendingAttachment });
  });

  updateExpenseCategoryFields();
}

function updateExpenseCategoryFields() {
  const isKm = document.getElementById('f-categorie').value === 'Kilométrique';
  document.getElementById('expense-standard-fields').style.display = isKm ? 'none' : 'grid';
  document.getElementById('expense-km-fields').style.display = isKm ? 'grid' : 'none';
  if (isKm) updateExpenseKmHint(); else document.getElementById('expense-km-hint').textContent = '';
}

function updateExpenseKmHint() {
  const distanceKm = Number(document.getElementById('f-distanceKm').value) || 0;
  const puissanceFiscale = Number(document.getElementById('f-puissanceFiscale').value) || 0;
  const hint = document.getElementById('expense-km-hint');
  if (!distanceKm || !puissanceFiscale) {
    hint.textContent = 'Renseignez la distance et la puissance fiscale pour calculer l\'indemnité.';
    return;
  }
  hint.textContent = `Indemnité kilométrique calculée automatiquement : ${formatCurrencyFR(calculateIndemniteKilometrique(distanceKm, puissanceFiscale))}`;
}

function submitExpenseForm(evt) {
  evt.preventDefault();
  const formData = new FormData(evt.target);
  const employeeId = formData.get('employeeId');
  const categorie = formData.get('categorie');

  if (!employeeId || !categorie) {
    showToast('Sélectionnez un salarié et une catégorie.', 'error');
    return;
  }

  let montantTTC, tauxTVA, kilometrage = null;

  if (categorie === 'Kilométrique') {
    const distanceKm = Number(formData.get('distanceKm')) || 0;
    const puissanceFiscale = Number(formData.get('puissanceFiscale')) || 0;
    if (distanceKm <= 0 || puissanceFiscale <= 0) {
      showToast('Renseignez une distance et une puissance fiscale valides (supérieures à 0).', 'error');
      return;
    }
    montantTTC = calculateIndemniteKilometrique(distanceKm, puissanceFiscale);
    tauxTVA = 0;
    kilometrage = { distanceKm, puissanceFiscale };
  } else {
    montantTTC = Number(formData.get('montantTTC')) || 0;
    tauxTVA = Number(formData.get('tauxTVA'));
    if (montantTTC <= 0) {
      showToast('Indiquez un montant valide.', 'error');
      return;
    }
  }

  expenseRepository.create({
    employeeId, categorie, kilometrage, montantTTC, tauxTVA,
    date: formData.get('date'),
    libelle: formData.get('libelle'),
    commentaire: formData.get('commentaire') || '',
    justificatif: state.pendingAttachment
  });

  finalizeDraftEdit();
  showToast('Note de frais envoyée.');
  closeModal();
  navigateTo('frais');
}

// ---- Modale : Détail / impression d'une note de frais ----

function openExpenseDetailModal(id) {
  const n = expenseRepository.getById(id);
  if (!n) { showToast('Cette note de frais n\'est plus disponible.', 'error'); return; }
  const employee = employeeRepository.getById(n.employeeId);
  const ht = computeMontantHT(n.montantTTC, n.tauxTVA);
  const tva = computeMontantTVA(n.montantTTC, n.tauxTVA);

  const html = `
    <div class="modal">
      <div class="modal-header">
        <h2>Note de frais</h2>
        <button class="btn-icon" id="btn-close-modal" aria-label="Fermer" title="Fermer">✕</button>
      </div>
      <div class="modal-body">
        <div class="print-area">
          <h2>${escapeHtml(employee.prenom)} ${escapeHtml(employee.nom)}</h2>
          ${infoRow('Date', formatDate(n.date))}
          ${infoRow('Catégorie', n.categorie)}
          ${infoRow('Libellé', n.libelle)}
          ${n.kilometrage ? infoRow('Distance', `${n.kilometrage.distanceKm} km · ${n.kilometrage.puissanceFiscale} CV`) : ''}
          ${infoRow('Montant HT', formatCurrencyFR(ht))}
          ${infoRow(`TVA (${formatPercentFR(n.tauxTVA)})`, formatCurrencyFR(tva))}
          ${infoRow('Montant TTC', formatCurrencyFR(n.montantTTC))}
          ${infoRow('Statut', n.statut)}
          ${n.commentaire ? infoRow('Commentaire', n.commentaire) : ''}
          ${n.justificatif ? `<div style="margin-top: 12px;"><img src="${escapeHtml(n.justificatif.dataUrl)}" alt="Justificatif" style="max-width: 100%; border-radius: 8px;"></div>` : ''}
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Fermer</button>
        <button type="button" class="btn btn-primary" id="btn-print-expense">Imprimer / Export PDF</button>
      </div>
    </div>
  `;

  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = html;
  modalRoot.classList.add('open');

  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
  document.getElementById('btn-print-expense').addEventListener('click', () => window.print());
}

// ---------------------------------------------------------------------------
// Vue : Tickets restaurant (calcul automatique, aucune saisie)
// ---------------------------------------------------------------------------

/** §sprint refonte UX §9-10 : point d'entrée unique du nav "tickets" — RH/Comptabilité/Directeur
 * gardent la vue équipe historique via la bascule Moi/Équipe partagée ; tous les autres (et ces
 * mêmes rôles en "Moi") tombent sur la nouvelle vue personnelle ci-dessous. Avant ce sprint, un
 * salarié sans la permission CALCULER_TICKETS_RESTAURANT n'avait accès à AUCUNE vue de ses tickets. */
function renderTicketsHub() {
  const user = authRepository.getCurrentUser();
  const canVoirEquipe = hasPermission(user, PERMISSIONS.CALCULER_TICKETS_RESTAURANT);
  const vueEquipe = canVoirEquipe && state.ticketsRestaurantVue !== 'personnel';
  return `
    ${canVoirEquipe ? renderMoiEquipeToggle('ticketsRestaurantVue', 'equipe', 'Tickets restaurant équipe') : ''}
    ${vueEquipe ? renderTicketsEquipe() : renderMesTicketsRestaurant()}
  `;
}

function bindTicketsHubEvents() {
  const user = authRepository.getCurrentUser();
  const canVoirEquipe = hasPermission(user, PERMISSIONS.CALCULER_TICKETS_RESTAURANT);
  if (canVoirEquipe) bindMoiEquipeToggleEvents();
  const vueEquipe = canVoirEquipe && state.ticketsRestaurantVue !== 'personnel';
  if (vueEquipe) bindTicketsEquipeEvents();
  else bindMesTicketsRestaurantEvents();
}

/** Vue salarié : historique mensuel de ses propres tickets restaurant. Réutilise directement
 * calculateTicketsRestaurant() (aucun nouveau calcul) et le journal d'audit existant pour le motif
 * d'une éventuelle régularisation — DB.ajusterTicketsRestaurant() y écrit déjà ce motif en texte,
 * pas besoin d'un nouveau champ structuré pour l'exposer ici. */
function renderMesTicketsRestaurant() {
  const user = authRepository.getCurrentUser();
  const employee = employeeRepository.getById(user.id);
  if (!employee) return '<p class="text-muted">Fiche salarié introuvable.</p>';
  const settings = settingsRepository.getSettings();
  const leaveRequests = leaveRepository.getAll();
  const teleworkRequests = teleworkRepository.getAll();
  const year = state.mesTicketsYear;
  const month = state.mesTicketsMonth;
  const result = calculateTicketsRestaurant(employee, year, month, leaveRequests, teleworkRequests, settings);
  const regularisation = result.ajustement ? findTicketsRegularisationMotif(employee, year, month) : null;

  const historique = [];
  for (let i = 1; i <= 6; i++) {
    const d = new Date(year, month - i, 1);
    historique.push({
      year: d.getFullYear(),
      month: d.getMonth(),
      result: calculateTicketsRestaurant(employee, d.getFullYear(), d.getMonth(), leaveRequests, teleworkRequests, settings)
    });
  }

  return `
    <div class="view-header-row">
      <div>
        <h1>Mes tickets restaurant</h1>
        <p class="view-subtitle">${MONTH_NAMES[month]} ${year} · valeur faciale ${formatCurrencyFR(settings.ticketsValeurFaciale)} (${formatPercentFR(settings.ticketsPartEmployeurPct)} employeur)</p>
      </div>
      <div class="detail-header-actions">
        <button class="btn btn-secondary btn-sm" id="btn-mes-tickets-prev">← Précédent</button>
        <button class="btn btn-secondary btn-sm" id="btn-mes-tickets-today">Ce mois-ci</button>
        <button class="btn btn-secondary btn-sm" id="btn-mes-tickets-next">Suivant →</button>
      </div>
    </div>

    <div class="kpi-grid">
      ${kpiCard('Jours éligibles', result.nbTickets, '📅')}
      ${kpiCard('Tickets attribués', result.nbTickets, '🍽️')}
      ${kpiCard('Valeur unitaire', formatCurrencyFR(settings.ticketsValeurFaciale), '💶')}
      ${kpiCard('Montant total', formatCurrencyFR(result.montantTotal), '💰')}
      ${kpiCard('Part employeur', formatCurrencyFR(result.partEmployeur), '🏢')}
      ${kpiCard('Part salarié', formatCurrencyFR(result.partSalarie), '👤')}
    </div>

    ${result.ajustement ? `
      <div class="card" style="margin-top: 12px;">
        <p style="margin: 0;">⚖️ Régularisation appliquée ce mois : <strong>${result.ajustement >= 0 ? '+' : ''}${result.ajustement} ticket${Math.abs(result.ajustement) > 1 ? 's' : ''}</strong>${regularisation ? ` — ${escapeHtml(regularisation)}` : ''}</p>
      </div>
    ` : ''}

    <div class="card table-card" style="margin-top: 16px;">
      <div class="view-header-row" style="padding: 16px 20px 0;">
        <h2>Historique</h2>
      </div>
      <table class="table">
        <thead><tr><th>Mois</th><th>Tickets</th><th>Montant total</th><th>Part salarié</th></tr></thead>
        <tbody>
          ${historique.map(h => `
            <tr class="table-row" data-mes-tickets-month="${h.year}-${h.month}">
              <td>${MONTH_NAMES[h.month]} ${h.year}</td>
              <td>${h.result.nbTickets}${h.result.ajustement ? ` <span class="text-muted">(correction ${h.result.ajustement >= 0 ? '+' : ''}${h.result.ajustement})</span>` : ''}</td>
              <td>${formatCurrencyFR(h.result.montantTotal)}</td>
              <td>${formatCurrencyFR(h.result.partSalarie)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function findTicketsRegularisationMotif(employee, year, month) {
  const monthKey = ticketsMonthKey(year, month);
  const entry = DB.getAuditLog().find(e =>
    e.entite === 'Tickets restaurant' &&
    e.cible.startsWith(`${employee.prenom} ${employee.nom}`) &&
    e.cible.includes(monthKey));
  if (!entry) return null;
  // cible = "Prénom Nom · AAAA-MM · correction ±N[ · motif]" (voir DB.ajusterTicketsRestaurant) —
  // le motif éventuel est tout ce qui suit le segment technique "correction ±N", jamais celui-ci.
  const parts = entry.cible.split(' · ');
  return parts.length > 3 ? parts.slice(3).join(' · ') : null;
}

function bindMesTicketsRestaurantEvents() {
  document.getElementById('btn-mes-tickets-prev').addEventListener('click', () => shiftMesTicketsMonth(-1));
  document.getElementById('btn-mes-tickets-next').addEventListener('click', () => shiftMesTicketsMonth(1));
  document.getElementById('btn-mes-tickets-today').addEventListener('click', () => {
    const now = new Date();
    state.mesTicketsYear = now.getFullYear();
    state.mesTicketsMonth = now.getMonth();
    render();
  });
  document.querySelectorAll('[data-mes-tickets-month]').forEach(row => {
    row.addEventListener('click', () => {
      const [y, m] = row.dataset.mesTicketsMonth.split('-').map(Number);
      state.mesTicketsYear = y;
      state.mesTicketsMonth = m;
      render();
    });
  });
}

function shiftMesTicketsMonth(delta) {
  let month = state.mesTicketsMonth + delta;
  let year = state.mesTicketsYear;
  if (month < 0) { month = 11; year -= 1; }
  if (month > 11) { month = 0; year += 1; }
  state.mesTicketsMonth = month;
  state.mesTicketsYear = year;
  render();
}

function getTicketsRows() {
  const year = state.ticketsYear;
  const month = state.ticketsMonth;
  const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const monthEnd = toISODate(new Date(year, month + 1, 0));
  // Même bug que l'export paie (cf. getPaieRows) : on peut naviguer vers un mois passé, donc filtrer
  // sur le statut ACTUEL du salarié lui ferait perdre tous ses tickets d'un mois où il était encore
  // présent — calculateTicketsRestaurant borne déjà correctement le calcul lui-même, mais encore
  // faut-il que le salarié atteigne cette fonction.
  const employees = employeeRepository.getAll().filter(e => !e.archive && isEmployedDuringPeriod(e, monthStart, monthEnd));
  const settings = settingsRepository.getSettings();
  const leaveRequests = leaveRepository.getAll();
  const teleworkRequests = teleworkRepository.getAll();

  return employees.map(e => ({
    employee: e,
    result: calculateTicketsRestaurant(e, year, month, leaveRequests, teleworkRequests, settings)
  }));
}

/** §sprint refonte UX §9-10 : vue équipe historique de Tickets restaurant (RH/Comptabilité/
 * Directeur), désormais atteinte via la bascule Moi/Équipe (renderTicketsHub) plutôt qu'une entrée
 * de menu séparée. Corps inchangé. */
function renderTicketsEquipe() {
  const settings = settingsRepository.getSettings();
  const rows = getTicketsRows();
  const canCorriger = hasPermission(authRepository.getCurrentUser(), PERMISSIONS.CORRIGER_TICKETS_RESTAURANT);
  const totals = rows.reduce((acc, r) => ({
    nbTickets: acc.nbTickets + r.result.nbTickets,
    montantTotal: acc.montantTotal + r.result.montantTotal,
    partEmployeur: acc.partEmployeur + r.result.partEmployeur,
    partSalarie: acc.partSalarie + r.result.partSalarie
  }), { nbTickets: 0, montantTotal: 0, partEmployeur: 0, partSalarie: 0 });

  return `
    <div class="view-header-row">
      <div>
        <h1>Tickets restaurant</h1>
        <p class="view-subtitle">${MONTH_NAMES[state.ticketsMonth]} ${state.ticketsYear} · valeur faciale ${formatCurrencyFR(settings.ticketsValeurFaciale)} (${formatPercentFR(settings.ticketsPartEmployeurPct)} employeur)</p>
      </div>
      <div class="detail-header-actions">
        <button class="btn btn-secondary btn-sm" id="btn-tickets-prev">← Précédent</button>
        <button class="btn btn-secondary btn-sm" id="btn-tickets-today">Ce mois-ci</button>
        <button class="btn btn-secondary btn-sm" id="btn-tickets-next">Suivant →</button>
        <button class="btn btn-secondary" id="btn-export-tickets">Exporter CSV</button>
      </div>
    </div>

    <div class="kpi-grid">
      ${kpiCard('Tickets à émettre', totals.nbTickets, '🍽️')}
      ${kpiCard('Montant total', formatCurrencyFR(totals.montantTotal), '💶')}
      ${kpiCard('Part employeur', formatCurrencyFR(totals.partEmployeur), '🏢')}
      ${kpiCard('Part salarié', formatCurrencyFR(totals.partSalarie), '👤')}
    </div>

    <div class="card table-card">
      <table class="table">
        <thead><tr><th>Salarié</th><th>Tickets</th><th>Montant total</th><th>Part employeur</th><th>Part salarié</th>${canCorriger ? '<th></th>' : ''}</tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${escapeHtml(r.employee.prenom)} ${escapeHtml(r.employee.nom)}</td>
              <td>${r.result.nbTickets}${r.result.ajustement ? ` <span class="text-muted">(correction ${r.result.ajustement >= 0 ? '+' : ''}${r.result.ajustement})</span>` : ''}</td>
              <td>${formatCurrencyFR(r.result.montantTotal)}</td>
              <td>${formatCurrencyFR(r.result.partEmployeur)}</td>
              <td>${formatCurrencyFR(r.result.partSalarie)}</td>
              ${canCorriger ? `<td class="table-actions"><button class="btn-link" data-corriger-tickets="${r.employee.id}">Corriger</button></td>` : ''}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function openCorrigerTicketsModal(employeeId) {
  const employee = employeeRepository.getById(employeeId);
  if (!employee) { showToast('Ce salarié n\'est plus disponible.', 'error'); return; }
  const year = state.ticketsYear;
  const month = state.ticketsMonth;
  const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
  const current = (employee.ticketsAjustements && employee.ticketsAjustements[monthKey]) || 0;

  const html = `
    <div class="modal modal-small">
      <div class="modal-header">
        <h2>Corriger les tickets — ${MONTH_NAMES[month]} ${year}</h2>
        <button class="btn-icon" id="btn-close-modal" aria-label="Fermer" title="Fermer">✕</button>
      </div>
      <form id="corriger-tickets-form">
        <div class="modal-body">
          <p class="text-muted">${escapeHtml(employee.prenom)} ${escapeHtml(employee.nom)} — cette correction s'ajoute (ou se retranche, si négative) au calcul automatique pour ce mois. Elle remplace la correction précédente pour ce même mois.</p>
          <div class="form-field">
            <label for="f-delta">Correction (tickets, nombre entier, + ou -) *</label>
            <input class="input" type="number" id="f-delta" name="delta" step="1" value="${current}" required>
          </div>
          <div class="form-field" style="margin-top: 12px;">
            <label for="f-motif">Motif</label>
            <input class="input" type="text" id="f-motif" name="motif" placeholder="Ex. jour férié local non reconnu">
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Annuler</button>
          <button type="submit" class="btn btn-primary">Enregistrer</button>
        </div>
      </form>
    </div>
  `;

  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = html;
  modalRoot.classList.add('open');

  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
  document.getElementById('corriger-tickets-form').addEventListener('submit', (evt) => {
    evt.preventDefault();
    const delta = document.getElementById('f-delta').value;
    const motif = document.getElementById('f-motif').value;
    const result = employeeRepository.ajusterTickets(employeeId, year, month, delta, motif);
    if (!result.success) { showToast(result.error, 'error'); return; }
    showToast('Correction enregistrée.');
    closeModal();
    render();
  });
}

function bindTicketsEquipeEvents() {
  document.getElementById('btn-tickets-prev').addEventListener('click', () => shiftTicketsMonth(-1));
  document.getElementById('btn-tickets-next').addEventListener('click', () => shiftTicketsMonth(1));
  document.getElementById('btn-tickets-today').addEventListener('click', () => {
    const now = new Date();
    state.ticketsYear = now.getFullYear();
    state.ticketsMonth = now.getMonth();
    render();
  });
  document.getElementById('btn-export-tickets').addEventListener('click', exportTicketsCSV);

  document.querySelectorAll('[data-corriger-tickets]').forEach(btn => {
    btn.addEventListener('click', () => openCorrigerTicketsModal(btn.dataset.corrigerTickets));
  });
}

function shiftTicketsMonth(delta) {
  let month = state.ticketsMonth + delta;
  let year = state.ticketsYear;
  if (month < 0) { month = 11; year -= 1; }
  if (month > 11) { month = 0; year += 1; }
  state.ticketsMonth = month;
  state.ticketsYear = year;
  render();
}

function exportTicketsCSV() {
  const rows = getTicketsRows();
  const headers = ['Salarié', 'Tickets', 'Montant total', 'Part employeur', 'Part salarié'];
  const data = rows.map(r => [
    `${r.employee.prenom} ${r.employee.nom}`,
    r.result.nbTickets,
    formatNumberFR(r.result.montantTotal),
    formatNumberFR(r.result.partEmployeur),
    formatNumberFR(r.result.partSalarie)
  ]);
  exportRowsToCSV(headers, data, `tickets-restaurant-${state.ticketsYear}-${String(state.ticketsMonth + 1).padStart(2, '0')}.csv`);
  auditLogRepository.logAudit('Export', 'Tickets restaurant', `${MONTH_NAMES[state.ticketsMonth]} ${state.ticketsYear}`);
}

// ---------------------------------------------------------------------------
// Vue : Export paie — consolidation mensuelle congés / télétravail / tickets / frais
// ---------------------------------------------------------------------------

function getPaieRows(year, month) {
  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
  const monthStart = `${monthStr}-01`;
  const monthEnd = toISODate(new Date(year, month + 1, 0));
  // Filtre sur la période d'emploi DU MOIS EXPORTÉ, pas sur le statut actuel du salarié : un export
  // paie peut porter sur un mois passé, où un salarié aujourd'hui "Inactif"/déjà parti était encore
  // présent — le filtrer sur son statut live lui aurait fait perdre toutes ses données de ce mois-là
  // (congés, télétravail, notes de frais), pas seulement les jours après son départ.
  const employees = employeeRepository.getAll().filter(e => !e.archive && isEmployedDuringPeriod(e, monthStart, monthEnd));
  const leaveTypes = leaveTypeRepository.getLeaveTypes();
  const leaveTypesExportables = leaveTypes.filter(t => t.exportPaie);
  // Sprint SIRH premium §6 (Préparation de paie) : buckets fixes par nom de type, indépendants du
  // réglage "export paie" par type — le récapitulatif doit montrer les vraies données de congés/RTT/
  // maladie même si RH n'a pas coché ces types pour la colonne CSV (même principe que
  // calculateAbsenteeismRate, qui identifie déjà "Maladie" par son nom).
  const congesPayesTypeIds = getLeaveTypeIdsByName(leaveTypes, 'Congés payés');
  const rttTypeIds = getLeaveTypeIdsByName(leaveTypes, 'RTT');
  const maladieTypeIds = getLeaveTypeIdsByName(leaveTypes, 'Maladie');
  const leaveRequests = leaveRepository.getAll().filter(r => r.statut === 'Validé');
  const teleworkRequests = teleworkRepository.getAll().filter(r => r.statut === 'Validé');
  const expenses = expenseRepository.getAll().filter(n => n.statut === 'Remboursé');
  const settings = settingsRepository.getSettings();

  return employees.map(e => {
    const sumTypeIdsInMonth = (typeIds) => leaveRequests
      .filter(r => r.employeeId === e.id && typeIds.includes(r.typeId))
      .reduce((sum, r) => sum + countRequestDaysInMonth(r.dateDebut, r.dateFin, r.demiJournee, year, month, e, settings), 0);

    const congesParType = leaveTypesExportables.map(t => sumTypeIdsInMonth([t.id]));

    const teletravailJours = teleworkRequests
      .filter(r => r.employeeId === e.id)
      .reduce((sum, r) => sum + countRequestDaysInMonth(r.dateDebut, r.dateFin, false, year, month, e, settings), 0);

    const notesRembourser = expenses
      .filter(n => n.employeeId === e.id && n.date.startsWith(monthStr))
      .reduce((sum, n) => sum + n.montantTTC, 0);

    return {
      employee: e,
      congesParType,
      teletravailJours,
      tickets: calculateTicketsRestaurant(e, year, month, leaveRequests, teleworkRequests, settings),
      notesRembourser,
      congesPayesJours: sumTypeIdsInMonth(congesPayesTypeIds),
      rttJours: sumTypeIdsInMonth(rttTypeIds),
      maladieJours: sumTypeIdsInMonth(maladieTypeIds),
      // Sprint SIRH premium §6 : "Variables" du récapitulatif — saisie manuelle par mois (aucun
      // module ne les calcule automatiquement, cf. DB.ajusterVariablesPaie), même principe que
      // ticketsAjustements.
      variablesMontant: (e.variablesPaie && e.variablesPaie[`${year}-${String(month + 1).padStart(2, '0')}`]) || 0
    };
  });
}

/** Sprint SIRH premium §6 : anomalies à vérifier avant de lancer l'export paie du mois — Bloquantes
 * (fausserait un calcul de paie : solde négatif, dates hors période contractuelle), Avertissements
 * (risque qualité/légal mais qui ne fausse rien : justificatif manquant, données administratives
 * incomplètes), Informations (à connaître, pas une erreur : contrat qui se termine ce mois-ci). */
function getPaieAnomalies(year, month) {
  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
  const monthStart = `${monthStr}-01`;
  const monthEnd = toISODate(new Date(year, month + 1, 0));
  const employees = employeeRepository.getAll().filter(e => !e.archive && isEmployedDuringPeriod(e, monthStart, monthEnd));
  const leaveTypes = leaveTypeRepository.getLeaveTypes();
  const allLeaveRequests = leaveRepository.getAll();
  const validLeaveRequests = allLeaveRequests.filter(r => r.statut === 'Validé');
  const validTeleworkRequests = teleworkRepository.getAll().filter(r => r.statut === 'Validé');

  const isWithinEmploymentPeriod = (e, dateDebut, dateFin) =>
    Boolean(e.dateEmbauche) && dateDebut >= e.dateEmbauche && (!e.dateDepart || dateFin <= e.dateDepart);
  // "Absence incohérente"/"justificatif manquant" ne portent que sur les demandes qui chevauchent le
  // mois affiché : sans ça, une vieille donnée jamais corrigée resterait signalée indéfiniment sur
  // TOUS les mois futurs, noyant l'écran de préparation dans du bruit sans rapport avec la paie en cours.
  const overlapsMonth = (dateDebut, dateFin) => dateDebut <= monthEnd && dateFin >= monthStart;
  // Hoistés hors de la boucle par salarié : ne dépendent pas de `e`, recalculer/reconcaténer à
  // chaque itération serait du travail identique refait pour rien.
  const congeTypesFinis = leaveTypes.filter(t => t.categorie === 'conge' && t.acquisition !== 'Illimitée');
  const validLeaveAndTeleworkRequests = validLeaveRequests.concat(validTeleworkRequests);

  const anomalies = [];
  employees.forEach(e => {
    congeTypesFinis.forEach(t => {
      const balance = getLeaveBalance(e, t, allLeaveRequests, leaveTypes, monthEnd);
      if (balance.disponible < 0) {
        anomalies.push({ severity: 'bloquante', type: 'compteur_negatif', employee: e, message: `Solde "${t.nom}" négatif : ${formatDurationFR(balance.disponible)}` });
      }
    });

    validLeaveAndTeleworkRequests.filter(r => r.employeeId === e.id && overlapsMonth(r.dateDebut, r.dateFin)).forEach(r => {
      if (!isWithinEmploymentPeriod(e, r.dateDebut, r.dateFin)) {
        anomalies.push({ severity: 'bloquante', type: 'absence_incoherente', employee: e, message: `Demande du ${formatDate(r.dateDebut)} au ${formatDate(r.dateFin)} en dehors de la période contractuelle` });
      }
    });

    validLeaveRequests.filter(r => r.employeeId === e.id && overlapsMonth(r.dateDebut, r.dateFin)).forEach(r => {
      const type = leaveTypes.find(t => t.id === r.typeId);
      if (type && type.justificatifObligatoire && !r.justificatif) {
        anomalies.push({ severity: 'avertissement', type: 'justificatif_manquant', employee: e, message: `Justificatif manquant pour "${type.nom}" du ${formatDate(r.dateDebut)}` });
      }
    });

    const champsManquants = [];
    if (!e.numeroSecu) champsManquants.push('n° sécurité sociale');
    if (!e.salaireBrutMensuel) champsManquants.push('salaire brut mensuel');
    if (!e.matricule) champsManquants.push('matricule');
    if (champsManquants.length) {
      anomalies.push({ severity: 'avertissement', type: 'donnees_incompletes', employee: e, message: `Données manquantes : ${champsManquants.join(', ')}` });
    }

    if (e.dateDepart && e.dateDepart >= monthStart && e.dateDepart <= monthEnd) {
      anomalies.push({ severity: 'information', type: 'contrat_termine', employee: e, message: `Contrat terminé le ${formatDate(e.dateDepart)} — dernier mois de paie` });
    }
  });

  return anomalies;
}

/** Sprint SIRH premium §6 : "Préparation de paie" — étape de relecture des anomalies avant
 * l'export, désormais un onglet de l'écran existant (state.paieTab) plutôt qu'un nouvel écran, pour
 * rester sur le même point d'entrée sidebar/permission (EXPORTER_PAIE) déjà en place. Le bouton
 * "Exporter CSV" de l'onglet Export reste volontairement TOUJOURS actif même s'il existe des
 * anomalies bloquantes : un blocage technique dur serait risqué en production (faux positif un jour
 * de paie) — la relecture est mise en avant (onglet par défaut, bannière), pas mécaniquement forcée. */
function renderExportPaie() {
  const rows = getPaieRows(state.paieYear, state.paieMonth);
  const tab = state.paieTab || 'preparation';

  return `
    <div class="view-header-row">
      <div>
        <h1>Préparation de paie</h1>
        <p class="view-subtitle">${MONTH_NAMES[state.paieMonth]} ${state.paieYear} · ${rows.length} salarié${rows.length > 1 ? 's' : ''}</p>
      </div>
      <div class="detail-header-actions">
        <button class="btn btn-secondary btn-sm" id="btn-paie-prev">← Précédent</button>
        <button class="btn btn-secondary btn-sm" id="btn-paie-today">Ce mois-ci</button>
        <button class="btn btn-secondary btn-sm" id="btn-paie-next">Suivant →</button>
        ${tab === 'export' ? '<button class="btn btn-secondary" id="btn-export-paie">Exporter CSV</button>' : ''}
      </div>
    </div>
    <div class="tabs" style="margin-bottom: 10px;">
      <button class="tab ${tab === 'preparation' ? 'active' : ''}" data-paie-tab="preparation">Préparation &amp; anomalies</button>
      <button class="tab ${tab === 'export' ? 'active' : ''}" data-paie-tab="export">Export CSV</button>
    </div>
    ${tab === 'export' ? renderExportPaieExportTab(rows) : renderExportPaiePreparationTab(rows)}
  `;
}

function renderPaieAnomalyBadges(anomaliesForEmployee) {
  if (!anomaliesForEmployee.length) return '<span class="text-muted">—</span>';
  const counts = { bloquante: 0, avertissement: 0, information: 0 };
  anomaliesForEmployee.forEach(a => counts[a.severity]++);
  return [
    counts.bloquante ? `<span class="badge badge-danger">${counts.bloquante} bloquante${counts.bloquante > 1 ? 's' : ''}</span>` : '',
    counts.avertissement ? `<span class="badge badge-warning">${counts.avertissement} avert.</span>` : '',
    counts.information ? `<span class="badge badge-info">${counts.information} info</span>` : ''
  ].filter(Boolean).join(' ');
}

function renderExportPaiePreparationTab(rows) {
  const anomalies = getPaieAnomalies(state.paieYear, state.paieMonth);
  const bloquantes = anomalies.filter(a => a.severity === 'bloquante');
  const avertissements = anomalies.filter(a => a.severity === 'avertissement');
  const informations = anomalies.filter(a => a.severity === 'information');

  const anomalySection = (title, list, badgeClass) => !list.length ? '' : `
    <div class="card" style="margin-bottom: 12px;">
      <h3 style="margin-bottom: 8px;">${title} <span class="badge ${badgeClass}">${list.length}</span></h3>
      <ul class="anomaly-list">
        ${list.map(a => `<li><strong>${escapeHtml(a.employee.prenom)} ${escapeHtml(a.employee.nom)}</strong> — ${escapeHtml(a.message)}</li>`).join('')}
      </ul>
    </div>
  `;

  return `
    ${!anomalies.length ? `
      <div class="card" style="text-align: center; padding: 24px;">
        <div style="font-size: 32px;">✅</div>
        <p>Aucune anomalie détectée pour ${MONTH_NAMES[state.paieMonth]} ${state.paieYear}. Prêt pour l'export.</p>
      </div>
    ` : `
      ${anomalySection('🚫 Bloquantes — à corriger avant export', bloquantes, 'badge-danger')}
      ${anomalySection('⚠️ Avertissements', avertissements, 'badge-warning')}
      ${anomalySection('ℹ️ Informations', informations, 'badge-info')}
    `}

    <div class="card table-card">
      <h3 style="padding: 14px 14px 0;">Récapitulatif par salarié</h3>
      ${!rows.length ? `<div class="empty-state"><div class="empty-icon">🧾</div><p>Aucun salarié pour ce mois.</p></div>` : `
        <table class="table">
          <thead>
            <tr>
              <th>Salarié</th>
              <th>Congés payés</th>
              <th>RTT</th>
              <th>Maladie</th>
              <th>Télétravail</th>
              <th>Notes de frais</th>
              <th>Variables</th>
              <th>Tickets restaurant</th>
              <th>Anomalies</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td>${escapeHtml(r.employee.prenom)} ${escapeHtml(r.employee.nom)}</td>
                <td>${formatDurationFR(r.congesPayesJours)}</td>
                <td>${formatDurationFR(r.rttJours)}</td>
                <td>${formatDurationFR(r.maladieJours)}</td>
                <td>${formatDurationFR(r.teletravailJours)}</td>
                <td>${formatCurrencyFR(r.notesRembourser)}</td>
                <td>${formatCurrencyFR(r.variablesMontant)} <button type="button" class="btn-link" data-adjust-variables="${r.employee.id}" title="Ajuster les variables de paie">✎</button></td>
                <td>${r.tickets.nbTickets}</td>
                <td>${renderPaieAnomalyBadges(anomalies.filter(a => a.employee.id === r.employee.id))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>
  `;
}

function renderExportPaieExportTab(rows) {
  const settings = settingsRepository.getSettings();
  const modele = settings.exportPaieModele || 'generique';
  const colonnes = settings.exportPaieColonnes || { conges: true, teletravail: true, tickets: true, frais: true };
  const showColonne = (key) => modele !== 'personnalise' || colonnes[key];
  const leaveTypesExportables = showColonne('conges') ? leaveTypeRepository.getLeaveTypes().filter(t => t.exportPaie) : [];

  return `
    <div class="card">
      <p class="text-muted">Consolide, pour la paie du mois, les congés marqués « export paie » (paramétrable dans Congés → Types), le télétravail, les tickets restaurant et les notes de frais validées à rembourser.</p>
      <div class="form-grid" style="margin-top: 10px;">
        <div class="form-field">
          <label for="f-export-paie-modele">Modèle d'export (§34)</label>
          <select class="input" id="f-export-paie-modele">
            ${Object.entries(EXPORT_PAIE_MODELES).map(([key, m]) => `<option value="${key}" ${modele === key ? 'selected' : ''}>${escapeHtml(m.label)}</option>`).join('')}
          </select>
        </div>
      </div>
      <p class="text-muted" style="margin-top: 8px;">⚠️ Ces modèles fixent une convention de délimiteur courante mais ne garantissent pas une compatibilité exacte avec votre paramétrage réel — les formats d'import Sage/Silae/Cegid/ADP/PayFit sont propres à chaque client et à chaque version. Vérifiez et adaptez avant toute utilisation en production.</p>
      ${modele === 'personnalise' ? `
        <div class="form-grid" style="margin-top: 12px;">
          ${checkboxField('paieCol.conges', 'Congés', colonnes.conges)}
          ${checkboxField('paieCol.teletravail', 'Télétravail', colonnes.teletravail)}
          ${checkboxField('paieCol.tickets', 'Tickets restaurant', colonnes.tickets)}
          ${checkboxField('paieCol.frais', 'Notes de frais', colonnes.frais)}
        </div>
      ` : ''}
    </div>

    <div class="card table-card">
      ${rows.length === 0 ? `<div class="empty-state"><div class="empty-icon">📤</div><p>Aucun salarié à exporter pour ce mois.</p></div>` : `
        <table class="table">
          <thead>
            <tr>
              <th>Matricule</th>
              <th>Salarié</th>
              ${leaveTypesExportables.map(t => `<th>${escapeHtml(t.nom)}</th>`).join('')}
              ${showColonne('teletravail') ? '<th>Télétravail</th>' : ''}
              ${showColonne('tickets') ? '<th>Tickets resto</th><th>Part salarié tickets</th>' : ''}
              ${showColonne('frais') ? '<th>Frais à rembourser</th>' : ''}
              <th>Variables</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td>${escapeHtml(r.employee.matricule)}</td>
                <td>${escapeHtml(r.employee.prenom)} ${escapeHtml(r.employee.nom)}</td>
                ${showColonne('conges') ? r.congesParType.map(j => `<td>${formatDurationFR(j)}</td>`).join('') : ''}
                ${showColonne('teletravail') ? `<td>${formatDurationFR(r.teletravailJours)}</td>` : ''}
                ${showColonne('tickets') ? `<td>${r.tickets.nbTickets}</td><td>${formatCurrencyFR(r.tickets.partSalarie)}</td>` : ''}
                ${showColonne('frais') ? `<td>${formatCurrencyFR(r.notesRembourser)}</td>` : ''}
                <td>${formatCurrencyFR(r.variablesMontant)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>
  `;
}

function bindExportPaieEvents() {
  document.getElementById('btn-paie-prev').addEventListener('click', () => shiftPaieMonth(-1));
  document.getElementById('btn-paie-next').addEventListener('click', () => shiftPaieMonth(1));
  document.getElementById('btn-paie-today').addEventListener('click', () => {
    const now = new Date();
    state.paieYear = now.getFullYear();
    state.paieMonth = now.getMonth();
    render();
  });

  document.querySelectorAll('[data-paie-tab]').forEach(btn => {
    btn.addEventListener('click', () => { state.paieTab = btn.dataset.paieTab; render(); });
  });

  const exportBtn = document.getElementById('btn-export-paie');
  if (exportBtn) exportBtn.addEventListener('click', handleExportPaieClick);

  const modeleSelect = document.getElementById('f-export-paie-modele');
  if (modeleSelect) modeleSelect.addEventListener('change', (e) => {
    const settings = settingsRepository.getSettings();
    settings.exportPaieModele = e.target.value;
    settingsRepository.saveSettings(settings);
    render();
  });

  ['conges', 'teletravail', 'tickets', 'frais'].forEach(key => {
    const checkbox = document.getElementById(`f-paieCol.${key}`);
    if (checkbox) checkbox.addEventListener('change', (e) => {
      const settings = settingsRepository.getSettings();
      settings.exportPaieColonnes = Object.assign({}, settings.exportPaieColonnes, { [key]: e.target.checked });
      settingsRepository.saveSettings(settings);
      render();
    });
  });

  document.querySelectorAll('[data-adjust-variables]').forEach(btn => {
    btn.addEventListener('click', () => openVariablesPaieModal(btn.dataset.adjustVariables));
  });
}

/** Sprint SIRH premium §6 : "Variables" du récapitulatif de paie — aucun module ne les calcule
 * (primes/heures sup ponctuelles), saisie manuelle par mois, même modale que "Corriger les tickets"
 * (openCorrigerTicketsModal) mais un montant en euros plutôt qu'un nombre entier de tickets. */
function openVariablesPaieModal(employeeId) {
  const employee = employeeRepository.getById(employeeId);
  if (!employee) { showToast('Ce salarié n\'est plus disponible.', 'error'); return; }
  const year = state.paieYear;
  const month = state.paieMonth;
  const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
  const current = (employee.variablesPaie && employee.variablesPaie[monthKey]) || 0;

  const html = `
    <div class="modal modal-small">
      <div class="modal-header">
        <h2>Variables de paie — ${MONTH_NAMES[month]} ${year}</h2>
        <button class="btn-icon" id="btn-close-modal" aria-label="Fermer" title="Fermer">✕</button>
      </div>
      <form id="variables-paie-form">
        <div class="modal-body">
          <p class="text-muted">${escapeHtml(employee.prenom)} ${escapeHtml(employee.nom)} — primes, heures supplémentaires ou autre élément variable ponctuel pour ce mois (€). Remplace le montant précédemment saisi pour ce même mois.</p>
          <div class="form-field">
            <label for="f-montant">Montant (€) *</label>
            <input class="input" type="number" id="f-montant" name="montant" step="0.01" value="${current}" required>
          </div>
          <div class="form-field" style="margin-top: 12px;">
            <label for="f-motif">Motif</label>
            <input class="input" type="text" id="f-motif" name="motif" placeholder="Ex. prime exceptionnelle">
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Annuler</button>
          <button type="submit" class="btn btn-primary">Enregistrer</button>
        </div>
      </form>
    </div>
  `;

  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = html;
  modalRoot.classList.add('open');

  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
  document.getElementById('variables-paie-form').addEventListener('submit', (evt) => {
    evt.preventDefault();
    const montant = document.getElementById('f-montant').value;
    const motif = document.getElementById('f-motif').value;
    const result = employeeRepository.ajusterVariables(employeeId, year, month, montant, motif);
    if (!result.success) { showToast(result.error, 'error'); return; }
    showToast('Variables de paie enregistrées.');
    closeModal();
    render();
  });
}

function shiftPaieMonth(delta) {
  let month = state.paieMonth + delta;
  let year = state.paieYear;
  if (month < 0) { month = 11; year -= 1; }
  if (month > 11) { month = 0; year += 1; }
  state.paieMonth = month;
  state.paieYear = year;
  render();
}

/** csvEscape/exportRowsToCSV (SS17) sont figés sur ";" - reutilisés partout ailleurs dans l'app.
 * L'export paie a besoin d'un délimiteur configurable par modèle (SS34, EXPORT_PAIE_MODELES),
 * d'où ces variantes dédiées plutôt qu'un changement du comportement partagé. */
function csvEscapeWithDelimiter(value, delimiter) {
  const str = String(value === null || value === undefined ? '' : value);
  return (str.includes(delimiter) || str.includes('"') || str.includes('\n'))
    ? '"' + str.replace(/"/g, '""') + '"'
    : str;
}

function exportRowsToCSVWithDelimiter(headers, rows, filename, delimiter) {
  const csv = [headers, ...rows].map(row => row.map(v => csvEscapeWithDelimiter(v, delimiter)).join(delimiter)).join('\r\n');
  downloadTextFile(csv, filename, 'text/csv;charset=utf-8;');
}

/** Sprint SIRH premium §6 : "Ce module doit être obligatoire avant tout export." — un blocage
 * technique dur du bouton reste risqué (faux positif un jour de paie, cf. commentaire de
 * renderExportPaie), mais laisser l'export totalement silencieux ne rend pas la consultation des
 * anomalies bloquantes "obligatoire" pour autant. Compromis : une confirmation explicite s'affiche
 * s'il reste des anomalies bloquantes pour le mois exporté — l'utilisateur DOIT la voir et
 * l'acquitter, mais garde la main s'il juge que c'est un faux positif. */
function handleExportPaieClick() {
  const bloquantes = getPaieAnomalies(state.paieYear, state.paieMonth).filter(a => a.severity === 'bloquante');
  if (!bloquantes.length) { exportPaieCSV(); return; }
  openConfirm({
    title: 'Anomalies bloquantes non corrigées',
    message: `${bloquantes.length} anomalie${bloquantes.length > 1 ? 's' : ''} bloquante${bloquantes.length > 1 ? 's' : ''} pour ${MONTH_NAMES[state.paieMonth]} ${state.paieYear} (voir l'onglet "Préparation & anomalies"). Exporter quand même ?`,
    confirmLabel: 'Exporter quand même',
    danger: true,
    onConfirm: exportPaieCSV
  });
}

function exportPaieCSV() {
  const settings = settingsRepository.getSettings();
  const modele = settings.exportPaieModele || 'generique';
  const colonnes = settings.exportPaieColonnes || { conges: true, teletravail: true, tickets: true, frais: true };
  const showColonne = (key) => modele !== 'personnalise' || colonnes[key];
  const delimiter = (EXPORT_PAIE_MODELES[modele] || EXPORT_PAIE_MODELES.generique).delimiter;

  const leaveTypesExportables = showColonne('conges') ? leaveTypeRepository.getLeaveTypes().filter(t => t.exportPaie) : [];
  const rows = getPaieRows(state.paieYear, state.paieMonth);
  const headers = [
    'Matricule', 'Nom', 'Prénom',
    ...(showColonne('conges') ? leaveTypesExportables.map(t => `${t.nom} (jours)`) : []),
    ...(showColonne('teletravail') ? ['Télétravail (jours)'] : []),
    ...(showColonne('tickets') ? ['Tickets restaurant (nb)', 'Tickets — part salarié (€)'] : []),
    ...(showColonne('frais') ? ['Notes de frais à rembourser (€)'] : []),
    'Variables (€)' // Sprint SIRH premium §6 : toujours incluse (comme Matricule/Nom/Prénom), pas de case à cocher dédiée — donnée financière essentielle, pas un simple complément de congés/télétravail/tickets/frais
  ];
  const data = rows.map(r => [
    r.employee.matricule, r.employee.nom, r.employee.prenom,
    ...(showColonne('conges') ? r.congesParType.map(v => formatNumberFR(v)) : []),
    ...(showColonne('teletravail') ? [formatNumberFR(r.teletravailJours)] : []),
    ...(showColonne('tickets') ? [r.tickets.nbTickets, formatNumberFR(r.tickets.partSalarie)] : []),
    ...(showColonne('frais') ? [formatNumberFR(r.notesRembourser)] : []),
    formatNumberFR(r.variablesMontant)
  ]);
  exportRowsToCSVWithDelimiter(headers, data, `export-paie-${state.paieYear}-${String(state.paieMonth + 1).padStart(2, '0')}.csv`, delimiter);
  auditLogRepository.logAudit('Export', 'Export paie', `${MONTH_NAMES[state.paieMonth]} ${state.paieYear} · modèle ${EXPORT_PAIE_MODELES[modele].label}`);
}

// ---------------------------------------------------------------------------
// Formulaire salarié (création / édition) — Modale
// ---------------------------------------------------------------------------

/** Noms des équipes du service donné (par nom de service, cohérent avec employee.service en texte libre). */
function equipeOptionsForService(serviceNom) {
  const service = serviceRepository.getAll().find(s => s.nom === serviceNom);
  return service ? service.equipes.map(eq => eq.nom) : [];
}

function equipeSelectField(serviceNom, currentEquipe) {
  const options = equipeOptionsForService(serviceNom);
  return `
    <div class="form-field">
      <label for="f-equipe">Équipe</label>
      <select class="input" id="f-equipe" name="equipe">
        <option value="">—</option>
        ${options.map(nom => `<option value="${escapeHtml(nom)}" ${currentEquipe === nom ? 'selected' : ''}>${escapeHtml(nom)}</option>`).join('')}
      </select>
    </div>
  `;
}

function updateEquipeOptionsForSelectedService() {
  const serviceNom = document.getElementById('f-service').value;
  const equipeSelect = document.getElementById('f-equipe');
  const previousValue = equipeSelect.value;
  const options = equipeOptionsForService(serviceNom);
  equipeSelect.innerHTML = `<option value="">—</option>` +
    options.map(nom => `<option value="${escapeHtml(nom)}" ${nom === previousValue ? 'selected' : ''}>${escapeHtml(nom)}</option>`).join('');
}

/** Salaire/genre : édition réservée au Directeur, et seulement si l'entreprise a activé le suivi correspondant dans Paramètres. */
function renderConfidentialEmployeeFieldset(employee, settings) {
  const user = authRepository.getCurrentUser();
  if (!user || user.role !== ROLES.DIRECTEUR) return '';
  if (!settings.masseSalarialeActivee && !settings.suiviGenreActive) return '';
  return `
    <fieldset class="form-section">
      <legend>Confidentiel</legend>
      <div class="form-grid">
        ${settings.masseSalarialeActivee ? textField('salaireBrutMensuel', 'Salaire brut mensuel (€)', employee.salaireBrutMensuel, false, 'number') : ''}
        ${settings.suiviGenreActive ? selectField('genre', 'Genre', ['Homme', 'Femme', 'Autre'], employee.genre) : ''}
      </div>
    </fieldset>
  `;
}

function openEmployeeModal(id) {
  const isEdit = Boolean(id);
  const employee = isEdit ? employeeRepository.getById(id) : makeEmptyEmployee();
  const settings = settingsRepository.getSettings();
  const managers = employeeRepository.getAll().filter(e => e.id !== id && !e.archive);
  const categoriesSalarie = categorieSalarieRepository.getAll();
  const etablissements = etablissementRepository.getAll();
  const etablissementsActifs = etablissements.filter(e => e.actif);
  if (!isEdit && !employee.etablissementId) {
    employee.etablissementId = (etablissementsActifs.find(e => e.principal) || etablissementsActifs[0] || {}).id || '';
  }
  // Un établissement désactivé ne doit plus être proposable pour un NOUVEAU rattachement — mais un
  // salarié déjà rattaché à un établissement entre-temps désactivé garde son affectation visible,
  // avec son vrai nom (pas le fallback générique "valeur actuelle absente de la liste" de selectField,
  // qui échouerait ici à afficher autre chose que l'id brut).
  const etablissementsSelectables = etablissements.filter(e => e.actif || e.id === employee.etablissementId);

  const html = `
    <div class="modal modal-large">
      <div class="modal-header">
        <h2>${isEdit ? 'Modifier le salarié' : 'Nouveau salarié'}</h2>
        <button class="btn-icon" id="btn-close-modal" aria-label="Fermer" title="Fermer">✕</button>
      </div>
      <form id="employee-form">
        <div class="modal-body">
          <fieldset class="form-section">
            <legend>Identité</legend>
            <div class="form-grid">
              ${selectField('civilite', 'Civilité', ['M.', 'Mme'], employee.civilite)}
              ${textField('prenom', 'Prénom', employee.prenom, true)}
              ${textField('nom', 'Nom', employee.nom, true)}
              <div class="form-field">
                <label for="f-email">Email *</label>
                <input class="input" type="email" id="f-email" name="email" value="${escapeHtml(employee.email || '')}" required
                  data-check-duplicate-email="true" data-exclude-id="${escapeHtml(employee.id || '')}">
                <span class="field-warning" id="f-email-duplicate-warning">⚠ Cet email est déjà utilisé par un autre salarié de l'entreprise.</span>
              </div>
              ${textField('telephone', 'Téléphone', employee.telephone)}
              ${addressAutocompleteField('adresse.rue', 'Adresse', employee.adresse.rue, 'adresse.codePostal', 'adresse.ville')}
              ${textField('adresse.codePostal', 'Code postal', employee.adresse.codePostal)}
              ${textField('adresse.ville', 'Ville', employee.adresse.ville)}
              <div class="form-field">
                <label for="f-dateNaissance">Date de naissance</label>
                <input class="input" type="date" id="f-dateNaissance" name="dateNaissance" value="${escapeHtml(employee.dateNaissance || '')}" data-live-age="true">
                <span class="field-hint-computed" id="f-dateNaissance-age"></span>
              </div>
              ${textField('lieuNaissance', 'Lieu de naissance', employee.lieuNaissance)}
              ${textField('nationalite', 'Nationalité', employee.nationalite)}
              ${textField('numeroSecu', 'N° sécurité sociale', employee.numeroSecu)}
            </div>
          </fieldset>

          <fieldset class="form-section">
            <legend>Contrat &amp; poste</legend>
            <div class="form-grid">
              ${selectField('etablissementId', 'Établissement', null, employee.etablissementId, etablissementsSelectables.map(e => ({ value: e.id, label: e.actif ? e.nom : `${e.nom} (désactivé)` })))}
              ${selectField('service', 'Service', serviceRepository.getAll().map(s => s.nom), employee.service)}
              ${equipeSelectField(employee.service, employee.equipe)}
              ${selectField('poste', 'Poste', settings.postes, employee.poste)}
              ${multiSelectField('managerIds', 'Manager(s)', managers.map(m => ({ value: m.id, label: `${m.prenom} ${m.nom}` })), employee.managerIds)}
              ${selectField('conventionCollective', 'Convention collective', settings.conventionsCollectives, employee.conventionCollective)}
              ${selectField('categorieSalarieId', 'Catégorie de salarié', null, getEffectiveCategorieSalarieId(employee, categoriesSalarie), categoriesSalarie.map(c => ({ value: c.id, label: c.nom })))}
              ${selectField('typeContrat', 'Type de contrat', settings.typesContrat, employee.typeContrat)}
              <div class="form-field">
                <label for="f-dateEmbauche">Date d'embauche *</label>
                <input class="input" type="date" id="f-dateEmbauche" name="dateEmbauche" value="${escapeHtml(employee.dateEmbauche || '')}" required data-live-anciennete="true">
                <span class="field-hint-computed" id="f-dateEmbauche-anciennete"></span>
              </div>
              ${textField('dateFinContrat', 'Date de fin de contrat', employee.dateFinContrat, false, 'date')}
              ${textField('dateFinPeriodeEssai', 'Fin de période d\'essai', employee.dateFinPeriodeEssai, false, 'date')}
              ${textField('dateDernierEntretienProfessionnel', 'Dernier entretien professionnel', employee.dateDernierEntretienProfessionnel, false, 'date')}
            </div>
          </fieldset>

          <fieldset class="form-section">
            <legend>Temps de travail</legend>
            <div class="form-grid">
              ${selectField('tempsTravail', 'Temps de travail', ['Temps plein', 'Temps partiel'], employee.tempsTravail)}
              ${textField('pourcentageActivite', 'Pourcentage d\'activité', employee.pourcentageActivite, false, 'number')}
              ${textField('horairesHebdo', 'Heures hebdomadaires', employee.horairesHebdo, false, 'number')}
              ${selectField('forfait', 'Forfait', settings.forfaits, employee.forfait)}
              ${textField('regimeRTT', 'Régime RTT', employee.regimeRTT)}
            </div>
            <p class="text-muted" style="margin-top: 14px;">Horaires (identiques chaque jour travaillé) — utilisés par le Planning (§3).</p>
            <div class="form-grid">
              ${textField('horaireMatinDebut', 'Matin — début', employee.horaireMatinDebut || '09:00', false, 'time')}
              ${textField('horaireMatinFin', 'Matin — fin', employee.horaireMatinFin || '12:00', false, 'time')}
              ${textField('horaireApresMidiDebut', 'Après-midi — début', employee.horaireApresMidiDebut || '13:00', false, 'time')}
              ${textField('horaireApresMidiFin', 'Après-midi — fin', employee.horaireApresMidiFin || '17:00', false, 'time')}
            </div>
          </fieldset>

          <fieldset class="form-section">
            <legend>Statut</legend>
            <div class="form-grid">
              ${selectField('statut', 'Statut', ['Actif', 'Inactif'], employee.statut)}
              ${textField('dateDepart', 'Date de départ', employee.dateDepart, false, 'date')}
            </div>
          </fieldset>

          ${renderConfidentialEmployeeFieldset(employee, settings)}
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Annuler</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Enregistrer' : 'Créer le salarié'}</button>
        </div>
      </form>
    </div>
  `;

  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = html;
  modalRoot.classList.add('open');

  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
  document.getElementById('f-service').addEventListener('change', updateEquipeOptionsForSelectedService);
  document.getElementById('employee-form').addEventListener('submit', (evt) => submitEmployeeForm(evt, id));
}

/** Champ "Adresse" avec suggestions en direct (API Adresse gouv.fr, gratuite/sans clé) — remplace
 * un textField() simple là où une adresse française complète est saisie : sélectionner une
 * suggestion remplit aussi automatiquement le code postal et la ville, en évitant les fautes de
 * frappe/incohérences (ex. code postal qui ne correspond pas à la ville tapée à côté). */
function addressAutocompleteField(name, label, value, codePostalName, villeName) {
  return `
    <div class="form-field address-autocomplete-field">
      <label for="f-${name}">${escapeHtml(label)}</label>
      <input class="input" type="text" id="f-${name}" name="${name}" value="${escapeHtml(value != null ? value : '')}"
        autocomplete="off" data-address-autocomplete="true"
        data-fill-codepostal="f-${codePostalName}" data-fill-ville="f-${villeName}">
      <div class="address-suggestions" id="f-${name}-suggestions"></div>
    </div>
  `;
}

/** Champ "Raison sociale" avec suggestions en direct (même API que le SIRET ci-dessus, cherchée
 * cette fois par nom plutôt que par numéro — la plupart des gens connaissent le nom de leur
 * entreprise, pas leur SIRET par cœur) : choisir une suggestion remplit aussi le SIRET et l'adresse. */
function companyNameAutocompleteField(name, label, value, required, siretName, adresseName) {
  return `
    <div class="form-field address-autocomplete-field">
      <label for="f-${name}">${escapeHtml(label)}${required ? ' *' : ''}</label>
      <input class="input" type="text" id="f-${name}" name="${name}" value="${escapeHtml(value != null ? value : '')}" ${required ? 'required' : ''}
        autocomplete="off" data-company-autocomplete="true"
        data-fill-siret="f-${siretName}" data-fill-adresse="f-${adresseName}">
      <div class="address-suggestions" id="f-${name}-suggestions"></div>
    </div>
  `;
}

/** type='number' sans step : le navigateur applique step="1" par défaut et rejette silencieusement
 * toute décimale (aucun message d'erreur applicatif, juste un blocage natif facile à manquer) — donc
 * "any" par défaut ici, jamais 1, puisqu'aucun des champs numériques du formulaire (montants,
 * pourcentages, heures...) n'a de raison métier d'interdire les décimales. */
function textField(name, label, value, required, type = 'text', step = 'any') {
  return `
    <div class="form-field">
      <label for="f-${name}">${escapeHtml(label)}${required ? ' *' : ''}</label>
      <input class="input" type="${type}" id="f-${name}" name="${name}" value="${escapeHtml(value != null ? value : '')}" ${type === 'number' ? `step="${step}"` : ''} ${required ? 'required' : ''}>
    </div>
  `;
}

/** Si la valeur actuellement enregistrée ne correspond à aucune option (ex. la liste
 * paramétrable a été renommée depuis), on l'ajoute quand même comme option sélectionnée
 * plutôt que de la laisser disparaître silencieusement — sinon un simple "Enregistrer"
 * sans toucher au champ écrase la donnée d'origine par une valeur vide. */
function selectField(name, label, options, selectedValue, customOptions) {
  const opts = customOptions || (options || []).map(o => ({ value: o, label: o }));
  const hasValue = selectedValue !== undefined && selectedValue !== null && selectedValue !== '';
  const matchesOption = opts.some(o => String(o.value) === String(selectedValue));
  const staleOption = hasValue && !matchesOption
    ? `<option value="${escapeHtml(selectedValue)}" selected>${escapeHtml(selectedValue)} (valeur actuelle, absente de la liste)</option>`
    : '';
  return `
    <div class="form-field">
      <label for="f-${name}">${escapeHtml(label)}</label>
      <select class="input" id="f-${name}" name="${name}">
        <option value="">—</option>
        ${staleOption}
        ${opts.map(o => `<option value="${escapeHtml(o.value)}" ${String(selectedValue) === String(o.value) ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
      </select>
    </div>
  `;
}

function multiSelectField(name, label, customOptions, selectedValues) {
  const selected = new Set((selectedValues || []).map(String));
  return `
    <div class="form-field">
      <label for="f-${name}">${escapeHtml(label)}</label>
      <select class="input" id="f-${name}" name="${name}" multiple size="4">
        ${customOptions.map(o => `<option value="${escapeHtml(o.value)}" ${selected.has(String(o.value)) ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
      </select>
      <p class="text-muted" style="margin-top: 4px; font-size: 12px;">Ctrl/Cmd + clic pour sélectionner plusieurs managers.</p>
    </div>
  `;
}

function submitEmployeeForm(evt, id) {
  evt.preventDefault();
  const form = evt.target;
  const formData = new FormData(form);
  const patch = { adresse: {} };

  formData.forEach((value, key) => {
    if (key === 'managerIds') return; // géré séparément : un <select multiple> répète la même clé
    if (key.startsWith('adresse.')) {
      patch.adresse[key.split('.')[1]] = value;
    } else {
      patch[key] = value;
    }
  });

  // statutPro (texte libre) reste rempli en synchronisation avec la catégorie choisie, pour que les
  // exports/documents existants qui le lisent encore restent cohérents — categorieSalarieId (ci-
  // dessus, déjà dans patch via le name du select) est désormais la source de vérité pour les règles.
  if (patch.categorieSalarieId) {
    const categorie = categorieSalarieRepository.getById(patch.categorieSalarieId);
    if (categorie) patch.statutPro = categorie.nom;
  }

  const pourcentageActivite = Number(patch.pourcentageActivite) || 100;
  if (pourcentageActivite <= 0 || pourcentageActivite > 100) {
    showToast('Le pourcentage d\'activité doit être compris entre 1 et 100.', 'error');
    return;
  }
  patch.pourcentageActivite = pourcentageActivite;
  patch.horairesHebdo = Number(patch.horairesHebdo) || 35;
  patch.managerIds = formData.getAll('managerIds');
  if ('salaireBrutMensuel' in patch) patch.salaireBrutMensuel = Number(patch.salaireBrutMensuel) || 0;

  const emailTaken = employeeRepository.getAll().some(e =>
    e.id !== id && (e.email || '').toLowerCase().trim() === (patch.email || '').toLowerCase().trim());
  if (emailTaken) {
    showToast('Cet email est déjà utilisé par un autre salarié — la connexion serait ambiguë.', 'error');
    return;
  }

  if (patch.dateDepart && patch.dateEmbauche && patch.dateDepart < patch.dateEmbauche) {
    showToast('La date de départ ne peut pas être avant la date d\'embauche.', 'error');
    return;
  }
  if (patch.dateFinContrat && patch.dateEmbauche && patch.dateFinContrat < patch.dateEmbauche) {
    showToast('La date de fin de contrat ne peut pas être avant la date d\'embauche.', 'error');
    return;
  }

  if (id) {
    employeeRepository.update(id, patch);
    showToast('Salarié mis à jour.');
    closeModal();
    navigateTo('employee-detail', { currentEmployeeId: id });
  } else {
    // §36 : plafond de salariés de l'offre BERTOLIS — ne s'applique qu'à la création, pas à
    // l'édition (modifier un salarié existant ne change pas l'effectif).
    const abonnement = companyRepository.getCurrent().abonnement;
    const offre = (abonnement && OFFRES_BERTOLIS[abonnement.offre]) || OFFRES_BERTOLIS.essai;
    // Le plafond réel vient de abonnement.nombreSalariesMax (vraie colonne de subscriptions, mise
    // à jour par le webhook Stripe) — PAS du catalogue statique OFFRES_BERTOLIS, qui ne reflète pas
    // le cas d'une entreprise pas encore souscrite (plafond à 1 en attendant, voir migration 0012).
    const plafond = abonnement ? abonnement.nombreSalariesMax : offre.nombreSalariesMax;
    const nbActifs = employeeRepository.getAll().filter(e => !e.archive).length;
    if (plafond !== null && nbActifs >= plafond) {
      showToast(`Plafond de l'offre « ${offre.label} » atteint (${plafond} salarié${plafond > 1 ? 's' : ''}). ${abonnement && abonnement.statut === 'non_souscrit' ? 'Souscrivez une offre pour ajouter d\'autres salariés.' : 'Contactez BERTOLIS pour changer d\'offre.'}`, 'error');
      return;
    }
    const created = employeeRepository.create(patch);
    showToast('Salarié créé.');
    closeModal();
    navigateTo('employee-detail', { currentEmployeeId: created.id });
  }
}

function closeModal() {
  const modalRoot = document.getElementById('modal-root');
  modalRoot.classList.remove('open');
  modalRoot.innerHTML = '';
  if (lastFocusedBeforeModal && document.contains(lastFocusedBeforeModal)) lastFocusedBeforeModal.focus();
  lastFocusedBeforeModal = null;
}

// ---------------------------------------------------------------------------
// Boîte de confirmation réutilisable
// ---------------------------------------------------------------------------

function openConfirm({ title, message, confirmLabel, onConfirm, danger }) {
  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = `
    <div class="modal modal-small">
      <div class="modal-header">
        <h2>${escapeHtml(title)}</h2>
      </div>
      <div class="modal-body">
        <p>${escapeHtml(message)}</p>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="btn-confirm-cancel">Annuler</button>
        <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="btn-confirm-ok">${escapeHtml(confirmLabel)}</button>
      </div>
    </div>
  `;
  modalRoot.classList.add('open');
  document.getElementById('btn-confirm-cancel').addEventListener('click', closeModal);
  document.getElementById('btn-confirm-ok').addEventListener('click', () => {
    closeModal();
    onConfirm();
  });
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-root');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add('visible'), 10);
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ---------------------------------------------------------------------------
// Délégation des liens de navigation internes (data-nav)
// ---------------------------------------------------------------------------

document.addEventListener('click', (e) => {
  const navBtn = e.target.closest('[data-nav]');
  if (navBtn) navigateTo(navBtn.dataset.nav, navBtn.dataset.navParams ? JSON.parse(navBtn.dataset.navParams) : {});
});

// ---------------------------------------------------------------------------
// Utilitaire de sécurité : échappement HTML avant injection dans le DOM
// ---------------------------------------------------------------------------

/** Minuscule + suppression des diacritiques ("Müller"/"Périgueux" → "muller"/"perigueux") — utilisé
 * partout où une recherche compare une saisie utilisateur à des données réelles, pour que la casse
 * et les accents ne fassent jamais échouer un résultat qui devrait matcher. */
function normalizeForSearch(value) {
  return (value || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function escapeHtml(value) {
  const str = value === null || value === undefined ? '' : String(value);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

