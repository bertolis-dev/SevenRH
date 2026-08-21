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

/** Le site est hébergé dans un sous-dossier (GitHub Pages, ex. https://<compte>.github.io/SevenRH/),
 * pas à la racine du domaine — se fier au seul `window.location.origin` pour les liens envoyés par
 * email (confirmation, réinitialisation de mot de passe) renvoie vers la racine du compte GitHub,
 * qui n'a pas de site ("404 There isn't a GitHub Pages site here"). Même correctif que
 * currentReturnBase() (data.js), dupliqué ici car ce module tourne dans un scope ES module séparé. */
function currentSiteBase() {
  return window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
}

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
    dateDernierEntretienProfessionnel: d.dateDernierEntretienProfessionnel ?? '',
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
    menusDesactives: d.menusDesactives ?? [],
    dateCreation: row.created_at,
    dateModification: row.updated_at,
    role: row.role,
    // Auth réelle désormais gérée par Supabase Auth — ces champs restent pour la forme (code
    // existant qui les lit encore) mais ne sont plus la source de vérité.
    motDePasse: '',
    tentativesEchouees: 0,
    verrouille: false,
    resetToken: null,
    authUserId: row.auth_user_id ?? null,
    mustChangePassword: d.mustChangePassword ?? false,
    permissionsOverrides: row.permissions_overrides ?? {},
    // D2 (audit fiabilité du 19/08/2026) : ces 6 champs étaient bien poussés vers Supabase
    // (employeeToRow ne les exclut pas, ils atterrissent dans `data`) mais jamais relus ici —
    // écrits une fois, puis silencieusement perdus à la prochaine connexion/rechargement.
    categorieSalarieId: d.categorieSalarieId ?? null,
    dateDerniereVisiteMedicale: d.dateDerniereVisiteMedicale ?? '',
    onboardingChecklist: d.onboardingChecklist ?? [],
    offboardingChecklist: d.offboardingChecklist ?? [],
    avenants: d.avenants ?? [],
    heuresSupplementaires: d.heuresSupplementaires ?? {}
  };
}

/** Même forme que makeEmptyAbonnement() (data.js) — row est null pour une entreprise pas encore
 * migrée par 0010 (ne devrait plus arriver après la migration, mais évite un company.abonnement
 * undefined qui casserait tout appelant qui lit ses champs sans garde). */
