/**
 * Seven RH — retour Betty du 22/09/2026 (Partie 3, point 3.1, "le modèle de contrat est trop
 * pauvre") :
 *   - le socle du contrat gagne motif de recours, poste, classification, statut cadre,
 *     établissement, période d'essai (+ renouvellement), primes récurrentes, part variable,
 *     avantages en nature, commentaire libre — "Nouveau contrat" n'en exposait jusqu'ici que 5 des
 *     9 champs du modèle (pourcentageActivite/horairesHebdo recopiés en silence, jamais saisis) ;
 *   - dateFin et motif de recours deviennent obligatoires pour un CDD/intérim ;
 *   - le POSTE (et l'établissement, la fin de période d'essai) appartiennent désormais au contrat,
 *     comme le type de contrat : plus modifiables directement depuis "Modifier le salarié" en
 *     édition, seulement via un nouveau contrat ou une correction ;
 *   - les congés/RTT ne sont JAMAIS dupliqués dans le modèle de contrat (aucun champ ajouté ici) ;
 *   - une bibliothèque de clauses réutilisables (clauseContratRepository), fusionnées avec les
 *     données réelles du contrat pour générer un PROJET de contrat, toujours accompagné d'un
 *     avertissement légal explicite (jamais prêt à signer).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

/** §le bac à sable de test n'est pas un vrai DOM : document.getElementById renvoie un objet stub
 * persistant par id (voir load-app-js.js), dont `.value` n'est JAMAIS auto-rempli depuis le HTML
 * généré (innerHTML n'est qu'une chaîne stockée, pas parsée) — chaque champ lu par
 * readAndValidateContratForm doit donc recevoir une valeur explicite avant l'appel, même un champ
 * qu'on ne teste pas directement, sous peine de `.value` undefined (`.trim()` plante alors). Valeurs
 * par défaut neutres, à écraser au cas par cas pour chaque scénario testé. */
function remplirFormulaireContrat(sandbox, valeurs) {
  const defauts = {
    'f-contrat-date-debut': '2030-01-01', 'f-contrat-type': 'CDI', 'f-contrat-date-fin': '',
    'f-contrat-motif-recours': '', 'f-contrat-poste': '', 'f-contrat-classification': '',
    'f-contrat-etablissement': '', 'f-contrat-temps-travail': 'Temps plein', 'f-contrat-forfait': 'Aucun',
    'f-contrat-fin-periode-essai': '', 'f-contrat-salaire': '0', 'f-contrat-part-variable': '',
    'f-contrat-avantages-nature': '', 'f-contrat-commentaire': '',
    'f-contrat-prime-libelle-0': '', 'f-contrat-prime-montant-0': '', 'f-contrat-prime-periodicite-0': '',
    'f-contrat-prime-libelle-1': '', 'f-contrat-prime-montant-1': '', 'f-contrat-prime-periodicite-1': '',
    'f-contrat-prime-libelle-2': '', 'f-contrat-prime-montant-2': '', 'f-contrat-prime-periodicite-2': ''
  };
  Object.assign(defauts, valeurs);
  Object.entries(defauts).forEach(([id, value]) => { sandbox.document.getElementById(id).value = value; });
  sandbox.document.getElementById('f-contrat-statut-cadre').checked = Boolean(valeurs && valeurs.statutCadre);
  sandbox.document.getElementById('f-contrat-periode-essai-renouvelee').checked = Boolean(valeurs && valeurs.periodeEssaiRenouvelee);
}

function setup() {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  const rh = api.DB.getEmployees().find(e => e.role === 'rh');
  api.DB._currentEmployeeId = rh.id;
  return api;
}

function runModeleContratEnrichi() {
  const { makeEmptyContrat } = setup();
  const c = makeEmptyContrat();
  ['motifRecours', 'poste', 'classification', 'statutCadre', 'etablissementId', 'dateFinPeriodeEssai',
    'periodeEssaiRenouvelee', 'primesRecurrentes', 'partVariable', 'avantagesNature', 'commentaire', 'clauseIds']
    .forEach(champ => assert.ok(champ in c, `le modèle de contrat doit désormais porter le champ "${champ}"`));
  // §deepStrictEqual comparerait aussi les prototypes : un [] littéral de CE module Node n'est pas
  // structurellement "le même type" qu'un tableau créé dans le contexte vm isolé du bac à sable
  // (même piège que Date, voir bloc-enfants-22-09.test.js) — vérifié par forme, pas par égalité stricte.
  assert.ok(Array.isArray(c.primesRecurrentes) && c.primesRecurrentes.length === 0, 'aucune prime récurrente par défaut');
  assert.strictEqual(c.statutCadre, false, 'non-cadre par défaut');

  console.log('OK — contrat-enrichi-clauses-22-09.test.js (modèle de contrat enrichi du socle indispensable + rémunération)');
}

