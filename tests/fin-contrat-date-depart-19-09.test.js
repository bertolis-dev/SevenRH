/**
 * Seven RH — retour Betty du 19/09/2026 (point 1.1, "date de départ et date de fin de contrat") :
 * seule dateDepart retire un salarié du planning/paie/tickets restaurant/effectif légal (voir
 * isEmployedDuringPeriod/getEffectifActifAt, app.js) — dateFinContrat ne servait jusqu'ici qu'à
 * l'affichage et aux alertes, jamais reportée. Un CDD terminé sans date de départ saisie (réflexe
 * naturel : les deux champs vivaient dans deux onglets différents) restait donc compté présent
 * indéfiniment. Trois filets superposés désormais : report automatique à la connexion
 * (ensureContratsTermineDateDepartAutoDeduite), avertissement + bouton "reporter" en direct dans le
 * formulaire (openEmployeeModal/bindFinContratFields), et anomalie persistante dans "Qualité des
 * données" (getDataQualityIssues) tant que ce n'est pas corrigé ou relu.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function makeCompanyEtRh() {
  const rh = { id: 'rh1', prenom: 'Camille', nom: 'LEFÈVRE', role: 'rh' };
  const company = {
    id: 'c1',
    auditLog: [],
    employees: [
      { id: 'e1', prenom: 'Sarah', nom: 'BENALI', role: 'salarie', archive: false, statut: 'Actif',
        typeContrat: 'CDD', dateFinContrat: '2026-06-30', dateDepart: '', departAutoDeduit: false },
      { id: 'e2', prenom: 'Julien', nom: 'MOREAU', role: 'salarie', archive: false, statut: 'Actif',
        typeContrat: 'CDD', dateFinContrat: '2099-01-01', dateDepart: '', departAutoDeduit: false }, // fin de contrat future : jamais reportée par anticipation
      { id: 'e3', prenom: 'Nicolas', nom: 'GIRARD', role: 'salarie', archive: false, statut: 'Actif',
        typeContrat: 'CDI', dateFinContrat: '', dateDepart: '', departAutoDeduit: false }, // CDI : dateFinContrat n'a jamais de sens ici
      { id: 'e4', prenom: 'Léa', nom: 'DUBOIS', role: 'salarie', archive: false, statut: 'Actif',
        typeContrat: 'CDD', dateFinContrat: '2026-01-15', dateDepart: '2026-01-15', departAutoDeduit: false } // déjà correctement renseigné : ne doit jamais être re-traité
    ]
  };
  return { company, rh };
}

async function runReportAutomatiqueViaHydration() {
  const { sandbox, ensureContratsTermineDateDepartAutoDeduite } = loadAppJs();
  const { company, rh } = makeCompanyEtRh();
  const pushedEmployees = [];
  const pushedAudit = [];
  sandbox.window.SupabaseSync = {
    pushEmployees: async (payload) => { pushedEmployees.push(payload); },
    pushAuditLogEntry: async (entry) => { pushedAudit.push(entry); }
  };

  await ensureContratsTermineDateDepartAutoDeduite(company, rh);

  const e1 = company.employees.find(e => e.id === 'e1');
  assert.strictEqual(e1.dateDepart, '2026-06-30', 'CDD terminé (fin de contrat passée) sans date de départ : reportée automatiquement');
  assert.strictEqual(e1.departAutoDeduit, true, 'marqué à vérifier, pour rester signalé jusqu\'à relecture humaine');

  const e2 = company.employees.find(e => e.id === 'e2');
  assert.strictEqual(e2.dateDepart, '', 'fin de contrat encore À VENIR : jamais reportée par anticipation');

  const e3 = company.employees.find(e => e.id === 'e3');
  assert.strictEqual(e3.dateDepart, '', 'un CDI n\'a pas de dateFinContrat : rien à reporter');

  const e4 = company.employees.find(e => e.id === 'e4');
  assert.strictEqual(e4.dateDepart, '2026-01-15', 'déjà correctement renseignée : ne doit jamais être retouchée');
  assert.strictEqual(e4.departAutoDeduit, false, 'déjà correcte manuellement : jamais marquée "à vérifier"');

  assert.strictEqual(pushedEmployees.length, 1);
  assert.strictEqual(pushedEmployees[0].modified.length, 1, 'seul le salarié réellement concerné (e1) doit être poussé au serveur');
  assert.strictEqual(pushedEmployees[0].modified[0].id, 'e1');

  assert.strictEqual(pushedAudit.length, 1, 'le report doit être tracé dans le journal d\'audit');
  assert.strictEqual(pushedAudit[0].action, 'Modification');
  assert.strictEqual(pushedAudit[0].entite, 'Salarié');
  assert.strictEqual(pushedAudit[0].auteur, 'Système (report automatique)', 'personne n\'a réellement pris cette décision : jamais attribuée à qui s\'est connecté par hasard');

  console.log('OK — fin-contrat-date-depart-19-09.test.js (report automatique : seul le CDD réellement terminé sans départ est corrigé, tracé, jamais par anticipation)');
}

async function runAucunReportSansLaPermission() {
  const { sandbox, ensureContratsTermineDateDepartAutoDeduite } = loadAppJs();
  const { company } = makeCompanyEtRh();
  const managerSansDroit = { id: 'm1', prenom: 'Thomas', nom: 'PETIT', role: 'manager' };
  let appele = false;
  sandbox.window.SupabaseSync = { pushEmployees: async () => { appele = true; }, pushAuditLogEntry: async () => { appele = true; } };

  await ensureContratsTermineDateDepartAutoDeduite(company, managerSansDroit);

  assert.strictEqual(company.employees.find(e => e.id === 'e1').dateDepart, '', 'sans le droit MODIFIER_SALARIE, aucun report ne doit avoir lieu');
  assert.strictEqual(appele, false);

  console.log('OK — fin-contrat-date-depart-19-09.test.js (report automatique réservé à MODIFIER_SALARIE, comme les migrations voisines)');
}

async function runAnomaliesQualiteDonnees() {
  const { DB, sandbox, employeeRepository } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  const autreSalarie = employeeRepository.getAll().find(e => e.role === 'salarie' && e.id !== salarie.id);

  employeeRepository.update(salarie.id, { typeContrat: 'CDD', dateFinContrat: '2020-01-01', dateDepart: '' });
  employeeRepository.update(autreSalarie.id, { typeContrat: 'CDD', dateFinContrat: '2020-01-01', dateDepart: '2020-01-01', departAutoDeduit: true });

  const { getDataQualityIssues } = sandbox;
  const issues = getDataQualityIssues();

  const finSansDepart = issues.find(i => i.label.includes('sans date de départ'));
  assert.ok(finSansDepart, 'un CDD dont la fin de contrat est passée sans date de départ doit apparaître dans "Qualité des données"');
  assert.ok(finSansDepart.employees.some(e => e.id === salarie.id));

  const aVerifier = issues.find(i => i.label.includes('à vérifier'));
  assert.ok(aVerifier, 'une date de départ déduite automatiquement, jamais encore relue, doit rester signalée');
  assert.ok(aVerifier.employees.some(e => e.id === autreSalarie.id));

  console.log('OK — fin-contrat-date-depart-19-09.test.js (getDataQualityIssues : les deux nouvelles anomalies remontent bien)');
}

async function runFicheSalarieDeuxDatesReuniesDansLeMemeOnglet() {
  const { DB, sandbox, openEmployeeModal, employeeRepository } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  employeeRepository.update(salarie.id, { typeContrat: 'CDD', dateFinContrat: '2020-01-01', dateDepart: '' });

  openEmployeeModal(salarie.id);
  const html = sandbox.document.getElementById('modal-root').innerHTML;

  const statutPanelMatch = html.match(/data-employee-tab-panel="statut"[\s\S]*?<\/fieldset>/);
  assert.ok(statutPanelMatch, 'onglet Statut introuvable');
  const statutPanel = statutPanelMatch[0];
  assert.ok(statutPanel.includes('id="f-dateFinContrat"'), 'dateFinContrat doit être dans le même onglet que dateDepart (bloc "Fin de contrat" réuni)');
  assert.ok(statutPanel.includes('id="f-dateDepart"'));
  assert.ok(statutPanel.includes('Fin de contrat'), 'le sous-titre du bloc réuni doit être présent');

  const contratPanelMatch = html.match(/data-employee-tab-panel="contrat"[\s\S]*?<\/fieldset>/);
  assert.ok(!contratPanelMatch[0].includes('id="f-dateFinContrat"'), 'dateFinContrat ne doit plus apparaître DEUX FOIS (retirée de Contrat & poste)');

  assert.ok(statutPanel.includes('fin-contrat-sans-depart-warning'), 'l\'avertissement doit être présent (visible ou non selon les dates)');
  assert.ok(statutPanel.includes('class="field-warning visible"'), 'fin de contrat 2020 passée sans départ : l\'avertissement doit être visible dès le rendu initial');
  assert.ok(statutPanel.includes('btn-reporter-date-depart'), 'le bouton "reporter" doit être proposé');

  console.log('OK — fin-contrat-date-depart-19-09.test.js (fiche salarié : les deux dates réunies dans un seul bloc, avertissement visible dès le rendu initial si déjà en anomalie)');
}

async function runBandeauDepartAutoDeduitAffiche() {
  const { DB, sandbox, openEmployeeModal, employeeRepository } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  employeeRepository.update(salarie.id, { typeContrat: 'CDD', dateFinContrat: '2020-01-01', dateDepart: '2020-01-01', departAutoDeduit: true });

  openEmployeeModal(salarie.id);
  const html = sandbox.document.getElementById('modal-root').innerHTML;
  assert.ok(html.includes('déduite automatiquement'), 'un bandeau doit prévenir que cette date de départ vient du report automatique, pas d\'une saisie manuelle');

  console.log('OK — fin-contrat-date-depart-19-09.test.js (bandeau "déduite automatiquement" affiché tant que departAutoDeduit est vrai)');
}

async function runReenregistrementEffaceLeMarqueurADeVerifier() {
  // Contrôle défensif sur le code source (même patron que convention-collective-auto-18-09.test.js,
  // runSuggestionJamaisAppliqueeAutomatiquement) : submitEmployeeForm doit remettre departAutoDeduit
  // à false avant TOUT enregistrement d'une fiche existante, que la personne ait changé les dates ou
  // simplement relu et validé.
  const fs = require('fs');
  const path = require('path');
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const fnStart = appSource.indexOf('function submitEmployeeForm(');
  const ifIdStart = appSource.indexOf('if (id) {', fnStart);
  const fnBody = appSource.slice(ifIdStart, ifIdStart + 600);
  assert.ok(fnBody.includes('patch.departAutoDeduit = false'),
    'réenregistrer une fiche existante doit toujours effacer le marqueur "à vérifier" (relecture humaine faite, corrigée ou confirmée)');

  console.log('OK — fin-contrat-date-depart-19-09.test.js (réenregistrer la fiche efface le marqueur "à vérifier")');
}

runReportAutomatiqueViaHydration()
  .then(runAucunReportSansLaPermission)
  .then(runAnomaliesQualiteDonnees)
  .then(runFicheSalarieDeuxDatesReuniesDansLeMemeOnglet)
  .then(runBandeauDepartAutoDeduitAffiche)
  .then(runReenregistrementEffaceLeMarqueurADeVerifier)
  .catch((err) => {
    console.error('ÉCHEC — fin-contrat-date-depart-19-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
