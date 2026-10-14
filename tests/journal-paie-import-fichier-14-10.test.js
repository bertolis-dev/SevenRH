/**
 * Seven RH — pont Nexus Gestion, phase 2 (14/10/2026) : lecture RÉELLE (bibliothèque SheetJS livrée avec le site) d'un journal
 * de paie CSV français ou Excel. Piège vérifié : sans raw:true, SheetJS lit « 650,50 » à l'américaine (65050) et fausse les totaux.
 */
const assert = require('assert');
const path = require('path');
const XLSX = require(path.join(__dirname, '..', 'xlsx.full.min.js'));
const { loadAppJs } = require('./load-app-js');

function brancher(api) {
  api.sandbox.XLSX = XLSX;
  api.sandbox.loadXLSXLibrary = async () => {};
  api.sandbox.FileReader = class { readAsArrayBuffer(fichier) { this.result = fichier.contenu; setImmediate(() => this.onload()); } };
}
const tampon = (buffer) => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

async function lireEtAgreger(api, contenu) {
  const rows = await api.sandbox.lireFichierTableur({ contenu });
  const [entetes, ...donnees] = rows;
  const colonnes = api.sandbox.devinerColonnesJournalPaie(entetes);
  return { colonnes, resultat: api.sandbox.agregerJournalPaie(donnees, colonnes) };
}

const csv = 'Matricule;Salaire brut;Cotisations salariales;Cotisations patronales;Net à payer;Organisme;Montant organisme\r\nM1;3 000,00;650,50;1 300,25;2 349,50;URSSAF;1 200,00\r\nM2;2 500,00;540,00;1 100,00;1 960,00;URSSAF;800,00\r\nTotal;5 500,00;1 190,50;2 400,25;4 309,50;;\r\n';

async function run() {
  const api = loadAppJs();
  brancher(api);

  for (const [nom, buffer] of [['CSV UTF-8 avec BOM', Buffer.from('﻿' + csv, 'utf8')], ['CSV Windows-1252 (export Excel français)', Buffer.from(csv, 'latin1')]]) {
    const { resultat, colonnes } = await lireEtAgreger(api, tampon(buffer));
    assert.strictEqual(colonnes.net_a_payer, 4, `${nom} : colonne « Net à payer » reconnue malgré l'accent`);
    assert.strictEqual(resultat.brut, 5500, `${nom} : brut`);
    assert.strictEqual(resultat.charges_salariales, 1190.5, `${nom} : « 650,50 » reste 650,50 et non 65 050`);
    assert.strictEqual(resultat.charges_patronales, 2400.25, `${nom} : charges patronales`);
    assert.strictEqual(resultat.net_a_payer, 4309.5, `${nom} : net`);
    assert.strictEqual(resultat.lignesLues, 2, `${nom} : la ligne Total n'est pas recomptée`);
    assert.deepStrictEqual(Array.from(resultat.detail_par_organisme, o => [o.organisme, o.montant]), [['URSSAF', 2000]], `${nom} : organismes`);
  }

  // Excel : vraies cellules numériques (dont un nombre à décimales qui ne doit pas être pris pour un séparateur de milliers)
  const feuille = XLSX.utils.aoa_to_sheet([
    ['Nom', 'Brut', 'Charges salariales', 'Charges patronales', 'Net à verser'],
    ['A', 1000.5, 1.234, 400, 780.25],
    ['B', 2000, 2.5, 800, 1500]
  ]);
  const classeur = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(classeur, feuille, 'Journal');
  const { resultat } = await lireEtAgreger(api, tampon(XLSX.write(classeur, { type: 'buffer', bookType: 'xlsx' })));
  assert.strictEqual(resultat.brut, 3000.5);
  assert.strictEqual(resultat.charges_salariales, 3.73, '1.234 (nombre Excel) reste 1,234 € et non 1 234 €');
  assert.strictEqual(resultat.net_a_payer, 2280.25);

  console.log('OK — journal-paie-import-fichier-14-10.test.js (vraie lecture CSV UTF-8/Windows-1252 et Excel : virgules françaises et nombres Excel respectés)');
}

run().catch(err => { console.error('ÉCHEC — journal-paie-import-fichier-14-10.test.js'); console.error(err.stack || err.message); process.exitCode = 1; });
