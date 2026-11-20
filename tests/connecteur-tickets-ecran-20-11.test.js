/**
 * Retour du 20/11/2026 : écran du connecteur de prestataire de titres-restaurant (Paramètres > Tickets restaurant) et bouton « Envoyer la commande ».
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAppJs } = require('./load-app-js');

const api = loadAppJs();
api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
api.DB.init();
const sb = api.sandbox;

// Résumé de synchronisation lisible
assert.strictEqual(sb.libelleResumeSynchro({ crees: 2, misAJour: 1, inscrits: 2, retires: 0, dejaAJour: 3 }), '2 créés · 1 mis à jour · 2 inscrits aux titres-restaurant · 3 déjà à jour');
assert.strictEqual(sb.libelleResumeSynchro({ crees: 1 }), '1 créé');
assert.strictEqual(sb.libelleResumeSynchro({}), 'Rien à changer');

// Table absente (migration pas encore exécutée) : message clair, aucun formulaire
api.connecteurSwileEtat.indisponible = true;
assert.ok(sb.renderCarteConnecteurSwile().includes('pas encore activée'), 'serveur pas prêt : explication, pas de formulaire');
assert.ok(!sb.renderCarteConnecteurSwile().includes('f-swile-secret'));

// Formulaire : le secret n'est jamais pré-rempli, seulement signalé
api.connecteurSwileEtat.indisponible = false;
api.connecteurSwileEtat.secretPresent = true;
api.connecteurSwileEtat.config = { actif: true, clientId: 'cid_1', produitId: 'p1', synchroAuto: true, commandeEmail: 'commandes@exemple.fr', commandeCopieEmail: '', dernierSyncAt: '2026-11-20T08:00:00Z', dernierSyncResume: { date: '2026-11-20T08:00:00Z', crees: 1, misAJour: 0, inscrits: 1, retires: 0, dejaAJour: 4, nombreErreurs: 1, erreurs: [{ message: 'Pas d\'adresse email <b>' }] } };
const carte = sb.renderCarteConnecteurSwile();
assert.ok(/id="f-swile-secret"[^>]*type="password"|type="password"[^>]*id="f-swile-secret"/.test(carte), 'champ de clé en mot de passe');
assert.ok(!/id="f-swile-secret"[^>]*value=/.test(carte), 'la clé secrète n\'est jamais écrite dans la page');
assert.ok(carte.includes('enregistrée (laisser vide pour la garder)'));
assert.ok(carte.includes('value="cid_1"') && carte.includes('commandes@exemple.fr'));
assert.ok(carte.includes('Dernière synchronisation') && carte.includes('1 erreur'));
assert.ok(carte.includes('&lt;b&gt;') && !carte.includes('<b>\''), 'les messages d\'erreur du prestataire sont échappés');
assert.ok(!/id="btn-swile-synchroniser"[^>]*disabled/.test(carte), 'synchronisation possible : connecteur actif et clé enregistrée');
api.connecteurSwileEtat.secretPresent = false;
assert.ok(/id="btn-swile-synchroniser"[^>]*disabled/.test(sb.renderCarteConnecteurSwile()), 'pas de clé : synchronisation désactivée');

// Écran Tickets restaurant : bouton d'envoi présent, à côté du fichier de commande
const rh = api.DB.getEmployees().find(e => e.role === 'rh');
api.DB._currentEmployeeId = rh.id;
const equipe = sb.renderTicketsEquipe();
assert.ok(equipe.includes('id="btn-envoyer-commande-tickets"') && equipe.includes('id="btn-fichier-commande-tickets"'), 'envoi de la commande et fichier téléchargeable');
assert.ok(equipe.includes('id="tickets-commandes-envoyees"'), 'zone du rappel de commande envoyée');

// La couche de synchronisation expose les fonctions utilisées par l'écran
const client = fs.readFileSync(path.join(__dirname, '..', 'supabase-client.js'), 'utf8');
['connecteurTicketsLire', 'connecteurTicketsEnregistrer', 'connecteurTicketsAppeler', 'commandesTicketsLire'].forEach(nom => assert.ok(new RegExp(nom + '[,\\n]').test(client.slice(client.indexOf('window.SupabaseSync = {'))), nom + ' exposée'));
assert.ok(!/from\('connecteurs_tickets_secrets'\)/.test(client), 'le navigateur ne lit jamais la table des secrets');

console.log('OK — connecteur-tickets-ecran-20-11.test.js');
