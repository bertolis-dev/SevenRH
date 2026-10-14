/**
 * Seven RH — pont vers Nexus Gestion, côté EXPORT (brief du 14/10/2026). Le format (version 1) est un contrat partagé
 * avec Nexus Gestion : ce fichier le vérifie champ par champ, type par type, arrondi par arrondi.
 *
 * Décisions retenues (recommandations validées) :
 *  - mois d'une note = mois de validation/remboursement (comme la Préparation de paie) ;
 *  - justificatif_url = CHEMIN de stockage (jamais une adresse signée de 60 s, jamais un data: URL), null si absent ;
 *  - date_remboursement = date de PAIEMENT réel, null tant que la note n'est pas payée ;
 *  - tickets : nombre COMMANDÉ quand il existe, sinon recalculé ; date_commande enregistrée à la génération du fichier ;
 *  - salarie = « Prénom NOM » ; montants = nombres JSON arrondis à 2 décimales ; paie = null (phase 2 non livrée).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

const CLES_RACINE = ['format', 'version', 'siren', 'periode', 'genere_le', 'notes_de_frais', 'tickets_restaurant', 'paie'];
const CLES_NOTE = ['id', 'date', 'salarie', 'categorie', 'libelle', 'montant_ht', 'tva', 'montant_ttc', 'taux_tva', 'justificatif_url', 'date_remboursement'];
const CLES_PAIE = ['brut', 'charges_salariales', 'charges_patronales', 'net_a_payer', 'date_paiement', 'detail_par_organisme'];
const CLES_TICKETS = ['nombre', 'montant_total', 'part_employeur', 'date_commande'];

const deuxDecimales = (n) => typeof n === 'number' && Number.isFinite(n) && Math.round(n * 100) / 100 === n;
const dateISO = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());

/** Validateur STRICT du contrat v1 : aucune clé en plus ni en moins, types exacts. Réutilisé pour le fichier d'exemple. */
function validerFormatV1(x) {
  assert.deepStrictEqual(Object.keys(x), CLES_RACINE, 'clés de premier niveau, dans cet ordre');
  assert.strictEqual(x.format, 'nexus-rh-export');
  assert.strictEqual(x.version, 1);
  assert.ok(/^\d{9}$/.test(x.siren), 'siren : 9 chiffres');
  assert.ok(/^\d{4}-(0[1-9]|1[0-2])$/.test(x.periode), 'periode AAAA-MM');
  assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(x.genere_le), 'genere_le AAAA-MM-JJTHH:MM:SSZ');
  assert.ok(Array.isArray(x.notes_de_frais));
  x.notes_de_frais.forEach((n, i) => {
    assert.deepStrictEqual(Object.keys(n), CLES_NOTE, `note ${i} : clés`);
    ['id', 'salarie', 'categorie', 'libelle'].forEach(k => assert.ok(typeof n[k] === 'string' && n[k].length > 0, `note ${i} : ${k} texte non vide`));
    assert.ok(dateISO(n.date), `note ${i} : date AAAA-MM-JJ`);
    ['montant_ht', 'tva', 'montant_ttc', 'taux_tva'].forEach(k => assert.ok(deuxDecimales(n[k]), `note ${i} : ${k} nombre à 2 décimales`));
    assert.strictEqual(Math.round((n.montant_ht + n.tva) * 100) / 100, n.montant_ttc, `note ${i} : HT + TVA = TTC au centime`);
    assert.ok(n.justificatif_url === null || (typeof n.justificatif_url === 'string' && !n.justificatif_url.startsWith('data:')), `note ${i} : justificatif_url chemin ou null`);
    assert.ok(n.date_remboursement === null || dateISO(n.date_remboursement), `note ${i} : date_remboursement date ou null`);
  });
  if (x.tickets_restaurant !== null) {
    assert.deepStrictEqual(Object.keys(x.tickets_restaurant), CLES_TICKETS, 'tickets : clés');
    assert.ok(Number.isInteger(x.tickets_restaurant.nombre) && x.tickets_restaurant.nombre >= 0, 'tickets.nombre entier');
    assert.ok(deuxDecimales(x.tickets_restaurant.montant_total) && deuxDecimales(x.tickets_restaurant.part_employeur), 'tickets : montants à 2 décimales');
    assert.ok(x.tickets_restaurant.date_commande === null || dateISO(x.tickets_restaurant.date_commande), 'tickets.date_commande');
  }
  // paie : null (aucun journal de paie enregistré pour le mois) ou l'objet exact du contrat (phase 2, 14/10/2026)
  if (x.paie !== null) {
    assert.deepStrictEqual(Object.keys(x.paie), CLES_PAIE, 'paie : clés');
    ['brut', 'charges_salariales', 'charges_patronales', 'net_a_payer'].forEach(k => assert.ok(deuxDecimales(x.paie[k]) && x.paie[k] >= 0, `paie.${k} nombre à 2 décimales, positif ou nul`));
    assert.ok(dateISO(x.paie.date_paiement), 'paie.date_paiement AAAA-MM-JJ');
    assert.ok(Array.isArray(x.paie.detail_par_organisme));
    x.paie.detail_par_organisme.forEach((o, i) => {
      assert.deepStrictEqual(Object.keys(o), ['organisme', 'montant'], `organisme ${i} : clés`);
      assert.ok(typeof o.organisme === 'string' && o.organisme.length > 0 && deuxDecimales(o.montant) && o.montant >= 0, `organisme ${i} : nom et montant`);
    });
  }
}

