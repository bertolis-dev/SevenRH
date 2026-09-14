/**
 * Seven RH — retour Betty du 11/09/2026 : nouveau module payant "Pointeuse QR" — un salarié pointe
 * son arrivée puis son départ en scannant, depuis l'app (caméra), le QR affiché à l'accueil de SON
 * établissement (un par établissement, régénérable). Décisions prises avec Betty avant de commencer
 * (AskUserQuestion) : arrivée ET départ (calcul des heures réellement travaillées), aucun jugement de
 * retard affiché.
 *
 * §retour Betty du 14/09/2026 (revue concurrentielle, Pointeuse QR point 1, "empêcher le pointage à
 * distance") : le QR fixe du 11/09 a été remplacé par un QR qui tourne toutes les 30 secondes (voir
 * pointage-rotation-14-09.test.js pour la couverture dédiée à ce correctif) — ce fichier simule le
 * "serveur" en mémoire pour continuer à couvrir le calcul de durée, l'enchaînement arrivée/départ et
 * les autres comportements déjà couverts avant ce correctif, avec le nouveau mécanisme.
 *
 * Couvre : le calcul de durée travaillée, l'enchaînement arrivée/départ (y compris une pause
 * déjeuner : sortie puis retour le même jour), le module "pointage" (NAV_ITEMS ouvert à tout rôle,
 * LANDING_ALACARTE_MODULES, hasModule), et la confirmation affichée dans la grille de Planning pour
 * aujourd'hui seulement.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

/** Simule le serveur (secret + code dérivé) sans dépendre de la vraie fonction HMAC Postgres, qui ne
 * tourne que côté base — même esprit que les autres mocks de RPC de ce projet (voir
 * pointage-manager-rls-13-09.test.js). */
function mockPointageServer(sandbox) {
  let secret = null;
  sandbox.window.SupabaseSync = new Proxy({
    regeneratePointageTokenRemote: async (etablissementId, token) => { secret = token; },
    getPointageQrCode: async () => { if (secret === null) throw new Error('secret non initialisé'); return `code-${secret}`; },
    verifierPointageCode: async (etablissementId, code) => secret !== null && code === `code-${secret}`,
  }, { get(target, prop) { return prop in target ? target[prop] : async () => ({ success: true }); } });
}

