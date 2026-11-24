/**
 * Revue Nexus du 24/11/2026 :
 *  - demande n° 22 : une demi-journée en début (après-midi) ou en fin (matin) de période ne retire pas de ticket restaurant ;
 *  - demande n° 23 : colonne « Pointage » (jours d'absence cumulés hors demi-journées, tickets distribués, écart, propositions à valider par le RH) ;
 *  - demande n° 21 : export Excel du calendrier avec cumul annuel et demi-journées.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

const api = loadAppJs();
api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
api.DB.init();
const { DB } = api;
const sb = api.sandbox;

const salarie = DB.getEmployees().find(e => e.role === 'salarie');
const rh = DB.getEmployees().find(e => e.role === 'rh');
DB._currentEmployeeId = rh.id;
const employee = { ...salarie, dateEmbauche: '2020-01-01', dateDepart: '', joursTravailles: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'], ticketsCommandesEnregistrees: {}, ticketsRegularisations: [] };
const settings = { ...DB.getSettings(), ticketsValeurFaciale: 9, ticketsPartEmployeurPct: 60, ticketsInclureTeletravail: true, joursFeriesPersonnalises: [], feriesOverrides: {}, fermetures: [], ticketsCommandesDates: {}, ticketsCommandesInstants: {} };
const type = DB.getLeaveTypes()[0];

const calcul = (conges) => sb.calculateTicketsRestaurant(employee, 2026, 9, conges, [], settings); // octobre 2026 : 22 jours ouvrés, aucun férié
const base = calcul([]);
assert.strictEqual(base.nbTickets, 22, 'octobre 2026 : 22 jours ouvrés');

// ---- Demande n° 22 : demi-journées de début et de fin de période ----
// Du 02/10 après-midi au 07/10 matin : 02 (ven), 05 (lun), 06 (mar), 07 (mer). Le 02 et le 07 sont des demi-journées : seuls le 05 et le 06 retirent un ticket.
const periode = [{ id: 'c1', employeeId: employee.id, typeId: type.id, statut: 'Validé', dateDebut: '2026-10-02', dateFin: '2026-10-07', demiJourneeDebut: 'apres-midi', demiJourneeFin: 'matin', demiJournee: null }];
assert.strictEqual(calcul(periode).joursAbsences, 2, 'seules les deux journées complètes (05 et 06) retirent un ticket');
assert.strictEqual(calcul(periode).nbTickets, 20);
// Une période à journées complètes aux deux bouts retire bien quatre tickets
const complete = [{ ...periode[0], demiJourneeDebut: null, demiJourneeFin: null }];
assert.strictEqual(calcul(complete).joursAbsences, 4, 'sans demi-journée : quatre jours');
// Une seule extrémité en demi-journée : un ticket de moins retiré
assert.strictEqual(calcul([{ ...periode[0], demiJourneeFin: null }]).joursAbsences, 3, 'seul le début est une demi-journée');
assert.strictEqual(calcul([{ ...periode[0], demiJourneeDebut: null }]).joursAbsences, 3, 'seule la fin est une demi-journée');
// Le cas déjà géré reste vrai : demi-journée isolée
assert.strictEqual(calcul([{ id: 'c2', employeeId: employee.id, typeId: type.id, statut: 'Validé', dateDebut: '2026-10-12', dateFin: '2026-10-12', demiJournee: 'matin' }]).joursAbsences, 0, 'demi-journée isolée : aucun retrait');
// Une demande en attente ne retire rien
assert.strictEqual(calcul([{ ...periode[0], statut: 'En attente' }]).joursAbsences, 0);

// ---- Demande n° 23 : pointage ----
const types = DB.getLeaveTypes();
const congeTardif = { id: 'c3', employeeId: employee.id, typeId: type.id, statut: 'Validé', dateDebut: '2026-10-14', dateFin: '2026-10-14', demiJournee: null, dateCreation: '2026-11-03T09:00:00.000Z' };
// Commande d'octobre passée le 30/10 : 22 tickets
const employeeCommande = { ...employee, ticketsCommandesEnregistrees: { '2026-10': 22 } };
const settingsCommande = { ...settings, ticketsCommandesDates: { '2026-10': '2026-10-30' }, ticketsCommandesInstants: { '2026-10': '2026-10-30T10:00:00.000Z' } };
const p = sb.calculerPointageTickets(employeeCommande, 2026, 10, [congeTardif], [], settingsCommande, types);
assert.strictEqual(p.joursAbsence, 1, 'un jour d\'absence cumulé');
assert.strictEqual(p.distribues, 22, 'tickets distribués : la commande enregistrée');
assert.strictEqual(p.dus, 21, 'tickets dus : 22 jours ouvrés moins l\'absence');
assert.strictEqual(p.ecartCumul, -1, 'un ticket de trop');
assert.strictEqual(p.propositions.length, 1);
const prop = p.propositions[0];
assert.strictEqual(prop.cle, '2026-10');
assert.strictEqual(prop.restant, -1);
assert.strictEqual(prop.lignes.length, 1, 'le jour qui constitue l\'écart est listé');
assert.strictEqual(prop.lignes[0].date, '2026-10-14');
assert.strictEqual(prop.lignes[0].creeLe, '2026-11-03', 'avec sa date de dépôt');
assert.strictEqual(prop.moisCible, '2026-11', 'appliquée à la commande de novembre');
assert.ok(p.moisSansCommande.some(m => m.cle === '2026-01'), 'les mois commandés hors de Nexus sont signalés');

// Une absence déposée AVANT la commande est déjà décomptée : pas d'écart
const deposeAvant = { ...congeTardif, dateCreation: '2026-10-20T09:00:00.000Z' };
const employeeAvant = { ...employee, ticketsCommandesEnregistrees: { '2026-10': 21 } };
assert.strictEqual(sb.calculerPointageTickets(employeeAvant, 2026, 9, [deposeAvant], [], settingsCommande, types).propositions.length, 0, 'commande conforme : rien à proposer');

// Un écart refusé n'est plus reproposé ; l'écart supplémentaire, lui, le serait
const refuse = { ...employeeCommande, ticketsRegularisations: [{ source: '2026-10', ecartTraite: -1, delta: 0, decision: 'refusee', appliqueAuMois: null }] };
assert.strictEqual(sb.calculerPointageTickets(refuse, 2026, 10, [congeTardif], [], settingsCommande, types).propositions.length, 0, 'refusé : plus proposé');
const deuxieme = { ...congeTardif, id: 'c4', dateDebut: '2026-10-15', dateFin: '2026-10-15', dateCreation: '2026-11-04T09:00:00.000Z' };
const nouveau = sb.calculerPointageTickets(refuse, 2026, 10, [congeTardif, deuxieme], [], settingsCommande, types).propositions;
assert.strictEqual(nouveau.length, 1, 'une nouvelle absence tardive recrée une proposition');
assert.strictEqual(nouveau[0].restant, -1, 'pour la seule part non examinée');

// Les demi-journées sont comptées à part et ne font pas partie des jours d'absence
const demi = [{ id: 'c5', employeeId: employee.id, typeId: type.id, statut: 'Validé', dateDebut: '2026-10-19', dateFin: '2026-10-19', demiJournee: 'apres-midi', dateCreation: '2026-10-01T00:00:00.000Z' }];
const pDemi = sb.calculerPointageTickets(employee, 2026, 9, demi, [], settings, types);
assert.strictEqual(pDemi.joursAbsence, 0, 'une demi-journée n\'est pas un jour d\'absence');
assert.strictEqual(pDemi.demiJournees, 1, 'mais elle est comptée à part');

// La correction ne s'applique jamais seule : validée, elle s'ajoute au mois cible
assert.strictEqual(sb.calculateTicketsRestaurant(employeeCommande, 2026, 10, [congeTardif], [], settingsCommande).regularisationTotal, 0, 'aucune application d\'office');
const valide = { ...employeeCommande, ticketsRegularisations: [{ source: '2026-10', ecartTraite: -1, delta: -1, decision: 'validee', appliqueAuMois: '2026-11' }] };
const novembre = sb.calculateTicketsRestaurant(valide, 2026, 10, [congeTardif], [], settingsCommande);
assert.strictEqual(novembre.regularisationTotal, -1);
assert.strictEqual(novembre.nbTickets, novembre.theorique - 1, 'novembre porte la correction validée');
// Validation refusée par le serveur de données pour une décision absurde
DB._currentEmployeeId = rh.id;
assert.ok(!DB.traiterRegularisationTickets(salarie.id, '2026-10', { decision: 'validee', delta: 0, ecart: -1, moisCible: '2026-11', auteurId: rh.id }).success, 'correction nulle refusée');
assert.ok(!DB.traiterRegularisationTickets(salarie.id, '2026-10', { decision: 'validee', delta: -1, ecart: -1, moisCible: 'novembre', auteurId: rh.id }).success, 'mois cible invalide refusé');
assert.ok(!DB.traiterRegularisationTickets(salarie.id, '2026-10', { decision: 'inconnue', delta: -1, ecart: -1, moisCible: '2026-11' }).success, 'décision inconnue refusée');

// ---- Écran : colonne Pointage après « Part salarié » ----
api.state.ticketsYear = 2026; api.state.ticketsMonth = 9;
const equipe = sb.renderTicketsEquipe();
assert.ok(equipe.indexOf('Part salarié</th><th>Pointage</th>') > 0, 'colonne Pointage juste après Part salarié');
assert.ok(equipe.includes('data-label="Pointage"'), 'cellule de pointage par salarié');
assert.ok(!equipe.includes('sera repris le mois suivant'), 'l\'ancienne reprise automatique n\'est plus annoncée');

// ---- Demande n° 21 : export Excel du calendrier avec cumul annuel et demi-journées ----
const typeCp = DB.getLeaveTypes().find(t => /^Congés payés/.test(t.nom));
const typeRtt = DB.getLeaveTypes().find(t => /^RTT/.test(t.nom));
const societe = DB.getCurrentCompany();
const mk = (id, typeId, debut, fin, extra = {}) => ({ id, employeeId: salarie.id, typeId, statut: 'Validé', etapeIndex: 1, workflow: [], historique: [], dateDebut: debut, dateFin: fin, nbJours: 1, demiJournee: null, ...extra });
societe.leaveRequests = [
  mk('x1', typeCp.id, '2026-09-14', '2026-09-15'),                                                                           // septembre : 2 jours de CP
  mk('x2', typeCp.id, '2026-10-02', '2026-10-07', { demiJourneeDebut: 'apres-midi', demiJourneeFin: 'matin' }),            // octobre : 0,5 + 1 + 1 + 0,5 = 3 jours, 2 demi-journées
  mk('x3', typeRtt.id, '2026-10-12', '2026-10-12', { demiJournee: 'matin' })                                                // octobre : 0,5 jour de RTT, 1 demi-journée
];
societe.employees.forEach(e => { e.dateEmbauche = '2020-01-01'; e.joursTravailles = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven']; });
DB.saveCurrentCompany(societe);
api.state.calendarYear = 2026; api.state.calendarMonth = 9; api.state.calendarServiceFilter = '';
let fichier = null;
sb.downloadExcelXmlFile = (xml, nom) => { fichier = { xml, nom }; };
sb.exportAbsenceCalendarExcel();
assert.ok(fichier && fichier.nom === 'calendrier-absences-2026-10.xls', 'export généré pour octobre 2026');
const en = (texte) => fichier.xml.includes(texte);
assert.ok(en('Congés payés (octobre)') && en('Congés payés (cumul depuis le 1er janvier 2026)'), 'colonnes du mois et du cumul pour les congés payés');
assert.ok(en('RTT (octobre)') && en('RTT (cumul depuis le 1er janvier 2026)'), 'colonnes du mois et du cumul pour les RTT');
assert.ok(en('Demi-journées CP/RTT (octobre)') && en('Demi-journées CP/RTT (cumul depuis le 1er janvier 2026)'), 'colonnes à part pour les demi-journées');
// La ligne du salarié : CP octobre 3 (demi-journées comptées 0,5), cumul 5 ; RTT 0,5 / 0,5 ; demi-journées 3 / 3
const ligneSalarie = fichier.xml.split('<Row').find(r => r.includes(salarie.prenom) && r.includes(salarie.nom));
const nombres = [...ligneSalarie.matchAll(/<Data ss:Type="Number">([^<]+)<\/Data>/g)].map(m => Number(m[1]));
// Le type « Congés payés » compte en jours ouvrables (samedi inclus : 02, 03, 05, 06, 07 moins deux demi-journées = 4) ou en jours ouvrés (3), selon son réglage : l'export suit le réglage.
const cpOctobre = typeCp.uniteDecompte === 'ouvrables' ? 4 : 3;
assert.deepStrictEqual(nombres, [cpOctobre, cpOctobre + 2, 0.5, 0.5, 3, 3], `CP ${cpOctobre} / ${cpOctobre + 2}, RTT 0,5 / 0,5, demi-journées 3 / 3`);

console.log('OK — tickets-demi-journees-pointage-24-11.test.js');