function abonnementFromRow(row) {
  if (!row) {
    // Échec fermé : une entreprise sans ligne subscriptions (ne devrait plus arriver après la
    // migration 0012) est restreinte plutôt que de bénéficier d'un accès illimité par erreur.
    return { offre: 'essai', periodicite: 'mensuel', statut: 'non_souscrit', dateDebut: '', dateRenouvellement: '', nombreSalariesMax: 1 };
  }
  return {
    offre: row.offre,
    periodicite: row.periodicite || 'mensuel',
    statut: row.statut,
    dateDebut: row.date_debut || '',
    dateRenouvellement: row.date_renouvellement || '',
    nombreSalariesMax: row.nombre_salaries_max
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

function ticketFromRow(row) {
  const data = row.data || {};
  return {
    id: row.id, employeeId: row.employee_id, route: row.route || '',
    contexte: data.contexte || {}, titre: row.titre, description: row.description || '',
    categorie: row.categorie || '', priorite: row.priorite, statut: row.statut,
    pieceJointe: data.pieceJointe || null, comments: data.comments || [],
    historique: data.historique || [], aiAnalysis: data.aiAnalysis || null,
    dateLivraison: row.date_livraison || null,
    dateCreation: row.created_at, dateModification: row.updated_at
  };
}

function entretienFromRow(row) {
  return {
    id: row.id, employeeId: row.employee_id, type: row.type,
    datePrevue: row.date_prevue, dateRealisee: row.date_realisee,
    statut: row.statut, objectifs: row.objectifs || '', autoEvaluation: row.auto_evaluation || '',
    retourManager: row.retour_manager || '', historique: row.historique || [],
    dateCreation: row.created_at, dateModification: row.updated_at
  };
}

function ideeFromRow(row) {
  return {
    id: row.id, employeeId: row.employee_id, titre: row.titre, description: row.description || '',
    statut: row.statut, votes: row.votes || [], historique: row.historique || [],
    dateCreation: row.created_at, dateModification: row.updated_at
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
    permissionsOverrides, role, motDePasse, tentativesEchouees, verrouille, resetToken, authUserId,
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

// Coffre-fort documentaire : seules les métadonnées (nom, catégorie, date d'expiration) et le
// CHEMIN Storage du fichier sont synchronisés — jamais son contenu (voir uploadEmployeeDocumentFile,
// appelée séparément depuis app.js une fois le document créé, puis documentRepository.update patche
// `fichier` avec {nom, path}). Tant que l'upload n'a pas encore réussi (ou pour un document créé
// avant cette migration), d.fichier ne porte qu'un dataUrl local : fichier_path reste alors null.
function documentToRow(d, companyId) {
  return {
    id: d.id, company_id: companyId, employee_id: d.employeeId,
    categorie: d.categorie || '', nom: d.nom || '', date_expiration: d.dateExpiration || null,
    fichier_path: (d.fichier && d.fichier.path) || null
  };
}

function draftToRow(d, companyId) {
  return { id: d.id, company_id: companyId, owner_id: d.ownerId, type: d.type, champs: d.champs || {} };
}

// Utilisé uniquement à la CRÉATION d'un ticket (voir insertRows dans pushSupportTickets) — un
// ticket existant n'est jamais réécrit via cette fonction (statut/commentaires ont leurs propres
// chemins dédiés, voir updateTicketStatus/appendTicketComment).
function ticketToRow(t, companyId) {
  return {
    id: t.id, company_id: companyId, employee_id: t.employeeId, route: t.route || null,
    titre: t.titre || '', description: t.description || '', categorie: t.categorie || null,
    priorite: t.priorite || 'normale', statut: t.statut || 'ouvert', date_livraison: t.dateLivraison || null,
    data: {
      contexte: t.contexte || {}, pieceJointe: t.pieceJointe || null, comments: t.comments || [],
      historique: t.historique || [], aiAnalysis: t.aiAnalysis || null
    }
  };
}

function entretienToRow(e, companyId) {
  return {
    id: e.id, company_id: companyId, employee_id: e.employeeId, type: e.type || 'professionnel',
    date_prevue: e.datePrevue, date_realisee: e.dateRealisee || null, statut: e.statut || 'a_planifier',
    objectifs: e.objectifs || null, auto_evaluation: e.autoEvaluation || null,
    retour_manager: e.retourManager || null, historique: e.historique || []
  };
}

function ideeToRow(i, companyId) {
  return {
    id: i.id, company_id: companyId, employee_id: i.employeeId, titre: i.titre || '',
    description: i.description || null, statut: i.statut || 'nouvelle', votes: i.votes || [],
    historique: i.historique || []
  };
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

/** Inscription "Créer mon entreprise" (migration 0012) : marque le compte avec intent
 * "creer_entreprise" (le trigger serveur ne doit alors tenter aucun rattachement par domaine
 * d'email) et transmet raisonSociale/nom/prenom en métadonnées — c'est create_company_self_service
 * (RPC ci-dessous) qui les relit depuis auth.users, pour rester utilisable même après un délai de
 * confirmation d'email (voir son commentaire dans la migration). */
async function signUpNewCompany(email, password, raisonSociale, nom, prenom) {
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { data: { nom, prenom, raisonSociale, intent: 'creer_entreprise' }, emailRedirectTo: currentSiteBase() }
  });
  if (error) return { success: false, error: error.message };
  // Protection anti-énumération de Supabase : pour un email déjà inscrit (confirmé ou non), signUp()
  // répond succès SANS ERREUR et SANS renvoyer d'email — data.user.identities est alors un tableau
  // vide (seul signal disponible côté client). Sans cette détection, l'appelant croit à tort qu'un
  // email de confirmation vient d'être envoyé ("vérifiez votre boîte mail") alors qu'aucun email n'a
  // même été transmis au fournisseur SMTP (jamais visible dans ses logs) — symptôme réellement vécu.
  const emailAlreadyRegistered = !data.session && Array.isArray(data.user?.identities) && data.user.identities.length === 0;
  return { success: true, session: data.session, needsEmailConfirmation: !data.session, emailAlreadyRegistered };
}

/** Appelle la RPC create_company_self_service — nécessite une session active (auth.uid() côté
 * serveur), donc uniquement appelable une fois la confirmation d'email passée s'il y en a une.
 * Rejouable sans risque : la RPC vérifie elle-même qu'aucune fiche salarié n'existe déjà pour ce
 * compte avant de créer quoi que ce soit. */
async function createCompanySelfService() {
  const { data, error } = await supabase.rpc('create_company_self_service');
  if (error) return { success: false, error: error.message };
  return { success: true, companyId: data };
}

/** Renvoie l'email de confirmation pour une inscription déjà faite mais pas encore confirmée —
 * signUp() ne renvoie pas systématiquement un nouvel email pour une adresse déjà en attente (pour
 * éviter le spam), donc un simple nouveau clic sur "Créer mon compte" ne suffit pas si le premier
 * email n'est jamais arrivé (spam, faute de frappe corrigée, lien expiré...). Reste soumis aux
 * mêmes limites de fréquence Supabase côté serveur — un utilisateur qui insiste verra l'erreur de
 * Supabase plutôt qu'un email supplémentaire. */
async function resendSignupConfirmation(email) {
  const { error } = await supabase.auth.resend({
    type: 'signup', email, options: { emailRedirectTo: currentSiteBase() }
  });
  if (error) return { success: false, error: error.message };
  return { success: true };
}

async function signOut() {
  await supabase.auth.signOut();
}

/** provider : 'google' | 'azure' (Microsoft). Redirige immédiatement hors de la page — la liaison au
 * salarié existant se fait automatiquement côté serveur par email (trigger link_new_auth_user_to_
 * employee, 0005_signup_auto_link.sql, déjà générique : il ne regarde jamais COMMENT le compte
 * auth.users a été créé, seulement son email). Rien de spécifique à l'OAuth à ajouter côté base. */
async function signInWithOAuth(provider) {
  const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: currentSiteBase() } });
  if (error) return { success: false, error: error.message };
  return { success: true };
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
    expensesRes, documentsRes, supportTicketsRes, entretiensRes, ideesRes, draftsRes, notificationsRes, favoritesRes,
    auditLogRes, schoolHolidaysRes, settingsRes, subscriptionRes, subscriptionModulesRes
  ] = await Promise.all([
    supabase.from('companies').select('*').eq('id', companyId).single(),
    supabase.from('employees').select('*').eq('company_id', companyId),
    supabase.from('etablissements').select('*').eq('company_id', companyId),
    supabase.from('services').select('*').eq('company_id', companyId),
    supabase.from('leave_types').select('*').eq('company_id', companyId),
    // D4/D10 (audit fiabilité du 19/08/2026) : aucune de ces requêtes n'avait de .order() — au-delà
    // du plafond de lignes par défaut de Supabase (1000, réglage projet, pas dans ce code), l'ordre
    // renvoyé n'est pas garanti, donc pas forcément les plus récentes. Ajout d'un tri explicite
    // partout par cohérence, même si seul audit_log dépasse vraiment 1000 lignes en pratique
    // aujourd'hui. Pas de .limit() ajouté sur les tables métier (congés/télétravail/frais/
    // documents/tickets/entretiens/idées/brouillons) : les calculs de solde/compteur ont besoin de
    // l'historique complet, tronquer ici introduirait le même genre de bug que D17 plutôt que de le
    // corriger — seuls audit_log et notifications (des flux de consultation, pas des données de
    // calcul) reçoivent une limite explicite, alignée sur les 2000 déjà utilisés côté client par
    // appendAuditLogEntry.
    supabase.from('leave_requests').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
    supabase.from('leave_requests_calendar').select('*').eq('company_id', companyId),
    supabase.from('telework_requests').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
    supabase.from('telework_requests_calendar').select('*').eq('company_id', companyId),
    supabase.from('expenses').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
    supabase.from('documents').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
    supabase.from('support_tickets').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
    supabase.from('entretiens').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
    supabase.from('idees').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
    supabase.from('drafts').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
    supabase.from('notifications').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(500),
    supabase.from('favorites').select('*').eq('company_id', companyId),
    supabase.from('audit_log').select('*').eq('company_id', companyId).order('date', { ascending: false }).limit(2000),
    supabase.from('school_holidays').select('*').eq('company_id', companyId).maybeSingle(),
    supabase.from('settings').select('*').eq('company_id', companyId).maybeSingle(),
    supabase.from('subscriptions').select('*').eq('company_id', companyId).maybeSingle(),
    supabase.from('subscription_modules').select('*').eq('company_id', companyId)
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
    // Toujours après le spread de company.data : abonnement vit désormais dans sa propre table
    // (migration 0010, jamais dans data) — au cas où une ligne pas encore migrée aurait encore un
    // data.abonnement obsolète, cette clé explicite gagne toujours.
    // .modules : présent seulement pour un abonnement à la carte (offre === 'a_la_carte') — tableau
    // vide sinon, jamais undefined (voir hasModule(), app.js, qui lit toujours .modules directement).
    abonnement: {
      ...abonnementFromRow(subscriptionRes.data),
      modules: (subscriptionModulesRes.data || []).map(r => ({ key: r.module_key, quantite: r.quantite }))
    },
    etablissements: (etablissementsRes.data || []).map(etablissementFromRow),
    employees: (employeesRes.data || []).map(employeeFromRow),
    services: (servicesRes.data || []).map(serviceFromRow),
    settings: settingsRes.data ? settingsRes.data.data : {},
    leaveTypes: (leaveTypesRes.data || []).map(leaveTypeFromRow),
    leaveRequests: mergeCalendar(leaveRequestsRes.data || [], leaveCalendarRes.data || [], leaveRequestFromRow, leaveRequestFromCalendarRow),
    teleworkRequests: mergeCalendar(teleworkRequestsRes.data || [], teleworkCalendarRes.data || [], teleworkRequestFromRow, teleworkRequestFromCalendarRow),
    expenses: (expensesRes.data || []).map(expenseFromRow),
    documents: (documentsRes.data || []).map(documentFromRow),
    supportTickets: (supportTicketsRes.data || []).map(ticketFromRow),
    entretiens: (entretiensRes.data || []).map(entretienFromRow),
    idees: (ideesRes.data || []).map(ideeFromRow),
    schoolHolidays: schoolHolidaysRes.data ? schoolHolidaysRes.data.data : null,
    auditLog: (auditLogRes.data || []).map(auditLogFromRow),
    favorites: favoritesFromRows(favoritesRes.data),
    notifications: (notificationsRes.data || []).map(notificationFromRow),
    brouillons: (draftsRes.data || []).map(draftFromRow),
    _currentEmployeeId: employeeRow.id
  };
}

