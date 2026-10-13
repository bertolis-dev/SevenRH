/**
 * Seven RH — tour de l'application du 13/10/2026 : défauts confirmés dans le code puis corrigés (hors règles de droit
 * qui restent à valider). Chaque test échoue sur le code d'avant.
 */
process.env.TZ = 'Europe/Paris';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAppJs } = require('./load-app-js');

const lire = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const app = lire('app.js');

function setup() {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  const rh = api.DB.getEmployees().find(e => e.role === 'rh');
  api.DB._currentEmployeeId = rh.id;
  return api;
}

function runLeBaremeMotoEstContinu() {
  const { calculateIndemniteKilometrique } = setup().sandbox;
  // 20 km juste avant 6 000 km, moto 2 CV : l'indemnité ne doit jamais être négative (ancien tranche3 = 0,234 : -77,67 €)
  assert.ok(calculateIndemniteKilometrique(20, 2, 5990, { typeVehicule: 'moto' }) > 0, 'moto 1-2 CV : indemnité positive au passage du seuil de 6 000 km');
  assert.ok(calculateIndemniteKilometrique(20, 4, 5990, { typeVehicule: 'moto' }) > 0, 'moto 3-5 CV aussi');
  const cumul = (cv) => calculateIndemniteKilometrique(6000, cv, 0, { typeVehicule: 'moto' });
  const apres = (cv) => calculateIndemniteKilometrique(1000, cv, 6000, { typeVehicule: 'moto' });
  assert.ok(Math.abs(apres(2) / 1000 - 0.248) < 0.005 && Math.abs(apres(4) / 1000 - 0.275) < 0.001, 'taux marginal au-delà de 6 000 km cohérent avec la tranche précédente');
  assert.ok(cumul(2) > 0);
  console.log('OK — revue-13-10.test.js (barème moto continu au seuil de 6 000 km)');
}

function runUneNoteDejaPayeeNEstJamaisRecalculee() {
  const { recalculerIndemnitesKilometriquesAnnee } = setup().sandbox;
  const note = (id, extra) => ({ id, employeeId: 'e1', categorie: 'Kilométrique', date: '2026-03-01', dateCreation: `2026-03-0${id}T10:00:00Z`, statut: 'Remboursé', montantTTC: 1, kilometrage: { distanceKm: 1000, puissanceFiscale: 5, typeVehicule: 'voiture' }, ...extra });
  const mises = recalculerIndemnitesKilometriquesAnnee('e1', '2026', [note('1', { datePaiement: '2026-04-01' }), note('2', {})], {});
  const ids = Array.from(mises, m => m.id);
  assert.ok(!ids.includes('1'), 'une note déjà payée garde son montant');
  assert.ok(ids.includes('2'), 'une note non payée est toujours recalculée');
  console.log('OK — revue-13-10.test.js (recalcul kilométrique : les notes déjà payées ne sont jamais réécrites)');
}

function runLIndemniteCompensatriceInclutLaPeriodeEnCours() {
  const api = setup();
  const salarie = api.DB.getEmployees().find(e => e.role === 'salarie');
  api.employeeRepository.update(salarie.id, { dateEmbauche: '2018-01-01', salaireBrutMensuel: 3000 });
  const e = api.employeeRepository.getById(salarie.id);
  const cp = api.DB.getLeaveTypes().find(t => /congés payés/i.test(t.nom));
  const bilan = api.sandbox.getLeaveBalance(e, cp, api.DB.getLeaveRequests(), api.DB.getLeaveTypes(), '2026-12-31');
  assert.ok(bilan.enCoursAcquisition.acquis > 0, 'préalable : des jours sont acquis sur la période en cours');
  const ic = api.sandbox.calculateIndemniteCompensatrice(e, '2026-12-31');
  assert.ok(ic.joursRestants >= bilan.disponible + bilan.enCoursAcquisition.acquis - 0.01, `départ au 31/12 : ${ic.joursRestants} j dus, au moins disponible + acquis en cours`);
  console.log('OK — revue-13-10.test.js (indemnité compensatrice : jours de la période en cours inclus)');
}

