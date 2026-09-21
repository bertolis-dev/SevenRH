/**
 * Seven RH — retour Betty du 22/09/2026 (défaut 1.3, "le contrat est modifiable à deux endroits, et
 * les deux divergent") : "Modifier le salarié" écrivait typeContrat/tempsTravail/forfait/
 * salaireBrutMensuel/pourcentageActivite/horairesHebdo directement sur la fiche, SANS jamais toucher
 * employee.contrats — modifier le salaire depuis la fiche changeait le chiffre affiché partout
 * ailleurs (historiqueSalaire l'enregistrait) mais l'onglet Contrat continuait d'afficher l'ancien
 * montant. "Deux chiffres différents pour la même chose, sur le même écran, derrière deux onglets."
 *
 * Corrigé en retirant ces 6 champs du formulaire de modification (isEdit) — ils restent contractuels,
 * modifiables UNIQUEMENT depuis l'onglet Contrat, par un nouveau contrat (déjà existant) ou par une
 * CORRECTION du contrat en cours (nouveau : DB.corrigerContrat, "il faut pouvoir corriger un contrat
 * existant, pas seulement créer le suivant"). Toujours présents à la CRÉATION d'un salarié (aucun
 * contrat n'existe encore) — DB.addEmployee crée désormais le contrat n°1 dès la création, plutôt que
 * d'attendre la prochaine connexion (ensureContratsBackfilled), pour ne jamais laisser la fiche neuve
 * et l'onglet Contrat déjà en désaccord, même un court instant.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAppJs } = require('./load-app-js');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function setup() {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  const rh = api.DB.getEmployees().find(e => e.role === 'rh');
  api.DB._currentEmployeeId = rh.id;
  return { ...api, rh };
}

// ---- Les 6 champs contractuels disparaissent du formulaire EN ÉDITION, restent à la création ----

async function runLesChampsContractuelsDisparaissentDuFormulaireEnEdition() {
  const { DB, sandbox, openEmployeeModal, employeeRepository } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');

  openEmployeeModal(salarie.id); // édition
  const htmlEdition = sandbox.document.getElementById('modal-root').innerHTML;
  ['id="f-typeContrat"', 'id="f-tempsTravail"', 'id="f-forfait"', 'id="f-salaireBrutMensuel"', 'id="field-horaires-hebdo"'].forEach(fragment => {
    assert.ok(!htmlEdition.includes(fragment), `"${fragment}" ne doit plus exister dans le formulaire de modification : ces champs sont contractuels, seul l'onglet Contrat les modifie désormais`);
  });
  assert.ok(htmlEdition.includes('onglet') && htmlEdition.includes('Contrat'), 'un renvoi explicite vers l\'onglet Contrat doit remplacer les champs retirés');

  openEmployeeModal(); // création, aucun id
  const htmlCreation = sandbox.document.getElementById('modal-root').innerHTML;
  ['id="f-typeContrat"', 'id="f-tempsTravail"', 'id="f-forfait"'].forEach(fragment => {
    assert.ok(htmlCreation.includes(fragment), `"${fragment}" doit rester présent à la CRÉATION : aucun contrat n'existe encore à ce moment pour porter cette valeur`);
  });

  console.log('OK — contrat-source-unique-22-09.test.js (champs contractuels retirés en édition, conservés à la création)');
}

async function runSubmitEmployeeFormNeReinitialiseJamaisLesChampsAbsentsEnEdition() {
  // §preuve du bug corrigé : sans le garde 'in patch', patch.horairesHebdo était réécrit à la durée
  // de référence de l'entreprise (repli du code) À CHAQUE enregistrement de la fiche en édition,
  // même si l'utilisateur n'avait jamais touché ce champ (absent du formulaire).
  const fnStart = appSource.indexOf('function submitEmployeeForm(');
  const fnEnd = appSource.indexOf('\nfunction ', fnStart + 30);
  const body = appSource.slice(fnStart, fnEnd);
  assert.ok(/if \('pourcentageActivite' in patch\)/.test(body), 'la coercition du pourcentage d\'activité doit être gardée par sa présence réelle dans le formulaire soumis');
  assert.ok(/if \('horairesHebdo' in patch\)/.test(body), 'la normalisation des heures hebdomadaires doit être gardée par sa présence réelle dans le formulaire soumis, jamais appliquée sans condition');
  assert.ok(body.includes("patch.horairesHebdo = Number(String(patch.horairesHebdo || '').replace(',', '.')) || settingsRepository.getSettings().dureeHebdomadaireReferenceHeures;"), 'la normalisation virgule/point (retour QA du 27/08/2026) doit être préservée telle quelle');

  console.log('OK — contrat-source-unique-22-09.test.js (soumettre la fiche en édition ne réinitialise plus les champs contractuels absents du formulaire)');
}

// ---- DB.corrigerContrat : correction en place, jamais un nouveau contrat ----

async function runCorrigerContratModifieEnPlaceSansCreerDeNouveauContrat() {
  const { employeeRepository } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  employeeRepository.update(salarie.id, { dateEmbauche: '2020-01-01', typeContrat: 'CDD', tempsTravail: 'Temps plein', salaireBrutMensuel: 2200 });
  await employeeRepository.ajouterContrat(salarie.id, { dateDebut: '2020-01-01', typeContrat: 'CDD', tempsTravail: 'Temps plein', forfait: 'Aucun', salaireBrutMensuel: 2200 });

  const avant = employeeRepository.getById(salarie.id);
  const contratId = avant.contrats[0].id;
  assert.strictEqual(avant.contrats.length, 1);

  employeeRepository.corrigerContrat(salarie.id, contratId, { salaireBrutMensuel: 2250 }); // faute de frappe corrigée : 2200 -> 2250

  const apres = employeeRepository.getById(salarie.id);
  assert.strictEqual(apres.contrats.length, 1, 'une correction ne doit jamais ajouter de contrat, contrairement à "Nouveau contrat"');
  assert.strictEqual(apres.contrats[0].id, contratId, 'c\'est le MÊME contrat, corrigé en place, jamais un remplacement par un autre id');
  assert.strictEqual(apres.contrats[0].salaireBrutMensuel, 2250);
  assert.strictEqual(apres.salaireBrutMensuel, 2250, 'le contrat corrigé est le contrat courant : le champ à plat doit être mirroré, exactement comme addContrat');
  assert.ok(apres.historiqueSalaire && apres.historiqueSalaire.some(h => h.nouveauMontant === 2250), 'la correction du contrat courant doit alimenter historiqueSalaire au passage, comme un nouveau contrat le ferait');

  console.log('OK — contrat-source-unique-22-09.test.js (corrigerContrat modifie en place, mirrore sur les champs à plat, alimente historiqueSalaire)');
}

async function runCorrigerUnContratPasseNeMirrorePasSurLesChampsAPlat() {
  const { employeeRepository } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  employeeRepository.update(salarie.id, { dateEmbauche: '2020-01-01' });
  await employeeRepository.ajouterContrat(salarie.id, { dateDebut: '2020-01-01', typeContrat: 'CDD', tempsTravail: 'Temps plein', forfait: 'Aucun', salaireBrutMensuel: 2000 });
  await employeeRepository.ajouterContrat(salarie.id, { dateDebut: '2024-01-01', typeContrat: 'CDI', tempsTravail: 'Temps plein', forfait: 'Aucun', salaireBrutMensuel: 2500 });

  const avant = employeeRepository.getById(salarie.id);
  const ancienContrat = avant.contrats.find(c => c.typeContrat === 'CDD');
  assert.strictEqual(avant.salaireBrutMensuel, 2500, 'contrôle : le contrat courant (CDI) pilote bien le champ à plat avant la correction');

  employeeRepository.corrigerContrat(salarie.id, ancienContrat.id, { salaireBrutMensuel: 2050 }); // faute de frappe sur l'ANCIEN contrat, déjà remplacé

  const apres = employeeRepository.getById(salarie.id);
  assert.strictEqual(apres.contrats.find(c => c.id === ancienContrat.id).salaireBrutMensuel, 2050, 'le contrat ancien lui-même doit bien porter la correction');
  assert.strictEqual(apres.salaireBrutMensuel, 2500, 'corriger un contrat déjà remplacé ne doit JAMAIS faire régresser le champ à plat, qui doit rester piloté par le contrat courant (CDI, 2500)');

  console.log('OK — contrat-source-unique-22-09.test.js (corriger un contrat déjà remplacé ne fait jamais régresser la situation actuelle)');
}

async function runCorrigerContratNeTouchePasLesContratsVoisins() {
  const { employeeRepository } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  employeeRepository.update(salarie.id, { dateEmbauche: '2020-01-01' });
  await employeeRepository.ajouterContrat(salarie.id, { dateDebut: '2020-01-01', typeContrat: 'CDD', tempsTravail: 'Temps plein', forfait: 'Aucun', salaireBrutMensuel: 2000 });
  await employeeRepository.ajouterContrat(salarie.id, { dateDebut: '2024-01-01', typeContrat: 'CDI', tempsTravail: 'Temps plein', forfait: 'Aucun', salaireBrutMensuel: 2500 });

  const avant = employeeRepository.getById(salarie.id);
  const premier = avant.contrats.find(c => c.typeContrat === 'CDD');
  const dateFinAvant = premier.dateFin;
  assert.ok(dateFinAvant, 'contrôle : le premier contrat est bien clôturé par la création du second');

  // Corrige uniquement le SALAIRE du second contrat (CDI) — ne doit jamais toucher dateFin du premier.
  const second = avant.contrats.find(c => c.typeContrat === 'CDI');
  employeeRepository.corrigerContrat(salarie.id, second.id, { salaireBrutMensuel: 2600 });

  const apres = employeeRepository.getById(salarie.id);
  assert.strictEqual(apres.contrats.find(c => c.id === premier.id).dateFin, dateFinAvant, 'corriger un contrat ne doit jamais décaler la date de fin d\'un contrat voisin, contrairement à "Nouveau contrat"');
  assert.strictEqual(apres.contrats.length, 2, 'toujours exactement les deux mêmes contrats, jamais un de plus');

  console.log('OK — contrat-source-unique-22-09.test.js (corrigerContrat ne décale jamais un contrat voisin)');
}

// ---- Création : le contrat n°1 existe dès l'instant de la création, pas seulement à la prochaine connexion ----

async function runNouveauSalarieAUnContratDesLaCreation() {
  const { DB, employeeRepository } = setup();
  const cree = await DB.addEmployee({
    nom: 'Test', prenom: 'Contrat', email: 'test.contrat.22-09@example.com', dateEmbauche: '2026-09-01',
    typeContrat: 'CDD', tempsTravail: 'Temps plein', forfait: 'Aucun', salaireBrutMensuel: 2100, pourcentageActivite: 100, horairesHebdo: 35
  });

  assert.strictEqual(cree.contrats.length, 1, 'un contrat n°1 doit exister dès la création, sans attendre la prochaine connexion (ensureContratsBackfilled)');
  const contrat = cree.contrats[0];
  assert.strictEqual(contrat.dateDebut, '2026-09-01');
  assert.strictEqual(contrat.typeContrat, 'CDD');
  assert.strictEqual(contrat.salaireBrutMensuel, 2100);

  // Confirmé aussi via le repository (même chemin que le formulaire de création réel).
  const relu = employeeRepository.getById(cree.id);
  assert.strictEqual(relu.contrats.length, 1);

  console.log('OK — contrat-source-unique-22-09.test.js (un nouveau salarié a son contrat n°1 dès sa création)');
}

// ---- openCorrigerContratModal : réutilise les mêmes champs que "Nouveau contrat", valide contre les contrats voisins ----

async function runOpenCorrigerContratModalRendLesMemesChampsQueNouveauContrat() {
  const { employeeRepository, openCorrigerContratModal, sandbox } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  employeeRepository.update(salarie.id, { dateEmbauche: '2020-01-01' });
  await employeeRepository.ajouterContrat(salarie.id, { dateDebut: '2020-01-01', typeContrat: 'CDD', tempsTravail: 'Temps plein', forfait: 'Aucun', salaireBrutMensuel: 2000 });
  const contrat = employeeRepository.getById(salarie.id).contrats[0];

  openCorrigerContratModal(salarie.id, contrat.id);
  const html = sandbox.document.getElementById('modal-root').innerHTML;
  ['id="f-contrat-date-debut"', 'id="f-contrat-type"', 'id="f-contrat-temps-travail"', 'id="f-contrat-forfait"', 'id="f-contrat-salaire"'].forEach(fragment => {
    assert.ok(html.includes(fragment), `le formulaire de correction doit reprendre le champ ${fragment}, comme "Nouveau contrat"`);
  });
  assert.ok(html.includes('value="2000"'), 'les valeurs actuelles du contrat doivent préremplir le formulaire');
  assert.ok(!html.includes('sera clôturé'), 'jamais le message de "Nouveau contrat" annonçant la clôture du contrat en cours : une correction ne clôture jamais rien');

  console.log('OK — contrat-source-unique-22-09.test.js ("Corriger le contrat" réutilise les mêmes champs que "Nouveau contrat", préremplis)');
}

runLesChampsContractuelsDisparaissentDuFormulaireEnEdition()
  .then(runSubmitEmployeeFormNeReinitialiseJamaisLesChampsAbsentsEnEdition)
  .then(runCorrigerContratModifieEnPlaceSansCreerDeNouveauContrat)
  .then(runCorrigerUnContratPasseNeMirrorePasSurLesChampsAPlat)
  .then(runCorrigerContratNeTouchePasLesContratsVoisins)
  .then(runNouveauSalarieAUnContratDesLaCreation)
  .then(runOpenCorrigerContratModalRendLesMemesChampsQueNouveauContrat)
  .catch((err) => {
    console.error('ÉCHEC — contrat-source-unique-22-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