async function run() {
  // ---- computeDureeTravailleeMinutes ----
  {
    const { computeDureeTravailleeMinutes } = loadAppJs();
    assert.strictEqual(computeDureeTravailleeMinutes({ heureArrivee: '09:00', heureDepart: '17:00' }), 480);
    assert.strictEqual(computeDureeTravailleeMinutes({ heureArrivee: '09:00', heureDepart: null }), 0, 'un pointage encore ouvert (pas de départ) ne compte aucune durée');
    assert.strictEqual(computeDureeTravailleeMinutes({ heureArrivee: '17:00', heureDepart: '09:00' }), 0, 'jamais négatif');
  }

  // ---- LANDING_ALACARTE_MODULES / NAV_ITEMS : le module existe et est ouvert à TOUT rôle ----
  {
    const { LANDING_ALACARTE_MODULES, NAV_ITEMS } = loadAppJs();
    const module = LANDING_ALACARTE_MODULES.find(m => m.key === 'pointage');
    assert.ok(module, 'le module "pointage" doit exister dans le catalogue à la carte');
    assert.ok(module.prix > 0);

    const navItem = NAV_ITEMS.find(i => i.key === 'pointeuse');
    assert.ok(navItem, 'l\'entrée de menu "Pointeuse" doit exister');
    assert.strictEqual(navItem.module, 'pointage');
    ['salarie', 'manager', 'rh', 'comptabilite', 'proprietaire'].forEach(role => {
      assert.ok(navItem.roles.includes(role), `"Pointeuse" doit être accessible au rôle ${role} (chacun pointe pour soi-même)`);
    });
  }

  // ---- Code du QR : validation + régénération invalide l'ancien secret ----
  {
    const { DB, sandbox, etablissementRepository, pointageRepository } = loadAppJs();
    mockPointageServer(sandbox);
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const etab = etablissementRepository.getAll()[0];

    await etablissementRepository.regenererPointageToken(etab.id);
    const code1 = await sandbox.window.SupabaseSync.getPointageQrCode(etab.id);
    assert.ok(code1);

    const echecMauvaisCode = await pointageRepository.enregistrer(rh.id, etab.id, 'code-invente');
    assert.strictEqual(echecMauvaisCode.success, false, 'un code qui ne correspond pas doit être refusé');

    const arrivee = await pointageRepository.enregistrer(rh.id, etab.id, code1);
    assert.strictEqual(arrivee.success, true);
    assert.strictEqual(arrivee.type, 'arrivee');

    // Régénérer le secret invalide l'ANCIEN code, même pour un pointage déjà ouvert avec lui.
    await etablissementRepository.regenererPointageToken(etab.id);
    const code2 = await sandbox.window.SupabaseSync.getPointageQrCode(etab.id);
    assert.notStrictEqual(code1, code2);
    const echecAncienCode = await pointageRepository.enregistrer(rh.id, etab.id, code1);
    assert.strictEqual(echecAncienCode.success, false, 'l\'ancien code doit être rejeté après régénération du secret');
  }

  // ---- Réseau indisponible au moment du scan : un pointage ne peut plus être validé (plus de
  // secret côté client sur lequel se replier, voir pointage-rotation-14-09.test.js) ----
  {
    const { DB, sandbox, etablissementRepository, pointageRepository } = loadAppJs();
    mockPointageServer(sandbox);
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const etab = etablissementRepository.getAll()[0];
    await etablissementRepository.regenererPointageToken(etab.id);
    const code = await sandbox.window.SupabaseSync.getPointageQrCode(etab.id);

    sandbox.window.SupabaseSync = new Proxy({
      verifierPointageCode: async () => { throw new Error('réseau indisponible'); },
    }, { get(target, prop) { return prop in target ? target[prop] : async () => ({ success: true }); } });

    const resultat = await pointageRepository.enregistrer(rh.id, etab.id, code);
    assert.strictEqual(resultat.success, false, 'sans connexion au serveur, un pointage ne doit jamais être accepté par défaut');
  }

  // ---- Enchaînement arrivée/départ, y compris une pause déjeuner (sortie puis retour) ----
  {
    const { DB, sandbox, etablissementRepository, pointageRepository } = loadAppJs();
    mockPointageServer(sandbox);
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const etab = etablissementRepository.getAll()[0];
    await etablissementRepository.regenererPointageToken(etab.id);
    const code = await sandbox.window.SupabaseSync.getPointageQrCode(etab.id);

    const r1 = await pointageRepository.enregistrer(rh.id, etab.id, code);
    assert.strictEqual(r1.type, 'arrivee');
    const r2 = await pointageRepository.enregistrer(rh.id, etab.id, code);
    assert.strictEqual(r2.type, 'depart', 'le deuxième scan de la journée doit fermer le pointage ouvert (départ)');
    assert.ok(typeof r2.dureeMinutes === 'number');

    // Pause déjeuner : un troisième scan le même jour rouvre un NOUVEAU pointage (arrivée), pas une
    // erreur — le précédent est déjà fermé.
    const r3 = await pointageRepository.enregistrer(rh.id, etab.id, code);
    assert.strictEqual(r3.type, 'arrivee', 'un scan après un départ déjà enregistré doit ouvrir un nouveau pointage (retour de pause)');
    const r4 = await pointageRepository.enregistrer(rh.id, etab.id, code);
    assert.strictEqual(r4.type, 'depart');

    const today = new Date().toISOString().slice(0, 10);
    const pointagesDuJour = pointageRepository.getForEmployeeOnDate(rh.id, today);
    assert.strictEqual(pointagesDuJour.length, 2, 'deux pointages fermés distincts le même jour (avant/après la pause)');
    assert.ok(pointagesDuJour.every(p => p.heureArrivee && p.heureDepart));
  }

  // ---- renderPlanningPostes : confirmation "Pointé HH:MM" pour AUJOURD'HUI seulement ----
  {
    const { DB, sandbox, etablissementRepository, pointageRepository, renderPlanningPostes, state } = loadAppJs();
    mockPointageServer(sandbox);
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const employee = DB.getEmployees().find(e => e.id !== rh.id);
    const etab = etablissementRepository.getAll()[0];

    // Module non souscrit (offre classique par défaut, pas de "modules" à la carte) : aucune
    // confirmation ne doit apparaître, même si un pointage existe (hasModule('pointage') doit être
    // vérifié explicitement par renderPlanningPostes, pas seulement l'existence de la donnée).
    const company = DB.getCurrentCompany();
    company.abonnement.offre = 'a_la_carte';
    company.abonnement.modules = [{ key: 'planning' }];
    DB.saveCurrentCompany(company);
    await etablissementRepository.regenererPointageToken(etab.id);
    const codeSansModule = await sandbox.window.SupabaseSync.getPointageQrCode(etab.id);
    await pointageRepository.enregistrer(employee.id, etab.id, codeSansModule);
    state.planningVue = 'equipe';
    const htmlSansModule = renderPlanningPostes();
    assert.ok(!htmlSansModule.includes('poste-shift-pointage'), 'sans le module "pointage" souscrit, aucune confirmation ne doit apparaître');

    // Module souscrit : la confirmation doit apparaître pour le pointage du jour.
    company.abonnement.modules = [{ key: 'planning' }, { key: 'pointage' }];
    DB.saveCurrentCompany(company);
    const htmlAvecModule = renderPlanningPostes();
    assert.ok(htmlAvecModule.includes('poste-shift-pointage'), 'avec le module souscrit, la confirmation du pointage du jour doit apparaître');
  }

  // ---- renderPointeuse : bouton "QR de pointage" pour manager/propriétaire ("directeur") ----
  // §retour Betty du 11/09/2026 ("pour le directeur et les manageurs un bouton qr code pointeur") :
  // jusqu'ici, afficher/régénérer ce QR n'était possible que depuis Paramètres > Établissements
  // (RH/Propriétaire uniquement) — un manager n'a pas du tout accès à Paramètres.
  {
    const { DB, sandbox, renderPointeuse } = loadAppJs();
    mockPointageServer(sandbox);
    DB.init();

    const manager = DB.getEmployees().find(e => e.role === 'manager');
    DB._currentEmployeeId = manager.id;
    const htmlManager = renderPointeuse();
    assert.ok(htmlManager.includes('data-pointage-qr-etablissement'), 'un manager doit voir un bouton pour afficher le QR de pointage');

    const proprietaire = DB.getEmployees().find(e => e.role === 'proprietaire');
    DB._currentEmployeeId = proprietaire.id;
    const htmlProprietaire = renderPointeuse();
    assert.ok(htmlProprietaire.includes('data-pointage-qr-etablissement'), 'le propriétaire ("directeur") doit aussi voir ce bouton');

    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    DB._currentEmployeeId = salarie.id;
    const htmlSalarie = renderPointeuse();
    assert.ok(!htmlSalarie.includes('data-pointage-qr-etablissement'), 'un simple salarié ne doit pas voir ce bouton (pas demandé par Betty)');
  }

  // ---- Modale du QR : bouton Régénérer/Fermer présents, plus de Partager/Imprimer (§14/09/2026) ----
  {
    const { DB, sandbox, etablissementRepository, openPointageQrModal } = loadAppJs();
    mockPointageServer(sandbox);
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const etab = etablissementRepository.getAll()[0];

    await openPointageQrModal(etab.id);
    const modalHtml = sandbox.document.getElementById('modal-root').innerHTML;
    assert.ok(modalHtml.includes('btn-regenerer-pointage-qr'), 'la modale doit garder son bouton "Régénérer"');
    assert.ok(!modalHtml.includes('btn-partager-pointage-qr'), 'le bouton "Partager" a disparu : un QR qui tourne toutes les 30s ne peut plus être partagé comme une image figée');
    assert.ok(!modalHtml.includes('btn-imprimer-pointage-qr'), 'le bouton "Imprimer" a disparu : un tirage papier serait mort en moins d\'une minute');
    assert.ok(modalHtml.includes('class="print-area"'), 'le QR reste dans .print-area (structure conservée, même si l\'impression n\'a plus de sens fonctionnel)');
  }

  console.log('OK — pointage-11-09.test.js (durée travaillée, code du QR + régénération, arrivée/départ avec pause déjeuner, confirmation dans Planning gated par module, QR accessible aux managers/propriétaire)');
}

run().catch((err) => {
  console.error('ÉCHEC — pointage-11-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