function runLesDemiJourneesDeDebutEtFinCompteTSurLeBonMois() {
  const api = setup();
  const salarie = api.DB.getEmployees().find(e => e.role === 'salarie');
  const reglages = api.settingsRepository.getSettings();
  const { countRequestDaysInMonth } = api.sandbox;
  // du vendredi 30/10/2026 après-midi au lundi 02/11/2026 matin : 0,5 jour en octobre + 0,5 jour en novembre
  const octobre = countRequestDaysInMonth('2026-10-30', '2026-11-02', false, 2026, 9, salarie, reglages, 'ouvres', 'apres-midi', 'matin');
  const novembre = countRequestDaysInMonth('2026-10-30', '2026-11-02', false, 2026, 10, salarie, reglages, 'ouvres', 'apres-midi', 'matin');
  assert.strictEqual(octobre, 0.5, 'octobre : le vendredi après-midi seulement');
  assert.strictEqual(novembre, 0.5, 'novembre : le lundi matin seulement');
  console.log('OK — revue-13-10.test.js (demi-journées de début et de fin : 0,5 + 0,5, plus 1 + 1)');
}

function runLeMoisDePaieDUneNoteSuitLHeureLocale() {
  if (new Date('2026-10-31T23:30:00.000Z').getMonth() !== 10) { console.log('OK — revue-13-10.test.js (fuseau Europe/Paris indisponible sur cette machine, test sauté)'); return; }
  const { getExpensePayableMonthKey } = setup().sandbox;
  const cle = getExpensePayableMonthKey({ statut: 'Remboursé', historique: [{ action: 'Remboursé', date: '2026-10-31T23:30:00.000Z' }] });
  assert.strictEqual(cle, '2026-11', 'validée le 1er novembre à 00:30 heure de Paris : mois de novembre, pas octobre');
  console.log('OK — revue-13-10.test.js (mois de paie d\'une note : heure locale, pas UTC)');
}

function runLaClotureDuCompteurEstUneJourneeEntiere() {
  const { getCompteurPeriodBounds, toISODate } = setup().sandbox;
  const b = getCompteurPeriodBounds('05-31', new Date(2026, 4, 31, 14, 0));
  assert.strictEqual(toISODate(b.periodEnd), '2026-05-31', 'le 31/05 à 14 h appartient encore à la période qui se clôt ce jour-là');
  console.log('OK — revue-13-10.test.js (clôture du compteur : jour entier, jamais une date-heure)');
}

function runLesEcartsDePointageVoientTousLesCreneauxDuJour() {
  const { calculerEcartsPointageJour } = setup().sandbox;
  const shifts = [
    { employeeId: 'e1', weekday: 'Lun', heureDebut: '08:00', heureFin: '12:00', pauseMinutes: 0 },
    { employeeId: 'e1', weekday: 'Lun', heureDebut: '14:00', heureFin: '18:00', pauseMinutes: 0 }
  ];
  const ecarts = calculerEcartsPointageJour('e1', '2026-10-05', 'Lun', shifts, [{ heureArrivee: '08:00', heureDepart: '18:00' }], 10);
  assert.strictEqual(ecarts.length, 0, 'matin + après-midi, pointé de 08:00 à 18:00 : aucun faux dépassement ni faux départ anticipé');
  console.log('OK — revue-13-10.test.js (écarts de pointage : journée matin + après-midi)');
}

async function runLExportPaieGardeLesMemesColonnesQueLesDonnees() {
  const api = setup();
  const company = api.DB.getCurrentCompany();
  company.abonnement = { ...company.abonnement, offre: 'a_la_carte', modules: [{ key: 'rh' }, { key: 'tickets' }] };
  api.DB.saveCurrentCompany(company);
  let captures = null;
  api.sandbox.exportRowsToCSVWithDelimiter = (entetes, lignes) => { captures = { entetes, lignes }; };
  api.state.paieYear = new Date().getFullYear();
  api.state.paieMonth = new Date().getMonth();
  api.sandbox.exportPaieCSV();
  assert.ok(captures && captures.lignes.length > 0, 'préalable : un export est produit');
  captures.lignes.forEach(l => assert.strictEqual(l.length, captures.entetes.length, `ligne de ${l.length} colonnes pour ${captures.entetes.length} en-têtes : décalage (module Congés non souscrit)`));
  console.log('OK — revue-13-10.test.js (export paie : autant de colonnes que d\'en-têtes sans le module Congés)');
}

