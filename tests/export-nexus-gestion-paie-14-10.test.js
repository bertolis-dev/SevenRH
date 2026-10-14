/**
 * Seven RH — pont Nexus Gestion, phase 2 (14/10/2026) : le bloc « paie » de l'export est rempli UNIQUEMENT à partir du
 * journal de paie du mois (saisi ou importé), sinon il reste null. Les clés suivent exactement le contrat v1.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');
const { validerFormatV1 } = require('./export-nexus-gestion-14-10.test.js');

const base = (extra) => ({
  annee: 2026, mois: 9, maintenant: new Date('2026-10-31T17:45:00Z'),
  profile: { siret: '443 061 841 00025' }, lignesPaie: [], expenses: [], employees: [], settings: {}, modules: { frais: true, tickets: true },
  ...extra
});
const journal = { brut: '6 500,00', charges_salariales: '1400,5', charges_patronales: 2820.25, net_a_payer: '5099,50', date_paiement: '2026-10-31', detail_par_organisme: [{ organisme: 'URSSAF', montant: '2 000' }, { organisme: 'Retraite complémentaire', montant: 300.1 }] };

function run() {
  const { construireExportNexusGestion } = loadAppJs().sandbox;

  const sans = construireExportNexusGestion(base({}));
  assert.strictEqual(sans.ok, true, sans.error);
  assert.strictEqual(sans.export.paie, null, 'aucun journal enregistré : paie reste null (comme en version 1)');
  validerFormatV1(JSON.parse(JSON.stringify(sans.export)));

  const avec = construireExportNexusGestion(base({ journalPaie: journal }));
  assert.strictEqual(avec.ok, true, avec.error);
  const x = JSON.parse(JSON.stringify(avec.export));
  validerFormatV1(x);
  assert.deepStrictEqual(x.paie, {
    brut: 6500, charges_salariales: 1400.5, charges_patronales: 2820.25, net_a_payer: 5099.5, date_paiement: '2026-10-31',
    detail_par_organisme: [{ organisme: 'URSSAF', montant: 2000 }, { organisme: 'Retraite complémentaire', montant: 300.1 }]
  });
  assert.deepStrictEqual(Object.keys(x), ['format', 'version', 'siren', 'periode', 'genere_le', 'notes_de_frais', 'tickets_restaurant', 'paie'], 'contrat inchangé : mêmes clés, même ordre');

  const sansModules = construireExportNexusGestion(base({ journalPaie: journal, modules: { frais: false, tickets: false } }));
  assert.strictEqual(sansModules.export.paie.brut, 6500, 'la paie ne dépend pas des modules Frais/Tickets');

  const casse = construireExportNexusGestion(base({ journalPaie: { ...journal, date_paiement: '' } }));
  assert.strictEqual(casse.ok, false, 'un journal enregistré incomplet bloque l\'export au lieu d\'envoyer des chiffres douteux');
  assert.ok(/journal de paie/i.test(casse.error), casse.error);
  assert.strictEqual(casse.export, undefined);
  console.log('OK — export-nexus-gestion-paie-14-10.test.js (bloc paie : null sans journal, contrat v1 exact avec journal, journal incomplet bloquant)');
}

try { run(); } catch (err) { console.error('ÉCHEC — export-nexus-gestion-paie-14-10.test.js'); console.error(err.stack || err.message); process.exitCode = 1; }
