/**
 * Seven RH — retour Betty du 18/09/2026, point 8 ("les abonnements : des licences réellement
 * attribuées", top priorité) : jusqu'ici, souscrire N licences d'un module (ex. 3 Notes de frais)
 * ne limitait en rien qui pouvait réellement l'utiliser (hasModule() ne vérifie que la présence du
 * module, jamais un quota nominatif) — l'entreprise pouvait facturer 3 et en faire consommer 10.
 *
 * Corrigé par module_licenses (migration 0059) : la table d'attribution nominative elle-même,
 * has_module_license() le VRAI verrou côté serveur (policies d'INSERT de leave_requests/
 * telework_requests/expenses), et côté client un miroir (hasModuleLicense) qui ne sert qu'à guider
 * l'affichage AVANT l'envoi — jamais la seule vérité. Ces tests couvrent le miroir client, l'écran
 * de gestion des accès (compteur X/Y, capacité), le garde-fou "jamais auto-choisir qui perd son
 * accès" en cas de réduction de quantité, et la libération automatique au départ d'un salarié.
 *
 * Interaction réelle des deux modales (cocher une case, cliquer "Confirmer") non reproductible dans
 * ce bac à sable minimal : addEventListener()/querySelectorAll() y sont volontairement des no-op
 * (voir load-app-js.js) — vérifiée manuellement dans le navigateur. Ces tests portent donc sur le
 * HTML produit par l'ouverture des modales et sur la logique pure (ensureLicenseCapacity/
 * releaseModuleLicensesForDeparture, qui n'attendent elles-mêmes aucun clic pour s'exécuter).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function setupEntrepriseALaCarte(modules) {
  const api = loadAppJs();
  // Proxy avec repli générique (comme module-gating.test.js) : releaseModuleLicensesForDeparture
  // termine par un render() complet, qui pousse au passage vers d'autres fonctions Supabase
  // (settings, audit...) sans rapport avec la licence elle-même — un repli générique évite de devoir
  // lister tout ce que render() touche, tout en laissant les tests réassigner explicitement
  // grantModuleLicense/revokeModuleLicense/hydrateCurrentCompany au cas par cas (le get() vérifie
  // bien `prop in target`, contrairement au Proxy plus générique d'exports-nombres-dates-18-09.test.js).
  const supabaseTarget = {
    grantModuleLicense: async () => {},
    revokeModuleLicense: async () => {},
    hydrateCurrentCompany: async () => api.DB.getCurrentCompany(),
  };
  api.sandbox.window.SupabaseSync = new Proxy(supabaseTarget, {
    get(target, prop) { return prop in target ? target[prop] : async () => ({ success: true }); }
  });
  api.DB.init();
  const company = api.DB.getCurrentCompany();
  company.abonnement.offre = 'a_la_carte';
  company.abonnement.modules = modules;
  company.moduleLicenses = {};
  api.DB.saveCurrentCompany(company);
  const rh = api.DB.getEmployees().find(e => e.role === 'rh');
  const salarie = api.DB.getEmployees().find(e => e.role === 'salarie');
  api.DB._currentEmployeeId = rh.id;
  return { ...api, rh, salarie, company: () => api.DB.getCurrentCompany() };
}

async function runExemptionRhProprietaireSansLicence() {
  const { hasModuleLicense, rh } = setupEntrepriseALaCarte([{ key: 'conges', quantite: 1 }]);
  assert.strictEqual(hasModuleLicense(rh, 'conges'), true, 'RH doit toujours avoir accès à un module souscrit, même sans siège nominatif attribué (administration, pas usage personnel facturé)');

  console.log('OK — licences-par-module-18-09.test.js (RH/Propriétaire exemptés de licence nominative)');
}

async function runSalarieSansLicenceBloque() {
  const { hasModuleLicense, salarie } = setupEntrepriseALaCarte([{ key: 'conges', quantite: 1 }]);
  assert.strictEqual(hasModuleLicense(salarie, 'conges'), false, 'un salarié non listé dans moduleLicenses ne doit jamais avoir accès, même si le module est souscrit par l\'entreprise');

  console.log('OK — licences-par-module-18-09.test.js (salarié sans siège attribué : bloqué)');
}

async function runSalarieAvecLicenceAutorise() {
  const { hasModuleLicense, salarie, company, DB } = setupEntrepriseALaCarte([{ key: 'conges', quantite: 1 }]);
  const c = company();
  c.moduleLicenses = { conges: [salarie.id] };
  DB.saveCurrentCompany(c);
  assert.strictEqual(hasModuleLicense(salarie, 'conges'), true, 'un salarié listé dans moduleLicenses[moduleKey] doit avoir accès');

  console.log('OK — licences-par-module-18-09.test.js (salarié avec siège attribué : autorisé)');
}

async function runModuleNonSouscritBloqueMemeAvecEntreeParasite() {
  // Robustesse : une entrée moduleLicenses pour un module jamais souscrit ne doit jamais suffire à
  // elle seule (ex. module retiré de l'abonnement sans purge de la table côté serveur).
  const { hasModuleLicense, salarie, company, DB } = setupEntrepriseALaCarte([{ key: 'conges', quantite: 1 }]);
  const c = company();
  c.moduleLicenses = { frais: [salarie.id] };
  DB.saveCurrentCompany(c);
  assert.strictEqual(hasModuleLicense(salarie, 'frais'), false, 'une licence pour un module non souscrit par l\'entreprise ne doit jamais suffire (hasModule() reste la première condition)');

  console.log('OK — licences-par-module-18-09.test.js (licence orpheline sur un module non souscrit : toujours bloquée)');
}

async function runOffreClassiqueToujoursAutorisee() {
  const { hasModuleLicense, salarie, company, DB } = setupEntrepriseALaCarte([]);
  const c = company();
  c.abonnement.offre = 'professionnel'; // hors à la carte : tout inclus, aucune notion de siège
  DB.saveCurrentCompany(c);
  assert.strictEqual(hasModuleLicense(salarie, 'conges'), true, 'hors offre à la carte, aucune notion de siège nominatif : toujours autorisé, comme hasModule()');

  console.log('OK — licences-par-module-18-09.test.js (offre classique : jamais de quota de sièges)');
}

async function runResumeExclutArchivesEtAdmins() {
  const { licenseSummaryForModule, salarie, rh, company, DB } = setupEntrepriseALaCarte([{ key: 'frais', quantite: 2 }]);
  const autreSalarie = Object.assign({}, salarie, { id: 'sal-archive-test', archive: true });
  const c = company();
  c.employees.push(autreSalarie);
  // moduleLicenses contient RH (exempté, ne doit jamais compter) et le salarié archivé (parti,
  // ne doit plus compter) en plus du salarié actif réellement licencié.
  c.moduleLicenses = { frais: [salarie.id, rh.id, autreSalarie.id] };
  DB.saveCurrentCompany(c);

  const { assigned, quantite } = licenseSummaryForModule('frais', 2);
  assert.strictEqual(quantite, 2);
  assert.strictEqual(assigned, 1, 'le compteur attribué ne doit compter que les salariés actifs non-RH/Propriétaire réellement licenciés (ici : 1 seul)');

  console.log('OK — licences-par-module-18-09.test.js (compteur X/Y : exclut RH/Propriétaire et les salariés archivés)');
}

async function runTableauAbonnementAfficheLesAccesUniquementPourLesModulesVerrouilles() {
  const { renderAbonnementAlaCarteActif, LICENSED_MODULE_KEYS } = setupEntrepriseALaCarte([]);
  const abo = {
    statut: 'actif', periodicite: 'mensuel', dateDebut: '2026-01-01',
    modules: [{ key: 'conges', quantite: 3 }, { key: 'entretiens', quantite: 3 }]
  };
  const html = renderAbonnementAlaCarteActif(abo, 5, 'success');

  assert.ok(LICENSED_MODULE_KEYS.includes('conges'), 'contrôle : conges doit bien être un module verrouillé côté serveur (0059)');
  assert.ok(html.includes('data-gerer-licences="conges"'), 'un module réellement verrouillé côté serveur doit proposer "Gérer les accès"');
  assert.ok(html.includes('attribuées'), 'le compteur X/Y attribuées doit apparaître pour un module verrouillé');
  assert.ok(!html.includes('data-gerer-licences="entretiens"'), 'un module SANS policy de licence côté serveur (entretiens) ne doit jamais promettre un verrou que le serveur ne tient pas');

  console.log('OK — licences-par-module-18-09.test.js (tableau abonnement : "Gérer les accès" réservé aux modules réellement verrouillés)');
}

async function runEnsureLicenseCapaciteImmediateSiSuffisant() {
  const { ensureLicenseCapacity } = setupEntrepriseALaCarte([{ key: 'conges', quantite: 3 }]);
  const resultat = await ensureLicenseCapacity('conges', 3);
  assert.strictEqual(resultat, true, 'aucun conflit : la promesse doit se résoudre immédiatement à true, sans ouvrir de modale');

  console.log('OK — licences-par-module-18-09.test.js (ensureLicenseCapacity : résolution immédiate sans conflit)');
}

async function runEnsureLicenseCapaciteOuvreLaModaleAvecChoixExplicite() {
  const { ensureLicenseCapacity, salarie, company, DB, sandbox } = setupEntrepriseALaCarte([{ key: 'conges', quantite: 2 }]);
  const autreSalarie = Object.assign({}, salarie, { id: 'sal-2', prenom: 'Autre', nom: 'Salarie' });
  const c = company();
  c.employees.push(autreSalarie);
  c.moduleLicenses = { conges: [salarie.id, autreSalarie.id] }; // 2 attribués, quantité cible : 1
  DB.saveCurrentCompany(c);

  // Ne JAMAIS attendre cette promesse : elle ne se résout que sur un clic réel dans la modale,
  // impossible à simuler ici (voir l'en-tête du fichier) — seul le HTML produit à l'ouverture est
  // vérifiable, ce qui suffit à couvrir "propose un choix, ne décide jamais à la place de Betty".
  ensureLicenseCapacity('conges', 1);

  // Le DOM simulé de ce bac à sable ne fait pas de vrai rendu arborescent (voir load-app-js.js) :
  // le HTML produit reste entièrement dans #modal-root, jamais réparti sur des ids internes
  // séparément adressables — on lit donc le conteneur, pas #retrait-licence-body.
  const modalHtml = sandbox.document.getElementById('modal-root').innerHTML;
  assert.ok(modalHtml.includes(`data-a-retirer="${salarie.id}"`) && modalHtml.includes(`data-a-retirer="${autreSalarie.id}"`),
    'la modale doit proposer les DEUX bénéficiaires actuels au retrait, jamais présélectionner elle-même qui perd son accès');
  assert.ok(modalHtml.includes('0/1 sélectionné'), 'le nombre à retirer (2 attribués - 1 quantité cible = 1) doit être annoncé explicitement');
  assert.ok(modalHtml.includes('id="btn-confirm-retrait-licence"') && modalHtml.includes('disabled'),
    'un bouton de confirmation séparé, désactivé par défaut, doit exister (aucun retrait avant validation explicite)');

  console.log('OK — licences-par-module-18-09.test.js (réduction de quantité : modale de choix explicite, jamais un retrait automatique)');
}

async function runLiberationAuDepart() {
  const { releaseModuleLicensesForDeparture, salarie, company, DB, sandbox, notificationRepository } = setupEntrepriseALaCarte([{ key: 'conges', quantite: 2 }, { key: 'frais', quantite: 2 }]);
  const c = company();
  c.moduleLicenses = { conges: [salarie.id], frais: [salarie.id] };
  DB.saveCurrentCompany(c);

  const revoked = [];
  sandbox.window.SupabaseSync.revokeModuleLicense = async (companyId, moduleKey, employeeId) => { revoked.push(moduleKey); };
  sandbox.window.SupabaseSync.hydrateCurrentCompany = async () => {
    const fresh = DB.getCurrentCompany();
    fresh.moduleLicenses = {}; // simule le retrait effectif côté serveur
    return fresh;
  };

  await releaseModuleLicensesForDeparture(salarie);

  assert.deepStrictEqual(revoked.sort(), ['conges', 'frais'], 'le départ d\'un salarié doit libérer TOUS ses accès nominatifs, module par module');
  const notif = notificationRepository.getNotifications().find(n => n.sourceKey.startsWith(`licence-liberee-${salarie.id}`));
  assert.ok(notif, 'une notification doit prévenir de la libération (voir Betty : "auto-release + me notifier")');
  assert.ok(notif.message.includes(salarie.prenom), 'la notification doit identifier le salarié concerné');

  console.log('OK — licences-par-module-18-09.test.js (départ d\'un salarié : libération de tous ses accès + notification)');
}

async function runLiberationSansLicenceNeFaitRien() {
  const { releaseModuleLicensesForDeparture, salarie, sandbox, notificationRepository } = setupEntrepriseALaCarte([{ key: 'conges', quantite: 2 }]);

  const revoked = [];
  sandbox.window.SupabaseSync.revokeModuleLicense = async () => { revoked.push(true); };

  await releaseModuleLicensesForDeparture(salarie);

  assert.strictEqual(revoked.length, 0, 'un salarié sans aucune licence attribuée ne doit déclencher aucun appel de retrait');
  assert.strictEqual(notificationRepository.getNotifications().length, 0, 'et surtout aucune notification inutile ("rien à libérer" ne doit jamais alerter Betty pour rien)');

  console.log('OK — licences-par-module-18-09.test.js (départ sans licence attribuée : aucun bruit)');
}

runExemptionRhProprietaireSansLicence()
  .then(runSalarieSansLicenceBloque)
  .then(runSalarieAvecLicenceAutorise)
  .then(runModuleNonSouscritBloqueMemeAvecEntreeParasite)
  .then(runOffreClassiqueToujoursAutorisee)
  .then(runResumeExclutArchivesEtAdmins)
  .then(runTableauAbonnementAfficheLesAccesUniquementPourLesModulesVerrouilles)
  .then(runEnsureLicenseCapaciteImmediateSiSuffisant)
  .then(runEnsureLicenseCapaciteOuvreLaModaleAvecChoixExplicite)
  .then(runLiberationAuDepart)
  .then(runLiberationSansLicenceNeFaitRien)
  .catch((err) => {
    console.error('ÉCHEC — licences-par-module-18-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
