/**
 * Seven RH — retour Betty du 14/09/2026 (Congés, "rappel au retour + visite médicale") : une
 * visite de reprise (Code du travail L4624-2-1) est obligatoire au retour d'un arrêt assez long,
 * ou de toute maladie professionnelle quelle que soit sa durée. Distinct du suivi médical
 * périodique déjà existant (employee.dateDerniereVisiteMedicale, sans rapport avec une absence).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function ajouterDemande(DB, patch) {
  const list = DB.getLeaveRequests();
  const demande = Object.assign({ id: `lr-${list.length + 1}`, typeId: 'maladie-type', statut: 'Validé', dateCreation: new Date().toISOString(), dateModification: new Date().toISOString(), historique: [], visiteRepriseDate: null }, patch);
  list.push(demande);
  DB.saveLeaveRequests(list);
  return demande;
}

async function runFonctionPure() {
  const { necessiteVisiteReprise } = loadAppJs();

  // Maladie ordinaire de 10 jours, sous le seuil (30j) : pas de rappel.
  assert.strictEqual(necessiteVisiteReprise({ arretTravail: { typeArret: 'maladie' }, dateDebut: '2026-09-01', dateFin: '2026-09-10' }, 30), false);
  // Maladie ordinaire de 35 jours, au-dessus du seuil : rappel.
  assert.strictEqual(necessiteVisiteReprise({ arretTravail: { typeArret: 'maladie' }, dateDebut: '2026-08-01', dateFin: '2026-09-04' }, 30), true);
  // Maladie professionnelle de 3 jours seulement : rappel malgré tout, quelle que soit la durée.
  assert.strictEqual(necessiteVisiteReprise({ arretTravail: { typeArret: 'maladieProfessionnelle' }, dateDebut: '2026-09-01', dateFin: '2026-09-03' }, 30), true);
  // Pas un arrêt de travail (congé payé classique) : jamais de rappel, quelle que soit la durée.
  assert.strictEqual(necessiteVisiteReprise({ arretTravail: null, dateDebut: '2026-01-01', dateFin: '2026-02-01' }, 30), false);

  console.log('OK — visite-reprise-14-09.test.js (fonction pure : seuil configurable, maladie professionnelle toujours concernée, jamais hors arrêt de travail)');
}

async function runDetection() {
  const { DB, sandbox, getVisitesRepriseAFaire } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const settings = { seuilVisiteRepriseJours: 30 };
  const [salarieA, salarieB, salarieC] = DB.getEmployees();

  // A : arrêt long, terminé, jamais régularisé -> doit apparaître.
  ajouterDemande(DB, { employeeId: salarieA.id, dateDebut: '2026-07-01', dateFin: '2026-08-15', arretTravail: { typeArret: 'accidentTravail' } });
  // B : arrêt long mais DÉJÀ régularisé -> ne doit plus apparaître.
  ajouterDemande(DB, { employeeId: salarieB.id, dateDebut: '2026-07-01', dateFin: '2026-08-15', arretTravail: { typeArret: 'maladie' }, visiteRepriseDate: '2026-08-16' });
  // C : arrêt encore EN COURS (dateFin dans le futur) -> ne doit jamais apparaître avant le retour réel.
  ajouterDemande(DB, { employeeId: salarieC.id, dateDebut: '2026-09-01', dateFin: '2099-01-01', arretTravail: { typeArret: 'accidentTravail' } });

  const resultat = getVisitesRepriseAFaire(DB.getEmployees(), DB.getLeaveRequests(), settings);
  assert.strictEqual(resultat.length, 1, 'seul le salarié A doit avoir un rappel en attente');
  assert.strictEqual(resultat[0].employee.id, salarieA.id);

  console.log('OK — visite-reprise-14-09.test.js (détection : ignore les visites déjà faites et les arrêts encore en cours, un seul rappel par salarié)');
}

async function runEcranEtAction() {
  const { DB, sandbox, getVisitesRepriseAFaire, renderVisitesRepriseCard, leaveRepository } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const settings = { seuilVisiteRepriseJours: 30 };
  const salarie = DB.getEmployees()[0];
  const demande = ajouterDemande(DB, { employeeId: salarie.id, dateDebut: '2026-07-01', dateFin: '2026-08-15', arretTravail: { typeArret: 'maladieProfessionnelle' } });

  assert.strictEqual(renderVisitesRepriseCard([]), '', 'jamais affichée vide, contrairement au suivi médical périodique attendu même sans échéance');

  const visites = getVisitesRepriseAFaire(DB.getEmployees(), DB.getLeaveRequests(), settings);
  const html = renderVisitesRepriseCard(visites);
  assert.ok(html.includes('maladie professionnelle'), 'le type d\'arrêt doit être rappelé en toutes lettres');
  assert.ok(html.includes(`data-marquer-visite-reprise="${demande.id}"`));

  const resultat = leaveRepository.update(demande.id, { visiteRepriseDate: '2026-09-14' });
  assert.ok(resultat.visiteRepriseDate);
  const visitesApres = getVisitesRepriseAFaire(DB.getEmployees(), DB.getLeaveRequests(), settings);
  assert.strictEqual(visitesApres.length, 0, 'une fois marquée faite, le rappel ne doit plus jamais réapparaître');

  console.log('OK — visite-reprise-14-09.test.js (écran : jamais affiché vide, type d\'arrêt en clair, disparaît une fois marqué fait)');
}

runFonctionPure()
  .then(runDetection)
  .then(runEcranEtAction)
  .catch((err) => {
    console.error('ÉCHEC — visite-reprise-14-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
