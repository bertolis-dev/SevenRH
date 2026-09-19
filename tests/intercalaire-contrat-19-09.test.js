/**
 * Seven RH — retour Betty du 19/09/2026 (point 1.3, "la partie contrat, à développer") : "il
 * n'existe aujourd'hui aucune notion de contrat dans les données... pour deux CDD qui se suivent, le
 * second efface le premier." Et : "un avenant... ne modifie rien... le changement de salaire, lui,
 * est tracé ailleurs... deux historiques parallèles qui ne se parlent pas."
 *
 * Conception retenue (elle m'a laissé trancher, "continue fais tout d'un coup") : plutôt que de
 * réécrire les ~40 endroits qui lisent déjà les champs à plat de l'employé (typeContrat,
 * dateEmbauche, salaireBrutMensuel...), ces champs RESTENT la source de vérité pour tout le reste de
 * l'application — DB.addContrat/DB.addAvenant les reportent automatiquement depuis le contrat le
 * plus récent. employee.contrats devient une vraie SUITE (jamais une valeur écrasée), et un avenant
 * avec champModifie/nouvelleValeur change réellement la valeur (et alimente historiqueSalaire au
 * passage pour un changement de salaire). dateEmbauche n'est jamais touchée : l'ancienneté continue
 * de s'accumuler sans interruption à travers un changement de contrat.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function setup() {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  const rh = api.DB.getEmployees().find(e => e.role === 'rh');
  api.DB._currentEmployeeId = rh.id;
  return { ...api, rh };
}

async function runNouveauContratSAjouteALaSuiteSansEffacerLePrecedent() {
  const { employeeRepository } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  employeeRepository.update(salarie.id, { dateEmbauche: '2020-01-01', typeContrat: 'CDD', dateFinContrat: '', salaireBrutMensuel: 2200 });
  // Contrat n°1 (comme le ferait la migration de rattrapage pour une fiche déjà existante).
  employeeRepository.ajouterContrat(salarie.id, { dateDebut: '2020-01-01', typeContrat: 'CDD', tempsTravail: 'Temps plein', forfait: 'Aucun', salaireBrutMensuel: 2200 });

  employeeRepository.ajouterContrat(salarie.id, { dateDebut: '2026-07-01', typeContrat: 'CDI', tempsTravail: 'Temps plein', forfait: 'Aucun', salaireBrutMensuel: 2500 });

  const employe = employeeRepository.getById(salarie.id);
  assert.strictEqual(employe.contrats.length, 2, 'les DEUX contrats doivent rester visibles, jamais le premier écrasé par le second');
  const [premier, second] = employe.contrats;
  assert.strictEqual(premier.typeContrat, 'CDD');
  assert.strictEqual(premier.dateFin, '2026-06-30', 'le contrat précédent doit être clôturé à la veille du nouveau, automatiquement');
  assert.strictEqual(second.typeContrat, 'CDI');
  assert.strictEqual(second.dateFin, '', 'le nouveau contrat est le contrat courant : pas de date de fin');

  console.log('OK — intercalaire-contrat-19-09.test.js (un nouveau contrat s\'ajoute à la suite, jamais un remplacement)');
}

async function runNouveauContratReporteLesValeursSurLesChampsAPlat() {
  const { employeeRepository } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  employeeRepository.update(salarie.id, { dateEmbauche: '2020-01-01', typeContrat: 'CDD', salaireBrutMensuel: 2200 });

  employeeRepository.ajouterContrat(salarie.id, { dateDebut: '2026-07-01', typeContrat: 'CDI', tempsTravail: 'Temps plein', forfait: 'Aucun', salaireBrutMensuel: 2500 });

  const employe = employeeRepository.getById(salarie.id);
  // §confirmation du choix de conception : les dizaines d'endroits qui lisent DÉJÀ ces champs à
  // plat (paie estimée, effectifs, tickets restaurant, exports...) doivent rester corrects SANS
  // être réécrits — donc le champ à plat doit refléter le contrat le plus récent.
  assert.strictEqual(employe.typeContrat, 'CDI', 'le champ à plat typeContrat doit refléter le nouveau contrat');
  assert.strictEqual(employe.salaireBrutMensuel, 2500, 'le champ à plat salaireBrutMensuel doit refléter le nouveau contrat');

  console.log('OK — intercalaire-contrat-19-09.test.js (nouveau contrat : les champs à plat reflètent le contrat le plus récent, sans réécrire les consommateurs existants)');
}

async function runDateEmbaucheJamaisTouchee() {
  const { employeeRepository } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  employeeRepository.update(salarie.id, { dateEmbauche: '2020-01-01', typeContrat: 'CDD' });

  employeeRepository.ajouterContrat(salarie.id, { dateDebut: '2026-07-01', typeContrat: 'CDI', tempsTravail: 'Temps plein', forfait: 'Aucun', salaireBrutMensuel: 2500 });

  const employe = employeeRepository.getById(salarie.id);
  assert.strictEqual(employe.dateEmbauche, '2020-01-01', 'dateEmbauche ne doit JAMAIS être modifiée par un nouveau contrat : c\'est ce qui permet à l\'ancienneté de continuer à s\'accumuler sans interruption');

  console.log('OK — intercalaire-contrat-19-09.test.js (dateEmbauche jamais touchée : l\'ancienneté continue sur la suite de contrats)');
}

async function runUnContratDejaCloARAveniAvantSaProprePasEcrasee() {
  const { employeeRepository } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  employeeRepository.update(salarie.id, { dateEmbauche: '2020-01-01', typeContrat: 'CDD', dateFinContrat: '2026-05-31' });

  employeeRepository.ajouterContrat(salarie.id, { dateDebut: '2026-07-01', typeContrat: 'CDI', tempsTravail: 'Temps plein', forfait: 'Aucun', salaireBrutMensuel: 2500 });

  // Le backfill (via update ci-dessus, hors migration) ne crée pas de contrat n°1 automatiquement —
  // ce test vérifie plutôt qu'un ajout sur un employé SANS contrat encore enregistré ne plante pas.
  const employe = employeeRepository.getById(salarie.id);
  assert.strictEqual(employe.contrats.length, 1, 'sans contrat n°1 préexistant, seul le nouveau contrat doit apparaître (rien à clôturer)');

  console.log('OK — intercalaire-contrat-19-09.test.js (ajouter un contrat sur une fiche sans historique préalable ne plante pas)');
}

async function runAvenantAvecChampModifieChangeReellementLaValeur() {
  const { employeeRepository, DB } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  employeeRepository.update(salarie.id, { dateEmbauche: '2020-01-01', typeContrat: 'CDI', salaireBrutMensuel: 2500 });
  employeeRepository.ajouterContrat(salarie.id, { dateDebut: '2020-01-01', typeContrat: 'CDI', tempsTravail: 'Temps plein', forfait: 'Aucun', salaireBrutMensuel: 2500 });
  const contratId = employeeRepository.getById(salarie.id).contrats[0].id;

  const auditAvant = DB.getAuditLog().length;
  employeeRepository.ajouterAvenant(salarie.id, {
    type: 'Rémunération', date: '2026-09-01', description: 'Augmentation annuelle',
    contratId, champModifie: 'salaireBrutMensuel', nouvelleValeur: '2800'
  });

  const employe = employeeRepository.getById(salarie.id);
  assert.strictEqual(employe.salaireBrutMensuel, 2800, 'l\'avenant doit RÉELLEMENT changer le salaire sur la fiche, pas seulement le décrire en texte');
  assert.strictEqual(employe.contrats[0].salaireBrutMensuel, 2800, 'le contrat rattaché doit aussi refléter la nouvelle valeur');
  assert.ok(employe.historiqueSalaire.length >= 1, 'le changement de salaire doit alimenter historiqueSalaire (comme n\'importe quel autre chemin de changement de salaire)');
  const derniereEntreeSalaire = employe.historiqueSalaire[employe.historiqueSalaire.length - 1];
  assert.strictEqual(derniereEntreeSalaire.nouveauMontant, 2800);
  assert.ok(derniereEntreeSalaire.motif.includes('Avenant'), 'le motif de historiqueSalaire doit citer l\'avenant : les deux historiques, jusqu\'ici parallèles, doivent enfin se recouper');
  assert.ok(DB.getAuditLog().length > auditAvant, 'l\'avenant doit être tracé dans le journal d\'audit');

  console.log('OK — intercalaire-contrat-19-09.test.js (avenant avec champModifie : change réellement la valeur, sur l\'employé ET le contrat, alimente historiqueSalaire)');
}

async function runAvenantSansChampModifieResteUneSimpleNote() {
  const { employeeRepository } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  const salaireAvant = employeeRepository.getById(salarie.id).salaireBrutMensuel;

  employeeRepository.ajouterAvenant(salarie.id, { type: 'Autre', date: '2026-09-01', description: 'Simple note administrative', champModifie: null, nouvelleValeur: null });

  const employe = employeeRepository.getById(salarie.id);
  assert.strictEqual(employe.salaireBrutMensuel, salaireAvant, 'sans champModifie, aucune valeur ne doit changer : comportement identique à l\'ancien avenant purement narratif');
  assert.strictEqual(employe.avenants.length, 1);
  assert.strictEqual(employe.avenants[0].champModifie, null);

  console.log('OK — intercalaire-contrat-19-09.test.js (avenant sans champModifie : reste une simple note, rétrocompatible avec l\'ancien comportement)');
}

async function runMigrationBackfillReconstitueUnPremierContratSansPerte() {
  const { sandbox, ensureContratsBackfilled } = setup();
  const rh = { id: 'rh1', role: 'rh' };
  const company = {
    id: 'c1',
    employees: [
      { id: 'e1', prenom: 'Marc', nom: 'DURAND', dateEmbauche: '2019-03-15', typeContrat: 'CDI', dateFinContrat: '', tempsTravail: 'Temps plein', pourcentageActivite: 100, horairesHebdo: 35, forfait: 'Aucun', salaireBrutMensuel: 2600, contrats: [] }
    ]
  };
  sandbox.window.SupabaseSync = { pushEmployees: async () => {} };

  await ensureContratsBackfilled(company, rh);

  const employe = company.employees[0];
  assert.strictEqual(employe.contrats.length, 1);
  assert.strictEqual(employe.contrats[0].dateDebut, '2019-03-15', 'le contrat n°1 doit reprendre la date d\'embauche existante, sans perte');
  assert.strictEqual(employe.contrats[0].typeContrat, 'CDI');
  assert.strictEqual(employe.contrats[0].salaireBrutMensuel, 2600);

  console.log('OK — intercalaire-contrat-19-09.test.js (migration : reconstitue un contrat n°1 pour une fiche déjà existante, sans perte de données)');
}

async function runMigrationIdempotenteEtReserveeALaPermission() {
  const { sandbox, ensureContratsBackfilled } = setup();
  sandbox.window.SupabaseSync = { pushEmployees: async () => { throw new Error('ne doit jamais être appelé : rien à migrer ou pas la permission'); } };

  // Déjà migré : aucun appel réseau.
  const companyDejaMigre = { id: 'c1', employees: [{ id: 'e1', contrats: [{ id: 'x' }] }] };
  await ensureContratsBackfilled(companyDejaMigre, { id: 'rh1', role: 'rh' });

  // Sans la permission (un simple salarié) : aucun appel réseau non plus.
  const companyNonMigre = { id: 'c2', employees: [{ id: 'e2', dateEmbauche: '2020-01-01', contrats: [] }] };
  await ensureContratsBackfilled(companyNonMigre, { id: 's1', role: 'salarie' });
  assert.strictEqual(companyNonMigre.employees[0].contrats.length, 0);

  console.log('OK — intercalaire-contrat-19-09.test.js (migration idempotente et réservée à MODIFIER_SALARIE, comme les migrations voisines)');
}

async function runOngletContratAfficheContratsEtAvenants() {
  const { employeeRepository, renderEmployeeContratTab } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  employeeRepository.update(salarie.id, { dateEmbauche: '2020-01-01', typeContrat: 'CDD' });
  employeeRepository.ajouterContrat(salarie.id, { dateDebut: '2020-01-01', typeContrat: 'CDD', tempsTravail: 'Temps plein', forfait: 'Aucun', salaireBrutMensuel: 2200 });
  employeeRepository.ajouterContrat(salarie.id, { dateDebut: '2026-07-01', typeContrat: 'CDI', tempsTravail: 'Temps plein', forfait: 'Aucun', salaireBrutMensuel: 2600 });
  employeeRepository.ajouterAvenant(salarie.id, { type: 'Poste', date: '2026-08-01', description: 'Changement de poste' });

  const employe = employeeRepository.getById(salarie.id);
  const html = renderEmployeeContratTab(employe, true);
  assert.ok(html.includes('CDD') && html.includes('CDI'), 'les deux contrats doivent apparaître');
  assert.ok(html.includes('Courant') && html.includes('Terminé'), 'le contrat courant et le contrat terminé doivent être distingués visuellement');
  assert.ok(html.includes('btn-nouveau-contrat') && html.includes('btn-ajouter-avenant'), 'les deux boutons d\'action doivent être présents pour qui peut modifier');
  assert.ok(html.includes('Changement de poste'), 'l\'avenant doit apparaître');

  console.log('OK — intercalaire-contrat-19-09.test.js (onglet Contrat : affiche la suite de contrats et les avenants)');
}

async function runOnEnglobalBoutonsAbsentsSansPermissionEdition() {
  const { employeeRepository, renderEmployeeContratTab } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  const html = renderEmployeeContratTab(employeeRepository.getById(salarie.id), false);
  assert.ok(!html.includes('btn-nouveau-contrat') && !html.includes('btn-ajouter-avenant'), 'sans droit de modification, aucun bouton d\'action ne doit apparaître');

  console.log('OK — intercalaire-contrat-19-09.test.js (onglet Contrat : boutons d\'action absents sans droit de modification)');
}

runNouveauContratSAjouteALaSuiteSansEffacerLePrecedent()
  .then(runNouveauContratReporteLesValeursSurLesChampsAPlat)
  .then(runDateEmbaucheJamaisTouchee)
  .then(runUnContratDejaCloARAveniAvantSaProprePasEcrasee)
  .then(runAvenantAvecChampModifieChangeReellementLaValeur)
  .then(runAvenantSansChampModifieResteUneSimpleNote)
  .then(runMigrationBackfillReconstitueUnPremierContratSansPerte)
  .then(runMigrationIdempotenteEtReserveeALaPermission)
  .then(runOngletContratAfficheContratsEtAvenants)
  .then(runOnEnglobalBoutonsAbsentsSansPermissionEdition)
  .catch((err) => {
    console.error('ÉCHEC — intercalaire-contrat-19-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
