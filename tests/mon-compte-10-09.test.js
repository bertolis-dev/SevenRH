/**
 * Seven RH — retour Betty du 10/09/2026 : "il faut que dans les paramètres on puisse changer la
 * photo de profil pour qu'on puisse voir dans le planning". employees.photo existait déjà côté
 * données (renderAvatar l'affiche partout dès qu'il est renseigné) mais aucun écran ne permettait de
 * le renseigner. Question posée à Betty (placement ambigu, "Paramètres" n'ayant jusqu'ici que des
 * réglages d'ENTREPRISE réservés à RH/Propriétaire) : elle a choisi un nouvel onglet "Mon compte",
 * ouvert à TOUT rôle — contrairement aux autres onglets de Paramètres.
 *
 * Ce fichier couvre : (1) la vue "parametres" doit rester atteignable par un salarié UNIQUEMENT pour
 * "Mon compte", jamais pour un onglet d'administration ; (2) l'upload de la photo (mock du bucket
 * Supabase) enregistre bien l'URL sur le salarié, quel que soit son rôle.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function run() {
  // ---- NAV_ITEMS : "Mon compte" doit être atteignable par TOUS les rôles (contrairement aux deux
  // autres entrées "parametres", réservées à RH/Propriétaire) ----
  {
    const { NAV_ITEMS } = loadAppJs();
    const monCompteItem = NAV_ITEMS.find(i => i.key === 'parametres' && i.label === 'Mon compte');
    assert.ok(monCompteItem, '"Mon compte" doit exister comme entrée NAV_ITEMS dédiée');
    assert.deepStrictEqual(JSON.stringify(monCompteItem.navParams), JSON.stringify({ parametresTab: 'mon-compte' }));
    ['salarie', 'manager', 'rh', 'comptabilite', 'proprietaire'].forEach(role => {
      assert.ok(monCompteItem.roles.includes(role), `"Mon compte" doit être accessible au rôle ${role}`);
    });
  }

  // ---- Un salarié peut atteindre "Mon compte", mais jamais un onglet d'administration ----
  {
    const { DB, sandbox, navigateTo, render, state, PARAMETRES_TABS } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    DB._currentEmployeeId = salarie.id;

    navigateTo('parametres', { parametresTab: 'mon-compte' });
    assert.strictEqual(state.view, 'parametres', 'un salarié doit pouvoir atteindre la vue Paramètres pour "Mon compte"');
    assert.strictEqual(state.parametresTab, 'mon-compte');
    render();
    const html = sandbox.document.getElementById('view-root').innerHTML;
    assert.ok(html.includes('f-photo-upload') && html.includes('btn-upload-photo'), 'le contenu de "Mon compte" (upload photo) doit être rendu');
    assert.ok(!html.includes('Un problème d\'affichage'), 'ne doit jamais planter');

    // Tentative d'atteindre un onglet d'administration (ex. "Entreprise") : doit retomber sur "Mon
    // compte", jamais afficher le contenu réservé à RH/Propriétaire (voir canManageParametres, app.js).
    navigateTo('parametres', { parametresTab: 'entreprise' });
    render();
    assert.strictEqual(state.parametresTab, 'mon-compte', 'un salarié demandant un onglet d\'administration doit retomber sur "Mon compte"');
    const htmlAdmin = sandbox.document.getElementById('view-root').innerHTML;
    assert.ok(!htmlAdmin.includes('f-siret'), 'le formulaire "Entreprise" (SIRET...) ne doit jamais être rendu pour un salarié');

    // Le sélecteur/la liste d'onglets ne doit lister QUE "Mon compte" pour un salarié.
    const visibleForSalarie = PARAMETRES_TABS.filter(t => t.isVisible());
    assert.deepStrictEqual(JSON.stringify(visibleForSalarie.map(t => t.key)), JSON.stringify(['mon-compte']), 'un salarié ne doit voir aucun onglet d\'administration dans la liste');
  }

  // ---- RH conserve l'accès à tous les onglets (non-régression) ----
  {
    const { DB, sandbox, navigateTo, render, state, PARAMETRES_TABS } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;

    navigateTo('parametres', { parametresTab: 'entreprise' });
    render();
    assert.strictEqual(state.parametresTab, 'entreprise', 'RH doit toujours pouvoir atteindre l\'onglet Entreprise');
    const visibleForRh = PARAMETRES_TABS.filter(t => t.isVisible()).map(t => t.key);
    assert.ok(visibleForRh.includes('mon-compte'), 'RH doit aussi voir "Mon compte" (ouvert à tous)');
    assert.ok(visibleForRh.includes('entreprise') && visibleForRh.includes('audit'), 'RH garde tous les onglets d\'administration');
  }

  // ---- DB.majMaPhoto / employeeRepository.uploadMyPhoto : enregistre l'URL, quel que soit le rôle ----
  {
    const { DB, sandbox, employeeRepository } = loadAppJs();
    let uploadedArgs = null;
    sandbox.window.SupabaseSync = new Proxy({}, {
      get: (t, prop) => {
        if (prop === 'uploadEmployeePhoto') return async (companyId, employeeId, file) => {
          uploadedArgs = { companyId, employeeId, file };
          return 'https://storage.example.com/employee-photos/company1/emp1.jpg';
        };
        return async () => ({ success: true });
      }
    });
    DB.init();
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    DB._currentEmployeeId = salarie.id;

    const result = DB.majMaPhoto(salarie.id, 'https://storage.example.com/employee-photos/company1/emp1.jpg');
    assert.strictEqual(result.success, true);
    assert.strictEqual(DB.getEmployeeById(salarie.id).photo, 'https://storage.example.com/employee-photos/company1/emp1.jpg');

    // employeeRepository.uploadMyPhoto orchestre les deux : upload puis enregistrement.
    const fakeFile = { type: 'image/png' };
    const url = await employeeRepository.uploadMyPhoto(salarie.id, fakeFile);
    assert.strictEqual(url, 'https://storage.example.com/employee-photos/company1/emp1.jpg');
    assert.strictEqual(uploadedArgs.employeeId, salarie.id, 'doit téléverser sous le propre id du salarié, jamais un autre');
    assert.strictEqual(uploadedArgs.file, fakeFile);
    assert.strictEqual(DB.getEmployeeById(salarie.id).photo, 'https://storage.example.com/employee-photos/company1/emp1.jpg');
  }

  console.log('OK — mon-compte-10-09.test.js (onglet "Mon compte" ouvert à tous, onglets d\'administration restent cadenassés, upload de la photo de profil)');
}

run().catch((err) => {
  console.error('ÉCHEC — mon-compte-10-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
