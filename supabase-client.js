/**
 * Seven RH — Pont vers Supabase (Phase 3/4 de la migration, voir le plan de migration).
 *
 * Rôle de ce module : authentification réelle (Supabase Auth) + rapatriement ("hydratation") des
 * données de l'entreprise courante depuis Postgres vers EXACTEMENT la même forme imbriquée que
 * `makeEmptyCompany()` (data.js), pour que tout le reste de l'application (les ~40 fonctions
 * `render*()` d'app.js, toutes synchrones) continue de lire `DB._companiesCache` sans aucun
 * changement — seul le POINT D'ENTRÉE (connexion) est asynchrone, pas le reste de l'app.
 *
 * Chargé comme <script type="module"> dans index.html : s'exécute avant `DOMContentLoaded`
 * (comme un script différé), donc `window.SupabaseSync` existe déjà quand app.js en a besoin.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://wgfycoitixinpqdylvtp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndnZnljb2l0aXhpbnBxZHlsdnRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxMTAxNTUsImV4cCI6MjEwMDY4NjE1NX0.5GGOuPreYO1LjouqZDYABDnRr2X000CksYZGtSzLGyY';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------------------------------------------------------------------------
// Row -> objet JS (même forme que les makeEmptyXxx() de data.js)
// ---------------------------------------------------------------------------

function employeeFromRow(row) {
  const d = row.data || {};
  return {
    id: row.id,
    matricule: row.matricule || '',
    photo: d.photo ?? null,
    civilite: d.civilite ?? 'M.',
    nom: row.nom,
    prenom: row.prenom,
    email: row.email,
    telephone: d.telephone ?? '',
    adresse: d.adresse ?? { rue: '', codePostal: '', ville: '' },
    dateNaissance: d.dateNaissance ?? '',
    lieuNaissance: d.lieuNaissance ?? '',
    nationalite: d.nationalite ?? 'Française',
    numeroSecu: d.numeroSecu ?? '',
    dateEmbauche: d.dateEmbauche ?? '',
    etablissementId: row.etablissement_id ?? '',
    service: row.service ?? '',
    equipe: row.equipe ?? '',
    poste: d.poste ?? '',
    managerIds: row.manager_ids ?? [],
    conventionCollective: d.conventionCollective ?? '',
    statutPro: d.statutPro ?? 'Non cadre',
    typeContrat: d.typeContrat ?? 'CDI',
    dateFinContrat: d.dateFinContrat ?? '',
    dateFinPeriodeEssai: d.dateFinPeriodeEssai ?? '',
    tempsTravail: d.tempsTravail ?? 'Temps plein',
    pourcentageActivite: d.pourcentageActivite ?? 100,
    horairesHebdo: d.horairesHebdo ?? 35,
    forfait: d.forfait ?? 'Aucun',
    regimeRTT: d.regimeRTT ?? '',
    joursTravailles: d.joursTravailles ?? ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'],
    horaireMatinDebut: d.horaireMatinDebut ?? '09:00',
    horaireMatinFin: d.horaireMatinFin ?? '12:00',
    horaireApresMidiDebut: d.horaireApresMidiDebut ?? '13:00',
    horaireApresMidiFin: d.horaireApresMidiFin ?? '17:00',
    statut: d.statut ?? 'Actif',
    dateDepart: d.dateDepart ?? '',
    archive: row.archive ?? false,
    salaireBrutMensuel: d.salaireBrutMensuel ?? 0,
    genre: d.genre ?? '',
    compteurs: d.compteurs ?? {},
    ticketsAjustements: d.ticketsAjustements ?? {},
    variablesPaie: d.variablesPaie ?? {},
    typesAbsenceDesactives: d.typesAbsenceDesactives ?? [],
    dateCreation: row.created_at,
    dateModification: row.updated_at,
    role: row.role,
    // Auth réelle désormais gérée par Supabase Auth — ces champs restent pour la forme (code
    // existant qui les lit encore) mais ne sont plus la source de vérité.
    motDePasse: '',
    tentativesEchouees: 0,
    verrouille: false,
    resetToken: null,
    permissionsOverrides: row.permissions_overrides ?? {}
  };
}

function etablissementFromRow(row) {
  const d = row.data || {};
  return {
    id: row.id, nom: row.nom, codeInterne: d.codeInterne ?? '',
    adresse: d.adresse ?? '', codePostal: d.codePostal ?? '', ville: d.ville ?? '',
    pays: d.pays ?? 'France', email: d.email ?? '', telephone: d.telephone ?? '',
    responsableId: d.responsableId ?? null, principal: row.principal, actif: row.actif
  };
}

function serviceFromRow(row) {
  return { id: row.id, nom: row.nom, equipes: row.equipes ?? [] };
}

function leaveTypeFromRow(row) {
  const d = row.data || {};
  return {
    id: row.id, ordre: row.ordre, actif: row.actif, categorie: row.categorie, nom: row.nom,
    icone: d.icone ?? '🏖️', couleur: d.couleur ?? '#4f46e5', description: d.description ?? '',
    nombreAnnuel: d.nombreAnnuel ?? 0, illimite: d.illimite ?? false, acquisition: d.acquisition ?? 'Annuelle',
    paye: d.paye ?? true, justificatifObligatoire: d.justificatifObligatoire ?? false,
    workflow: d.workflow ?? ['manager'], saisiParSalarie: d.saisiParSalarie ?? true,
    visibleSalarie: d.visibleSalarie ?? true, visibleRH: d.visibleRH ?? true,
    autoriserDemiJournee: d.autoriserDemiJournee ?? true, autoriserPlusieursDemandes: d.autoriserPlusieursDemandes ?? true,
    deduireCompteur: d.deduireCompteur ?? true, deduireRTT: d.deduireRTT ?? false, deduireCP: d.deduireCP ?? false,
    exportPaie: d.exportPaie ?? true
  };
}

function leaveRequestFromRow(row) {
  const d = row.data || {};
  return {
    id: row.id, employeeId: row.employee_id, typeId: row.type_id,
    dateDebut: row.date_debut, dateFin: row.date_fin,
    demiJournee: d.demiJournee ?? null, nbJours: d.nbJours ?? 0,
    commentaire: d.commentaire ?? '', justificatif: d.justificatif ?? null,
    statut: row.statut, workflow: d.workflow ?? [], etapeIndex: row.etape_index,
    historique: d.historique ?? [], prolongations: d.prolongations ?? [], regularisations: d.regularisations ?? [],
    dateCreation: row.created_at, dateModification: row.updated_at
  };
}

// Version "calendrier" (redactée) — voir 0004_calendar_views.sql : ne contient QUE ce qui est
// nécessaire pour l'affichage du calendrier général, jamais les champs sensibles.
function leaveRequestFromCalendarRow(row) {
  return {
    id: row.id, employeeId: row.employee_id, typeId: row.type_id,
    dateDebut: row.date_debut, dateFin: row.date_fin,
    demiJournee: row.demi_journee ?? null, nbJours: 0,
    commentaire: '', justificatif: null,
    statut: row.statut, workflow: [], etapeIndex: -1,
    historique: [], prolongations: [], regularisations: [],
    dateCreation: null, dateModification: null,
    _redacted: true // marqueur interne : ne pas utiliser pour des actions (valider/refuser), lecture calendrier seulement
  };
}

function teleworkRequestFromRow(row) {
  const d = row.data || {};
  return {
    id: row.id, employeeId: row.employee_id, dateDebut: row.date_debut, dateFin: row.date_fin,
    nbJours: d.nbJours ?? 0, commentaire: d.commentaire ?? '', statut: row.statut,
    workflow: d.workflow ?? [], etapeIndex: row.etape_index, historique: d.historique ?? [],
    dateCreation: row.created_at, dateModification: row.updated_at
  };
}

function teleworkRequestFromCalendarRow(row) {
  return {
    id: row.id, employeeId: row.employee_id, dateDebut: row.date_debut, dateFin: row.date_fin,
    nbJours: 0, commentaire: '', statut: row.statut, workflow: [], etapeIndex: -1, historique: [],
    dateCreation: null, dateModification: null, _redacted: true
  };
}

function expenseFromRow(row) {
  const d = row.data || {};
  return {
    id: row.id, employeeId: row.employee_id, categorie: d.categorie ?? '', date: d.date ?? '',
    libelle: d.libelle ?? '', montantTTC: Number(row.montant_ttc) || 0, tauxTVA: d.tauxTVA ?? 20,
    kilometrage: d.kilometrage ?? null, justificatif: d.justificatif ?? null, commentaire: d.commentaire ?? '',
    statut: row.statut, workflow: d.workflow ?? [], etapeIndex: row.etape_index, historique: d.historique ?? [],
    dateCreation: row.created_at, dateModification: row.updated_at
  };
}

function documentFromRow(row) {
  return {
    id: row.id, employeeId: row.employee_id, categorie: row.categorie ?? '', nom: row.nom ?? '',
    dateExpiration: row.date_expiration ?? '',
    fichier: row.fichier_path ? { nom: row.nom, path: row.fichier_path } : null,
    dateCreation: row.created_at, dateModification: row.created_at
  };
}

function draftFromRow(row) {
  return {
    id: row.id, ownerId: row.owner_id, type: row.type, champs: row.champs || {},
    dateCreation: row.created_at, dateModification: row.updated_at
  };
}

function notificationFromRow(row) {
  return { id: row.id, ...(row.data || {}), dateCreation: row.created_at };
}

function auditLogFromRow(row) {
  return { id: row.id, date: row.date, action: row.action, entite: row.entite, cible: row.cible, details: row.details };
}

function favoritesFromRows(rows) {
  const map = {};
  (rows || []).forEach(r => {
    if (!map[r.user_id]) map[r.user_id] = [];
    map[r.user_id].push(r.favorite_employee_id);
  });
  return map;
}

// ---------------------------------------------------------------------------
// Objet JS -> row (sens inverse des fonctions ci-dessus) pour les écritures.
// Toujours { <colonnes indexées propres à la table>, data: {<le reste, tel quel>} }.
// ---------------------------------------------------------------------------

function employeeToRow(e, companyId) {
  const { id, matricule, nom, prenom, email, etablissementId, service, equipe, managerIds, archive,
    permissionsOverrides, role, motDePasse, tentativesEchouees, verrouille, resetToken,
    dateCreation, dateModification, ...rest } = e;
  return {
    id, company_id: companyId, email, role, matricule, nom, prenom,
    manager_ids: managerIds || [], etablissement_id: etablissementId || null,
    service, equipe, archive: Boolean(archive), permissions_overrides: permissionsOverrides || {},
    data: rest
  };
}

function etablissementToRow(e, companyId) {
  const { id, nom, principal, actif, ...rest } = e;
  return { id, company_id: companyId, nom, principal: Boolean(principal), actif: Boolean(actif), data: rest };
}

function serviceToRow(s, companyId) {
  return { id: s.id, company_id: companyId, nom: s.nom, equipes: s.equipes || [] };
}

function leaveTypeToRow(t, companyId) {
  const { id, ordre, actif, categorie, nom, ...rest } = t;
  return { id, company_id: companyId, ordre, actif: Boolean(actif), categorie, nom, data: rest };
}

function leaveRequestToRow(r, companyId) {
  const { id, employeeId, typeId, dateDebut, dateFin, statut, etapeIndex, dateCreation, dateModification, ...rest } = r;
  return {
    id, company_id: companyId, employee_id: employeeId, type_id: typeId,
    date_debut: dateDebut, date_fin: dateFin, statut, etape_index: etapeIndex, data: rest
  };
}

function teleworkRequestToRow(r, companyId) {
  const { id, employeeId, dateDebut, dateFin, statut, etapeIndex, dateCreation, dateModification, ...rest } = r;
  return {
    id, company_id: companyId, employee_id: employeeId,
    date_debut: dateDebut, date_fin: dateFin, statut, etape_index: etapeIndex, data: rest
  };
}

function expenseToRow(r, companyId) {
  const { id, employeeId, montantTTC, statut, etapeIndex, dateCreation, dateModification, ...rest } = r;
  return {
    id, company_id: companyId, employee_id: employeeId,
    montant_ttc: Number(montantTTC) || 0, statut, etape_index: etapeIndex, data: rest
  };
}

// Coffre-fort documentaire : SEULES les métadonnées sont synchronisées pour l'instant (nom,
// catégorie, date d'expiration) — le contenu du fichier (aujourd'hui un dataUrl base64) nécessite
// une vraie migration vers Supabase Storage, volontairement hors périmètre de cet incrément (voir
// le plan de migration, note Phase 1 sur le stockage des fichiers). fichier_path reste donc null.
function documentToRow(d, companyId) {
  return {
    id: d.id, company_id: companyId, employee_id: d.employeeId,
    categorie: d.categorie || '', nom: d.nom || '', date_expiration: d.dateExpiration || null,
    fichier_path: null
  };
}

function draftToRow(d, companyId) {
  return { id: d.id, company_id: companyId, owner_id: d.ownerId, type: d.type, champs: d.champs || {} };
}

function notificationToRow(n, companyId) {
  const { id, dateCreation, ...rest } = n;
  return { id, company_id: companyId, data: rest };
}

// ---------------------------------------------------------------------------
// Synchronisation générique : upsert de toutes les lignes de la liste locale + suppression de
// celles qui n'y sont plus (la liste locale reste la source de vérité après une écriture optimiste).
// ---------------------------------------------------------------------------

async function syncTable(tableName, rows, toRowFn, companyId) {
  const mappedRows = rows.map(r => toRowFn(r, companyId));
  if (mappedRows.length > 0) {
    const { error } = await supabase.from(tableName).upsert(mappedRows);
    if (error) throw error;
  }
  const ids = mappedRows.map(r => r.id);
  let query = supabase.from(tableName).delete().eq('company_id', companyId);
  query = ids.length > 0 ? query.not('id', 'in', `(${ids.join(',')})`) : query;
  const { error: deleteError } = await query;
  if (deleteError) throw deleteError;
}

/** Contrairement à syncTable (resync complet d'une liste, adapté aux tables où tout le monde a le
 * même niveau d'accès en lecture ET en écriture — types de congés, établissements...), ces deux
 * fonctions ne touchent QUE les lignes fournies, sans jamais supprimer par omission. Indispensable
 * pour les entités où le cache local d'un utilisateur contient aussi des données visibles mais non
 * modifiables par lui (l'équipe d'un manager, le calendrier général...) : renvoyer "tout ce qui est
 * visible" y déclencherait une violation RLS sur des lignes qu'il n'a pas le droit d'écrire, même
 * inchangées. Voir DB.saveEmployees/saveLeaveRequests/saveTeleworkRequests/saveExpenses (data.js).
 *
 * insert et update sont volontairement SÉPARÉS (jamais un upsert unique) : Postgres exige de
 * satisfaire à la fois la policy INSERT et la policy UPDATE pour un "INSERT ... ON CONFLICT DO
 * UPDATE", même quand la ligne existe déjà et qu'il s'agit clairement d'une modification — un
 * manager qui n'a pas le droit de CRÉER un salarié se voyait donc bloqué en voulant juste modifier
 * sa propre fiche existante. */
