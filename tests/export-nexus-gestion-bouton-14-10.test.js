/**
 * Seven RH — pont Nexus Gestion (14/10/2026), P1 : bouton « Exporter vers Nexus Gestion » dans la Préparation de paie ;
 * le mois est celui affiché (navigation existante), le fichier s'appelle nexus-rh-export-AAAA-MM.json, et l'export est
 * BLOQUÉ avec un message clair si le SIREN n'est pas valide. Aucun appel réseau : un simple téléchargement.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');
const { validerFormatV1 } = require('./export-nexus-gestion-14-10.test.js');

function setup(siret) {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  const rh = api.DB.getEmployees().find(e => e.role === 'rh');
  api.DB._currentEmployeeId = rh.id;
  const company = api.DB.getCurrentCompany();
  company.siret = siret;
  api.DB.saveCurrentCompany(company);
  api.state.paieYear = 2026;
  api.state.paieMonth = 9;
  return api;
}

function runLeBoutonEstDansLaPreparationDePaie() {
  const api = setup('443 061 841 00025');
  for (const tab of ['preparation', 'export']) {
    api.state.paieTab = tab;
    const html = api.sandbox.renderExportPaie();
    assert.ok(html.includes('id="btn-export-nexus-gestion"'), `bouton présent sur l'onglet ${tab}`);
    assert.ok(html.includes('Exporter vers Nexus Gestion'), 'libellé attendu');
  }
  const app = require('fs').readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8');
  assert.ok(/getElementById\('btn-export-nexus-gestion'\)/.test(app) && /exporterVersNexusGestion/.test(app), 'bouton câblé');
  console.log('OK — export-nexus-gestion-bouton-14-10.test.js (P1 : bouton présent sur les deux onglets de la Préparation de paie)');
}

function runLeFichierEstTelechargeAvecLeBonNom() {
  const api = setup('443 061 841 00025');
  let telechargement = null;
  api.sandbox.downloadJSONFile = (donnees, nom) => { telechargement = { donnees, nom }; };
  api.sandbox.exporterVersNexusGestion();
  assert.ok(telechargement, 'un fichier est produit');
  assert.strictEqual(telechargement.nom, 'nexus-rh-export-2026-10.json', 'nom du fichier AAAA-MM selon le mois affiché');
  const objet = JSON.parse(JSON.stringify(telechargement.donnees));
  validerFormatV1(objet);
  assert.strictEqual(objet.periode, '2026-10');
  assert.strictEqual(objet.siren, '443061841');

  api.state.paieMonth = 10;
  api.sandbox.exporterVersNexusGestion();
  assert.strictEqual(telechargement.nom, 'nexus-rh-export-2026-11.json', 'changer de mois change le fichier');
  console.log('OK — export-nexus-gestion-bouton-14-10.test.js (P1 : téléchargement nexus-rh-export-AAAA-MM.json, format valide)');
}

function runSansSirenValideRienNEstTelecharge() {
  const api = setup('');
  let telechargement = null;
  api.sandbox.downloadJSONFile = (c, n) => { telechargement = { c, n }; };
  const messages = [];
  api.sandbox.showToast = (texte, type) => messages.push({ texte, type });
  api.sandbox.exporterVersNexusGestion();
  assert.strictEqual(telechargement, null, 'aucun fichier sans SIREN');
  assert.ok(messages.some(m => m.type === 'error' && /SIRET/.test(m.texte) && /Paramètres/.test(m.texte)), 'message clair affiché');
  console.log('OK — export-nexus-gestion-bouton-14-10.test.js (P4 : export bloqué avec un message clair sans SIREN valide)');
}

function runLExportEstJournalise() {
  const api = setup('443 061 841 00025');
  api.sandbox.downloadJSONFile = () => {};
  const avant = api.DB.getAuditLog().length;
  api.sandbox.exporterVersNexusGestion();
  const journal = api.DB.getAuditLog();
  assert.strictEqual(journal.length, avant + 1);
  assert.ok(/Nexus Gestion/.test(journal[0].entite) && journal[0].action === 'Export', 'trace dans le journal d\'audit');
  console.log('OK — export-nexus-gestion-bouton-14-10.test.js (export tracé dans le journal d\'audit)');
}

try {
  runLeBoutonEstDansLaPreparationDePaie();
  runLeFichierEstTelechargeAvecLeBonNom();
  runSansSirenValideRienNEstTelecharge();
  runLExportEstJournalise();
} catch (err) {
  console.error('ÉCHEC — export-nexus-gestion-bouton-14-10.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