function runNouveauContratMirorePosteClassificationEtablissement() {
  const { DB, employeeRepository } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  const etablissement = DB.getCurrentCompany().etablissements[0];

  employeeRepository.ajouterContrat(salarie.id, {
    dateDebut: '2030-01-01', typeContrat: 'CDI', poste: 'Chef de projet', classification: 'Niveau III',
    statutCadre: true, etablissementId: etablissement.id, tempsTravail: 'Temps plein', salaireBrutMensuel: 3200
  });

  const current = employeeRepository.getById(salarie.id);
  assert.strictEqual(current.poste, 'Chef de projet', 'le poste du contrat doit se mirorer sur la fiche, comme le type de contrat');
  assert.strictEqual(current.classification, 'Niveau III');
  assert.strictEqual(current.statutCadre, true);
  assert.strictEqual(current.etablissementId, etablissement.id);

  console.log('OK — contrat-enrichi-clauses-22-09.test.js (nouveau contrat mirrore poste/classification/statut cadre/établissement sur la fiche)');
}

function runNouveauContratSansPostePreserveLePosteExistant() {
  const { employeeRepository } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  employeeRepository.update(salarie.id, { poste: 'Comptable' });

  // Un nouveau contrat qui ne précise RIEN sur le poste (ex. un simple avenant de salaire créé
  // comme "nouveau contrat") ne doit jamais effacer le poste déjà connu.
  employeeRepository.ajouterContrat(salarie.id, { dateDebut: '2030-02-01', typeContrat: 'CDI', salaireBrutMensuel: 3400 });

  const current = employeeRepository.getById(salarie.id);
  assert.strictEqual(current.poste, 'Comptable', 'un nouveau contrat sans poste précisé ne doit jamais effacer le poste déjà connu');

  console.log('OK — contrat-enrichi-clauses-22-09.test.js (nouveau contrat sans poste précisé préserve le poste existant)');
}

function runCorrigerContratSurUnContratLegacyNeffacePasLesChamps() {
  const { employeeRepository } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  employeeRepository.update(salarie.id, {
    poste: 'Technicien', classification: 'Niveau II', statutCadre: false,
    // Contrat "legacy" : construit à la main SANS les nouveaux champs (comme un contrat créé avant
    // ce correctif), pour reproduire exactement le cas à risque.
    contrats: [{ id: 'legacy1', dateDebut: '2025-01-01', dateFin: '', typeContrat: 'CDI', tempsTravail: 'Temps plein', salaireBrutMensuel: 3000 }]
  });

  employeeRepository.corrigerContrat(salarie.id, 'legacy1', { salaireBrutMensuel: 3100 });

  const current = employeeRepository.getById(salarie.id);
  assert.strictEqual(current.poste, 'Technicien', 'corriger un contrat legacy sans préciser le poste ne doit jamais l\'effacer');
  assert.strictEqual(current.classification, 'Niveau II');
  assert.strictEqual(current.salaireBrutMensuel, 3100, 'le champ réellement corrigé doit bien changer');

  console.log('OK — contrat-enrichi-clauses-22-09.test.js (corriger un contrat legacy ne fait jamais régresser poste/classification)');
}

