/**
 * Seven RH — retour Betty du 22/09/2026 (Partie 2, point 2.5, "Organigramme") :
 *   - le rôle applicatif (RH/Manager/Salarié...) n'a rien à faire dans un organigramme, qui reflète
 *     la hiérarchie RÉELLE de l'entreprise, pas les droits d'accès à Nexus — retiré, seul le poste
 *     reste affiché ;
 *   - un poste manquant sur la fiche d'un salarié devient un repère de qualité de données visible
 *     ("Poste manquant"), et rejoint le contrôle des dossiers (getDataQualityIssues), au lieu d'un
 *     simple tiret muet ;
 *   - en-tête complet (logo/raison sociale/adresse/effectif/date) + impression/export PDF natif du
 *     navigateur (priorité), + export Excel nominatif avec le rattachement hiérarchique — jamais un
 *     export PowerPoint/.pptx (aucune dépendance fiable pour ça dans ce projet 100% vanilla JS).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAppJs } = require('./load-app-js');

function setup() {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  const rh = api.DB.getEmployees().find(e => e.role === 'rh');
  api.DB._currentEmployeeId = rh.id;
  return api;
}

function runRoleApplicatifRetireDeLorganigramme() {
  const { sandbox, DB, navigateTo, employeeRepository } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  employeeRepository.update(salarie.id, { poste: 'Comptable' });

  navigateTo('organigramme');
  const html = sandbox.document.getElementById('view-root').innerHTML;

  assert.ok(!html.includes('badge-primary'), 'le badge de rôle applicatif (RH/Manager/Salarié) ne doit plus apparaître sur l\'organigramme');
  assert.ok(html.includes('Comptable'), 'le poste doit rester affiché');

  console.log('OK — organigramme-poste-export-22-09.test.js (rôle applicatif retiré, seul le poste reste affiché)');
}

function runPosteManquantSignaleAuLieuDunTiretMuet() {
  const { sandbox, navigateTo, employeeRepository } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  employeeRepository.update(salarie.id, { poste: '' });

  navigateTo('organigramme');
  const html = sandbox.document.getElementById('view-root').innerHTML;
  assert.ok(html.includes('org-node-poste-manquant'), 'un poste manquant doit être signalé visuellement, pas un simple tiret muet');
  assert.ok(html.includes('Poste manquant'), 'le repère doit être explicite');

  console.log('OK — organigramme-poste-export-22-09.test.js (poste manquant signalé, jamais un tiret muet)');
}

function runPosteManquantRemonteDansLeControleDesDossiers() {
  const { DB, getDataQualityIssues, employeeRepository } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  employeeRepository.update(salarie.id, { poste: '' });

  const issues = getDataQualityIssues();
  const sansPoste = issues.find(i => i.label === 'Sans poste');
  assert.ok(sansPoste, '"Sans poste" doit apparaître dans le contrôle des dossiers');
  assert.ok(sansPoste.employees.some(e => e.id === salarie.id), 'le salarié sans poste doit figurer dans cette anomalie');

  console.log('OK — organigramme-poste-export-22-09.test.js (poste manquant remonté dans le contrôle des dossiers)');
}

function runEnTeteEtImpressionAvecEffectifEtDate() {
  const { sandbox, openOrganigrammePrintModal, employeeRepository } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  employeeRepository.update(salarie.id, { poste: 'Comptable' });

  openOrganigrammePrintModal();
  const html = sandbox.document.getElementById('modal-root').innerHTML;
  assert.ok(html.includes('print-header'), 'l\'en-tête commun (logo, raison sociale, adresse, date) doit être présent');
  assert.ok(html.includes('print-title') && html.includes('>Organigramme<'), 'le titre du document doit être "Organigramme"');
  assert.ok(/salarié.*actif/.test(html), 'l\'effectif doit être visible dans l\'en-tête imprimé');
  assert.ok(html.includes('id="btn-print-organigramme-confirm"'), 'un bouton d\'impression/export PDF doit être proposé dans la modale');

  console.log('OK — organigramme-poste-export-22-09.test.js (en-tête complet + impression/export PDF)');
}

function runExportExcelNominatifJamaisPowerpoint() {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const fnStart = appSource.indexOf('function exportOrganigrammeExcel(');
  const fnBody = appSource.slice(fnStart, appSource.indexOf('\n}', fnStart));

  assert.ok(fnBody.includes('buildExcelXmlWorkbook') && fnBody.includes('downloadExcelXmlFile'), 'l\'export doit produire un vrai classeur Excel (même générateur que les autres exports de l\'application)');
  assert.ok(fnBody.includes("'Manager(s)'"), 'le tableau nominatif doit inclure le rattachement hiérarchique (manager), pas une simple liste à plat');
  assert.ok(!/pptx|powerpoint/i.test(fnBody), 'jamais un export PowerPoint : aucune dépendance fiable pour ça dans ce projet 100% vanilla JS');

  console.log('OK — organigramme-poste-export-22-09.test.js (export Excel nominatif avec rattachement hiérarchique, jamais PowerPoint)');
}

try {
  runRoleApplicatifRetireDeLorganigramme();
  runPosteManquantSignaleAuLieuDunTiretMuet();
  runPosteManquantRemonteDansLeControleDesDossiers();
  runEnTeteEtImpressionAvecEffectifEtDate();
  runExportExcelNominatifJamaisPowerpoint();
} catch (err) {
  console.error('ÉCHEC — organigramme-poste-export-22-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
