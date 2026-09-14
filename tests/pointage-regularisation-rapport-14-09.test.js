/**
 * Seven RH — retour Betty du 14/09/2026 (revue concurrentielle, Pointeuse QR points 2, 4, 5) :
 * régularisation par le manager (oubli de pointage, correction d'une heure fausse), rapport mensuel
 * validé ou contesté par le salarié, écarts (retard/dépassement/oubli) comparés au planning.
 */
const assert = require('assert');
const { loadDataJs } = require('./load-data-js');
const { loadAppJs } = require('./load-app-js');

async function runPures() {
  // ---- Aucun quart prévu ce jour-là : jamais de faux écart ----
  {
    const { calculerEcartsPointageJour } = loadDataJs();
    const ecarts = calculerEcartsPointageJour('e1', '2026-09-14', 'Lun', [], []);
    assert.strictEqual(ecarts.length, 0);
  }

  // ---- Quart prévu, aucun pointage : oubli ----
  {
    const { calculerEcartsPointageJour } = loadDataJs();
    const shifts = [{ employeeId: 'e1', weekday: 'Lun', heureDebut: '09:00', heureFin: '17:00' }];
    const ecarts = calculerEcartsPointageJour('e1', '2026-09-14', 'Lun', shifts, []);
    assert.strictEqual(ecarts.length, 1);
    assert.strictEqual(ecarts[0].type, 'oubli');
  }

  // ---- Retard au-delà de la tolérance ----
  {
    const { calculerEcartsPointageJour } = loadDataJs();
    const shifts = [{ employeeId: 'e1', weekday: 'Lun', heureDebut: '09:00', heureFin: '17:00' }];
    const pointages = [{ heureArrivee: '09:25', heureDepart: '17:00' }];
    const ecarts = calculerEcartsPointageJour('e1', '2026-09-14', 'Lun', shifts, pointages, 10);
    assert.ok(ecarts.some(e => e.type === 'retard'), '25 minutes de retard avec une tolérance de 10 min doit être signalé');
  }

  // ---- Un léger décalage dans la tolérance : jamais signalé (éviter le bruit) ----
  {
    const { calculerEcartsPointageJour } = loadDataJs();
    const shifts = [{ employeeId: 'e1', weekday: 'Lun', heureDebut: '09:00', heureFin: '17:00' }];
    const pointages = [{ heureArrivee: '09:05', heureDepart: '17:03' }];
    const ecarts = calculerEcartsPointageJour('e1', '2026-09-14', 'Lun', shifts, pointages, 10);
    assert.strictEqual(ecarts.length, 0, '5 minutes de décalage sous la tolérance de 10 min ne doit jamais être signalé');
  }

  // ---- Dépassement en fin de journée ----
  {
    const { calculerEcartsPointageJour } = loadDataJs();
    const shifts = [{ employeeId: 'e1', weekday: 'Lun', heureDebut: '09:00', heureFin: '17:00' }];
    const pointages = [{ heureArrivee: '09:00', heureDepart: '18:15' }];
    const ecarts = calculerEcartsPointageJour('e1', '2026-09-14', 'Lun', shifts, pointages, 10);
    assert.ok(ecarts.some(e => e.type === 'depassement'), '1h15 de dépassement doit être signalé');
  }

  // ---- Pointage encore ouvert (pas de départ) : pas de faux dépassement tant que la journée n'est pas finie ----
  {
    const { calculerEcartsPointageJour } = loadDataJs();
    const shifts = [{ employeeId: 'e1', weekday: 'Lun', heureDebut: '09:00', heureFin: '17:00' }];
    const pointages = [{ heureArrivee: '09:00', heureDepart: null }];
    const ecarts = calculerEcartsPointageJour('e1', '2026-09-14', 'Lun', shifts, pointages, 10);
    assert.ok(!ecarts.some(e => e.type === 'depassement'), 'un pointage encore ouvert ne doit jamais être jugé en dépassement');
  }

  console.log('OK — pointage-regularisation-rapport-14-09.test.js (écarts : oubli, retard, dépassement, tolérance respectée, pointage ouvert non jugé)');
}