/** Appelle la fonction serveur "billing" (Edge Function Supabase) — invoke() du client Supabase
 * transmet automatiquement le jeton de la session en cours, exactement ce dont has_permission()/
 * current_company_id() ont besoin côté serveur pour vérifier qui appelle (voir supabase/functions/
 * billing/index.ts). action : "checkout" | "resync" | "portal" | "confirm". */
async function invokeBilling(action, payload) {
  const { data, error } = await supabase.functions.invoke('billing', { body: { action, ...payload } });
  if (error) {
    let message = error.message;
    try {
      const ctx = await error.context.json();
      if (ctx && ctx.error) message = ctx.error;
    } catch { /* réponse non-JSON, on garde le message par défaut */ }
    return { success: false, error: message };
  }
  return { success: true, ...data };
}

/** Appelle la fonction serveur "manage-employee-account" — un Directeur/RH crée ("create") ou
 * réinitialise ("reset") directement le compte de connexion d'un salarié de son entreprise (voir
 * supabase/functions/manage-employee-account/index.ts). Renvoie le mot de passe (généré côté
 * serveur pour "create", ou celui passé/généré pour "reset") — à afficher une seule fois, jamais
 * récupérable ensuite. */
/** Nom + logo d'une entreprise, lisible SANS session (page de candidature publique) — jamais le
 * reste des champs de `companies`, voir get_company_public_info (0025_company_logo.sql). */
