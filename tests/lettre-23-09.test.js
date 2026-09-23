/**
 * Seven RH — lettre de Betty du 23/09/2026 (7 points, hors point 1 déjà couvert par
 * supabase-client-round-trip-23-09.test.js). Ce fichier grandit au fil des points traités.
 *
 * Point 6 : "Ma fiche affiche la navigation entre tous les salariés". Le fil d'Ariane "Salariés" et
 * les flèches "1 sur N" n'ont de sens que si on est arrivé sur la fiche DEPUIS l'écran Salariés — un
 * responsable qui ouvre SA PROPRE fiche via "Ma fiche" les voyait quand même (renderEmployeeDetail ne
 * distinguait jusqu'ici que par la PERMISSION d'accès à la liste, jamais par le CONTEXTE d'arrivée).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function setup() {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  const rh = api.DB.getEmployees().find(e => e.role === 'rh');
  api.DB._currentEmployeeId = rh.id;
  return { ...api, rh };
}

function runMaFicheJamaisDeFilDArianeNiDeFlechesMemeAvecAccesALaListe() {
  const { DB, navigateTo, render, sandbox, state, rh } = setup();
  DB._currentEmployeeId = rh.id; // RH : a bien accès à la liste "Salariés"

  navigateTo('ma-fiche');
  assert.strictEqual(state.view, 'ma-fiche');
  render();
  const html = sandbox.document.getElementById('view-root').innerHTML;

  assert.ok(!html.includes('>Salariés<'), 'un RH/manager sur SA PROPRE fiche via "Ma fiche" ne doit plus voir le fil d\'Ariane "Salariés"');
  assert.ok(html.includes('Accueil'), 'le fil d\'Ariane doit renvoyer vers Accueil sur "Ma fiche", quel que soit le rôle');
  assert.ok(!html.includes('detail-prev-next') && !/\d+ sur \d+/.test(html), 'les flèches de navigation entre salariés ne doivent plus apparaître sur "Ma fiche"');

  console.log('OK — lettre-23-09.test.js (point 6 : "Ma fiche" sans fil d\'Ariane "Salariés" ni flèches, même avec le droit d\'accès à la liste)');
}

function runFicheOuverteDepuisLaListeGardeLeFilDArianeEtLesFleches() {
  const { DB, navigateTo, render, sandbox, state, rh } = setup();
  const autre = DB.getEmployees().find(e => e.id !== rh.id);
  DB._currentEmployeeId = rh.id;

  navigateTo('employee-detail', { currentEmployeeId: autre.id });
  assert.strictEqual(state.view, 'employee-detail');
  render();
  const html = sandbox.document.getElementById('view-root').innerHTML;

  assert.ok(html.includes('Salariés'), 'une fiche ouverte depuis l\'écran Salariés doit garder son fil d\'Ariane (comportement inchangé)');

  console.log('OK — lettre-23-09.test.js (point 6 : une fiche ouverte depuis la liste Salariés garde son fil d\'Ariane, comportement non régressé)');
}

// ---- Point 4 : "les entretiens sont rangés dans Personnel" ----

function runEntretiensSepareEnDeuxEntreesPersonnelEtEquipe() {
  const { NAV_ITEMS } = setup();
  const perso = NAV_ITEMS.find(i => i.key === 'mes-entretiens');
  const equipe = NAV_ITEMS.find(i => i.key === 'entretiens');
  assert.ok(perso && perso.group === 'personnel', '"Mes entretiens" doit exister côté Personnel');
  // Array.from (jamais .slice(), qui hériterait du Array du bac à sable vm — comparaison
  // cross-realm avec un littéral de CE fichier, voir les autres tests du projet sur ce même piège).
  assert.deepStrictEqual(Array.from(perso.roles).sort(), ['comptabilite', 'manager', 'proprietaire', 'rh', 'salarie'], '"Mes entretiens" doit rester ouvert à tout rôle (chacun consulte les siens)');
  assert.ok(equipe && equipe.group === 'equipe', '"Entretiens" (gestion) doit désormais vivre côté Équipe');
  assert.deepStrictEqual(Array.from(equipe.roles).sort(), ['manager', 'proprietaire', 'rh'], '"Entretiens" (Équipe) doit être réservé aux rôles qui gèrent effectivement une équipe');

  console.log('OK — lettre-23-09.test.js (point 4 : Entretiens séparé en "Mes entretiens" (Personnel) et "Entretiens" (Équipe))');
}

function runMesEntretiensNeMontreJamaisLesBoutonsDeGestionNiLequipe() {
  const { DB, navigateTo, render, sandbox, state, rh } = setup();
  const salarie = DB.getEmployees().find(e => e.role === 'salarie');
  const autreSalarie = DB.getEmployees().find(e => e.role === 'salarie' && e.id !== salarie.id);
  DB._currentEmployeeId = rh.id; // RH : a bien GERER_ENTRETIENS
  DB.addEntretien({ employeeId: rh.id, type: 'professionnel', datePrevue: '2026-12-01' });
  DB.addEntretien({ employeeId: salarie.id, type: 'professionnel', datePrevue: '2026-12-02' });

  navigateTo('mes-entretiens');
  assert.strictEqual(state.view, 'mes-entretiens');
  render();
  const html = sandbox.document.getElementById('view-root').innerHTML;

  assert.ok(html.includes('Mes entretiens'), 'le titre doit refléter le contexte personnel');
  assert.ok(!html.includes('id="btn-planifier-entretien"') && !html.includes('id="btn-lancer-campagne-entretien"') && !html.includes('id="btn-gerer-trames-entretien"'),
    'un RH consultant SES PROPRES entretiens via "Mes entretiens" ne doit jamais voir les boutons de gestion, même s\'il a GERER_ENTRETIENS');
  assert.ok(!html.includes(autreSalarie.prenom + ' ' + autreSalarie.nom), 'ne doit contenir aucun entretien d\'un autre salarié');
  assert.ok(html.includes('1 entretien'), 'ne doit compter QUE le sien, jamais ceux de son équipe (ici : 1 sur les 2 créés)');

  console.log('OK — lettre-23-09.test.js (point 4 : "Mes entretiens" reste en lecture seule sur ses propres entretiens, même avec GERER_ENTRETIENS)');
}

function runEntretiensEquipeGardeLesBoutonsDeGestionPourRh() {
  const { DB, navigateTo, render, sandbox, state, rh } = setup();
  DB._currentEmployeeId = rh.id;

  navigateTo('entretiens');
  assert.strictEqual(state.view, 'entretiens');
  render();
  const html = sandbox.document.getElementById('view-root').innerHTML;

  assert.ok(html.includes('id="btn-planifier-entretien"'), 'un RH sur l\'entrée Équipe "Entretiens" doit garder les boutons de gestion (comportement inchangé)');

  console.log('OK — lettre-23-09.test.js (point 4 : l\'entrée Équipe "Entretiens" garde les boutons de gestion, comportement non régressé)');
}

// ---- Point 3 : "l'organigramme ne montre ni les services ni les équipes" ----

function runOrganigrammeAfficheServiceEtEquipeSurChaqueCarte() {
  const { DB, navigateTo, sandbox, employeeRepository } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  employeeRepository.update(salarie.id, { service: 'Administration des ventes', equipe: 'ADV Paris' });

  navigateTo('organigramme');
  const html = sandbox.document.getElementById('view-root').innerHTML;

  assert.ok(html.includes('Administration des ventes · ADV Paris'), 'le service et l\'équipe doivent être lisibles directement sur le schéma, pas seulement dans les filtres');

  console.log('OK — lettre-23-09.test.js (point 3 : service et équipe affichés sur chaque carte de l\'organigramme)');
}

function runOrganigrammeEncadreLesFreresDuMemeService() {
  const { DB, navigateTo, sandbox, employeeRepository } = setup();
  // Sarah et Léa (voir seedEmployees) sont déjà toutes deux managées par Nicolas — simple fratrie,
  // sans lien hiérarchique entre elles, exactement le cas signalé par Betty.
  const sarah = employeeRepository.getAll().find(e => e.prenom === 'Sarah');
  const lea = employeeRepository.getAll().find(e => e.prenom === 'Léa');
  const thomas = employeeRepository.getAll().find(e => e.prenom === 'Thomas');
  employeeRepository.update(sarah.id, { service: 'Administration des ventes' });
  employeeRepository.update(lea.id, { service: 'Administration des ventes' });

  navigateTo('organigramme');
  const html = sandbox.document.getElementById('view-root').innerHTML;

  assert.ok(html.includes('org-service-frame'), 'deux salariés du même service qui apparaissent côte à côte doivent être visuellement encadrés ensemble');
  const labelIndex = html.indexOf('org-service-frame-label');
  assert.ok(labelIndex !== -1, 'préalable : le cadre doit porter une étiquette');
  const afterLabel = html.slice(labelIndex);
  assert.ok(afterLabel.slice(0, 60).includes('Administration des ventes'), 'le cadre doit être étiqueté avec le nom du service');
  // La liste interne du cadre (les deux salariés regroupés) se termine au premier </ul> après
  // l'étiquette, Sarah/Léa n'ayant elles-mêmes aucun subordonné dans ce jeu de données.
  const framedSection = afterLabel.slice(0, afterLabel.indexOf('</ul>'));
  assert.ok(framedSection.includes(sarah.prenom) && framedSection.includes(lea.prenom), 'les deux salariés du service doivent se trouver DANS le cadre');
  assert.ok(!framedSection.includes(thomas.prenom), `${thomas.prenom} (service différent) ne doit jamais se retrouver dans ce cadre`);

  console.log('OK — lettre-23-09.test.js (point 3 : deux salariés du même service, simples pairs, sont encadrés ensemble avec le nom du service)');
}

function runOrganigrammeNEncadreJamaisUnSalarieSeulDansSonService() {
  const { DB, navigateTo, sandbox, employeeRepository } = setup();
  // Chaque salarié de ce petit jeu de données a un service différent par défaut (voir seedEmployees)
  // : aucun cadre ne doit apparaître (rien à regrouper, un cadre par personne serait du bruit).
  navigateTo('organigramme');
  const html = sandbox.document.getElementById('view-root').innerHTML;

  assert.ok(!html.includes('org-service-frame'), 'sans au moins deux salariés partageant un même service dans une même fratrie, aucun cadre ne doit apparaître');

  console.log('OK — lettre-23-09.test.js (point 3 : jamais de cadre autour d\'un salarié seul dans son service)');
}

// ---- Point 7 : "les éléments de rémunération manquent sur la fiche" ----

function runNombreMoisSalaireExistesurLeModeleDeContrat() {
  const { sandbox } = setup();
  const c = sandbox.makeEmptyContrat();
  assert.strictEqual(c.nombreMoisSalaire, 12, 'nombreMoisSalaire doit exister sur le modèle de contrat, 12 par défaut');
  assert.ok(Array.isArray(c.avantagesNature), 'avantagesNature doit désormais être une liste structurée (nature + valeur), plus un texte libre');

  console.log('OK — lettre-23-09.test.js (point 7 : nombreMoisSalaire et avantagesNature structuré existent sur le modèle de contrat)');
}

function runFormulaireContratMasqueLesElementsAvancesSansLeModuleRemuneration() {
  const { DB, renderContratFormFields, employeeRepository, settingsRepository } = setup();
  const company = DB.getCurrentCompany();
  company.abonnement.offre = 'a_la_carte';
  company.abonnement.modules = [{ key: 'rh' }]; // 'remuneration' volontairement absent
  DB.saveCurrentCompany(company);

  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  const settings = settingsRepository.getSettings();
  const html = renderContratFormFields(salarie.contrats[0] || {}, salarie, settings);

  assert.ok(html.includes('f-contrat-salaire'), 'le salaire brut de base doit toujours rester visible, avec ou sans le module');
  assert.ok(!html.includes('f-contrat-nombre-mois-salaire') && !html.includes('f-contrat-part-variable') && !html.includes('f-contrat-prime-libelle-0') && !html.includes('f-contrat-avantage-nature-0'),
    'primes récurrentes/part variable/avantages en nature/nombre de mois ne doivent apparaître que si le module Rémunération est souscrit');

  console.log('OK — lettre-23-09.test.js (point 7 : les éléments avancés de rémunération restent cachés sans le module, le salaire de base reste visible)');
}

function runCorrigerUnContratSansLeModuleNeffacePasLesElementsDejaSaisis() {
  const { DB, employeeRepository } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  // Contrat déjà enrichi (saisi quand le module était souscrit).
  employeeRepository.update(salarie.id, {
    contrats: [{
      id: 'c1', dateDebut: '2025-01-01', dateFin: '', typeContrat: 'CDI', tempsTravail: 'Temps plein',
      salaireBrutMensuel: 3000, nombreMoisSalaire: 13,
      primesRecurrentes: [{ libelle: 'Prime ancienneté', montant: 50, periodicite: 'Mensuelle' }],
      avantagesNature: [{ nature: 'Véhicule de fonction', valeur: 300 }], partVariable: 'Sur objectifs'
    }]
  });

  // Le module est ensuite désactivé (offre à la carte sans "remuneration") avant une correction sur
  // un tout autre champ (ex. la classification, faute de frappe) : les éléments avancés déjà saisis
  // ne doivent jamais disparaître silencieusement de la base.
  const company = DB.getCurrentCompany();
  company.abonnement.offre = 'a_la_carte';
  company.abonnement.modules = [{ key: 'rh' }];
  DB.saveCurrentCompany(company);

  employeeRepository.corrigerContrat(salarie.id, 'c1', { classification: 'Niveau III' });

  const contratCorrige = employeeRepository.getById(salarie.id).contrats.find(c => c.id === 'c1');
  assert.strictEqual(contratCorrige.classification, 'Niveau III', 'le champ réellement corrigé doit changer');
  assert.strictEqual(contratCorrige.nombreMoisSalaire, 13, 'nombreMoisSalaire déjà saisi ne doit jamais être effacé par une correction faite sans le module');
  assert.strictEqual(contratCorrige.primesRecurrentes.length, 1, 'les primes récurrentes déjà saisies ne doivent jamais être effacées par une correction faite sans le module');
  assert.strictEqual(contratCorrige.avantagesNature.length, 1, 'les avantages en nature déjà saisis ne doivent jamais être effacés par une correction faite sans le module');
  assert.strictEqual(contratCorrige.partVariable, 'Sur objectifs');

  console.log('OK — lettre-23-09.test.js (point 7 : corriger un contrat sans le module Rémunération ne fait jamais disparaître les éléments avancés déjà saisis)');
}

function runOngletContratAfficheLeResumeRemunerationAvecLeModule() {
  const { DB, navigateTo, sandbox, employeeRepository, rh } = setup();
  employeeRepository.update(rh.id, {
    contrats: [{
      id: 'c1', dateDebut: '2025-01-01', dateFin: '', typeContrat: 'CDI', tempsTravail: 'Temps plein',
      salaireBrutMensuel: 3000, nombreMoisSalaire: 13,
      primesRecurrentes: [{ libelle: 'Prime ancienneté', montant: 50, periodicite: 'Mensuelle' }],
      avantagesNature: [], partVariable: ''
    }]
  });

  navigateTo('employee-detail', { currentEmployeeId: rh.id, employeeDetailTab: 'contrat' });
  const html = sandbox.document.getElementById('view-root').innerHTML;

  assert.ok(html.includes('sur 13 mois'), 'le nombre de mois doit apparaître dans le résumé du contrat sur l\'onglet Contrat');
  assert.ok(html.includes('1 prime récurrente'), 'les primes récurrentes doivent apparaître dans le résumé du contrat');

  console.log('OK — lettre-23-09.test.js (point 7 : l\'onglet Contrat affiche enfin un résumé des éléments de rémunération saisis)');
}

function run() {
  runMaFicheJamaisDeFilDArianeNiDeFlechesMemeAvecAccesALaListe();
  runFicheOuverteDepuisLaListeGardeLeFilDArianeEtLesFleches();
  runEntretiensSepareEnDeuxEntreesPersonnelEtEquipe();
  runMesEntretiensNeMontreJamaisLesBoutonsDeGestionNiLequipe();
  runEntretiensEquipeGardeLesBoutonsDeGestionPourRh();
  runOrganigrammeAfficheServiceEtEquipeSurChaqueCarte();
  runOrganigrammeEncadreLesFreresDuMemeService();
  runOrganigrammeNEncadreJamaisUnSalarieSeulDansSonService();
  runNombreMoisSalaireExistesurLeModeleDeContrat();
  runFormulaireContratMasqueLesElementsAvancesSansLeModuleRemuneration();
  runCorrigerUnContratSansLeModuleNeffacePasLesElementsDejaSaisis();
  runOngletContratAfficheLeResumeRemunerationAvecLeModule();
}

try {
  run();
} catch (err) {
  console.error('ÉCHEC — lettre-23-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
