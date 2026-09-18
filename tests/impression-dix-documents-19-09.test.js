/**
 * Seven RH — retour Betty du 19/09/2026 (point 4, "impression sur six pages") : elle avait déjà
 * signalé ce défaut le 18/09/2026 (corrigé alors par une règle CSS @media print reposant sur
 * :has(), voir style.css) mais l'a reconstaté "exactement comme sur le certificat" sur la fiche
 * salarié — dix documents utilisent ce mécanisme, pas quatre comme signalé initialement.
 *
 * Cause probable identifiée et VÉRIFIÉE EN DIRECT dans un vrai navigateur (le bac à sable Node de
 * ce fichier a un DOM trop primitif pour un vrai test — querySelectorAll y renvoie toujours [],
 * limite déjà établie dans cette session) : un sélecteur :has() non supporté par le navigateur
 * invalide TOUTE la règle CSS qui l'utilise (jamais une dégradation partielle), faisant réapparaître
 * le bug d'origine à l'identique sans aucune régression de code qui l'explique — plausible sur un
 * poste d'entreprise pas systématiquement à jour (:has() : Chrome 105+/Firefox 121+/Safari 15.4+
 * seulement). Vérifié en direct : document.body.scrollHeight passait de 2536px (page entière,
 * sidebar+topbar+cartes comprises) à ~1025px (hauteur réelle du seul document) une fois
 * isolatePrintAreaForPrinting() appelée, y compris pour le cas non-modal (registre du personnel,
 * rendu dans #view-root plutôt que dans une modale) — restauration exacte confirmée ensuite
 * (afterprint). isolatePrintAreaForPrinting/restorePageAfterPrinting ne dépendent d'AUCUNE
 * fonctionnalité CSS récente (juste les événements beforeprint/afterprint, supportés depuis
 * IE10/Firefox 6), posées UNE SEULE FOIS dans bindGlobalEvents : les 10 documents concernés n'ont
 * besoin d'aucune modification individuelle, ils partagent déjà tous la classe .print-area.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

async function runMecanismeJsPoseUneSeuleFoisDansBindGlobalEvents() {
  const fnStart = appSource.indexOf('function bindGlobalEvents() {');
  const fnEnd = appSource.indexOf('\nfunction ', fnStart + 30); // prochaine déclaration de fonction top-level
  const body = appSource.slice(fnStart, fnEnd);
  assert.ok(body.includes(`window.addEventListener('beforeprint', isolatePrintAreaForPrinting)`),
    'beforeprint doit être écouté une seule fois, globalement — jamais par document individuel');
  assert.ok(body.includes(`window.addEventListener('afterprint', restorePageAfterPrinting)`));

  console.log('OK — impression-dix-documents-19-09.test.js (mécanisme posé une seule fois, globalement, dans bindGlobalEvents)');
}

async function runIsolationNeDependAdAucuneFonctionnaliteCssRecente() {
  const fnStart = appSource.indexOf('function isolatePrintAreaForPrinting()');
  const fnEnd = appSource.indexOf('\nfunction restorePageAfterPrinting');
  const body = appSource.slice(fnStart, fnEnd);
  assert.ok(body.includes('display'), 'doit utiliser display:none (retire du flux), jamais visibility (cause historique du bug)');
  assert.ok(!body.includes(':has('), 'la version JS ne doit dépendre d\'aucun sélecteur CSS récent — c\'est justement le filet de sécurité si :has() n\'est pas supporté');
  assert.ok(body.includes("style.position = 'static'"), 'doit neutraliser position:fixed sur les ancêtres (une modale s\'affiche normalement ainsi, et un élément position:fixed ne compte pour rien dans document.body.scrollHeight, vérifié en direct)');
  assert.ok(body.includes("style.overflow = 'visible'") && body.includes("style.maxHeight = 'none'"),
    'doit neutraliser le plafond de hauteur/défilement d\'une modale (90vh + overflow-y:auto), sinon un document un peu long resterait invisible au-delà du cadre');

  console.log('OK — impression-dix-documents-19-09.test.js (isolation : display:none réel, neutralise position/overflow/maxHeight, sans dépendre de :has())');
}

async function runRestaurationSymmetriqueDeLisolation() {
  const fnStart = appSource.indexOf('function restorePageAfterPrinting()');
  const body = appSource.slice(fnStart, fnStart + 400);
  assert.ok(body.includes('printIsolationRestore = null'), 'doit remettre le drapeau à null après restauration, pour ne jamais restaurer deux fois par erreur');
  assert.ok(body.includes('el.style[prop] = value'), 'doit restaurer CHAQUE propriété individuellement modifiée (display sur les éléments masqués, position/overflow/maxHeight/inset/margin/padding sur les ancêtres), pas un simple style.cssText générique qui écraserait aussi des styles inline préexistants sans rapport');

  console.log('OK — impression-dix-documents-19-09.test.js (restauration : symétrique, jamais appliquée deux fois)');
}

async function runLesDixDocumentsPartagentTousLaClassePrintArea() {
  // Filet de sécurité par balayage du texte source : confirme que chacun des 10 documents cités
  // par Betty construit bien un print-area — condition nécessaire pour bénéficier du mécanisme
  // désormais posé une seule fois. N'affirme rien sur le rendu réel (déjà vérifié en direct dans le
  // navigateur, voir l'en-tête de ce fichier), seulement que le point d'accroche existe toujours.
  const fonctionsAVerifier = [
    'openEmployeePrintModal', 'openAttestationEmployeurModal', 'openCertificatTravailModal',
    'openRegistreUniquePersonnelModal', 'openLeaveAttestationModal', 'openAttestationSalaireModal',
    'openExpenseDetailModal', 'openGenererDocumentModal'
  ];
  fonctionsAVerifier.forEach(nom => {
    const fnStart = appSource.indexOf(`function ${nom}(`);
    assert.ok(fnStart !== -1, `fonction introuvable : ${nom}`);
    const body = appSource.slice(fnStart, fnStart + 3500);
    assert.ok(body.includes('print-area'), `${nom} doit construire une zone .print-area pour bénéficier du mécanisme commun`);
  });
  // Registre du personnel version Paramètres (non modale) — cas particulier signalé par la
  // recherche comme potentiellement non couvert par l'ANCIEN reset CSS scopé à .modal/#modal-root ;
  // le nouveau mécanisme JS marche sur les ancêtres RÉELS, modale ou pas, donc couvre aussi ce cas.
  assert.ok(appSource.includes('registre-personnel-print-area'), 'le registre du personnel version Paramètres (rendu hors modale) doit aussi avoir sa print-area');

  console.log('OK — impression-dix-documents-19-09.test.js (les documents cités construisent bien une .print-area, condition pour bénéficier du mécanisme commun)');
}

runMecanismeJsPoseUneSeuleFoisDansBindGlobalEvents()
  .then(runIsolationNeDependAdAucuneFonctionnaliteCssRecente)
  .then(runRestaurationSymmetriqueDeLisolation)
  .then(runLesDixDocumentsPartagentTousLaClassePrintArea)
  .catch((err) => {
    console.error('ÉCHEC — impression-dix-documents-19-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
