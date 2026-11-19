/**
 * Retour du 18/11/2026 (essai de toutes les importations) :
 *  - import de l'historique : deux demi-journées complémentaires le même jour ne se chevauchent pas (retour de Christilla) ;
 *  - relevé bancaire : montants à la française (1 234,56 et 1.234,56), guillemets, dates JJ-MM-AAAA / JJ.MM.AAAA.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

const api = loadAppJs();
api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
api.DB.init();
const { DB } = api;
const sb = api.sandbox;

// --- chevauchement avec demi-journées ---
const base = [{ employeeId: 'e1', dateDebut: '2026-09-14', dateFin: '2026-09-14', demiJournee: 'matin', statut: 'Validé' }];
assert.strictEqual(sb.chevauchementImportAbsence(base, 'e1', '2026-09-14', '2026-09-14', 'apres-midi'), false, 'matin + après-midi : pas de chevauchement');
assert.strictEqual(sb.chevauchementImportAbsence(base, 'e1', '2026-09-14', '2026-09-14', 'matin'), true, 'deux fois le matin : chevauchement');
assert.strictEqual(sb.chevauchementImportAbsence(base, 'e1', '2026-09-14', '2026-09-14', null), true, 'journée entière sur une demi-journée : chevauchement');
assert.strictEqual(sb.chevauchementImportAbsence(base, 'e1', '2026-09-13', '2026-09-15', 'apres-midi'), true, 'une période qui contient le jour : chevauchement');
assert.strictEqual(sb.chevauchementImportAbsence(base, 'e2', '2026-09-14', '2026-09-14', 'matin'), false, 'autre salarié : aucun souci');
assert.strictEqual(sb.chevauchementImportAbsence([{ ...base[0], statut: 'Annulé' }], 'e1', '2026-09-14', '2026-09-14', 'matin'), false, 'une demande annulée ne compte pas');

// Aperçu complet d'un fichier avec deux demi-journées le même jour
const salarie = DB.getEmployees().find(e => e.role === 'salarie');
const cp = DB.getLeaveTypes().find(t => /congés payés/i.test(t.nom) && t.actif);
const mapping = api.guessAbsencesColumnMapping(['Matricule', 'Type', 'Date début', 'Date fin', 'Demi-journée']);
const lignes = api.buildAbsencesPreviewRows([
  [salarie.matricule, cp.nom, '15/12/2026', '15/12/2026', 'Matin'],
  [salarie.matricule, cp.nom, '15/12/2026', '15/12/2026', 'Après-midi'],
  [salarie.matricule, cp.nom, '15/12/2026', '15/12/2026', 'Matin']
], mapping, 'conge');
assert.strictEqual(lignes[0].status, 'ok', lignes[0].message);
assert.strictEqual(lignes[1].status, 'ok', 'la seconde demi-journée est acceptée : ' + lignes[1].message);
assert.strictEqual(lignes[2].status, 'error', 'une troisième demi-journée identique est refusée');

// --- relevé bancaire ---
const csv = [
  'Date;Libellé;Montant',
  '03/11/2026;"RESTAURANT LE BON ACCUEIL";-1 234,56',
  '04-11-2026;TAXI PARIS;12.50',
  '05.11.2026;HÔTEL;"1.234,56"',
  '2026-11-06;PEAGE;-8,2',
  'pas une ligne;;'
].join('\r\n');
const resultat = api.releveBancaireRepository.importer(csv);
assert.ok(resultat.success);
assert.strictEqual(resultat.ajoutees, 4, 'quatre lignes valides importées');
const lignesReleve = DB.getRelevesBancaires();
const parLibelle = (l) => lignesReleve.find(x => x.libelle === l);
assert.strictEqual(parLibelle('RESTAURANT LE BON ACCUEIL').montant, 1234.56, 'espace des milliers et virgule décimale');
assert.strictEqual(parLibelle('HÔTEL').montant, 1234.56, 'point des milliers, virgule décimale et guillemets');
assert.strictEqual(parLibelle('TAXI PARIS').date, '2026-11-04', 'date JJ-MM-AAAA');
assert.strictEqual(parLibelle('HÔTEL').date, '2026-11-05', 'date JJ.MM.AAAA');
assert.strictEqual(parLibelle('PEAGE').montant, 8.2);
assert.strictEqual(api.releveBancaireRepository.importer(csv).ajoutees, 0, 'un second import du même fichier n\'ajoute aucun doublon');

console.log('OK — imports-corrections-18-11.test.js');

// --- Abonnement « à la carte » (retour du 19/11/2026) : on distingue « module absent » et « salarié sans licence » ---
(function licenceEtModule() {
  const courant = api.companyRepository.getCurrent();
  const mapping2 = api.guessAbsencesColumnMapping(['Matricule', 'Type', 'Date début', 'Date fin']);
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  const ligne = (emp) => api.buildAbsencesPreviewRows([[emp.matricule, cp.nom, '17/12/2026', '17/12/2026']], mapping2, 'conge')[0];

  courant.abonnement = Object.assign({}, courant.abonnement || {}, { offre: 'a_la_carte', modules: [{ key: 'conges', quantite: 2 }] });
  courant.moduleLicenses = { conges: [] };
  const sansLicence = ligne(salarie);
  assert.strictEqual(sansLicence.status, 'error');
  assert.strictEqual(sansLicence.licenceManquante, true, 'salarié sans licence : drapeau licenceManquante');
  assert.strictEqual(sansLicence.moduleManquant, false);
  assert.strictEqual(ligne(rh).status, 'ok', 'la RH est exemptée de licence');

  courant.moduleLicenses = { conges: [salarie.id] };
  assert.strictEqual(ligne(salarie).status, 'ok', 'avec une licence attribuée, la ligne passe');

  courant.abonnement.modules = [];
  const moduleAbsent = ligne(salarie);
  assert.strictEqual(moduleAbsent.moduleManquant, true, 'module Congés absent de l\'abonnement : drapeau moduleManquant');
  assert.strictEqual(moduleAbsent.licenceManquante, false);
  assert.ok(/ne fait pas partie de votre abonnement/.test(moduleAbsent.message), moduleAbsent.message);
  console.log('OK — licence Congés / module absent distingués dans l\'aperçu d\'import');
})();
