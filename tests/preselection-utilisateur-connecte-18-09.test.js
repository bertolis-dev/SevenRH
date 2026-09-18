/**
 * Seven RH — retour Betty du 18/09/2026, point 6 : le champ "Salarié" des formulaires de demande
 * (Congés, Autres absences, Télétravail, Notes de frais) restait vide (tiret) quand la modale est
 * ouverte depuis l'écran de liste, obligeant le responsable qui pose son propre congé à se chercher
 * lui-même dans la liste. Les 4 formulaires passent tous par employeeFieldForRequest (app.js) — un
 * seul correctif suffit. Point d'attention explicite de Betty : ne pas casser le cas où la demande
 * est ouverte depuis la fiche d'un AUTRE salarié (presetEmployeeId fourni) — celui-ci doit rester
 * sélectionné, jamais remplacé par l'utilisateur connecté.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function setup() {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  return api;
}

async function runPreselectionneSansPresetEmployeeId() {
  const { DB, employeeRepository, employeeFieldForRequest } = setup();
  const employees = employeeRepository.getAll().filter(e => !e.archive);
  // Un rôle avec visibilité entreprise entière (proprietaire) : le champ reste un vrai sélecteur
  // (pas verrouillé), c'est justement le cas où l'ancien tiret vide se voyait.
  const proprietaire = employees.find(e => e.role === 'proprietaire');
  DB._currentEmployeeId = proprietaire.id;

  const html = employeeFieldForRequest(undefined, employees);
  assert.ok(html.includes(`value="${proprietaire.id}" selected`), 'sans presetEmployeeId, l\'utilisateur connecté doit être préselectionné, jamais un champ vide');

  console.log('OK — preselection-utilisateur-connecte-18-09.test.js (préselectionné à vide, ouvert depuis l\'écran de liste)');
}

async function runNeCassePasLaFicheSalarieDUnAutre() {
  const { DB, employeeRepository, employeeFieldForRequest } = setup();
  const employees = employeeRepository.getAll().filter(e => !e.archive);
  const proprietaire = employees.find(e => e.role === 'proprietaire');
  const autreSalarie = employees.find(e => e.id !== proprietaire.id);
  assert.ok(autreSalarie, 'jeu de démo attendu : au moins deux salariés');
  DB._currentEmployeeId = proprietaire.id;

  // Ouvert depuis LA FICHE d'un autre salarié (presetEmployeeId fourni) : ce salarié doit rester
  // sélectionné, jamais remplacé par l'utilisateur connecté qui consulte sa fiche.
  const html = employeeFieldForRequest(autreSalarie.id, employees);
  assert.ok(html.includes(`value="${autreSalarie.id}" selected`), 'la fiche d\'un autre salarié doit garder CE salarié sélectionné');
  assert.ok(!html.includes(`value="${proprietaire.id}" selected`), 'l\'utilisateur connecté ne doit jamais écraser une présélection explicite');

  console.log('OK — preselection-utilisateur-connecte-18-09.test.js (fiche d\'un autre salarié : ce salarié reste sélectionné, jamais l\'utilisateur connecté)');
}

async function runValableSurLes4FormulairesAppelants() {
  const { DB, employeeRepository, openLeaveRequestModal, sandbox } = setup();
  const employees = employeeRepository.getAll().filter(e => !e.archive);
  const proprietaire = employees.find(e => e.role === 'proprietaire');
  DB._currentEmployeeId = proprietaire.id;

  // openLeaveRequestModal couvre à la fois Congés et Autres absences (même modale, catégorie en
  // paramètre) — vérifie ici le rendu complet d'un vrai appelant, pas seulement la fonction isolée.
  sandbox.document.getElementById('modal-root').innerHTML = '';
  openLeaveRequestModal(undefined, 'conge');
  const html = sandbox.document.getElementById('modal-root').innerHTML;
  assert.ok(html.includes(`value="${proprietaire.id}" selected`), 'openLeaveRequestModal (Congés/Autres absences) doit préselectionner l\'utilisateur connecté sans presetEmployeeId');

  console.log('OK — preselection-utilisateur-connecte-18-09.test.js (vérifié sur un vrai appelant, openLeaveRequestModal)');
}

async function runChampVerrouilleInchangePourUnRoleLibreServiceSeul() {
  // §non-régression : un rôle qui n'a le droit de saisir QUE pour lui-même (ex. Salarié) affichait
  // déjà un champ verrouillé sur son propre nom, jamais un sélecteur — ce comportement doit rester
  // identique (rien à "présélectionner" dans un champ déjà verrouillé sur soi-même).
  const { DB, employeeRepository, employeeFieldForRequest } = setup();
  const employees = employeeRepository.getAll().filter(e => !e.archive);
  const salarie = employees.find(e => e.role === 'salarie');
  DB._currentEmployeeId = salarie.id;

  const html = employeeFieldForRequest(undefined, employees);
  assert.ok(html.includes('disabled'), 'un salarié en libre-service seul doit toujours voir un champ verrouillé, pas un sélecteur');
  assert.ok(!html.includes('<select'), 'jamais de sélecteur pour ce rôle, comportement inchangé par ce correctif');

  console.log('OK — preselection-utilisateur-connecte-18-09.test.js (non-régression : champ verrouillé inchangé pour un rôle en libre-service seul)');
}

runPreselectionneSansPresetEmployeeId()
  .then(runNeCassePasLaFicheSalarieDUnAutre)
  .then(runValableSurLes4FormulairesAppelants)
  .then(runChampVerrouilleInchangePourUnRoleLibreServiceSeul)
  .catch((err) => {
    console.error('ÉCHEC — preselection-utilisateur-connecte-18-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
