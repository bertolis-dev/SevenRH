/**
 * Seven RH — retour Betty du 23/09/2026 ("quinze champs de la fiche salarié sont enregistrés mais
 * jamais relus") : employeeFromRow (supabase-client.js) reconstruisait la fiche à partir d'une liste
 * de champs écrite à la main, jamais synchronisée avec employeeToRow (qui pousse TOUT le reste
 * génériquement via `...rest`) — quinze champs partaient bien vers Supabase et ne revenaient jamais
 * au rechargement (enfants, contrats, visitesMedicales, historiqueSalaire, sexe, nomUsage...). Même
 * défaut trouvé et corrigé ce même jour dans leaveTypeFromRow (natureAcquisition),
 * leaveRequestFromRow (arretTravail, visiteRepriseDate) et expenseFromRow (dossierId, datePaiement) —
 * voir l'audit round-trip générique en bas de fichier, qui aurait détecté ces quatre-là aussi.
 *
 * Toutes ces fonctions sont réécrites pour fusionner makeEmptyXxx() (défauts) + le contenu réel de
 * `data` (générique, sans liste à maintenir) + les colonnes dédiées (qui font autorité) — voir le
 * commentaire d'employeeFromRow. Ce fichier vérifie, pour de vrai (exécution du fichier réel via
 * tests/load-supabase-client.js, pas une lecture de son code source), qu'une fiche qui traverse
 * l'écriture PUIS la lecture revient identique.
 */
const assert = require('assert');
const { loadSupabaseClient } = require('./load-supabase-client');

/** Remplit un objet makeEmptyXxx() avec des valeurs non-par-défaut partout où c'est raisonnable
 * (chaînes/nombres/booléens inversés, tableaux/objets non vides) — pour qu'un champ qui reviendrait
 * simplement à SA PROPRE valeur par défaut après un aller-retour cassé ne masque pas le bug. */
function withDistinctiveValues(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') out[key] = `${key}-valeur-test`;
    else if (typeof value === 'number') out[key] = (value || 0) + 1234;
    else if (typeof value === 'boolean') out[key] = !value;
    else if (Array.isArray(value)) out[key] = [`${key}-item`];
    else if (value && typeof value === 'object') out[key] = { ...value, __marqueur: `${key}-objet-test` };
    else out[key] = value; // null/undefined délibérés (ex. proratisationTempsPartiel) : jamais touchés ici
  }
  return out;
}

/** Vérifie qu'aucune clé de `original` n'a disparu après writeThenRead — la garantie générale que
 * Betty a demandée, au-delà des champs qu'elle a nommément listés. */
function assertNoFieldLost(label, original, roundTripped, champsExclus) {
  const exclus = new Set(champsExclus || []);
  Object.keys(original).forEach(key => {
    if (exclus.has(key)) return;
    assert.ok(key in roundTripped, `${label} : le champ "${key}" a disparu à la relecture (employeeFromRow-style bug)`);
  });
}

function runEmployeeRoundTrip() {
  const { employeeToRow, employeeFromRow, sandbox } = loadSupabaseClient();
  const original = withDistinctiveValues(sandbox.makeEmptyEmployee());
  original.id = 'emp-1';

  const row = employeeToRow(original, 'company-1');
  const back = employeeFromRow(row);

  // Les 6 champs cités nommément dans la comparaison de Betty (tableau "ce qui part / ce qui revient").
  ['enfants', 'contrats', 'visitesMedicales', 'historiqueSalaire', 'sexe', 'nomUsage'].forEach(f => {
    assert.deepStrictEqual(back[f], original[f], `employeeFromRow doit relire "${f}" (cité par Betty dans sa lettre du 23/09/2026)`);
  });

  // Les 15 champs listés intégralement dans la lettre (déclarés dans makeEmptyEmployee, absents
  // d'employeeFromRow avant ce correctif).
  const quinzeChamps = [
    'nomUsage', 'sexe', 'classification', 'suiviMedicalType', 'visitesMedicales',
    'enfants', 'contrats', 'indisponibilitesRecurrentes', 'delegations',
    'nombreJoursForfait', 'nombreJoursRTTAnnuel', 'departAutoDeduit',
    'historiqueSalaire', 'ticketsCommandesEnregistrees', 'pointageValidationsMensuelles'
  ];
  quinzeChamps.forEach(f => {
    assert.deepStrictEqual(back[f], original[f], `employeeFromRow doit relire "${f}" (liste complète de la lettre du 23/09/2026)`);
  });

  // Les colonnes dédiées (jamais dans `data`) reviennent bien depuis la ligne, pas depuis `data`.
  assert.strictEqual(back.id, 'emp-1');
  assert.strictEqual(back.nom, original.nom);
  assert.strictEqual(back.email, original.email);
  assert.strictEqual(back.etablissementId, original.etablissementId);
  assert.deepStrictEqual(back.managerIds, original.managerIds);

  // Champs volontairement remis à leur valeur fixe (auth réelle gérée par Supabase Auth, jamais
  // stockés dans `data`) : ne doivent jamais revenir à la valeur "distinctive" injectée ci-dessus.
  assert.strictEqual(back.motDePasse, '');
  assert.strictEqual(back.tentativesEchouees, 0);
  assert.strictEqual(back.verrouille, false);
  assert.strictEqual(back.resetToken, null);

  assertNoFieldLost('employeeFromRow', original, back, ['motDePasse', 'tentativesEchouees', 'verrouille', 'resetToken']);

  console.log('OK — supabase-client-round-trip-23-09.test.js (employeeFromRow : les 15 champs de la lettre, plus une vérification générique aller-retour, reviennent tous)');
}

