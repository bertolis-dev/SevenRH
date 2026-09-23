/**
 * Seven RH — chargeur minimal pour exécuter supabase-client.js dans Node. Jusqu'ici jugé "non
 * exécutable simplement" (voir audit-fixes-31-08.test.js) car c'est un vrai module ES qui importe
 * @supabase/supabase-js depuis esm.sh et appelle createClient(...) au niveau racine, avec un vrai
 * appel réseau derrière (supabase.auth.onAuthStateChange). Nécessaire au retour Betty du 23/09/2026
 * ("prévois une vérification : une fiche qui traverse l'écriture puis la lecture doit revenir
 * identique") : sans exécuter le vrai fichier, un test round-trip ne prouverait rien de réel.
 *
 * Le fichier ne contient qu'UN SEUL import (ligne 14) et aucun `export` (il expose tout via
 * `window.SupabaseSync = {...}` en fin de fichier, jamais via des exports ES) — retire cette ligne et
 * remplace `createClient` par une fabrique locale avant d'exécuter le reste comme un script classique
 * (même technique que load-data-js.js pour data.js). `createClient` renvoie un "proxy inerte" :
 * n'importe quelle propriété lue ou tout appel renvoie un nouveau proxy du même type, sans jamais
 * lever d'exception ni déclencher de vrai réseau — suffisant pour que le code de INITIALISATION du
 * fichier (supabase.auth.onAuthStateChange(...) au niveau racine, ligne ~1168) s'exécute sans erreur ;
 * les fonctions PURES qu'on veut tester (employeeToRow/employeeFromRow...) n'utilisent jamais `supabase`.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeInertProxy() {
  const fn = function () {};
  const handler = {
    get(target, prop) {
      if (prop === 'then' || typeof prop === 'symbol') return undefined;
      return makeInertProxy();
    },
    apply() {
      return makeInertProxy();
    }
  };
  return new Proxy(fn, handler);
}

function loadSupabaseClient() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'supabase-client.js'), 'utf8');
  const withoutImport = source.replace(
    /^import \{ createClient \} from '[^']*';$/m,
    'const createClient = () => __inertSupabaseClient;'
  );
  if (withoutImport === source) throw new Error('la ligne import { createClient } de supabase-client.js est introuvable : ce chargeur de test doit être mis à jour en même temps que le fichier.');

  const store = {};
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
  const sandbox = { console, localStorage };
  sandbox.window = sandbox;
  sandbox.window.location = { origin: 'http://localhost:8811', pathname: '/index.html' };
  sandbox.__inertSupabaseClient = makeInertProxy();
  vm.createContext(sandbox);

  // employeeFromRow lit `window.makeEmptyEmployee()` (data.js, chargé AVANT ce module différé dans
  // index.html — voir le commentaire d'employeeFromRow) : exécute le vrai data.js dans le MÊME
  // contexte en premier, exactement comme le navigateur le fait, plutôt que de dupliquer sa forme ici.
  const dataSource = fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8');
  const exposeMakeEmpty = ['makeEmptyEmployee', 'makeEmptyEtablissement', 'makeEmptyLeaveType', 'makeEmptyLeaveRequest', 'makeEmptyTeleworkRequest', 'makeEmptyExpense']
    .map(name => `globalThis.${name} = ${name};`).join('\n');
  vm.runInContext(dataSource + ';\n' + exposeMakeEmpty + '\n', sandbox, { filename: 'data.js' });

  const expose = `
;globalThis.__employeeToRow = employeeToRow;
globalThis.__employeeFromRow = employeeFromRow;
globalThis.__etablissementToRow = etablissementToRow;
globalThis.__etablissementFromRow = etablissementFromRow;
globalThis.__leaveTypeToRow = leaveTypeToRow;
globalThis.__leaveTypeFromRow = leaveTypeFromRow;
globalThis.__leaveRequestToRow = leaveRequestToRow;
globalThis.__leaveRequestFromRow = leaveRequestFromRow;
globalThis.__teleworkRequestToRow = teleworkRequestToRow;
globalThis.__teleworkRequestFromRow = teleworkRequestFromRow;
globalThis.__expenseToRow = expenseToRow;
globalThis.__expenseFromRow = expenseFromRow;
`;
  vm.runInContext(withoutImport + expose, sandbox, { filename: 'supabase-client.js' });

  return {
    sandbox,
    employeeToRow: sandbox.__employeeToRow,
    employeeFromRow: sandbox.__employeeFromRow,
    etablissementToRow: sandbox.__etablissementToRow,
    etablissementFromRow: sandbox.__etablissementFromRow,
    leaveTypeToRow: sandbox.__leaveTypeToRow,
    leaveTypeFromRow: sandbox.__leaveTypeFromRow,
    leaveRequestToRow: sandbox.__leaveRequestToRow,
    leaveRequestFromRow: sandbox.__leaveRequestFromRow,
    teleworkRequestToRow: sandbox.__teleworkRequestToRow,
    teleworkRequestFromRow: sandbox.__teleworkRequestFromRow,
    expenseToRow: sandbox.__expenseToRow,
    expenseFromRow: sandbox.__expenseFromRow
  };
}

module.exports = { loadSupabaseClient };