function runDateFinEtMotifRecoursObligatoiresPourCddInterim() {
  const { estTypeContratATerme } = setup();
  assert.strictEqual(estTypeContratATerme('CDD'), true);
  assert.strictEqual(estTypeContratATerme('Intérim'), true);
  assert.strictEqual(estTypeContratATerme('CDI'), false);

  const { sandbox, openNouveauContratModal, employeeRepository, readAndValidateContratForm } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  openNouveauContratModal(salarie.id);
  const employee = employeeRepository.getById(salarie.id);

  remplirFormulaireContrat(sandbox, { 'f-contrat-type': 'CDD', 'f-contrat-date-fin': '', 'f-contrat-motif-recours': '' });
  assert.strictEqual(readAndValidateContratForm(employee), null, 'un CDD sans date de fin doit être refusé');

  remplirFormulaireContrat(sandbox, { 'f-contrat-type': 'CDD', 'f-contrat-date-fin': '2030-06-30', 'f-contrat-motif-recours': '' });
  assert.strictEqual(readAndValidateContratForm(employee), null, 'un CDD avec date de fin mais sans motif de recours doit rester refusé');

  remplirFormulaireContrat(sandbox, { 'f-contrat-type': 'CDD', 'f-contrat-date-fin': '2030-06-30', 'f-contrat-motif-recours': 'Accroissement temporaire d\'activité' });
  const values = readAndValidateContratForm(employee);
  assert.ok(values, 'un CDD avec date de fin ET motif de recours doit être accepté');
  assert.strictEqual(values.dateFin, '2030-06-30');
  assert.strictEqual(values.motifRecours, 'Accroissement temporaire d\'activité');

  console.log('OK — contrat-enrichi-clauses-22-09.test.js (dateFin et motif de recours obligatoires pour un CDD/intérim)');
}

function runCddSansPreciserLeTypeResteFacultatif() {
  const { sandbox, openNouveauContratModal, employeeRepository, readAndValidateContratForm } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  openNouveauContratModal(salarie.id);
  const employee = employeeRepository.getById(salarie.id);
  remplirFormulaireContrat(sandbox, { 'f-contrat-type': 'CDI', 'f-contrat-date-fin': '', 'f-contrat-motif-recours': '' });
  assert.ok(readAndValidateContratForm(employee), 'un CDI sans date de fin ni motif de recours doit rester accepté, ce n\'est pas un contrat à terme');

  console.log('OK — contrat-enrichi-clauses-22-09.test.js (dateFin/motif de recours restent facultatifs hors CDD/intérim)');
}

function runPosteEtablissementRetiresDeLaFicheEnEdition() {
  const { sandbox, openEmployeeModal, employeeRepository } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  openEmployeeModal(salarie.id);
  const html = sandbox.document.getElementById('modal-root').innerHTML;
  assert.ok(!html.includes('id="f-poste"'), 'le poste ne doit plus être modifiable depuis "Modifier le salarié" en édition');
  assert.ok(!html.includes('id="f-etablissementId"'), 'l\'établissement ne doit plus être modifiable depuis "Modifier le salarié" en édition');
  assert.ok(!html.includes('id="f-dateFinPeriodeEssai"'), 'la fin de période d\'essai ne doit plus être modifiable depuis "Modifier le salarié" en édition');
  assert.ok(html.includes('onglet <strong>Contrat</strong>'), 'un renvoi explicite vers l\'onglet Contrat doit remplacer ces champs');

  openEmployeeModal(); // création : ces champs doivent rester présents
  const htmlCreation = sandbox.document.getElementById('modal-root').innerHTML;
  assert.ok(htmlCreation.includes('id="f-poste"'), 'le poste doit rester saisissable à la création (aucun contrat n\'existe encore)');
  assert.ok(htmlCreation.includes('id="f-etablissementId"'));

  console.log('OK — contrat-enrichi-clauses-22-09.test.js (poste/établissement/fin de période d\'essai retirés de "Modifier le salarié" en édition, conservés à la création)');
}