function runLImportRespecteLesDatesEtLePlafond() {
  const { parseImportDate } = setup().sandbox;
  assert.strictEqual(parseImportDate('31/02/2026'), '', '31 février : refusé');
  assert.strictEqual(parseImportDate('99/99/2026'), '');
  assert.strictEqual(parseImportDate('13/01/2026'), '2026-01-13');
  assert.strictEqual(parseImportDate('29/02/2028'), '2028-02-29', 'année bissextile acceptée');
  assert.strictEqual(parseImportDate('2026-02-30'), '');
  assert.ok(/plafond = abonnement \? abonnement\.nombreSalariesMax/.test(app.slice(app.indexOf('async function importEmployeesRows'), app.indexOf('async function importEmployeesRows') + 1200)), 'l\'import applique le plafond de l\'offre');
  console.log('OK — revue-13-10.test.js (import : dates impossibles refusées, plafond de l\'offre appliqué)');
}

async function runLImportNeCreePasAuDelaDuPlafond() {
  const api = setup();
  const company = api.DB.getCurrentCompany();
  const actifs = api.DB.getEmployees().filter(e => !e.archive).length;
  company.abonnement = { ...company.abonnement, nombreSalariesMax: actifs };
  api.DB.saveCurrentCompany(company);
  const res = await api.sandbox.importEmployeesRows([{ status: 'ok', record: { nom: 'Test', prenom: 'Import', email: 'import.plafond@example.fr', dateEmbauche: '2026-01-05', typeContrat: 'CDI' } }]);
  assert.strictEqual(res.created, 0, 'plafond atteint : aucune création');
  assert.strictEqual(res.plafondAtteint, 1);
  assert.strictEqual(api.DB.getEmployees().filter(e => !e.archive).length, actifs);
  console.log('OK — revue-13-10.test.js (import : aucune création au-delà du plafond)');
}

function runLesSortiesXssSontEchappees() {
  const { safeDataUrl } = setup().sandbox;
  assert.strictEqual(safeDataUrl('javascript:alert(1)'), '#');
  assert.strictEqual(safeDataUrl('https://evil.example/x'), '#');
  assert.strictEqual(safeDataUrl('data:text/html;base64,PHNjcmlwdD4='), 'data:text/html;base64,PHNjcmlwdD4=', 'une data: URL base64 passe (téléchargement)');
  assert.ok(safeDataUrl('data:image/png;base64,AAAA').startsWith('data:image/png'));
  ['data-open-idee="${escapeHtml(idee.id)}"', 'data-vote-idee="${escapeHtml(idee.id)}"', 'data-open-ticket="${escapeHtml(t.id)}"', 'data-open-bertolis-ticket="${escapeHtml(t.id)}"'].forEach(s => assert.ok(app.includes(s), `identifiant échappé : ${s}`));
  assert.ok(!/href="\$\{pieceJointe\.dataUrl\}"/.test(app) && !/href="\$\{v\.pieceJointe\.dataUrl\}"/.test(app), 'plus de href injecté sans contrôle');
  console.log('OK — revue-13-10.test.js (identifiants échappés, pièces jointes limitées aux data: URL)');
}

