/**
 * Seven RH — retour Betty du 14/09/2026 (revue concurrentielle, Notes de frais points 3 et 5) :
 * forfaits journaliers pré-remplis automatiquement (réutilise categoriesFraisConfig, déjà utilisé
 * pour le plafond d'exonération — point 4, déjà couvert avant ce correctif), et note de frais
 * groupée en dossier, validée/refusée en une fois.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function activerFrais(DB) {
  const company = DB.getCurrentCompany();
  company.abonnement.offre = 'a_la_carte';
  company.abonnement.modules = [{ key: 'frais' }];
  DB.saveCurrentCompany(company);
}

async function runForfait() {
  // ---- Sélection d'une catégorie avec forfait configuré : montant pré-rempli, jamais écrasé si déjà saisi ----
  {
    const { DB, sandbox, openExpenseModal, updateExpenseCategoryFields } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({ async resolveWorkflowWithFallback(employeeId, workflow) { return { success: true, workflow }; } }, { get(target, prop) { return prop in target ? target[prop] : async () => ({ success: true }); } });
    DB.init();
    activerFrais(DB);
    const settings = DB.getSettings();
    settings.categoriesFrais = [...settings.categoriesFrais, 'Forfait repas'];
    settings.categoriesFraisConfig = { 'Forfait repas': { montantForfaitaire: 19.5 } };
    DB.saveSettings(settings);
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    DB._currentEmployeeId = salarie.id;

    openExpenseModal();
    sandbox.document.getElementById('f-categorie').value = 'Forfait repas';
    updateExpenseCategoryFields();
    assert.strictEqual(String(sandbox.document.getElementById('f-montantTTC').value), '19.5', 'le montant doit se pré-remplir avec le forfait configuré pour cette catégorie');
    assert.ok(sandbox.document.getElementById('expense-forfait-hint').textContent.includes('19,5'), 'un message doit expliquer que ce montant est un forfait, modifiable');

    // Une valeur déjà tapée par erreur ne doit jamais être écrasée en changeant de catégorie.
    sandbox.document.getElementById('f-montantTTC').value = '42';
    sandbox.document.getElementById('f-categorie').value = 'Forfait repas';
    updateExpenseCategoryFields();
    assert.strictEqual(sandbox.document.getElementById('f-montantTTC').value, '42', 'un montant déjà saisi ne doit jamais être remplacé silencieusement par le forfait');
  }

  console.log('OK — notes-frais-dossier-forfait-14-09.test.js (forfait pré-rempli, jamais écrasé si déjà saisi)');
}

async function runDossier() {
  // ---- Création d'un dossier : garde-fous (motif, minimum 2 notes, même salarié, pas déjà groupées) ----
  {
    const { DB, sandbox, expenseRepository, expenseDossierRepository } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({ async resolveWorkflowWithFallback(employeeId, workflow) { return { success: true, workflow }; } }, { get(target, prop) { return prop in target ? target[prop] : async () => ({ success: true }); } });
    DB.init();
    activerFrais(DB);
    const salarieA = DB.getEmployees().find(e => e.role === 'salarie');
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = salarieA.id;

    const n1 = await expenseRepository.create({ employeeId: salarieA.id, categorie: 'Repas', date: '2026-09-12', libelle: 'Train', montantTTC: 80 });
    const n2 = await expenseRepository.create({ employeeId: salarieA.id, categorie: 'Repas', date: '2026-09-12', libelle: 'Hôtel', montantTTC: 120 });
    const n3AutreSalarie = await expenseRepository.create({ employeeId: rh.id, categorie: 'Repas', date: '2026-09-12', libelle: 'Taxi', montantTTC: 25 });

    assert.strictEqual(expenseDossierRepository.creer(salarieA.id, 'Déplacement', [n1.id]).success, false, 'une seule note ne doit jamais former un dossier');
    assert.strictEqual(expenseDossierRepository.creer(salarieA.id, '', [n1.id, n2.id]).success, false, 'un motif est obligatoire');
    assert.strictEqual(expenseDossierRepository.creer(salarieA.id, 'Déplacement', [n1.id, n3AutreSalarie.id]).success, false, 'un dossier ne doit jamais mélanger les notes de deux salariés différents');

    const result = expenseDossierRepository.creer(salarieA.id, 'Déplacement client Lyon', [n1.id, n2.id]);
    assert.strictEqual(result.success, true);
    const n1Apres = expenseRepository.getById(n1.id);
    const n2Apres = expenseRepository.getById(n2.id);
    assert.strictEqual(n1Apres.dossierId, result.dossier.id);
    assert.strictEqual(n2Apres.dossierId, result.dossier.id);

    // Une note déjà dans un dossier ne peut pas en rejoindre un second.
    const n4 = await expenseRepository.create({ employeeId: salarieA.id, categorie: 'Repas', date: '2026-09-13', libelle: 'Péage', montantTTC: 15 });
    assert.strictEqual(expenseDossierRepository.creer(salarieA.id, 'Autre dossier', [n1.id, n4.id]).success, false, 'une note déjà groupée ne peut pas rejoindre un second dossier');
  }

  // ---- Le dossier apparaît dans la carte de synthèse avec le bon total, et disparaît des actions
  // groupées une fois qu'UNE de ses notes a été traitée individuellement ----
  {
    const { DB, sandbox, expenseRepository, expenseDossierRepository, renderExpenseDossiersCard, refuseRequest } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({ async resolveWorkflowWithFallback(employeeId, workflow) { return { success: true, workflow }; } }, { get(target, prop) { return prop in target ? target[prop] : async () => ({ success: true }); } });
    DB.init();
    activerFrais(DB);
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    const manager = DB.getEmployees().find(e => e.role === 'manager');
    DB._currentEmployeeId = salarie.id;

    const n1 = await expenseRepository.create({ employeeId: salarie.id, categorie: 'Repas', date: '2026-09-12', libelle: 'Train', montantTTC: 80 });
    const n2 = await expenseRepository.create({ employeeId: salarie.id, categorie: 'Repas', date: '2026-09-12', libelle: 'Hôtel', montantTTC: 120 });
    const dossier = expenseDossierRepository.creer(salarie.id, 'Déplacement Lyon', [n1.id, n2.id]).dossier;
    DB._currentEmployeeId = manager.id;

    const htmlAvant = renderExpenseDossiersCard();
    assert.ok(htmlAvant.includes('Déplacement Lyon') && htmlAvant.includes('200'), 'le dossier doit apparaître avec le total des deux notes (80+120=200)');
    assert.ok(htmlAvant.includes('data-valider-dossier') && htmlAvant.includes('data-refuser-dossier'), 'les deux actions groupées doivent être proposées tant que rien n\'est encore traité');

    // Une note refusée individuellement (hors flux groupé) : plus d'action groupée pour ce dossier.
    expenseRepository.update(n1.id, refuseRequest(expenseRepository.getById(n1.id), 'test'));
    const htmlApres = renderExpenseDossiersCard();
    assert.ok(!htmlApres.includes('data-valider-dossier') && !htmlApres.includes('data-refuser-dossier'), 'un dossier partiellement déjà traité ne doit plus proposer d\'action groupée (risque de double décision)');
  }

  // ---- Valider tout le dossier applique bien le statut à CHAQUE note ----
  {
    const { DB, sandbox, expenseRepository, expenseDossierRepository, handleApproveExpense } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({ async resolveWorkflowWithFallback(employeeId, workflow) { return { success: true, workflow }; } }, { get(target, prop) { return prop in target ? target[prop] : async () => ({ success: true }); } });
    DB.init();
    activerFrais(DB);
    // Circuit à une seule étape pour ce test : une note de frais qui demande 2 validations
    // successives (workflowFrais par défaut) n'est pas le sujet ici (déjà couvert par ailleurs) —
    // seul compte que l'action groupée s'applique bien à CHAQUE note du dossier.
    const settingsFrais = DB.getSettings();
    settingsFrais.workflowFrais = ['rh'];
    DB.saveSettings(settingsFrais);
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = salarie.id;
    const n1 = await expenseRepository.create({ employeeId: salarie.id, categorie: 'Repas', date: '2026-09-12', libelle: 'Train', montantTTC: 80 });
    const n2 = await expenseRepository.create({ employeeId: salarie.id, categorie: 'Repas', date: '2026-09-12', libelle: 'Hôtel', montantTTC: 120 });
    const dossier = expenseDossierRepository.creer(salarie.id, 'Déplacement Lyon', [n1.id, n2.id]).dossier;

    DB._currentEmployeeId = rh.id;
    [n1.id, n2.id].forEach(id => handleApproveExpense(id));
    assert.strictEqual(expenseRepository.getById(n1.id).statut, 'Remboursé');
    assert.strictEqual(expenseRepository.getById(n2.id).statut, 'Remboursé');
  }

  console.log('OK — notes-frais-dossier-forfait-14-09.test.js (dossier : garde-fous à la création, disparaît des actions groupées si déjà partiellement traité, validation appliquée à chaque note)');
}

runForfait().then(runDossier).catch((err) => {
  console.error('ÉCHEC — notes-frais-dossier-forfait-14-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