function runBibliothequeDeClausesEtGenerationDeProjet() {
  const { DB, sandbox, clauseContratRepository, openClauseContratModal, employeeRepository, openGenererProjetContratModal, openApercuProjetContratModal } = setup();

  // Les 4 clauses de départ doivent exister (seedClausesContratDefaut).
  const clauses = clauseContratRepository.getAll();
  assert.ok(clauses.length >= 4, 'une bibliothèque de clauses de départ doit être proposée (non-concurrence, confidentialité...)');
  assert.ok(clauses.some(c => c.nom === 'Non-concurrence'));

  const nouvelleClause = clauseContratRepository.create({ nom: 'Clause de test', corps: 'Texte pour {{prenom}} {{nom}}.' });
  assert.ok(clauseContratRepository.getById(nouvelleClause.id), 'une nouvelle clause doit être créée et retrouvable');
  clauseContratRepository.update(nouvelleClause.id, { corps: 'Texte modifié pour {{prenom}}.' });
  assert.strictEqual(clauseContratRepository.getById(nouvelleClause.id).corps, 'Texte modifié pour {{prenom}}.');
  clauseContratRepository.delete(nouvelleClause.id);
  assert.strictEqual(clauseContratRepository.getById(nouvelleClause.id), null, 'une clause supprimée ne doit plus être retrouvable');

  // Génération d'un projet de contrat : sélection puis aperçu.
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  employeeRepository.update(salarie.id, { prenom: 'Camille', nom: 'Durand', poste: 'Développeur·euse' });
  const contrat = employeeRepository.ajouterContrat(salarie.id, { dateDebut: '2030-03-01', typeContrat: 'CDI', poste: 'Développeur·euse', salaireBrutMensuel: 3500 });

  const nonConcurrence = clauseContratRepository.getAll().find(c => c.nom === 'Non-concurrence');
  openGenererProjetContratModal(salarie.id, contrat.id);
  const htmlSelection = sandbox.document.getElementById('modal-root').innerHTML;
  assert.ok(htmlSelection.includes('PROJET de travail'), 'la sélection des clauses doit déjà porter l\'avertissement légal');
  assert.ok(htmlSelection.includes(`data-clause-checkbox="${nonConcurrence.id}"`), 'chaque clause de la bibliothèque doit être proposée à la sélection');

  // Reproduit exactement ce que fait le bouton "Aperçu du projet" (openGenererProjetContratModal) :
  // mémorise la sélection sur le contrat, puis ouvre l'aperçu.
  employeeRepository.corrigerContrat(salarie.id, contrat.id, { clauseIds: [nonConcurrence.id] });
  openApercuProjetContratModal(salarie.id, contrat.id);
  const htmlApercu = sandbox.document.getElementById('modal-root').innerHTML;
  assert.ok(htmlApercu.includes('Projet de travail'), 'l\'aperçu imprimable doit AUSSI porter l\'avertissement légal, pas seulement l\'écran de sélection');
  // nom passe par formatNomFamille (majuscules) à la création du salarié — vérifié insensible à la casse.
  assert.ok(htmlApercu.includes('Camille') && /durand/i.test(htmlApercu), 'l\'aperçu doit fusionner les vraies données du salarié');
  assert.ok(htmlApercu.includes('print-area'), 'l\'aperçu doit utiliser le même mécanisme d\'impression/export PDF que le reste de l\'application');
  assert.ok(!/pptx|powerpoint|\.docx/i.test(htmlApercu), 'jamais un export PowerPoint/.docx : aucune dépendance fiable pour ça dans ce projet 100% vanilla JS');

  console.log('OK — contrat-enrichi-clauses-22-09.test.js (bibliothèque de clauses CRUD + génération d\'un projet de contrat avec avertissement légal)');
}

function runCongesRTTJamaisDupliquesDansLeModeleDeContrat() {
  const { makeEmptyContrat } = setup();
  const c = makeEmptyContrat();
  assert.ok(!('conges' in c) && !('rtt' in c) && !('soldeConges' in c) && !('nombreJoursRTTAnnuel' in c),
    'les congés/RTT ne doivent jamais être dupliqués dans le modèle de contrat : ce sont des compteurs vivants gérés ailleurs (Types de congés)');

  console.log('OK — contrat-enrichi-clauses-22-09.test.js (congés/RTT jamais dupliqués dans le modèle de contrat)');
}

try {
  runModeleContratEnrichi();
  runNouveauContratMirorePosteClassificationEtablissement();
  runNouveauContratSansPostePreserveLePosteExistant();
  runCorrigerContratSurUnContratLegacyNeffacePasLesChamps();
  runDateFinEtMotifRecoursObligatoiresPourCddInterim();
  runCddSansPreciserLeTypeResteFacultatif();
  runPosteEtablissementRetiresDeLaFicheEnEdition();
  runBibliothequeDeClausesEtGenerationDeProjet();
  runCongesRTTJamaisDupliquesDansLeModeleDeContrat();
} catch (err) {
  console.error('ÉCHEC — contrat-enrichi-clauses-22-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