function runLesCorrectifsDInterfaceSontEnPlace() {
  assert.ok(/const filtresMobileOuverts = new Set\(\)/.test(app) && /filtresMobileOuverts\.has\(id\)/.test(app), 'barres de filtres mobiles : état conservé entre deux rendus');
  const logout = app.slice(app.indexOf("getElementById('btn-logout').addEventListener"), app.indexOf("getElementById('btn-logout').addEventListener") + 500);
  assert.ok(/user-menu-panel'\)\.classList\.remove\('open'\)/.test(logout), 'le menu utilisateur est refermé à la déconnexion');
  assert.ok(/modalMousedownCible === modalRoot/.test(app), 'la modale ne se ferme que si l\'appui a aussi eu lieu sur le fond');
  assert.ok(/demarrerRafraichissementPointageQr\(etab\.id\)/.test(app), 'le QR de pointage redémarre son rafraîchissement après « Régénérer le secret »');
  assert.ok(/\['nouvelle', 'entretien', 'offre'\]\.includes\(fresh\.statut\)/.test(app), 'embauche possible après « Entretien » et « Offre »');
  assert.ok(/boutonEmbauche\.disabled = true/.test(app), 'bouton « Embaucher » désactivé avant la vérification asynchrone');
  assert.ok(/valeur < Number\(min\)/.test(app) && /valeur > Number\(max\)/.test(app), 'les champs numériques de réglage respectent min et max');
  assert.ok(!/Object\.assign\(state, NAVPARAMS_FRAIS_A_VALIDER\)/.test(app), 'plus de partage par référence du filtre « notes à valider »');
  console.log('OK — revue-13-10.test.js (correctifs d\'interface en place)');
}

function runLaMigration0070() {
  const sql = lire('supabase', 'migrations', '0070_durcissement_revue_13_10.sql');
  assert.ok(/p_code is null or coalesce\(verifier_pointage_code\(p_etablissement_id, p_code\), false\) is not true/.test(sql), 'un code NULL ne passe plus la vérification du QR');
  assert.ok(/NEW\.auth_user_id := OLD\.auth_user_id/.test(sql) && /auth\.uid\(\) is not null/.test(sql), 'auth_user_id figé pour toute session authentifiée');
  assert.ok(/NEW\.manager_ids := OLD\.manager_ids/.test(sql), 'manager_ids réservé à modifierSalarie');
  assert.ok(/create or replace function save_company_profile/.test(sql) && /has_permission\('gererParametres'\)/.test(sql), 'écriture du blob par fonction, droit gererParametres conservé');
  assert.ok(/v_fusion := v_serveur/.test(sql), 'les pointages du serveur sont conservés par défaut');
  assert.ok(/safe_date\(d->>'dateDebut'\)/.test(sql) && /jsonb_typeof\(mgr\.data->'delegations'\) = 'array'/.test(sql), 'is_manager_of tolère une donnée mal formée');
  assert.ok(/p_statut in \('embauchee', 'archivee'\) and v_statut_actuel not in \('nouvelle', 'entretien', 'offre'\)/.test(sql) && /p_statut in \('entretien', 'offre'\) and v_statut_actuel in \('embauchee', 'archivee'\)/.test(sql), 'garde-fou des candidatures rétabli');
  assert.ok(/revoke all on function save_company_profile\(text, jsonb, boolean\) from public, anon/.test(sql) && /revoke all on function enregistrer_pointage\(text, text, jsonb\) from public, anon/.test(sql));
  const client = lire('supabase-client.js');
  assert.ok(/supabase\.rpc\('save_company_profile'/.test(client), 'le client écrit le blob par save_company_profile');
  const data = lire('data.js');
  assert.ok(/_pushCompanyDataBlob\(company, \{ pointages: true \}\)/.test(data), 'seule la régularisation envoie la liste des pointages');
  const reject = lire('supabase', 'functions', 'candidature-reject', 'index.ts');
  assert.ok(reject.indexOf('["nouvelle", "entretien", "offre"].includes(candidature.statut)') > 0 && reject.indexOf('["nouvelle", "entretien", "offre"].includes(candidature.statut)') < reject.indexOf('api.resend.com'), 'le statut est vérifié AVANT l\'envoi de l\'email de refus');
  console.log('OK — revue-13-10.test.js (migration 0070, client et fonction candidature-reject)');
}

(async () => {
  try {
    runLeBaremeMotoEstContinu();
    runUneNoteDejaPayeeNEstJamaisRecalculee();
    runLIndemniteCompensatriceInclutLaPeriodeEnCours();
    runLesDemiJourneesDeDebutEtFinCompteTSurLeBonMois();
    runLeMoisDePaieDUneNoteSuitLHeureLocale();
    runLaClotureDuCompteurEstUneJourneeEntiere();
    runLesEcartsDePointageVoientTousLesCreneauxDuJour();
    await runLExportPaieGardeLesMemesColonnesQueLesDonnees();
    runLImportRespecteLesDatesEtLePlafond();
    await runLImportNeCreePasAuDelaDuPlafond();
    runLesSortiesXssSontEchappees();
    runLesCorrectifsDInterfaceSontEnPlace();
    runLaMigration0070();
  } catch (err) {
    console.error('ÉCHEC — revue-13-10.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  }
})();
