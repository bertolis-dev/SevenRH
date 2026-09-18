/**
 * Seven RH — retour Betty du 18/09/2026, point 2 : les reprises de mise en forme des noms et de
 * conversion du suivi médical (company.nomsPrenomsMigres/visitesMedicalesMigrees, voir
 * DB.getEmployees(), data.js) restaient PUREMENT locales — saveCurrentCompany n'écrit jamais vers
 * Supabase. Conséquence relevée par Betty : notify-request-email relit prenom/nom directement en
 * base et envoie un email avec l'ancien nom mal formaté, alors que l'écran affiche partout la
 * version corrigée ; et le drapeau, posé sur `company`, peut fuiter côté serveur via
 * DB.saveCompanyProfile (qui pousse tout ce qui reste du blob), ce qui ferait ensuite croire à tort
 * que la reprise a eu lieu, sans qu'elle n'ait jamais atteint le serveur.
 *
 * Corrigé par deux fonctions dédiées (ensureNomsPrenomsMigresVersServeur/
 * ensureVisitesMedicalesMigreesVersServeur), appelées à la VRAIE connexion
 * (hydrateCurrentCompanyWithMigrations, même point d'entrée que ensureDefaultLeaveTypesBackfilled) :
 *   - jamais de drapeau de complétude — l'écart réel entre les données actuelles et leur version
 *     corrigée est recalculé à chaque connexion, ce qui rend la fonction insensible à un drapeau
 *     local déjà (à tort) remonté au serveur ;
 *   - réservées à qui a le droit d'écrire les salariés (MODIFIER_SALARIE), comme
 *     ensureDefaultLeaveTypesBackfilled l'est déjà pour GERER_PARAMETRES.
 */
const assert = require('assert');
const { loadDataJs } = require('./load-data-js');

function employeeADeCorriger() {
  return {
    id: 'emp-a-corriger', role: 'salarie',
    nom: 'dupont', prenom: 'marie-caroline',
    dateDerniereVisiteMedicale: '2024-03-10'
  };
}

async function runPousseVersServeurAvecPermission() {
  const { sandbox, ensureNomsPrenomsMigresVersServeur, ensureVisitesMedicalesMigreesVersServeur } = loadDataJs();
  const rh = { id: 'rh1', role: 'rh' };
  const employee = employeeADeCorriger();
  const company = { id: 'c1', employees: [employee, rh] };

  const pushed = [];
  sandbox.window.SupabaseSync = { pushEmployees: async (payload) => { pushed.push(payload); } };

  await ensureNomsPrenomsMigresVersServeur(company, rh);
  await ensureVisitesMedicalesMigreesVersServeur(company, rh);

  assert.strictEqual(employee.nom, 'DUPONT', 'le nom doit être mis en forme en mémoire');
  assert.strictEqual(employee.prenom, 'Marie-Caroline', 'le prénom doit être mis en forme en mémoire');
  assert.strictEqual(employee.visitesMedicales.length, 1, 'l\'ancienne date doit être convertie en historique');
  assert.strictEqual(employee.suiviMedicalType, 'simple');

  assert.ok(pushed.length >= 2, 'les deux corrections doivent chacune déclencher un vrai envoi à Supabase (jamais juste local)');
  const dernierEnvoi = pushed[pushed.length - 1].modified.find(e => e.id === 'emp-a-corriger');
  assert.strictEqual(dernierEnvoi.nom, 'DUPONT', 'le nom envoyé au serveur doit être la version déjà corrigée, jamais l\'ancienne');
  assert.ok(pushed.every(p => p.added.length === 0), 'une reprise ne crée jamais de nouveau salarié, seulement des mises à jour');

  console.log('OK — reprise-noms-visites-medicales-serveur-18-09.test.js (les deux reprises atteignent réellement Supabase)');
}

async function runAucunEnvoiSansPermission() {
  const { sandbox, ensureNomsPrenomsMigresVersServeur, ensureVisitesMedicalesMigreesVersServeur } = loadDataJs();
  const salarie = { id: 'sal1', role: 'salarie' };
  const employee = employeeADeCorriger();
  const company = { id: 'c1', employees: [employee, salarie] };

  const pushed = [];
  sandbox.window.SupabaseSync = { pushEmployees: async (payload) => { pushed.push(payload); } };

  await ensureNomsPrenomsMigresVersServeur(company, salarie);
  await ensureVisitesMedicalesMigreesVersServeur(company, salarie);

  assert.strictEqual(pushed.length, 0, 'une session sans le droit d\'écrire les salariés ne doit jamais tenter d\'écriture serveur (RLS la rejetterait de toute façon)');
  assert.strictEqual(employee.nom, 'dupont', 'sans ce droit, rien n\'est modifié ici (la correction d\'affichage reste du ressort de DB.getEmployees(), indépendant)');

  console.log('OK — reprise-noms-visites-medicales-serveur-18-09.test.js (aucune écriture serveur sans le droit d\'écrire les salariés)');
}

