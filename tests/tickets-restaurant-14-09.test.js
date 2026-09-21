/**
 * Seven RH — retour Betty du 14/09/2026 (revue concurrentielle, Tickets restaurant) : fichier de
 * commande mensuel (point 1), suivi des bénéficiaires entrée/sortie (point 2), régularisation
 * automatique proposée si une absence est déclarée après la commande (point 3), et rappel du
 * plafond d'exonération URSSAF déjà existant, désormais visible sur l'écran mensuel (point 4).
 *
 * §retour Betty du 22/09/2026 (défaut 1.1, "les tickets restaurant ne peuvent pas être commandés") :
 * calculateTicketsRestaurant s'arrêtait au jour courant ("jour pas encore travaillé") — un compteur
 * de jours déjà écoulés, jamais un nombre de titres à commander pour le mois entier. Un mois
 * entièrement futur (le cas réel d'une commande passée d'avance) rendait systématiquement zéro. Le
 * calcul porte désormais toujours sur le mois complet ; la régularisation du mois précédent (point 3
 * ci-dessus) est désormais repliée AUTOMATIQUEMENT dans le calcul du mois suivant (jamais une
 * suggestion à valider manuellement) — remplace le test "valeur suggérée pré-remplie" ci-dessous,
 * devenu sans objet puisque openCorrigerTicketsModal ne reçoit plus de delta suggéré.
 */
const assert = require('assert');
const { loadDataJs } = require('./load-data-js');
const { loadAppJs } = require('./load-app-js');

