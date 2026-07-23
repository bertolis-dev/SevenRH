/**
 * Seven RH — Logique applicative
 * Navigation, rendu des vues, formulaires et interactions.
 * Dépend de data.js (DB, helpers de calcul, seed).
 */

const LIST_PAGE_SIZE = 20;

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
    calendarYear: new Date().getFullYear(),
    calendarMonth: new Date().getMonth(),
    parametresTab: 'listes',
    parametresFeriesYear: new Date().getFullYear(),
    teletravailTab: 'demandes',
    teletravailFilters: { employeeId: '', statut: '' },
    teletravailPage: 1,
    teletravailWeekOffset: 0,
    fraisFilters: { employeeId: '', categorie: '', statut: '' },
    fraisPage: 1,
    ticketsYear: new Date().getFullYear(),
    ticketsMonth: new Date().getMonth(),
    notifTab: 'non-lues',
    paieYear: new Date().getFullYear(),
    paieMonth: new Date().getMonth(),
    authView: 'login', // 'login' | 'forgot' | 'reset'
    authError: '',
    pendingReset: null, // { token, employeeName } après une demande de réinitialisation
    onboarding: null, // brouillon de l'assistant de première installation, voir openOnboardingWizard()
    planningView: 'semaine', // 'semaine' | 'mois' | 'annee'
    planningFilters: { service: '' },
    planningWeekOffset: 0,
    planningYear: new Date().getFullYear(),
    planningMonth: new Date().getMonth(),
    auditFilters: { action: '', search: '', dateDebut: '', dateFin: '' },
    auditPage: 1
  };
}

const state = getInitialViewState();

