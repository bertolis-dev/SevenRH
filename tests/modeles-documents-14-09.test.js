/**
 * Seven RH — retour Betty du 14/09/2026 (Module RH point 1, "modèles de documents avec fusion
 * automatique") : modèles paramétrables par l'entreprise, remplis automatiquement avec les données
 * du salarié à la génération. Corps en texte libre avec des espaces réservés "{{champ}}" — pas
 * d'éditeur riche en v1 (même choix que l'attestation de salaire).
 */
const assert = require('assert');
const { loadDataJs } = require('./load-data-js');
const { loadAppJs } = require('./load-app-js');

async function runPures() {
  // ---- fusionnerModeleDocument : remplacement simple, champ inconnu/manquant → chaîne vide ----
  {
    const { fusionnerModeleDocument } = loadDataJs();
    const resultat = fusionnerModeleDocument('Bonjour {{prenom}} {{nom}}, poste : {{poste}}.', { prenom: 'Camille', nom: 'Dupont' });
    assert.strictEqual(resultat, 'Bonjour Camille Dupont, poste : .', 'un champ absent du dictionnaire doit devenir une chaîne vide, jamais laisser "{{poste}}" brut');

    const sansChamp = fusionnerModeleDocument('Texte sans aucun champ.', {});
    assert.strictEqual(sansChamp, 'Texte sans aucun champ.');

    assert.strictEqual(fusionnerModeleDocument('', {}), '', 'un corps vide ne doit jamais planter');
    assert.strictEqual(fusionnerModeleDocument(null, {}), '', 'un corps null ne doit jamais planter');
  }

  // ---- construireValeursFusionModele : lit le salarié ET l'entreprise, masque le salaire si le
  // suivi de la masse salariale est désactivé (même garde que l'attestation de salaire) ----
  {
    const { construireValeursFusionModele } = loadDataJs();
    const employee = {
      civilite: 'Mme', prenom: 'Camille', nom: 'Dupont', matricule: 'M042', poste: 'Développeuse',
      dateEmbauche: '2022-03-01', adresse: { rue: '12 rue des Lilas', codePostal: '75011', ville: 'Paris' },
      salaireBrutMensuel: 3200
    };
    const company = { raisonSociale: 'Seven RH', siret: '123456789', adresse: '1 rue de la Paix, Paris', settings: { masseSalarialeActivee: true } };
    const valeurs = construireValeursFusionModele(employee, company);
    assert.strictEqual(valeurs.prenom, 'Camille');
    assert.strictEqual(valeurs.matricule, 'M042');
    assert.strictEqual(valeurs.adresseComplete, '12 rue des Lilas, 75011, Paris');
    assert.strictEqual(valeurs.raisonSociale, 'Seven RH');
    assert.strictEqual(valeurs.salaireBrutMensuel, 3200);

    const companySansMasseSalariale = Object.assign({}, company, { settings: { masseSalarialeActivee: false } });
    const valeursSansSalaire = construireValeursFusionModele(employee, companySansMasseSalariale);
    assert.strictEqual(valeursSansSalaire.salaireBrutMensuel, '', 'le salaire ne doit jamais apparaître dans un document si le suivi de la masse salariale est désactivé');
  }

  console.log('OK — modeles-documents-14-09.test.js (fonctions pures : fusion texte, dictionnaire salarié/entreprise, salaire masqué si désactivé)');
}

