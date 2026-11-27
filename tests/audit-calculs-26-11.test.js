/**
 * 26/11/2026 — audit externe, section 2 (calculs) : paliers d'ancienneté sous le premier palier, double décompte des congés
 * (corrigé derrière un réglage désactivé par défaut + comparatif avant/après), SMIC paramétrable.
 * Données de test fictives uniquement. (Le plafond des IJ à 1,4 SMIC est testé dans arret-travail-ij-carence-14-09.test.js, les échéances 4/8 ans dans c4-entretiens-rappels-12-10.test.js.)
 */
const assert = require('assert');
const { loadDataJs } = require('./load-data-js');

const { sandbox, DB, getLeaveBalance } = loadDataJs();
sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
DB.init();

function cp(overrides) {
  return {
    id: 'lt-cp', nom: 'Congés payés', categorie: 'conge', acquisition: 'Mensuelle', nombreAnnuel: 30,
    dateClotureCompteur: '05-31', reportCompteur: 'aucun', reportLimiteJours: null, dateLimiteReportMMJJ: null,
    fractionnementActif: false, proratisationTempsPartiel: 'aucune', paliersAnciennete: [],
    compteurPartageAvecId: null, deduireRTT: false, deduireCP: false, uniteDecompte: 'ouvres', ...overrides,
  };
}
const req = (o) => ({ id: 'r-' + Math.random().toString(36).slice(2), employeeId: 'emp-1', typeId: 'lt-cp', statut: 'Validé', ...o });
const employee = { id: 'emp-1', matricule: 'T-1', prenom: 'Test', nom: 'Un', dateEmbauche: '2015-01-01', pourcentageActivite: 100, compteurs: {} };
const refDate = '2026-08-27'; // previous = 01/06/2025-31/05/2026, previous2 = 01/06/2024-31/05/2025

// ---- Paliers : sous le premier palier, la base annuelle s'applique (jamais 0) ----
{
  const type = cp({ nombreAnnuel: 25, paliersAnciennete: [{ ancienneteMin: 15, jours: 27 }] });
  const jeune = { ...employee, dateEmbauche: '2022-01-01' };
  const ancien = { ...employee, dateEmbauche: '2008-01-01' };
  assert.strictEqual(sandbox.resolveAncienneteAcquisAnnuel(type, jeune, refDate), 25, 'moins de 15 ans : la base de 25 jours');
  assert.strictEqual(sandbox.resolveAncienneteAcquisAnnuel(type, ancien, refDate), 27, 'à partir de 15 ans : 27 jours');
}

// ---- Double décompte : un jour pris pendant la période close a déjà consommé le reliquat de la période d'avant ----
{
  const type = cp();
  const enPrevious = [req({ dateDebut: '2025-09-01', dateFin: '2025-09-05', nbJours: 5 })];
  const ancien = getLeaveBalance(employee, type, enPrevious, [type], refDate, undefined, { sansDoubleDecompte: false });
  const corrige = getLeaveBalance(employee, type, enPrevious, [type], refDate, undefined, { sansDoubleDecompte: true });
  assert.strictEqual(ancien.disponible, 25, 'calcul d\'origine : 30 acquis - 5 pris');
  assert.strictEqual(corrige.disponible, 30, 'calcul corrigé : les 5 jours ont consommé le reliquat de la période précédente');
  assert.strictEqual(corrige.pris, 0);
  assert.strictEqual(corrige.creditDoubleDecompte, 30);

  // Par défaut (réglage désactivé) : le calcul d'origine, inchangé
  const parDefaut = getLeaveBalance(employee, type, enPrevious, [type], refDate);
  assert.strictEqual(parDefaut.disponible, 25, 'désactivé par défaut tant que l\'expert-comptable n\'a pas validé');
  assert.strictEqual(DB.getSettings().soldeCongesSansDoubleDecompte, false);

  // Un jour pris dans la période EN COURS compte toujours contre le droit de la période close
  const enCours = [req({ dateDebut: '2026-08-10', dateFin: '2026-08-14', nbJours: 5 })];
  assert.strictEqual(getLeaveBalance(employee, type, enCours, [type], refDate, undefined, { sansDoubleDecompte: true }).disponible, 25, 'jours de la période en cours : inchangés');

  // Le reliquat de la période d'avant est lui-même entamé : seul ce qui en reste absorbe les jours (ici 2 restants sur 30)
  const reste2 = [req({ dateDebut: '2025-03-03', dateFin: '2025-04-30', nbJours: 28 }), req({ dateDebut: '2025-09-01', dateFin: '2025-09-05', nbJours: 5 })];
  const partiel = getLeaveBalance(employee, type, reste2, [type], refDate, undefined, { sansDoubleDecompte: true });
  assert.strictEqual(partiel.creditDoubleDecompte, 2, 'reliquat de la période d\'avant : 30 - 28 = 2');
  assert.strictEqual(partiel.disponible, 27, '30 acquis - (5 pris - 2 absorbés) = 27');

  // Report intégral : le reliquat est déjà dans l'acquis, pas de crédit supplémentaire (aucune double correction)
  const reportIntegral = cp({ reportCompteur: 'illimite' });
  const avecReport = getLeaveBalance(employee, reportIntegral, enPrevious, [reportIntegral], refDate, undefined, { sansDoubleDecompte: true });
  assert.strictEqual(avecReport.creditDoubleDecompte, 0, 'report illimité : rien à corriger');
  assert.strictEqual(avecReport.disponible, getLeaveBalance(employee, reportIntegral, enPrevious, [reportIntegral], refDate, undefined, { sansDoubleDecompte: false }).disponible);
}