async function getCompanyPublicInfo(companyId) {
  const { data, error } = await supabase.rpc('get_company_public_info', { p_company_id: companyId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row ? { raisonSociale: row.raison_sociale, logo: row.logo, postesOuverts: row.postes_ouverts || [] } : null;
}

/** Upload du logo (Paramètres → Entreprise) — bucket public par conception (voir
 * 0025_company_logo.sql) : contrairement à candidatures-files, un logo n'a rien de confidentiel et
 * doit être affichable sans authentification sur la page de candidature. Renvoie l'URL publique
 * permanente à stocker dans companies.data.logo (companyRepository.saveProfile). */
async function uploadCompanyLogo(companyId, file) {
  const ext = (file.type === 'image/png') ? 'png' : (file.type === 'image/jpeg') ? 'jpg' : (file.type === 'image/svg+xml') ? 'svg' : null;
  if (!ext) throw new Error('Format non accepté (PNG, JPEG ou SVG uniquement).');
  const path = `${companyId}/logo.${ext}`;
  const { error } = await supabase.storage.from('company-logos').upload(path, file, { contentType: file.type, upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from('company-logos').getPublicUrl(path);
  return data.publicUrl;
}

/** Dépôt de candidature (voir renderCandidatureForm, app.js) — la seule action de toute
 * l'application appelée SANS session (le visiteur qui scanne le QR "Embauche" n'a jamais de
 * compte). fetch() direct plutôt que supabase.functions.invoke() : ce dernier a produit "Corps de
 * requête invalide" côté serveur (Deno req.formData() n'arrivait pas à relire le corps) — la
 * sérialisation d'un FormData contenant des fichiers par functions.invoke() n'est pas fiable selon
 * la version du SDK. fetch() brut envoie le FormData tel quel (multipart, boundary posé par le
 * navigateur lui-même), exactement comme les tests curl qui ont confirmé la fonction serveur saine. */
async function submitCandidature(formData) {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/candidature-submit`, {
      method: 'POST',
      body: formData
    });
    let body = {};
    try { body = await res.json(); } catch { /* réponse non-JSON (ne devrait pas arriver) */ }
    if (!res.ok) return { success: false, error: body.error || 'Impossible d\'envoyer la candidature.', debug: body.debug };
    return { success: true, ...body };
  } catch {
    return { success: false, error: 'Impossible de contacter le serveur (problème réseau).' };
  }
}

function candidatureFromRow(row) {
  return {
    id: row.id,
    nom: row.nom,
    prenom: row.prenom,
    email: row.email,
    telephone: row.telephone,
    postes: row.postes || [],
    cvPath: row.cv_path,
    lettrePath: row.lettre_path,
    lettreTexte: row.lettre_texte,
    statut: row.statut,
    employeeId: row.employee_id,
    dateSoumission: row.created_at
  };
}

async function getCandidatures(companyId) {
  const { data, error } = await supabase.from('candidatures').select('*').eq('company_id', companyId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(candidatureFromRow);
}

async function setCandidatureStatut(id, statut, employeeId) {
  const { error } = await supabase.rpc('set_candidature_statut', { p_id: id, p_statut: statut, p_employee_id: employeeId || null });
  if (error) throw error;
}

/** "Pas intéressé" — voir candidature-reject/index.ts : envoie le message au candidat (Resend) PUIS
 * archive côté serveur (jamais côté client seul, pour ne jamais archiver sans email parti). Corps
 * JSON simple (pas de fichier ici) : functions.invoke() est fiable pour ce cas, contrairement à
 * submitCandidature (voir son commentaire) qui devait passer par fetch() pour un FormData. */
async function rejectCandidature(candidatureId, message) {
  const { data, error } = await supabase.functions.invoke('candidature-reject', { body: { candidatureId, message } });
  if (error) {
    let msg = error.message;
    try {
      const ctx = await error.context.json();
      if (ctx && ctx.error) msg = ctx.error;
    } catch { /* réponse non-JSON, on garde le message par défaut */ }
    return { success: false, error: msg };
  }
  return { success: true, ...data };
}

/** URL signée de courte durée pour un fichier de candidature (CV/lettre) — jamais d'URL publique
 * permanente sur un document personnel (RGPD), voir la policy storage candidatures_files_select
 * (0024_candidatures.sql), qui restreint déjà la lecture à gererSalaries de l'entreprise ; l'URL
 * signée est juste le mécanisme d'accès effectif à un fichier d'un bucket privé. */
async function getCandidatureFileUrl(path) {
  const { data, error } = await supabase.storage.from('candidatures-files').createSignedUrl(path, 60);
  if (error) throw error;
  return data.signedUrl;
}

/** D1+D9 (audit fiabilité 19/08/2026) : upload réel dans un bucket Storage privé, appelé depuis
 * app.js APRÈS la création du document/congé/note de frais (une fois son id connu) — voir
 * uploadJustificatifBestEffort (app.js). Chemin "<company>/<employee>/<record>-<timestamp>-<nom>",
 * même patron que candidatures-files/company-logos ; le composant de temps évite toute collision
 * si un même record reçoit un nouveau fichier (prolongation d'arrêt maladie). */
async function uploadFileToBucket(bucket, companyId, employeeId, recordId, file) {
  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  const path = `${companyId}/${employeeId}/${recordId}-${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type || 'application/octet-stream' });
  if (error) throw error;
  return path;
}

/** URL signée de courte durée — voir employee_documents_select (0030_employee_files_storage.sql) :
 * bucket privé, jamais d'URL publique permanente sur un document RH personnel. */
async function uploadEmployeeDocumentFile(companyId, employeeId, docId, file) {
  return uploadFileToBucket('employee-documents', companyId, employeeId, docId, file);
}
async function getEmployeeDocumentFileUrl(path) {
  const { data, error } = await supabase.storage.from('employee-documents').createSignedUrl(path, 60);
  if (error) throw error;
  return data.signedUrl;
}

/** Même principe pour les justificatifs de congé/note de frais (bucket "justificatifs", voir
 * justificatifs_select/justificatifs_insert, 0030_employee_files_storage.sql). */
async function uploadJustificatifFile(companyId, employeeId, requestId, file) {
  return uploadFileToBucket('justificatifs', companyId, employeeId, requestId, file);
}
async function getJustificatifFileUrl(path) {
  const { data, error } = await supabase.storage.from('justificatifs').createSignedUrl(path, 60);
  if (error) throw error;
  return data.signedUrl;
}

async function manageEmployeeAccount(action, employeeId, password) {
  const { data, error } = await supabase.functions.invoke('manage-employee-account', { body: { action, employeeId, password } });
  if (error) {
    let message = error.message;
    try {
      const ctx = await error.context.json();
      if (ctx && ctx.error) message = ctx.error;
    } catch { /* réponse non-JSON, on garde le message par défaut */ }
    return { success: false, error: message };
  }
  return { success: true, ...data };
}

async function updatePassword(newPassword) {
  return supabase.auth.updateUser({ password: newPassword });
}

async function sendPasswordResetEmail(email) {
  return supabase.auth.resetPasswordForEmail(email, { redirectTo: currentSiteBase() });
}

/** true si la session en cours vient d'un lien de récupération de mot de passe (email) —
 * app.js s'en sert pour router automatiquement vers l'écran "nouveau mot de passe".
 *
 * L'écouteur est posé ici, au chargement du module (donc avant DOMContentLoaded), pas dans le
 * callback passé par app.js : supabase-js détecte le token de récupération dans l'URL de façon
 * asynchrone dès la création du client (ligne 19), et peut émettre PASSWORD_RECOVERY avant qu'app.js
 * n'ait eu la main pour s'abonner. Le flag mémorise l'évènement ; onPasswordRecovery() le rejoue
 * immédiatement à l'inscription si l'évènement est déjà passé. */
let passwordRecoveryDetected = false;
const passwordRecoveryCallbacks = [];
// Bascule multi-compte (§ comptes gardés en parallèle, voir DB.getSavedAccounts()) : le
// refresh_token stocké pour le compte ACTIF doit suivre chaque rotation automatique, sinon il
// devient périmé après le premier rafraîchissement silencieux et la bascule échoue la prochaine
// fois qu'on revient sur ce compte — même en restant connecté sans interruption entre les deux.
const sessionRefreshCallbacks = [];
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') {
    passwordRecoveryDetected = true;
    passwordRecoveryCallbacks.forEach(cb => cb());
  }
  if (event === 'TOKEN_REFRESHED' && session) {
    sessionRefreshCallbacks.forEach(cb => cb(session));
  }
});

