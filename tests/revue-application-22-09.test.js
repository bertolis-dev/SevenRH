/**
 * Seven RH — suite du "tour de l'application" du 22/09/2026 ("fais vraiment un tour bout par bout de
 * toute l'application et le site", après un premier passage jugé insuffisant). Couvre les correctifs
 * trouvés par des agents de revue de code dédiés à chaque module (Pointeuse, Notes de frais, Planning,
 * Télétravail) ET par un test réel dans le navigateur intégré (bandeau de synchronisation anonyme,
 * déjà couvert par logaudit-anonyme-22-09.test.js) :
 *
 * 1. Pointeuse QR — DB.enregistrerPointage ne retrouvait un pointage ouvert que dans la liste du JOUR
 *    du scan : un quart de nuit (arrivée avant minuit, départ après) créait à tort une seconde
 *    arrivée au lieu de fermer la première, laissant celle-ci ouverte indéfiniment.
 * 2. Notes de frais — modifier une note Kilométrique déjà enregistrée (distance/catégorie/date) ne
 *    redéclenchait jamais le recalcul du barème cumulatif pour les AUTRES notes de l'année, alors que
 *    le refus/l'annulation d'une note le fait déjà (kilometrique-recalcul-11-09.test.js).
 * 3. Planning — la carte de quart dans la grille "Postes" restait draggable/éditable
 *    (data-edit-shift) même pour un utilisateur sans MODIFIER_SALARIE, contrairement à toutes les
 *    autres actions de mutation du Planning.
 * 4. Télétravail — l'écran "Congés & absences" (qui héberge aussi l'onglet Télétravail) n'était
 *    accessible qu'avec le module 'conges' souscrit, alors que le Télétravail est facturé sous la clé
 *    'planning' — une entreprise à la carte abonnée UNIQUEMENT à 'planning' ne pouvait jamais
 *    atteindre un module qu'elle payait.
 * 5. Télétravail — modifier une demande En attente sans changer ses dates comptait deux fois son
 *    propre volume contre le quota hebdomadaire (une fois via les demandes actives existantes, une
 *    fois via les nouvelles dates saisies), rejetant un simple modifier-sans-rien-changer.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');
const { loadDataJs } = require('./load-data-js');

function setup() {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  const rh = api.DB.getEmployees().find(e => e.role === 'rh');
  api.DB._currentEmployeeId = rh.id;
  return { ...api, rh };
}

async function runPointeuseQuartDeNuit() {
  const { DB, pointageRepository, etablissementRepository, toISODate, rh } = setup();
  const etab = etablissementRepository.getAll()[0];

  // Simule un pointage ouvert la veille (arrivée juste avant minuit, jamais clôturé).
  const hier = toISODate(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const pointageOuvertHier = { id: 'pointage-veille', employeeId: rh.id, etablissementId: etab.id, date: hier, heureArrivee: '23:50', heureDepart: null, regularisation: null };
  DB.savePointages([pointageOuvertHier]);

  const resultat = await pointageRepository.enregistrer(rh.id, etab.id, 'peu importe : SupabaseSync mocké accepte tout');
  assert.strictEqual(resultat.type, 'depart', 'le scan du lendemain matin doit fermer le pointage ouvert la veille, jamais ouvrir une nouvelle arrivée');

  const list = DB.getPointages();
  assert.strictEqual(list.length, 1, 'aucun pointage fantôme ne doit avoir été créé : la veille doit simplement être clôturée');
  assert.strictEqual(list[0].id, 'pointage-veille');
  assert.strictEqual(list[0].heureDepart, resultat.heure, 'le départ doit être enregistré sur le pointage de la veille, pas ailleurs');
  assert.ok(resultat.dureeMinutes > 0, 'la durée doit refléter le quart de nuit réellement travaillé, jamais 0');

  console.log('OK — revue-application-22-09.test.js (1. Pointeuse : un quart de nuit ferme le bon pointage, jamais une arrivée fantôme)');
}

async function runPointeuseOublieAncienNonRecupere() {
  const { DB, pointageRepository, etablissementRepository, toISODate, rh } = setup();
  const etab = etablissementRepository.getAll()[0];

  // Un pointage ouvert il y a 3 jours est un vrai oubli (régularisation manuelle attendue) : le
  // prochain scan normal ne doit surtout PAS le récupérer silencieusement des jours plus tard.
  const ilYA3Jours = toISODate(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000));
  DB.savePointages([{ id: 'pointage-oublie', employeeId: rh.id, etablissementId: etab.id, date: ilYA3Jours, heureArrivee: '09:00', heureDepart: null, regularisation: null }]);

  const resultat = await pointageRepository.enregistrer(rh.id, etab.id, 'code');
  assert.strictEqual(resultat.type, 'arrivee', 'un pointage ouvert depuis plus d\'un jour ne doit jamais être clôturé automatiquement par un scan normal');
  const oublie = DB.getPointages().find(p => p.id === 'pointage-oublie');
  assert.strictEqual(oublie.heureDepart, null, 'le pointage oublié doit rester ouvert, à corriger via régularisation manuelle');

  console.log('OK — revue-application-22-09.test.js (1bis. Pointeuse : un oubli de plus d\'un jour reste réservé à la régularisation manuelle)');
}

async function runFraisKilometriqueRecalculeALaModification() {
  const { calculateIndemniteKilometrique } = loadDataJs();
  const { DB, finalizeExpenseSubmit, rh } = setup();
  const cv = 5;

  // Distances choisies pour que l'édition fasse franchir le seuil de tranche (5000 km pour une
  // voiture) : sans franchissement de tranche, la formule du barème est linéaire À L'INTÉRIEUR d'une
  // même tranche (voir le commentaire de calculateIndemniteKilometrique, data.js) et le montant
  // MARGINAL d'une note ne dépend alors QUE de sa propre distance, pas du cumul avant elle — un
  // premier jet de ce test avec des distances qui restaient dans la même tranche (donc un montant de
  // note3 inchangé après coup) ne prouvait donc rien, ni dans un sens ni dans l'autre.
  const note1 = await DB.addExpense({ employeeId: rh.id, categorie: 'Kilométrique', date: '2026-03-01', libelle: 'Trajet 1', tauxTVA: 0, kilometrage: { distanceKm: 1000, puissanceFiscale: cv }, montantTTC: calculateIndemniteKilometrique(1000, cv, 0) });
  const note2 = await DB.addExpense({ employeeId: rh.id, categorie: 'Kilométrique', date: '2026-06-01', libelle: 'Trajet 2', tauxTVA: 0, kilometrage: { distanceKm: 1000, puissanceFiscale: cv }, montantTTC: calculateIndemniteKilometrique(1000, cv, 1000) });
  const note1MontantAvant = DB.getExpenseById(note1.id).montantTTC;
  // note3 : cumul avant l'édition = 2000→4000 km, entièrement dans la 1ère tranche (<5000 km).
  const note3 = await DB.addExpense({ employeeId: rh.id, categorie: 'Kilométrique', date: '2026-09-01', libelle: 'Trajet 3', tauxTVA: 0, kilometrage: { distanceKm: 2000, puissanceFiscale: cv }, montantTTC: calculateIndemniteKilometrique(2000, cv, 2000) });
  const montantNote3Avant = DB.getExpenseById(note3.id).montantTTC;

  // note2 passe de 1000 à 5000 km : le cumul avant note3 passe de 2000 à 6000 km, faisant basculer
  // note3 (2000 km) dans la 2ème tranche (>5000 km).
  await finalizeExpenseSubmit({
    employeeId: rh.id, categorie: 'Kilométrique', date: '2026-06-01', libelle: 'Trajet 2 (corrigé)',
    tauxTVA: 0, kilometrage: { distanceKm: 5000, puissanceFiscale: cv }, montantTTC: calculateIndemniteKilometrique(5000, cv, 1000), commentaire: '', justificatif: null
  }, null, note2.id);

  const montantNote3Apres = DB.getExpenseById(note3.id).montantTTC;
  assert.notStrictEqual(montantNote3Apres, montantNote3Avant, 'modifier le kilométrage de la note 2 doit redéclencher le recalcul de la note 3 (après elle), pas la laisser sur un cumul obsolète');
  assert.strictEqual(montantNote3Apres, calculateIndemniteKilometrique(2000, cv, 1000 + 5000));
  assert.strictEqual(DB.getExpenseById(note1.id).montantTTC, note1MontantAvant, 'la note 1 (avant la modifiée) ne doit jamais changer');

  console.log('OK — revue-application-22-09.test.js (2. Notes de frais : modifier une note Kilométrique recalcule les autres notes de l\'année)');
}

function runPlanningCarteDeQuartReserveeAModifierSalarie() {
  // Contrôle positif : un RH (MODIFIER_SALARIE) voit la carte ouvrable en édition.
  const rhCtx = setup();
  const shiftRh = rhCtx.shiftRepository.create({ employeeId: rhCtx.rh.id, weekday: 'Lun', heureDebut: '09:00', heureFin: '17:00', pauseMinutes: 30 });
  rhCtx.state.planningVue = 'equipe';
  const htmlRh = rhCtx.renderPlanningPostes();
  assert.ok(htmlRh.includes(`data-edit-shift="${shiftRh.id}"`), 'contrôle positif : un RH (MODIFIER_SALARIE) doit toujours pouvoir ouvrir la modale d\'édition depuis sa propre carte de quart');

  // Cas corrigé : un manager (sans MODIFIER_SALARIE) ne doit plus voir data-edit-shift sur la carte.
  const managerCtx = setup();
  const manager = managerCtx.DB.getEmployees().find(e => e.role === 'manager');
  const shiftManager = managerCtx.shiftRepository.create({ employeeId: manager.id, weekday: 'Lun', heureDebut: '09:00', heureFin: '17:00', pauseMinutes: 30 });
  managerCtx.DB._currentEmployeeId = manager.id;
  managerCtx.state.planningVue = 'equipe';
  const htmlManager = managerCtx.renderPlanningPostes();
  assert.ok(htmlManager.includes(shiftManager.heureDebut), 'préalable : le quart de test doit apparaître dans le rendu');
  assert.ok(!htmlManager.includes(`data-edit-shift="${shiftManager.id}"`), 'sans MODIFIER_SALARIE, la carte ne doit jamais exposer data-edit-shift (sinon ouvrable en édition malgré l\'absence du droit)');

  console.log('OK — revue-application-22-09.test.js (3. Planning : la carte de quart n\'expose data-edit-shift qu\'avec le droit de modifier)');
}

function runTeletravailAccessibleAvecSeulementLeModulePlanning() {
  const { DB, isViewBlockedForCurrentUser } = setup();
  const company = DB.getCurrentCompany();
  company.abonnement.offre = 'a_la_carte';
  company.abonnement.modules = [{ key: 'planning' }]; // 'conges' volontairement absent
  DB.saveCurrentCompany(company);

  assert.strictEqual(isViewBlockedForCurrentUser('absences'), false, 'un abonnement à la carte n\'ayant souscrit QUE "planning" doit tout de même pouvoir atteindre "Congés & absences" (qui héberge l\'onglet Télétravail, facturé sous cette même clé)');

  // Contrôle négatif : sans NI conges NI planning, l\'écran doit rester bloqué comme avant.
  company.abonnement.modules = [{ key: 'frais' }];
  DB.saveCurrentCompany(company);
  assert.strictEqual(isViewBlockedForCurrentUser('absences'), true, 'sans conges ni planning souscrits, l\'écran doit rester bloqué (comportement inchangé)');

  console.log('OK — revue-application-22-09.test.js (4. Télétravail : accessible avec le seul module "planning", toujours bloqué sans aucun des deux)');
}

async function runTeletravailModifierSansRienChangerNeDepasseJamaisLeQuota() {
  const { DB, findTeleworkWeekOverQuota } = setup();
  const salarie = DB.getEmployees().find(e => e.role === 'salarie');
  salarie.joursTravailles = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'];

  // Lundi 2026-11-02 + mardi 2026-11-03 = 2 jours travaillés, exactement au quota.
  const dateDebut = '2026-11-02', dateFin = '2026-11-03';
  const quota = 2;
  const created = await DB.addTeleworkRequest({ employeeId: salarie.id, dateDebut, dateFin, commentaire: '' });

  // Sans exclusion (bug) : la demande déjà active (2j) + les mêmes dates re-soumises (2j) = 4 > 2.
  const sansExclusion = findTeleworkWeekOverQuota(salarie.id, dateDebut, dateFin, salarie, quota);
  assert.ok(sansExclusion, 'préalable : sans exclusion, un modifier-sans-rien-changer double bien le compte (reproduit le bug)');

  // Avec exclusion (correctif, comme submitTeleworkRequestForm et moveTeleworkRequest le font
  // désormais tous les deux) : la demande en cours de modification ne doit plus compter contre
  // elle-même — un modifier-sans-rien-changer ne doit jamais être rejeté.
  const avecExclusion = findTeleworkWeekOverQuota(salarie.id, dateDebut, dateFin, salarie, quota, created.id);
  assert.strictEqual(avecExclusion, null, 'modifier une demande En attente sans changer ses dates ne doit jamais la faire compter deux fois contre son propre quota');

  console.log('OK — revue-application-22-09.test.js (5. Télétravail : modifier une demande sans rien changer ne double plus son décompte de quota)');
}

async function run() {
  await runPointeuseQuartDeNuit();
  await runPointeuseOublieAncienNonRecupere();
  await runFraisKilometriqueRecalculeALaModification();
  runPlanningCarteDeQuartReserveeAModifierSalarie();
  runTeletravailAccessibleAvecSeulementLeModulePlanning();
  await runTeletravailModifierSansRienChangerNeDepasseJamaisLeQuota();
}

run().catch((err) => {
  console.error('ÉCHEC — revue-application-22-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