// ---- Comparatif avant / après, salarié par salarié ----
{
  const type = cp();
  const autre = { ...employee, id: 'emp-2', matricule: 'T-2', prenom: 'Test', nom: 'Deux' };
  const demandes = [req({ dateDebut: '2025-09-01', dateFin: '2025-09-05', nbJours: 5 })]; // seulement emp-1
  const lignes = sandbox.comparerSoldesDoubleDecompte([employee, autre], [type], demandes, [type], refDate);
  assert.strictEqual(lignes.length, 2, 'une ligne par salarié et par type à clôture de compteur');
  const l1 = lignes.find(l => l.employee.id === 'emp-1');
  const l2 = lignes.find(l => l.employee.id === 'emp-2');
  assert.strictEqual(l1.disponibleAvant, 25);
  assert.strictEqual(l1.disponibleApres, 30);
  assert.strictEqual(l1.ecart, 5);
  assert.strictEqual(l2.ecart, 0, 'aucun jour pris : aucun écart');
  // Un type sans clôture de compteur n'est pas concerné
  const sansCloture = cp({ id: 'lt-x', dateClotureCompteur: '' });
  assert.strictEqual(sandbox.comparerSoldesDoubleDecompte([employee], [sansCloture], [], [sansCloture], refDate).length, 0);
}

// ---- Réglages : SMIC et échéances ----
{
  const s = DB.getSettings();
  assert.ok(s.smicMensuelBrut > 1800, 'SMIC paramétrable, valeur par défaut renseignée');
  assert.strictEqual(s.entretienProfessionnelPeriodiciteAnnees, 4);
  assert.strictEqual(s.bilanRecapitulatifAnnees, 8);
}



// ---- Écran Paramètres : le réglage du calcul corrigé, le comparatif et les échéances d'entretien sont proposés ----
{
  const { loadAppJs } = require('./load-app-js');
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  api.DB._currentEmployeeId = api.DB.getEmployees().find(e => e.role === 'rh').id;
  const html = api.sandbox.renderParametresTypesAbsences();
  for (const id of ['f-solde-sans-double-decompte', 'btn-comparatif-double-decompte', 'f-smic-mensuel', 'f-entretien-premier', 'f-entretien-periodicite', 'f-bilan-recapitulatif']) {
    assert.ok(html.includes('id="' + id + '"'), id + ' présent dans Paramètres');
  }
  assert.ok(!html.includes('id="f-solde-sans-double-decompte" checked'), 'désactivé par défaut');
  assert.strictEqual(typeof api.sandbox.exportComparatifDoubleDecompteExcel, 'function');
}
console.log('OK — audit-calculs-26-11.test.js');
