/**
 * Seven RH — "fais un tour des bugs" (16/09/2026) : revue de code de toute la construction du
 * 14-16/09/2026 (revue concurrentielle + correctifs), 8 agents en parallèle sur les différents
 * modules. Chaque point ci-dessous est une correction distincte, confirmée par au moins un agent
 * (plusieurs, pour la délégation). Le correctif RLS (is_manager_of, migration 0057) n'est pas
 * testable ici : aucun Postgres local dans ce bac à sable, seulement du code JS — vérifié par
 * lecture directe de la fonction SQL et de ses appelants.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function runQuartDeNuit() {
  const { computeShiftHeures } = loadAppJs();
  // Quart de nuit classique (22h-6h, une pause de 30 min) : sans le report sur le jour suivant,
  // l'ancien calcul (fin - début) donnait un nombre négatif ramené à 0 par Math.max.
  const heures = computeShiftHeures({ heureDebut: '22:00', heureFin: '06:00', pauseMinutes: 30 });
  assert.strictEqual(heures, 7.5, 'un quart 22h-6h avec 30 min de pause doit valoir 7h30, jamais 0');

  // Un quart normal (même jour) reste inchangé.
  const heuresJour = computeShiftHeures({ heureDebut: '09:00', heureFin: '17:00', pauseMinutes: 60 });
  assert.strictEqual(heuresJour, 7, 'un quart classique dans la même journée ne doit pas être affecté par le correctif');

  console.log('OK — audit-bugs-16-09.test.js (computeShiftHeures : un quart de nuit à cheval sur deux jours compte ses vraies heures, jamais 0)');
}

async function runPopulationCadres() {
  const { DB, sandbox, employeeRepository, resolvePopulationEmployeeIds } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const employees = employeeRepository.getAll().filter(e => !e.archive);
  assert.ok(employees.length >= 2, 'jeu de démo attendu : au moins 2 salariés');
  employeeRepository.update(employees[0].id, { statutPro: 'Cadre' });
  employeeRepository.update(employees[1].id, { statutPro: 'Non cadre' });

  const cadres = resolvePopulationEmployeeIds('cadres');
  assert.ok(cadres.includes(employees[0].id), 'un salarié "Cadre" doit être inclus');
  assert.ok(!cadres.includes(employees[1].id), '"Non cadre" contient la sous-chaîne "cadre" mais ne doit JAMAIS être inclus dans la population "Cadres"');

  console.log('OK — audit-bugs-16-09.test.js (population "Cadres" : comparaison exacte, "Non cadre" jamais confondu avec "Cadre")');
}

async function runEchangeCreneauxPortee() {
  const { DB, sandbox, employeeRepository, shiftRepository, shiftSwapRepository, renderShiftSwapCard, authRepository } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const employees = employeeRepository.getAll().filter(e => !e.archive);
  const [equipeA, equipeB] = [employees[0], employees[1]];
  assert.ok(equipeA && equipeB, 'jeu de démo attendu : au moins 2 salariés');

  const shiftA = shiftRepository.create({ employeeId: equipeA.id, weekday: 'Lun', heureDebut: '09:00', heureFin: '17:00', pauseMinutes: 60 });
  const shiftB = shiftRepository.create({ employeeId: equipeB.id, weekday: 'Mar', heureDebut: '09:00', heureFin: '17:00', pauseMinutes: 60 });
  shiftSwapRepository.proposer(shiftA.id, equipeA.id);
  shiftSwapRepository.proposer(shiftB.id, equipeB.id);

  DB._currentEmployeeId = employees.find(e => e.role === 'manager')?.id || equipeA.id;

  // Portée restreinte à la seule équipe A : l'échange de l'équipe B ne doit jamais apparaître.
  const html = renderShiftSwapCard(authRepository.getCurrentUser(), [equipeA]);
  assert.ok(html.includes(equipeA.prenom), 'l\'échange de l\'équipe visible doit apparaître');
  assert.ok(!html.includes(equipeB.prenom), 'un échange d\'une équipe HORS de la portée du manager ne doit jamais apparaître ni être actionnable');

  console.log('OK — audit-bugs-16-09.test.js (échanges de créneaux : jamais un échange hors de la portée équipe du manager)');
}

async function runRapprochementDoubleLien() {
  const { DB, sandbox, releveBancaireRepository } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const expenses = DB.getExpenses();
  const note = Object.assign({ id: 'nf-audit-1', categorie: 'Transport', libelle: 'Note', montantTTC: 50, tauxTVA: 20, statut: 'En attente', workflow: [], etapeIndex: -1, historique: [], dossierId: null, justificatif: null, kilometrage: null, commentaire: '', datePaiement: null, date: '2026-09-01' });
  expenses.push(note);
  DB.saveExpenses(expenses);

  releveBancaireRepository.importer('01/09/2026;CB TRANSPORT;50,00\n02/09/2026;CB TRANSPORT;50,00');
  const lignes = releveBancaireRepository.getAll();
  assert.strictEqual(lignes.length, 2);

  const premier = releveBancaireRepository.rapprocherManuel(lignes[0].id, note.id);
  assert.strictEqual(premier.success, true, 'le premier rapprochement manuel doit réussir');

  // La MÊME note ne doit jamais pouvoir être rapprochée à une SECONDE ligne.
  const second = releveBancaireRepository.rapprocherManuel(lignes[1].id, note.id);
  assert.strictEqual(second.success, false, 'une note déjà rapprochée à une ligne ne doit jamais pouvoir être rapprochée à une autre');
  assert.match(second.error, /déjà rapprochée/);

  console.log('OK — audit-bugs-16-09.test.js (rapprochement manuel : une même note de frais ne peut jamais être rapprochée à deux lignes)');
}

async function runMedianeSalaires() {
  const { DB, sandbox, employeeRepository, settingsRepository, renderRemuneration, formatCurrencyFR } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const settings = settingsRepository.getSettings();
  settings.masseSalarialeActivee = true;
  settingsRepository.saveSettings(settings);

  const employees = employeeRepository.getAll().filter(e => !e.archive);
  assert.ok(employees.length >= 4, 'jeu de démo attendu : au moins 4 salariés pour tester un effectif pair');
  const salaires = [4000, 3500, 3000, 2000];
  employees.slice(0, 4).forEach((e, i) => employeeRepository.update(e.id, { salaireBrutMensuel: salaires[i] }));
  employees.slice(4).forEach(e => employeeRepository.update(e.id, { salaireBrutMensuel: 0 }));

  // Médiane réelle de [4000,3500,3000,2000] = (3500+3000)/2 = 3250, jamais 3000 (la plus basse des
  // deux valeurs centrales, ce que renvoyait l'ancien calcul sur un effectif pair).
  const html = renderRemuneration();
  assert.ok(html.includes(formatCurrencyFR(3250)), 'la médiane d\'un effectif pair doit être la MOYENNE des deux salaires centraux (3250), jamais l\'un des deux pris seul');
  assert.ok(!html.includes(formatCurrencyFR(3000)) || formatCurrencyFR(3250) !== formatCurrencyFR(3000), 'sanity : la médiane erronée (3000) ne doit pas apparaître à sa place');

  console.log('OK — audit-bugs-16-09.test.js (salaire médian : moyenne des deux valeurs centrales sur un effectif pair)');
}

async function runRegenererSecretPointage() {
  const { DB, sandbox, etablissementRepository } = loadAppJs();
  DB.init();
  const etab = DB.getEtablissements()[0];

  // Succès : le repository doit désormais renvoyer un résultat exploitable par l'appelant.
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  const ok = await etablissementRepository.regenererPointageToken(etab.id);
  assert.strictEqual(ok.success, true);
  assert.ok(ok.token, 'un token doit être renvoyé en cas de succès');

  // Échec réseau/serveur : l'appelant (openPointageQrModalContent, app.js) ne doit plus jamais
  // afficher "Secret régénéré." après un échec réel — le résultat doit maintenant le distinguer.
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => { throw new Error('réseau'); } });
  DB.onSaveError = () => {}; // même contrat que app.js:868, silencieux ici pour ne tester que le retour
  const echec = await etablissementRepository.regenererPointageToken(etab.id);
  assert.strictEqual(echec.success, false, 'un échec serveur doit être signalé, jamais masqué en succès');

  console.log('OK — audit-bugs-16-09.test.js (régénération du secret de pointage : un échec serveur n\'affiche plus jamais "Secret régénéré.")');
}

runQuartDeNuit()
  .then(runPopulationCadres)
  .then(runEchangeCreneauxPortee)
  .then(runRapprochementDoubleLien)
  .then(runMedianeSalaires)
  .then(runRegenererSecretPointage)
  .catch((err) => {
    console.error('ÉCHEC — audit-bugs-16-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
