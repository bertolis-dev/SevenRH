/**
 * Seven RH — tour de l'application du 09/10/2026, second lot de défauts confirmés dans le code :
 * pagination (id partagés avec le panneau de notifications), filtres « à valider » partagés par
 * référence, turn-over sans les salariés archivés, justificatif perdu sur « Envoyer quand même »,
 * avenant au montant saisi avec espace/virgule, veille d'un contrat au passage à l'heure d'été,
 * titre d'organigramme échappé deux fois, caméra du pointage restée allumée après Échap.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAppJs } = require('./load-app-js');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const data = fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8');
const fnBody = (src, name) => {
  const i = src.indexOf(name);
  const j = src.indexOf('\nfunction ', i + 1);
  return src.slice(i, j === -1 ? undefined : j);
};

function runPaginationDuPanneauNotificationsALesSiensId() {
  const api = loadAppJs();
  const html = api.sandbox.renderPaginationControls(1, 3, 0, 20, 50, 'notif-page');
  assert.ok(html.includes('id="notif-page-prev"') && html.includes('id="notif-page-next"'));
  assert.ok(!html.includes('btn-page-prev'), 'le panneau ne doit plus partager les id des listes');
  const listes = api.sandbox.renderPaginationControls(1, 3, 0, 20, 50);
  assert.ok(listes.includes('id="btn-page-prev"') && listes.includes('id="btn-page-next"'), 'les listes gardent leurs id');
  assert.ok(/notif-page-prev/.test(fnBody(app, 'function renderNotifPanel')), 'renderNotifPanel doit câbler ses propres boutons');
  console.log("OK — lot2-petits-defauts-09-10.test.js (pagination : le panneau de notifications n'usurpe plus les boutons des listes)");
}

function runNavigateToCopieSesParametres() {
  const body = fnBody(app, 'function navigateTo');
  assert.ok(/Array\.isArray\(v\) \? v\.slice\(\)/.test(body) && /\{ \.\.\.v \}/.test(body), 'les objets et tableaux passés doivent être copiés');
  assert.ok(/Object\.assign\(state, copie\)/.test(body) && !/Object\.assign\(state, params\)/.test(body));
  console.log('OK — lot2-petits-defauts-09-10.test.js (navigateTo copie ses paramètres : plus de filtre fantôme sur « à valider »)');
}

function runLeTurnoverCompteLesSortiesArchivees() {
  const { calculateTurnoverRate } = loadAppJs().sandbox;
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const il = (jours) => { const d = new Date(); d.setDate(d.getDate() - jours); return iso(d); };
  const salaries = [
    { statut: 'Actif', archive: false, dateEmbauche: il(900) },
    { statut: 'Actif', archive: false, dateEmbauche: il(900) },
    { statut: 'Inactif', archive: true, dateEmbauche: il(900), dateDepart: il(30) }
  ];
  assert.ok(calculateTurnoverRate(salaries) > 0, 'un salarié parti puis archivé doit compter comme une sortie');
  assert.strictEqual(calculateTurnoverRate(salaries.filter(e => !e.archive)), 0, 'sans les archivés la sortie était invisible (ancien comportement)');
  const avecArchiveeActive = salaries.concat([{ statut: 'Actif', archive: true, dateEmbauche: il(900) }]);
  assert.strictEqual(calculateTurnoverRate(avecArchiveeActive), calculateTurnoverRate(salaries), 'un archivé ne compte jamais dans l\'effectif actuel');
  assert.ok(/calculateTurnoverRate\(employeeRepository\.getAll\(\)\)/.test(app), 'le tableau de bord doit transmettre aussi les archivés');
  console.log('OK — lot2-petits-defauts-09-10.test.js (turn-over : sorties archivées comptées, effectif actuel inchangé)');
}

function runLeJustificatifSurvitALaConfirmation() {
  const body = fnBody(app, 'async function finalizeExpenseSubmit');
  assert.ok(/justificatifFile = state\.pendingAttachmentFile/.test(body));
  assert.ok(!/file: state\.pendingAttachmentFile/.test(body), 'les deux envois utilisent le fichier capturé avant openConfirm');
  assert.ok(/finalizeExpenseSubmit\(data, submitBtn, editingExpenseId, justificatifEnAttente\)/.test(app));
  console.log('OK — lot2-petits-defauts-09-10.test.js (note de frais : le justificatif survit à « Envoyer quand même »)');
}

function runLAvenantNormaliseLesMontants() {
  const i = app.indexOf("let nouvelleValeur = champModifie ? document.getElementById('f-avenant-nouvelle-valeur')");
  assert.ok(i > 0, 'le bloc de normalisation doit exister');
  const bloc = app.slice(i, i + 900);
  assert.ok(bloc.includes("replace(/[\\s\\u00a0\\u202f]/g, '').replace(',', '.')"), 'espaces (dont insécables) retirés, virgule convertie');
  assert.ok(/Number\.isFinite\(nombre\)/.test(bloc), 'une saisie qui n\'est pas un nombre est refusée');
  const nombre = (s) => Number(s.replace(/[\s  ]/g, '').replace(',', '.'));
  assert.strictEqual(nombre('2 800'), 2800);
  assert.strictEqual(nombre('2 800,5'), 2800.5);
  assert.ok(!Number.isFinite(nombre('abc')));
  console.log('OK — lot2-petits-defauts-09-10.test.js (avenant : « 2 800 » et « 2800,5 » acceptés, texte refusé)');
}

function runLaVeilleDUnContratResisteAuChangementDHeure() {
  const { addDays, parseISODateLocal, toISODate } = loadAppJs().sandbox;
  const veille = toISODate(addDays(parseISODateLocal('2026-03-30'), -1));
  assert.strictEqual(veille, '2026-03-29', 'la veille du 30/03/2026 est le 29/03, quel que soit le fuseau');
  assert.ok(!/getTime\(\) - 86400000\)\)\);\s*\n\s*contrats\.forEach/.test(data), 'plus de soustraction de 24 h en millisecondes dans addContrat');
  assert.ok(!/new Date\((current|previous)\.periodStart\.getTime\(\) - 86400000\)/.test(data), 'ni dans le calcul des périodes de clôture');
  console.log("OK — lot2-petits-defauts-09-10.test.js (veille d'un contrat : calcul par jour calendaire, pas par 24 h)");
}

function runLOrganigrammeImprimeNEchappePasDeuxFois() {
  const ligne = app.split('\n').find(l => l.includes("'Organigramme', `${employees.length}"));
  assert.ok(ligne, 'ligne introuvable');
  assert.ok(!/escapeHtml\(f\.service\)/.test(ligne) && !/escapeHtml\(f\.equipe\)/.test(ligne), 'renderPrintDocumentHeader échappe déjà son sous-titre');
  console.log("OK — lot2-petits-defauts-09-10.test.js (organigramme imprimé : « R&D » ne s'affiche plus « R&amp;D »)");
}

function runLaCameraSArreteQuandLaModaleDisparait() {
  const i = app.indexOf('const tick = () => {', app.indexOf('pointage-scan-video'));
  assert.ok(i > 0);
  assert.ok(/if \(!document\.contains\(video\)\) \{ stop\(\); return; \}/.test(app.slice(i, i + 700)), 'la boucle doit s\'arrêter dès que la vidéo quitte le document');
  console.log('OK — lot2-petits-defauts-09-10.test.js (pointage : caméra coupée même si la modale est fermée par Échap)');
}

try {
  runPaginationDuPanneauNotificationsALesSiensId();
  runNavigateToCopieSesParametres();
  runLeTurnoverCompteLesSortiesArchivees();
  runLeJustificatifSurvitALaConfirmation();
  runLAvenantNormaliseLesMontants();
  runLaVeilleDUnContratResisteAuChangementDHeure();
  runLOrganigrammeImprimeNEchappePasDeuxFois();
  runLaCameraSArreteQuandLaModaleDisparait();
} catch (err) {
  console.error('ÉCHEC — lot2-petits-defauts-09-10.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
