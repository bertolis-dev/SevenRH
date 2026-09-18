/**
 * Seven RH — retour Betty du 18/09/2026, "ajouter une valeur sur place" dans les listes de
 * référence, famille 1 seulement (comme demandé : "commence par la première famille, c'est elle
 * qui me gêne au quotidien") — postes, types de contrat, forfaits, catégories de documents,
 * catégories de notes de frais. Garde-fous vérifiés : permission (gererParametres, jamais un
 * bouton visible qui échoue en silence), doublons (accents/casse/ponctuation ignorés, mais pas les
 * variantes sémantiques comme "Commercial"/"Commercial·e" — un problème linguistique, pas de
 * normalisation), sélection immédiate sans perte de saisie en cours (vérifié en direct dans le
 * navigateur, voir aussi postes-genres-18-09.test.js pour le mécanisme parsePosteGenre réutilisé),
 * traçabilité (réutilise l'audit automatique existant de settingsRepository.saveSettings, jamais
 * une entrée dédiée en plus). Catégories de notes de frais : ajout SANS réglages (justificatif
 * obligatoire/plafond), renvoi vers Paramètres pour les configurer — jamais une fausse catégorie
 * pré-réglée à sa place.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function runNormalisationIgnoreAccentsCasseEtPonctuation() {
  const { normalizeForDuplicateCheck } = loadAppJs();
  assert.strictEqual(normalizeForDuplicateCheck('CDD'), normalizeForDuplicateCheck('C.D.D.'), '"CDD" et "C.D.D." doivent être vus comme la même valeur');
  assert.strictEqual(normalizeForDuplicateCheck('Développeur'), normalizeForDuplicateCheck('développeur'), 'la casse ne doit jamais créer un doublon');
  assert.strictEqual(normalizeForDuplicateCheck('Forfait Jours'), normalizeForDuplicateCheck('forfait-jours'), 'espace/tiret ne doivent pas distinguer deux variantes');

  console.log('OK — ajout-rapide-referentiels-18-09.test.js (normalizeForDuplicateCheck : accents/casse/ponctuation ignorés)');
}

async function runNormalisationNeResoutPasLesVariantesSemantiques() {
  // Décision de périmètre explicite : "Commercial" vs "Commercial·e" est un problème linguistique
  // (accord de genre), pas une variante de ponctuation — jamais rapproché automatiquement.
  const { normalizeForDuplicateCheck } = loadAppJs();
  assert.notStrictEqual(normalizeForDuplicateCheck('Commercial'), normalizeForDuplicateCheck('Commercial·e'),
    '"Commercial" et "Commercial·e" restent deux valeurs distinctes pour la détection de doublon (accord de genre, pas de la ponctuation)');

  console.log('OK — ajout-rapide-referentiels-18-09.test.js (normalizeForDuplicateCheck : les variantes de genre ne sont pas confondues, décision de périmètre)');
}

async function runFindDuplicateInListSurListeDeChaines() {
  const { findDuplicateInList } = loadAppJs();
  const liste = ['CDI', 'CDD', 'Stage'];
  assert.strictEqual(findDuplicateInList(liste, 'c.d.d'), 'CDD');
  assert.strictEqual(findDuplicateInList(liste, 'Alternance'), null);
  assert.strictEqual(findDuplicateInList(liste, ''), null, 'une valeur vide ne doit jamais être signalée comme doublon de tout');

  console.log('OK — ajout-rapide-referentiels-18-09.test.js (findDuplicateInList : détecte sur liste de chaînes, ignore la valeur vide)');
}

async function runFindDuplicateInListSurListeDobjets() {
  const { findDuplicateInList } = loadAppJs();
  const postes = [{ neutre: 'Commercial·e', masculin: 'Commercial', feminin: 'Commerciale' }];
  const doublon = findDuplicateInList(postes, 'commercial e', 'neutre');
  assert.ok(doublon && doublon.neutre === 'Commercial·e', 'doit retrouver l\'objet entier, pas juste un booléen, pour proposer "utiliser cette valeur"');

  console.log('OK — ajout-rapide-referentiels-18-09.test.js (findDuplicateInList : fonctionne aussi sur une liste d\'objets avec le champ à comparer)');
}

async function runOptionAjouterVisibleSeulementAvecLaPermission() {
  const { DB, sandbox, openEmployeeModal, employeeRepository } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  const manager = employeeRepository.getAll().find(e => e.role === 'manager');
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');

  DB._currentEmployeeId = rh.id;
  openEmployeeModal(salarie.id);
  const htmlAvecPermission = sandbox.document.getElementById('modal-root').innerHTML;
  assert.ok(htmlAvecPermission.includes('data-quick-add-list="postes"'), 'un RH (gererParametres) doit voir l\'option "+ Ajouter un poste..."');
  assert.ok(htmlAvecPermission.includes('+ Ajouter un poste...'));

  DB._currentEmployeeId = manager.id;
  openEmployeeModal(salarie.id);
  const htmlSansPermission = sandbox.document.getElementById('modal-root').innerHTML;
  assert.ok(!htmlSansPermission.includes('data-quick-add-list='), 'un manager sans gererParametres ne doit voir AUCUNE option d\'ajout rapide, jamais un bouton visible qui échouerait en silence');
  assert.ok(!htmlSansPermission.includes('+ Ajouter'));

  console.log('OK — ajout-rapide-referentiels-18-09.test.js (option "+ Ajouter..." réservée à gererParametres, totalement absente du HTML sinon)');
}

async function runAjoutDunTypeDeContratPersisteEtTraceLaudit() {
  const { DB, sandbox, employeeRepository, settingsRepository } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;

  const avant = settingsRepository.getSettings().typesContrat.length;
  const auditAvant = DB.getAuditLog().length;
  const nouveauxTypes = settingsRepository.getSettings().typesContrat.concat('Portage salarial');
  settingsRepository.saveSettings(Object.assign({}, settingsRepository.getSettings(), { typesContrat: nouveauxTypes }));

  assert.strictEqual(settingsRepository.getSettings().typesContrat.length, avant + 1);
  assert.ok(settingsRepository.getSettings().typesContrat.includes('Portage salarial'));
  const audit = DB.getAuditLog();
  assert.ok(audit.length > auditAvant, 'l\'ajout doit être tracé, comme tout changement de Paramètres (qui, quand)');
  const derniereEntree = audit[audit.length - 1];
  assert.strictEqual(derniereEntree.action, 'Modification');
  assert.ok(derniereEntree.auteur.includes(rh.prenom), 'l\'entrée doit porter le nom de qui a fait l\'ajout');
  assert.ok(derniereEntree.date, 'l\'entrée doit porter une date (quand)');

  console.log('OK — ajout-rapide-referentiels-18-09.test.js (ajout persisté dans settings + tracé par l\'audit existant de saveSettings, sans mécanisme dédié)');
}

async function runQuickAddListsCategoriesFraisSansReglages() {
  const { QUICK_ADD_LISTS } = loadAppJs();
  assert.ok(QUICK_ADD_LISTS.categoriesFrais.sansReglage, 'une catégorie de notes de frais ajoutée rapidement ne doit jamais recevoir de réglages par défaut (justificatif/plafond) à sa place');
  assert.ok(!QUICK_ADD_LISTS.postes.sansReglage);

  console.log('OK — ajout-rapide-referentiels-18-09.test.js (catégorie de notes de frais : ajout marqué sansReglage, jamais de faux réglages par défaut)');
}

async function runQuickAddListsPostesPorteLesFormesDeGenre() {
  const { QUICK_ADD_LISTS } = loadAppJs();
  assert.strictEqual(QUICK_ADD_LISTS.postes.formesGenre, true, 'l\'ajout rapide d\'un poste doit redemander masculin/féminin, sinon on rouvre le problème réglé par le point 5 du 18/09');
  assert.ok(!QUICK_ADD_LISTS.typesContrat.formesGenre);
  assert.ok(!QUICK_ADD_LISTS.forfaits.formesGenre);

  console.log('OK — ajout-rapide-referentiels-18-09.test.js (postes : seule liste avec formesGenre, cohérent avec le travail sur les postes accordés)');
}

async function runStatutsProNePlusAfficheDansLesReferentielsMaisDonneesConservees() {
  const { SETTINGS_LISTS_RH, SETTINGS_LIST_USAGE_CHECK, DEFAULT_SETTINGS } = loadAppJs();
  assert.ok(!SETTINGS_LISTS_RH.some(l => l.key === 'statutsPro'),
    '"Statuts professionnels" ne doit plus apparaître comme carte dans Paramètres > Référentiels : aucun menu ne s\'appuie plus dessus (remplacé par catégorie de salarié)');
  assert.ok(!('statutsPro' in SETTINGS_LIST_USAGE_CHECK), 'plus de vérification d\'usage nécessaire pour une liste qui n\'est plus une carte');
  assert.ok(Array.isArray(DEFAULT_SETTINGS.statutsPro) && DEFAULT_SETTINGS.statutsPro.length > 0,
    'les données statutsPro elles-mêmes restent en place : deriveCategoriesSalarieFromStatutPro en dépend encore comme socle de migration');

  console.log('OK — ajout-rapide-referentiels-18-09.test.js (Statuts professionnels : carte retirée des référentiels, données internes conservées pour la migration)');
}

runNormalisationIgnoreAccentsCasseEtPonctuation()
  .then(runNormalisationNeResoutPasLesVariantesSemantiques)
  .then(runFindDuplicateInListSurListeDeChaines)
  .then(runFindDuplicateInListSurListeDobjets)
  .then(runOptionAjouterVisibleSeulementAvecLaPermission)
  .then(runAjoutDunTypeDeContratPersisteEtTraceLaudit)
  .then(runQuickAddListsCategoriesFraisSansReglages)
  .then(runQuickAddListsPostesPorteLesFormesDeGenre)
  .then(runStatutsProNePlusAfficheDansLesReferentielsMaisDonneesConservees)
  .catch((err) => {
    console.error('ÉCHEC — ajout-rapide-referentiels-18-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
