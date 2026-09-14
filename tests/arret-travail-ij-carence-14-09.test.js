/**
 * Seven RH — point 4.1 v2a (chiffrage validé par Betty le 13/09/2026, "on part sur
 * salaireBrutMensuel avec l'avertissement affiché") : carence + IJ sécu approximative + maintien de
 * salaire légal (L1226-1). Couvre les fonctions pures de data.js et l'affichage de l'estimation dans
 * l'attestation de salaire (app.js), toujours accompagnée de l'avertissement "indicatif".
 */
const assert = require('assert');
const { loadDataJs } = require('./load-data-js');
const { loadAppJs } = require('./load-app-js');

async function run() {
  // ---- Carence : 3 jours pour maladie ordinaire, aucune pour AT/trajet/maladie professionnelle ----
  {
    const { calculerJoursCarenceArret } = loadDataJs();
    assert.strictEqual(calculerJoursCarenceArret('maladie'), 3);
    assert.strictEqual(calculerJoursCarenceArret('accidentTravail'), 0);
    assert.strictEqual(calculerJoursCarenceArret('accidentTrajet'), 0);
    assert.strictEqual(calculerJoursCarenceArret('maladieProfessionnelle'), 0);
  }

  // ---- IJ sécu estimée : 50% pour maladie ordinaire, 60% puis 80% après le 28e jour pour AT/MP ----
  {
    const { calculerIJSecuEstimee, calculerSalaireJournalierBase } = loadDataJs();
    const sjb = calculerSalaireJournalierBase(3000); // 3000 * 3 / 91.25
    assert.ok(Math.abs(sjb - 98.63) < 0.5, 'sanity : SJB approximatif cohérent avec la méthode CPAM (3 mois / 91,25)');

    const ijOrdinaire = calculerIJSecuEstimee('maladie', 3000, 10);
    assert.ok(Math.abs(ijOrdinaire - 10 * sjb * 0.5) < 0.01, 'maladie ordinaire : 50% du SJB sur tous les jours indemnisables');

    const ijAtmpCourt = calculerIJSecuEstimee('accidentTravail', 3000, 20);
    assert.ok(Math.abs(ijAtmpCourt - 20 * sjb * 0.6) < 0.01, 'AT/MP sous 28 jours : 60% sur tous les jours');

    const ijAtmpLong = calculerIJSecuEstimee('accidentTravail', 3000, 40);
    const attendu = 28 * sjb * 0.6 + 12 * sjb * 0.8;
    assert.ok(Math.abs(ijAtmpLong - attendu) < 0.01, 'AT/MP au-delà de 28 jours : 60% puis 80%, jamais 80% dès le 1er jour');

    assert.strictEqual(calculerIJSecuEstimee('maladie', 3000, 0), 0, 'aucun jour indemnisable (tout en carence) : IJ nulle');
  }

  // ---- Plafonnement au SMIC : un très haut salaire ne fait pas grimper l'IJ indéfiniment ----
  {
    const { calculerIJSecuEstimee, calculerPlafondSJBIndicatif } = loadDataJs();
    const ijPlafonnee = calculerIJSecuEstimee('maladie', 15000, 10);
    const plafond = calculerPlafondSJBIndicatif();
    assert.ok(Math.abs(ijPlafonnee - 10 * plafond * 0.5) < 0.01, 'un salaire très élevé doit être plafonné, pas calculé sur le SJB brut réel');
  }

  // ---- Cumul 12 mois glissants : un arrêt validé de plus de 12 mois ne compte plus, ni celui d'un
  // autre salarié, ni une demande non validée, ni la demande en cours d'édition elle-même ----
  {
    const { getJoursMaintienDejaConsommes12Mois } = loadDataJs();
    const base = { employeeId: 'e1', arretTravail: { typeArret: 'maladie' }, statut: 'Validé' };
    const requests = [
      { ...base, id: 'r-recent', dateDebut: '2026-06-01', dateFin: '2026-06-10' }, // 10 jours - 3 carence = 7
      { ...base, id: 'r-trop-vieux', dateDebut: '2024-01-01', dateFin: '2024-01-10' }, // > 12 mois avant sept 2026
      { ...base, id: 'r-autre-salarie', employeeId: 'e2', dateDebut: '2026-07-01', dateFin: '2026-07-10' },
      { ...base, id: 'r-non-valide', statut: 'En attente', dateDebut: '2026-07-01', dateFin: '2026-07-10' },
      { ...base, id: 'r-exclue', dateDebut: '2026-08-01', dateFin: '2026-08-10' }
    ];
    const total = getJoursMaintienDejaConsommes12Mois('e1', '2026-09-14', requests, 'r-exclue');
    assert.strictEqual(total, 7, 'seule r-recent doit compter (7 jours indemnisables), les autres cas doivent tous être exclus');
  }

  // ---- Maintien de salaire : ancienneté insuffisante (<1 an) = aucun maintien légal ----
  {
    const { calculerMaintienSalaireEstime } = loadDataJs();
    const m = calculerMaintienSalaireEstime(0, 10, 0, 3000);
    assert.strictEqual(m.ancienneteInsuffisante, true);
    assert.strictEqual(m.montant, 0);
  }

  // ---- Maintien de salaire : répartition plein puis demi-traitement, palier 1-5 ans (30j + 30j) ----
  {
    const { calculerMaintienSalaireEstime } = loadDataJs();
    const m = calculerMaintienSalaireEstime(2, 40, 0, 3000);
    assert.strictEqual(m.joursPlein, 30, 'les 30 premiers jours doivent être à taux plein');
    assert.strictEqual(m.joursDemi, 10, 'le reste (10 jours) doit basculer en demi-traitement');
    assert.strictEqual(m.joursNonCouverts, 0);
    const sjBrutApprox = 3000 * 12 / 365;
    const attendu = Math.round((30 * sjBrutApprox * 0.9 + 10 * sjBrutApprox * 0.6666) * 100) / 100;
    assert.strictEqual(m.montant, attendu);
  }

  // ---- Maintien de salaire : cumul déjà consommé réduit la capacité restante, jusqu'à l'épuiser ----
  {
    const { calculerMaintienSalaireEstime } = loadDataJs();
    // Palier 1-5 ans = 60 jours de capacité totale (30 plein + 30 demi). 55 déjà consommés (au moins
    // le plein est épuisé) : il ne reste que 5 jours de capacité, tous en demi-traitement.
    const m = calculerMaintienSalaireEstime(2, 20, 55, 3000);
    assert.strictEqual(m.joursPlein, 0, 'le taux plein (30j) est déjà entièrement consommé');
    assert.strictEqual(m.joursDemi, 5, 'il ne reste que 5 jours de capacité totale (60-55)');
    assert.strictEqual(m.joursNonCouverts, 15, 'au-delà de la capacité 12 mois glissants, plus aucun maintien');
  }

  console.log('OK — arret-travail-ij-carence-14-09.test.js (fonctions pures : carence, IJ sécu approximative, cumul 12 mois, maintien de salaire légal)');
}

