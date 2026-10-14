/**
 * Seven RH — pont Nexus Gestion, phase 2 (14/10/2026) : onglet « Journal de paie » de la Préparation de paie.
 * Réservé au droit « voir les infos financières » (le RH ne l'a pas par défaut), enregistrement contrôlé, export Nexus
 * Gestion rempli avec le journal du mois, jamais de montants dans le journal d'audit.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');
const { validerFormatV1 } = require('./export-nexus-gestion-14-10.test.js');

function setup(role) {
  const api = loadAppJs();
  const base = { success: true };
  const stockage = new Map();
  const appels = [];
  api.sandbox.window.SupabaseSync = new Proxy({}, {
    get: (_, nom) => {
      if (nom === 'getJournalPaie') return async (c, p) => { appels.push(['get', p]); return stockage.has(p) ? stockage.get(p) : null; };
      if (nom === 'saveJournalPaie') return async (c, p, j) => { appels.push(['save', p]); stockage.set(p, JSON.parse(JSON.stringify(j))); };
      if (nom === 'deleteJournalPaie') return async (c, p) => { appels.push(['delete', p]); stockage.delete(p); };
      return async () => base;
    }
  });
  api.DB.init();
  api.DB._currentEmployeeId = api.DB.getEmployees().find(e => e.role === role).id;
  const company = api.DB.getCurrentCompany();
  company.siret = '443 061 841 00025';
  api.DB.saveCurrentCompany(company);
  api.state.paieYear = 2026;
  api.state.paieMonth = 9;
  api.state.view = 'export-paie';
  api.sandbox.render = () => {};
  return { api, stockage, appels };
}

const saisie = { brut: '6 500,00', charges_salariales: '1400,5', charges_patronales: '2820,25', net_a_payer: '5099,5', date_paiement: '2026-10-31', detail_par_organisme: [{ organisme: 'URSSAF', montant: '2000' }] };

async function runLOngletEstReserveAuxDroitsFinanciers() {
  const rh = setup('rh');
  assert.ok(!rh.api.sandbox.renderExportPaie().includes('data-paie-tab="journal"'), 'le RH sans droit financier ne voit pas l\'onglet');
  rh.api.state.paieTab = 'journal';
  const html = rh.api.sandbox.renderExportPaie();
  assert.ok(/confidentiels/.test(html) && !html.includes('id="f-jp-brut"'), 'même en forçant l\'onglet : aucun formulaire');
  await rh.api.sandbox.enregistrerJournalPaie();
  assert.strictEqual(rh.appels.length, 0, 'aucune écriture sans le droit');

  const patron = setup('proprietaire');
  assert.ok(patron.api.sandbox.renderExportPaie().includes('data-paie-tab="journal"'), 'le propriétaire voit l\'onglet');
  console.log('OK — journal-paie-onglet-14-10.test.js (onglet et écriture réservés au droit financier)');
}

async function runLeJournalSeChargeSEnregistreEtSeSupprime() {
  const { api, stockage, appels } = setup('proprietaire');
  api.state.paieTab = 'journal';
  assert.ok(/Chargement/.test(api.sandbox.renderExportPaie()), 'chargement affiché avant la lecture');
  await api.sandbox.chargerJournalPaie();
  assert.deepStrictEqual(appels, [['get', '2026-10']]);
  const vide = api.sandbox.renderExportPaie();
  assert.ok(vide.includes('id="f-jp-brut"') && vide.includes('id="btn-jp-save"') && vide.includes('id="btn-jp-import"'), 'formulaire et import présents');
  assert.ok(!vide.includes('btn-jp-delete'), 'rien à supprimer tant que rien n\'est enregistré');
  assert.ok(/value="2026-10-31"/.test(vide), 'date de paiement proposée : dernier jour du mois');

  Object.assign(api.state.journalPaie.brouillon, { ...saisie, brut: '' });
  const toasts = [];
  api.sandbox.showToast = (t, type) => toasts.push({ t, type });
  await api.sandbox.enregistrerJournalPaie();
  assert.ok(toasts.some(x => x.type === 'error' && /brut/i.test(x.t)), 'saisie incomplète refusée avec un message clair');
  assert.strictEqual(stockage.size, 0);

  Object.assign(api.state.journalPaie.brouillon, saisie);
  const avant = api.DB.getAuditLog().length;
  await api.sandbox.enregistrerJournalPaie();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(stockage.get('2026-10'))), {
    brut: 6500, charges_salariales: 1400.5, charges_patronales: 2820.25, net_a_payer: 5099.5, date_paiement: '2026-10-31',
    detail_par_organisme: [{ organisme: 'URSSAF', montant: 2000 }]
  });
  const audit = api.DB.getAuditLog();
  assert.strictEqual(audit.length, avant + 1);
  assert.ok(!/6500|6 500|1400|2820|5099/.test(JSON.stringify(audit[0])), 'aucun montant dans le journal d\'audit');
  const rempli = api.sandbox.renderExportPaie();
  assert.ok(rempli.includes('btn-jp-delete'), 'suppression proposée une fois enregistré');

  // un autre mois repart d'un formulaire vierge
  api.state.paieMonth = 10;
  await api.sandbox.chargerJournalPaie();
  assert.strictEqual(api.state.journalPaie.enregistre, null);
  api.state.paieMonth = 9;
  await api.sandbox.chargerJournalPaie();
  assert.strictEqual(api.state.journalPaie.enregistre.brut, 6500, 'relu depuis le stockage');

  await api.sandbox.supprimerJournalPaie();
  assert.strictEqual(stockage.size, 0);
  assert.strictEqual(api.state.journalPaie.enregistre, null);
  console.log('OK — journal-paie-onglet-14-10.test.js (chargement, refus d\'une saisie incomplète, enregistrement, audit sans montants, suppression)');
}

async function runLExportContientLeJournalDuMois() {
  const { api, stockage, appels } = setup('proprietaire');
  let fichier = null;
  api.sandbox.downloadJSONFile = (donnees, nom) => { fichier = { donnees: JSON.parse(JSON.stringify(donnees)), nom }; };
  const messages = [];
  api.sandbox.showToast = (t, type) => messages.push({ t, type });

  await api.sandbox.exporterVersNexusGestion();
  assert.ok(fichier, 'export produit');
  assert.strictEqual(fichier.donnees.paie, null, 'pas de journal : bloc paie null');
  assert.ok(messages.some(m => /sans bloc « paie »/.test(m.t)), 'le message dit pourquoi il n\'y a pas de paie');

  stockage.set('2026-10', { brut: 6500, charges_salariales: 1400.5, charges_patronales: 2820.25, net_a_payer: 5099.5, date_paiement: '2026-10-31', detail_par_organisme: [{ organisme: 'URSSAF', montant: 2000 }] });
  fichier = null;
  await api.sandbox.exporterVersNexusGestion();
  validerFormatV1(fichier.donnees);
  assert.strictEqual(fichier.donnees.paie.net_a_payer, 5099.5);
  assert.ok(/avec le journal de paie/.test(api.DB.getAuditLog()[0].cible || JSON.stringify(api.DB.getAuditLog()[0])));

  // mois sans journal : null même si un autre mois en a un
  api.state.paieMonth = 10;
  fichier = null;
  await api.sandbox.exporterVersNexusGestion();
  assert.strictEqual(fichier.donnees.paie, null);

  // sans le droit financier : jamais de lecture du journal, paie null
  const rh = setup('rh');
  rh.stockage.set('2026-10', stockage.get('2026-10'));
  let f2 = null;
  rh.api.sandbox.downloadJSONFile = (d) => { f2 = JSON.parse(JSON.stringify(d)); };
  rh.api.DB._currentEmployeeId = rh.api.DB.getEmployees().find(e => e.role === 'rh').id;
  rh.api.sandbox.hasPermission = (u, p) => p === 'exporterPaie';
  await rh.api.sandbox.exporterVersNexusGestion();
  assert.ok(f2 && f2.paie === null, 'le bloc paie reste vide sans droit financier');
  assert.ok(!rh.appels.some(a => a[0] === 'get'), 'le journal n\'est même pas lu');
  console.log('OK — journal-paie-onglet-14-10.test.js (export : journal du mois inclus, autre mois et sans droit = null)');
}

async function runUneLectureEnEchecProposeDExporterSansPaie() {
  const { api } = setup('proprietaire');
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: (_, nom) => nom === 'getJournalPaie' ? async () => { throw new Error('table introuvable'); } : async () => ({ success: true }) });
  let fichier = null;
  api.sandbox.downloadJSONFile = (d) => { fichier = JSON.parse(JSON.stringify(d)); };
  let confirmation = null;
  api.sandbox.openConfirm = (opts) => { confirmation = opts; };
  await api.sandbox.exporterVersNexusGestion();
  assert.strictEqual(fichier, null, 'rien n\'est téléchargé sans choix explicite');
  assert.ok(confirmation && /illisible/i.test(confirmation.title) && /table introuvable/.test(confirmation.message));
  confirmation.onConfirm();
  assert.ok(fichier && fichier.paie === null, 'après confirmation : export sans le bloc paie');
  console.log('OK — journal-paie-onglet-14-10.test.js (lecture impossible : confirmation avant d\'exporter sans la paie)');
}

(async () => {
  try {
    await runLOngletEstReserveAuxDroitsFinanciers();
    await runLeJournalSeChargeSEnregistreEtSeSupprime();
    await runLExportContientLeJournalDuMois();
    await runUneLectureEnEchecProposeDExporterSansPaie();
  } catch (err) {
    console.error('ÉCHEC — journal-paie-onglet-14-10.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  }
})();