async function runPures() {
  // ---- Aucune commande jamais enregistrée pour ce mois : rien à régulariser ----
  {
    const { calculerEcartRegularisationTickets } = loadDataJs();
    const employee = { id: 'e1', joursTravailles: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'], dateEmbauche: '2020-01-01', ticketsCommandesEnregistrees: {} };
    const result = calculerEcartRegularisationTickets(employee, 2026, 0, [], [], { ticketsValeurFaciale: 9, ticketsPartEmployeurPct: 60, ticketsInclureTeletravail: true });
    assert.strictEqual(result, null, 'sans commande jamais enregistrée pour ce mois, aucune régularisation à proposer');
  }

  // ---- Une absence validée APRÈS la commande fait baisser le calcul : écart détecté et signé correctement ----
  {
    const { calculerEcartRegularisationTickets, ticketsMonthKey } = loadDataJs();
    const monthKey = ticketsMonthKey(2026, 0); // janvier 2026
    const employee = {
      id: 'e1', joursTravailles: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'], dateEmbauche: '2020-01-01',
      ticketsCommandesEnregistrees: { [monthKey]: 21 }, ticketsAjustements: {}
    };
    const congeDeclareApresLaCommande = [{ employeeId: 'e1', statut: 'Validé', dateDebut: '2026-01-05', dateFin: '2026-01-09', demiJournee: null }];
    const result = calculerEcartRegularisationTickets(employee, 2026, 0, congeDeclareApresLaCommande, [], { ticketsValeurFaciale: 9, ticketsPartEmployeurPct: 60, ticketsInclureTeletravail: true });
    assert.ok(result, 'une absence qui change le calcul après coup doit être détectée');
    assert.strictEqual(result.commande, 21);
    assert.ok(result.ecart < 0, 'une absence en plus doit réduire le nombre de titres réellement dus, donc un écart négatif');
  }

  // ---- Une fois l'écart entre commande et calcul actuel résorbé (peu importe le sens exact
  // choisi par RH), la suggestion ne doit plus jamais réapparaître pour cette valeur ----
  {
    const { calculerEcartRegularisationTickets, ticketsMonthKey } = loadDataJs();
    const monthKey = ticketsMonthKey(2026, 0);
    const congeDeclareApresLaCommande = [{ employeeId: 'e1', statut: 'Validé', dateDebut: '2026-01-05', dateFin: '2026-01-09', demiJournee: null }];
    const settings = { ticketsValeurFaciale: 9, ticketsPartEmployeurPct: 60, ticketsInclureTeletravail: true };
    const employeeSansCorrection = {
      id: 'e1', joursTravailles: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'], dateEmbauche: '2020-01-01',
      ticketsCommandesEnregistrees: { [monthKey]: 21 }, ticketsAjustements: {}
    };
    const ecartAvant = calculerEcartRegularisationTickets(employeeSansCorrection, 2026, 0, congeDeclareApresLaCommande, [], settings);
    // RH ajuste manuellement (via la modale pré-remplie) pour que le calcul retombe EXACTEMENT sur
    // ce qui a été commandé — libre à RH de choisir cette valeur ou une autre, ce test vérifie
    // seulement que la fonction réagit correctement à un ajustement qui égalise les deux nombres.
    const ajustementQuiEgalise = ecartAvant.commande - ecartAvant.actuel;
    const employeeAvecCorrection = Object.assign({}, employeeSansCorrection, { ticketsAjustements: { [monthKey]: ajustementQuiEgalise } });
    const ecartApres = calculerEcartRegularisationTickets(employeeAvecCorrection, 2026, 0, congeDeclareApresLaCommande, [], settings);
    assert.strictEqual(ecartApres, null, 'une fois le calcul aligné sur ce qui a été commandé, la suggestion doit disparaître');
  }

  // ---- La modale de correction manuelle reste disponible, sans aucun delta suggéré (désormais
  // repris automatiquement par le calcul du mois suivant, voir plus bas) ----
  {
    const { DB, sandbox, openCorrigerTicketsModal, state } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    state.ticketsYear = 2026;
    state.ticketsMonth = 2;
    openCorrigerTicketsModal(salarie.id);
    const html = sandbox.document.getElementById('modal-root').innerHTML;
    assert.ok(html.includes('id="f-delta"'), 'le champ de correction manuelle doit toujours exister');
    assert.ok(!html.includes('pré-remplie suggérée automatiquement'), 'plus de pré-remplissage automatique : la régularisation se fait désormais sur le mois suivant, sans validation manuelle');
  }

  console.log('OK — tickets-restaurant-14-09.test.js (régularisation détectée si absence tardive, disparaît une fois corrigée, modale de correction manuelle toujours disponible)');
}

async function runCalculPorteToujoursSurLeMoisComplet() {
  const { calculateTicketsRestaurant } = loadDataJs();
  const employee = {
    id: 'e1', joursTravailles: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'], dateEmbauche: '2020-01-01',
    ticketsCommandesEnregistrees: {}, ticketsAjustements: {}
  };
  const settings = { ticketsValeurFaciale: 9, ticketsPartEmployeurPct: 60, ticketsInclureTeletravail: true };

  // §défaut 1.1 : un mois ENTIÈREMENT futur (2030, forcément après "aujourd'hui" au moment où ce
  // test tourne) doit donner le vrai compte de jours ouvrés du mois, jamais zéro — c'est exactement
  // le cas réel signalé ("le fichier de commande sort vide" pour le mois à venir).
  const octobre2030 = calculateTicketsRestaurant(employee, 2030, 9, [], [], settings); // octobre : 23 jours ouvrés (Lun-Ven)
  assert.strictEqual(octobre2030.nbTickets, 23, 'un mois entièrement futur doit compter tous ses jours ouvrés, jamais zéro');
  assert.strictEqual(octobre2030.joursOuvres, 23);
  assert.strictEqual(octobre2030.joursFeriesFermetures, 0);
  assert.strictEqual(octobre2030.joursAbsences, 0);
  assert.strictEqual(octobre2030.theorique, 23);

  // Un congé validé sur un mois futur doit bien réduire le compte (le calcul futur n'ignore pas les
  // données déjà connues à la date de commande, il ignore seulement la date du jour).
  const congeOctobre2030 = [{ employeeId: 'e1', statut: 'Validé', dateDebut: '2030-10-07', dateFin: '2030-10-11', demiJournee: null }]; // une semaine complète, Lun-Ven
  const octobreAvecConge = calculateTicketsRestaurant(employee, 2030, 9, congeOctobre2030, [], settings);
  assert.strictEqual(octobreAvecConge.joursAbsences, 5);
  assert.strictEqual(octobreAvecConge.nbTickets, 18, '23 jours ouvrés moins 5 jours de congé validé sur le mois');

  console.log('OK — tickets-restaurant-14-09.test.js (le calcul porte toujours sur le mois complet, jamais seulement les jours déjà écoulés)');
}

async function runRegularisationRepliesAutomatiquementDansLeMoisSuivant() {
  const { DB, sandbox, employeeRepository, leaveTypeRepository, genererFichierCommandeTickets, leaveRepository, calculateTicketsRestaurant, state } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;
  const salarie = DB.getEmployees().find(e => e.role === 'salarie');
  sandbox.exportRowsToCSV = () => {};

  // Commande passée pour septembre 2030 (aucune absence connue à cet instant) : snapshot enregistré.
  state.ticketsYear = 2030;
  state.ticketsMonth = 8; // septembre
  genererFichierCommandeTickets();
  const employeeApresCommande = employeeRepository.getById(salarie.id);
  const commandeSeptembre = employeeApresCommande.ticketsCommandesEnregistrees['2030-09'];
  assert.ok(commandeSeptembre > 0, 'la commande de septembre doit avoir été enregistrée');

  // Une absence est déclarée APRÈS la commande, sur septembre — le calcul réel de septembre baisse.
  await leaveRepository.create({ employeeId: salarie.id, typeId: leaveTypeRepository.getLeaveTypes()[0].id, dateDebut: '2030-09-02', dateFin: '2030-09-06', nbJours: 5 });

  // §retour Betty du 22/09/2026 : l'écart doit apparaître SUR LA LIGNE DU MOIS SUIVANT (octobre),
  // intégré au total commandé — jamais seulement un bouton à cliquer sur la ligne de septembre.
  const resultatOctobre = calculateTicketsRestaurant(employeeRepository.getById(salarie.id), 2030, 9, leaveRepository.getAll(), [], DB.getSettings());
  assert.ok(resultatOctobre.regularisationMoisPrecedent, 'octobre doit porter la régularisation de septembre, automatiquement');
  assert.strictEqual(resultatOctobre.regularisationMoisPrecedent.commande, commandeSeptembre);
  assert.ok(resultatOctobre.regularisationMoisPrecedent.ecart < 0, 'une absence en plus sur septembre doit produire un écart négatif');
  assert.strictEqual(
    resultatOctobre.nbTickets,
    resultatOctobre.theorique + resultatOctobre.regularisationMoisPrecedent.ecart,
    'la régularisation doit être intégrée au total commandé d\'octobre, sans action manuelle'
  );

  console.log('OK — tickets-restaurant-14-09.test.js (la régularisation du mois précédent se replie automatiquement dans le mois suivant, sans validation manuelle)');
}

async function runUi() {
  // ---- Bénéficiaires : badge entrée/sortie affiché seulement pour le mois concerné ----
  {
    const { DB, sandbox, getTicketsRows, state } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    DB.updateEmployee(salarie.id, { dateEmbauche: '2026-01-15' });
    state.ticketsYear = 2026;
    state.ticketsMonth = 0; // janvier : l'entrée doit apparaître
    const rowsJanvier = getTicketsRows();
    const ligneJanvier = rowsJanvier.find(r => r.employee.id === salarie.id);
    assert.strictEqual(ligneJanvier.entreeDansLeMois, '2026-01-15', 'une entrée en janvier doit être signalée sur le mois de janvier');

    state.ticketsMonth = 1; // février : l'entrée n'est plus "dans le mois affiché"
    const rowsFevrier = getTicketsRows();
    const ligneFevrier = rowsFevrier.find(r => r.employee.id === salarie.id);
    assert.strictEqual(ligneFevrier.entreeDansLeMois, null, 'une entrée en janvier ne doit pas être re-signalée en février');
  }

  // ---- Fichier de commande : snapshot enregistré, réutilisé ensuite pour la régularisation ----
  {
    const { DB, sandbox, genererFichierCommandeTickets, employeeRepository, state } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    state.ticketsYear = 2026;
    state.ticketsMonth = 5;
    // §même limite assumée que les autres exports de ce projet (voir bug-sweep-07-09.test.js) :
    // Blob/téléchargement DOM réel non simulés dans ce bac à sable minimal.
    sandbox.exportRowsToCSV = () => {};
    genererFichierCommandeTickets();
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    const employeeApres = employeeRepository.getById(salarie.id);
    assert.ok(employeeApres.ticketsCommandesEnregistrees && employeeApres.ticketsCommandesEnregistrees['2026-06'] !== undefined, 'générer le fichier de commande doit enregistrer un snapshot pour chaque salarié');
  }

  // ---- Plafond d'exonération : réutilise la constante déjà existante, jamais une seconde valeur ----
  {
    const { DB, sandbox, renderTicketsEquipe } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const settings = DB.getSettings();
    settings.ticketsValeurFaciale = 12; // 12 × 60% = 7,20€/titre... testons un dépassement net
    settings.ticketsPartEmployeurPct = 90; // 12 × 90% = 10,80€, largement au-delà du plafond 2026
    DB.saveSettings(settings);
    const html = renderTicketsEquipe();
    assert.ok(html.includes('dépasse le plafond'), 'un réglage qui dépasse le plafond URSSAF doit être signalé directement sur l\'écran mensuel, pas seulement dans Paramètres');
  }

  console.log('OK — tickets-restaurant-14-09.test.js (bénéficiaires entrée/sortie, fichier de commande avec snapshot, rappel du plafond sur l\'écran mensuel)');
}

runPures()
  .then(runUi)
  .then(runCalculPorteToujoursSurLeMoisComplet)
  .then(runRegularisationRepliesAutomatiquementDansLeMoisSuivant)
  .catch((err) => {
    console.error('ÉCHEC — tickets-restaurant-14-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