function runLeaveTypeRoundTrip() {
  const { leaveTypeToRow, leaveTypeFromRow, sandbox } = loadSupabaseClient();
  const original = withDistinctiveValues(sandbox.makeEmptyLeaveType());
  original.id = 'type-1';
  original.proratisationTempsPartiel = 'proportionnelle'; // explicitement renseigné cette fois (cas normal)

  const row = leaveTypeToRow(original, 'company-1');
  const back = leaveTypeFromRow(row);

  assert.strictEqual(back.natureAcquisition, original.natureAcquisition, 'natureAcquisition doit revenir (manquant avant le correctif du 23/09/2026)');
  assert.strictEqual(back.proratisationTempsPartiel, 'proportionnelle', 'renseigné explicitement, doit revenir tel quel');
  assertNoFieldLost('leaveTypeFromRow', original, back);

  // Exception délibérée : une ligne existante SANS cette clé dans `data` (jamais réenregistrée
  // depuis l'ajout du champ) doit rester `undefined`, jamais retomber sur le défaut d'un type
  // nouvellement créé ('proportionnelle') — sinon l'inférence par nom ne se déclenche plus jamais.
  const rowLegacy = leaveTypeToRow(original, 'company-1');
  delete rowLegacy.data.proratisationTempsPartiel;
  const backLegacy = leaveTypeFromRow(rowLegacy);
  assert.strictEqual(backLegacy.proratisationTempsPartiel, undefined, 'un type légataire sans cette clé ne doit jamais recevoir le défaut d\'un type neuf (casserait resolveProratisationTempsPartiel)');

  console.log('OK — supabase-client-round-trip-23-09.test.js (leaveTypeFromRow : natureAcquisition revient, exception proratisationTempsPartiel préservée)');
}

function runLeaveRequestRoundTrip() {
  const { leaveRequestToRow, leaveRequestFromRow, sandbox } = loadSupabaseClient();
  const original = withDistinctiveValues(sandbox.makeEmptyLeaveRequest());
  original.id = 'req-1';

  const row = leaveRequestToRow(original, 'company-1');
  const back = leaveRequestFromRow(row);

  assert.deepStrictEqual(back.arretTravail, original.arretTravail, 'arretTravail doit revenir (manquant avant le correctif du 23/09/2026)');
  assert.strictEqual(back.visiteRepriseDate, original.visiteRepriseDate, 'visiteRepriseDate doit revenir (manquant avant le correctif du 23/09/2026)');
  assertNoFieldLost('leaveRequestFromRow', original, back);

  console.log('OK — supabase-client-round-trip-23-09.test.js (leaveRequestFromRow : arretTravail et visiteRepriseDate reviennent)');
}

function runExpenseRoundTrip() {
  const { expenseToRow, expenseFromRow, sandbox } = loadSupabaseClient();
  const original = withDistinctiveValues(sandbox.makeEmptyExpense());
  original.id = 'exp-1';

  const row = expenseToRow(original, 'company-1');
  const back = expenseFromRow(row);

  assert.strictEqual(back.dossierId, original.dossierId, 'dossierId doit revenir (manquant avant le correctif du 23/09/2026)');
  assert.strictEqual(back.datePaiement, original.datePaiement, 'datePaiement doit revenir (manquant avant le correctif du 23/09/2026)');
  assertNoFieldLost('expenseFromRow', original, back);

  console.log('OK — supabase-client-round-trip-23-09.test.js (expenseFromRow : dossierId et datePaiement reviennent)');
}

function runTeleworkRequestAndEtablissementRoundTrip() {
  const { teleworkRequestToRow, teleworkRequestFromRow, etablissementToRow, etablissementFromRow, sandbox } = loadSupabaseClient();

  const originalTw = withDistinctiveValues(sandbox.makeEmptyTeleworkRequest());
  originalTw.id = 'tw-1';
  const backTw = teleworkRequestFromRow(teleworkRequestToRow(originalTw, 'company-1'));
  assertNoFieldLost('teleworkRequestFromRow', originalTw, backTw);

  const originalEtab = withDistinctiveValues(sandbox.makeEmptyEtablissement());
  originalEtab.id = 'etab-1';
  const backEtab = etablissementFromRow(etablissementToRow(originalEtab, 'company-1'));
  assertNoFieldLost('etablissementFromRow', originalEtab, backEtab);

  console.log('OK — supabase-client-round-trip-23-09.test.js (teleworkRequestFromRow, etablissementFromRow : déjà complets, vérifiés par prévention)');
}

function run() {
  runEmployeeRoundTrip();
  runLeaveTypeRoundTrip();
  runLeaveRequestRoundTrip();
  runExpenseRoundTrip();
  runTeleworkRequestAndEtablissementRoundTrip();
}

try {
  run();
} catch (err) {
  console.error('ÉCHEC — supabase-client-round-trip-23-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
