/**
 * Seven RH — retour Betty du 22/09/2026 (Partie 2, point 9, "le sujet le plus structurant") :
 * l'onglet "Paramètres" mélangeait les réglages d'au moins cinq modules dans un seul écran
 * ("Référentiels") et rangeait "Fermetures" sous le module congés alors que le calcul des tickets
 * restaurant en dépend tout autant (isJourTravaillePourSalarie lit settings.fermetures sans
 * condition de module). Ce fichier vérifie : (1) le défaut précis signalé — Fermetures reste
 * accessible même sans le module congés, désormais via l'onglet fusionné "Calendrier" ; (2) chaque
 * module a bien son propre onglet, avec le bon contenu et le bon isVisible ; (3) "Référentiels"
 * reste visible sans le module RH (socle commun) ; (4) la chaîne de validation des congés a
 * rejoint "Congés et absences" (sans y être dupliquée) et "Vacances scolaires" y est devenue un
 * sous-onglet ; (5) l'indicateur de complétion par onglet (PARAMETRES_TABS_COMPLETION) réagit à un
 * vrai changement de réglage.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function setModules(DB, keys) {
  const c = DB.getCurrentCompany();
  c.abonnement.offre = 'a_la_carte';
  c.abonnement.modules = keys.map(key => ({ key }));
  DB.saveCurrentCompany(c);
}

function setup(modules) {
  const api = loadAppJs();
  const { DB, sandbox } = api;
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;
  if (modules) setModules(DB, modules);
  return api;
}

function runDefautFermeturesAccessibleSansModuleConges() {
  const { PARAMETRES_TABS } = setup(['tickets']); // ticket restaurant SANS congés
  const calendrier = PARAMETRES_TABS.find(t => t.key === 'calendrier');
  assert.ok(calendrier, 'un onglet "calendrier" doit exister (fusion Jours fériés + Fermetures)');
  assert.ok(calendrier.isVisible(), 'le défaut signalé : Fermetures ne doit plus dépendre du module congés, alors que le calcul des tickets restaurant en dépend');
  assert.ok(!PARAMETRES_TABS.some(t => t.key === 'feries' || t.key === 'fermetures'), 'les anciens onglets séparés "feries"/"fermetures" ne doivent plus exister, fusionnés dans "calendrier"');

  const html = calendrier.render();
  assert.ok(html.includes('Jours fériés'), 'le contenu fusionné doit inclure la section jours fériés');
  assert.ok(html.includes('Fermetures d\'entreprise'), 'le contenu fusionné doit inclure la section fermetures');

  console.log('OK — parametres-par-module-22-09.test.js (défaut corrigé : Calendrier, dont Fermetures, visible sans le module congés)');
}

function runReferentielsResteVisibleSansModuleRH() {
  const { PARAMETRES_TABS } = setup(['conges']); // pas de module RH souscrit
  const listes = PARAMETRES_TABS.find(t => t.key === 'listes');
  assert.ok(listes.isVisible(), '"Référentiels" (socle commun de la fiche salarié) doit rester visible même sans le module RH');
  const html = listes.render();
  assert.ok(html.includes('Catégories de salariés'), 'les référentiels transverses restent dans ce socle');
  assert.ok(!html.includes('Périodicité du suivi médical'), 'les réglages propres au module RH ont quitté "Référentiels" pour leur propre onglet');
  assert.ok(!html.includes('Indicateurs Direction'), 'les indicateurs (masse salariale, suivi genre/âge) ont quitté "Référentiels" pour RH/Rémunération');

  console.log('OK — parametres-par-module-22-09.test.js (Référentiels reste dans le socle commun, sans le contenu propre au module RH)');
}

function runOngletRHContientLesReglagesDeplaces() {
  const { PARAMETRES_TABS } = setup(['rh']);
  const rh = PARAMETRES_TABS.find(t => t.key === 'rh');
  assert.ok(rh.isVisible(), 'l\'onglet RH doit être visible avec le module rh souscrit');
  const html = rh.render();
  assert.ok(html.includes('Périodicité du suivi médical simple'), 'le suivi médical doit être rendu dans l\'onglet RH');
  assert.ok(html.includes('Renuméroter tous les matricules'), 'la renumérotation des matricules doit être rendue dans l\'onglet RH');
  assert.ok(html.includes('Afficher la répartition Hommes'), 'le suivi genre (indicateur RH) doit être rendu dans l\'onglet RH');
  assert.ok(!html.includes('Suivre la masse salariale'), 'la masse salariale (indicateur Rémunération) ne doit plus être dans l\'onglet RH');

  console.log('OK — parametres-par-module-22-09.test.js (onglet RH : suivi médical, matricules, indicateurs RH)');
}

function runOngletRemunerationEtPlanningEtNotesDeFraisEtTickets() {
  const { PARAMETRES_TABS } = setup(['remuneration', 'planning', 'frais', 'tickets']);

  const remuneration = PARAMETRES_TABS.find(t => t.key === 'remuneration');
  assert.ok(remuneration.isVisible());
  const htmlRemuneration = remuneration.render();
  assert.ok(htmlRemuneration.includes('Suivre la masse salariale'), 'la masse salariale doit être rendue dans l\'onglet Rémunération');
  assert.ok(htmlRemuneration.includes('Contingent annuel d\'heures supplémentaires'), 'les heures supplémentaires doivent être rendues dans l\'onglet Rémunération');

  const planning = PARAMETRES_TABS.find(t => t.key === 'planning-teletravail');
  assert.ok(planning.isVisible());
  const htmlPlanning = planning.render();
  assert.ok(htmlPlanning.includes('Budget hebdomadaire du planning'), 'le budget planning doit être rendu dans l\'onglet Planning et télétravail');
  assert.ok(htmlPlanning.includes('Quota de télétravail'), 'le quota télétravail doit être rendu dans l\'onglet Planning et télétravail');
  assert.ok(htmlPlanning.includes('f-workflow-teletravail'), 'la chaîne de validation télétravail doit être rendue dans l\'onglet Planning et télétravail');

  const notesFrais = PARAMETRES_TABS.find(t => t.key === 'notes-frais');
  assert.ok(notesFrais.isVisible());
  const htmlFrais = notesFrais.render();
  assert.ok(htmlFrais.includes('Catégories de notes de frais'), 'les catégories de frais doivent être rendues dans l\'onglet Notes de frais');
  assert.ok(htmlFrais.includes('f-workflow-frais'), 'la chaîne de validation des notes de frais doit être rendue dans l\'onglet Notes de frais');

  const tickets = PARAMETRES_TABS.find(t => t.key === 'tickets-restaurant');
  assert.ok(tickets.isVisible());
  const htmlTickets = tickets.render();
  assert.ok(htmlTickets.includes('Valeur faciale du ticket restaurant'), 'les réglages tickets restaurant doivent être rendus dans leur propre onglet');

  console.log('OK — parametres-par-module-22-09.test.js (onglets Rémunération, Planning et télétravail, Notes de frais, Tickets restaurant)');
}

function runChaineValidationCongesDeplaceeSansDoublon() {
  const { PARAMETRES_TABS } = setup(['conges']);
  const typesAbsences = PARAMETRES_TABS.find(t => t.key === 'types-absences');
  assert.strictEqual(typesAbsences.label, 'Congés et absences', 'l\'onglet doit être renommé "Congés et absences" (ex "Types d\'absences")');
  const html = typesAbsences.render();
  assert.ok(html.includes('f-workflow-conges-default'), 'la chaîne de validation par défaut des congés doit être rendue dans "Congés et absences"');
  assert.ok(html.includes('data-parametres-types-categorie="vacances"'), '"Vacances scolaires" doit être devenu un sous-onglet de "Congés et absences"');

  const listes = PARAMETRES_TABS.find(t => t.key === 'listes');
  assert.ok(!listes.render().includes('f-workflow-conges-default'), 'la chaîne de validation des congés ne doit plus être dupliquée dans "Référentiels"');

  console.log('OK — parametres-par-module-22-09.test.js (chaîne de validation des congés et Vacances scolaires réunies dans "Congés et absences", sans doublon)');
}

function runRedirectionsLiensProfondsVersLesOnglets() {
  const { sandbox, DB, navigateTo, state } = setup(['tickets']);

  navigateTo('parametres', { parametresTab: 'feries' });
  assert.strictEqual(state.parametresTab, 'calendrier', 'un lien profond vers l\'ancien onglet "feries" doit retomber sur "calendrier"');

  navigateTo('parametres', { parametresTab: 'fermetures' });
  assert.strictEqual(state.parametresTab, 'calendrier', 'un lien profond vers l\'ancien onglet "fermetures" doit retomber sur "calendrier"');

  setModules(DB, ['conges']);
  navigateTo('parametres', { parametresTab: 'vacances' });
  assert.strictEqual(state.parametresTab, 'types-absences', 'un lien profond vers l\'ancien onglet "vacances" doit retomber sur "types-absences"');
  assert.strictEqual(state.parametresTypesCategorie, 'vacances', 'et doit ouvrir directement le sous-onglet "Vacances scolaires"');

  console.log('OK — parametres-par-module-22-09.test.js (liens profonds vers les anciens onglets redirigés sans écran vide)');
}

function runIndicateurCompletionReagitAUnVraiChangement() {
  const { PARAMETRES_TABS_COMPLETION, DB } = setup(['rh']);

  const before = PARAMETRES_TABS_COMPLETION.rh();
  assert.strictEqual(before.done, 0, 'sur des réglages tous par défaut, aucun ne doit être compté comme "renseigné"');
  assert.ok(before.total > 0);

  const company = DB.getCurrentCompany();
  company.settings.visiteMedicaleSimpleMois = 24;
  company.settings.suiviGenreActive = true;
  DB.saveCurrentCompany(company);

  const after = PARAMETRES_TABS_COMPLETION.rh();
  assert.strictEqual(after.done, before.done + 2, 'changer réellement 2 réglages doit faire progresser le compteur de 2, ni plus ni moins');

  console.log('OK — parametres-par-module-22-09.test.js (indicateur de complétion : progresse avec de vrais changements, jamais au repos)');
}

try {
  runDefautFermeturesAccessibleSansModuleConges();
  runReferentielsResteVisibleSansModuleRH();
  runOngletRHContientLesReglagesDeplaces();
  runOngletRemunerationEtPlanningEtNotesDeFraisEtTickets();
  runChaineValidationCongesDeplaceeSansDoublon();
  runRedirectionsLiensProfondsVersLesOnglets();
  runIndicateurCompletionReagitAUnVraiChangement();
} catch (err) {
  console.error('ÉCHEC — parametres-par-module-22-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
