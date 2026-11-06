/**
 * Seven RH — retour du 06/11/2026 : (1) « dans les imports, ça met une journée quand on veut une demi-journée, il faut être plus précis » ; (2) paliers d'ancienneté :
 * préciser ce qu'il faut saisir (ancienneté en années, jours par an) et pouvoir réserver un palier à une catégorie (Cadre / Non cadre).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function setup() {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  return api;
}

function apercu(api, entetes, lignes) {
  const mapping = api.guessAbsencesColumnMapping(entetes);
  const type = api.leaveTypeRepository.getLeaveTypes().find(t => t.categorie === 'conge' && t.nom === 'Congés payés');
  const salarie = api.employeeRepository.getAll().find(e => !e.archive);
  const complet = lignes.map(l => l.map(c => c.replace('{MAT}', salarie.matricule).replace('{TYPE}', type.nom)));
  return { mapping, rows: api.buildAbsencesPreviewRows(complet, mapping, 'conge') };
}

function run() {
  const api = setup();
  const H = ['Matricule', 'Type', 'Date début', 'Date fin', 'Demi-journée', 'Demi-journée début', 'Demi-journée fin', 'Nombre de jours', 'Commentaire'];

  // --- Colonnes reconnues ---
  const m = api.guessAbsencesColumnMapping(H);
  assert.deepStrictEqual([m.demiJournee, m.demiJourneeDebut, m.demiJourneeFin, m.nbJours], [4, 5, 6, 7], 'les trois colonnes de demi-journée et le nombre de jours sont reconnus');
  assert.strictEqual(m.suspectes.length, 0);
  const m2 = api.guessAbsencesColumnMapping(['MATRICULE', 'TYPE', 'DEBUT', 'FIN', 'DEMI JOURNEE', 'NB JOURS']);
  assert.deepStrictEqual([m2.demiJournee, m2.nbJours], [4, 5], 'insensible aux accents, à la casse et aux variantes');
  const m3 = api.guessAbsencesColumnMapping(['Matricule', 'Type', 'Date début', 'Date fin', 'Demi-journée (matin / après-midi)']);
  assert.strictEqual(m3.demiJournee, 4, 'un en-tête voisin est rattaché à la colonne Demi-journée');
  const m4 = api.guessAbsencesColumnMapping(['Matricule', 'Type', 'Date début', 'Date fin', 'Moitié de journée', 'Part de matinée']);
  assert.ok(m4.suspectes.includes('Part de matinée'), 'un en-tête qui parle de demi-journée sans être reconnu est signalé (import bloqué par l\'écran)');

  // --- Une demi-journée, en colonne « Demi-journée » ---
  let { rows } = apercu(api, H, [
    ['{MAT}', '{TYPE}', '05/10/2026', '', 'Matin', '', '', '0,5', ''],
    ['{MAT}', '{TYPE}', '06/10/2026', '', 'Après-midi', '', '', '0,5', ''],
    ['{MAT}', '{TYPE}', '07/10/2026', '', 'après midi', '', '', '', ''],
    ['{MAT}', '{TYPE}', '08/10/2026', '', 'AM', '', '', '', ''],
    ['{MAT}', '{TYPE}', '09/10/2026', '', 'PM', '', '', '', ''],
    ['{MAT}', '{TYPE}', '13/10/2026', '', 'Journée complète', '', '', '1', '']
  ]);
  assert.deepStrictEqual(rows.map(r => r.status), ['ok', 'ok', 'ok', 'ok', 'ok', 'ok'], rows.map(r => r.message).join(' | '));
  assert.deepStrictEqual(rows.map(r => r.nbJours), [0.5, 0.5, 0.5, 0.5, 0.5, 1], 'chaque demi-journée vaut 0,5, la journée complète 1');
  assert.deepStrictEqual(rows.map(r => r.demiJournee), ['matin', 'apres-midi', 'apres-midi', 'matin', 'apres-midi', null]);

  // --- Plusieurs jours : début l'après-midi, fin le matin ---
  ({ rows } = apercu(api, H, [['{MAT}', '{TYPE}', '12/10/2026', '16/10/2026', '', 'Après-midi', 'Matin', '4', '']]));
  assert.strictEqual(rows[0].status, 'ok', rows[0].message);
  assert.strictEqual(rows[0].nbJours, 4, 'du lundi après-midi au vendredi matin = 4 jours');

  // --- Le contrôle « Nombre de jours » attrape l'erreur d'origine : 0,5 annoncé, journée complète comptée ---
  ({ rows } = apercu(api, H, [['{MAT}', '{TYPE}', '05/10/2026', '', '', '', '', '0,5', '']]));
  assert.strictEqual(rows[0].status, 'error');
  assert.ok(/indique 0,5 jour/.test(rows[0].message) && /Matin ou Après-midi/.test(rows[0].message), 'message précis : ' + rows[0].message);
  ({ rows } = apercu(api, H, [['{MAT}', '{TYPE}', '19/10/2026', '23/10/2026', '', '', '', '6', '']]));
  assert.ok(rows[0].status === 'error' && /l'application en compte 5/.test(rows[0].message), 'nombre de jours incohérent refusé');
  ({ rows } = apercu(api, H, [['{MAT}', '{TYPE}', '19/10/2026', '23/10/2026', '', '', '', '5', '']]));
  assert.strictEqual(rows[0].status, 'ok', 'nombre de jours cohérent accepté');
  ({ rows } = apercu(api, H, [['{MAT}', '{TYPE}', '19/10/2026', '23/10/2026', '', '', '', 'beaucoup', '']]));
  assert.ok(rows[0].status === 'error' && /non reconnu/.test(rows[0].message));
  ({ rows } = apercu(api, H, [['{MAT}', '{TYPE}', '05/10/2026', '', 'Matin', '', '', '1/2', '']]));
  assert.strictEqual(rows[0].status, 'ok', 'la fraction 1/2 est comprise');

  // --- Erreurs de saisie explicites, jamais ignorées en silence ---
  ({ rows } = apercu(api, H, [
    ['{MAT}', '{TYPE}', '05/10/2026', '', 'Quelque temps', '', '', '', ''],
    ['{MAT}', '{TYPE}', '05/10/2026', '07/10/2026', 'Matin', '', '', '', ''],
    ['{MAT}', '{TYPE}', '05/10/2026', '07/10/2026', '', 'Matin', '', '', ''],
    ['{MAT}', '{TYPE}', '05/10/2026', '07/10/2026', '', '', 'Après-midi', '', ''],
    ['{MAT}', '{TYPE}', '05/10/2026', '', 'Matin', 'Après-midi', '', '', '']
  ]));
  assert.ok(rows.every(r => r.status === 'error'), 'toutes ces lignes sont refusées');
  assert.ok(/non reconnue/.test(rows[0].message));
  assert.ok(/un seul jour/.test(rows[1].message), 'Demi-journée sur une période : refusé et expliqué');
  assert.ok(/commence le matin/.test(rows[2].message));
  assert.ok(/finit l'après-midi/.test(rows[3].message));
  assert.ok(/soit « Demi-journée »/.test(rows[4].message), 'deux colonnes contradictoires refusées');

  // --- Anciens fichiers (sans les nouvelles colonnes) : comportement inchangé ---
  const ancien = apercu(api, ['Matricule', 'Type', 'Date début', 'Date fin', 'Demi-journée début', 'Demi-journée fin'], [['{MAT}', '{TYPE}', '06/10/2026', '', 'Après-midi', '']]);
  assert.strictEqual(ancien.rows[0].status, 'ok');
  assert.strictEqual(ancien.rows[0].nbJours, 0.5);

  // --- Le modèle téléchargeable explique et donne un exemple pour chaque cas ---
  const classeur = api.buildAbsencesImportTemplateWorkbook('conge');
  const texte = typeof classeur === 'string' ? classeur : JSON.stringify(classeur);
  ['Demi-journée', 'Demi-journée début', 'Demi-journée fin', 'Nombre de jours', 'Aide', 'EXEMPLE'].forEach(mot => assert.ok(texte.includes(mot), 'le modèle contient « ' + mot + ' »'));

  // --- Paliers d'ancienneté par catégorie (cadre / non cadre) ---
  const { DB, resolveAncienneteAcquisAnnuel } = api;
  const settings = DB.getSettings();
  settings.categoriesSalarie = [{ id: 'cat_cadre', nom: 'Cadre' }, { id: 'cat_noncadre', nom: 'Non cadre' }];
  DB.saveSettings(settings);
  const emp = (categorie, annees) => {
    const ref = new Date(2026, 10, 6);
    const debut = new Date(ref.getFullYear() - annees, ref.getMonth(), ref.getDate() - 2);
    const iso = `${debut.getFullYear()}-${String(debut.getMonth() + 1).padStart(2, '0')}-${String(debut.getDate()).padStart(2, '0')}`;
    return { dateEmbauche: iso, statutPro: '', categorieSalarieId: categorie, dateDepart: '' };
  };
  const type = { nombreAnnuel: 0, paliersAnciennete: [
    { ancienneteMin: 0, jours: 25, categorieSalarieId: '' },
    { ancienneteMin: 20, jours: 27, categorieSalarieId: 'cat_cadre' },
    { ancienneteMin: 20, jours: 28, categorieSalarieId: 'cat_noncadre' }
  ] };
  const ref = new Date(2026, 10, 6);
  assert.strictEqual(resolveAncienneteAcquisAnnuel(type, emp('cat_cadre', 3), ref), 25, 'cadre à 3 ans : palier de départ commun');
  assert.strictEqual(resolveAncienneteAcquisAnnuel(type, emp('cat_cadre', 21), ref), 27, 'cadre à 21 ans : palier cadre');
  assert.strictEqual(resolveAncienneteAcquisAnnuel(type, emp('cat_noncadre', 21), ref), 28, 'non cadre à 21 ans : palier non cadre');
  assert.strictEqual(resolveAncienneteAcquisAnnuel(type, emp('', 21), ref), 25, 'sans catégorie : seuls les paliers « toutes catégories » s\'appliquent');
  // Palier propre à la catégorie qui passe avant « toutes » à ancienneté égale.
  const egalite = { nombreAnnuel: 0, paliersAnciennete: [{ ancienneteMin: 5, jours: 26 }, { ancienneteMin: 5, jours: 29, categorieSalarieId: 'cat_cadre' }] };
  assert.strictEqual(resolveAncienneteAcquisAnnuel(egalite, emp('cat_cadre', 6), ref), 29, 'à ancienneté égale, le palier de la catégorie l\'emporte');
  assert.strictEqual(resolveAncienneteAcquisAnnuel(egalite, emp('cat_noncadre', 6), ref), 26);
  // Anciens paliers sans catégorie : comportement inchangé (concernent tout le monde).
  const ancienPalier = { nombreAnnuel: 0, paliersAnciennete: [{ ancienneteMin: 0, jours: 25 }, { ancienneteMin: 10, jours: 26 }] };
  assert.strictEqual(resolveAncienneteAcquisAnnuel(ancienPalier, emp('cat_cadre', 11), ref), 26);
  assert.strictEqual(resolveAncienneteAcquisAnnuel({ nombreAnnuel: 24, paliersAnciennete: [] }, emp('cat_cadre', 11), ref), 24, 'sans palier : nombre annuel inchangé');

  console.log('OK — import-demi-journees-paliers-06-11.test.js (demi-journées précises, contrôle du nombre de jours, modèle, paliers par catégorie)');
}

try { run(); } catch (err) { console.error('ÉCHEC — import-demi-journees-paliers-06-11.test.js'); console.error(err.stack || err.message); process.exitCode = 1; }
