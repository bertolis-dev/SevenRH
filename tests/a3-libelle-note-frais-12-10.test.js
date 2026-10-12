/**
 * Seven RH — brief du 12/10/2026, A3 : le libellé d'une note de frais doit être obligatoire ET
 * significatif (3 caractères minimum, jamais uniquement des chiffres ou de la ponctuation).
 * Avant : seul l'attribut HTML « required » existait, « 123 » ou « ... » passaient.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAppJs } = require('./load-app-js');

function run() {
  const { validerLibelleNoteFrais } = loadAppJs().sandbox;
  assert.strictEqual(typeof validerLibelleNoteFrais, 'function', 'la validation du libellé doit exister');

  ['', '   ', 'ab', ' a ', '123', '12345', '...', '--', '1 2 3', '€€€'].forEach(mauvais => {
    const r = validerLibelleNoteFrais(mauvais);
    assert.strictEqual(r.ok, false, `« ${mauvais} » doit être refusé`);
    assert.ok(r.error && r.error.length > 5, 'un message en français explique le refus');
  });

  ['Taxi gare', 'Déjeuner client', '  Péage A6  ', 'Train 2e classe', 'Hôtel Lyon'].forEach(bon => {
    const r = validerLibelleNoteFrais(bon);
    assert.strictEqual(r.ok, true, `« ${bon} » doit être accepté`);
    assert.strictEqual(r.libelle, bon.trim().replace(/\s+/g, ' '), 'le libellé est nettoyé (espaces)');
  });

  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const i = app.indexOf('async function submitExpenseForm');
  const corps = app.slice(i, i + 5000);
  assert.ok(/validerLibelleNoteFrais\(formData\.get\('libelle'\)\)/.test(corps), 'submitExpenseForm doit appliquer la validation');
  assert.ok(/libelle: libelleValide\.libelle/.test(corps), 'le libellé nettoyé est celui qui est enregistré');

  console.log('OK — a3-libelle-note-frais-12-10.test.js (libellé : 3 caractères minimum, au moins une lettre, espaces nettoyés)');
}

try { run(); } catch (err) { console.error('ÉCHEC — a3-libelle-note-frais-12-10.test.js'); console.error(err.stack || err.message); process.exitCode = 1; }