async function insertRows(tableName, rows, toRowFn, companyId) {
  if (rows.length === 0) return;
  const { error } = await supabase.from(tableName).insert(rows.map(r => toRowFn(r, companyId)));
  if (error) throw error;
}

async function updateRows(tableName, rows, toRowFn, companyId) {
  if (rows.length === 0) return;
  const results = await Promise.all(rows.map(r => {
    const row = toRowFn(r, companyId);
    const { id, company_id, ...patch } = row;
    return supabase.from(tableName).update(patch).eq('id', id).eq('company_id', company_id);
  }));
  const failed = results.find(res => res.error);
  if (failed) throw failed.error;
}

async function deleteRow(tableName, id, companyId) {
  const { error } = await supabase.from(tableName).delete().eq('id', id).eq('company_id', companyId);
  if (error) throw error;
}

async function syncSingleRow(tableName, companyId, data) {
  const { error } = await supabase.from(tableName).upsert({ company_id: companyId, data });
  if (error) throw error;
}

async function syncCompanyProfile(companyId, raisonSociale, data) {
  const { error } = await supabase.from('companies').update({ raison_sociale: raisonSociale, data }).eq('id', companyId);
  if (error) throw error;
}

async function syncFavorites(companyId, favoritesMap) {
  const rows = [];
  Object.keys(favoritesMap || {}).forEach(userId => {
    (favoritesMap[userId] || []).forEach(favId => rows.push({ company_id: companyId, user_id: userId, favorite_employee_id: favId }));
  });
  await supabase.from('favorites').delete().eq('company_id', companyId);
  if (rows.length > 0) {
    const { error } = await supabase.from('favorites').insert(rows);
    if (error) throw error;
  }
}

