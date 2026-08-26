/**
 * Seven RH — chargeur minimal pour exécuter data.js PUIS app.js dans le même contexte Node (comme
 * le navigateur les charge en deux <script> classiques partageant le même `window`), afin de tester
 * des fonctions d'app.js (ex. syncNotifications) sans navigateur réel. Même principe que
 * load-data-js.js : DOM réduit au strict nécessaire pour que le chargement du fichier ne plante pas
 * (aucun appel DOM au chargement, seulement des addEventListener qui ne se déclenchent jamais ici),
 * pas une émulation complète du navigateur.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function stubElement() {
  return {
    addEventListener() {},
    removeEventListener() {},
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    style: {},
    dataset: {},
    setAttribute() {},
    getAttribute() { return null; },
    appendChild() {},
    remove() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}

function loadAppJs() {
  const dataSource = fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8');
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

  const store = {};
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };

  const document = {
    addEventListener() {},
    removeEventListener() {},
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return stubElement(); },
    documentElement: stubElement(),
    body: stubElement(),
  };

  const navigator = { clipboard: { writeText: async () => {} }, userAgent: 'node-test' };

  const sandbox = { console, localStorage, document, navigator, setTimeout, clearTimeout, Promise, Date, Math, JSON };
  sandbox.window = sandbox;
  sandbox.addEventListener = () => {};
  sandbox.removeEventListener = () => {};
  sandbox.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  vm.createContext(sandbox);

  const exposeAfterData = `
;globalThis.__DB = DB;
globalThis.__CURRENT_COMPANY_KEY = CURRENT_COMPANY_KEY;
`;
  vm.runInContext(dataSource + exposeAfterData, sandbox, { filename: 'data.js' });

  const exposeAfterApp = `
;globalThis.__syncNotifications = syncNotifications;
globalThis.__hasModule = hasModule;
`;
  vm.runInContext(appSource + exposeAfterApp, sandbox, { filename: 'app.js' });

  return {
    sandbox,
    DB: sandbox.__DB,
    CURRENT_COMPANY_KEY: sandbox.__CURRENT_COMPANY_KEY,
    syncNotifications: sandbox.__syncNotifications,
    hasModule: sandbox.__hasModule,
  };
}

module.exports = { loadAppJs };