function setup() {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  const rh = api.DB.getEmployees().find(e => e.role === 'rh');
  api.DB._currentEmployeeId = rh.id;
  return api;
}

const MAINTENANT = new Date('2026-10-14T09:30:15.123Z');

function entrees(api, { expenses, profile, settings }) {
  const lignes = api.sandbox.getPaieRows(2026, 9);
  return {
    annee: 2026, mois: 9, maintenant: MAINTENANT,
    profile: profile || { siret: '443 061 841 00025' },
    lignesPaie: lignes,
    expenses,
    employees: api.DB.getEmployees(),
    settings: settings || api.settingsRepository.getSettings(),
    modules: { frais: true, tickets: true }
  };
}

function note(api, extra) {
  const salarie = api.DB.getEmployees().find(e => e.role === 'salarie');
  return { id: 'nf_aaa_111111', employeeId: salarie.id, categorie: 'Repas', libelle: 'Déjeuner client Lyon', date: '2026-10-02', montantTTC: 42, tauxTVA: 10, statut: 'Remboursé', datePaiement: null, justificatif: null, historique: [{ date: '2026-10-05T10:00:00.000Z', action: 'Remboursé' }], ...extra };
}

function runLeSirenEstControleAvantTout() {
  const { validerSirenPourExport } = setup().sandbox;
  ['', null, undefined, '   ', '123', '12345678'].forEach(v => {
    const r = validerSirenPourExport(v);
    assert.strictEqual(r.ok, false, `« ${v} » : SIRET non renseigné ou incomplet`);
    assert.ok(/SIRET|SIREN/.test(r.error) && /Paramètres/.test(r.error), 'message clair, avec où le renseigner');
  });
  assert.strictEqual(validerSirenPourExport('000 000 000 00000').ok, false, 'SIRET factice de démonstration refusé');
  assert.strictEqual(validerSirenPourExport('443 061 842 00025').ok, false, 'SIREN dont la clé de contrôle est fausse refusé');
  const bon = validerSirenPourExport('443 061 841 00025');
  assert.strictEqual(bon.ok, true);
  assert.strictEqual(bon.siren, '443061841', 'SIREN = 9 premiers chiffres du SIRET');
  assert.strictEqual(validerSirenPourExport('443061841').siren, '443061841', 'un SIREN seul (9 chiffres) est accepté');
  console.log('OK — export-nexus-gestion-14-10.test.js (P4 : SIREN absent, incomplet, factice ou invalide bloqué avec un message clair)');
}

