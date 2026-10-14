/**
 * Seven RH — pont Nexus Gestion (14/10/2026), P6 : docs/exemple-export-nexus-rh-v1.json sert de jeu de test côté Nexus
 * Gestion. Il doit respecter EXACTEMENT le contrat v1, être anonymisé, et couvrir les cas utiles à l'import (note payée
 * et non payée, avec et sans justificatif, kilométrique à TVA 0, tickets avec date de commande, paie null).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { validerFormatV1 } = require('./export-nexus-gestion-14-10.test.js');

const fichier = path.join(__dirname, '..', 'docs', 'exemple-export-nexus-rh-v1.json');

function run() {
  assert.ok(fs.existsSync(fichier), 'le fichier d\'exemple doit exister');
  const brut = fs.readFileSync(fichier, 'utf8');
  assert.ok(!brut.charCodeAt(0) !== 0xFEFF && brut.charCodeAt(0) !== 0xFEFF, 'JSON sans BOM');
  const x = JSON.parse(brut);
  validerFormatV1(x);

  assert.strictEqual(x.siren, '123456782', 'SIREN fictif (valide au contrôle de clé, mais celui d\'aucune entreprise réelle connue)');
  assert.ok(!/@/.test(brut), 'aucune adresse e-mail');
  assert.ok(!/\b\d{14}\b/.test(brut) && !/\d{2} \d{2} \d{2} \d{2} \d{2}/.test(brut), 'ni SIRET complet ni numéro de téléphone');
  assert.ok(x.notes_de_frais.every(n => /^[A-Z][a-zé]+ [A-Z]+$/.test(n.salarie)), 'noms de salariés fictifs « Prénom NOM »');

  const ids = x.notes_de_frais.map(n => n.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'identifiants uniques');
  assert.ok(x.notes_de_frais.some(n => n.date_remboursement !== null), 'au moins une note payée');
  assert.ok(x.notes_de_frais.some(n => n.date_remboursement === null), 'au moins une note validée non payée');
  assert.ok(x.notes_de_frais.some(n => n.justificatif_url !== null) && x.notes_de_frais.some(n => n.justificatif_url === null), 'avec et sans justificatif');
  assert.ok(x.notes_de_frais.some(n => n.taux_tva === 0 && n.tva === 0), 'une note à TVA nulle (kilométrique)');
  assert.ok(new Set(x.notes_de_frais.map(n => n.taux_tva)).size >= 3, 'plusieurs taux de TVA');
  assert.ok(x.tickets_restaurant && x.tickets_restaurant.date_commande, 'tickets restaurant avec date de commande');
  assert.strictEqual(x.paie, null);
  assert.deepStrictEqual(ids.slice().sort(), ids.slice().sort(), 'sanity');
  console.log('OK — export-nexus-gestion-exemple-14-10.test.js (P6 : fichier d\'exemple conforme au contrat v1, anonymisé, représentatif)');
}

try { run(); } catch (err) { console.error('ÉCHEC — export-nexus-gestion-exemple-14-10.test.js'); console.error(err.stack || err.message); process.exitCode = 1; }
