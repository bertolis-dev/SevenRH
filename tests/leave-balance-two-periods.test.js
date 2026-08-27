/**
 * Seven RH — teste le point 1 (retour QA du 27/08/2026, "les compteurs affichent 5 jours à
 * quelqu'un qui en a 30") : le droit du travail français distingue deux compteurs vivants en même
 * temps — ce qui a été acquis sur la période CLOSE (immédiatement consommable, "disponible") et ce
 * qui s'acquiert sur la période EN COURS (jamais consommable avant sa propre clôture). Avant ce
 * correctif, getLeaveBalance ne connaissait que la période contenant refDate et remettait tout à
 * zéro au passage d'une clôture (report à 'aucun' par défaut).
 *
 * Couvre aussi un second bug trouvé en corrigeant celui-ci : countFullMonthsElapsed (data.js)
 * sous-comptait TOUJOURS d'un mois une période pile de 12 mois calendaires (27,5 jours au lieu de 30).
 */
const assert = require('assert');
const { loadDataJs } = require('./load-data-js');

function cp(overrides) {
  return {
    id: 'lt-cp', nom: 'Congés payés', categorie: 'conge', acquisition: 'Mensuelle', nombreAnnuel: 30,
    dateClotureCompteur: '05-31', reportCompteur: 'aucun', reportLimiteJours: null, dateLimiteReportMMJJ: null,
    fractionnementActif: false, proratisationTempsPartiel: 'aucune', paliersAnciennete: [],
    compteurPartageAvecId: null, deduireRTT: false, deduireCP: false, uniteDecompte: 'ouvres',
    ...overrides,
  };
}

function req(overrides) {
  return { id: 'r-' + Math.random().toString(36).slice(2), employeeId: 'emp-1', typeId: 'lt-cp', statut: 'Validé', ...overrides };
}