async function runInsensibleAUnDrapeauDejaFuiteAuServeur() {
  // Reproduit précisément le scénario décrit par Betty : le drapeau local est déjà passé à `true`
  // côté serveur (ex. via une sauvegarde de la fiche entreprise), alors que le salarié n'a en réalité
  // jamais été corrigé côté serveur. Ces fonctions ne lisent JAMAIS ce drapeau : seul l'écart réel
  // entre les données compte.
  const { sandbox, ensureNomsPrenomsMigresVersServeur } = loadDataJs();
  const rh = { id: 'rh1', role: 'rh' };
  const employee = employeeADeCorriger();
  const company = { id: 'c1', employees: [employee, rh], nomsPrenomsMigres: true, visitesMedicalesMigrees: true };

  const pushed = [];
  sandbox.window.SupabaseSync = { pushEmployees: async (payload) => { pushed.push(payload); } };

  await ensureNomsPrenomsMigresVersServeur(company, rh);

  assert.strictEqual(employee.nom, 'DUPONT', 'le drapeau (à tort déjà vrai) ne doit jamais empêcher la correction réelle');
  assert.strictEqual(pushed.length, 1, 'la correction doit être poussée même si le drapeau local prétend que c\'est déjà fait');

  console.log('OK — reprise-noms-visites-medicales-serveur-18-09.test.js (insensible à un drapeau local déjà fuité côté serveur)');
}

async function runRienAPousserSiDejaCorrect() {
  const { sandbox, ensureNomsPrenomsMigresVersServeur, ensureVisitesMedicalesMigreesVersServeur } = loadDataJs();
  const rh = { id: 'rh1', role: 'rh', nom: 'MARTIN', prenom: 'Jean', suiviMedicalType: 'simple', visitesMedicales: [] };
  const employee = { id: 'emp-ok', role: 'salarie', nom: 'DUPONT', prenom: 'Marie-Caroline', suiviMedicalType: 'simple', visitesMedicales: [] };
  const company = { id: 'c1', employees: [employee, rh] };

  const pushed = [];
  sandbox.window.SupabaseSync = { pushEmployees: async (payload) => { pushed.push(payload); } };

  await ensureNomsPrenomsMigresVersServeur(company, rh);
  await ensureVisitesMedicalesMigreesVersServeur(company, rh);

  assert.strictEqual(pushed.length, 0, 'rien à corriger ne doit déclencher aucun appel réseau, pour ne jamais bavarder pour rien à chaque connexion');

  console.log('OK — reprise-noms-visites-medicales-serveur-18-09.test.js (aucun appel réseau si déjà correct)');
}

async function runEchecReseauNJamaisBloquant() {
  const { sandbox, ensureNomsPrenomsMigresVersServeur } = loadDataJs();
  const rh = { id: 'rh1', role: 'rh' };
  const employee = employeeADeCorriger();
  const company = { id: 'c1', employees: [employee, rh] };

  sandbox.window.SupabaseSync = { pushEmployees: async () => { throw new Error('panne réseau simulée'); } };

  let threw = false;
  try {
    await ensureNomsPrenomsMigresVersServeur(company, rh);
  } catch {
    threw = true;
  }
  assert.strictEqual(threw, false, 'un échec réseau doit être avalé (retentera à la prochaine connexion), jamais bloquer la connexion en cours');
  assert.strictEqual(employee.nom, 'DUPONT', 'la correction reste appliquée en mémoire pour cette session malgré l\'échec réseau');

  console.log('OK — reprise-noms-visites-medicales-serveur-18-09.test.js (échec réseau avalé, jamais bloquant)');
}

async function runIntegreeALaConnexionReelle() {
  const { sandbox, hydrateCurrentCompanyWithMigrations, seedLeaveTypes } = loadDataJs();
  const rh = { id: 'rh1', role: 'rh', nom: 'martin', prenom: 'jean' };
  const allDefaultNames = seedLeaveTypes().map(t => t.nom.trim().toLowerCase());
  const pushedEmployees = [];
  sandbox.window.SupabaseSync = {
    hydrateCurrentCompany: async () => ({
      id: 'c1', _currentEmployeeId: 'rh1', employees: [rh],
      defaultLeaveTypesSeeded: allDefaultNames, leaveTypes: []
    }),
    pushEmployees: async (payload) => { pushedEmployees.push(payload); },
    pushCompanyProfile: async () => {},
    pushLeaveTypes: async () => {}
  };
  const company = await hydrateCurrentCompanyWithMigrations();
  assert.strictEqual(company.employees[0].nom, 'MARTIN', 'la connexion réelle doit déclencher la reprise, pas seulement DB.init()');
  assert.ok(pushedEmployees.length >= 1, 'la connexion réelle doit réellement pousser la correction au serveur');

  console.log('OK — reprise-noms-visites-medicales-serveur-18-09.test.js (branchée sur la vraie connexion, hydrateCurrentCompanyWithMigrations)');
}

runPousseVersServeurAvecPermission()
  .then(runAucunEnvoiSansPermission)
  .then(runInsensibleAUnDrapeauDejaFuiteAuServeur)
  .then(runRienAPousserSiDejaCorrect)
  .then(runEchecReseauNJamaisBloquant)
  .then(runIntegreeALaConnexionReelle)
  .catch((err) => {
    console.error('ÉCHEC — reprise-noms-visites-medicales-serveur-18-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
