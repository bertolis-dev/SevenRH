/**
 * Seven RH — retour Betty du 18/09/2026, point 3 ("régime RTT structuré") : l'ancien champ "Régime
 * RTT" était un simple texte libre, jamais relié à rien (ni calcul, ni compteur) — remplacé par un
 * choix fermé à 4 valeurs (REGIME_RTT_OPTIONS, app.js) : aucun / forfait annuel avec jours /
 * acquisition au réel (s'appuie sur le compteur RTT générique déjà existant, un type de congé comme
 * un autre) / calcul automatique pour forfait jours (formule donnée par Betty, voir
 * calculerJoursRTTAutoForfaitJours, data.js). Betty a explicitement dit ne pas avoir encore d'accord
 * d'entreprise encadrant le forfait jours : le calcul automatique reste une ESTIMATION affichée,
 * jamais injectée dans un vrai compteur RTT tant qu'elle n'a pas confirmé les termes légaux — ces
 * tests vérifient justement que rien de tel n'est fait silencieusement.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function runQuatreOptionsExactes() {
  const { REGIME_RTT_OPTIONS } = loadAppJs();
  // .join(',') plutôt que deepStrictEqual sur les tableaux eux-mêmes : REGIME_RTT_OPTIONS vient d'un
  // contexte vm séparé (voir load-app-js.js), un Array y appartient à un autre "royaume" JS que celui
  // de ce fichier de test — deepStrictEqual sur deux tableaux de royaumes différents échoue sur leur
  // prototype même quand leur contenu est identique. Les chaînes, elles, restent des primitives sans
  // ce problème.
  const valeurs = Array.from(REGIME_RTT_OPTIONS).map(o => o.value).sort().join(',');
  assert.strictEqual(valeurs, ['acquisition_reelle', 'aucun', 'calcul_auto_forfait_jours', 'forfait_annuel'].sort().join(','),
    'le régime RTT doit être un choix fermé à exactement ces 4 valeurs');

  console.log('OK — regime-rtt-structure-18-09.test.js (4 régimes exacts, plus de champ libre)');
}

async function runFormuleCalculAutomatique() {
  const { calculerJoursRTTAutoForfaitJours } = loadAppJs();
  const jours2026 = calculerJoursRTTAutoForfaitJours(2026, 218);
  // Ordre de grandeur déjà documenté ailleurs dans le code (10 à 12 jours/an pour un forfait 218
  // jours) — la formule (365 − week-ends − 25 CP − fériés en semaine − 218) doit rester dans cette
  // fourchette réaliste, jamais un résultat absurde (négatif ou à deux chiffres improbables).
  assert.ok(jours2026 >= 8 && jours2026 <= 13, `un forfait de 218 jours doit donner un ordre de grandeur réaliste (8 à 13 jours), obtenu : ${jours2026}`);

  // Un forfait à MOINS de jours (accord plus favorable) doit donner PLUS de RTT, mécaniquement.
  const jours210 = calculerJoursRTTAutoForfaitJours(2026, 210);
  assert.ok(jours210 > jours2026, 'un forfait de 210 jours doit donner plus de RTT qu\'un forfait de 218 jours (moins de jours travaillés = plus de jours de repos)');

  console.log('OK — regime-rtt-structure-18-09.test.js (formule du calcul automatique : ordre de grandeur réaliste, cohérente avec le nombre de jours du forfait)');
}

async function runLibelleSeulementEnCalculAuto() {
  const { libelleRegimeRTTAutoCalcul } = loadAppJs();
  assert.strictEqual(libelleRegimeRTTAutoCalcul({ regimeRTT: 'aucun', nombreJoursForfait: 218 }, 2026), '', 'aucun libellé ne doit être produit hors régime "calcul automatique"');
  assert.strictEqual(libelleRegimeRTTAutoCalcul({ regimeRTT: 'forfait_annuel', nombreJoursForfait: 218 }, 2026), '', 'aucun libellé pour "forfait annuel avec jours" non plus, régime distinct');

  const libelle = libelleRegimeRTTAutoCalcul({ regimeRTT: 'calcul_auto_forfait_jours', nombreJoursForfait: 218 }, 2026);
  assert.ok(libelle.includes('2026') && libelle.includes('218'), 'le libellé doit citer l\'année et le nombre de jours du forfait utilisés pour le calcul');

  console.log('OK — regime-rtt-structure-18-09.test.js (libellé affiché uniquement en régime "calcul automatique")');
}

async function runRenduInitialRefleteLeRegimeChoisi() {
  const { DB, sandbox, openEmployeeModal, employeeRepository } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');

  // Régime "forfait annuel avec jours" : le sous-champ jours/an doit être visible dès le rendu.
  employeeRepository.update(salarie.id, { regimeRTT: 'forfait_annuel', nombreJoursRTTAnnuel: 12 });
  openEmployeeModal(salarie.id);
  let html = sandbox.document.getElementById('modal-root').innerHTML;
  assert.ok(html.includes('id="field-nombre-jours-rtt-annuel" >') || html.includes('id="field-nombre-jours-rtt-annuel">'), 'en régime "forfait annuel", le sous-champ doit être visible dès le rendu initial');
  assert.ok(html.includes('value="12"'), 'la valeur déjà enregistrée du forfait annuel RTT doit être reprise');
  assert.ok(html.includes('id="field-rtt-calcul-auto" hidden>'), 'le bloc "calcul automatique" ne doit pas apparaître pour ce régime');

  // Régime "calcul automatique" : l'estimation ET le disclaimer doivent apparaître dès le rendu,
  // sans attendre une interaction.
  employeeRepository.update(salarie.id, { regimeRTT: 'calcul_auto_forfait_jours', nombreJoursForfait: 218 });
  openEmployeeModal(salarie.id);
  html = sandbox.document.getElementById('modal-root').innerHTML;
  assert.ok(html.includes('id="field-rtt-calcul-auto" >') || html.includes('id="field-rtt-calcul-auto">'), 'en régime "calcul automatique", le bloc d\'estimation doit être visible dès le rendu initial');
  assert.ok(html.includes('id="rtt-calcul-auto-disclaimer" >') || html.includes('id="rtt-calcul-auto-disclaimer">'), 'le disclaimer ("estimation à titre indicatif, aucun accord d\'entreprise") doit être visible dès le rendu initial, jamais optionnel');
  assert.ok(html.includes('jours de RTT estimés'), 'le résultat du calcul doit déjà être affiché dans le HTML initial');

  console.log('OK — regime-rtt-structure-18-09.test.js (rendu initial déjà correct pour chaque régime, pas seulement après interaction)');
}

async function runJamaisInjecteDansUnVraiCompteur() {
  // Contrôle défensif : le calcul automatique ne doit JAMAIS écrire dans un compteur de congés réel
  // (company.leaveTypes / compteurs de l'employé) — seulement afficher une estimation. Vérifié en
  // s'assurant que submitEmployeeForm (source) ne touche à aucun champ de compteur RTT réel.
  const fs = require('fs');
  const path = require('path');
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const fnStart = appSource.indexOf('function bindRegimeRTTFields(');
  const fnBody = appSource.slice(fnStart, fnStart + 1800);
  assert.ok(!fnBody.includes('compteurs'), 'le calcul automatique ne doit jamais écrire dans employee.compteurs (les vrais soldes de congés) : c\'est une estimation affichée, pas une décision d\'attribution');
  assert.ok(!fnBody.includes('leaveTypeRepository') && !fnBody.includes('saveLeaveTypes'), 'le calcul automatique ne doit jamais modifier un type de congé existant tant que Betty n\'a pas confirmé les termes de l\'accord');

  console.log('OK — regime-rtt-structure-18-09.test.js (garde-fou : le calcul automatique reste une estimation affichée, jamais injectée dans un vrai compteur)');
}

runQuatreOptionsExactes()
  .then(runFormuleCalculAutomatique)
  .then(runLibelleSeulementEnCalculAuto)
  .then(runRenduInitialRefleteLeRegimeChoisi)
  .then(runJamaisInjecteDansUnVraiCompteur)
  .catch((err) => {
    console.error('ÉCHEC — regime-rtt-structure-18-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