// roles: qui voit l'entrée de menu. 'employees' reste visible au manager, mais
// affiché et filtré comme "Mon équipe" (voir renderEmployeesList).
const NAV_ITEMS = [
  { key: 'dashboard', label: 'Tableau de bord', icon: '📊', roles: ['salarie', 'manager', 'rh', 'comptabilite', 'directeur'] },
  { key: 'employees', label: 'Salariés', icon: '👥', roles: ['manager', 'rh', 'directeur'], permissions: [PERMISSIONS.VOIR_SALARIES, PERMISSIONS.VOIR_EQUIPE] },
  { key: 'organigramme', label: 'Organigramme', icon: '🗂️', roles: ['manager', 'rh', 'directeur'] },
  { key: 'conges', label: 'Congés', icon: '🏖️', roles: ['salarie', 'manager', 'rh', 'directeur'] },
  { key: 'autres-absences', label: 'Autres absences', icon: '🩺', roles: ['salarie', 'manager', 'rh', 'directeur'] },
  { key: 'calendrier', label: 'Calendrier', icon: '📅', roles: ['salarie', 'manager', 'rh', 'comptabilite', 'directeur'] },
  { key: 'planning', label: 'Planning', icon: '🗓️', roles: ['manager', 'rh', 'directeur'] },
  { key: 'teletravail', label: 'Télétravail', icon: '💻', roles: ['salarie', 'manager', 'rh', 'directeur'] },
  { key: 'frais', label: 'Notes de frais', icon: '🧾', roles: ['salarie', 'manager', 'rh', 'comptabilite', 'directeur'] },
  { key: 'mes-documents', label: 'Mes documents', icon: '📁', roles: ['salarie'] },
  { key: 'tickets', label: 'Tickets restaurant', icon: '🍽️', roles: ['rh', 'comptabilite', 'directeur'], permissions: [PERMISSIONS.CALCULER_TICKETS_RESTAURANT] },
  { key: 'export-paie', label: 'Export paie', icon: '📤', roles: ['rh', 'directeur'], permissions: [PERMISSIONS.EXPORTER_PAIE] },
  { key: 'parametres', label: 'Paramètres', icon: '⚙️', roles: ['rh', 'directeur'], permissions: [PERMISSIONS.GERER_PARAMETRES] }
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

document.addEventListener('DOMContentLoaded', () => {
  DB.onSaveError = (message) => showToast(message, 'error');
  DB.init();
  applyTheme();
  document.getElementById('btn-theme-toggle').addEventListener('click', cycleTheme);
  bindGlobalEvents();
  bindGlobalSearchEvents();
  bindNotificationEvents();
  bindUserMenuEvents();

  if (DB.isBertolisLoggedIn()) {
    showBertolisConsole();
  } else if (DB.isLoggedIn()) {
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
  state.authView = 'login';
  state.authError = '';
  renderLoginScreen();
}

function showApp() {
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
  const companies = DB.getAllCompaniesForBertolis();
  const root = document.getElementById('bertolis-root');

  root.innerHTML = `
    <header class="bertolis-topbar">
      <div class="login-logo"><span class="logo-mark">7</span> Seven RH <span class="badge badge-info">Console BERTOLIS</span></div>
      <div>
        <span class="text-muted">${escapeHtml(admin.prenom)} ${escapeHtml(admin.nom)}</span>
        <button type="button" class="btn btn-secondary btn-sm" id="btn-bertolis-logout" style="margin-left: 10px;">Déconnexion</button>
      </div>
    </header>
    <main class="bertolis-main">
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
              const statutBadge = { actif: 'success', impaye: 'warning', suspendu: 'warning', resilie: 'muted' }[c.abonnement.statut] || 'muted';
              return `
                <tr>
                  <td>${escapeHtml(c.raisonSociale)}</td>
                  <td>${escapeHtml(offre.label)}</td>
                  <td><span class="badge badge-${statutBadge}">${escapeHtml(ABONNEMENT_STATUT_LABELS[c.abonnement.statut] || c.abonnement.statut)}</span></td>
                  <td>${c.nombreSalaries}${offre.nombreSalariesMax !== null ? ` / ${offre.nombreSalariesMax}` : ''}</td>
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
    </main>
  `;

  document.getElementById('btn-bertolis-logout').addEventListener('click', () => {
    DB.bertolisLogout();
    showLogin();
  });

  document.querySelectorAll('[data-bertolis-statut]').forEach(select => {
    select.addEventListener('change', (e) => {
      DB.updateCompanyAbonnementStatut(e.target.dataset.bertolisStatut, e.target.value);
      showToast('Statut de l\'abonnement mis à jour.');
      renderBertolisConsole();
    });
  });
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
  } else if (state.authView === 'bertolis') {
    root.innerHTML = renderBertolisLoginView();
  } else {
    root.innerHTML = renderLoginView();
  }

  bindLoginScreenEvents();
}

function renderLoginView() {
  const employees = employeeRepository.getAll().filter(e => !e.archive);
  const companies = DB.getCompanies();
  return `
    <div class="login-card">
      <div class="login-logo"><span class="logo-mark">7</span> Seven RH</div>
      ${companies.length > 1 ? `
        <div class="form-field">
          <label for="f-company-switcher">Entreprise</label>
          <select class="input" id="f-company-switcher">
            ${companies.map(c => `<option value="${c.id}" ${c.id === DB.getCurrentCompanyId() ? 'selected' : ''}>${escapeHtml(c.raisonSociale)}</option>`).join('')}
          </select>
        </div>
      ` : ''}
      <h1>Connexion</h1>
      <form id="login-form">
        <div class="form-field">
          <label for="f-login-email">Email</label>
          <input class="input" type="email" id="f-login-email" required autocomplete="username">
        </div>
        <div class="form-field">
          <label for="f-login-password">Mot de passe</label>
          <input class="input" type="password" id="f-login-password" required autocomplete="current-password">
        </div>
        ${state.authError ? `<p class="login-error" role="alert">${escapeHtml(state.authError)}</p>` : ''}
        <button type="submit" class="btn btn-primary" style="width: 100%;">Se connecter</button>
      </form>
      <button type="button" class="btn-link" id="btn-forgot-password">Mot de passe oublié ?</button>

      <div class="login-demo-accounts">
        <p class="text-muted">Comptes de démonstration (mot de passe : <code>Demo1234</code>)</p>
        ${employees.map(e => `
          <button type="button" class="login-demo-account" data-demo-email="${escapeHtml(e.email)}">
            <span>${escapeHtml(e.prenom)} ${escapeHtml(e.nom)}</span>
            <span class="badge badge-info">${escapeHtml(ROLE_LABELS[e.role] || e.role)}</span>
          </button>
        `).join('')}
      </div>

      <button type="button" class="btn-link" id="btn-bertolis-login" style="margin-top: 10px; opacity: 0.6;">🔧 Accès BERTOLIS (éditeur)</button>
    </div>
  `;
}

/** Écran de connexion séparé de celui des salariés d'entreprise (§9.6) — voir
 * DB.bertolisLogin()/showBertolisConsole(). */
function renderBertolisLoginView() {
  return `
    <div class="login-card">
      <div class="login-logo"><span class="logo-mark">7</span> Seven RH <span class="badge badge-info">BERTOLIS</span></div>
      <h1>Accès éditeur</h1>
      <p class="text-muted">Réservé à l'équipe BERTOLIS — gestion des entreprises clientes et des abonnements (§9.6). Ce n'est pas un compte salarié.</p>
      <form id="bertolis-login-form">
        <div class="form-field">
          <label for="f-bertolis-email">Email</label>
          <input class="input" type="email" id="f-bertolis-email" required autocomplete="username">
        </div>
        <div class="form-field">
          <label for="f-bertolis-password">Mot de passe</label>
          <input class="input" type="password" id="f-bertolis-password" required autocomplete="current-password">
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
        <div class="login-logo"><span class="logo-mark">7</span> Seven RH</div>
        <h1>Mot de passe oublié</h1>
        <p class="text-muted">
          Compte trouvé pour <strong>${escapeHtml(state.pendingReset.employeeName)}</strong>.
          En production, un lien serait envoyé par email ; ici, cliquez directement dessus :
        </p>
        <button type="button" class="btn btn-primary" style="width: 100%;" id="btn-open-reset">Réinitialiser mon mot de passe</button>
        <button type="button" class="btn-link" id="btn-back-to-login">Retour à la connexion</button>
      </div>
    `;
  }

  return `
    <div class="login-card">
      <div class="login-logo"><span class="logo-mark">7</span> Seven RH</div>
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
      <div class="login-logo"><span class="logo-mark">7</span> Seven RH</div>
      <h1>Nouveau mot de passe</h1>
      <form id="reset-password-form">
        <div class="form-field">
          <label for="f-reset-password">Nouveau mot de passe</label>
          <input class="input" type="password" id="f-reset-password" required minlength="6">
        </div>
        <div class="form-field">
          <label for="f-reset-password-confirm">Confirmation</label>
          <input class="input" type="password" id="f-reset-password-confirm" required minlength="6">
        </div>
        ${state.authError ? `<p class="login-error" role="alert">${escapeHtml(state.authError)}</p>` : ''}
        <button type="submit" class="btn btn-primary" style="width: 100%;">Valider</button>
      </form>
      <button type="button" class="btn-link" id="btn-back-to-login">Retour à la connexion</button>
    </div>
  `;
}

function bindLoginScreenEvents() {
  const companySwitcher = document.getElementById('f-company-switcher');
  if (companySwitcher) {
    companySwitcher.addEventListener('change', (e) => {
      DB.setCurrentCompanyId(e.target.value);
      renderLoginScreen();
    });
  }

  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', (evt) => {
      evt.preventDefault();
      const email = document.getElementById('f-login-email').value;
      const password = document.getElementById('f-login-password').value;
      const result = DB.login(email, password);
      if (!result.success) {
        state.authError = result.error;
        renderLoginScreen();
        return;
      }
      showApp();
    });
  }

  document.querySelectorAll('.login-demo-account').forEach(btn => {
    btn.addEventListener('click', () => {
      const result = DB.login(btn.dataset.demoEmail, 'Demo1234');
      if (!result.success) { state.authError = result.error; renderLoginScreen(); return; }
      showApp();
    });
  });

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

  const backBtn = document.getElementById('btn-back-to-login');
  if (backBtn) backBtn.addEventListener('click', () => {
    state.authView = 'login';
    state.authError = '';
    state.pendingReset = null;
    renderLoginScreen();
  });

  const forgotForm = document.getElementById('forgot-password-form');
  if (forgotForm) forgotForm.addEventListener('submit', (evt) => {
    evt.preventDefault();
    const email = document.getElementById('f-forgot-email').value;
    const result = DB.requestPasswordReset(email);
    if (!result.success) { state.authError = result.error; renderLoginScreen(); return; }
    state.authError = '';
    state.pendingReset = { token: result.token, employeeName: result.employeeName };
    renderLoginScreen();
  });

  const openResetBtn = document.getElementById('btn-open-reset');
  if (openResetBtn) openResetBtn.addEventListener('click', () => {
    state.authView = 'reset';
    state.authError = '';
    renderLoginScreen();
  });

  const resetForm = document.getElementById('reset-password-form');
  if (resetForm) resetForm.addEventListener('submit', (evt) => {
    evt.preventDefault();
    const p1 = document.getElementById('f-reset-password').value;
    const p2 = document.getElementById('f-reset-password-confirm').value;
    if (p1 !== p2) { state.authError = 'Les deux mots de passe ne correspondent pas.'; renderLoginScreen(); return; }
    const result = DB.resetPasswordWithToken(state.pendingReset.token, p1);
    if (!result.success) { state.authError = result.error; renderLoginScreen(); return; }
    state.pendingReset = null;
    state.authView = 'login';
    state.authError = '';
    renderLoginScreen();
    showToast('Mot de passe réinitialisé, vous pouvez vous connecter.');
  });
}

// ---- Menu utilisateur (topbar) : rôle, changement de mot de passe, déconnexion ----

function renderUserMenuButton() {
  const user = DB.getCurrentUser();
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
  const user = DB.getCurrentUser();
  const panel = document.getElementById('user-menu-panel');
  if (!user) { panel.innerHTML = ''; return; }

  panel.innerHTML = `
    <div class="user-menu-header">
      <div class="user-menu-name">${escapeHtml(user.prenom)} ${escapeHtml(user.nom)}</div>
      <span class="badge badge-info">${escapeHtml(ROLE_LABELS[user.role] || user.role)}</span>
    </div>
    <button type="button" class="user-menu-item" id="btn-change-password">Modifier mon mot de passe</button>
    <button type="button" class="user-menu-item" id="btn-export-my-data">Télécharger mes données (RGPD)</button>
    <button type="button" class="user-menu-item" id="btn-logout">Se déconnecter</button>
  `;

  document.getElementById('btn-change-password').addEventListener('click', () => {
    document.getElementById('user-menu-panel').classList.remove('open');
    openChangePasswordModal();
  });
  document.getElementById('btn-export-my-data').addEventListener('click', () => {
    document.getElementById('user-menu-panel').classList.remove('open');
    exportMyDataRGPD();
  });
  document.getElementById('btn-logout').addEventListener('click', () => {
    DB.logout();
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
  const user = DB.getCurrentUser();
  const employee = employeeRepository.getById(user.id);
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

  DB.logAudit('Export', 'Données personnelles (RGPD)', `${employee.prenom} ${employee.nom} (auto-export)`);
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
            <input class="input" type="password" id="f-current-password" required>
          </div>
          <div class="form-field" style="margin-top: 12px;">
            <label for="f-new-password">Nouveau mot de passe</label>
            <input class="input" type="password" id="f-new-password" required minlength="6">
          </div>
          <div class="form-field" style="margin-top: 12px;">
            <label for="f-new-password-confirm">Confirmation</label>
            <input class="input" type="password" id="f-new-password-confirm" required minlength="6">
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
    const result = DB.changePassword(DB.getCurrentUser().id, current, p1);
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
      ${textField('ob-raisonSociale', 'Raison sociale', p.raisonSociale, true)}
      ${textField('ob-siret', 'SIRET', p.siret)}
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
      ${textField('ob-etab-adresse', 'Adresse', e.adresse)}
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
    DB.login(admin.email, admin.motDePasse);
    showApp();
    showToast(`Entreprise "${profile.raisonSociale}" créée avec succès.`);
  });
}

function bindGlobalEvents() {
  const modalRoot = document.getElementById('modal-root');
  modalRoot.addEventListener('click', (e) => {
    if (e.target.id === 'modal-root') closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
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

function performGlobalSearch(term) {
  const q = term.trim().toLowerCase();
  if (!q) return [];
  const results = [];
  const visibleIds = getVisibleEmployeeIdsForCurrentUser();
  const isVisible = (employeeId) => visibleIds === null || visibleIds.includes(employeeId);

  employeeRepository.getAll().filter(e => !e.archive && isVisible(e.id)).forEach(e => {
    const haystack = `${e.prenom} ${e.nom} ${e.matricule} ${e.email} ${e.poste} ${e.service}`.toLowerCase();
    if (haystack.includes(q)) {
      results.push({
        icon: DB.isFavoriteEmployee(e.id) ? '⭐' : '👤',
        label: `${e.prenom} ${e.nom}`,
        sublabel: e.poste || e.service || 'Salarié',
        nav: 'employee-detail',
        params: { currentEmployeeId: e.id }
      });
    }
  });

  leaveRepository.getAll().forEach(r => {
    const employee = employeeRepository.getById(r.employeeId);
    const type = DB.getLeaveTypeById(r.typeId);
    if (!employee || !type || !isVisible(employee.id)) return;
    const haystack = `${employee.prenom} ${employee.nom} ${type.nom} congé`.toLowerCase();
    if (haystack.includes(q)) {
      results.push({
        icon: type.icone,
        label: `${employee.prenom} ${employee.nom} · ${type.nom}`,
        sublabel: `Congé · ${formatDate(r.dateDebut)} · ${r.statut}`,
        nav: 'conges',
        params: { congesTab: 'demandes' }
      });
    }
  });

  teleworkRepository.getAll().forEach(r => {
    const employee = employeeRepository.getById(r.employeeId);
    if (!employee || !isVisible(employee.id)) return;
    if (`${employee.prenom} ${employee.nom} télétravail`.toLowerCase().includes(q)) {
      results.push({
        icon: '💻',
        label: `${employee.prenom} ${employee.nom}`,
        sublabel: `Télétravail · ${formatDate(r.dateDebut)} · ${r.statut}`,
        nav: 'teletravail',
        params: { teletravailTab: 'demandes' }
      });
    }
  });

  expenseRepository.getAll().forEach(n => {
    const employee = employeeRepository.getById(n.employeeId);
    if (!employee || !isVisible(employee.id)) return;
    const haystack = `${employee.prenom} ${employee.nom} ${n.categorie} ${n.libelle}`.toLowerCase();
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
  const favorites = DB.getFavoriteEmployeeIds()
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
  return DB.getNotifications().filter(n => !n.employeeId || visibleIds === null || visibleIds.includes(n.employeeId));
}

/** Détecte les événements notifiables actuels et crée les notifications manquantes (idempotent). */
function syncNotifications() {
  const candidates = [];

  leaveRepository.getAll().filter(r => r.statut === 'En attente').forEach(r => {
    const employee = employeeRepository.getById(r.employeeId);
    const type = DB.getLeaveTypeById(r.typeId);
    if (!employee || !type) return;
    candidates.push(makeNotification(`leave-${r.id}`, '🏖️', 'Demande de congé en attente',
      `${employee.prenom} ${employee.nom} · ${type.nom}`, 'conges', { congesTab: 'demandes' }, employee.id));
  });

  teleworkRepository.getAll().filter(r => r.statut === 'En attente').forEach(r => {
    const employee = employeeRepository.getById(r.employeeId);
    if (!employee) return;
    candidates.push(makeNotification(`telework-${r.id}`, '💻', 'Demande de télétravail en attente',
      `${employee.prenom} ${employee.nom}`, 'teletravail', { teletravailTab: 'demandes' }, employee.id));
  });

  expenseRepository.getAll().filter(n => n.statut === 'En attente').forEach(n => {
    const employee = employeeRepository.getById(n.employeeId);
    if (!employee) return;
    candidates.push(makeNotification(`expense-${n.id}`, '🧾', 'Note de frais en attente',
      `${employee.prenom} ${employee.nom} · ${n.libelle}`, 'frais', {}, employee.id));
  });

  getUpcomingBirthdays(7).forEach(x => {
    candidates.push(makeNotification(`birthday-${x.employee.id}-${x.next.getFullYear()}`, '🎂', 'Anniversaire à venir',
      `${x.employee.prenom} ${x.employee.nom} · ${formatDate(toISODate(x.next))}`, 'employee-detail', { currentEmployeeId: x.employee.id }, x.employee.id));
  });

  getUpcomingContractEnds(14).forEach(e => {
    candidates.push(makeNotification(`contract-end-${e.id}-${e.dateFinContrat}`, '📄', 'Fin de contrat proche',
      `${e.prenom} ${e.nom} · ${formatDate(e.dateFinContrat)}`, 'employee-detail', { currentEmployeeId: e.id }, e.id));
  });

  getUpcomingProbationEnds(14).forEach(e => {
    candidates.push(makeNotification(`probation-end-${e.id}-${e.dateFinPeriodeEssai}`, '📄', 'Fin de période d\'essai proche',
      `${e.prenom} ${e.nom} · ${formatDate(e.dateFinPeriodeEssai)}`, 'employee-detail', { currentEmployeeId: e.id }, e.id));
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

  DB.addNotificationsIfNew(candidates);
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
      DB.markAllNotificationsRead();
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
      const notif = DB.getNotifications().find(n => n.id === el.dataset.notifOpen);
      DB.markNotificationRead(el.dataset.notifOpen, true);
      document.getElementById('notif-panel').classList.remove('open');
      updateNotifBadge();
      if (notif) navigateTo(notif.nav, notif.params);
    });
  });

  document.querySelectorAll('[data-notif-archive]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      DB.setNotificationArchived(el.dataset.notifArchive, true);
      updateNotifBadge();
      renderNotifPanel();
    });
  });

  document.querySelectorAll('[data-notif-unarchive]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      DB.setNotificationArchived(el.dataset.notifUnarchive, false);
      updateNotifBadge();
      renderNotifPanel();
    });
  });
}

function navigateTo(view, params = {}) {
  const user = DB.getCurrentUser();
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

function renderSidebar() {
  const user = DB.getCurrentUser();
  if (!user) return;
  const items = navItemsForRole(user);
  const nav = document.getElementById('sidebar-nav');

  nav.innerHTML = items.map(item => {
    const label = item.key === 'employees' && user.role === 'manager' ? 'Mon équipe' : item.label;
    return `
    <button class="nav-item ${state.view === item.key ? 'active' : ''}" data-view="${item.key}" aria-label="${escapeHtml(label)}">
      <span class="nav-icon">${item.icon}</span>
      <span class="nav-label">${escapeHtml(label)}</span>
    </button>
  `;
  }).join('');

  nav.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.view));
  });
}

// ---------------------------------------------------------------------------
// Rendu principal
// ---------------------------------------------------------------------------

function render() {
  const root = document.getElementById('view-root');
  switch (state.view) {
    case 'dashboard':
      root.innerHTML = renderDashboard();
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
    case 'employee-detail':
      root.innerHTML = renderEmployeeDetail(state.currentEmployeeId);
      bindEmployeeDetailEvents();
      break;
    case 'conges':
      root.innerHTML = renderConges();
      bindCongesEvents();
      break;
    case 'autres-absences':
      root.innerHTML = renderAutresAbsences();
      bindAutresAbsencesEvents();
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
    case 'teletravail':
      root.innerHTML = renderTeletravail();
      bindTeletravailEvents();
      break;
    case 'frais':
      root.innerHTML = renderFrais();
      bindFraisEvents();
      break;
    case 'tickets':
      root.innerHTML = renderTickets();
      bindTicketsEvents();
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

/** Le tableau de bord est différent par rôle : vue personnelle (Salarié), vue équipe (Manager), vue entreprise (RH/Comptabilité), vue entreprise + indicateurs avancés (Directeur). */
function renderDashboard() {
  const user = DB.getCurrentUser();
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
  const settings = DB.getSettings();
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

  const user = DB.getCurrentUser();
  const showPresenceCard = user && [ROLES.MANAGER, ROLES.RH, ROLES.DIRECTEUR].includes(user.role);

  return `
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

    <div class="dashboard-grid">
      ${renderUpcomingBirthdaysCard(birthdays)}
      ${renderUpcomingContractEndsCard(contractEnds)}
    </div>

    ${showPresenceCard ? renderPresenceCard() : ''}
  `;
}

function renderDashboardShortcuts() {
  return `
    <div class="card">
      <h2>Raccourcis</h2>
      <button class="btn btn-primary" data-nav="employees">Gérer les salariés</button>
      <button class="btn btn-secondary" data-nav="conges">Gérer les congés</button>
      <button class="btn btn-secondary" data-nav="calendrier">Voir le calendrier</button>
      <button class="btn btn-secondary" data-nav="teletravail">Gérer le télétravail</button>
      <button class="btn btn-secondary" data-nav="frais">Gérer les notes de frais</button>
      <button class="btn btn-secondary" data-nav="tickets">Voir les tickets restaurant</button>
    </div>
  `;
}

function renderDashboardRH() {
  const employees = employeeRepository.getAll().filter(e => !e.archive);
  return `
    <div class="view-header">
      <h1>Tableau de bord</h1>
      <p class="view-subtitle">Vue d'ensemble de votre effectif</p>
    </div>
    ${renderOperationalDashboardBody(employees, null)}
    ${renderDashboardShortcuts()}
  `;
}

function renderDashboardManager() {
  const visibleIds = getVisibleEmployeeIdsForCurrentUser();
  const employees = employeeRepository.getAll().filter(e => !e.archive && visibleIds.includes(e.id));
  return `
    <div class="view-header">
      <h1>Tableau de bord</h1>
      <p class="view-subtitle">Vue d'ensemble de votre équipe</p>
    </div>
    ${renderOperationalDashboardBody(employees, visibleIds)}
    ${renderDashboardShortcuts()}
  `;
}

function renderDashboardSalarie(user) {
  const today = getTodayPresenceStatus(user);
  const requests = [
    ...leaveRepository.getAll().filter(r => r.employeeId === user.id).map(r => {
      const type = DB.getLeaveTypeById(r.typeId);
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
    <div class="view-header">
      <h1>Bonjour ${escapeHtml(user.prenom)}</h1>
      <p class="view-subtitle">Votre espace personnel</p>
    </div>

    <div class="kpi-grid">
      ${kpiCard('Statut aujourd\'hui', `${today.icon} ${today.label}`, '📅')}
      ${kpiCard('Demandes en attente', enAttente.length, '⏳')}
      ${kpiCard('Ancienneté', calculateAnciennete(user.dateEmbauche), '🎂')}
    </div>

    <div class="card">
      <h2>Mes soldes de congés</h2>
      ${renderEmployeeBalances(user)}
    </div>

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

    <div class="card">
      <h2>Raccourcis</h2>
      <button class="btn btn-primary" data-nav="conges">Demander un congé</button>
      <button class="btn btn-secondary" data-nav="teletravail">Déclarer du télétravail</button>
      <button class="btn btn-secondary" data-nav="frais">Déposer une note de frais</button>
      <button class="btn btn-secondary" data-nav="mes-documents">Mes documents</button>
      <button class="btn btn-secondary" data-nav="calendrier">Voir le calendrier</button>
    </div>
  `;
}

function renderDashboardDirecteur() {
  const employees = employeeRepository.getAll().filter(e => !e.archive);
  const settings = DB.getSettings();
  const leaveTypes = DB.getLeaveTypes();
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

  return `
    <div class="view-header">
      <h1>Tableau de bord</h1>
      <p class="view-subtitle">Vue d'ensemble de votre effectif</p>
    </div>
    ${renderOperationalDashboardBody(employees, null)}

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

    ${renderDashboardShortcuts()}
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
  const types = DB.getLeaveTypes();
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
  const settings = DB.getSettings();
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

function getUpcomingBirthdays(daysAhead = 60, employees) {
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
    .slice(0, 5);
}

function getUpcomingContractEnds(daysAhead = 60, employees) {
  employees = (employees || employeeRepository.getAll()).filter(e => !e.archive && e.statut === 'Actif' && e.dateFinContrat);
  const todayStr = toISODate(new Date());
  const limitStr = toISODate(addDays(new Date(), daysAhead));
  return employees
    .filter(e => e.dateFinContrat >= todayStr && e.dateFinContrat <= limitStr)
    .sort((a, b) => a.dateFinContrat.localeCompare(b.dateFinContrat))
    .slice(0, 5);
}

/** Même principe que getUpcomingContractEnds, pour la fin de période d'essai — champ existant
 * depuis le début (formulaire + fiche salarié) mais jamais consulté par le moteur de notifications. */
function getUpcomingProbationEnds(daysAhead = 60, employees) {
  employees = (employees || employeeRepository.getAll()).filter(e => !e.archive && e.statut === 'Actif' && e.dateFinPeriodeEssai);
  const todayStr = toISODate(new Date());
  const limitStr = toISODate(addDays(new Date(), daysAhead));
  return employees
    .filter(e => e.dateFinPeriodeEssai >= todayStr && e.dateFinPeriodeEssai <= limitStr)
    .sort((a, b) => a.dateFinPeriodeEssai.localeCompare(b.dateFinPeriodeEssai))
    .slice(0, 5);
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
      <rect x="${labelWidth}" y="${y}" width="${barW}" height="${barHeight}" rx="4" fill="${d.color}" />
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
    const circle = `<circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="${d.color}" stroke-width="${strokeWidth}" stroke-dasharray="${dash} ${circumference - dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${size / 2} ${size / 2})" />`;
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
          <span class="chart-legend-swatch" style="background:${d.color}"></span>${escapeHtml(d.label)} (${d.value})
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
    const type = DB.getLeaveTypeById(onLeave.typeId);
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
  return `
    <div class="kpi-card">
      <div class="kpi-icon">${icon}</div>
      <div class="kpi-value">${value}</div>
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
  const user = DB.getCurrentUser();
  if (!user) return [];
  if ([ROLES.RH, ROLES.DIRECTEUR, ROLES.COMPTABILITE].includes(user.role)) return null;
  if (user.role === ROLES.MANAGER) {
    const team = employeeRepository.getAll().filter(e => (e.managerIds || []).includes(user.id)).map(e => e.id);
    return [user.id, ...team];
  }
  return [user.id];
}

function getFilteredSortedEmployees() {
  const settings = DB.getSettings();
  let list = employeeRepository.getAll();

  const visibleIds = getVisibleEmployeeIdsForCurrentUser();
  if (visibleIds !== null) list = list.filter(e => visibleIds.includes(e.id));

  const term = state.search.trim().toLowerCase();
  if (term) {
    list = list.filter(e =>
      `${e.prenom} ${e.nom} ${e.matricule} ${e.email} ${e.poste}`.toLowerCase().includes(term)
    );
  }
  if (state.filters.etablissementId) list = list.filter(e => e.etablissementId === state.filters.etablissementId);
  if (state.filters.service) list = list.filter(e => e.service === state.filters.service);
  if (state.filters.statutContrat) list = list.filter(e => e.typeContrat === state.filters.statutContrat);
  if (state.filters.statut) list = list.filter(e => e.statut === state.filters.statut);
  if (state.filters.favorisOnly) list = list.filter(e => DB.isFavoriteEmployee(e.id));

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
  const user = DB.getCurrentUser();
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
            <div class="employee-name">${DB.isFavoriteEmployee(e.id) ? '⭐ ' : ''}${escapeHtml(e.prenom)} ${escapeHtml(e.nom)}</div>
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
function exportEmployeesCSV() {
  const { list } = getFilteredSortedEmployees();
  const visible = list.filter(e => !e.archive);
  const headers = ['Matricule', 'Nom', 'Prénom', 'Email', 'Téléphone', 'Poste', 'Service', 'Équipe', 'Type de contrat', 'Date d\'embauche', 'Ancienneté', 'Statut'];
  const rows = visible.map(e => [
    e.matricule, e.nom, e.prenom, e.email, e.telephone, e.poste, e.service, e.equipe,
    e.typeContrat, formatDate(e.dateEmbauche), calculateAnciennete(e.dateEmbauche), e.statut
  ]);
  exportRowsToCSV(headers, rows, 'salaries.csv');
  DB.logAudit('Export', 'Salariés', `${visible.length} salarié${visible.length > 1 ? 's' : ''}`);
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

  return { roots, childrenOf };
}

function renderOrganigramme() {
  const f = state.organigrammeFilters;
  let employees = employeeRepository.getAll().filter(e => !e.archive && e.statut === 'Actif');

  const term = f.search.trim().toLowerCase();
  if (term) employees = employees.filter(e => `${e.prenom} ${e.nom} ${e.poste}`.toLowerCase().includes(term));
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
  const user = DB.getCurrentUser();
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
  const settings = DB.getSettings();
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
  const user = DB.getCurrentUser();
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
// Vue : Fiche salarié (détail)
// ---------------------------------------------------------------------------

/** Un RH ne peut pas modifier sa propre fiche sensible ; seul le Directeur le peut. */
function canEditEmployeeRecord(employee) {
  const user = DB.getCurrentUser();
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
  const user = DB.getCurrentUser();
  if (!user) return false;
  if (hasPermission(user, PERMISSIONS.ARCHIVER_SALARIE)) {
    if (user.role !== ROLES.DIRECTEUR && user.id === employee.id) return false;
    return true;
  }
  return false;
}

function canDeleteEmployeeRecord() {
  const user = DB.getCurrentUser();
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
  const user = DB.getCurrentUser();
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
        <button class="btn btn-secondary" id="btn-toggle-favorite">${DB.isFavoriteEmployee(e.id) ? '⭐ Favori' : '☆ Favori'}</button>
        <button class="btn btn-secondary" id="btn-print-employee-fiche">🖨️ Fiche PDF</button>
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
  const types = DB.getLeaveTypes().filter(t => t.actif && t.visibleSalarie);
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
      const type = DB.getLeaveTypeById(typeId);
      DB.logAudit('Modification', 'Types d\'absence autorisés', `${employee.prenom} ${employee.nom} · ${type.nom} ${evt.target.checked ? 'autorisé' : 'désactivé'}`);
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
        <span class="badge badge-${e.verrouille ? 'warning' : 'success'}">${e.verrouille ? 'Verrouillé' : 'Actif'}</span>
        ${e.tentativesEchouees ? `<span class="text-muted">${e.tentativesEchouees} tentative${e.tentativesEchouees > 1 ? 's' : ''} échouée${e.tentativesEchouees > 1 ? 's' : ''}</span>` : ''}
      </div>
      <div class="detail-header-actions">
        ${e.verrouille ? '<button class="btn btn-secondary btn-sm" id="btn-deverrouiller-compte">Déverrouiller le compte</button>' : ''}
        <button class="btn btn-secondary btn-sm" id="btn-forcer-mot-de-passe">Réinitialiser le mot de passe</button>
      </div>
    </div>
  `;
}

function openForcerMotDePasseModal(employeeId) {
  const employee = employeeRepository.getById(employeeId);
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
  document.getElementById('forcer-mdp-form').addEventListener('submit', (evt) => {
    evt.preventDefault();
    const result = employeeRepository.forcerMotDePasse(employeeId, document.getElementById('f-nouveau-mdp').value);
    if (!result.success) { showToast(result.error, 'error'); return; }
    showToast('Mot de passe réinitialisé.');
    closeModal();
    render();
  });
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
      DB.logAudit('Modification', 'Permissions', `${employee.prenom} ${employee.nom} · ${key} = ${evt.target.value || 'défaut du rôle'}`);
      showToast('Permission mise à jour.');
      navigateTo('employee-detail', { currentEmployeeId: employeeId });
    });
  });
}

/** Salaire/genre : données sensibles, réservées au Directeur, et seulement si l'entreprise a activé le suivi correspondant. */
function renderConfidentialEmployeeCard(e, user) {
  if (!hasPermission(user, PERMISSIONS.VOIR_INFOS_FINANCIERES)) return '';
  const settings = DB.getSettings();
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
  const types = DB.getLeaveTypes().filter(t => t.actif && t.visibleSalarie);
  if (types.length === 0) return `<p class="text-muted">Aucun type de congé actif.</p>`;

  const requests = leaveRepository.getAll();
  return `
    <div class="balance-grid">
      ${types.map(t => {
        const balance = getLeaveBalance(employee, t, requests);
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
  const type = DB.getLeaveTypeById(typeId);
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
            ${textField('adresse.rue', 'Adresse', employee.adresse.rue)}
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
  const user = DB.getCurrentUser();
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
    DB.logAudit('Export', 'Fiche salarié', `${e.prenom} ${e.nom}`);
    window.print();
  });
}

function bindEmployeeDetailEvents() {
  document.getElementById('btn-back-to-list').addEventListener('click', () => navigateTo('employees'));

  const favoriteBtn = document.getElementById('btn-toggle-favorite');
  if (!favoriteBtn) return; // fiche introuvable ou accès non autorisé : seul le lien de retour existe sur cet état
  favoriteBtn.addEventListener('click', () => {
    DB.toggleFavoriteEmployee(state.currentEmployeeId);
    render();
  });
  document.getElementById('btn-print-employee-fiche').addEventListener('click', () => openEmployeePrintModal(state.currentEmployeeId));
  bindEmployeeDocumentsEvents(state.currentEmployeeId);
  bindPermissionsCardEvents(state.currentEmployeeId);
  bindTypesAbsenceCardEvents(state.currentEmployeeId);

  const deverrouillerBtn = document.getElementById('btn-deverrouiller-compte');
  if (deverrouillerBtn) deverrouillerBtn.addEventListener('click', () => {
    const result = employeeRepository.deverrouillerCompte(state.currentEmployeeId);
    if (!result.success) { showToast(result.error, 'error'); return; }
    showToast('Compte déverrouillé.');
    render();
  });
  const forcerMdpBtn = document.getElementById('btn-forcer-mot-de-passe');
  if (forcerMdpBtn) forcerMdpBtn.addEventListener('click', () => openForcerMotDePasseModal(state.currentEmployeeId));

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

function renderConges() {
  return `
    <div class="view-header">
      <h1>Congés</h1>
      <p class="view-subtitle">Demandes, validations et types de congés payés/RTT/ancienneté (§14)</p>
    </div>
    <div class="tabs">
      <button class="tab ${state.congesTab === 'demandes' ? 'active' : ''}" data-conges-tab="demandes">Demandes</button>
      <button class="tab ${state.congesTab === 'types' ? 'active' : ''}" data-conges-tab="types">Types de congés</button>
    </div>
    <div id="conges-tab-content">
      ${state.congesTab === 'types' ? renderCongesTypes('conge') : renderCongesDemandes('conge')}
    </div>
  `;
}

function bindCongesEvents() {
  document.querySelectorAll('[data-conges-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.congesTab = btn.dataset.congesTab;
      render();
    });
  });

  if (state.congesTab === 'types') {
    bindCongesTypesEvents('conge');
  } else {
    bindCongesDemandesEvents('conge');
  }
}

// ---------------------------------------------------------------------------
// Vue : Autres absences (§15) — même moteur que Congés, filtré par categorie
// ---------------------------------------------------------------------------

function renderAutresAbsences() {
  return `
    <div class="view-header">
      <h1>Autres absences</h1>
      <p class="view-subtitle">Maladie, événements familiaux et autres absences paramétrables (§15)</p>
    </div>
    <div class="tabs">
      <button class="tab ${state.autresAbsencesTab === 'demandes' ? 'active' : ''}" data-autres-absences-tab="demandes">Demandes</button>
      <button class="tab ${state.autresAbsencesTab === 'types' ? 'active' : ''}" data-autres-absences-tab="types">Types d'absence</button>
    </div>
    <div id="conges-tab-content">
      ${state.autresAbsencesTab === 'types' ? renderCongesTypes('autre') : renderCongesDemandes('autre')}
    </div>
  `;
}

function bindAutresAbsencesEvents() {
  document.querySelectorAll('[data-autres-absences-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.autresAbsencesTab = btn.dataset.autresAbsencesTab;
      render();
    });
  });

  if (state.autresAbsencesTab === 'types') {
    bindCongesTypesEvents('autre');
  } else {
    bindCongesDemandesEvents('autre');
  }
}

// ---- Sous-vue : Demandes ----

function getFilteredLeaveRequests(categorie = 'conge') {
  const filters = categorie === 'conge' ? state.congesFilters : state.autresAbsencesFilters;
  let list = leaveRepository.getAll().filter(r => {
    const type = DB.getLeaveTypeById(r.typeId);
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
  const types = DB.getLeaveTypes().filter(t => t.categorie === categorie);
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
  const type = DB.getLeaveTypeById(r.typeId);
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

function canActOnRequestFor(request, domain = 'absence') {
  const user = DB.getCurrentUser();
  if (!user || !request.workflow || request.etapeIndex < 0 || request.etapeIndex >= request.workflow.length) return false;
  if (request.employeeId === user.id) return false; // séparation des tâches : personne ne valide sa propre demande, même RH/Directeur
  if (hasPermission(user, domain === 'frais' ? PERMISSIONS.VALIDER_NOTE_FRAIS : PERMISSIONS.VALIDER_ABSENCE)) return true;
  return isCurrentWorkflowStepFor(request, user, domain);
}

/** Refuser une demande (§8) : REFUSER_ABSENCE est une permission distincte de VALIDER_ABSENCE pour
 * congés/télétravail — un Directeur peut ainsi accorder (ou retirer) le droit de refuser
 * indépendamment de celui de valider. Pas de permission "refuser une note de frais" distincte au
 * catalogue : même règle que Valider pour le domaine 'frais'. */
function canRefuserRequestFor(request, domain = 'absence') {
  const user = DB.getCurrentUser();
  if (!user || !request.workflow || request.etapeIndex < 0 || request.etapeIndex >= request.workflow.length) return false;
  if (request.employeeId === user.id) return false;
  if (hasPermission(user, domain === 'frais' ? PERMISSIONS.VALIDER_NOTE_FRAIS : PERMISSIONS.REFUSER_ABSENCE)) return true;
  return isCurrentWorkflowStepFor(request, user, domain);
}

/** Pour les actions post-validation (ex. Annuler) qui ne dépendent plus de l'étape de workflow.
 * Même logique de domain que canActOnRequestFor ci-dessus. */
function canManageRequestFor(employeeId, domain = 'absence') {
  const user = DB.getCurrentUser();
  if (!user) return false;
  if (employeeId === user.id) return false; // séparation des tâches : personne ne gère sa propre demande, même RH/Directeur
  if (hasPermission(user, domain === 'frais' ? PERMISSIONS.VALIDER_NOTE_FRAIS : PERMISSIONS.ANNULER_ABSENCE)) return true;
  if (user.role === ROLES.MANAGER) {
    const emp = employeeRepository.getById(employeeId);
    return Boolean(emp && (emp.managerIds || []).includes(user.id));
  }
  return false;
}

function renderRequestActions(r, type) {
  if (r.statut === 'En attente') {
    return `
      ${canActOnRequestFor(r) ? `<button class="btn-link" data-approve="${r.id}">Valider</button>` : ''}
      ${canRefuserRequestFor(r) ? `<button class="btn-link btn-link-danger" data-refuse="${r.id}">Refuser</button>` : ''}
    `;
  }
  if (r.statut === 'Validé') {
    // §24 : "Prolonger l'arrêt" — réservé aux types "saisie réservée RH" (maladie et assimilés,
    // voir SS15) et à qui a la permission PROLONGER_MALADIE.
    const canProlonger = !type.saisiParSalarie && hasPermission(DB.getCurrentUser(), PERMISSIONS.PROLONGER_MALADIE);
    return `
      <button class="btn-link" data-attestation="${r.id}">Attestation</button>
      ${canProlonger ? `<button class="btn-link" data-prolonger="${r.id}">Prolonger</button>` : ''}
      ${canManageRequestFor(r.employeeId) ? `<button class="btn-link" data-regulariser="${r.id}">Régulariser</button>` : ''}
      ${canManageRequestFor(r.employeeId) ? `<button class="btn-link btn-link-danger" data-cancel="${r.id}">Annuler</button>` : ''}
    `;
  }
  return '';
}

// ---- Modale : Prolonger un arrêt (§24) ----

function openProlongerModal(requestId) {
  const request = leaveRepository.getById(requestId);
  const employee = employeeRepository.getById(request.employeeId);
  const type = DB.getLeaveTypeById(request.typeId);

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
  const employee = employeeRepository.getById(request.employeeId);
  const currentType = DB.getLeaveTypeById(request.typeId);
  // Inclut le type ACTUEL même s'il a été désactivé depuis (sinon le select retombe sur le fallback
  // générique de selectField, qui affiche l'id brut plutôt qu'un nom lisible — même bug déjà corrigé
  // pour les établissements désactivés).
  const typesMemeCategorie = DB.getLeaveTypes().filter(t =>
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
          <div class="form-field" style="margin-top: 12px;">
            <label for="f-demiJournee">Demi-journée (si date de début = date de fin)</label>
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

  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
  document.getElementById('regulariser-form').addEventListener('submit', (evt) => {
    evt.preventDefault();
    const typeId = document.getElementById('f-typeId').value;
    const dateDebut = document.getElementById('f-dateDebut').value;
    const dateFin = document.getElementById('f-dateFin').value;
    const demiJournee = dateDebut === dateFin ? (document.getElementById('f-demiJournee').value || null) : null;
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
    const type = DB.getLeaveTypeById(r.typeId);
    return [
      employee ? `${employee.prenom} ${employee.nom}` : '—',
      type ? type.nom : '—',
      r.dateDebut, r.dateFin, formatNumberFR(r.nbJours),
      type && type.paye ? 'Oui' : 'Non',
      r.statut
    ];
  });
  exportRowsToCSV(headers, rows, categorie === 'conge' ? 'conges.csv' : 'autres-absences.csv');
  DB.logAudit('Export', categorie === 'conge' ? 'Demandes de congé' : 'Demandes d\'autre absence', `${requests.length} ligne${requests.length > 1 ? 's' : ''}`);
}

function bindCongesDemandesEvents(categorie = 'conge') {
  const filters = categorie === 'conge' ? state.congesFilters : state.autresAbsencesFilters;
  const pageKey = categorie === 'conge' ? 'congesPage' : 'autresAbsencesPage';

  document.getElementById('btn-new-leave-request').addEventListener('click', () => openLeaveRequestModal(undefined, categorie));
  document.getElementById('btn-export-conges').addEventListener('click', () => exportLeaveRequestsCSV(categorie));

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
}

// ---- Modale : Attestation de congé (imprimable / export PDF) ----

function openLeaveAttestationModal(requestId) {
  const r = leaveRepository.getById(requestId);
  const employee = employeeRepository.getById(r.employeeId);
  const type = DB.getLeaveTypeById(r.typeId);
  const periode = r.dateDebut === r.dateFin ? formatDate(r.dateDebut) : `du ${formatDate(r.dateDebut)} au ${formatDate(r.dateFin)}`;

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
            Seven RH atteste que <strong>${escapeHtml(employee.prenom)} ${escapeHtml(employee.nom)}</strong>
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
    DB.logAudit('Export', 'Attestation de congé', `${employee.prenom} ${employee.nom}`);
    window.print();
  });
}

function auditLabelForEmployee(employeeId) {
  const employee = employeeRepository.getById(employeeId);
  return employee ? `${employee.prenom} ${employee.nom}` : '—';
}

function handleApproveRequest(id) {
  const request = leaveRepository.getById(id);
  leaveRepository.update(id, advanceWorkflow(request, 'Validé'));
  DB.logAudit('Validation', 'Demande de congé', auditLabelForEmployee(request.employeeId));
  showToast('Demande validée.');
  render();
}

function handleRefuseRequest(id) {
  const request = leaveRepository.getById(id);
  openConfirm({
    title: 'Refuser cette demande ?',
    message: 'Le salarié sera informé du refus. Ses jours ne seront pas décomptés.',
    confirmLabel: 'Refuser',
    danger: true,
    onConfirm: () => {
      leaveRepository.update(id, refuseRequest(request));
      DB.logAudit('Refus', 'Demande de congé', auditLabelForEmployee(request.employeeId));
      showToast('Demande refusée.');
      render();
    }
  });
}

function handleCancelRequest(id) {
  const request = leaveRepository.getById(id);
  openConfirm({
    title: 'Annuler cette demande ?',
    message: 'Les jours seront recrédités sur le compteur du salarié.',
    confirmLabel: 'Annuler la demande',
    danger: true,
    onConfirm: () => {
      leaveRepository.update(id, cancelRequest(request));
      DB.logAudit('Annulation', 'Demande de congé', auditLabelForEmployee(request.employeeId));
      showToast('Demande annulée.');
      render();
    }
  });
}

// ---- Modale : Nouvelle demande de congé ----

/**
 * Champ "Salarié" des modales de demande : un Salarié ne peut demander que pour
 * lui-même (champ verrouillé), les autres rôles gardent le sélecteur, restreint
 * à leur périmètre visible (équipe pour un manager, tout le monde pour RH/Directeur).
 */
function employeeFieldForRequest(presetEmployeeId, employees) {
  const user = DB.getCurrentUser();
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

function openLeaveRequestModal(presetEmployeeId, categorie) {
  const employees = employeeRepository.getAll().filter(e => !e.archive);
  // §15/§24 : un type marqué "saisie réservée aux RH" (ex. Maladie) ne doit pas être proposé à qui
  // n'a pas SAISIR_MALADIE — sinon un salarié pourrait se déclarer lui-même en arrêt maladie alors
  // que le cahier des charges l'attribue exclusivement au service RH.
  const canSaisirRestreint = hasPermission(DB.getCurrentUser(), PERMISSIONS.SAISIR_MALADIE);
  const currentUser = DB.getCurrentUser();
  // Sprint SIRH premium §1 : un salarié (uniquement en libre-service sur SA PROPRE fiche — jamais
  // un manager/RH créant une demande pour le compte d'un tiers, qui agit à titre administratif, cf.
  // le même principe que le contournement SAISIR_MALADIE ci-dessus) ne peut demander que les types
  // que l'entreprise ET sa propre fiche autorisent (cf. renderTypesAbsenceCard).
  const typesDesactivesPourSoi = currentUser.role === ROLES.SALARIE
    ? new Set(currentUser.typesAbsenceDesactives || [])
    : new Set();
  const types = DB.getLeaveTypes().filter(t =>
    t.actif && t.visibleSalarie && (!categorie || t.categorie === categorie) &&
    (t.saisiParSalarie || canSaisirRestreint) && !typesDesactivesPourSoi.has(t.id));
  state.pendingAttachment = null;

  const html = `
    <div class="modal">
      <div class="modal-header">
        <h2>${categorie === 'autre' ? 'Nouvelle demande d\'absence' : 'Nouvelle demande de congé'}</h2>
        <button class="btn-icon" id="btn-close-modal" aria-label="Fermer" title="Fermer">✕</button>
      </div>
      <form id="leave-request-form">
        <div class="modal-body">
          <div class="form-grid">
            ${employeeFieldForRequest(presetEmployeeId, employees)}
            ${selectField('typeId', categorie === 'autre' ? 'Type d\'absence' : 'Type de congé', null, '', types.map(t => ({ value: t.id, label: `${t.icone} ${t.nom}` })))}
            ${textField('dateDebut', 'Date de début', '', true, 'date')}
            ${textField('dateFin', 'Date de fin', '', true, 'date')}
          </div>
          <div class="form-field" id="field-demi-journee" style="margin-top:14px; display:none;">
            <label>Demi-journée</label>
            <select class="input" id="f-demiJournee" name="demiJournee">
              <option value="">Journée complète</option>
              <option value="matin">Matin</option>
              <option value="apres-midi">Après-midi</option>
            </select>
          </div>
          <div class="form-field" style="margin-top:14px;">
            <label for="f-commentaire">Commentaire</label>
            <textarea class="input" id="f-commentaire" name="commentaire" rows="2"></textarea>
          </div>
          <div class="form-field" style="margin-top:14px;">
            <label for="f-justificatif">Pièce justificative (optionnel)</label>
            <input class="input" type="file" id="f-justificatif">
          </div>
          <p class="text-muted" id="leave-balance-hint" style="margin-top:12px;"></p>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Annuler</button>
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

  const type = typeId ? DB.getLeaveTypeById(typeId) : null;
  demiField.style.display = type && type.autoriserDemiJournee && dateDebut && dateDebut === dateFin ? 'block' : 'none';

  if (!type || !employeeId) { hint.textContent = ''; return; }
  const employee = employeeRepository.getById(employeeId);
  const balance = getLeaveBalance(employee, type, leaveRepository.getAll());
  const disponibleLabel = balance.disponible === Infinity ? 'illimité' : formatDurationFR(balance.disponible);

  let nbJoursLabel = '';
  if (dateDebut && dateFin) {
    const demiJournee = demiField.style.display === 'block' ? document.getElementById('f-demiJournee').value : '';
    const nbJours = computeWorkingDays(dateDebut, dateFin, Boolean(demiJournee), employee.joursTravailles);
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

  const employee = employeeRepository.getById(employeeId);
  const type = DB.getLeaveTypeById(typeId);

  // §15/§24 : ne fait pas confiance au seul filtrage du menu déroulant (contournable en modifiant
  // le DOM) — revérifie ici que l'utilisateur courant a le droit de saisir ce type restreint.
  if (!type.saisiParSalarie && !hasPermission(DB.getCurrentUser(), PERMISSIONS.SAISIR_MALADIE)) {
    showToast(`La saisie du type « ${type.nom} » est réservée aux RH.`, 'error');
    return;
  }

  // Sprint SIRH premium §1 : même principe — ne fait pas confiance au seul filtrage du menu
  // déroulant pour la liste blanche de types autorisés par salarié.
  const currentUser = DB.getCurrentUser();
  if (currentUser.role === ROLES.SALARIE && (currentUser.typesAbsenceDesactives || []).includes(typeId)) {
    showToast(`Le type « ${type.nom} » n'est pas autorisé pour votre profil.`, 'error');
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

  const nbJours = computeWorkingDays(dateDebut, dateFin, Boolean(demiJournee), employee.joursTravailles);

  if (nbJours <= 0) {
    showToast('La période sélectionnée ne comporte aucun jour travaillé.', 'error');
    return;
  }

  if (type.justificatifObligatoire && !state.pendingAttachment) {
    showToast('Un justificatif est requis pour ce type de congé.', 'error');
    return;
  }

  if (!type.autoriserPlusieursDemandes) {
    const overlapping = leaveRepository.getAll().some(r =>
      r.employeeId === employeeId && r.typeId === typeId && r.statut !== 'Refusé' && r.statut !== 'Annulé' &&
      r.dateDebut <= dateFin && r.dateFin >= dateDebut);
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

  showToast('Demande envoyée.');
  closeModal();
  if (type.categorie === 'conge') navigateTo('conges', { congesTab: 'demandes' });
  else navigateTo('autres-absences', { autresAbsencesTab: 'demandes' });
}

// ---- Sous-vue : Types de congés ----

function renderCongesTypes(categorie = 'conge') {
  const types = DB.getLeaveTypes().filter(t => t.categorie === categorie);
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
    DB.duplicateLeaveType(btn.dataset.duplicateType);
    showToast('Type de congé dupliqué.');
    render();
  }));
  document.querySelectorAll('[data-toggle-type]').forEach(btn => btn.addEventListener('click', () => {
    const t = DB.getLeaveTypeById(btn.dataset.toggleType);
    DB.updateLeaveType(t.id, { actif: !t.actif });
    render();
  }));
  document.querySelectorAll('[data-reorder-up]').forEach(btn => btn.addEventListener('click', () => {
    DB.reorderLeaveType(btn.dataset.reorderUp, 'up');
    render();
  }));
  document.querySelectorAll('[data-reorder-down]').forEach(btn => btn.addEventListener('click', () => {
    DB.reorderLeaveType(btn.dataset.reorderDown, 'down');
    render();
  }));
  document.querySelectorAll('[data-delete-type]').forEach(btn => btn.addEventListener('click', () => {
    const t = DB.getLeaveTypeById(btn.dataset.deleteType);
    openConfirm({
      title: 'Supprimer ce type de congé ?',
      message: `"${t.nom}" et toutes ses demandes associées seront définitivement supprimés.`,
      confirmLabel: 'Supprimer',
      danger: true,
      onConfirm: () => {
        DB.deleteLeaveType(t.id);
        showToast('Type de congé supprimé.');
        render();
      }
    });
  }));
}

// ---- Modale : Type de congé (création / édition) ----

function openLeaveTypeModal(id, categorie = 'conge') {
  const isEdit = Boolean(id);
  const type = isEdit ? DB.getLeaveTypeById(id) : Object.assign(makeEmptyLeaveType(), { workflow: DB.getSettings().workflowCongesDefault, categorie });
  // En édition, la catégorie du type lui-même fait foi plutôt que le paramètre reçu — l'appelant
  // (bouton "Modifier") ne le passait pas toujours correctement, ce qui renvoyait vers le mauvais
  // écran ("Congés" au lieu d'"Autres absences") après enregistrement. Ne dépend plus du contexte
  // d'ouverture, seulement de la donnée réelle du type.
  const effectiveCategorie = isEdit ? type.categorie : categorie;

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
                <input class="input" type="color" id="f-couleur" name="couleur" value="${escapeHtml(type.couleur)}">
              </div>
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
              ${textField('nombreAnnuel', 'Nombre de jours par an', type.nombreAnnuel, false, 'number')}
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
              ${checkboxField('deduireRTT', 'Déduire du compteur RTT', type.deduireRTT)}
              ${checkboxField('deduireCP', 'Déduire du compteur CP', type.deduireCP)}
              ${checkboxField('exportPaie', 'Inclure dans l\'export paie', type.exportPaie)}
              ${checkboxField('actif', 'Type actif', type.actif)}
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
  document.getElementById('leave-type-form').addEventListener('submit', (evt) => submitLeaveTypeForm(evt, id, effectiveCategorie));
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

function submitLeaveTypeForm(evt, id, categorie = 'conge') {
  evt.preventDefault();
  const form = evt.target;
  const formData = new FormData(form);
  const checkboxNames = ['paye', 'justificatifObligatoire', 'visibleSalarie', 'visibleRH', 'saisiParSalarie', 'autoriserDemiJournee', 'autoriserPlusieursDemandes', 'deduireRTT', 'deduireCP', 'exportPaie', 'actif'];

  if (Number(formData.get('nombreAnnuel')) < 0) {
    showToast('Le nombre de jours par an ne peut pas être négatif.', 'error');
    return;
  }

  const patch = {
    nom: formData.get('nom'),
    icone: formData.get('icone') || '🏖️',
    couleur: formData.get('couleur'),
    description: formData.get('description') || '',
    acquisition: formData.get('acquisition'),
    nombreAnnuel: Number(formData.get('nombreAnnuel')) || 0,
    workflow: JSON.parse(formData.get('workflow') || '[]')
  };
  patch.illimite = patch.acquisition === 'Illimitée';
  checkboxNames.forEach(name => { patch[name] = form.querySelector(`#f-${name}`).checked; });
  patch.deduireCompteur = true;

  if (id) {
    DB.updateLeaveType(id, patch);
    showToast('Type de congé mis à jour.');
  } else {
    patch.categorie = categorie;
    DB.addLeaveType(patch);
    showToast('Type de congé créé.');
  }
  closeModal();
  if (categorie === 'conge') navigateTo('conges', { congesTab: 'types' });
  else navigateTo('autres-absences', { autresAbsencesTab: 'types' });
}

// ---------------------------------------------------------------------------
// Vue : Calendrier
// ---------------------------------------------------------------------------

const MONTH_NAMES = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function renderCalendrier() {
  const cells = buildMonthGridCells(state.calendarYear, state.calendarMonth);
  const settings = DB.getSettings();

  // Récupérés une seule fois pour toute la grille plutôt qu'à chaque cellule (~35-42 fois) — mesuré : 128ms -> ~15ms pour 300 salariés.
  const visibleIds = getVisibleEmployeeIdsForCurrentUser();
  let employees = employeeRepository.getAll().filter(e => !e.archive);
  if (visibleIds !== null) employees = employees.filter(e => visibleIds.includes(e.id));
  const leaveTypes = DB.getLeaveTypes();
  const leaveRequests = leaveRepository.getAll().filter(r => r.statut === 'Validé' || r.statut === 'En attente');
  const teleworkRequests = teleworkRepository.getAll().filter(r => r.statut === 'Validé' || r.statut === 'En attente');
  const schoolHolidays = DB.getSchoolHolidays();
  const years = [...new Set(cells.map(c => c.date.getFullYear()))];
  const publicHolidays = years.flatMap(y => getFrenchPublicHolidays(y));
  const sharedData = { employees, leaveTypes, leaveRequests, teleworkRequests, schoolHolidays, publicHolidays, schoolZone: settings.schoolZone };

  return `
    <div class="view-header-row">
      <div>
        <h1>Calendrier</h1>
        <p class="view-subtitle">${MONTH_NAMES[state.calendarMonth]} ${state.calendarYear}</p>
      </div>
      <div class="calendar-nav">
        <button class="btn btn-secondary btn-sm" id="btn-cal-prev">← Précédent</button>
        <button class="btn btn-secondary btn-sm" id="btn-cal-today">Aujourd'hui</button>
        <button class="btn btn-secondary btn-sm" id="btn-cal-next">Suivant →</button>
      </div>
    </div>

    <div class="card calendar-legend">
      <span class="legend-item">🏖️ Congé</span>
      <span class="legend-item">🎂 Anniversaire</span>
      <span class="legend-item">💻 Télétravail</span>
      <span class="legend-item">🎉 Arrivée</span>
      <span class="legend-item">👋 Départ</span>
      <span class="legend-item"><span class="legend-swatch legend-holiday"></span> Jour férié</span>
      <span class="legend-item"><span class="legend-swatch legend-school"></span> Vacances scolaires (Zone ${escapeHtml(settings.schoolZone)})</span>
    </div>

    <div class="card calendar-card">
      <div class="calendar-grid calendar-grid-header">
        ${WEEKDAY_LABELS.map(l => `<div class="calendar-weekday">${l}</div>`).join('')}
      </div>
      <div class="calendar-grid">
        ${cells.map(cell => renderCalendarCell(cell, sharedData)).join('')}
      </div>
    </div>
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
      return emp && type ? { emp, type } : null;
    })
    .filter(Boolean);

  const anniversaires = employees.filter(e => e.dateNaissance && e.dateNaissance.slice(5, 10) === dateStr.slice(5, 10));
  const arrivees = employees.filter(e => e.dateEmbauche === dateStr);
  const departs = employees.filter(e => e.dateDepart === dateStr);

  const teletravail = teleworkRequests
    .filter(r => dateStr >= r.dateDebut && dateStr <= r.dateFin)
    .map(r => employees.find(e => e.id === r.employeeId))
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

  const classes = ['calendar-cell'];
  if (!cell.inMonth) classes.push('out-month');
  if (isToday) classes.push('today');
  if (isWeekend) classes.push('weekend');
  if (info.ferie) classes.push('holiday');
  if (info.vacances) classes.push('school-holiday');

  const badges = [
    info.conges.length ? calendarBadge('🏖️', info.conges.map(c => `${c.emp.prenom} ${c.emp.nom} · ${c.type.nom}`)) : '',
    info.teletravail.length ? calendarBadge('💻', info.teletravail.map(e => `${e.prenom} ${e.nom}`)) : '',
    info.anniversaires.length ? calendarBadge('🎂', info.anniversaires.map(e => `${e.prenom} ${e.nom}`)) : '',
    info.arrivees.length ? calendarBadge('🎉', info.arrivees.map(e => `${e.prenom} ${e.nom} (arrivée)`)) : '',
    info.departs.length ? calendarBadge('👋', info.departs.map(e => `${e.prenom} ${e.nom} (départ)`)) : ''
  ].join('');

  return `
    <div class="${classes.join(' ')}">
      <div class="calendar-cell-header">
        <span class="calendar-day-number">${cell.date.getDate()}</span>
      </div>
      ${info.ferie ? `<div class="calendar-tag calendar-tag-holiday">${escapeHtml(info.ferie.label)}</div>` : ''}
      ${info.vacances ? `<div class="calendar-tag calendar-tag-school">🎒 ${escapeHtml(info.vacances.nom)}</div>` : ''}
      <div class="calendar-badges">${badges}</div>
    </div>
  `;
}

function calendarBadge(icon, names) {
  return `
    <span class="calendar-badge">
      ${icon}${names.length > 1 ? names.length : ''}
      <span class="calendar-tooltip">${names.map(escapeHtml).join('<br>')}</span>
    </span>
  `;
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

function renderParametres() {
  const canSeeAudit = hasPermission(DB.getCurrentUser(), PERMISSIONS.VOIR_JOURNAL_AUDIT);
  if (state.parametresTab === 'audit' && !canSeeAudit) state.parametresTab = 'listes';
  return `
    <div class="view-header">
      <h1>Paramètres</h1>
      <p class="view-subtitle">Listes de référence, vacances scolaires, jours fériés et journal d'audit</p>
    </div>
    <div class="tabs">
      <button class="tab ${state.parametresTab === 'entreprise' ? 'active' : ''}" data-parametres-tab="entreprise">Entreprise</button>
      <button class="tab ${state.parametresTab === 'etablissements' ? 'active' : ''}" data-parametres-tab="etablissements">Établissements</button>
      <button class="tab ${state.parametresTab === 'services' ? 'active' : ''}" data-parametres-tab="services">Services &amp; équipes</button>
      <button class="tab ${state.parametresTab === 'listes' ? 'active' : ''}" data-parametres-tab="listes">Listes de référence</button>
      <button class="tab ${state.parametresTab === 'vacances' ? 'active' : ''}" data-parametres-tab="vacances">Vacances scolaires</button>
      <button class="tab ${state.parametresTab === 'feries' ? 'active' : ''}" data-parametres-tab="feries">Jours fériés</button>
      ${canSeeAudit ? `<button class="tab ${state.parametresTab === 'audit' ? 'active' : ''}" data-parametres-tab="audit">Journal d'audit</button>` : ''}
    </div>
    <div id="parametres-tab-content">
      ${state.parametresTab === 'entreprise' ? renderParametresEntreprise()
        : state.parametresTab === 'etablissements' ? renderParametresEtablissements()
        : state.parametresTab === 'services' ? renderParametresServices()
        : state.parametresTab === 'vacances' ? renderParametresVacances()
        : state.parametresTab === 'feries' ? renderParametresFeries()
        : state.parametresTab === 'audit' && canSeeAudit ? renderParametresAudit()
        : renderParametresListes()}
    </div>
  `;
}

function bindParametresEvents() {
  document.querySelectorAll('[data-parametres-tab]').forEach(btn => {
    btn.addEventListener('click', () => { state.parametresTab = btn.dataset.parametresTab; render(); });
  });

  if (state.parametresTab === 'entreprise') bindParametresEntrepriseEvents();
  else if (state.parametresTab === 'etablissements') bindParametresEtablissementsEvents();
  else if (state.parametresTab === 'services') bindParametresServicesEvents();
  else if (state.parametresTab === 'vacances') bindParametresVacancesEvents();
  else if (state.parametresTab === 'feries') bindParametresFeriesEvents();
  else if (state.parametresTab === 'audit') bindParametresAuditEvents();
  else bindParametresListesEvents();
}

// ---- Sous-vue : Entreprise (profil, multi-entreprise) ----

function renderParametresEntreprise() {
  const profile = companyRepository.getProfile();
  const settings = DB.getSettings();
  const user = DB.getCurrentUser();

  return `
    <div class="card">
      <h2>Profil de l'entreprise</h2>
      <form id="entreprise-form">
        <div class="form-grid">
          ${textField('raisonSociale', 'Raison sociale', profile.raisonSociale, true)}
          ${textField('siret', 'SIRET', profile.siret)}
          ${textField('tva', 'N° TVA intracommunautaire', profile.tva)}
          ${textField('adresse', 'Adresse', profile.adresse)}
          ${textField('telephone', 'Téléphone', profile.telephone)}
          ${textField('email', 'Email', profile.email, true, 'email')}
          ${selectField('conventionCollective', 'Convention collective', settings.conventionsCollectives, profile.conventionCollective)}
        </div>
        <button type="submit" class="btn btn-primary" style="margin-top: 14px;">Enregistrer</button>
      </form>
    </div>
    ${hasPermission(user, PERMISSIONS.GERER_ABONNEMENTS) ? renderAbonnementCard() : ''}
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

/** Aperçu en lecture seule (§36) — la gestion réelle de l'abonnement (changement d'offre,
 * suspension, facturation) est réservée à l'Administrateur BERTOLIS, pas encore construite. */
function renderAbonnementCard() {
  const company = DB.getCurrentCompany();
  const abo = company.abonnement;
  if (!abo) return '';
  const offre = OFFRES_BERTOLIS[abo.offre] || OFFRES_BERTOLIS.essai;
  const statutBadge = { actif: 'success', impaye: 'warning', suspendu: 'warning', resilie: 'muted' }[abo.statut] || 'muted';
  const nbSalaries = employeeRepository.getAll().filter(e => !e.archive).length;
  const plafondLabel = offre.nombreSalariesMax === null ? 'illimité' : `${nbSalaries} / ${offre.nombreSalariesMax}`;

  return `
    <div class="card">
      <h2>Abonnement</h2>
      <p class="text-muted">Géré par BERTOLIS, l'éditeur du logiciel (§9.6, §36) — aperçu en lecture seule.</p>
      <div class="badge-row" style="margin: 8px 0 12px;">
        <span class="badge badge-info">${escapeHtml(offre.label)}</span>
        <span class="badge badge-${statutBadge}">${escapeHtml(ABONNEMENT_STATUT_LABELS[abo.statut] || abo.statut)}</span>
      </div>
      ${infoRow('Périodicité', abo.periodicite === 'annuel' ? 'Annuelle' : 'Mensuelle')}
      ${infoRow('Date de début', formatDate(abo.dateDebut))}
      ${infoRow('Date de renouvellement', abo.dateRenouvellement ? formatDate(abo.dateRenouvellement) : '—')}
      ${infoRow('Salariés actifs', plafondLabel)}
    </div>
  `;
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
        const result = DB.deleteEtablissement(etab.id);
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
            ${textField('adresse', 'Adresse', etab.adresse)}
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
  const settings = DB.getSettings();
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
          <input class="input" type="number" min="0" max="100" id="f-tickets-part" value="${escapeHtml(settings.ticketsPartEmployeurPct)}">
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
    const settings = DB.getSettings();
    settings.teletravailQuotaSemaine = Number(e.target.value) || 0;
    DB.saveSettings(settings);
    showToast('Quota mis à jour.');
  });
  document.getElementById('f-tickets-valeur').addEventListener('change', (e) => {
    const settings = DB.getSettings();
    settings.ticketsValeurFaciale = Number(e.target.value) || 0;
    DB.saveSettings(settings);
    showToast('Valeur faciale mise à jour.');
  });
  document.getElementById('f-tickets-part').addEventListener('change', (e) => {
    const settings = DB.getSettings();
    settings.ticketsPartEmployeurPct = Number(e.target.value) || 0;
    DB.saveSettings(settings);
    showToast('Part employeur mise à jour.');
  });
  document.getElementById('f-tickets-teletravail').addEventListener('change', (e) => {
    const settings = DB.getSettings();
    settings.ticketsInclureTeletravail = e.target.checked;
    DB.saveSettings(settings);
    showToast('Règle mise à jour.');
  });
  document.getElementById('f-masse-salariale').addEventListener('change', (e) => {
    const settings = DB.getSettings();
    settings.masseSalarialeActivee = e.target.checked;
    DB.saveSettings(settings);
    showToast('Réglage mis à jour.');
  });
  document.getElementById('f-suivi-genre').addEventListener('change', (e) => {
    const settings = DB.getSettings();
    settings.suiviGenreActive = e.target.checked;
    DB.saveSettings(settings);
    showToast('Réglage mis à jour.');
  });
  document.getElementById('f-suivi-age').addEventListener('change', (e) => {
    const settings = DB.getSettings();
    settings.suiviAgeActive = e.target.checked;
    DB.saveSettings(settings);
    showToast('Réglage mis à jour.');
  });
  document.getElementById('f-workflow-conges-default').addEventListener('change', (e) => {
    const settings = DB.getSettings();
    settings.workflowCongesDefault = JSON.parse(e.target.value);
    DB.saveSettings(settings);
    showToast('Modèle de validation des congés mis à jour.');
  });
  document.getElementById('f-workflow-teletravail').addEventListener('change', (e) => {
    const settings = DB.getSettings();
    settings.workflowTeletravail = JSON.parse(e.target.value);
    DB.saveSettings(settings);
    showToast('Chaîne de validation du télétravail mise à jour.');
  });
  document.getElementById('f-workflow-frais').addEventListener('change', (e) => {
    const settings = DB.getSettings();
    settings.workflowFrais = JSON.parse(e.target.value);
    DB.saveSettings(settings);
    showToast('Chaîne de validation des notes de frais mise à jour.');
  });

  document.querySelectorAll('.chip-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const settings = DB.getSettings();
      const key = btn.dataset.listKey;
      const index = Number(btn.dataset.index);
      settings[key] = settings[key].filter((_, i) => i !== index);
      DB.saveSettings(settings);
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

      const settings = DB.getSettings();
      if (settings[key].includes(value)) {
        showToast('Cet élément existe déjà.', 'error');
        return;
      }
      settings[key] = [...settings[key], value];
      DB.saveSettings(settings);
      showToast('Liste mise à jour.');
      render();
    });
  });
}