// ---------------------------------------------------------------------------
// Authentification
// ---------------------------------------------------------------------------

async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { success: false, error: error.message };
  return { success: true, session: data.session };
}

/** Crée un vrai compte Supabase Auth — un trigger côté serveur (voir migration
 * 0006_signup_self_create_employee.sql) relie ce compte à une fiche salarié existante si l'email
 * correspond, sinon en crée une nouvelle (rôle "salarie" par défaut) à partir de nom/prénom, passés
 * ici en métadonnées du compte (raw_user_meta_data, lu par le trigger). */
async function signUp(email, password, nom, prenom) {
  const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { nom, prenom } } });
  if (error) return { success: false, error: error.message };
  // Selon la config du projet (confirmation email activée ou non), une session peut déjà exister.
  return { success: true, session: data.session, needsEmailConfirmation: !data.session };
}

async function signOut() {
  await supabase.auth.signOut();
}

async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session || null;
}

/** Retrouve le salarié lié à la session Supabase Auth en cours (via employees.auth_user_id). */
async function fetchCurrentEmployeeRow() {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData || !userData.user) return null;
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .eq('auth_user_id', userData.user.id)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

// ---------------------------------------------------------------------------
// Hydratation complète de l'entreprise courante — reconstruit la forme de makeEmptyCompany()
// ---------------------------------------------------------------------------

