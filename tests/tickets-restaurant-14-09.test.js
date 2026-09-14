/**
 * Seven RH — retour Betty du 14/09/2026 (revue concurrentielle, Tickets restaurant) : fichier de
 * commande mensuel (point 1), suivi des bénéficiaires entrée/sortie (point 2), régularisation
 * automatique proposée si une absence est déclarée après la commande (point 3), et rappel du
 * plafond d'exonération URSSAF déjà existant, désormais visible sur l'écran mensuel (point 4).
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

  // ---- La valeur suggérée est bien celle transmise à la modale de correction (RH garde la main,
  // jamais une écriture automatique silencieuse) ----
  {
    const { DB, sandbox, openCorrigerTicketsModal, employeeRepository, state } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    state.ticketsYear = 2026;
    state.ticketsMonth = 2;
    openCorrigerTicketsModal(salarie.id, -7);
    const html = sandbox.document.getElementById('modal-root').innerHTML;
    assert.ok(html.includes('value="-7"'), 'la valeur suggérée doit pré-remplir le champ de correction, jamais s\'appliquer toute seule');
    assert.ok(html.includes('pré-remplie suggérée automatiquement'), 'un message doit expliquer que RH doit vérifier avant de valider');
  }

  console.log('OK — tickets-restaurant-14-09.test.js (régularisation automatique : détectée si absence tardive, disparaît une fois corrigée)');
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

runPures().then(runUi).catch((err) => {
  console.error('ÉCHEC — tickets-restaurant-14-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
