/**
 * Seven RH — retour Betty du 17/09/2026, points 1 et 2 de sa lettre suite à l'usage de la fiche
 * salarié :
 * 1. La carte "Suivi médical" n'était pas cloisonnée au module RH (contrairement à la notification
 *    correspondante, déjà gardée par SOURCE_KEY_MODULE_RULES) — corrigé avec ifModule('rh', ...).
 * 2. L'ancien bouton "Enregistrer une visite médicale" écrivait la date du jour instantanément, sans
 *    confirmation ni possibilité de choisir la date, et écrasait tout historique (un seul champ
 *    dateDerniereVisiteMedicale). Remplacé par un vrai historique (employee.visitesMedicales),
 *    avec un type de suivi par salarié (simple/adapté/renforcé) qui détermine la périodicité ET les
 *    options de conclusion (seul le suivi renforcé produit un avis d'aptitude/inaptitude).
 * L'ouverture réelle de la modale (clic, remplissage, soumission) n'est pas simulable dans ce bac à
 * sable minimal (document.querySelector renvoie toujours null, voir load-app-js.js) — vérifiée
 * manuellement dans le navigateur ; ces tests portent sur le rendu HTML et la logique pure.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAppJs } = require('./load-app-js');

function makeSalarieDeTest(DB, overrides) {
  const company = DB.getCurrentCompany();
  const employee = company.employees[0];
  Object.assign(employee, { dateEmbauche: '2020-01-15', archive: false, statut: 'Actif' }, overrides);
  DB.saveCurrentCompany(company);
  return employee;
}

async function runCarteCloisonneeAuModuleRh() {
  const { DB, sandbox, renderEmployeeDetail, authRepository } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const employee = makeSalarieDeTest(DB);
  const company = DB.getCurrentCompany();
  DB._currentEmployeeId = company.employees.find(e => e.role === 'proprietaire').id;

  // Sans le module RH souscrit (offre à la carte, ex. Seven Sept qui n'a que Congés + Notes de frais).
  company.abonnement.offre = 'a_la_carte';
  company.abonnement.modules = [{ key: 'conges' }, { key: 'frais' }];
  DB.saveCurrentCompany(company);
  const htmlSansRh = renderEmployeeDetail(employee.id);
  assert.ok(!htmlSansRh.includes('Suivi médical'), 'la carte "Suivi médical" ne doit PAS s\'afficher sans le module RH souscrit (fuite signalée par Betty, comme la notification l\'était déjà)');

  // Avec le module RH souscrit.
  company.abonnement.modules = [{ key: 'conges' }, { key: 'frais' }, { key: 'rh' }];
  DB.saveCurrentCompany(company);
  const htmlAvecRh = renderEmployeeDetail(employee.id);
  assert.ok(htmlAvecRh.includes('Suivi médical'), 'la carte doit s\'afficher normalement une fois le module RH souscrit');

  console.log('OK — suivi-medical-refonte-17-09.test.js (carte "Suivi médical" cloisonnée au module RH)');
}

async function runOptionsDeConclusionSelonLeTypeDeSuivi() {
  const { SUIVI_MEDICAL_RULES } = loadAppJs();
  assert.strictEqual(SUIVI_MEDICAL_RULES.simple.hasAptitudeVerdict, false, 'le suivi simple ne doit jamais proposer un avis d\'aptitude');
  assert.strictEqual(SUIVI_MEDICAL_RULES.adapte.hasAptitudeVerdict, false, 'le suivi adapté ne doit jamais proposer un avis d\'aptitude');
  assert.strictEqual(SUIVI_MEDICAL_RULES.renforce.hasAptitudeVerdict, true, 'seul le suivi renforcé doit proposer un avis d\'aptitude/inaptitude');
  assert.ok(SUIVI_MEDICAL_RULES.renforce.conclusionOptions.some(c => /inapte/i.test(c)), 'le suivi renforcé doit avoir une option "inapte"');
  assert.ok(!SUIVI_MEDICAL_RULES.simple.conclusionOptions.some(c => /inapte|apte\b/i.test(c)), 'le suivi simple ne doit pas avoir d\'option d\'aptitude ("apte"/"inapte") — la VIP ne produit pas cet avis');
  assert.ok(SUIVI_MEDICAL_RULES.renforce.intermediaireSettingKey, 'le suivi renforcé doit avoir un rendez-vous intermédiaire configurable');
  assert.ok(!SUIVI_MEDICAL_RULES.simple.intermediaireSettingKey && !SUIVI_MEDICAL_RULES.adapte.intermediaireSettingKey, 'seul le suivi renforcé a un rendez-vous intermédiaire');

  console.log('OK — suivi-medical-refonte-17-09.test.js (options de conclusion dépendent du type de suivi, seul le renforcé a un avis d\'aptitude)');
}

async function runPeriodiciteDependDuTypeDeSuivi() {
  const { DB, sandbox, computeNextVisiteMedicale, toISODate } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();

  // Sans aucune visite enregistrée : échéance à 3 mois après l'embauche, quel que soit le type de suivi.
  const nouveau = makeSalarieDeTest(DB, { suiviMedicalType: 'simple', visitesMedicales: [], dateEmbauche: '2026-01-15' });
  const premiere = computeNextVisiteMedicale(nouveau);
  assert.strictEqual(premiere.premiereVisite, true);
  assert.strictEqual(toISODate(premiere.next), '2026-04-15', 'la première visite doit rester due à 3 mois après l\'embauche, non paramétrable');

  // Suivi simple : périodicité longue (60 mois par défaut), pas de rendez-vous intermédiaire.
  const salarieSimple = makeSalarieDeTest(DB, {
    suiviMedicalType: 'simple',
    visitesMedicales: [{ id: 'v1', date: '2024-06-01', type: 'periodique', conclusion: '', dateProchaineEcheance: '', contreVisite: false, amenagements: '', commentaire: '', pieceJointe: null }]
  });
  const echeanceSimple = computeNextVisiteMedicale(salarieSimple);
  assert.strictEqual(echeanceSimple.kind, 'periodique');
  assert.strictEqual(toISODate(echeanceSimple.next), '2029-06-01', 'suivi simple : échéance à 60 mois (5 ans) par défaut');
  assert.strictEqual(echeanceSimple.autreEcheance, null, 'pas de second rendez-vous pour un suivi simple');

  // Suivi renforcé : le rendez-vous intermédiaire (24 mois) doit apparaître avant la visite
  // périodique (48 mois), les deux calculées depuis la même dernière visite enregistrée.
  const salarieRenforce = makeSalarieDeTest(DB, {
    suiviMedicalType: 'renforce',
    visitesMedicales: [{ id: 'v2', date: '2024-06-01', type: 'periodique', conclusion: 'Apte', dateProchaineEcheance: '', contreVisite: false, amenagements: '', commentaire: '', pieceJointe: null }]
  });
  const echeanceRenforce = computeNextVisiteMedicale(salarieRenforce);
  assert.strictEqual(echeanceRenforce.kind, 'intermediaire', 'le rendez-vous intermédiaire (24 mois) doit être l\'échéance la plus proche pour un suivi renforcé');
  assert.strictEqual(toISODate(echeanceRenforce.next), '2026-06-01', 'rendez-vous intermédiaire à 24 mois');
  assert.ok(echeanceRenforce.autreEcheance, 'la visite périodique suivante (48 mois) doit rester visible en second plan');
  assert.strictEqual(toISODate(echeanceRenforce.autreEcheance), '2028-06-01', 'visite périodique à 48 mois');

  console.log('OK — suivi-medical-refonte-17-09.test.js (périodicité dépend du type de suivi, rendez-vous intermédiaire du suivi renforcé calculé)');
}

async function runMigrationDeLAncienChampUnique() {
  const { DB, sandbox } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const company = DB.getCurrentCompany();
  const employee = company.employees[0];
  // Simule une entreprise déjà créée AVANT ce correctif : ancien champ renseigné, pas de type de
  // suivi, pas d'historique.
  delete employee.suiviMedicalType;
  delete employee.visitesMedicales;
  employee.dateDerniereVisiteMedicale = '2023-03-10';
  delete company.visitesMedicalesMigrees;
  DB.saveCurrentCompany(company);

  const migres = DB.getEmployees();
  const migre = migres.find(e => e.id === employee.id);
  assert.strictEqual(migre.suiviMedicalType, 'simple', 'un salarié existant doit recevoir le type de suivi par défaut ("simple")');
  assert.strictEqual(migre.visitesMedicales.length, 1, 'l\'ancienne date doit devenir une entrée d\'historique, pas être perdue');
  assert.strictEqual(migre.visitesMedicales[0].date, '2023-03-10');
  assert.ok(!/motif|diagnostic/i.test(migre.visitesMedicales[0].commentaire), 'le commentaire de migration ne doit contenir aucune information médicale');

  // Ne se reproduit pas une deuxième fois (idempotent) même si l'utilisateur modifie ensuite l'historique.
  const avantDeuxiemeAppel = JSON.stringify(DB.getCurrentCompany().employees.find(e => e.id === employee.id).visitesMedicales);
  DB.getEmployees();
  const apresDeuxiemeAppel = JSON.stringify(DB.getCurrentCompany().employees.find(e => e.id === employee.id).visitesMedicales);
  assert.strictEqual(avantDeuxiemeAppel, apresDeuxiemeAppel, 'la migration ne doit jamais se rejouer une fois faite');

  console.log('OK — suivi-medical-refonte-17-09.test.js (reprise de l\'ancien champ unique vers un historique, une seule fois)');
}

async function runCarteAfficheHistoriqueEtBoutons() {
  const { DB, sandbox, renderEmployeeDetail } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const employee = makeSalarieDeTest(DB, {
    suiviMedicalType: 'renforce',
    visitesMedicales: [
      { id: 'v1', date: '2024-01-10', type: 'periodique', conclusion: 'Apte avec réserves ou aménagements', dateProchaineEcheance: '', contreVisite: true, amenagements: 'Poste assis privilégié', commentaire: '', pieceJointe: null }
    ]
  });
  const company = DB.getCurrentCompany();
  company.abonnement.offre = 'a_la_carte';
  company.abonnement.modules = [{ key: 'rh' }];
  DB.saveCurrentCompany(company);
  DB._currentEmployeeId = company.employees.find(e => e.role === 'proprietaire').id;

  const html = renderEmployeeDetail(employee.id);
  assert.ok(html.includes('Apte avec réserves ou aménagements'), 'la conclusion enregistrée doit être visible dans l\'historique');
  assert.ok(html.includes('Poste assis privilégié'), 'les aménagements préconisés doivent être visibles');
  assert.ok(html.includes('data-edit-visite-medicale="v1"'), 'chaque visite doit avoir un bouton "Modifier"');
  assert.ok(html.includes('data-delete-visite-medicale="v1"'), 'chaque visite doit avoir un bouton "Supprimer"');
  assert.ok(html.includes('id="btn-ajouter-visite-medicale"'), 'le bouton d\'ajout doit être présent');
  assert.ok(!html.includes('id="btn-enregistrer-visite-medicale"'), 'l\'ancien bouton à écriture instantanée ne doit plus exister');

  console.log('OK — suivi-medical-refonte-17-09.test.js (historique, conclusion et aménagements affichés, ancien bouton disparu)');
}

async function runPlusDecritureInstantaneeSansConfirmation() {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.ok(!appSource.includes("dateDerniereVisiteMedicale: toISODate(new Date())"), 'plus aucune écriture instantanée de la date du jour sans passer par le formulaire');
  const modalStart = appSource.indexOf('function openVisiteMedicaleModal(');
  const modalEnd = appSource.indexOf('\nfunction deleteVisiteMedicale(');
  const modalBody = appSource.slice(modalStart, modalEnd);
  assert.ok(modalBody.includes('type="date" id="f-visite-date"'), 'la date doit être un champ modifiable par l\'utilisateur, jamais imposée');
  assert.ok(modalBody.includes('Ne jamais y indiquer un diagnostic'), 'le champ commentaire doit porter l\'avertissement contre les données médicales');
  assert.ok(modalBody.includes("addEventListener('submit'"), 'l\'enregistrement doit passer par la soumission explicite d\'un formulaire, jamais un clic qui écrit directement');

  console.log('OK — suivi-medical-refonte-17-09.test.js (plus d\'écriture instantanée, date modifiable, avertissement donnée médicale présent)');
}

async function runBadgeConclusionNeConfondPasLaNegation() {
  // §bug trouvé en testant en direct : "aucune orientation nécessaire" (favorable) matchait le même
  // motif que "orientation recommandée" (à surveiller), les deux ressortaient en avertissement.
  const { visiteMedicaleConclusionBadgeClass } = loadAppJs();
  assert.strictEqual(visiteMedicaleConclusionBadgeClass('Suivi assuré, aucune orientation nécessaire'), 'badge-success', 'la conclusion favorable ne doit jamais ressortir en avertissement, même si elle contient le mot "orientation"');
  assert.strictEqual(visiteMedicaleConclusionBadgeClass('Orientation vers le médecin du travail recommandée'), 'badge-warning');
  assert.strictEqual(visiteMedicaleConclusionBadgeClass('Apte avec réserves ou aménagements'), 'badge-warning');
  assert.strictEqual(visiteMedicaleConclusionBadgeClass('Apte'), 'badge-success');
  assert.strictEqual(visiteMedicaleConclusionBadgeClass('Inapte définitivement'), 'badge-danger');

  console.log('OK — suivi-medical-refonte-17-09.test.js (badge de conclusion ne confond pas "aucune orientation" avec "orientation recommandée")');
}

runCarteCloisonneeAuModuleRh()
  .then(runBadgeConclusionNeConfondPasLaNegation)
  .then(runOptionsDeConclusionSelonLeTypeDeSuivi)
  .then(runPeriodiciteDependDuTypeDeSuivi)
  .then(runMigrationDeLAncienChampUnique)
  .then(runCarteAfficheHistoriqueEtBoutons)
  .then(runPlusDecritureInstantaneeSansConfirmation)
  .catch((err) => {
    console.error('ÉCHEC — suivi-medical-refonte-17-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
