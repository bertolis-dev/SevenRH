/**
 * Seven RH — teste le point 7.16 (retour QA du 25/08/2026, confirmé par l'expert-comptable le
 * 27/08/2026 : "ça dépend des congés, il faut pouvoir le changer") : jusqu'ici l'acquisition ne
 * dépendait QUE du temps écoulé depuis l'embauche — un salarié en congé sabbatique ou parental de 6
 * mois continuait d'acquérir des CP comme s'il travaillait. leaveType.suspendAcquisitionAutresCompteurs
 * (coché type par type, JAMAIS par défaut — aucune liste "ceci oui/cela non" n'a été fournie) suspend
 * l'acquisition des AUTRES compteurs pendant une absence validée de ce type.
 */
const assert = require('assert');
const { loadDataJs } = require('./load-data-js');

function run() {
  const { calculateAcquisition, makeEmptyLeaveType } = loadDataJs();

  const cp = Object.assign(makeEmptyLeaveType(), { id: 'lt-cp', nom: 'Congés payés', acquisition: 'Mensuelle', nombreAnnuel: 30, proratisationTempsPartiel: 'aucune' });
  const sansSolde = Object.assign(makeEmptyLeaveType(), { id: 'lt-ss', nom: 'Sans solde', acquisition: 'Illimitée', suspendAcquisitionAutresCompteurs: true });
  const maladie = Object.assign(makeEmptyLeaveType(), { id: 'lt-maladie', nom: 'Maladie', acquisition: 'Illimitée', suspendAcquisitionAutresCompteurs: false });
  const allLeaveTypes = [cp, sansSolde, maladie];
  const employee = { id: 'emp-1', dateEmbauche: '2020-01-01', pourcentageActivite: 100 };
  const refDate = '2026-12-31';

  // ---- Sans allRequests/allLeaveTypes (ancienne signature à 4 arguments) : comportement strictement
  //      inchangé, même si le type "Sans solde" a le nouveau champ à true quelque part ailleurs ----
  {
    const sansContexte = calculateAcquisition(employee, cp, refDate);
    const avecContexteVide = calculateAcquisition(employee, cp, refDate, undefined, [], allLeaveTypes);
    assert.strictEqual(sansContexte, avecContexteVide, 'aucune absence validée dans le contexte : résultat identique à l\'appel sans contexte du tout');
  }

  // ---- Une absence validée d'un type marqué suspend réduit l'acquisition CP proportionnellement ----
  {
    // 3 mois (environ 90 jours) de "Sans solde" validé sur l'année, du 1er avril au 30 juin.
    const requests = [
      { id: 'r1', employeeId: 'emp-1', typeId: 'lt-ss', statut: 'Validé', dateDebut: '2026-04-01', dateFin: '2026-06-30' }
    ];
    const sansSuspension = calculateAcquisition(employee, cp, refDate);
    const avecSuspension = calculateAcquisition(employee, cp, refDate, undefined, requests, allLeaveTypes);
    assert.ok(avecSuspension < sansSuspension, 'une absence "Sans solde" validée (suspendAcquisitionAutresCompteurs) doit réduire l\'acquisition CP');
    assert.ok(avecSuspension > 0, 'une suspension partielle (3 mois sur 12) ne doit jamais ramener l\'acquisition à 0');
  }

  // ---- Une absence validée d'un type NON marqué (ex. Maladie, suspendAcquisitionAutresCompteurs:false)
  //      n'a AUCUN effet — comportement historique préservé pour tout type non explicitement coché ----
  {
    const requestsMaladie = [
      { id: 'r2', employeeId: 'emp-1', typeId: 'lt-maladie', statut: 'Validé', dateDebut: '2026-04-01', dateFin: '2026-06-30' }
    ];
    const sansContexte = calculateAcquisition(employee, cp, refDate);
    const avecMaladie = calculateAcquisition(employee, cp, refDate, undefined, requestsMaladie, allLeaveTypes);
    assert.strictEqual(avecMaladie, sansContexte, 'un type non marqué (ex. Maladie, décoché par défaut) ne doit jamais suspendre l\'acquisition d\'un autre compteur');
  }

  // ---- Une demande NON validée (en attente ou refusée) ne suspend jamais, même d'un type marqué ----
  {
    const requestsEnAttente = [
      { id: 'r3', employeeId: 'emp-1', typeId: 'lt-ss', statut: 'En attente', dateDebut: '2026-04-01', dateFin: '2026-06-30' }
    ];
    const requestsRefusee = [
      { id: 'r4', employeeId: 'emp-1', typeId: 'lt-ss', statut: 'Refusé', dateDebut: '2026-04-01', dateFin: '2026-06-30' }
    ];
    const sansContexte = calculateAcquisition(employee, cp, refDate);
    assert.strictEqual(calculateAcquisition(employee, cp, refDate, undefined, requestsEnAttente, allLeaveTypes), sansContexte,
      'une demande encore en attente ne doit jamais suspendre l\'acquisition avant validation');
    assert.strictEqual(calculateAcquisition(employee, cp, refDate, undefined, requestsRefusee, allLeaveTypes), sansContexte,
      'une demande refusée ne doit jamais suspendre l\'acquisition');
  }

  // ---- Une absence d'un AUTRE salarié n'affecte jamais le calcul de celui-ci ----
  {
    const requestsAutreSalarie = [
      { id: 'r5', employeeId: 'emp-AUTRE', typeId: 'lt-ss', statut: 'Validé', dateDebut: '2026-04-01', dateFin: '2026-06-30' }
    ];
    const sansContexte = calculateAcquisition(employee, cp, refDate);
    assert.strictEqual(calculateAcquisition(employee, cp, refDate, undefined, requestsAutreSalarie, allLeaveTypes), sansContexte);
  }

  // ---- Une absence validée toute l'année (12 mois) ramène l'acquisition à 0, jamais en négatif ----
  {
    const requestsAnneeComplete = [
      { id: 'r6', employeeId: 'emp-1', typeId: 'lt-ss', statut: 'Validé', dateDebut: '2026-01-01', dateFin: '2026-12-31' }
    ];
    const acquis = calculateAcquisition(employee, cp, refDate, undefined, requestsAnneeComplete, allLeaveTypes);
    assert.strictEqual(acquis, 0, 'une suspension couvrant toute la période doit ramener l\'acquisition à 0, jamais en dessous');
  }

  console.log('OK — suspension-acquisition.test.js (suspension par type, jamais par défaut, demandes non validées ignorées, autre salarié isolé)');
}

try {
  run();
} catch (err) {
  console.error('ÉCHEC — suspension-acquisition.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