async function runRegularisation() {
  // ---- Régularisation d'un pointage existant : motif obligatoire, trace conservée ----
  {
    const { DB, sandbox, pointageRepository, etablissementRepository } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    const manager = DB.getEmployees().find(e => e.role === 'manager');
    const etab = etablissementRepository.getAll()[0];
    const list = DB.getPointages();
    list.push({ id: 'p1', employeeId: salarie.id, etablissementId: etab.id, date: '2026-09-10', heureArrivee: '09:15', heureDepart: '17:00' });
    DB.savePointages(list);

    const echecSansMotif = pointageRepository.regulariser('p1', { heureArrivee: '09:00' }, '', manager.id);
    assert.strictEqual(echecSansMotif.success, false, 'un motif est obligatoire pour régulariser');

    const result = pointageRepository.regulariser('p1', { heureArrivee: '09:00' }, 'oubli de badger à l\'heure', manager.id);
    assert.strictEqual(result.success, true);
    const pointageApres = pointageRepository.getAll().find(p => p.id === 'p1');
    assert.strictEqual(pointageApres.heureArrivee, '09:00');
    assert.ok(pointageApres.regularisation, 'la régularisation doit laisser une trace (auteur, motif, valeur avant correction)');
    assert.strictEqual(pointageApres.regularisation.avant.heureArrivee, '09:15', 'la valeur AVANT correction doit être conservée');
  }

  // ---- Ajout d'un pointage totalement oublié ----
  {
    const { DB, sandbox, pointageRepository, etablissementRepository } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    const manager = DB.getEmployees().find(e => e.role === 'manager');
    const etab = etablissementRepository.getAll()[0];
    assert.strictEqual(pointageRepository.getForEmployeeOnDate(salarie.id, '2026-09-11').length, 0);
    const result = pointageRepository.ajouterOublie(salarie.id, etab.id, '2026-09-11', '09:00', '17:00', 'oubli total', manager.id);
    assert.strictEqual(result.success, true);
    assert.strictEqual(pointageRepository.getForEmployeeOnDate(salarie.id, '2026-09-11').length, 1);
  }

  // ---- Bouton "Régulariser" réservé à manager/rh/propriétaire ----
  {
    const { DB, sandbox, canRegulariserPointages } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    const manager = DB.getEmployees().find(e => e.role === 'manager');
    DB._currentEmployeeId = manager.id;
    assert.strictEqual(canRegulariserPointages(), true);
    DB._currentEmployeeId = salarie.id;
    assert.strictEqual(canRegulariserPointages(), false, 'un simple salarié ne doit jamais pouvoir régulariser un pointage (même le sien)');
  }

  console.log('OK — pointage-regularisation-rapport-14-09.test.js (régularisation : motif obligatoire, trace avant/après, réservée au manager/RH/propriétaire)');
}

async function runRapportMensuel() {
  // ---- Validation / contestation du rapport mensuel ----
  {
    const { DB, sandbox } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');

    const echecContestationSansCommentaire = DB.validerPointagesMensuels(salarie.id, 2026, 5, 'conteste', '');
    assert.strictEqual(echecContestationSansCommentaire.success, false, 'contester sans expliquer ce qui ne va pas doit être refusé');

    const validation = DB.validerPointagesMensuels(salarie.id, 2026, 5, 'valide', '');
    assert.strictEqual(validation.success, true);
    const employeeApres = DB.getEmployeeById(salarie.id);
    assert.strictEqual(employeeApres.pointageValidationsMensuelles['2026-06'].statut, 'valide');
  }

  // ---- Carte "Rapport mensuel" : absente sans aucun pointage le mois précédent, visible sinon ----
  {
    const { DB, sandbox, renderRapportMensuelPointageCard, etablissementRepository, toISODate } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    DB._currentEmployeeId = salarie.id;

    const htmlSansPointage = renderRapportMensuelPointageCard(DB.getEmployeeById(salarie.id));
    assert.strictEqual(htmlSansPointage, '', 'sans aucun pointage le mois précédent, la carte ne doit pas apparaître');

    const moisPrecedent = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 5);
    const etab = etablissementRepository.getAll()[0];
    const list = DB.getPointages();
    list.push({ id: 'p-mois-prec', employeeId: salarie.id, etablissementId: etab.id, date: toISODate(moisPrecedent), heureArrivee: '09:00', heureDepart: '17:00' });
    DB.savePointages(list);
    const htmlAvecPointage = renderRapportMensuelPointageCard(DB.getEmployeeById(salarie.id));
    assert.ok(htmlAvecPointage.includes('Rapport mensuel'), 'un mois précédent avec au moins un pointage doit afficher la carte');
    assert.ok(htmlAvecPointage.includes("C'est exact") && htmlAvecPointage.includes('Contester'), 'les deux actions doivent être proposées tant que rien n\'a été validé/contesté');
  }

  console.log('OK — pointage-regularisation-rapport-14-09.test.js (validation/contestation, carte absente sans pointage, visible avec les deux actions)');
}

runPures().then(runRegularisation).then(runRapportMensuel).catch((err) => {
  console.error('ÉCHEC — pointage-regularisation-rapport-14-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