function setMasseSalarialeActivee(DB, active) {
  const company = DB.getCurrentCompany();
  company.settings = Object.assign({}, company.settings, { masseSalarialeActivee: active });
  DB.saveCurrentCompany(company);
}

async function runUi() {
  // ---- Estimation affichée dans l'attestation, avec l'avertissement, quand un salaire existe et
  // que le suivi de la masse salariale est activé ----
  {
    const { DB, sandbox, openAttestationSalaireModal, leaveRepository, employeeRepository } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    setMasseSalarialeActivee(DB, true);
    employeeRepository.update(rh.id, { salaireBrutMensuel: 3000, dateEmbauche: '2020-01-01' });
    const maladieType = DB.getLeaveTypes().find(t => t.nom === 'Maladie');

    const request = await leaveRepository.create({
      employeeId: rh.id, typeId: maladieType.id, dateDebut: '2026-09-01', dateFin: '2026-09-10', nbJours: 10,
      arretTravail: { typeArret: 'maladie', subrogation: false }
    });

    openAttestationSalaireModal(request.id);
    const html = sandbox.document.getElementById('modal-root').innerHTML;
    assert.ok(html.includes('Estimation des indemnités'), 'la section d\'estimation doit apparaître');
    assert.ok(html.includes('Indicatif, non contractuel'), 'l\'avertissement doit toujours être visible, jamais un montant présenté comme garanti');
    assert.ok(html.includes('Carence'), 'le détail de la carence doit être affiché');
    assert.ok(!html.includes('undefined') && !html.includes('NaN'), 'aucune fuite de valeur brute dans le rendu');
  }

  // ---- Sans salaire renseigné : message honnête "non calculable", jamais un plantage ----
  {
    const { DB, sandbox, openAttestationSalaireModal, leaveRepository, employeeRepository } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    setMasseSalarialeActivee(DB, true);
    employeeRepository.update(rh.id, { salaireBrutMensuel: 0 });
    const maladieType = DB.getLeaveTypes().find(t => t.nom === 'Maladie');

    const request = await leaveRepository.create({
      employeeId: rh.id, typeId: maladieType.id, dateDebut: '2026-09-01', dateFin: '2026-09-10', nbJours: 10,
      arretTravail: { typeArret: 'maladie', subrogation: false }
    });

    assert.doesNotThrow(() => openAttestationSalaireModal(request.id));
    const html = sandbox.document.getElementById('modal-root').innerHTML;
    assert.ok(html.includes('Non calculable'), 'doit expliquer pourquoi l\'estimation est absente, jamais silencieux');
  }

  // ---- Suivi de la masse salariale désactivé : la section d'estimation n'apparaît pas du tout ----
  {
    const { DB, sandbox, openAttestationSalaireModal, leaveRepository, employeeRepository } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    setMasseSalarialeActivee(DB, false);
    employeeRepository.update(rh.id, { salaireBrutMensuel: 3000, dateEmbauche: '2020-01-01' });
    const maladieType = DB.getLeaveTypes().find(t => t.nom === 'Maladie');

    const request = await leaveRepository.create({
      employeeId: rh.id, typeId: maladieType.id, dateDebut: '2026-09-01', dateFin: '2026-09-10', nbJours: 10,
      arretTravail: { typeArret: 'maladie', subrogation: false }
    });

    openAttestationSalaireModal(request.id);
    const html = sandbox.document.getElementById('modal-root').innerHTML;
    assert.ok(!html.includes('Estimation des indemnités'), 'jamais d\'estimation si le suivi de la masse salariale est désactivé côté entreprise');
  }

  console.log('OK — arret-travail-ij-carence-14-09.test.js (affichage : estimation avec avertissement, message honnête sans salaire, masquée si masse salariale désactivée)');
}

run().then(runUi).catch((err) => {
  console.error('ÉCHEC — arret-travail-ij-carence-14-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