async function hydrateCurrentCompany() {
  const employeeRow = await fetchCurrentEmployeeRow();
  if (!employeeRow) return null;
  const companyId = employeeRow.company_id;

  const [
    companyRes, employeesRes, etablissementsRes, servicesRes, leaveTypesRes,
    leaveRequestsRes, leaveCalendarRes, teleworkRequestsRes, teleworkCalendarRes,
    expensesRes, documentsRes, draftsRes, notificationsRes, favoritesRes,
    auditLogRes, schoolHolidaysRes, settingsRes
  ] = await Promise.all([
    supabase.from('companies').select('*').eq('id', companyId).single(),
    supabase.from('employees').select('*').eq('company_id', companyId),
    supabase.from('etablissements').select('*').eq('company_id', companyId),
    supabase.from('services').select('*').eq('company_id', companyId),
    supabase.from('leave_types').select('*').eq('company_id', companyId),
    supabase.from('leave_requests').select('*').eq('company_id', companyId),
    supabase.from('leave_requests_calendar').select('*').eq('company_id', companyId),
    supabase.from('telework_requests').select('*').eq('company_id', companyId),
    supabase.from('telework_requests_calendar').select('*').eq('company_id', companyId),
    supabase.from('expenses').select('*').eq('company_id', companyId),
    supabase.from('documents').select('*').eq('company_id', companyId),
    supabase.from('drafts').select('*').eq('company_id', companyId),
    supabase.from('notifications').select('*').eq('company_id', companyId),
    supabase.from('favorites').select('*').eq('company_id', companyId),
    supabase.from('audit_log').select('*').eq('company_id', companyId),
    supabase.from('school_holidays').select('*').eq('company_id', companyId).maybeSingle(),
    supabase.from('settings').select('*').eq('company_id', companyId).maybeSingle()
  ]);

  const company = companyRes.data;

  // Fusionne la table complète (ce que RLS autorise pour ce rôle : soi-même/son équipe/tout si
  // RH-Directeur) avec la vue calendrier redactée (tout le monde, champs minimaux) — sans écraser
  // une entrée déjà présente en version complète.
  function mergeCalendar(fullRows, calendarRows, fullMapper, calendarMapper) {
    const byId = new Map(fullRows.map(r => [r.id, fullMapper(r)]));
    calendarRows.forEach(r => { if (!byId.has(r.id)) byId.set(r.id, calendarMapper(r)); });
    return Array.from(byId.values());
  }

  return {
    id: company.id,
    raisonSociale: company.raison_sociale,
    ...(company.data || {}),
    etablissements: (etablissementsRes.data || []).map(etablissementFromRow),
    employees: (employeesRes.data || []).map(employeeFromRow),
    services: (servicesRes.data || []).map(serviceFromRow),
    settings: settingsRes.data ? settingsRes.data.data : {},
    leaveTypes: (leaveTypesRes.data || []).map(leaveTypeFromRow),
    leaveRequests: mergeCalendar(leaveRequestsRes.data || [], leaveCalendarRes.data || [], leaveRequestFromRow, leaveRequestFromCalendarRow),
    teleworkRequests: mergeCalendar(teleworkRequestsRes.data || [], teleworkCalendarRes.data || [], teleworkRequestFromRow, teleworkRequestFromCalendarRow),
    expenses: (expensesRes.data || []).map(expenseFromRow),
    documents: (documentsRes.data || []).map(documentFromRow),
    schoolHolidays: schoolHolidaysRes.data ? schoolHolidaysRes.data.data : null,
    auditLog: (auditLogRes.data || []).map(auditLogFromRow),
    favorites: favoritesFromRows(favoritesRes.data),
    notifications: (notificationsRes.data || []).map(notificationFromRow),
    brouillons: (draftsRes.data || []).map(draftFromRow),
    _currentEmployeeId: employeeRow.id
  };
}

