/**
 * Seven RH — brief du 12/10/2026, B2 : un jour de télétravail réduit-il le nombre de tickets restaurant ?
 * Constat : c'était déjà paramétrable (case « Le télétravail donne droit à un ticket », défaut vrai), mais
 * aucun test ne couvrait les deux cas, et une valeur de réglage ABSENTE (entreprise ancienne, appel avec des
 * réglages partiels) excluait le télétravail alors que le défaut voulu est de ne PAS l'exclure.
 * Point juridique à valider (docs/regles-a-valider.md) : l'équivalence télétravail / présence pour le droit au
 * titre-restaurant dépend de la situation du salarié comparée à celle d'un salarié sur site.
 */
const assert = require('assert');
const { loadDataJs } = require('./load-data-js');
const { loadAppJs } = require('./load-app-js');

const employee = { id: 'e1', joursTravailles: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'], dateEmbauche: '2020-01-01', ticketsCommandesEnregistrees: {}, ticketsAjustements: {} };
// octobre 2030 : 23 jours ouvrés Lun-Ven ; deux jours de télétravail validés (mar. 8 et mer. 9)
const teletravail = [{ employeeId: 'e1', statut: 'Validé', dateDebut: '2030-10-08', dateFin: '2030-10-09' }];

function run() {
  const { calculateTicketsRestaurant } = loadDataJs();
  const base = { ticketsValeurFaciale: 9, ticketsPartEmployeurPct: 60 };

  const inclus = calculateTicketsRestaurant(employee, 2030, 9, [], teletravail, { ...base, ticketsInclureTeletravail: true });
  assert.strictEqual(inclus.nbTickets, 23, 'télétravail inclus : un ticket par jour travaillé, télétravail compris');

  const exclu = calculateTicketsRestaurant(employee, 2030, 9, [], teletravail, { ...base, ticketsInclureTeletravail: false });
  assert.strictEqual(exclu.nbTickets, 21, 'télétravail exclu : 2 jours de télétravail en moins');
  assert.strictEqual(exclu.joursAbsences, 2);

  const absent = calculateTicketsRestaurant(employee, 2030, 9, [], teletravail, { ...base });
  assert.strictEqual(absent.nbTickets, 23, 'réglage absent : le télétravail n\'est PAS exclu (défaut voulu)');

  console.log('OK — b2-tickets-teletravail-12-10.test.js (télétravail inclus / exclu / réglage absent)');
}

function runLeDefautEtLEcranLeDisent() {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  const rh = api.DB.getEmployees().find(e => e.role === 'rh');
  api.DB._currentEmployeeId = rh.id;
  assert.strictEqual(api.settingsRepository.getSettings().ticketsInclureTeletravail, true, 'par défaut, le télétravail ne réduit pas les tickets');
  const html = api.renderParametresTicketsRestaurant();
  assert.ok(html.includes('id="f-tickets-teletravail"'), 'le réglage existe dans Paramètres > Tickets restaurant');
  assert.ok(/à valider/i.test(html), 'l\'écran signale que cette règle est à valider juridiquement');
  console.log('OK — b2-tickets-teletravail-12-10.test.js (défaut = inclus, réglage visible, mention « à valider »)');
}

try { run(); runLeDefautEtLEcranLeDisent(); } catch (err) { console.error('ÉCHEC — b2-tickets-teletravail-12-10.test.js'); console.error(err.stack || err.message); process.exitCode = 1; }
