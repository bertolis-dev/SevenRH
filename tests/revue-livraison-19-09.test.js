/**
 * Seven RH — retour Betty du 19/09/2026 ("j'ai repassé toute la livraison"), 4 points, 3 remontés
 * lors d'une relecture précédente jamais transmise, le 4e nouveau :
 *
 * 1. Le plafond de licences (module_licenses, 0059) n'était vérifié qu'à l'écran (case décochée une
 *    fois "capacité atteinte") — rien en base n'empêchait un appel direct à
 *    supabase.from('module_licenses').insert(...) de dépasser subscription_modules.quantite.
 *    "C'est précisément le titulaire du compte qui a intérêt à contourner cette limite, et c'est lui
 *    qui a la permission." Corrigé par 0061_module_licenses_cap.sql (nouvelle policy INSERT).
 *
 * 2. getPosteAccorde accordait directement sur getSexe (état civil), sans jamais consulter la
 *    civilité D'USAGE (getCiviliteAffichee) : un salarié ayant choisi "ne pas accorder" voyait quand
 *    même son poste accordé au masculin/féminin sur ses documents. Corrigé en donnant la même
 *    priorité que getCiviliteAffichee : civilite explicite d'abord, neutre si "ne_pas_accorder",
 *    repli sur le sexe UNIQUEMENT si la civilité n'a jamais été renseignée.
 *
 * 3. Le socle commun (recherche/tri, point 6 du 19/09) n'était déployé que sur Entretiens/Tableau des
 *    compteurs — "restent sans recherche, dans l'ordre où ça me gêne : Congés et absences, Notes de
 *    frais [...] Les deux premiers sont ceux qu'on ouvre tous les jours." Étendu à ces deux écrans :
 *    recherche par nom (en complément du filtre déroulant existant) + tri par colonne, même moteur
 *    (matchesPeriodeFilter/sortListBy/renderSortableHeader) que Entretiens/Tableau des compteurs.
 *
 * 4. Les modèles système ("Attestation employeur"/"Certificat de travail", cle non nul) s'affichaient
 *    et se supprimaient exactement comme un modèle client, sans le moindre repère — "on perd sa
 *    personnalisation sans le moindre avertissement". Identifiés par un badge "Fourni" et le bouton
 *    Supprimer retiré ; DB.deleteDocumentTemplate refuse aussi la suppression d'un modèle à cle (2e
 *    ligne de défense, jamais uniquement le bouton masqué à l'écran).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAppJs } = require('./load-app-js');

function setup() {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  const rh = api.DB.getEmployees().find(e => e.role === 'rh');
  api.DB._currentEmployeeId = rh.id;
  return { ...api, rh };
}

// ---- Point 1 : plafond de licences vérifié en base ----

async function runPlafondLicencesVerifieEnBase() {
  const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
  const capMigrationPath = path.join(migrationsDir, '0061_module_licenses_cap.sql');
  assert.ok(fs.existsSync(capMigrationPath), 'la migration 0061_module_licenses_cap.sql doit exister');
  const capSql = fs.readFileSync(capMigrationPath, 'utf8');

  assert.ok(/insert into schema_migrations \(version\) values \('0061_module_licenses_cap'\)/.test(capSql), 'la migration doit s\'enregistrer dans schema_migrations, comme toutes les autres');
  // §retour Betty du 19/09/2026 : cette migration REMPLACE la policy INSERT posée par 0059 (même
  // nom, "drop policy if exists" puis "create policy") — lire ce seul fichier, jamais la concaténation
  // de toutes les migrations, sinon un match non ancré retrouverait l'ANCIENNE policy de 0059 (sans
  // le plafond) plutôt que celle-ci.
  const policyMatch = capSql.match(/create policy module_licenses_insert on module_licenses for insert\s+with check \(([\s\S]*?)\);/);
  assert.ok(policyMatch, 'la policy module_licenses_insert doit être redéfinie dans cette migration');
  const body = policyMatch[1];
  assert.ok(body.includes("has_permission('gererAbonnements')"), 'la permission existante ne doit jamais être retirée, seulement complétée');
  assert.ok(/select count\(\*\) from module_licenses/.test(body), 'doit compter les attributions déjà enregistrées pour ce module');
  assert.ok(/select sm\.quantite from subscription_modules/.test(body), 'doit comparer au nombre de licences réellement achetées (subscription_modules.quantite, écrit uniquement par Stripe/le service-role)');
  assert.ok(/\)\s*<\s*coalesce\(/.test(body), 'la comparaison doit être stricte (< jamais <=, sinon la Nième attribution en trop passerait encore) avec un repli à 0 si aucune quantité souscrite');

  console.log('OK — revue-livraison-19-09.test.js (point 1 : la policy INSERT de module_licenses vérifie désormais le plafond réellement acheté)');
}

// ---- Point 2 : accord du poste suit la civilité d'usage ----

async function runAccordPosteSuitLaCiviliteDusagePasSeulementLeSexe() {
  const { getPosteAccorde } = setup();
  const settings = { postes: [{ neutre: 'Commercial·e', masculin: 'Commercial', feminin: 'Commerciale' }] };

  assert.strictEqual(getPosteAccorde({ poste: 'Commercial·e', sexe: 'Femme', civilite: 'ne_pas_accorder' }, settings), 'Commercial·e',
    '"ne pas accorder" doit donner la forme neutre partout, jamais le sexe à l\'état civil (c\'est exactement le cas pour lequel ce champ existe)');
  assert.strictEqual(getPosteAccorde({ poste: 'Commercial·e', sexe: 'Homme', civilite: 'Madame' }, settings), 'Commerciale',
    'une civilité d\'usage explicite doit primer sur le sexe à l\'état civil (ex. personne trans dont l\'état civil n\'est pas encore mis à jour)');
  assert.strictEqual(getPosteAccorde({ poste: 'Commercial·e', sexe: 'Homme', civilite: 'Monsieur' }, settings), 'Commercial');
  assert.strictEqual(getPosteAccorde({ poste: 'Commercial·e', sexe: 'Femme', civilite: '' }, settings), 'Commerciale',
    'civilité jamais renseignée (chaîne vide) : repli sur le sexe à l\'état civil, comme avant');
  assert.strictEqual(getPosteAccorde({ poste: 'Commercial·e', sexe: 'Femme' }, settings), 'Commerciale',
    'civilité totalement absente du champ (fiche ancienne) : même repli sur le sexe');

  console.log('OK — revue-livraison-19-09.test.js (point 2 : accord du poste suit la civilité d\'usage, forme neutre pour "ne pas accorder")');
}

// ---- Point 3 : socle commun étendu à Congés et Notes de frais ----

async function runCongesRechercheParNomEtTriParColonne() {
  const { employeeRepository, leaveRepository, leaveTypeRepository, getFilteredLeaveRequests, state } = setup();
  // Deux salariés du jeu de démo (seedEmployees, data.js), jamais créés à la volée : addLeaveRequest
  // est asynchrone (résolution du workflow), et employeeRepository.create l'est tout autant — inutile
  // d'en recréer un quand la démo en fournit déjà deux directement exploitables.
  // §mise en forme des noms du 17/09/2026 : nom stocké en MAJUSCULES (BENALI/DUBOIS) — comparaison
  // sur le prénom seul, qui reste dans sa casse d'origine.
  const sarah = employeeRepository.getAll().find(e => e.prenom === 'Sarah');
  const lea = employeeRepository.getAll().find(e => e.prenom === 'Léa');
  const type = leaveTypeRepository.getLeaveTypes().find(t => t.categorie === 'conge');

  await leaveRepository.create({ employeeId: sarah.id, typeId: type.id, dateDebut: '2026-09-01', dateFin: '2026-09-02', nbJours: 2 });
  await leaveRepository.create({ employeeId: lea.id, typeId: type.id, dateDebut: '2026-09-10', dateFin: '2026-09-11', nbJours: 2 });

  state.congesSearch = 'dubois';
  const parRecherche = getFilteredLeaveRequests('conge');
  assert.ok(parRecherche.length >= 1 && parRecherche.every(r => r.employeeId === lea.id), 'la recherche par nom doit ne garder que les demandes du salarié trouvé, insensible à la casse');
  state.congesSearch = '';

  state.congesSortBy = 'employee';
  state.congesSortDir = 'asc';
  const parNom = getFilteredLeaveRequests('conge').filter(r => [sarah.id, lea.id].includes(r.employeeId));
  assert.strictEqual(parNom[0].employeeId, sarah.id, 'tri croissant par salarié (nom, prénom) : Benali doit passer avant Dubois');

  console.log('OK — revue-livraison-19-09.test.js (point 3, Congés : recherche par nom + tri par colonne fonctionnent)');
}

async function runCongesToolbarExposeLaRechercheEtLesEnTetesTriables() {
  const { employeeRepository, leaveRepository, leaveTypeRepository, renderCongesDemandes } = setup();
  const sarah = employeeRepository.getAll().find(e => e.prenom === 'Sarah');
  const type = leaveTypeRepository.getLeaveTypes().find(t => t.categorie === 'conge');
  await leaveRepository.create({ employeeId: sarah.id, typeId: type.id, dateDebut: '2026-09-01', dateFin: '2026-09-02', nbJours: 2 });

  const html = renderCongesDemandes('conge');
  assert.ok(html.includes('id="conges-search"'), 'le champ de recherche doit être rendu dans le toolbar Congés');
  assert.ok(html.includes('data-sort-by-key="congesSortBy"') && html.includes('data-sort-dir-key="congesSortDir"'),
    'les en-têtes de colonne doivent utiliser le même mécanisme de délégation globale que Entretiens/Tableau des compteurs');

  console.log('OK — revue-livraison-19-09.test.js (point 3, Congés : toolbar rendu avec recherche + en-têtes triables)');
}

async function runFraisRechercheParNomEtTriParColonne() {
  const { employeeRepository, expenseRepository, getFilteredExpenses, state } = setup();
  const sarah = employeeRepository.getAll().find(e => e.prenom === 'Sarah');
  const lea = employeeRepository.getAll().find(e => e.prenom === 'Léa');

  await expenseRepository.create({ employeeId: sarah.id, categorie: 'Repas', libelle: 'Déjeuner client', montantTTC: 20, date: '2026-09-01' });
  await expenseRepository.create({ employeeId: lea.id, categorie: 'Repas', libelle: 'Déjeuner équipe', montantTTC: 45, date: '2026-09-10' });

  state.fraisSearch = 'dubois';
  const parRecherche = getFilteredExpenses();
  assert.ok(parRecherche.length >= 1 && parRecherche.every(n => n.employeeId === lea.id), 'la recherche par nom doit ne garder que les notes du salarié trouvé');
  state.fraisSearch = '';

  state.fraisSortBy = 'montant';
  state.fraisSortDir = 'desc';
  const parMontant = getFilteredExpenses().filter(n => [sarah.id, lea.id].includes(n.employeeId));
  assert.strictEqual(parMontant[0].montantTTC, 45, 'tri décroissant par montant : la note la plus élevée doit apparaître en premier');

  console.log('OK — revue-livraison-19-09.test.js (point 3, Notes de frais : recherche par nom + tri par colonne fonctionnent)');
}

async function runFraisToolbarExposeLaRechercheEtLesEnTetesTriables() {
  const { employeeRepository, expenseRepository, renderFrais } = setup();
  const sarah = employeeRepository.getAll().find(e => e.prenom === 'Sarah');
  await expenseRepository.create({ employeeId: sarah.id, categorie: 'Repas', libelle: 'Déjeuner', montantTTC: 20, date: '2026-09-01' });

  const html = renderFrais();
  assert.ok(html.includes('id="frais-search"'), 'le champ de recherche doit être rendu dans le toolbar Notes de frais');
  assert.ok(html.includes('data-sort-by-key="fraisSortBy"') && html.includes('data-sort-dir-key="fraisSortDir"'),
    'les en-têtes de colonne doivent être triables, comme sur Entretiens/Tableau des compteurs');

  console.log('OK — revue-livraison-19-09.test.js (point 3, Notes de frais : toolbar rendu avec recherche + en-têtes triables)');
}

// ---- Point 4 : modèles système non supprimables ----

async function runModelesSystemeIdentifiesEtBoutonSupprimerRetire() {
  const { renderParametresModelesDocuments, documentTemplateRepository } = setup();
  const html = renderParametresModelesDocuments();
  const attestation = documentTemplateRepository.getAll().find(t => t.cle === 'attestation_employeur');
  const certificat = documentTemplateRepository.getAll().find(t => t.cle === 'certificat_travail');

  assert.ok(html.includes('Fourni'), 'les modèles système doivent porter un repère visuel ("Fourni")');
  assert.ok(!html.includes(`data-delete-modele-document="${attestation.id}"`), 'le bouton Supprimer ne doit jamais être proposé pour l\'attestation employeur');
  assert.ok(!html.includes(`data-delete-modele-document="${certificat.id}"`), 'le bouton Supprimer ne doit jamais être proposé pour le certificat de travail');
  assert.ok(html.includes('data-edit-modele-document'), 'Modifier doit rester possible : seule la suppression est bloquée, jamais la personnalisation');

  const modeleClient = documentTemplateRepository.create({ nom: 'Mon modèle perso', corps: 'Bonjour {{prenom}}.' });
  const htmlAvecClient = renderParametresModelesDocuments();
  assert.ok(htmlAvecClient.includes(`data-delete-modele-document="${modeleClient.id}"`), 'un modèle créé normalement par le client doit garder son bouton Supprimer');

  console.log('OK — revue-livraison-19-09.test.js (point 4 : modèles système repérés "Fourni", bouton Supprimer retiré, modèle client non affecté)');
}

async function runSuppressionDunModeleSystemeRefuseeCotéDonnees() {
  const { documentTemplateRepository } = setup();
  const attestation = documentTemplateRepository.getAll().find(t => t.cle === 'attestation_employeur');
  const avant = documentTemplateRepository.getAll().length;

  documentTemplateRepository.delete(attestation.id);

  const apres = documentTemplateRepository.getAll();
  assert.strictEqual(apres.length, avant, 'un appel direct à delete() sur un modèle système ne doit rien supprimer, même en contournant l\'écran (seconde ligne de défense)');
  assert.ok(apres.some(t => t.id === attestation.id), 'le modèle système doit toujours être présent après la tentative');

  const modeleClient = documentTemplateRepository.create({ nom: 'Modèle à supprimer', corps: 'Test' });
  documentTemplateRepository.delete(modeleClient.id);
  assert.ok(!documentTemplateRepository.getAll().some(t => t.id === modeleClient.id), 'un modèle client normal doit, lui, rester réellement supprimable');

  console.log('OK — revue-livraison-19-09.test.js (point 4 : DB.deleteDocumentTemplate refuse un modèle système, laisse un modèle client se supprimer normalement)');
}

runPlafondLicencesVerifieEnBase()
  .then(runAccordPosteSuitLaCiviliteDusagePasSeulementLeSexe)
  .then(runCongesRechercheParNomEtTriParColonne)
  .then(runCongesToolbarExposeLaRechercheEtLesEnTetesTriables)
  .then(runFraisRechercheParNomEtTriParColonne)
  .then(runFraisToolbarExposeLaRechercheEtLesEnTetesTriables)
  .then(runModelesSystemeIdentifiesEtBoutonSupprimerRetire)
  .then(runSuppressionDunModeleSystemeRefuseeCotéDonnees)
  .catch((err) => {
    console.error('ÉCHEC — revue-livraison-19-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