async function updatePassword(newPassword) {
  return supabase.auth.updateUser({ password: newPassword });
}

async function sendPasswordResetEmail(email) {
  return supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
}

/** true si la session en cours vient d'un lien de récupération de mot de passe (email) —
 * app.js s'en sert pour router automatiquement vers l'écran "nouveau mot de passe". */
function onPasswordRecovery(callback) {
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') callback();
  });
}

// ---------------------------------------------------------------------------
// Points d'entrée d'écriture appelés depuis data.js (voir DB.save*() — cache local optimiste :
// la liste locale est déjà à jour au moment de l'appel, ceci ne fait que la refléter sur Supabase
// en arrière-plan). Chaque fonction lève en cas d'erreur réseau — l'appelant (data.js) décide de la
// gestion (toast d'erreur, la donnée reste correcte localement dans tous les cas).
// ---------------------------------------------------------------------------

// employees/leaveRequests/teleworkRequests/expenses : insert/update séparés (jamais syncTable/upsert)
// — le cache local d'un utilisateur contient aussi des lignes qu'il peut lire mais pas écrire
// (l'équipe d'un manager, le calendrier général...), donc jamais de resync complet ni de
// suppression par omission ; et jamais d'upsert unique (voir le commentaire sur insertRows/updateRows).
async function pushEmployees({ added, modified }, companyId) {
  await insertRows('employees', added, employeeToRow, companyId);
  await updateRows('employees', modified, employeeToRow, companyId);
}
async function pushLeaveRequests({ added, modified }, companyId) {
  await insertRows('leave_requests', added, leaveRequestToRow, companyId);
  await updateRows('leave_requests', modified, leaveRequestToRow, companyId);
}
async function pushTeleworkRequests({ added, modified }, companyId) {
  await insertRows('telework_requests', added, teleworkRequestToRow, companyId);
  await updateRows('telework_requests', modified, teleworkRequestToRow, companyId);
}
async function pushExpenses({ added, modified }, companyId) {
  await insertRows('expenses', added, expenseToRow, companyId);
  await updateRows('expenses', modified, expenseToRow, companyId);
}