function run() {
  const { sandbox, DB, getLeaveBalance } = loadDataJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const employee = { id: 'emp-1', dateEmbauche: '2015-01-01', pourcentageActivite: 100, compteurs: {} };
  const refDate = '2026-08-27'; // date de la lettre

  // ---- Reproduction EXACTE du cas signalé : temps plein, embauché 2015, aucun congé posé ----
  {
    const type = cp();
    const balance = getLeaveBalance(employee, type, [], [type], refDate);
    assert.strictEqual(balance.disponible, 30, 'disponible doit être 30 (période close 01/06/2025-31/05/2026 entière), pas 5');
    assert.strictEqual(balance.acquis, 30);
    assert.strictEqual(balance.pris, 0);
    assert.strictEqual(balance.enAttente, 0);
    // (assertions champ par champ, pas deepStrictEqual : ces objets sont construits DANS le contexte
    // vm, "non référentiellement égaux" à un littéral de ce fichier même à structure identique.)
    assert.strictEqual(balance.periodeDisponible.debut, '2025-06-01', 'la période affichée à côté du solde disponible doit être écrite noir sur blanc');
    assert.strictEqual(balance.periodeDisponible.fin, '2026-05-31');
    assert.strictEqual(balance.enCoursAcquisition.periode.debut, '2026-06-01');
    assert.strictEqual(balance.enCoursAcquisition.periode.fin, '2027-05-31');
    // juin + juillet entièrement écoulés au 27 août, août encore en cours : 2 mois × 2,5 = 5.
    assert.strictEqual(balance.enCoursAcquisition.acquis, 5, 'la période en cours affiche ce qui a été acquis jusqu\'ici, jamais mélangé au disponible');
  }

  // ---- Une demande posée CETTE ANNÉE (dans la fenêtre "en cours") doit réduire le DISPONIBLE
  //      (elle consomme ce qui a été acquis l'an dernier), jamais la période en cours d'acquisition ----
  {
    const type = cp();
    const requests = [req({ dateDebut: '2026-08-10', dateFin: '2026-08-14', nbJours: 5 })];
    const balance = getLeaveBalance(employee, type, requests, [type], refDate);
    assert.strictEqual(balance.disponible, 25, '30 acquis l\'an dernier - 5 pris cette année = 25');
    assert.strictEqual(balance.pris, 5);
    assert.strictEqual(balance.enCoursAcquisition.acquis, 5, 'la demande posée ne doit jamais réduire ce qui est affiché comme "en cours d\'acquisition"');
  }

  // ---- Une demande posée PENDANT que la période "disponible" était encore en cours d'acquisition
  //      (ex. mars 2026, avant la clôture du 31 mai) doit AUSSI réduire le disponible ----
  {
    const type = cp();
    const requests = [req({ dateDebut: '2026-03-02', dateFin: '2026-03-06', nbJours: 5 })];
    const balance = getLeaveBalance(employee, type, requests, [type], refDate);
    assert.strictEqual(balance.disponible, 25, 'une demande posée pendant l\'acquisition de cette période doit aussi la réduire, pas seulement une demande posée après sa clôture');
  }

  // ---- reportCompteur: 'illimite' — le report N'EST PLUS entre "en cours" et "précédente" (devenu
  //      inconditionnel), il s'applique désormais un cran plus loin : entre "précédente" et
  //      "encore avant". Embauché il y a longtemps, aucune demande jamais posée : le solde doit
  //      s'accumuler sur PLUSIEURS années, pas rester plafonné à une seule période. ----
  {
    const type = cp({ reportCompteur: 'illimite' });
    const balance = getLeaveBalance(employee, type, [], [type], refDate);
    assert.strictEqual(balance.disponible, 60, 'avec un report illimité et jamais aucun congé posé, le solde doit cumuler AU MOINS deux périodes complètes (30 + 30), pas rester bloqué à 30');
  }

  // ---- reportCompteur: 'limite' avec plafond — doit plafonner le report entrant dans "précédente"
  //      depuis "encore avant", pas empêcher "précédente" d'exister ----
  {
    const type = cp({ reportCompteur: 'limite', reportLimiteJours: 5 });
    const balance = getLeaveBalance(employee, type, [], [type], refDate);
    assert.strictEqual(balance.disponible, 35, '30 (période précédente, jamais plafonnée elle-même) + 5 (report plafonné depuis encore avant) = 35');
    assert.strictEqual(balance.report, 5);
  }

  // ---- Échéance de report (§7.15) dépassée — doit s'appliquer à la frontière décalée ----
  {
    const type = cp({ reportCompteur: 'illimite', dateLimiteReportMMJJ: '06-30' }); // échéance : 30 juin dans "précédente" (01/06/2025-31/05/2026)... doit tomber dans previous, pas current
    const balance = getLeaveBalance(employee, type, [], [type], refDate);
    // L'échéance (30 juin) doit être résolue DANS la période "précédente" (01/06/2025-31/05/2026) —
    // le 30 juin 2025 est déjà passé au 27/08/2026, donc le report (30 jours venant d'encore avant)
    // est perdu s'il n'a pas été consommé avant cette date : disponible = 30 (période précédente
    // seule, report de 30 perdu faute d'avoir été pris avant le 30/06/2025).
    assert.strictEqual(balance.reportPerdu, 30, 'le report doit expirer selon l\'échéance résolue dans la période PRÉCÉDENTE, pas la période en cours');
    assert.strictEqual(balance.disponible, 30);
  }

  // ---- Fractionnement (§7.17) — doit se calculer sur "encore avant" et se créditer sur "précédente" ----
  {
    const type = cp({ fractionnementActif: true });
    // 6 jours pris hors fenêtre légale (1er mai-31 octobre) PENDANT previous2 (01/06/2024-31/05/2025)
    // -> +2 jours de fractionnement crédités sur "précédente" (01/06/2025-31/05/2026).
    const requests = [req({ dateDebut: '2024-12-02', dateFin: '2024-12-09', nbJours: 6 })];
    const balance = getLeaveBalance(employee, type, requests, [type], refDate);
    assert.strictEqual(balance.fractionnement, 2, 'le fractionnement doit se calculer sur la période encore-avant, pas sur la période disponible elle-même');
    assert.strictEqual(balance.disponible, 32, '30 (précédente) + 2 (fractionnement gagné sur encore-avant) = 32');
  }

  // ---- Salarié embauché EN COURS de la période "précédente" : prorata toujours actif, juste décalé ----
  {
    const employeeRecent = { id: 'emp-2', dateEmbauche: '2025-12-01', pourcentageActivite: 100, compteurs: {} };
    const type = cp();
    const balance = getLeaveBalance(employeeRecent, type, [], [type], refDate);
    assert.ok(balance.disponible > 0 && balance.disponible < 30,
      'un salarié embauché en cours de la période précédente doit avoir un disponible prorata, ni 0 ni 30 plein');
  }

  // ---- RTT (sans dateClotureCompteur) : comportement à une seule période, strictement inchangé ----
  {
    const rtt = { id: 'lt-rtt', nom: 'RTT', categorie: 'conge', acquisition: 'Mensuelle', nombreAnnuel: 12, proratisationTempsPartiel: 'exclu' };
    const balance = getLeaveBalance(employee, rtt, [], [rtt], refDate);
    assert.strictEqual(balance.periodeDisponible, undefined, 'un type sans dateClotureCompteur ne doit jamais avoir de champ periodeDisponible (comportement à une période, inchangé)');
    assert.strictEqual(balance.enCoursAcquisition, undefined);
  }

  console.log('OK — leave-balance-two-periods.test.js (période disponible vs en cours, report/échéance/fractionnement décalés, prorata embauche, RTT inchangé)');
}

try {
  run();
} catch (err) {
  console.error('ÉCHEC — leave-balance-two-periods.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