async function runUi() {
  // ---- Paramètres : l'onglet "Modèles de documents" existe et est réservé à gererParametres ----
  {
    const { PARAMETRES_TABS } = loadAppJs();
    const tab = PARAMETRES_TABS.find(t => t.key === 'modeles-documents');
    assert.ok(tab, 'l\'onglet "Modèles de documents" doit exister dans Paramètres');
  }

  // ---- CRUD via le repository (create/update/delete) ----
  {
    const { DB, sandbox, documentTemplateRepository } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;

    // §retour Betty du 19/09/2026 (point 2, "attestation employeur et certificat de travail livrés
    // comme modèles de base") : 2 modèles système désormais seedés par défaut (voir
    // seedDocumentTemplatesDefaut, data.js) — plus "aucun modèle par défaut" comme avant ce
    // changement. Le CRUD ci-dessous reste testé RELATIVEMENT à ce socle de 2, pas en absolu.
    const nombreModelesParDefaut = documentTemplateRepository.getAll().length;
    assert.strictEqual(nombreModelesParDefaut, 2, 'les 2 modèles système (attestation employeur, certificat de travail) doivent être livrés par défaut');
    const template = documentTemplateRepository.create({ nom: 'Attestation de travail', corps: 'Nous attestons que {{prenom}} {{nom}} travaille chez nous depuis le {{dateEmbauche}}.' });
    assert.ok(template.id);
    assert.strictEqual(documentTemplateRepository.getAll().length, nombreModelesParDefaut + 1);

    documentTemplateRepository.update(template.id, { nom: 'Attestation de travail (à jour)' });
    assert.strictEqual(documentTemplateRepository.getById(template.id).nom, 'Attestation de travail (à jour)');

    documentTemplateRepository.delete(template.id);
    assert.strictEqual(documentTemplateRepository.getAll().length, nombreModelesParDefaut);
  }

  // ---- Fiche salarié : la carte "Documents à générer" liste les modèles pour qui peut modifier la
  // fiche, MASQUÉE ENTIÈREMENT si aucun modèle n'existe encore (retour Betty du 18/09/2026, point 9 :
  // un message d'administration permanent était plus gênant qu'utile pour qui ne configure jamais de
  // modèle), absente pour qui ne peut pas modifier ----
  {
    const { DB, sandbox, state, documentTemplateRepository, renderEmployeeDetail } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    // §retour Betty du 18/09/2026 (point 6) : "Documents à générer" vit désormais sous l'onglet
    // "Documents" (16 cartes empilées remplacées par des onglets), plus sous "Fiche" par défaut.
    state.employeeDetailTab = 'documents';

    // §retour Betty du 19/09/2026 (point 2) : DB.init() seede désormais 2 modèles système par
    // défaut (voir seedDocumentTemplatesDefaut, data.js) — ce scénario teste spécifiquement le cas
    // "aucun modèle configuré". documentTemplateRepository.delete() refuse désormais ces 2 modèles
    // (revue de la livraison du 19/09, point 4 : plus supprimables, voir DB.deleteDocumentTemplate) —
    // ce cas "zéro modèle" n'est donc plus atteignable par ce chemin en usage réel ; on le simule ici
    // directement au niveau des données pour continuer à couvrir le rendu de renderEmployeeDetail.
    DB.saveDocumentTemplates([]);

    const htmlSansModele = renderEmployeeDetail(salarie.id);
    assert.ok(!htmlSansModele.includes('Documents à générer'), 'sans aucun modèle configuré, la carte doit être entièrement masquée, même pour RH');

    documentTemplateRepository.create({ nom: 'Attestation de travail', corps: 'Test' });
    const htmlAvecModele = renderEmployeeDetail(salarie.id);
    assert.ok(htmlAvecModele.includes('data-generer-document'), 'un bouton par modèle doit apparaître une fois qu\'il en existe un');
    assert.ok(htmlAvecModele.includes('Attestation de travail'), 'le nom du modèle doit être affiché sur son bouton');

    // Le salarié lui-même (ne peut pas modifier sa propre fiche officielle) ne doit jamais voir cette carte.
    DB._currentEmployeeId = salarie.id;
    const htmlSalarie = renderEmployeeDetail(salarie.id);
    assert.ok(!htmlSalarie.includes('Documents à générer'), 'un salarié consultant sa propre fiche ne doit jamais voir cette carte (document officiel, pas une auto-consultation)');
  }

  // ---- Génération : fusion réelle avec la fiche du salarié, ET protection XSS (un champ salarié ne
  // doit jamais injecter du HTML dans le document généré) ----
  {
    const { DB, sandbox, documentTemplateRepository, employeeRepository, openGenererDocumentModal } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    // Poste saisi librement contenant une tentative d'injection — doit ressortir échappé, jamais exécutable.
    employeeRepository.update(salarie.id, { poste: '<img src=x onerror=alert(1)>' });
    const template = documentTemplateRepository.create({ nom: 'Attestation', corps: 'Poste : {{poste}}, salarié : {{prenom}} {{nom}}.' });

    openGenererDocumentModal(template.id, salarie.id);
    const html = sandbox.document.getElementById('modal-root').innerHTML;
    assert.ok(html.includes(`Poste : &lt;img src=x onerror=alert(1)&gt;`), 'un champ salarié doit être échappé dans le document généré, jamais laissé exécutable');
    assert.ok(html.includes(salarie.prenom) && html.includes(salarie.nom), 'les vraies données du salarié doivent apparaître dans le document');
    assert.ok(!html.includes('<img src=x'), 'aucune balise HTML brute injectée depuis une donnée salarié');
  }

  console.log('OK — modeles-documents-14-09.test.js (onglet Paramètres, CRUD, carte fiche salarié gated sur canEdit, génération avec protection XSS)');
}

runPures().then(runUi).catch((err) => {
  console.error('ÉCHEC — modeles-documents-14-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