function onPasswordRecovery(callback) {
  passwordRecoveryCallbacks.push(callback);
  if (passwordRecoveryDetected) callback();
}

function wasPasswordRecoveryDetected() {
  return passwordRecoveryDetected;
}

function onSessionRefreshed(callback) {
  sessionRefreshCallbacks.push(callback);
}

/** Réactive une session déjà connue (compte gardé en parallèle, voir DB.switchToSavedAccount) sans
 * repasser par signInWithPassword — remplace la session active du client par celle-ci. */
async function switchToSession(storedSession) {
  const { error } = await supabase.auth.setSession({
    access_token: storedSession.access_token,
    refresh_token: storedSession.refresh_token
  });
  if (error) return { success: false, error: error.message };
  return { success: true };
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
// Insertion uniquement, jamais un resync complet (voir DB.addSupportTicket, data.js) — un ticket
// existant n'est jamais réécrit via cette fonction.
const pushSupportTickets = (rows, companyId) => insertRows('support_tickets', rows, ticketToRow, companyId);

/** Un entretien n'est jamais créé par le salarié (voir entretiens_insert, 0020_entretiens.sql) —
 * pushEntretiens ne sert qu'à RH/Directeur planifiant une convocation. updateEntretien couvre les 3
 * écritures suivantes (auto-évaluation salarié, retour manager, clôture RH) : une simple mise à jour
 * complète de ligne suffit ici (pas de fonction SQL atomique comme append_ticket_comment) — chaque
 * étape est écrite par un seul acteur à la fois, jamais en concurrence comme un fil de commentaires. */
const pushEntretiens = (rows, companyId) => insertRows('entretiens', rows, entretienToRow, companyId);
async function updateEntretien(entretien, companyId) {
  await updateRows('entretiens', [entretien], entretienToRow, companyId);
}

const pushIdees = (rows, companyId) => insertRows('idees', rows, ideeToRow, companyId);
async function toggleIdeeVote(ideeId) {
  const { data, error } = await supabase.rpc('toggle_idee_vote', { p_idee_id: ideeId });
  if (error) return { success: false, error: error.message };
  return { success: true, votes: data };
}
async function setIdeeStatut(ideeId, statut, auteur) {
  const { error } = await supabase.rpc('set_idee_statut', { p_idee_id: ideeId, p_statut: statut, p_auteur: auteur });
  if (error) return { success: false, error: error.message };
  return { success: true };
}

/** Append atomique via la fonction SQL update_ticket_statut (0018_ticket_suivi_livraison.sql) —
 * jamais un simple `.update({statut})` : la fonction alimente aussi l'historique horodaté et la
 * date de livraison automatique, en un seul aller-retour (voir DB.updateSupportTicketStatus). */
async function updateTicketStatus(ticketId, statut, auteur) {
  const { error } = await supabase.rpc('update_ticket_statut', { p_ticket_id: ticketId, p_statut: statut, p_auteur: auteur });
  if (error) return { success: false, error: error.message };
  return { success: true };
}

/** Append atomique via la fonction SQL append_ticket_comment (0017_support_tickets.sql) — jamais
 * un lire-modifier-réécrire de la ligne complète côté client, voir DB.addTicketComment (data.js). */
async function appendTicketComment(ticketId, auteur, texte) {
  const { error } = await supabase.rpc('append_ticket_comment', { p_ticket_id: ticketId, p_auteur: auteur, p_texte: texte });
  if (error) return { success: false, error: error.message };
  return { success: true };
}

/** Intégrations (0022_integrations.sql) : lecture/écriture directes via le client authentifié — RLS
 * (gererParametres) suffit à protéger ces deux appels, pas besoin d'Edge Function (contrairement à
 * notifySlack ci-dessous, appelée par N'IMPORTE QUEL salarié qui n'a pas le droit de lire le webhook
 * lui-même). */
async function getCompanyIntegrations(companyId) {
  const { data, error } = await supabase.from('company_integrations').select('*').eq('company_id', companyId).maybeSingle();
  if (error) throw error;
  return data ? { slackWebhookUrl: data.slack_webhook_url || '' } : { slackWebhookUrl: '' };
}
async function saveCompanyIntegrations(companyId, { slackWebhookUrl }) {
  const { error } = await supabase.from('company_integrations').upsert({ company_id: companyId, slack_webhook_url: slackWebhookUrl || null });
  if (error) throw error;
}

/** Relaie une notification vers le webhook Slack de l'entreprise si configuré (voir supabase/
 * functions/notify-slack) — passe TOUJOURS par l'Edge Function (jamais un accès direct à
 * company_integrations), puisque l'appelant est souvent un salarié ordinaire qui n'a pas gererParametres
 * et ne pourrait donc pas lire le webhook lui-même. Un échec ici ne doit jamais remonter comme une
 * erreur de création de demande — voir DB.addLeaveRequest/addTeleworkRequest/addExpense (data.js). */
async function notifySlack(icon, title, message) {
  const { error } = await supabase.functions.invoke('notify-slack', { body: { icon, title, message } });
  if (error) throw error;
}

/** Notifie BERTOLIS par email (Edge Function notify-bertolis-ticket) juste après la création d'un
 * ticket — voir DB.addSupportTicket (data.js). Un échec ici ne doit jamais remonter comme une
 * erreur de "synchronisation" au salarié (son ticket est bien créé) : l'appelant se contente de
 * logguer, jamais de bloquer/avertir l'utilisateur. */
async function notifyNewTicket(ticketId) {
  const { error } = await supabase.functions.invoke('notify-bertolis-ticket', { body: { ticketId } });
  if (error) throw error;
}

/** Déclenche l'analyse IA d'un ticket (Edge Function analyze-ticket, Claude) juste après sa
 * création — en PARALLÈLE de notifyNewTicket (voir DB.addSupportTicket, data.js), jamais en série :
 * aucune des deux ne dépend de l'autre, seulement de l'insertion déjà faite. Un échec ici (API
 * indisponible, clé absente, quota dépassé...) ne doit jamais empêcher la création du ticket ni
 * l'email de notification — jamais de throw, toujours un résultat {success, error} inspectable. */
async function analyzeTicket(ticketId) {
  const { data, error } = await supabase.functions.invoke('analyze-ticket', { body: { ticketId } });
  if (error) {
    let message = error.message;
    try {
      const ctx = await error.context.json();
      if (ctx && ctx.error) message = ctx.error;
    } catch { /* réponse non-JSON, on garde le message par défaut */ }
    return { success: false, error: message };
  }
  return { success: true, analysis: data.analysis };
}

/** Seul point d'accès de la console BERTOLIS aux tickets — CROSS-ENTREPRISES, donc jamais via RLS
 * (la console BERTOLIS n'a pas de compte Supabase Auth, voir data.js:BERTOLIS_TICKETS_SECRET). Le
 * secret est fourni par l'appelant (data.js/app.js, chargés APRÈS ce module — pas visible ici tant
 * qu'il n'est pas passé en paramètre). action : "list" | "updateStatus" | "addComment". */
async function invokeBertolisTickets(secret, action, payload) {
  const { data, error } = await supabase.functions.invoke('bertolis-tickets', {
    body: { action, ...payload },
    headers: { 'x-bertolis-secret': secret }
  });
  if (error) {
    let message = error.message;
    try {
      const ctx = await error.context.json();
      if (ctx && ctx.error) message = ctx.error;
    } catch { /* réponse non-JSON, on garde le message par défaut */ }
    return { success: false, error: message };
  }
  return { success: true, ...data };
}
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
  signIn, signInWithOAuth, signUpNewCompany, createCompanySelfService, resendSignupConfirmation, manageEmployeeAccount, signOut, getSession, fetchCurrentEmployeeRow, hydrateCurrentCompany,
  updatePassword, sendPasswordResetEmail, onPasswordRecovery, wasPasswordRecoveryDetected, invokeBilling,
  switchToSession, onSessionRefreshed,
  pushEmployees, pushEtablissements, pushServices, pushLeaveTypes, pushLeaveRequests,
  pushTeleworkRequests, pushExpenses, pushDocuments, pushDrafts, pushNotifications,
  pushFavorites, pushSchoolHolidays, pushSettings, pushCompanyProfile, pushAuditLogEntry, pushClearAuditLog,
  pushSupportTickets, updateTicketStatus, appendTicketComment, invokeBertolisTickets, notifyNewTicket, analyzeTicket,
  pushEntretiens, updateEntretien,
  pushIdees, toggleIdeeVote, setIdeeStatut,
  getCompanyIntegrations, saveCompanyIntegrations, notifySlack,
  submitCandidature, getCandidatures, setCandidatureStatut, getCandidatureFileUrl, rejectCandidature,
  getCompanyPublicInfo, uploadCompanyLogo,
  uploadEmployeeDocumentFile, getEmployeeDocumentFileUrl, uploadJustificatifFile, getJustificatifFileUrl,
  deleteRow
};
