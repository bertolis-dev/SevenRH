/**
 * 26/11/2026 — audit externe, section 3 (incohérences) : IDCC 716, une seule définition de l'effectif et de la masse salariale,
 * préparation de paie sans accès aux salaires (plus de fausses anomalies), commande Swile en double validation sans la comptabilité.
 * Données de test fictives uniquement.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

const api = loadAppJs();
api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
api.DB.init();
const { DB } = api;
const sb = api.sandbox;

// ---- IDCC 716 au catalogue ----
{
  const c = sb.__IDCC_CONVENTIONS.find(x => x.code === '716');
  assert.ok(c, 'IDCC 716 présent');
  assert.ok(/employés et ouvriers/i.test(c.nom));
  assert.ok(sb.__IDCC_CONVENTIONS.find(x => x.code === '892'), 'IDCC 892 toujours présent');
  assert.strictEqual(sb.__IDCC_CONVENTIONS.filter(x => x.code === '716').length, 1, 'pas de doublon');
  assert.ok(sb.getConventionCollectiveCongesAncienneteBonus, 'moteur de convention présent');
}

// ---- Une seule définition de l'effectif ----
{
  const aujourdhui = new Date();
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const hier = new Date(aujourdhui.getFullYear(), aujourdhui.getMonth(), aujourdhui.getDate() - 1);
  const demain = new Date(aujourdhui.getFullYear(), aujourdhui.getMonth(), aujourdhui.getDate() + 1);
  const en = (extra) => Object.assign({ statut: 'Actif', archive: false, dateEmbauche: '2020-01-01', dateDepart: '', salaireBrutMensuel: 2000 }, extra);
  const liste = [
    en({ id: 'a' }),
    en({ id: 'b', archive: true }),                                // archivé : parti
    en({ id: 'c', statut: 'Inactif' }),                            // statut non actif
    en({ id: 'd', dateEmbauche: iso(demain) }),                    // pré-créé, pas encore arrivé
    en({ id: 'e', dateDepart: iso(hier) }),                        // déjà parti
    en({ id: 'f', dateDepart: iso(demain) }),                      // part demain : encore en poste aujourd'hui
    en({ id: 'g', dateEmbauche: '' }),                             // sans date d'embauche : compté aujourd'hui
  ];
  const ids = sb.getEffectifEnPoste(liste, aujourdhui).map(e => e.id).sort().join(',');
  assert.strictEqual(ids, 'a,f,g');
  assert.strictEqual(sb.getMasseSalarialeEnPoste(liste, aujourdhui), 6000, 'masse salariale = somme des salariés en poste, même liste');
  assert.strictEqual(sb.getEffectifActifAt(liste, aujourdhui), 3, 'les seuils d\'effectif utilisent la même définition');
  // Passé : reconstitué depuis les dates, un archivé parti après la date compte
  const passe = new Date(2021, 5, 1);
  const enPasse = sb.getEffectifEnPoste([en({ id: 'p', archive: true, dateDepart: '2022-01-01' }), en({ id: 'q', dateEmbauche: '2021-09-01' }), en({ id: 'r', dateEmbauche: '' })], passe).map(e => e.id).join(',');
  assert.strictEqual(enPasse, 'p', 'dans le passé : embauché avant, pas encore parti ; sans date d\'embauche : absent');
}

// ---- Préparation de paie : pas de fausse anomalie sans accès aux salaires ----
{
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  const proprietaire = DB.getEmployees().find(e => e.role === 'proprietaire');
  const cible = DB.getEmployees().find(e => e.role === 'salarie');
  DB.updateEmployee(cible.id, { salaireBrutMensuel: 0, numeroSecu: '', dateDepart: '' });
  const maintenant = new Date();
  const messages = () => sb.getPaieAnomalies(maintenant.getFullYear(), maintenant.getMonth())
    .filter(a => a.employee.id === cible.id && a.type === 'donnees_incompletes').map(a => a.message).join(' | ');
  DB._currentEmployeeId = rh.id;
  assert.ok(!sb.hasPermission(rh, 'voirInfosFinancieres'), 'le RH n\'a pas le droit financier par défaut');
  assert.ok(!/salaire/.test(messages()), 'RH sans droit financier : pas d\'anomalie « salaire manquant »');
  DB._currentEmployeeId = proprietaire.id;
  assert.ok(/salaire/.test(messages()), 'propriétaire : le salaire manquant est bien signalé');
}

// ---- Droits : la comptabilité n'envoie plus la commande ; double validation ----
{
  const P = sb.__PERMISSIONS;
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  const compta = DB.getEmployees().find(e => e.role === 'comptabilite');
  const proprio = DB.getEmployees().find(e => e.role === 'proprietaire');
  assert.strictEqual(sb.hasPermission(compta, P.ENVOYER_COMMANDE_TICKETS), false, 'comptabilité : pas d\'envoi de commande');
  assert.strictEqual(sb.hasPermission(compta, P.CALCULER_TICKETS_RESTAURANT), true, 'comptabilité : consulte toujours les tickets');
  assert.strictEqual(sb.hasPermission(compta, P.VOIR_PAIE_AGREGEE), true, 'comptabilité : droit « paie agrégée »');
  assert.strictEqual(sb.hasPermission(rh, P.ENVOYER_COMMANDE_TICKETS), true);
  assert.strictEqual(sb.hasPermission(proprio, P.ENVOYER_COMMANDE_TICKETS), true);

  const reglages = { ticketsCommandeDoubleValidation: true, ticketsCommandesAValider: {} };
  const sig = 'sig-1';
  // Deux personnes habilitées : double validation exigée
  let etat = sb.etatValidationCommandeTickets(reglages, '2026-11', sig, rh);
  assert.strictEqual(etat.exigee, true);
  assert.strictEqual(etat.soumettre, true);
  assert.strictEqual(etat.envoiPossible, false, 'rien ne part avant soumission et validation');
  // Soumise par le RH : lui ne peut pas la valider, le propriétaire oui
  const soumise = { '2026-11': { signature: sig, preparePar: rh.id } };
  etat = sb.etatValidationCommandeTickets({ ticketsCommandeDoubleValidation: true, ticketsCommandesAValider: soumise }, '2026-11', sig, rh);
  assert.strictEqual(etat.valider, false, 'on ne valide pas sa propre soumission');
  assert.strictEqual(etat.envoiPossible, false);
  etat = sb.etatValidationCommandeTickets({ ticketsCommandeDoubleValidation: true, ticketsCommandesAValider: soumise }, '2026-11', sig, proprio);
  assert.strictEqual(etat.valider, true, 'une autre personne habilitée peut la valider');
  // Validée : envoi possible ; commande modifiée (autre signature) : retour à zéro
  const validee = { '2026-11': { signature: sig, preparePar: rh.id, validePar: proprio.id } };
  assert.strictEqual(sb.etatValidationCommandeTickets({ ticketsCommandeDoubleValidation: true, ticketsCommandesAValider: validee }, '2026-11', sig, rh).envoiPossible, true);
  assert.strictEqual(sb.etatValidationCommandeTickets({ ticketsCommandeDoubleValidation: true, ticketsCommandesAValider: validee }, '2026-11', 'sig-2', rh).envoiPossible, false, 'commande modifiée : nouvelle validation');
  // Réglage désactivé
  assert.strictEqual(sb.etatValidationCommandeTickets({ ticketsCommandeDoubleValidation: false, ticketsCommandesAValider: {} }, '2026-11', sig, rh).envoiPossible, true);
  // Une seule personne habilitée : la double validation ne peut pas s'appliquer (elle est signalée à l'écran)
  DB.updateEmployee(proprio.id, { archive: true });
  etat = sb.etatValidationCommandeTickets(reglages, '2026-11', sig, rh);
  assert.strictEqual(etat.exigee, false);
  assert.strictEqual(etat.envoiPossible, true);
  assert.ok(etat.habilites < 2);
}

console.log('OK — audit-incoherences-26-11.test.js');
