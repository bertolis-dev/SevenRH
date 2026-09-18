/**
 * Seven RH — retour Betty du 18/09/2026, points 2.1/2.2/2.3 ("temps de travail") :
 *   2.1 le pourcentage d'activité était un champ manuel indépendant des heures hebdomadaires, jamais
 *       recalculé, affiché même pour un Temps plein (où il n'a aucun sens, toujours 100%). Devient
 *       calculé automatiquement (heures / durée de référence), affiché seulement en Temps partiel,
 *       avec un avertissement sous 24h/semaine (L3123-7, durée minimale légale sauf dérogation).
 *   2.2 35h était codée en dur (nouvelle fiche, repli de saisie) au lieu de venir d'un réglage par
 *       entreprise (dureeHebdomadaireReferenceHeures, Paramètres > Listes > Salariés, défaut 35h).
 *   2.3 en Forfait jours, les heures hebdomadaires n'ont pas de sens (décompte en jours dans
 *       l'année) : le champ bascule vers "Nombre de jours par an" (218 par défaut, L3121-64), avec
 *       les rappels légaux (L3121-55/58/63/64) affichés à côté.
 *
 * computeTempsTravailAffichage (app.js) est la fonction pure qui porte cette règle, réutilisée par
 * le rendu initial ET par la mise à jour en direct (bindTempsTravailFields) — testée directement,
 * plus fiable qu'une simulation de saisie DOM (addEventListener est un no-op dans ce bac à sable,
 * voir load-app-js.js).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function runTempsPleinToujours100EtPourcentageMasque() {
  const { computeTempsTravailAffichage } = loadAppJs();
  const r = computeTempsTravailAffichage('Temps plein', 'Aucun', 20, 35);
  assert.strictEqual(r.pourcentageVisible, false, 'en Temps plein, le pourcentage d\'activité n\'a pas à être affiché (toujours 100%, sans lien avec les heures)');
  assert.strictEqual(r.pourcentage, 100, 'en Temps plein, le pourcentage doit rester 100 quelles que soient les heures saisies');

  console.log('OK — temps-travail-reference-18-09.test.js (Temps plein : pourcentage masqué, toujours 100)');
}

async function runTempsPartielCalculeDepuisLesHeuresEtLaReference() {
  const { computeTempsTravailAffichage } = loadAppJs();
  const r = computeTempsTravailAffichage('Temps partiel', 'Aucun', 28, 35);
  assert.strictEqual(r.pourcentageVisible, true, 'en Temps partiel, le pourcentage doit être affiché');
  assert.strictEqual(r.pourcentage, 80, '28h sur une référence de 35h doit donner 80%, calculé automatiquement, jamais saisi à la main');

  // Avec une durée de référence différente (accord d'entreprise à 37h, par ex.), le même nombre
  // d'heures donne un pourcentage différent : preuve que le calcul dépend bien du réglage, pas d'une
  // constante 35 recodée en dur.
  const r37 = computeTempsTravailAffichage('Temps partiel', 'Aucun', 28, 37);
  assert.notStrictEqual(r37.pourcentage, r.pourcentage, 'le calcul doit dépendre de la durée de référence réelle de l\'entreprise, pas d\'une constante 35h figée');

  console.log('OK — temps-travail-reference-18-09.test.js (Temps partiel : pourcentage calculé depuis heures/référence, jamais une constante 35 figée)');
}

async function runAvertissementL3123SousLes24Heures() {
  const { computeTempsTravailAffichage } = loadAppJs();
  assert.strictEqual(computeTempsTravailAffichage('Temps partiel', 'Aucun', 20, 35).avertissementL3123, true, 'sous 24h/semaine en temps partiel, l\'avertissement L3123-7 doit apparaître');
  assert.strictEqual(computeTempsTravailAffichage('Temps partiel', 'Aucun', 24, 35).avertissementL3123, false, 'à 24h exactement (le minimum légal), aucun avertissement');
  assert.strictEqual(computeTempsTravailAffichage('Temps partiel', 'Aucun', 0, 35).avertissementL3123, false, '0h (champ pas encore renseigné) ne doit jamais déclencher l\'avertissement, ce n\'est pas encore "moins de 24h", c\'est juste vide');
  assert.strictEqual(computeTempsTravailAffichage('Temps plein', 'Aucun', 20, 35).avertissementL3123, false, 'l\'avertissement ne concerne que le temps partiel, jamais le temps plein');

  console.log('OK — temps-travail-reference-18-09.test.js (avertissement L3123-7 sous 24h/semaine, uniquement en temps partiel)');
}

async function runForfaitJoursBasculeHeuresVersJours() {
  const { computeTempsTravailAffichage } = loadAppJs();
  const r = computeTempsTravailAffichage('Temps plein', 'Forfait jours', 35, 35);
  assert.strictEqual(r.horairesVisible, false, 'en Forfait jours, les heures hebdomadaires n\'ont pas de sens (décompte en jours) : le champ doit être masqué');
  assert.strictEqual(r.joursForfaitVisible, true, 'en Forfait jours, "Nombre de jours par an" doit être affiché à la place');

  // Non-régression : hors forfait jours (Aucun/Forfait heures), c'est l'inverse.
  const rSansForfait = computeTempsTravailAffichage('Temps plein', 'Aucun', 35, 35);
  assert.strictEqual(rSansForfait.horairesVisible, true, 'hors Forfait jours, les heures hebdomadaires restent affichées');
  assert.strictEqual(rSansForfait.joursForfaitVisible, false, 'hors Forfait jours, "Nombre de jours par an" reste masqué');

  // Un forfait jours combiné à un temps partiel (cas limite, contradictoire en pratique) ne doit
  // jamais déclencher l'avertissement L3123-7 : le champ heures est masqué, sa valeur n'a plus de sens.
  assert.strictEqual(computeTempsTravailAffichage('Temps partiel', 'Forfait jours', 10, 35).avertissementL3123, false, 'l\'avertissement 24h ne doit jamais s\'appliquer quand le champ heures est masqué (Forfait jours)');

  console.log('OK — temps-travail-reference-18-09.test.js (Forfait jours : heures masquées, jours affichés)');
}

async function runFicheInitialeRefleteLeBonEtatDesLeRendu() {
  // Le rendu initial (openEmployeeModal) doit déjà appliquer computeTempsTravailAffichage, pas
  // seulement au premier changement côté client (sinon un salarié en Forfait jours verrait par erreur
  // les heures hebdomadaires à l'ouverture, avant toute interaction).
  const { DB, sandbox, openEmployeeModal, employeeRepository } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  employeeRepository.update(salarie.id, { forfait: 'Forfait jours', nombreJoursForfait: 210 });

  openEmployeeModal(salarie.id);
  const html = sandbox.document.getElementById('modal-root').innerHTML;
  assert.ok(html.includes('id="field-nombre-jours-forfait" >') || html.includes('id="field-nombre-jours-forfait">'), '"Nombre de jours par an" doit être visible dès le rendu initial pour un salarié déjà en Forfait jours');
  assert.ok(html.includes('id="field-horaires-hebdo" hidden>'), 'les heures hebdomadaires doivent être masquées dès le rendu initial pour ce même salarié');
  assert.ok(html.includes('value="210"'), 'la valeur déjà enregistrée du nombre de jours doit être reprise, pas réinitialisée à 218');
  assert.ok(html.includes('L3121-64'), 'les rappels légaux du forfait jours doivent être visibles dès le rendu initial');

  console.log('OK — temps-travail-reference-18-09.test.js (rendu initial déjà correct pour un salarié en Forfait jours, pas seulement après interaction)');
}

async function runReglageDureeReferenceExisteEtPrefillLesNouvellesFiches() {
  const { DB, sandbox, settingsRepository, openEmployeeModal } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;

  assert.strictEqual(settingsRepository.getSettings().dureeHebdomadaireReferenceHeures, 35, 'le réglage doit exister avec 35h comme valeur par défaut');

  const company = DB.getCurrentCompany();
  company.settings = Object.assign({}, company.settings, { dureeHebdomadaireReferenceHeures: 37 });
  DB.saveCurrentCompany(company);

  openEmployeeModal(); // nouvelle fiche
  const html = sandbox.document.getElementById('modal-root').innerHTML;
  assert.ok(html.includes('id="f-horairesHebdo"') && html.includes('value="37"'), 'une nouvelle fiche doit préremplir les heures hebdomadaires depuis le réglage réel de l\'entreprise (37h ici), pas une constante 35 codée en dur');

  console.log('OK — temps-travail-reference-18-09.test.js (réglage "Durée hebdomadaire de référence" existe, préremplit les nouvelles fiches)');
}

runTempsPleinToujours100EtPourcentageMasque()
  .then(runTempsPartielCalculeDepuisLesHeuresEtLaReference)
  .then(runAvertissementL3123SousLes24Heures)
  .then(runForfaitJoursBasculeHeuresVersJours)
  .then(runFicheInitialeRefleteLeBonEtatDesLeRendu)
  .then(runReglageDureeReferenceExisteEtPrefillLesNouvellesFiches)
  .catch((err) => {
    console.error('ÉCHEC — temps-travail-reference-18-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
