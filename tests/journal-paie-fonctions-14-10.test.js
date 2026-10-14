/**
 * Seven RH — pont Nexus Gestion, phase 2 (décision du 14/10/2026 : livrer les deux voies). Fonctions pures du journal de
 * paie mensuel : lecture des montants à la française, devinette des colonnes d'un CSV de journal de paie, agrégation,
 * contrôle de la saisie. Nexus RH ne calcule pas la paie : ces montants viennent du logiciel de paie externe.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

const S = () => loadAppJs().sandbox;

function runLesMontantsALaFrancaisSontLus() {
  const { parseMontantFR } = S();
  const cas = [['1 234,56', 1234.56], ['1 234,56 €', 1234.56], ['1.234,56', 1234.56], ['1234.56', 1234.56], ['1.234', 1234], ['0,5', 0.5], [12, 12], ['  42 ', 42], ['-15,30', -15.3]];
  cas.forEach(([entree, attendu]) => assert.strictEqual(parseMontantFR(entree), attendu, `« ${entree} » -> ${attendu}`));
  ['', null, undefined, 'abc', '12,3,4', '--'].forEach(v => assert.strictEqual(parseMontantFR(v), null, `« ${v} » n'est pas un montant`));
  console.log('OK — journal-paie-fonctions-14-10.test.js (montants : espaces, virgule, point, euro, négatifs, valeurs invalides)');
}

function runLesColonnesSontDevinees() {
  const { devinerColonnesJournalPaie } = S();
  const m = devinerColonnesJournalPaie(['Matricule', 'Salaire brut', 'Cotisations salariales', 'Cotisations patronales', 'Net à payer', 'Organisme', 'Montant organisme']);
  assert.strictEqual(m.brut, 1);
  assert.strictEqual(m.charges_salariales, 2);
  assert.strictEqual(m.charges_patronales, 3);
  assert.strictEqual(m.net_a_payer, 4);
  assert.strictEqual(m.organisme, 5);
  assert.strictEqual(m.montant_organisme, 6);
  const m2 = devinerColonnesJournalPaie(['Nom', 'BRUT', 'Charges employé', 'Charges employeur', 'Net à verser']);
  assert.deepStrictEqual([m2.brut, m2.charges_salariales, m2.charges_patronales, m2.net_a_payer], [1, 2, 3, 4], 'variantes de vocabulaire (charges employé / employeur, net à verser)');
  const m3 = devinerColonnesJournalPaie(['Colonne A', 'Colonne B']);
  assert.strictEqual(m3.brut, undefined, 'rien deviné : aucune colonne attribuée au hasard');
  console.log('OK — journal-paie-fonctions-14-10.test.js (colonnes devinées par leur en-tête, jamais au hasard)');
}

function runLAgregationSommeLesLignesEtIgnoreLesTotaux() {
  const { agregerJournalPaie } = S();
  const lignes = [
    ['M1', '3 000,00', '650,50', '1 300,25', '2 349,50', 'URSSAF', '1 200,00'],
    ['M2', '2 500,00', '540,00', '1 100,00', '1 960,00', 'URSSAF', '800,00'],
    ['M3', '1 000,00', '210,00', '420,00', '790,00', 'Retraite complémentaire', '300,10'],
    ['Total', '6 500,00', '1 400,50', '2 820,25', '5 099,50', '', '']
  ];
  const r = agregerJournalPaie(lignes, { brut: 1, charges_salariales: 2, charges_patronales: 3, net_a_payer: 4, organisme: 5, montant_organisme: 6 });
  assert.strictEqual(r.brut, 6500);
  assert.strictEqual(r.charges_salariales, 1400.5);
  assert.strictEqual(r.charges_patronales, 2820.25);
  assert.strictEqual(r.net_a_payer, 5099.5);
  assert.strictEqual(r.lignesLues, 3, 'la ligne « Total » du fichier n\'est pas comptée une seconde fois');
  assert.deepStrictEqual(Array.from(r.detail_par_organisme, o => [o.organisme, o.montant]), [['URSSAF', 2000], ['Retraite complémentaire', 300.1]], 'détail regroupé par organisme');
  const partiel = agregerJournalPaie([['A', '100', 'x']], { brut: 1 });
  assert.strictEqual(partiel.brut, 100);
  assert.strictEqual(partiel.net_a_payer, 0, 'colonne absente : 0, à compléter à la main');
  console.log('OK — journal-paie-fonctions-14-10.test.js (agrégation : sommes, regroupement par organisme, ligne Total ignorée)');
}

function runLaSaisieEstControlee() {
  const { validerJournalPaie } = S();
  const bon = validerJournalPaie({ brut: '6 500,00', charges_salariales: '1400,5', charges_patronales: 2820.25, net_a_payer: '5099,50', date_paiement: '2026-10-31', detail_par_organisme: [{ organisme: ' URSSAF ', montant: '2 000' }, { organisme: '', montant: '' }] });
  assert.strictEqual(bon.ok, true, bon.error);
  assert.strictEqual(bon.journal.brut, 6500);
  assert.strictEqual(bon.journal.charges_salariales, 1400.5);
  assert.strictEqual(bon.journal.date_paiement, '2026-10-31');
  assert.deepStrictEqual(Array.from(bon.journal.detail_par_organisme, o => [o.organisme, o.montant]), [['URSSAF', 2000]], 'ligne vide ignorée, nom nettoyé');
  assert.deepStrictEqual(Object.keys(bon.journal), ['brut', 'charges_salariales', 'charges_patronales', 'net_a_payer', 'date_paiement', 'detail_par_organisme'], 'clés dans l\'ordre du contrat');

  const refus = (extra, motif) => assert.strictEqual(validerJournalPaie({ brut: 100, charges_salariales: 10, charges_patronales: 20, net_a_payer: 80, date_paiement: '2026-10-31', detail_par_organisme: [], ...extra }).ok, false, motif);
  refus({ brut: '' }, 'brut obligatoire');
  refus({ net_a_payer: 'abc' }, 'net non numérique');
  refus({ charges_patronales: -5 }, 'montant négatif');
  refus({ date_paiement: '' }, 'date obligatoire');
  refus({ date_paiement: '2026-02-30' }, 'date impossible');
  refus({ detail_par_organisme: [{ organisme: 'URSSAF', montant: '-3' }] }, 'montant d\'organisme négatif');
  refus({ detail_par_organisme: [{ organisme: '', montant: '50' }] }, 'montant sans nom d\'organisme');
  console.log('OK — journal-paie-fonctions-14-10.test.js (saisie contrôlée : obligatoires, nombres, dates réelles, organismes)');
}

try {
  runLesMontantsALaFrancaisSontLus();
  runLesColonnesSontDevinees();
  runLAgregationSommeLesLignesEtIgnoreLesTotaux();
  runLaSaisieEstControlee();
} catch (err) {
  console.error('ÉCHEC — journal-paie-fonctions-14-10.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