// ---- Sous-vue : Vacances scolaires ----

function renderParametresVacances() {
  const settings = DB.getSettings();
  const schoolData = DB.getSchoolHolidays();

  return `
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
    const settings = DB.getSettings();
    settings.schoolZone = e.target.value;
    DB.saveSettings(settings);
    showToast('Zone de vacances scolaires mise à jour.');
  });

  document.getElementById('btn-new-school-period').addEventListener('click', () => openSchoolPeriodModal());
  document.querySelectorAll('[data-edit-period]').forEach(btn => {
    btn.addEventListener('click', () => openSchoolPeriodModal(Number(btn.dataset.editPeriod)));
  });
  document.querySelectorAll('[data-delete-period]').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = Number(btn.dataset.deletePeriod);
      const schoolData = DB.getSchoolHolidays();
      const period = schoolData.periodes[index];
      openConfirm({
        title: 'Supprimer cette période ?',
        message: `"${period.nom}" sera retirée du calendrier.`,
        confirmLabel: 'Supprimer',
        danger: true,
        onConfirm: () => {
          schoolData.periodes.splice(index, 1);
          DB.saveSchoolHolidays(schoolData);
          showToast('Période supprimée.');
          render();
        }
      });
    });
  });
}

function openSchoolPeriodModal(index) {
  const isEdit = index !== undefined;
  const schoolData = DB.getSchoolHolidays();
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

  const schoolData = DB.getSchoolHolidays();
  if (index !== undefined) {
    schoolData.periodes[index] = patch;
  } else {
    schoolData.periodes.push(patch);
  }
  DB.saveSchoolHolidays(schoolData);
  showToast(index !== undefined ? 'Période mise à jour.' : 'Période créée.');
  closeModal();
  navigateTo('parametres', { parametresTab: 'vacances' });
}

// ---- Sous-vue : Jours fériés (calculés automatiquement, lecture seule) ----

function renderParametresFeries() {
  const year = state.parametresFeriesYear;
  const holidays = getFrenchPublicHolidays(year).slice().sort((a, b) => a.date.localeCompare(b.date));

  return `
    <div class="card table-card">
      <div class="view-header-row" style="padding: 20px 20px 0;">
        <div>
          <h2>Jours fériés ${year}</h2>
          <p class="text-muted">Calculés automatiquement chaque année, aucune saisie requise.</p>
        </div>
        <div class="calendar-nav">
          <button class="btn btn-secondary btn-sm" id="btn-feries-prev">← ${year - 1}</button>
          <button class="btn btn-secondary btn-sm" id="btn-feries-next">${year + 1} →</button>
        </div>
      </div>
      <table class="table">
        <thead><tr><th>Date</th><th>Jour férié</th></tr></thead>
        <tbody>
          ${holidays.map(h => `<tr><td>${formatDate(h.date)}</td><td>${escapeHtml(h.label)}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function bindParametresFeriesEvents() {
  document.getElementById('btn-feries-prev').addEventListener('click', () => { state.parametresFeriesYear -= 1; render(); });
  document.getElementById('btn-feries-next').addEventListener('click', () => { state.parametresFeriesYear += 1; render(); });
}

// ---- Sous-vue : Journal d'audit (lecture seule) ----

const AUDIT_ACTIONS = ['Création', 'Modification', 'Suppression', 'Validation', 'Refus', 'Annulation', 'Export', 'Connexion', 'Déconnexion'];

/** Le journal complet peut atteindre 2000 entrées (cf. appendAuditLogEntry) : la recherche/les
 * filtres sont indispensables pour retrouver un événement précis plutôt que de ne montrer que les
 * 200 plus récents sans aucun moyen d'aller plus loin. */
function getFilteredAuditLog() {
  const filters = state.auditFilters;
  let list = DB.getAuditLog();
  if (filters.action) list = list.filter(e => e.action === filters.action);
  if (filters.dateDebut) list = list.filter(e => toISODate(new Date(e.date)) >= filters.dateDebut);
  if (filters.dateFin) list = list.filter(e => toISODate(new Date(e.date)) <= filters.dateFin);
  const term = (filters.search || '').trim().toLowerCase();
  if (term) list = list.filter(e => `${e.entite} ${e.cible} ${e.details || ''}`.toLowerCase().includes(term));
  return list;
}

function renderParametresAudit() {
  const filters = state.auditFilters;
  const total = DB.getAuditLog().length;
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
  DB.logAudit('Export', 'Journal d\'audit', `${log.length} événements`);
}

// ---------------------------------------------------------------------------
// Vue : Planning des absences (semaine / mois / année, tous types confondus)
// ---------------------------------------------------------------------------

/** Statut d'un salarié à une date donnée, tous types d'absence confondus (congé ou télétravail). */
function getStatusForDate(employee, dateStr, leaveRequests, teleworkRequests) {
  const weekday = WEEKDAY_LABELS[(new Date(dateStr).getDay() + 6) % 7];
  if (!(employee.joursTravailles || []).includes(weekday)) {
    return { icon: '—', level: 'off', title: 'Non travaillé' };
  }

  const onLeave = leaveRequests.find(r => r.employeeId === employee.id && dateStr >= r.dateDebut && dateStr <= r.dateFin);
  if (onLeave) {
    const type = DB.getLeaveTypeById(onLeave.typeId);
    return { icon: type ? type.icone : '🏖️', level: 'leave', title: type ? type.nom : 'Congé' };
  }

  const onTelework = teleworkRequests.find(r => r.employeeId === employee.id && dateStr >= r.dateDebut && dateStr <= r.dateFin);
  if (onTelework) return { icon: '💻', level: 'remote', title: 'Télétravail' };

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
  const visibleIds = getVisibleEmployeeIdsForCurrentUser();
  let employees = employeeRepository.getAll().filter(e => !e.archive && isEmployedDuringPeriod(e, periodStart, periodEnd));
  if (visibleIds !== null) employees = employees.filter(e => visibleIds.includes(e.id));
  if (state.planningFilters.service) employees = employees.filter(e => e.service === state.planningFilters.service);
  return employees;
}

function renderPlanning() {
  return `
    <div class="view-header">
      <h1>Planning des absences</h1>
      <p class="view-subtitle">Vue d'ensemble par semaine, mois ou année — congés et télétravail validés</p>
    </div>
    <div class="tabs">
      <button class="tab ${state.planningView === 'semaine' ? 'active' : ''}" data-planning-view="semaine">Semaine</button>
      <button class="tab ${state.planningView === 'mois' ? 'active' : ''}" data-planning-view="mois">Mois</button>
      <button class="tab ${state.planningView === 'annee' ? 'active' : ''}" data-planning-view="annee">Année</button>
    </div>
    <div class="toolbar card">
      <select id="planning-filter-service" class="input">
        <option value="">Tous les services</option>
        ${serviceRepository.getAll().map(s => `<option value="${escapeHtml(s.nom)}" ${state.planningFilters.service === s.nom ? 'selected' : ''}>${escapeHtml(s.nom)}</option>`).join('')}
      </select>
    </div>
    <div id="planning-content">
      ${state.planningView === 'mois' ? renderPlanningMois() : state.planningView === 'annee' ? renderPlanningAnnee() : renderPlanningSemaine()}
    </div>
  `;
}

function renderPlanningStatusCell(employee, dateStr, leaveRequests, teleworkRequests) {
  const status = getStatusForDate(employee, dateStr, leaveRequests, teleworkRequests);
  return `<td class="planning-cell planning-${status.level}" title="${escapeHtml(status.title)}">${status.icon}</td>`;
}

function renderPlanningSemaine() {
  const weekDates = getWeekDates(state.planningWeekOffset);
  const employees = getPlanningEmployees(toISODate(weekDates[0]), toISODate(weekDates[6]));
  const leaveRequests = leaveRepository.getAll().filter(r => r.statut === 'Validé');
  const teleworkRequests = teleworkRepository.getAll().filter(r => r.statut === 'Validé');

  return `
    <div class="view-header-row">
      <p class="view-subtitle">Semaine du ${formatDate(toISODate(weekDates[0]))} au ${formatDate(toISODate(weekDates[6]))}</p>
      <div class="calendar-nav">
        <button class="btn btn-secondary btn-sm" id="btn-planning-week-prev">← Précédente</button>
        <button class="btn btn-secondary btn-sm" id="btn-planning-week-today">Cette semaine</button>
        <button class="btn btn-secondary btn-sm" id="btn-planning-week-next">Suivante →</button>
      </div>
    </div>
    <div class="card table-card">
      ${employees.length === 0 ? `<div class="empty-state"><div class="empty-icon">🗓️</div><p>Aucun salarié à afficher.</p></div>` : `
        <table class="table planning-table">
          <thead><tr><th>Salarié</th>${weekDates.map(d => `<th>${WEEKDAY_LABELS[(d.getDay() + 6) % 7]} ${d.getDate()}</th>`).join('')}</tr></thead>
          <tbody>
            ${employees.map(e => `
              <tr>
                <td>${escapeHtml(e.prenom)} ${escapeHtml(e.nom)}</td>
                ${weekDates.map(d => renderPlanningStatusCell(e, toISODate(d), leaveRequests, teleworkRequests)).join('')}
              </tr>
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
  const leaveRequests = leaveRepository.getAll().filter(r => r.statut === 'Validé');
  const teleworkRequests = teleworkRepository.getAll().filter(r => r.statut === 'Validé');

  return `
    <div class="view-header-row">
      <p class="view-subtitle">${MONTH_NAMES[month]} ${year}</p>
      <div class="calendar-nav">
        <button class="btn btn-secondary btn-sm" id="btn-planning-month-prev">← Précédent</button>
        <button class="btn btn-secondary btn-sm" id="btn-planning-month-today">Ce mois-ci</button>
        <button class="btn btn-secondary btn-sm" id="btn-planning-month-next">Suivant →</button>
      </div>
    </div>
    <div class="card table-card">
      ${employees.length === 0 ? `<div class="empty-state"><div class="empty-icon">🗓️</div><p>Aucun salarié à afficher.</p></div>` : `
        <table class="table planning-table">
          <thead><tr><th>Salarié</th>${Array.from({ length: daysInMonth }, (_, i) => `<th>${i + 1}</th>`).join('')}</tr></thead>
          <tbody>
            ${employees.map(e => `
              <tr>
                <td>${escapeHtml(e.prenom)} ${escapeHtml(e.nom)}</td>
                ${Array.from({ length: daysInMonth }, (_, i) => renderPlanningStatusCell(e, toISODate(new Date(year, month, i + 1)), leaveRequests, teleworkRequests)).join('')}
              </tr>
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

  return `
    <div class="view-header-row">
      <p class="view-subtitle">Jours de congé validés par mois — ${year}</p>
      <div class="calendar-nav">
        <button class="btn btn-secondary btn-sm" id="btn-planning-year-prev">← ${year - 1}</button>
        <button class="btn btn-secondary btn-sm" id="btn-planning-year-next">${year + 1} →</button>
      </div>
    </div>
    <div class="card table-card">
      ${employees.length === 0 ? `<div class="empty-state"><div class="empty-icon">🗓️</div><p>Aucun salarié à afficher.</p></div>` : `
        <table class="table planning-table">
          <thead><tr><th>Salarié</th>${MONTH_NAMES.map(m => `<th>${m.slice(0, 3)}</th>`).join('')}<th>Total</th></tr></thead>
          <tbody>
            ${employees.map(e => {
              const monthCounts = MONTH_NAMES.map((_, monthIndex) =>
                leaveRequests
                  .filter(r => r.employeeId === e.id)
                  .reduce((sum, r) => sum + countRequestDaysInMonth(r.dateDebut, r.dateFin, r.demiJournee, year, monthIndex, e.joursTravailles), 0)
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

function bindPlanningEvents() {
  document.querySelectorAll('[data-planning-view]').forEach(btn => {
    btn.addEventListener('click', () => { state.planningView = btn.dataset.planningView; render(); });
  });

  document.getElementById('planning-filter-service').addEventListener('change', (e) => {
    state.planningFilters.service = e.target.value;
    render();
  });

  if (state.planningView === 'semaine') {
    document.getElementById('btn-planning-week-prev').addEventListener('click', () => { state.planningWeekOffset -= 1; render(); });
    document.getElementById('btn-planning-week-next').addEventListener('click', () => { state.planningWeekOffset += 1; render(); });
    document.getElementById('btn-planning-week-today').addEventListener('click', () => { state.planningWeekOffset = 0; render(); });
  } else if (state.planningView === 'mois') {
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

function renderTeletravail() {
  return `
    <div class="view-header">
      <h1>Télétravail</h1>
      <p class="view-subtitle">Demandes, validations et planning hebdomadaire</p>
    </div>
    <div class="tabs">
      <button class="tab ${state.teletravailTab === 'demandes' ? 'active' : ''}" data-teletravail-tab="demandes">Demandes</button>
      <button class="tab ${state.teletravailTab === 'planning' ? 'active' : ''}" data-teletravail-tab="planning">Planning</button>
    </div>
    <div id="teletravail-tab-content">
      ${state.teletravailTab === 'planning' ? renderTeletravailPlanning() : renderTeletravailDemandes()}
    </div>
  `;
}

function bindTeletravailEvents() {
  document.querySelectorAll('[data-teletravail-tab]').forEach(btn => {
    btn.addEventListener('click', () => { state.teletravailTab = btn.dataset.teletravailTab; render(); });
  });

  if (state.teletravailTab === 'planning') bindTeletravailPlanningEvents();
  else bindTeletravailDemandesEvents();
}

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
      <td class="table-actions">${actions}</td>
    </tr>
  `;
}

function bindTeletravailDemandesEvents() {
  document.getElementById('btn-new-telework-request').addEventListener('click', () => openTeleworkRequestModal());

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
}

function handleApproveTelework(id) {
  const request = teleworkRepository.getById(id);
  teleworkRepository.update(id, advanceWorkflow(request, 'Validé'));
  DB.logAudit('Validation', 'Demande de télétravail', auditLabelForEmployee(request.employeeId));
  showToast('Télétravail validé.');
  render();
}

function handleRefuseTelework(id) {
  const request = teleworkRepository.getById(id);
  openConfirm({
    title: 'Refuser cette demande ?',
    message: 'Le salarié sera informé du refus.',
    confirmLabel: 'Refuser',
    danger: true,
    onConfirm: () => {
      teleworkRepository.update(id, refuseRequest(request));
      DB.logAudit('Refus', 'Demande de télétravail', auditLabelForEmployee(request.employeeId));
      showToast('Demande refusée.');
      render();
    }
  });
}

function handleCancelTelework(id) {
  const request = teleworkRepository.getById(id);
  openConfirm({
    title: 'Annuler ce télétravail ?',
    message: 'Ce jour redeviendra un jour de présence au bureau.',
    confirmLabel: 'Annuler',
    danger: true,
    onConfirm: () => {
      teleworkRepository.update(id, cancelRequest(request));
      DB.logAudit('Annulation', 'Demande de télétravail', auditLabelForEmployee(request.employeeId));
      showToast('Demande annulée.');
      render();
    }
  });
}

// ---- Modale : Nouvelle demande de télétravail ----

function openTeleworkRequestModal(presetEmployeeId) {
  const employees = employeeRepository.getAll().filter(e => !e.archive);

  const html = `
    <div class="modal">
      <div class="modal-header">
        <h2>Nouvelle demande de télétravail</h2>
        <button class="btn-icon" id="btn-close-modal" aria-label="Fermer" title="Fermer">✕</button>
      </div>
      <form id="telework-request-form">
        <div class="modal-body">
          <div class="form-grid">
            ${employeeFieldForRequest(presetEmployeeId, employees)}
            ${textField('dateDebut', 'Date de début', '', true, 'date')}
            ${textField('dateFin', 'Date de fin', '', true, 'date')}
          </div>
          <div class="form-field" style="margin-top: 14px;">
            <label for="f-commentaire">Commentaire</label>
            <textarea class="input" id="f-commentaire" name="commentaire" rows="2"></textarea>
          </div>
          <p class="text-muted" id="telework-quota-hint" style="margin-top: 12px;"></p>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Annuler</button>
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
  const quota = DB.getSettings().teletravailQuotaSemaine;
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
    const nbJours = computeWorkingDays(dateDebut, dateFin, false, employee.joursTravailles);
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
function findTeleworkWeekOverQuota(employeeId, dateDebut, dateFin, employee, quota) {
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

  teleworkRepository.getAll()
    .filter(r => r.employeeId === employeeId && (r.statut === 'Validé' || r.statut === 'En attente'))
    .forEach(r => tally(r.dateDebut, r.dateFin));
  tally(dateDebut, dateFin);

  const overWeek = Object.entries(usageByWeek).find(([, count]) => count > quota);
  return overWeek ? { weekStart: overWeek[0], used: overWeek[1] } : null;
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
  const nbJours = computeWorkingDays(dateDebut, dateFin, false, employee.joursTravailles);

  if (nbJours <= 0) {
    showToast('La période sélectionnée ne comporte aucun jour travaillé.', 'error');
    return;
  }

  const quota = DB.getSettings().teletravailQuotaSemaine;
  const overQuota = findTeleworkWeekOverQuota(employeeId, dateDebut, dateFin, employee, quota);
  if (overQuota) {
    showToast(`Quota de télétravail dépassé pour la semaine du ${formatDate(overQuota.weekStart)} (${formatDurationFR(overQuota.used)}/${formatDurationFR(quota)}).`, 'error');
    return;
  }

  if (hasActiveRequestOverlap(leaveRepository.getAll(), employeeId, dateDebut, dateFin)) {
    showToast('Ce salarié a déjà une demande de congé/absence active sur cette période.', 'error');
    return;
  }

  teleworkRepository.create({ employeeId, dateDebut, dateFin, nbJours, commentaire: formData.get('commentaire') || '' });

  showToast('Demande de télétravail envoyée.');
  closeModal();
  navigateTo('teletravail', { teletravailTab: 'demandes' });
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
    <div class="card table-card">
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
  const settings = DB.getSettings();
  const expenses = getFilteredExpenses();
  const total = expenses.reduce((sum, n) => sum + n.montantTTC, 0);
  const { pageItems, totalPages, page, pageStart } = paginate(expenses, 'fraisPage');

  return `
    <div class="view-header-row">
      <div>
        <h1>Notes de frais</h1>
        <p class="view-subtitle">${expenses.length} note${expenses.length > 1 ? 's' : ''} · ${formatCurrencyFR(total)} TTC</p>
      </div>
      <div class="detail-header-actions">
        <button class="btn btn-secondary" id="btn-export-frais">Exporter CSV</button>
        <button class="btn btn-primary" id="btn-new-expense">+ Nouvelle note</button>
      </div>
    </div>

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
        ${actions}
      </td>
    </tr>
  `;
}

function bindFraisEvents() {
  document.getElementById('btn-new-expense').addEventListener('click', () => openExpenseModal());
  document.getElementById('btn-export-frais').addEventListener('click', exportExpensesCSV);

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
}

function handleApproveExpense(id) {
  const expense = expenseRepository.getById(id);
  const patch = advanceWorkflow(expense, 'Remboursé');
  expenseRepository.update(id, patch);
  DB.logAudit('Validation', 'Note de frais', auditLabelForEmployee(expense.employeeId));
  showToast(patch.statut === 'Remboursé' ? 'Note de frais remboursée.' : 'Étape de validation suivante en attente.');
  render();
}

function handleRefuseExpense(id) {
  const expense = expenseRepository.getById(id);
  openConfirm({
    title: 'Refuser cette note de frais ?',
    message: 'Le salarié sera informé du refus.',
    confirmLabel: 'Refuser',
    danger: true,
    onConfirm: () => {
      expenseRepository.update(id, refuseRequest(expense));
      DB.logAudit('Refus', 'Note de frais', auditLabelForEmployee(expense.employeeId));
      showToast('Note de frais refusée.');
      render();
    }
  });
}

function handleCancelExpense(id) {
  const expense = expenseRepository.getById(id);
  openConfirm({
    title: 'Annuler cette note de frais ?',
    message: 'La validation sera annulée.',
    confirmLabel: 'Annuler',
    danger: true,
    onConfirm: () => {
      expenseRepository.update(id, cancelRequest(expense));
      DB.logAudit('Annulation', 'Note de frais', auditLabelForEmployee(expense.employeeId));
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
  DB.logAudit('Export', 'Notes de frais', `${expenses.length} ligne${expenses.length > 1 ? 's' : ''}`);
}

// ---- Modale : Nouvelle note de frais ----

function openExpenseModal(presetEmployeeId) {
  const employees = employeeRepository.getAll().filter(e => !e.archive);
  const settings = DB.getSettings();
  state.pendingAttachment = null;

  const html = `
    <div class="modal">
      <div class="modal-header">
        <h2>Nouvelle note de frais</h2>
        <button class="btn-icon" id="btn-close-modal" aria-label="Fermer" title="Fermer">✕</button>
      </div>
      <form id="expense-form">
        <div class="modal-body">
          <div class="form-grid">
            ${employeeFieldForRequest(presetEmployeeId, employees)}
            ${selectField('categorie', 'Catégorie', settings.categoriesFrais, settings.categoriesFrais[0])}
            ${textField('date', 'Date de la dépense', '', true, 'date')}
            ${textField('libelle', 'Libellé', '', true)}
          </div>

          <div class="form-grid" id="expense-standard-fields" style="margin-top: 14px;">
            ${textField('montantTTC', 'Montant TTC (€)', '', false, 'number')}
            <div class="form-field">
              <label for="f-tauxTVA">Taux de TVA</label>
              <select class="input" id="f-tauxTVA" name="tauxTVA">
                ${TVA_RATES.map(t => `<option value="${t}">${formatPercentFR(t)}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="form-grid" id="expense-km-fields" style="margin-top: 14px; display: none;">
            ${textField('distanceKm', 'Distance (km, aller-retour inclus)', '', false, 'number')}
            ${textField('puissanceFiscale', 'Puissance fiscale (CV)', '', false, 'number')}
          </div>
          <p class="text-muted" id="expense-km-hint" style="margin-top: 8px;"></p>

          <div class="form-field" style="margin-top: 14px;">
            <label for="f-commentaire">Commentaire</label>
            <textarea class="input" id="f-commentaire" name="commentaire" rows="2"></textarea>
          </div>
          <div class="form-field" style="margin-top: 14px;">
            <label for="f-justificatif">Justificatif (optionnel)</label>
            <input class="input" type="file" id="f-justificatif">
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Annuler</button>
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

  showToast('Note de frais envoyée.');
  closeModal();
  navigateTo('frais');
}

// ---- Modale : Détail / impression d'une note de frais ----

function openExpenseDetailModal(id) {
  const n = expenseRepository.getById(id);
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
  const settings = DB.getSettings();
  const leaveRequests = leaveRepository.getAll();
  const teleworkRequests = teleworkRepository.getAll();

  return employees.map(e => ({
    employee: e,
    result: calculateTicketsRestaurant(e, year, month, leaveRequests, teleworkRequests, settings)
  }));
}

function renderTickets() {
  const settings = DB.getSettings();
  const rows = getTicketsRows();
  const canCorriger = hasPermission(DB.getCurrentUser(), PERMISSIONS.CORRIGER_TICKETS_RESTAURANT);
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

function bindTicketsEvents() {
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
  DB.logAudit('Export', 'Tickets restaurant', `${MONTH_NAMES[state.ticketsMonth]} ${state.ticketsYear}`);
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
  const leaveTypesExportables = DB.getLeaveTypes().filter(t => t.exportPaie);
  const leaveRequests = leaveRepository.getAll().filter(r => r.statut === 'Validé');
  const teleworkRequests = teleworkRepository.getAll().filter(r => r.statut === 'Validé');
  const expenses = expenseRepository.getAll().filter(n => n.statut === 'Remboursé');
  const settings = DB.getSettings();

  return employees.map(e => {
    const congesParType = leaveTypesExportables.map(t =>
      leaveRequests
        .filter(r => r.employeeId === e.id && r.typeId === t.id)
        .reduce((sum, r) => sum + countRequestDaysInMonth(r.dateDebut, r.dateFin, r.demiJournee, year, month, e.joursTravailles), 0)
    );

    const teletravailJours = teleworkRequests
      .filter(r => r.employeeId === e.id)
      .reduce((sum, r) => sum + countRequestDaysInMonth(r.dateDebut, r.dateFin, false, year, month, e.joursTravailles), 0);

    const notesRembourser = expenses
      .filter(n => n.employeeId === e.id && n.date.startsWith(monthStr))
      .reduce((sum, n) => sum + n.montantTTC, 0);

    return {
      employee: e,
      congesParType,
      teletravailJours,
      tickets: calculateTicketsRestaurant(e, year, month, leaveRequests, teleworkRequests, settings),
      notesRembourser
    };
  });
}

function renderExportPaie() {
  const settings = DB.getSettings();
  const modele = settings.exportPaieModele || 'generique';
  const colonnes = settings.exportPaieColonnes || { conges: true, teletravail: true, tickets: true, frais: true };
  const showColonne = (key) => modele !== 'personnalise' || colonnes[key];

  const leaveTypesExportables = showColonne('conges') ? DB.getLeaveTypes().filter(t => t.exportPaie) : [];
  const rows = getPaieRows(state.paieYear, state.paieMonth);

  return `
    <div class="view-header-row">
      <div>
        <h1>Export paie</h1>
        <p class="view-subtitle">${MONTH_NAMES[state.paieMonth]} ${state.paieYear} · ${rows.length} salarié${rows.length > 1 ? 's' : ''}</p>
      </div>
      <div class="detail-header-actions">
        <button class="btn btn-secondary btn-sm" id="btn-paie-prev">← Précédent</button>
        <button class="btn btn-secondary btn-sm" id="btn-paie-today">Ce mois-ci</button>
        <button class="btn btn-secondary btn-sm" id="btn-paie-next">Suivant →</button>
        <button class="btn btn-secondary" id="btn-export-paie">Exporter CSV</button>
      </div>
    </div>

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
  document.getElementById('btn-export-paie').addEventListener('click', exportPaieCSV);

  document.getElementById('f-export-paie-modele').addEventListener('change', (e) => {
    const settings = DB.getSettings();
    settings.exportPaieModele = e.target.value;
    DB.saveSettings(settings);
    render();
  });

  ['conges', 'teletravail', 'tickets', 'frais'].forEach(key => {
    const checkbox = document.getElementById(`f-paieCol.${key}`);
    if (checkbox) checkbox.addEventListener('change', (e) => {
      const settings = DB.getSettings();
      settings.exportPaieColonnes = Object.assign({}, settings.exportPaieColonnes, { [key]: e.target.checked });
      DB.saveSettings(settings);
      render();
    });
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

function exportPaieCSV() {
  const settings = DB.getSettings();
  const modele = settings.exportPaieModele || 'generique';
  const colonnes = settings.exportPaieColonnes || { conges: true, teletravail: true, tickets: true, frais: true };
  const showColonne = (key) => modele !== 'personnalise' || colonnes[key];
  const delimiter = (EXPORT_PAIE_MODELES[modele] || EXPORT_PAIE_MODELES.generique).delimiter;

  const leaveTypesExportables = showColonne('conges') ? DB.getLeaveTypes().filter(t => t.exportPaie) : [];
  const rows = getPaieRows(state.paieYear, state.paieMonth);
  const headers = [
    'Matricule', 'Nom', 'Prénom',
    ...(showColonne('conges') ? leaveTypesExportables.map(t => `${t.nom} (jours)`) : []),
    ...(showColonne('teletravail') ? ['Télétravail (jours)'] : []),
    ...(showColonne('tickets') ? ['Tickets restaurant (nb)', 'Tickets — part salarié (€)'] : []),
    ...(showColonne('frais') ? ['Notes de frais à rembourser (€)'] : [])
  ];
  const data = rows.map(r => [
    r.employee.matricule, r.employee.nom, r.employee.prenom,
    ...(showColonne('conges') ? r.congesParType.map(v => formatNumberFR(v)) : []),
    ...(showColonne('teletravail') ? [formatNumberFR(r.teletravailJours)] : []),
    ...(showColonne('tickets') ? [r.tickets.nbTickets, formatNumberFR(r.tickets.partSalarie)] : []),
    ...(showColonne('frais') ? [formatNumberFR(r.notesRembourser)] : [])
  ]);
  exportRowsToCSVWithDelimiter(headers, data, `export-paie-${state.paieYear}-${String(state.paieMonth + 1).padStart(2, '0')}.csv`, delimiter);
  DB.logAudit('Export', 'Export paie', `${MONTH_NAMES[state.paieMonth]} ${state.paieYear} · modèle ${EXPORT_PAIE_MODELES[modele].label}`);
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
  const user = DB.getCurrentUser();
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
  const settings = DB.getSettings();
  const managers = employeeRepository.getAll().filter(e => e.id !== id);
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
              ${textField('email', 'Email', employee.email, true, 'email')}
              ${textField('telephone', 'Téléphone', employee.telephone)}
              ${textField('adresse.rue', 'Adresse', employee.adresse.rue)}
              ${textField('adresse.codePostal', 'Code postal', employee.adresse.codePostal)}
              ${textField('adresse.ville', 'Ville', employee.adresse.ville)}
              ${textField('dateNaissance', 'Date de naissance', employee.dateNaissance, false, 'date')}
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
              ${selectField('statutPro', 'Statut professionnel', settings.statutsPro, employee.statutPro)}
              ${selectField('typeContrat', 'Type de contrat', settings.typesContrat, employee.typeContrat)}
              ${textField('dateEmbauche', 'Date d\'embauche', employee.dateEmbauche, true, 'date')}
              ${textField('dateFinContrat', 'Date de fin de contrat', employee.dateFinContrat, false, 'date')}
              ${textField('dateFinPeriodeEssai', 'Fin de période d\'essai', employee.dateFinPeriodeEssai, false, 'date')}
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

function textField(name, label, value, required, type = 'text') {
  return `
    <div class="form-field">
      <label for="f-${name}">${escapeHtml(label)}${required ? ' *' : ''}</label>
      <input class="input" type="${type}" id="f-${name}" name="${name}" value="${escapeHtml(value != null ? value : '')}" ${required ? 'required' : ''}>
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
    e.id !== id && e.email.toLowerCase().trim() === (patch.email || '').toLowerCase().trim());
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
    const abonnement = DB.getCurrentCompany().abonnement;
    const offre = (abonnement && OFFRES_BERTOLIS[abonnement.offre]) || OFFRES_BERTOLIS.essai;
    const nbActifs = employeeRepository.getAll().filter(e => !e.archive).length;
    if (offre.nombreSalariesMax !== null && nbActifs >= offre.nombreSalariesMax) {
      showToast(`Plafond de l'offre « ${offre.label} » atteint (${offre.nombreSalariesMax} salariés). Contactez BERTOLIS pour changer d'offre.`, 'error');
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
  if (navBtn) navigateTo(navBtn.dataset.nav);
});

// ---------------------------------------------------------------------------
// Utilitaire de sécurité : échappement HTML avant injection dans le DOM
// ---------------------------------------------------------------------------

function escapeHtml(value) {
  const str = value === null || value === undefined ? '' : String(value);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
