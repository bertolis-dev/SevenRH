/**
 * Seven RH — retour Betty du 14/09/2026 (Module RH point 6, "registre du personnel toujours à
 * jour") : nouvel onglet Paramètres listant les mentions obligatoires du registre unique du
 * personnel (Code du travail) pour chaque salarié, trié par date d'entrée, y compris un salarié
 * anonymisé (voir registre-personnel-14-09.test.js pour la préservation SQL de ces champs).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function run() {
  // ---- L'onglet existe, réservé à gererParametres + module RH ----
  {
    const { PARAMETRES_TABS } = loadAppJs();
    const tab = PARAMETRES_TABS.find(t => t.key === 'registre-personnel');
    assert.ok(tab, 'l\'onglet "Registre du personnel" doit exister');
  }

  // ---- Le tableau contient les mentions obligatoires, trié par date d'entrée, y compris un
  // salarié anonymisé (nom/prénom/sexe/date de naissance/nationalité restent visibles) ----
  {
    const { DB, sandbox, employeeRepository, renderParametresRegistrePersonnel } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const company = DB.getCurrentCompany();
    company.abonnement.offre = 'a_la_carte';
    company.abonnement.modules = [{ key: 'rh' }];
    DB.saveCurrentCompany(company);

    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    employeeRepository.update(salarie.id, {
      nom: 'Moreau', prenom: 'Julien', civilite: 'M.', dateNaissance: '1990-05-12',
      nationalite: 'Française', poste: 'Comptable', dateEmbauche: '2015-01-10', dateDepart: '2024-06-30',
      typeContrat: 'CDI', anonymise: true, dateAnonymisation: '2029-07-01'
    });

    const html = renderParametresRegistrePersonnel();
    assert.ok(html.includes('Moreau') && html.includes('Julien'), 'le salarié anonymisé doit rester visible dans le registre (nom/prénom préservés par 0053)');
    assert.ok(html.includes('12/05/1990'), 'la date de naissance doit être formatée et affichée');
    assert.ok(html.includes('Française'), 'la nationalité doit être affichée');
    assert.ok(html.includes('Comptable'), 'l\'emploi (poste) doit être affiché');
    assert.ok(html.includes('CDI'), 'le type de contrat doit être affiché');
    assert.ok(!html.includes('undefined') && !html.includes('null'), 'aucune fuite de valeur brute');
    assert.ok(html.includes('btn-imprimer-registre'), 'un bouton Imprimer doit permettre de présenter le registre à un contrôle');
  }

  console.log('OK — registre-personnel-ecran-14-09.test.js (onglet Paramètres, mentions obligatoires affichées y compris pour un salarié anonymisé)');
}

try {
  run();
} catch (err) {
  console.error('ÉCHEC — registre-personnel-ecran-14-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
