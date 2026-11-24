/**
 * 24/11/2026 : commande de titres-restaurant au format du modèle fourni par Swile (COMMANDE_SWILE_<code>.csv), tableau de commande propre, fenêtre « Commande Swile ».
 * Données de test fictives uniquement.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

const api = loadAppJs();
api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
api.DB.init();
const { DB } = api;
const sb = api.sandbox;

// ---- Encodage Windows-1252 : « À » = un seul octet 0xC0 (le fichier Swile n'est pas en UTF-8) ----
const octets = sb.encoderWindows1252('À é É ç œ € ™ ∑');
assert.strictEqual(octets[0], 0xC0, 'À = 0xC0');
assert.strictEqual(octets[2], 0xE9, 'é = 0xE9');
assert.strictEqual(octets[4], 0xC9, 'É = 0xC9');
assert.strictEqual(octets[6], 0xE7, 'ç = 0xE7');
assert.strictEqual(octets[8], 0x9C, 'œ = 0x9C');
assert.strictEqual(octets[10], 0x80, '€ = 0x80');
assert.strictEqual(octets[12], 0x99, '™ = 0x99');
assert.strictEqual(octets[14], 0x3F, 'un caractère absent de Windows-1252 devient « ? »');

// ---- Lignes de la commande ----
const rh = DB.getEmployees().find(e => e.role === 'rh');
DB._currentEmployeeId = rh.id;
const a = DB.getEmployees().find(e => e.role === 'salarie');
const b = DB.getEmployees().find(e => e.role === 'comptabilite');
const complet = { ...a, prenom: 'Élodie', nom: 'Dupont', nomUsage: '', email: 'Elodie.Dupont@Exemple.fr', dateNaissance: '1985-02-09', sexe: 'Femme', matricule: 'SRH-0042' };
const sansInfos = { ...b, prenom: 'Paul', nom: 'Martin', nomUsage: '', email: '', dateNaissance: '', sexe: '', civilite: 'ne_pas_accorder', matricule: 'SRH-0043' };
const marie = { ...a, id: 'x3', prenom: 'Marie', nom: 'Beletre', nomUsage: 'Dupuis', email: 'marie@exemple.fr', dateNaissance: '1977-06-29', sexe: '', civilite: 'Madame', matricule: 'SRH-0044' };
const lignesSource = [{ employee: complet, result: { nbTickets: 18 } }, { employee: sansInfos, result: { nbTickets: 21 } }, { employee: marie, result: { nbTickets: 0 } }];
const reglages = { ticketsSwileMatricule: 'nom' };
const lignes = sb.lignesCommandeSwile(lignesSource, reglages);
assert.strictEqual(lignes[0].civilite, 'MME', 'sexe Femme : MME');
assert.strictEqual(lignes[0].prenom, 'ÉLODIE', 'prénom en majuscules, accents conservés');
assert.strictEqual(lignes[0].email, 'elodie.dupont@exemple.fr', 'email en minuscules');
assert.strictEqual(lignes[0].naissance, '09/02/1985', 'date au format JJ/MM/AAAA');
assert.strictEqual(lignes[0].matricule, 'DUPONT', 'colonne MATRICULE = nom de famille, comme le fichier Swile');
assert.strictEqual(lignes[2].nom, 'DUPUIS', 'le nom d\'usage est celui de la carte');
assert.strictEqual(lignes[2].matricule, 'BELETRE', 'mais la colonne MATRICULE garde le nom légal');
assert.strictEqual(lignes[2].civilite, 'MME', 'civilité Madame : MME');
assert.strictEqual(JSON.stringify(lignes[1].problemes), JSON.stringify(['adresse email manquante', 'date de naissance manquante', 'civilité à renseigner dans la fiche']), 'les problèmes sont signalés avant le dépôt');
assert.strictEqual(sb.lignesCommandeSwile(lignesSource, { ticketsSwileMatricule: 'matricule' })[0].matricule, 'SRH-0042', 'option : matricule Nexus');

// ---- Fichier : strictement le format du modèle ----
const f = sb.construireFichierCommandeSwile(lignes);
const texte = Buffer.from(f.octets).toString('latin1');
const l = texte.split('\r\n');
assert.strictEqual(l[0], "Remplir le tableau ci dessous avec l'aide du site;;;;;;", 'première ligne : la consigne de Swile, telle quelle');
assert.strictEqual(l[1], 'MR ou MME;PRENOM;NOM;EMAIL;DATE NAISSANCE (JJ/MM/AAAA);NOMBRE JOURS \xC0 CHARGER;MATRICULE', 'en-têtes du modèle (À en un octet)');
assert.strictEqual(l[2], 'MME;\xC9LODIE;DUPONT;elodie.dupont@exemple.fr;09/02/1985;18;DUPONT');
assert.strictEqual(l[3], ';PAUL;MARTIN;;;21;MARTIN', 'une donnée manquante laisse la case vide, sans décaler les colonnes');
assert.strictEqual(l[4], 'MME;MARIE;DUPUIS;marie@exemple.fr;29/06/1977;0;BELETRE');
assert.strictEqual(l[5], '', 'le fichier se termine par une fin de ligne, comme le modèle');
assert.strictEqual(l.length, 6);
assert.strictEqual(f.octets[0], 0x52, 'pas de BOM en tête');
assert.ok(!Buffer.from(f.octets).includes(0xEF) || !Buffer.from(f.octets).slice(0, 3).equals(Buffer.from([0xEF, 0xBB, 0xBF])), 'pas de BOM UTF-8');
assert.strictEqual(f.nombreJours, 39, 'total des jours à charger');
assert.strictEqual(f.nombreSalaries, 2, 'bénéficiaires avec au moins un jour');
// Une valeur contenant un point-virgule ou un guillemet est protégée
const piege = sb.construireFichierCommandeSwile([{ civilite: 'MR', prenom: 'A;B', nom: 'C"D', email: 'a@b.fr', naissance: '01/01/1990', jours: 5, matricule: 'X' }]);
assert.ok(Buffer.from(piege.octets).toString('latin1').includes('MR;"A;B";"C""D";a@b.fr;01/01/1990;5;X'), 'point-virgule et guillemet échappés');

// ---- Nom du fichier ----
assert.strictEqual(sb.nomFichierCommandeSwile({ ticketsSwileCodeClient: 'czpuaq' }, 2026, 10), 'COMMANDE_SWILE_CZPUAQ.csv', 'code client : nom identique au modèle');
assert.strictEqual(sb.nomFichierCommandeSwile({ ticketsSwileCodeClient: '' }, 2026, 10), 'COMMANDE_SWILE_2026-11.csv', 'sans code : le mois');
assert.strictEqual(sb.nomFichierCommandeSwile({ ticketsSwileCodeClient: '../x y' }, 2026, 10), 'COMMANDE_SWILE_XY.csv', 'caractères dangereux retirés');

// ---- Tableau de commande propre (Excel) ----
let tableau = null;
sb.exportRowsToCSV = (entetes, donnees, nom) => { tableau = { entetes, donnees, nom }; };
api.state.ticketsYear = 2026; api.state.ticketsMonth = 9;
sb.genererFichierCommandeTickets();
assert.deepStrictEqual(JSON.parse(JSON.stringify(tableau.entetes)), ['Civilité', 'Prénom', 'Nom', 'Email', 'Date de naissance', 'Nombre de jours à charger', 'Matricule', 'Service']);
const derniere = tableau.donnees[tableau.donnees.length - 1];
assert.strictEqual(derniere[0], 'TOTAL', 'ligne de total');
assert.strictEqual(derniere[5], tableau.donnees.slice(0, -1).reduce((s, r) => s + r[5], 0), 'le total est la somme des lignes');
assert.strictEqual(tableau.nom, 'commande-tickets-restaurant-2026-10.csv');

// ---- Écran ----
const equipe = sb.renderTicketsEquipe();
assert.ok(equipe.includes('id="btn-envoyer-commande-tickets">Commande Swile<'), 'bouton « Commande Swile »');
assert.ok(equipe.includes('id="btn-fichier-commande-tickets">Tableau de commande<'), 'bouton « Tableau de commande »');
const reglagesHtml = sb.renderParametresTicketsRestaurant();
assert.ok(reglagesHtml.includes('f-swile-code-client') && reglagesHtml.includes('f-swile-matricule'), 'réglages du code client et de la colonne MATRICULE');

console.log('OK — commande-swile-24-11.test.js');