function runLExportRespecteExactementLeFormat() {
  const api = setup();
  const e = entrees(api, { expenses: [note(api, {})] });
  const r = api.sandbox.construireExportNexusGestion(e);
  assert.strictEqual(r.ok, true, r.error);
  validerFormatV1(r.export);
  assert.strictEqual(r.export.siren, '443061841');
  assert.strictEqual(r.export.periode, '2026-10');
  assert.strictEqual(r.export.genere_le, '2026-10-14T09:30:15Z', 'horodatage UTC sans millisecondes');
  const json = JSON.stringify(r.export);
  assert.deepStrictEqual(Object.keys(JSON.parse(json)), CLES_RACINE, 'l\'ordre des clés survit à la sérialisation');
  console.log('OK — export-nexus-gestion-14-10.test.js (P5 : clés, ordre, types et formats du contrat v1 respectés)');
}

function runLesNotesSontFiltreesEtArrondies() {
  const api = setup();
  const notes = [
    note(api, { id: 'nf_ok_1', montantTTC: 12.345, tauxTVA: 20 }),
    note(api, { id: 'nf_ok_2', libelle: 'Péage A6', date: '2026-09-28', datePaiement: '2026-10-08T08:00:00.000Z', montantTTC: 20, tauxTVA: 5.5, justificatif: { nom: 'p.jpg', path: 'ent/emp/nf_ok_2/p.jpg' } }),
    note(api, { id: 'nf_attente', statut: 'En attente' }),
    note(api, { id: 'nf_refusee', statut: 'Refusé' }),
    note(api, { id: 'nf_annulee', statut: 'Annulé' }),
    note(api, { id: 'nf_autre_mois', historique: [{ date: '2026-11-05T10:00:00.000Z', action: 'Remboursé' }] }),
    note(api, { id: 'nf_dataurl', justificatif: { nom: 'x.png', dataUrl: 'data:image/png;base64,AAAA' } })
  ];
  const r = api.sandbox.construireExportNexusGestion(entrees(api, { expenses: notes }));
  assert.strictEqual(r.ok, true, r.error);
  validerFormatV1(r.export);
  const ids = r.export.notes_de_frais.map(n => n.id);
  assert.deepStrictEqual(ids.slice().sort(), ['nf_dataurl', 'nf_ok_1', 'nf_ok_2'], 'seules les notes validées ou remboursées du mois, jamais en attente / refusées / annulées / d\'un autre mois');
  const n1 = r.export.notes_de_frais.find(n => n.id === 'nf_ok_1');
  assert.strictEqual(n1.montant_ttc, 12.35, 'TTC arrondi au centime');
  assert.strictEqual(n1.taux_tva, 20);
  assert.strictEqual(n1.date_remboursement, null, 'non payée : pas de date de remboursement');
  const n2 = r.export.notes_de_frais.find(n => n.id === 'nf_ok_2');
  assert.strictEqual(n2.date_remboursement, '2026-10-08', 'date de PAIEMENT réel, au format AAAA-MM-JJ');
  assert.strictEqual(n2.justificatif_url, 'ent/emp/nf_ok_2/p.jpg', 'chemin de stockage');
  assert.strictEqual(r.export.notes_de_frais.find(n => n.id === 'nf_dataurl').justificatif_url, null, 'jamais un data: URL (justificatif pas encore envoyé au stockage)');
  assert.ok(/^[A-Za-zÀ-ÿ'’ -]+ [A-ZÀ-Ý'’ -]+$/.test(n1.salarie) || n1.salarie.length > 3, 'salarie : « Prénom NOM »');
  console.log('OK — export-nexus-gestion-14-10.test.js (P2 : statuts, mois de paiement, arrondis, paiement réel, chemin du justificatif)');
}

function runLIdentifiantEstStableD() {
  const api = setup();
  const notes = [note(api, { id: 'nf_stable_1' }), note(api, { id: 'nf_stable_2', libelle: 'Taxi gare', date: '2026-10-03' })];
  const e = entrees(api, { expenses: notes });
  const a = api.sandbox.construireExportNexusGestion(e).export;
  const b = api.sandbox.construireExportNexusGestion({ ...e, maintenant: new Date('2026-10-20T12:00:00Z'), expenses: notes.slice().reverse() }).export;
  assert.deepStrictEqual(a.notes_de_frais.map(n => n.id), b.notes_de_frais.map(n => n.id), 'mêmes id, dans le même ordre, quel que soit l\'ordre en base et la date d\'export');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(a.notes_de_frais)), JSON.parse(JSON.stringify(b.notes_de_frais)), 'contenu des notes identique d\'un export à l\'autre');
  assert.deepStrictEqual(a.notes_de_frais.map(n => n.id), ['nf_stable_1', 'nf_stable_2'], 'l\'id exporté est celui de la note, jamais recalculé');
  console.log('OK — export-nexus-gestion-14-10.test.js (P2 : identifiants stables, ordre déterministe)');
}

