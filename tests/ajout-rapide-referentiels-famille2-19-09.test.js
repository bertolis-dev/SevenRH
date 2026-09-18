/**
 * Seven RH — retour Betty du 19/09/2026 ("ajouter une valeur sur place"), famille 2 :
 * établissements, services, équipes, catégories de salarié. Contrairement à la famille 1
 * (ajout-rapide-referentiels-18-09.test.js, simple champ inline), ces types portent plus qu'un nom
 * (établissement : actif/principal ; équipe : rattachée à un service) — une petite fenêtre séparée
 * (#quick-create-root, voir index.html/style.css) plutôt qu'un champ inline, pour ne jamais écraser
 * une modale déjà ouverte en réassignant l'innerHTML d'un root partagé. Le mécanisme interactif
 * (ouverture, doublon, application sans perte de saisie) a été vérifié en direct dans un vrai
 * navigateur (même limite connue du bac à sable Node que pour la famille 1 : querySelectorAll y
 * renvoie toujours [], pas de vraie arborescence DOM) — ce fichier couvre ce qui reste vérifiable
 * ici : rendu HTML (permission), catalogue, et détection de doublon scopée au bon périmètre.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function runCatalogueQuatreTypesAvecLesBonsAccordsGrammaticaux() {
  const { QUICK_CREATE_TYPES } = loadAppJs();
  assert.ok(QUICK_CREATE_TYPES.etablissements && QUICK_CREATE_TYPES.services && QUICK_CREATE_TYPES.equipes && QUICK_CREATE_TYPES.categoriesSalarie,
    'les 4 types de la famille 2 doivent être au catalogue (equipes y compris, même si sa logique de création vit à part)');
  assert.ok(!QUICK_CREATE_TYPES.etablissements.feminin, '"établissement" est masculin : jamais de "créée"');
  assert.ok(!QUICK_CREATE_TYPES.services.feminin, '"service" est masculin : jamais de "créée"');
  assert.strictEqual(QUICK_CREATE_TYPES.equipes.feminin, true, '"équipe" est féminin : "créée", jamais "créé"');
  assert.strictEqual(QUICK_CREATE_TYPES.categoriesSalarie.feminin, true, '"catégorie" est féminin : "créée", jamais "créé"');

  console.log('OK — ajout-rapide-referentiels-famille2-19-09.test.js (catalogue : 4 types, accords grammaticaux corrects)');
}

async function runOptionCreerVisibleSeulementAvecLaPermission() {
  const { DB, sandbox, openEmployeeModal, employeeRepository } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  const manager = employeeRepository.getAll().find(e => e.role === 'manager');
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');

  DB._currentEmployeeId = rh.id;
  openEmployeeModal(salarie.id);
  const htmlAvecPermission = sandbox.document.getElementById('modal-root').innerHTML;
  ['etablissements', 'services', 'equipes', 'categoriesSalarie'].forEach(type => {
    assert.ok(htmlAvecPermission.includes(`data-quick-create-type="${type}"`), `un RH (gererParametres) doit voir l'ajout rapide pour "${type}"`);
  });
  assert.ok(htmlAvecPermission.includes('+ Créer un établissement...'));
  assert.ok(htmlAvecPermission.includes('+ Créer un service...'));
  assert.ok(htmlAvecPermission.includes('+ Créer une équipe...'));
  assert.ok(htmlAvecPermission.includes('+ Créer une catégorie de salarié...'));

  DB._currentEmployeeId = manager.id;
  openEmployeeModal(salarie.id);
  const htmlSansPermission = sandbox.document.getElementById('modal-root').innerHTML;
  assert.ok(!htmlSansPermission.includes('data-quick-create-type='), 'un manager sans gererParametres ne doit voir AUCUNE option de création rapide, jamais un bouton visible qui échouerait en silence');
  assert.ok(!htmlSansPermission.includes('+ Créer'));

  console.log('OK — ajout-rapide-referentiels-famille2-19-09.test.js (option "+ Créer..." réservée à gererParametres, sur les 4 types, totalement absente du HTML sinon)');
}

async function runDoublonEquipeScopeAuServiceJamaisAuxAutresServices() {
  const { findDuplicateInList, DB, sandbox, serviceRepository } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const services = serviceRepository.getAll();
  const commercial = services.find(s => s.nom === 'Commercial'); // équipe "Commerce" (seedServices)
  const rh = services.find(s => s.nom === 'RH'); // équipe "Ressources humaines"

  assert.ok(findDuplicateInList(commercial.equipes, 'commerce', 'nom'), 'le même nom, dans LE MÊME service, doit être détecté comme doublon');
  assert.ok(!findDuplicateInList(rh.equipes, 'commerce', 'nom'), 'le même nom d\'équipe dans un AUTRE service n\'est pas un doublon : une équipe "Commerce" chez RH serait légitime, distincte de celle du service Commercial');

  console.log('OK — ajout-rapide-referentiels-famille2-19-09.test.js (doublon d\'équipe scopé au service, jamais à l\'entreprise entière)');
}

async function runDoublonEtablissementEtServiceInsensiblesALaCasse() {
  const { findDuplicateInList, DB, sandbox, etablissementRepository, serviceRepository } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();

  assert.ok(findDuplicateInList(etablissementRepository.getAll(), 'siège', 'nom'), '"siège" (sans majuscule/accent identique) doit matcher "Siège"');
  assert.ok(findDuplicateInList(serviceRepository.getAll(), 'COMMERCIAL', 'nom'), '"COMMERCIAL" doit matcher "Commercial"');
  assert.ok(!findDuplicateInList(etablissementRepository.getAll(), 'Agence totalement nouvelle', 'nom'));

  console.log('OK — ajout-rapide-referentiels-famille2-19-09.test.js (doublon établissement/service : insensible casse/accents, comme la famille 1)');
}

async function runCreationEtablissementRespecteUnSeulPrincipalEtEstTracee() {
  const { DB, sandbox, etablissementRepository } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;

  const auditAvant = DB.getAuditLog().length;
  const siege = etablissementRepository.getAll().find(e => e.principal);
  assert.ok(siege, 'un principal doit déjà exister avant le test (seedEtablissements)');

  const nouveau = etablissementRepository.create({ nom: 'Agence Lyon', actif: true, principal: true });
  const liste = etablissementRepository.getAll();
  assert.strictEqual(liste.filter(e => e.principal).length, 1, 'un seul établissement principal à la fois : en créer un second "principal" doit désactiver l\'ancien');
  assert.strictEqual(liste.find(e => e.id === siege.id).principal, false, 'l\'ancien principal doit avoir perdu ce statut');
  assert.strictEqual(liste.find(e => e.id === nouveau.id).principal, true);

  const audit = DB.getAuditLog();
  assert.ok(audit.length > auditAvant);
  assert.strictEqual(audit[audit.length - 1].entite, 'Établissement');
  assert.strictEqual(audit[audit.length - 1].action, 'Création');
  assert.ok(audit[audit.length - 1].auteur.includes(rh.prenom));

  console.log('OK — ajout-rapide-referentiels-famille2-19-09.test.js (création établissement : un seul principal à la fois, tracée par l\'audit existant)');
}

async function runCreationCategorieSalarieSansReglagesAuDelaDuNom() {
  // §guardrail 5b de la lettre du 19/09/2026 (catégories de notes de frais) ne s'applique PAS ici :
  // une catégorie de salarié n'a de toute façon pas de "réglage" bloquant équivalent (justificatif/
  // plafond) — makeEmptyCategorieSalarie() ne porte qu'un nom/description/ordre, la description
  // reste simplement vide tant qu'elle n'est pas complétée dans Paramètres.
  const { DB, sandbox, categorieSalarieRepository } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;

  const categorie = categorieSalarieRepository.create({ nom: 'Alternant' });
  assert.strictEqual(categorie.nom, 'Alternant');
  assert.strictEqual(categorie.description, '', 'aucun réglage fin ajouté d\'office : reste à faire dans Paramètres si besoin');

  console.log('OK — ajout-rapide-referentiels-famille2-19-09.test.js (catégorie de salarié : créée avec le seul nom, réglages fins laissés à Paramètres)');
}

runCatalogueQuatreTypesAvecLesBonsAccordsGrammaticaux()
  .then(runOptionCreerVisibleSeulementAvecLaPermission)
  .then(runDoublonEquipeScopeAuServiceJamaisAuxAutresServices)
  .then(runDoublonEtablissementEtServiceInsensiblesALaCasse)
  .then(runCreationEtablissementRespecteUnSeulPrincipalEtEstTracee)
  .then(runCreationCategorieSalarieSansReglagesAuDelaDuNom)
  .catch((err) => {
    console.error('ÉCHEC — ajout-rapide-referentiels-famille2-19-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
