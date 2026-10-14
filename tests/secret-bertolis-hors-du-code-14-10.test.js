/**
 * Seven RH — point en attente de la revue du 13/10/2026, traité le 14/10 : le secret de la fonction « bertolis-tickets » (accès
 * aux tickets de TOUTES les entreprises) était écrit en clair dans data.js, donc lisible par n'importe quel visiteur du site et
 * dans l'historique public du dépôt. Il n'est plus dans le code : la console BERTOLIS le demande à la connexion et ne le garde
 * que pour la session du navigateur (sessionStorage).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAppJs } = require('./load-app-js');

const racine = path.join(__dirname, '..');
const ANCIEN_SECRET = '9cedfffcd52b0afa010476d1bd528473a6eb267925ab8611';

function run() {
  for (const f of ['data.js', 'app.js', 'supabase-client.js', 'index.html']) {
    assert.ok(!fs.readFileSync(path.join(racine, f), 'utf8').includes(ANCIEN_SECRET), `${f} ne contient plus le secret en clair`);
  }
  const app = fs.readFileSync(path.join(racine, 'app.js'), 'utf8');
  assert.ok(!/BERTOLIS_TICKETS_SECRET/.test(app), 'app.js ne référence plus de constante de secret');
  assert.ok(!/BERTOLIS_TICKETS_SECRET\s*=\s*'/.test(fs.readFileSync(path.join(racine, 'data.js'), 'utf8')), 'plus de secret codé dans data.js');

  const api = loadAppJs();
  const { DB, sandbox } = api;
  assert.strictEqual(sandbox.getBertolisAccessKey(), '', 'sans connexion : aucune clé');
  sandbox.setBertolisAccessKey('  ma-cle-support  ');
  assert.strictEqual(sandbox.getBertolisAccessKey(), 'ma-cle-support', 'clé nettoyée et conservée pour la session');
  assert.strictEqual(sandbox.sessionStorage.getItem('sevenrh_bertolis_key'), 'ma-cle-support');
  assert.strictEqual(sandbox.localStorage.getItem('sevenrh_bertolis_key'), null, 'jamais écrite dans localStorage (persistant)');
  DB.bertolisLogout();
  assert.strictEqual(sandbox.getBertolisAccessKey(), '', 'la déconnexion efface la clé');

  const html = sandbox.renderBertolisLoginView();
  assert.ok(html.includes('id="f-bertolis-key"') && /type="password" id="f-bertolis-key"/.test(html), 'champ « clé d\'accès support » masqué à la saisie');
  console.log('OK — secret-bertolis-hors-du-code-14-10.test.js (secret retiré du code, clé de session saisie à la connexion, effacée à la déconnexion)');
}

try { run(); } catch (err) { console.error('ÉCHEC — secret-bertolis-hors-du-code-14-10.test.js'); console.error(err.stack || err.message); process.exitCode = 1; }
