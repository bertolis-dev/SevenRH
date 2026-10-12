/**
 * Seven RH — brief du 12/10/2026, C1 (barème kilométrique) : paramétré PAR ANNÉE, valeurs vides tant que non
 * validées. Constat : constantes codées en dur, préremplies (2026 seulement, marquées « indicatives »), pas un
 * réglage, et l'année de la note n'était jamais utilisée. Corrigé : le barème de l'entreprise (Paramètres > Notes
 * de frais) est vide au départ et prime dès qu'il existe pour l'année de la note ; tant qu'il est vide, le barème
 * indicatif de la plateforme sert de repli, signalé comme NON VALIDÉ pour ne pas casser les notes existantes.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAppJs } = require('./load-app-js');

const ligne = (cvMax, t1, coef, fixe, t3) => ({ cvMax, tranche1: t1, tranche2Coef: coef, tranche2Fixe: fixe, tranche3: t3 });

function setup() {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  const rh = api.DB.getEmployees().find(e => e.role === 'rh');
  api.DB._currentEmployeeId = rh.id;
  return api;
}

function runLeBaremeDeLEntrepriseEstVideParDefautEtLIndicatifServeDeRepli() {
  const api = setup();
  const reglages = api.settingsRepository.getSettings();
  assert.strictEqual(Object.keys(reglages.baremesKilometriques).length, 0, 'aucun barème d\'entreprise au départ');
  const { infoBaremeKilometrique, calculateIndemniteKilometrique } = api.sandbox;
  const info = infoBaremeKilometrique('voiture', 2026, reglages);
  assert.strictEqual(info.source, 'indicatif', 'sans barème d\'entreprise : valeurs indicatives, signalées');
  assert.strictEqual(info.valide, false);
  // Comportement existant conservé : 1000 km, 5 CV = 1000 x 0,636
  assert.strictEqual(calculateIndemniteKilometrique(1000, 5, 0, { typeVehicule: 'voiture', annee: 2026, settings: reglages }), 636);
  assert.strictEqual(calculateIndemniteKilometrique(1000, 5, 0, { typeVehicule: 'voiture' }), 636, 'appel historique (sans réglages) inchangé');
  console.log('OK — c1b-bareme-kilometrique-12-10.test.js (barème d\'entreprise vide au départ, repli indicatif signalé non validé, calcul existant inchangé)');
}

function runLeBaremeDeLEntreprisePrimeEtSuitLAnneeDeLaNote() {
  const api = setup();
  const { infoBaremeKilometrique, calculateIndemniteKilometrique } = api.sandbox;
  const reglages = {
    ...api.settingsRepository.getSettings(),
    baremesKilometriques: {
      2026: { valide: true, voiture: [ligne(null, 1, 0.5, 100, 0.4)] },
      2027: { valide: true, voiture: [ligne(null, 2, 0.5, 100, 0.4)] }
    }
  };
  assert.strictEqual(infoBaremeKilometrique('voiture', 2026, reglages).source, 'entreprise');
  assert.strictEqual(calculateIndemniteKilometrique(1000, 5, 0, { typeVehicule: 'voiture', annee: 2026, settings: reglages }), 1000, 'barème 2026 de l\'entreprise : 1,00 €/km');
  assert.strictEqual(calculateIndemniteKilometrique(1000, 5, 0, { typeVehicule: 'voiture', annee: 2027, settings: reglages }), 2000, 'une note de 2027 utilise le barème 2027 (l\'année de la note compte)');
  assert.strictEqual(calculateIndemniteKilometrique(1000, 5, 0, { typeVehicule: 'voiture', annee: 2028, settings: reglages }), 2000, 'année sans barème : dernier barème antérieur de l\'entreprise');
  assert.strictEqual(infoBaremeKilometrique('moto', 2026, reglages).source, 'indicatif', 'motorisation non renseignée par l\'entreprise : repli indicatif signalé');
  console.log('OK — c1b-bareme-kilometrique-12-10.test.js (barème d\'entreprise prioritaire, choisi selon l\'année de la note)');
}

function runUnBaremeNonValideNEstPasUtilise() {
  const api = setup();
  const reglages = { ...api.settingsRepository.getSettings(), baremesKilometriques: { 2026: { valide: false, voiture: [ligne(null, 9, 0.5, 100, 0.4)] } } };
  const { infoBaremeKilometrique } = api.sandbox;
  assert.strictEqual(infoBaremeKilometrique('voiture', 2026, reglages).source, 'indicatif', 'un brouillon non confirmé par l\'entreprise ne sert jamais au calcul');
  console.log('OK — c1b-bareme-kilometrique-12-10.test.js (brouillon non validé ignoré)');
}

function runLaSaisieEstControlee() {
  const { normaliserBaremeKilometriqueSaisi } = setup().sandbox;
  const bon = normaliserBaremeKilometriqueSaisi({ voiture: [{ cvMax: '3', tranche1: '0,529', tranche2Coef: '0.316', tranche2Fixe: '1065', tranche3: '0,370' }, { cvMax: '', tranche1: '0.7', tranche2Coef: '0.4', tranche2Fixe: '1500', tranche3: '0.47' }] });
  assert.strictEqual(bon.ok, true);
  assert.strictEqual(bon.bareme.voiture[0].tranche1, 0.529, 'virgule décimale acceptée');
  assert.strictEqual(bon.bareme.voiture[1].cvMax, null, 'dernière tranche : « et plus » (null, jamais Infinity qui ne survit pas à l\'enregistrement)');
  assert.strictEqual(normaliserBaremeKilometriqueSaisi({ voiture: [{ cvMax: '3', tranche1: '-1', tranche2Coef: '1', tranche2Fixe: '1', tranche3: '1' }] }).ok, false, 'valeur négative refusée');
  assert.strictEqual(normaliserBaremeKilometriqueSaisi({ voiture: [{ cvMax: '3', tranche1: 'abc', tranche2Coef: '1', tranche2Fixe: '1', tranche3: '1' }] }).ok, false, 'texte refusé');
  assert.strictEqual(normaliserBaremeKilometriqueSaisi({ voiture: [{ cvMax: '5', tranche1: '1', tranche2Coef: '1', tranche2Fixe: '1', tranche3: '1' }, { cvMax: '3', tranche1: '1', tranche2Coef: '1', tranche2Fixe: '1', tranche3: '1' }] }).ok, false, 'puissances fiscales non croissantes refusées');
  console.log('OK — c1b-bareme-kilometrique-12-10.test.js (saisie contrôlée : virgule, négatifs, texte, ordre des puissances)');
}

function runLEcranDeReglageEtLeFormulaire() {
  const api = setup();
  const html = api.renderParametresNotesFrais();
  assert.ok(html.includes('Barème kilométrique'), 'carte « Barème kilométrique » dans Paramètres > Notes de frais');
  assert.ok(/indicatif/i.test(html) && /non validé/i.test(html), 'la carte annonce que le barème indicatif n\'est pas validé');
  assert.ok(html.includes('id="btn-bareme-preremplir"') && html.includes('id="btn-bareme-enregistrer"'), 'préremplir puis enregistrer');
  assert.ok(html.includes('id="f-bareme-confirme"'), 'case de confirmation : l\'entreprise atteste avoir vérifié les valeurs');
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.ok(/calculateIndemniteKilometrique\(distanceKm, puissanceFiscale, kmDejaDeclares, \{ typeVehicule, electrique, annee: [^}]*settings: [^}]*\}\)/.test(app), 'le formulaire passe l\'année de la note et les réglages');
  console.log('OK — c1b-bareme-kilometrique-12-10.test.js (écran de réglage, case de confirmation, année de la note transmise au calcul)');
}

try {
  runLeBaremeDeLEntrepriseEstVideParDefautEtLIndicatifServeDeRepli();
  runLeBaremeDeLEntreprisePrimeEtSuitLAnneeDeLaNote();
  runUnBaremeNonValideNEstPasUtilise();
  runLaSaisieEstControlee();
  runLEcranDeReglageEtLeFormulaire();
} catch (err) {
  console.error('ÉCHEC — c1b-bareme-kilometrique-12-10.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
