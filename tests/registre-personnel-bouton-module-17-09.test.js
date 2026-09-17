/**
 * Seven RH — suite de l'audit "millimètre par millimètre" (retour Betty du 17/09/2026) : l'onglet
 * Paramètres "Registre du personnel" est explicitement réservé au module RH (PARAMETRES_TABS,
 * isVisible: canManageParametres() && hasModule('rh'), voir registre-personnel-ecran-14-09.test.js).
 * Mais le bouton "Registre du personnel" sur l'écran Salariés (renderEmployeesList) — un second accès
 * à la MÊME donnée (openRegistreUniquePersonnelModal) — ne vérifiait que la visibilité entreprise
 * entière (canSeeRegistrePersonnel), jamais le module. L'écran Salariés lui-même reste volontairement
 * SANS module (voir NAV_ITEMS 'employees', "le registre des salariés... est le socle commun de tous
 * les modules") : une entreprise n'ayant souscrit à aucun module RH pouvait donc quand même ouvrir le
 * registre unique du personnel complet depuis ce bouton, en contournant le module vérifié partout
 * ailleurs pour cette même fonctionnalité.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAppJs } = require('./load-app-js');

function setupViewer(modules) {
  const { DB, sandbox, renderEmployeesList } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const company = DB.getCurrentCompany();
  company.abonnement.offre = 'a_la_carte';
  company.abonnement.modules = modules.map(key => ({ key }));
  DB.saveCurrentCompany(company);
  const proprietaire = DB.getEmployees().find(e => e.role === 'proprietaire');
  DB._currentEmployeeId = proprietaire.id;
  return { DB, renderEmployeesList };
}

function runBoutonAbsentSansModuleRh() {
  const { renderEmployeesList } = setupViewer(['conges']); // pas de module rh
  const html = renderEmployeesList();
  assert.ok(!html.includes('id="btn-registre-personnel"'), 'sans le module RH, le bouton "Registre du personnel" ne doit jamais apparaître sur l\'écran Salariés');

  console.log('OK — registre-personnel-bouton-module-17-09.test.js (bouton absent sans le module RH)');
}

function runBoutonPresentAvecModuleRh() {
  const { renderEmployeesList } = setupViewer(['rh']);
  const html = renderEmployeesList();
  assert.ok(html.includes('id="btn-registre-personnel"'), 'contrôle positif : avec le module RH souscrit, le bouton doit réapparaître');

  console.log('OK — registre-personnel-bouton-module-17-09.test.js (contrôle positif : bouton présent avec le module RH)');
}

function runIndexEgaliteResteIndependant() {
  // §note : l'Index égalité professionnelle est aussi ouvert depuis l'écran Rémunération (module
  // 'remuneration', pas 'rh') — pas la même preuve d'appartenance à un module que le Registre du
  // personnel (qui, lui, a un onglet Paramètres jumeau explicitement gaté sur 'rh'). Volontairement
  // laissé tel quel pour ne pas casser ce second point d'entrée légitime ; ce test fige seulement le
  // comportement actuel pour qu'un futur changement soit délibéré, pas accidentel.
  const { renderEmployeesList } = setupViewer(['conges']);
  const html = renderEmployeesList();
  assert.ok(html.includes('id="btn-index-egalite"'), 'l\'Index égalité pro reste volontairement indépendant du module RH sur cet écran (voir le commentaire ci-dessus)');

  console.log('OK — registre-personnel-bouton-module-17-09.test.js (Index égalité pro : comportement actuel figé, changement volontaire uniquement)');
}

function runGardeInterneDeLaModale() {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const fnStart = appSource.indexOf('function openRegistreUniquePersonnelModal(');
  const fnEnd = appSource.indexOf('function ', fnStart + 10);
  const fnBody = appSource.slice(fnStart, fnEnd);
  assert.ok(/if \(!hasModule\('rh'\)\)/.test(fnBody), 'la fonction qui ouvre la modale doit elle-même vérifier le module RH, pas seulement l\'affichage du bouton qui l\'appelle');

  console.log('OK — registre-personnel-bouton-module-17-09.test.js (garde interne du module RH présente dans openRegistreUniquePersonnelModal)');
}

try {
  runBoutonAbsentSansModuleRh();
  runBoutonPresentAvecModuleRh();
  runIndexEgaliteResteIndependant();
  runGardeInterneDeLaModale();
} catch (err) {
  console.error('ÉCHEC — registre-personnel-bouton-module-17-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
