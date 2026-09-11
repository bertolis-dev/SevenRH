/**
 * Seven RH — retour Betty du 11/09/2026 : nouveau module payant "Pointeuse QR" — un salarié pointe
 * son arrivée puis son départ en scannant, depuis l'app (caméra), le QR FIXE affiché à l'accueil de
 * SON établissement (un par établissement, régénérable). Décisions prises avec Betty avant de
 * commencer (AskUserQuestion) : QR fixe (pas de rotation automatique), arrivée ET départ (calcul des
 * heures réellement travaillées), aucun jugement de retard affiché.
 *
 * Couvre : le calcul de durée travaillée, l'enchaînement arrivée/départ (y compris une pause
 * déjeuner : sortie puis retour le même jour), la validation du jeton du QR (et sa régénération qui
 * invalide l'ancien), le module "pointage" (NAV_ITEMS ouvert à tout rôle, LANDING_ALACARTE_MODULES,
 * hasModule), et la confirmation affichée dans la grille de Planning pour aujourd'hui seulement.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

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

  // ---- Jeton du QR : validation + régénération invalide l'ancien ----
  {
    const { DB, sandbox, etablissementRepository, pointageRepository } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const etab = etablissementRepository.getAll()[0];
    assert.strictEqual(etab.pointageToken, null, 'aucun jeton tant que le QR n\'a jamais été généré');

    const token1 = etablissementRepository.regenererPointageToken(etab.id);
    assert.ok(token1);
    assert.strictEqual(etablissementRepository.getById(etab.id).pointageToken, token1);

    const echecMauvaisJeton = pointageRepository.enregistrer(rh.id, etab.id, 'jeton-invente');
    assert.strictEqual(echecMauvaisJeton.success, false, 'un jeton qui ne correspond pas doit être refusé');

    const arrivee = pointageRepository.enregistrer(rh.id, etab.id, token1);
    assert.strictEqual(arrivee.success, true);
    assert.strictEqual(arrivee.type, 'arrivee');

    // Régénérer le QR invalide l'ANCIEN jeton, même pour un pointage déjà ouvert avec lui.
    const token2 = etablissementRepository.regenererPointageToken(etab.id);
    assert.notStrictEqual(token1, token2);
    const echecAncienJeton = pointageRepository.enregistrer(rh.id, etab.id, token1);
    assert.strictEqual(echecAncienJeton.success, false, 'l\'ancien jeton doit être rejeté après régénération');
  }

  // ---- Enchaînement arrivée/départ, y compris une pause déjeuner (sortie puis retour) ----
  {
    const { DB, sandbox, etablissementRepository, pointageRepository } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const etab = etablissementRepository.getAll()[0];
    const token = etablissementRepository.regenererPointageToken(etab.id);

    const r1 = pointageRepository.enregistrer(rh.id, etab.id, token);
    assert.strictEqual(r1.type, 'arrivee');
    const r2 = pointageRepository.enregistrer(rh.id, etab.id, token);
    assert.strictEqual(r2.type, 'depart', 'le deuxième scan de la journée doit fermer le pointage ouvert (départ)');
    assert.ok(typeof r2.dureeMinutes === 'number');

    // Pause déjeuner : un troisième scan le même jour rouvre un NOUVEAU pointage (arrivée), pas une
    // erreur — le précédent est déjà fermé.
    const r3 = pointageRepository.enregistrer(rh.id, etab.id, token);
    assert.strictEqual(r3.type, 'arrivee', 'un scan après un départ déjà enregistré doit ouvrir un nouveau pointage (retour de pause)');
    const r4 = pointageRepository.enregistrer(rh.id, etab.id, token);
    assert.strictEqual(r4.type, 'depart');

    const today = new Date().toISOString().slice(0, 10);
    const pointagesDuJour = pointageRepository.getForEmployeeOnDate(rh.id, today);
    assert.strictEqual(pointagesDuJour.length, 2, 'deux pointages fermés distincts le même jour (avant/après la pause)');
    assert.ok(pointagesDuJour.every(p => p.heureArrivee && p.heureDepart));
  }

  // ---- renderPlanningPostes : confirmation "Pointé HH:MM" pour AUJOURD'HUI seulement ----
  {
    const { DB, sandbox, etablissementRepository, pointageRepository, renderPlanningPostes, state } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
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
    etablissementRepository.regenererPointageToken(etab.id);
    const tokenSansModule = etablissementRepository.getById(etab.id).pointageToken;
    pointageRepository.enregistrer(employee.id, etab.id, tokenSansModule);
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
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
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

  // ---- Modale du QR : boutons Régénérer/Partager/Imprimer/Fermer présents ----
  // §retour Betty du 11/09/2026 ("un bouton pour partager et imprimer le qr code").
  {
    const { DB, sandbox, etablissementRepository, openPointageQrModal } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const etab = etablissementRepository.getAll()[0];

    openPointageQrModal(etab.id);
    const modalHtml = sandbox.document.getElementById('modal-root').innerHTML;
    assert.ok(modalHtml.includes('btn-partager-pointage-qr'), 'la modale doit avoir un bouton "Partager"');
    assert.ok(modalHtml.includes('btn-imprimer-pointage-qr'), 'la modale doit avoir un bouton "Imprimer"');
    assert.ok(modalHtml.includes('btn-regenerer-pointage-qr'), 'la modale doit garder son bouton "Régénérer"');
    assert.ok(modalHtml.includes('class="print-area"'), 'le QR doit être dans .print-area (isolé à l\'impression, voir style.css)');
  }

  console.log('OK — pointage-11-09.test.js (durée travaillée, jeton du QR + régénération, arrivée/départ avec pause déjeuner, confirmation dans Planning gated par module, QR accessible aux managers/propriétaire, boutons Partager/Imprimer)');
}

run().catch((err) => {
  console.error('ÉCHEC — pointage-11-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