const pushEtablissements = (rows, companyId) => syncTable('etablissements', rows, etablissementToRow, companyId);
const pushServices = (rows, companyId) => syncTable('services', rows, serviceToRow, companyId);
const pushLeaveTypes = (rows, companyId) => syncTable('leave_types', rows, leaveTypeToRow, companyId);
const pushDocuments = (rows, companyId) => syncTable('documents', rows, documentToRow, companyId);
const pushDrafts = (rows, companyId) => syncTable('drafts', rows, draftToRow, companyId);
const pushNotifications = (rows, companyId) => syncTable('notifications', rows, notificationToRow, companyId);
const pushFavorites = (companyId, map) => syncFavorites(companyId, map);
const pushSchoolHolidays = (companyId, data) => syncSingleRow('school_holidays', companyId, data);
const pushSettings = (companyId, data) => syncSingleRow('settings', companyId, data);
const pushCompanyProfile = (companyId, raisonSociale, data) => syncCompanyProfile(companyId, raisonSociale, data);

/** Journal d'audit : append-only, jamais un resync complet (jusqu'à 2000 entrées — un resync à
 * chaque action serait ruineux). Une seule ligne insérée par appel. */
async function pushAuditLogEntry(entry, companyId) {
  const { error } = await supabase.from('audit_log').insert({
    id: entry.id, company_id: companyId, date: entry.date,
    action: entry.action, entite: entry.entite, cible: entry.cible, details: entry.details
  });
  if (error) throw error;
}

async function pushClearAuditLog(companyId) {
  const { error } = await supabase.from('audit_log').delete().eq('company_id', companyId);
  if (error) throw error;
}

window.SupabaseSync = {
  signIn, signUp, signOut, getSession, fetchCurrentEmployeeRow, hydrateCurrentCompany,
  updatePassword, sendPasswordResetEmail, onPasswordRecovery,
  pushEmployees, pushEtablissements, pushServices, pushLeaveTypes, pushLeaveRequests,
  pushTeleworkRequests, pushExpenses, pushDocuments, pushDrafts, pushNotifications,
  pushFavorites, pushSchoolHolidays, pushSettings, pushCompanyProfile, pushAuditLogEntry, pushClearAuditLog,
  deleteRow
};