function runLesTicketsUtilisentLaCommandeEnregistree() {
  const api = setup();
  const reglages = { ...api.settingsRepository.getSettings(), ticketsValeurFaciale: 9, ticketsPartEmployeurPct: 60 };
  const e = entrees(api, { expenses: [], settings: reglages });
  const sansCommande = api.sandbox.construireExportNexusGestion(e);
  assert.strictEqual(sansCommande.ok, true, sansCommande.error);
  validerFormatV1(sansCommande.export);
  const attendu = e.lignesPaie.reduce((s, l) => s + l.tickets.nbTickets, 0);
  assert.strictEqual(sansCommande.export.tickets_restaurant.nombre, attendu, 'sans commande enregistrée : nombre recalculé');
  assert.strictEqual(sansCommande.export.tickets_restaurant.montant_total, Math.round(attendu * 9 * 100) / 100);
  assert.strictEqual(sansCommande.export.tickets_restaurant.part_employeur, Math.round(attendu * 9 * 0.6 * 100) / 100, 'part employeur en euros');
  assert.strictEqual(sansCommande.export.tickets_restaurant.date_commande, null, 'aucune date de commande connue');

  const lignes = e.lignesPaie.map((l, i) => i === 0 ? { ...l, employee: { ...l.employee, ticketsCommandesEnregistrees: { '2026-10': 5 } } } : l);
  const avec = api.sandbox.construireExportNexusGestion({ ...e, lignesPaie: lignes, settings: { ...reglages, ticketsCommandesDates: { '2026-10': '2026-09-28' } } });
  const reste = e.lignesPaie.slice(1).reduce((s, l) => s + l.tickets.nbTickets, 0);
  assert.strictEqual(avec.export.tickets_restaurant.nombre, 5 + reste, 'le nombre COMMANDÉ prime sur le recalcul');
  assert.strictEqual(avec.export.tickets_restaurant.date_commande, '2026-09-28');
  console.log('OK — export-nexus-gestion-14-10.test.js (P3 : récapitulatif des tickets, commande enregistrée prioritaire, euros à 2 décimales)');
}

function runLesModulesAbsentsDonnentDesBlocsVides() {
  const api = setup();
  const e = entrees(api, { expenses: [note(api, {})] });
  const r = api.sandbox.construireExportNexusGestion({ ...e, modules: { frais: false, tickets: false } });
  assert.strictEqual(r.ok, true);
  validerFormatV1(r.export);
  assert.deepStrictEqual(Array.from(r.export.notes_de_frais), [], 'module Notes de frais non souscrit : liste vide');
  assert.strictEqual(r.export.tickets_restaurant, null, 'module Tickets non souscrit : null');
  assert.strictEqual(r.export.paie, null);
  console.log('OK — export-nexus-gestion-14-10.test.js (modules non souscrits : blocs vides, jamais de fausse donnée)');
}

function runUnSirenInvalideBloqueLExport() {
  const api = setup();
  const r = api.sandbox.construireExportNexusGestion(entrees(api, { expenses: [], profile: { siret: '' } }));
  assert.strictEqual(r.ok, false);
  assert.ok(/SIRET|SIREN/.test(r.error));
  assert.strictEqual(r.export, undefined, 'aucun fichier produit');
  console.log('OK — export-nexus-gestion-14-10.test.js (P4 : aucun fichier produit sans SIREN valide)');
}

module.exports = { validerFormatV1 };

if (require.main === module) {
  try {
    runLeSirenEstControleAvantTout();
    runLExportRespecteExactementLeFormat();
    runLesNotesSontFiltreesEtArrondies();
    runLIdentifiantEstStableD();
    runLesTicketsUtilisentLaCommandeEnregistree();
    runLesModulesAbsentsDonnentDesBlocsVides();
    runUnSirenInvalideBloqueLExport();
  } catch (err) {
    console.error('ÉCHEC — export-nexus-gestion-14-10.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  }
}
