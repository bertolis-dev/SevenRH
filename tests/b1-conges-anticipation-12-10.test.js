/**
 * Seven RH — brief du 12/10/2026, B1 : congés par anticipation. Constat : les jours en cours d'acquisition
 * n'entraient jamais dans le disponible, mais RIEN ne contrôlait une demande qui dépasse le solde (la paie
 * levait seulement une anomalie bloquante après coup) et aucun réglage n'existait. Option par entreprise :
 *   - « interdit » (défaut) : une demande ne peut pas dépasser le solde immédiatement disponible ;
 *   - « autorise_acquis_a_date » : elle peut aller jusqu'aux jours déjà acquis à date sur la période en cours.
 * Règle juridique non tranchée par le code : voir docs/regles-a-valider.md.
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

function typeAvecCloture(api) {
  // Type de test explicite : 25 jours / an, acquisition mensuelle, clôture au 31 mai, report intégral.
  return api.DB.addLeaveType({ nom: 'Congés test B1', categorie: 'conge', acquisition: 'Mensuelle', nombreAnnuel: 24, dateClotureCompteur: '05-31', actif: true, illimite: false });
}

function runLeReglageExisteEtVautInterditParDefaut() {
  const api = setup();
  assert.strictEqual(api.settingsRepository.getSettings().congesAnticipation, 'interdit', 'défaut : interdit');
  const html = api.sandbox.renderParametresTypesAbsences();
  assert.ok(html.includes('id="f-conges-anticipation"'), 'le réglage est dans Paramètres > Congés et absences');
  assert.ok(/à valider/i.test(html), 'la règle est signalée comme à valider');
  console.log('OK — b1-conges-anticipation-12-10.test.js (réglage par entreprise, « interdit » par défaut, mention « à valider »)');
}

function runUneDemandeAuDessusDuSoldeEstRefuseeSiInterdit() {
  const api = setup();
  const salarie = api.DB.getEmployees().find(e => e.role === 'salarie');
  const type = typeAvecCloture(api);
  api.employeeRepository.update(salarie.id, { dateEmbauche: '2020-01-01' });
  const { verifierSoldeDemandeConge } = api.sandbox;
  const reglages = { ...api.settingsRepository.getSettings(), congesAnticipation: 'interdit' };
  const types = api.DB.getLeaveTypes();
  const bilan = api.sandbox.getLeaveBalance(api.employeeRepository.getById(salarie.id), type, [], types, '2026-07-01');
  assert.ok(bilan.enCoursAcquisition && bilan.enCoursAcquisition.acquis > 0, 'préalable : des jours s\'acquièrent sur la période en cours');

  const trop = bilan.disponible + 1;
  const refus = verifierSoldeDemandeConge(api.employeeRepository.getById(salarie.id), type, trop, [], types, reglages, '2026-07-01');
  assert.strictEqual(refus.ok, false, 'demande au-dessus du disponible : refusée si interdit');
  assert.ok(/solde/i.test(refus.message) && /acquisition/i.test(refus.message), 'le message explique pourquoi (jours en cours d\'acquisition)');
  const ok = verifierSoldeDemandeConge(api.employeeRepository.getById(salarie.id), type, bilan.disponible, [], types, reglages, '2026-07-01');
  assert.strictEqual(ok.ok, true, 'jusqu\'au solde disponible : acceptée');
  console.log('OK — b1-conges-anticipation-12-10.test.js (anticipation interdite : plafond = solde disponible, message clair)');
}

function runLAnticipationAutoriseeVaJusquAuxJoursAcquisADate() {
  const api = setup();
  const salarie = api.DB.getEmployees().find(e => e.role === 'salarie');
  const type = typeAvecCloture(api);
  api.employeeRepository.update(salarie.id, { dateEmbauche: '2020-01-01' });
  const { verifierSoldeDemandeConge, getLeaveBalance } = api.sandbox;
  const types = api.DB.getLeaveTypes();
  const e = api.employeeRepository.getById(salarie.id);
  const bilan = getLeaveBalance(e, type, [], types, '2026-07-01');
  const reglages = { ...api.settingsRepository.getSettings(), congesAnticipation: 'autorise_acquis_a_date' };

  const limite = bilan.disponible + bilan.enCoursAcquisition.acquis;
  assert.strictEqual(verifierSoldeDemandeConge(e, type, limite, [], types, reglages, '2026-07-01').ok, true, 'autorisé jusqu\'aux jours acquis à date');
  const depasse = verifierSoldeDemandeConge(e, type, limite + 1, [], types, reglages, '2026-07-01');
  assert.strictEqual(depasse.ok, false, 'au-delà des jours acquis à date : refusé même en mode autorisé');
  console.log('OK — b1-conges-anticipation-12-10.test.js (anticipation autorisée : plafond = disponible + acquis à date de la période en cours)');
}

function runLesTypesIllimitesEtNonCongesNeSontPasControles() {
  const api = setup();
  const salarie = api.DB.getEmployees().find(e => e.role === 'salarie');
  const { verifierSoldeDemandeConge } = api.sandbox;
  const reglages = { ...api.settingsRepository.getSettings(), congesAnticipation: 'interdit' };
  const types = api.DB.getLeaveTypes();
  const illimite = types.find(t => t.illimite || t.acquisition === 'Illimitée');
  assert.ok(illimite, 'préalable : un type illimité existe (Maladie)');
  assert.strictEqual(verifierSoldeDemandeConge(api.employeeRepository.getById(salarie.id), illimite, 40, [], types, reglages, '2026-07-01').ok, true, 'un type illimité n\'a pas de solde à respecter');
  console.log('OK — b1-conges-anticipation-12-10.test.js (types illimités jamais contrôlés)');
}

function runLEcranEtLeFormulaireUtilisentLeControle() {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const i = app.indexOf('async function submitLeaveRequestForm');
  const corps = app.slice(i, i + 9000);
  assert.ok(/verifierSoldeDemandeConge\(/.test(corps), 'la soumission d\'une demande applique le contrôle');
  assert.ok(!/n'est jamais consommable avant sa propre clôture\.<\/p>/.test(app), 'le texte figé « jamais consommable » est remplacé par un texte qui suit le réglage');
  assert.ok(/libelleRegleAnticipationConges\(/.test(app), 'le texte de l\'écran des compteurs suit le réglage');
  console.log('OK — b1-conges-anticipation-12-10.test.js (formulaire de demande contrôlé, texte des compteurs adapté au réglage)');
}

try {
  runLeReglageExisteEtVautInterditParDefaut();
  runUneDemandeAuDessusDuSoldeEstRefuseeSiInterdit();
  runLAnticipationAutoriseeVaJusquAuxJoursAcquisADate();
  runLesTypesIllimitesEtNonCongesNeSontPasControles();
  runLEcranEtLeFormulaireUtilisentLeControle();
} catch (err) {
  console.error('ÉCHEC — b1-conges-anticipation-12-10.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
