/**
 * Seven RH — retour Betty du 22/09/2026 (Partie 2, point 2.4, "Modifier le salarié") :
 *   - "Identité" éclatée en deux sous-sections ("État civil", "Adresse et coordonnées") plutôt
 *     qu'une seule longue liste de champs mélangeant les deux ;
 *   - "Nom" renommé "Nom de naissance" (distingué du "Nom d'usage", juste à côté désormais) ;
 *   - Nom de naissance et Nom d'usage côte à côte (.form-field-pair), de même que Code postal/Ville ;
 *   - le pavé orange permanent sous "Sexe (état civil)" (.form-hint, coloré comme un avertissement
 *     même pour une simple information) devient un "?" au survol/focus (fieldHelpIcon), comme le
 *     reste des champs du formulaire.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function setup() {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  const rh = api.DB.getEmployees().find(e => e.role === 'rh');
  api.DB._currentEmployeeId = rh.id;
  return api;
}

function runIdentiteEclateeEnDeuxSousSections() {
  const { sandbox, openEmployeeModal, employeeRepository } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  openEmployeeModal(salarie.id);
  const html = sandbox.document.getElementById('modal-root').innerHTML;

  const etatCivilIndex = html.indexOf('>État civil<');
  const adresseIndex = html.indexOf('>Adresse et coordonnées<');
  assert.ok(etatCivilIndex !== -1, 'la sous-section "État civil" doit exister');
  assert.ok(adresseIndex !== -1, 'la sous-section "Adresse et coordonnées" doit exister');
  assert.ok(etatCivilIndex < adresseIndex, '"État civil" doit précéder "Adresse et coordonnées"');

  console.log('OK — fiche-salarie-formulaire-identite-22-09.test.js (Identité éclatée en deux sous-sections)');
}

function runNomRenommeNomDeNaissanceEtApparieAuNomDusage() {
  const { sandbox, openEmployeeModal, employeeRepository } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  openEmployeeModal(salarie.id);
  const html = sandbox.document.getElementById('modal-root').innerHTML;

  assert.ok(html.includes('Nom de naissance'), 'le champ "Nom" doit être renommé "Nom de naissance"');
  assert.ok(!/for="f-nom">Nom\s*\*?</.test(html.replace('Nom de naissance', '')), 'l\'ancien libellé "Nom" seul (sans "de naissance") ne doit plus apparaître pour ce champ');

  const pairStart = html.indexOf('form-field-pair');
  const pairBlock = html.slice(pairStart, pairStart + 900);
  assert.ok(pairBlock.includes('id="f-nom"') && pairBlock.includes('id="f-nomUsage"'), 'Nom de naissance et Nom d\'usage doivent être dans le même bloc "côte à côte" (.form-field-pair)');

  console.log('OK — fiche-salarie-formulaire-identite-22-09.test.js ("Nom" renommé "Nom de naissance", apparié au Nom d\'usage)');
}

function runCodePostalEtVilleApparies() {
  const { sandbox, openEmployeeModal, employeeRepository } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  openEmployeeModal(salarie.id);
  const html = sandbox.document.getElementById('modal-root').innerHTML;

  const pairs = html.split('form-field-pair').slice(1); // un fragment par occurrence après le split
  const codePostalVillePair = pairs.find(p => p.includes('adresse.codePostal') && p.includes('adresse.ville'));
  assert.ok(codePostalVillePair, 'Code postal et Ville doivent être dans le même bloc "côte à côte" (.form-field-pair), séparés d\'Adresse (rue), plus large, sur sa propre ligne');

  console.log('OK — fiche-salarie-formulaire-identite-22-09.test.js (Code postal et Ville appariés, distincts d\'Adresse)');
}

function runOrangeWarningRemplaceeParUnTooltip() {
  const { sandbox, openEmployeeModal, employeeRepository } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  openEmployeeModal(salarie.id);
  const html = sandbox.document.getElementById('modal-root').innerHTML;

  const sexeFieldStart = html.indexOf('for="f-sexe"');
  const sexeField = html.slice(sexeFieldStart - 20, sexeFieldStart + 400);
  assert.ok(sexeField.includes('field-help'), 'le champ Sexe doit désormais porter un "?" (fieldHelpIcon), comme les autres champs du formulaire');
  assert.ok(!sexeField.includes('class="form-hint">Obligatoire'), 'le pavé texte permanent ("form-hint", coloré comme un avertissement) doit avoir disparu du champ Sexe');
  assert.ok(sexeField.includes('alimente le registre unique du personnel'), 'le texte d\'aide doit être conservé, seulement déplacé dans le tooltip');

  console.log('OK — fiche-salarie-formulaire-identite-22-09.test.js (pavé orange du champ Sexe remplacé par un tooltip "?")');
}

try {
  runIdentiteEclateeEnDeuxSousSections();
  runNomRenommeNomDeNaissanceEtApparieAuNomDusage();
  runCodePostalEtVilleApparies();
  runOrangeWarningRemplaceeParUnTooltip();
} catch (err) {
  console.error('ÉCHEC — fiche-salarie-formulaire-identite-22-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
