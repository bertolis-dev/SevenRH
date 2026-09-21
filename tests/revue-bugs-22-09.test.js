/**
 * Seven RH — revue de bugs du 22/09/2026 ("fais le tour des bugs", demandée après la journée de
 * travail sur la Partie 3 de la lettre). Relecture ciblée des 7 commits du jour (Paramètres, fiche
 * salarié, organigramme, bloc Enfants, contrat enrichi + clauses, correctif CSS). Six corrections
 * retenues :
 *
 * 1. "Corriger le contrat" exposait désormais la date de fin (socle enrichi, point 3.1) sans jamais
 *    la valider contre le contrat SUIVANT — une correction pouvait produire deux contrats qui se
 *    chevauchent.
 * 2. "Générer un projet de contrat" (nouveau, point 3.1) n'avait AUCUN contrôle de permission à
 *    l'ouverture, contrairement à toutes les autres modales de sous-fiche (visite médicale, nouveau/
 *    corriger contrat) — et son bouton "Aperçu" écrit réellement (clauseIds) avant même d'afficher
 *    quoi que ce soit.
 * 3. Le bloc Enfants (nouveau, point 3.2) n'avait AUCUN contrôle de permission dans
 *    openEnfantModal/deleteEnfant, alors que renderEnfantsCard réserve ces actions à isSelf/
 *    MODIFIER_SALARIE — un simple manager avec VOIR_INFOS_FINANCIERES (donc qui VOIT la carte)
 *    aurait pu modifier des données personnelles sur des tiers mineurs via un appel direct.
 * 4. L'impression/export PDF de l'organigramme (nouveau, point 2.5) réutilisait renderOrgNode tel
 *    quel, qui masque les subordonnés d'une branche repliée À L'ÉCRAN (state.orgCollapsedIds) — un
 *    repli purement visuel disparaissait silencieusement du document imprimé.
 * 5. La recherche globale vers "Vacances scolaires" (sous-onglet de "Congés et absences", point 9)
 *    amenait sur le bon onglet mais jamais sur le bon sous-onglet (state.parametresTypesCategorie
 *    n'était jamais posé par le clic).
 * 6. DB.corrigerContrat repliait sur les valeurs ACTUELLES de l'employé (poste/classification/
 *    établissement...) pour N'IMPORTE QUEL contrat corrigé, y compris un contrat historique déjà
 *    clos — une correction partielle (ex. juste { clauseIds } depuis "Générer un projet") pouvait
 *    réécrire silencieusement l'historique d'un ancien contrat avec la situation d'aujourd'hui.
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

function runCorrigerContratRefuseUnChevauchementSurLaDateDeFin() {
  const appSource = require('fs').readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8');
  const fnStart = appSource.indexOf('function openCorrigerContratModal(');
  const fnEnd = appSource.indexOf('\nfunction ', fnStart + 30);
  const body = appSource.slice(fnStart, fnEnd);
  assert.ok(/suivant\s*&&\s*values\.dateFin\s*&&\s*values\.dateFin\s*>=\s*suivant\.dateDebut/.test(body),
    'la date de fin corrigée doit être refusée si elle atteint ou dépasse le début du contrat suivant, sous peine de chevauchement');

  console.log('OK — revue-bugs-22-09.test.js (1. "Corriger le contrat" refuse une date de fin qui chevaucherait le contrat suivant)');
}

function runGenererProjetContratVerifieLaPermission() {
  const { DB, employeeRepository, openGenererProjetContratModal, openApercuProjetContratModal, sandbox } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  const contrat = employeeRepository.ajouterContrat(salarie.id, { dateDebut: '2030-01-01', typeContrat: 'CDI', salaireBrutMensuel: 3000 });

  const comptabilite = DB.getEmployees().find(e => e.role === 'comptabilite');
  assert.ok(comptabilite, 'préalable du test : un compte "comptabilite" doit exister dans les données de démonstration');
  // Ce rôle n'a ni MODIFIER_SALARIE ni de relation manager sur ce salarié : les deux modales du
  // générateur de projet de contrat doivent refuser, comme "Nouveau contrat"/"Corriger le contrat".
  DB._currentEmployeeId = comptabilite.id;
  openGenererProjetContratModal(salarie.id, contrat.id);
  assert.strictEqual(sandbox.document.getElementById('modal-root').innerHTML, '', 'openGenererProjetContratModal doit refuser sans droit d\'édition sur cette fiche (modale non ouverte)');

  openApercuProjetContratModal(salarie.id, contrat.id);
  assert.strictEqual(sandbox.document.getElementById('modal-root').innerHTML, '', 'openApercuProjetContratModal doit refuser sans droit d\'édition sur cette fiche (modale non ouverte)');

  console.log('OK — revue-bugs-22-09.test.js (2. "Générer un projet de contrat" vérifie désormais le droit d\'édition, comme les modales voisines)');
}

function runBlocEnfantsVerifieLaPermission() {
  const { DB, employeeRepository, openEnfantModal, deleteEnfant, sandbox } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  employeeRepository.update(salarie.id, { enfants: [{ id: 'enf1', prenom: 'Léo', dateNaissance: '2026-01-01' }] });

  // Un manager (même de cette équipe) n'a pas MODIFIER_SALARIE par défaut : canEditEmployeeRecord
  // renverrait true (il gère la fiche en général), mais renderEnfantsCard réserve spécifiquement le
  // bloc Enfants à isSelf/MODIFIER_SALARIE — les deux fonctions doivent appliquer LA MÊME règle,
  // plus stricte que canEditEmployeeRecord.
  const manager = DB.getEmployees().find(e => e.role === 'manager');
  DB._currentEmployeeId = manager.id;
  openEnfantModal(salarie.id);
  assert.strictEqual(sandbox.document.getElementById('modal-root').innerHTML, '', 'un manager sans MODIFIER_SALARIE ne doit pas pouvoir ouvrir la modale d\'ajout d\'enfant');

  deleteEnfant(salarie.id, 'enf1');
  const current = employeeRepository.getById(salarie.id);
  assert.strictEqual(current.enfants.length, 1, 'un manager sans MODIFIER_SALARIE ne doit pas pouvoir supprimer un enfant');

  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;
  openEnfantModal(salarie.id);
  assert.notStrictEqual(sandbox.document.getElementById('modal-root').innerHTML, '', 'un RH (MODIFIER_SALARIE) doit toujours pouvoir ouvrir la modale d\'ajout d\'enfant');

  console.log('OK — revue-bugs-22-09.test.js (3. le bloc Enfants vérifie désormais le droit d\'édition, aligné sur renderEnfantsCard)');
}

function runImpressionOrganigrammeIgnoreLesBranchesRepliees() {
  const { DB, employeeRepository, buildOrgTree, renderOrgNode, state } = setup();
  const manager = DB.getEmployees().find(e => e.role === 'manager');
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie' && (e.managerIds || []).includes(manager.id));
  assert.ok(salarie, 'préalable du test : un salarié rattaché à ce manager doit exister dans les données de démonstration');

  state.orgCollapsedIds.add(manager.id);
  const employees = [manager, salarie];
  const { roots, childrenOf } = buildOrgTree(employees);

  const htmlEcran = roots.map(r => renderOrgNode(r, childrenOf)).join('');
  assert.ok(!htmlEcran.includes(`data-org-employee="${salarie.id}"`), 'à l\'écran, une branche repliée doit rester masquée (comportement normal, non régressé)');

  const htmlImpression = roots.map(r => renderOrgNode(r, childrenOf, true)).join('');
  assert.ok(htmlImpression.includes(`data-org-employee="${salarie.id}"`), 'forceExpand=true (utilisé par l\'impression/export PDF) doit ignorer le repli et afficher toute la branche');

  console.log('OK — revue-bugs-22-09.test.js (4. impression/export PDF de l\'organigramme n\'omet plus les branches repliées à l\'écran)');
}

function runRechercheVacancesScolairesOuvreLeBonSousOnglet() {
  const { performGlobalSearch, navigateTo, state } = setup();
  const results = performGlobalSearch('zone scolaire');
  const resultat = results.find(r => r.label === 'Vacances scolaires');
  assert.ok(resultat, 'une recherche "zone scolaire" doit proposer un résultat "Vacances scolaires"');
  assert.strictEqual(resultat.params.parametresTypesCategorie, 'vacances', 'le résultat doit porter parametresTypesCategorie, sinon le clic ouvre le bon onglet mais le mauvais sous-onglet');

  navigateTo(resultat.nav, resultat.params);
  assert.strictEqual(state.parametresTab, 'types-absences');
  assert.strictEqual(state.parametresTypesCategorie, 'vacances', 'naviguer vers ce résultat doit réellement ouvrir le sous-onglet Vacances scolaires');

  console.log('OK — revue-bugs-22-09.test.js (5. la recherche "zone scolaire" ouvre directement le sous-onglet Vacances scolaires)');
}

function runCorrigerContratHistoriqueNeFalsifiePasAvecLaSituationActuelle() {
  const { employeeRepository } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');

  // Deux contrats : un ANCIEN (déjà clos, sans les nouveaux champs — reproduit un contrat créé avant
  // le socle enrichi du point 3.1) et un COURANT avec un poste différent.
  employeeRepository.update(salarie.id, {
    poste: 'Ingénieur', classification: 'Niveau IV', etablissementId: 'etab-actuel',
    contrats: [
      { id: 'ancien', dateDebut: '2020-01-01', dateFin: '2024-12-31', typeContrat: 'CDI', tempsTravail: 'Temps plein', salaireBrutMensuel: 2800 },
      { id: 'courant', dateDebut: '2025-01-01', dateFin: '', typeContrat: 'CDI', tempsTravail: 'Temps plein', salaireBrutMensuel: 3200, poste: 'Ingénieur', classification: 'Niveau IV', etablissementId: 'etab-actuel' }
    ]
  });

  // Simule "Générer un projet" sur le contrat ANCIEN : ne soumet que clauseIds, comme le fait
  // réellement openGenererProjetContratModal — ne doit RIEN inventer sur les autres champs.
  employeeRepository.corrigerContrat(salarie.id, 'ancien', { clauseIds: ['clause-1'] });

  const current = employeeRepository.getById(salarie.id);
  const ancienCorrige = current.contrats.find(c => c.id === 'ancien');
  assert.strictEqual(ancienCorrige.poste, '', 'un contrat historique corrigé sans préciser le poste ne doit JAMAIS emprunter le poste ACTUEL du salarié (falsification de l\'historique) — il doit rester tel quel (vide, faute de donnée d\'origine)');
  assert.strictEqual(ancienCorrige.classification, '');
  assert.strictEqual(ancienCorrige.etablissementId, '');
  assert.strictEqual(current.poste, 'Ingénieur', 'et la fiche affichée (mirorée depuis le contrat COURANT) ne doit évidemment pas changer non plus');

  // Contrôle positif : sur le contrat COURANT, le même repli reste nécessaire et fonctionne toujours
  // (comportement déjà couvert par contrat-enrichi-clauses-22-09.test.js, revérifié ici en contexte).
  employeeRepository.corrigerContrat(salarie.id, 'courant', { salaireBrutMensuel: 3300 });
  const courantCorrige = employeeRepository.getById(salarie.id).contrats.find(c => c.id === 'courant');
  assert.strictEqual(courantCorrige.poste, 'Ingénieur', 'sur le contrat COURANT, le poste doit rester celui déjà stocké sur CE contrat');

  console.log('OK — revue-bugs-22-09.test.js (6. corriger un contrat historique ne falsifie plus son poste/classification/établissement avec la situation actuelle)');
}

try {
  runCorrigerContratRefuseUnChevauchementSurLaDateDeFin();
  runGenererProjetContratVerifieLaPermission();
  runBlocEnfantsVerifieLaPermission();
  runImpressionOrganigrammeIgnoreLesBranchesRepliees();
  runRechercheVacancesScolairesOuvreLeBonSousOnglet();
  runCorrigerContratHistoriqueNeFalsifiePasAvecLaSituationActuelle();
} catch (err) {
  console.error('ÉCHEC — revue-bugs-22-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
