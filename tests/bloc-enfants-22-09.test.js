/**
 * Seven RH — retour Betty du 22/09/2026 (Partie 3, point 3.2, "bloc Enfants") :
 *   - le congé "Enfant malade" (3 jours) doit passer à 5 jours si un enfant a moins d'1 an, ou si
 *     le salarié a au moins 3 enfants de moins de 16 ans (Art. L1225-61) — jusqu'ici documenté
 *     comme non automatisé faute de données sur les enfants (voir seedLeaveTypes) ;
 *   - employee.enfants ([{ id, prenom, dateNaissance }], minimisation des données) rend ce calcul
 *     possible, RECALCULÉ CHAQUE ANNÉE depuis l'âge réel (jamais figé une fois attribué) ;
 *   - le bloc "Enfants" de la fiche salarié est aussi restreint que le Confidentiel (salaire).
 */
const assert = require('assert');
const { loadDataJs } = require('./load-data-js');
const { loadAppJs } = require('./load-app-js');

function runAucunBonusSansEnfant() {
  const { getEnfantMaladeBonus } = loadDataJs();
  const leaveType = { nom: 'Enfant malade' };
  assert.strictEqual(getEnfantMaladeBonus({ enfants: [] }, leaveType, new Date('2026-06-15')), 0, 'sans enfant renseigné, aucun bonus');
  assert.strictEqual(getEnfantMaladeBonus({}, leaveType, new Date('2026-06-15')), 0, 'employee.enfants absent : jamais un plantage, aucun bonus');

  console.log('OK — bloc-enfants-22-09.test.js (aucun bonus sans enfant renseigné)');
}

function runBonusSiUnEnfantMoinsDunAn() {
  const { getEnfantMaladeBonus } = loadDataJs();
  const leaveType = { nom: 'Enfant malade' };
  const employee = { enfants: [{ id: '1', prenom: 'Léo', dateNaissance: '2026-01-01' }] };
  assert.strictEqual(getEnfantMaladeBonus(employee, leaveType, new Date('2026-06-15')), 2, 'un enfant de moins d\'un an doit déclencher le bonus (+2 jours, 3 -> 5)');
  assert.strictEqual(getEnfantMaladeBonus(employee, leaveType, new Date('2027-06-15')), 0, 'le même enfant, une fois son 1er anniversaire dépassé, ne doit plus déclencher le bonus (recalcul, jamais figé)');

  console.log('OK — bloc-enfants-22-09.test.js (bonus si un enfant a moins d\'un an, reperdu ensuite)');
}

function runBonusSiTroisEnfantsMoinsDe16Ans() {
  const { getEnfantMaladeBonus } = loadDataJs();
  const leaveType = { nom: 'Enfant malade' };
  const troisEnfants = {
    enfants: [
      { id: '1', prenom: 'A', dateNaissance: '2015-01-01' },
      { id: '2', prenom: 'B', dateNaissance: '2016-01-01' },
      { id: '3', prenom: 'C', dateNaissance: '2017-01-01' }
    ]
  };
  assert.strictEqual(getEnfantMaladeBonus(troisEnfants, leaveType, new Date('2026-06-15')), 2, 'au moins 3 enfants de moins de 16 ans doit déclencher le bonus');

  const deuxEnfantsSeulement = { enfants: troisEnfants.enfants.slice(0, 2) };
  assert.strictEqual(getEnfantMaladeBonus(deuxEnfantsSeulement, leaveType, new Date('2026-06-15')), 0, 'seulement 2 enfants de moins de 16 ans : pas de bonus');

  // Le plus âgé des 3 dépasse 16 ans : ne doit plus compter, le bonus doit disparaître (recalcul
  // annuel, jamais figé une fois attribué).
  assert.strictEqual(getEnfantMaladeBonus(troisEnfants, leaveType, new Date('2033-06-15')), 0, 'une fois qu\'un des 3 enfants dépasse 16 ans, le bonus doit disparaître l\'année suivante');

  console.log('OK — bloc-enfants-22-09.test.js (bonus si au moins 3 enfants de moins de 16 ans, reperdu ensuite)');
}

function runBonusReserveAuTypeEnfantMalade() {
  const { getEnfantMaladeBonus } = loadDataJs();
  const employee = { enfants: [{ id: '1', prenom: 'Léo', dateNaissance: '2026-01-01' }] };
  assert.strictEqual(getEnfantMaladeBonus(employee, { nom: 'Congés payés' }, new Date('2026-06-15')), 0, 'le bonus ne doit jamais s\'appliquer à un autre type de congé, même nommé différemment');

  console.log('OK — bloc-enfants-22-09.test.js (bonus réservé au type "Enfant malade")');
}

function runCalculateAcquisitionRefleteLeBonusDeBoutEnBout() {
  const { calculateAcquisition } = loadDataJs();
  const leaveType = { nom: 'Enfant malade', nombreAnnuel: 3, natureAcquisition: 'ouverte', paliersAnciennete: null, acquisition: 'Annuelle' };
  const employeeSansEnfant = { dateEmbauche: '2020-01-01', enfants: [] };
  const employeeAvecBebe = { dateEmbauche: '2020-01-01', enfants: [{ id: '1', prenom: 'Léo', dateNaissance: '2026-01-01' }] };

  // §refDate en chaîne ISO, jamais un objet Date construit ici : calculateAcquisition (data.js)
  // délègue à toRefDate/parseISODateLocal, qui vérifient `instanceof Date` — un Date construit dans
  // CE module Node n'est jamais instanceof le Date du contexte vm isolé de loadDataJs (chaque
  // vm.createContext reçoit ses propres globaux), une chaîne traverse la frontière sans ce piège.
  const sansBonus = calculateAcquisition(employeeSansEnfant, leaveType, '2026-06-15');
  const avecBonus = calculateAcquisition(employeeAvecBebe, leaveType, '2026-06-15');
  assert.strictEqual(sansBonus, 3, 'sans enfant, le compteur "Enfant malade" doit rester à 3 jours');
  assert.strictEqual(avecBonus, 5, 'avec un enfant de moins d\'un an, le compteur "Enfant malade" doit passer à 5 jours (calcul de bout en bout, pas seulement la fonction de bonus isolée)');

  console.log('OK — bloc-enfants-22-09.test.js (calculateAcquisition reflète le bonus de bout en bout : 3 -> 5 jours)');
}

function runBlocEnfantsAussiRestreintQueLeConfidentiel() {
  const { DB, sandbox, renderEnfantsCard, employeeRepository } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const salarieInitial = employeeRepository.getAll().find(e => e.role === 'salarie');
  employeeRepository.update(salarieInitial.id, { enfants: [{ id: '1', prenom: 'Léo', dateNaissance: '2020-01-01' }] });
  // employeeRepository.update ne mute pas l'objet déjà en main : on relit la fiche à jour, sinon
  // enfants resterait [] sur cette référence périmée.
  const salarie = employeeRepository.getById(salarieInitial.id);

  const manager = DB.getEmployees().find(e => e.role === 'manager');
  const htmlManagerSurAutrui = renderEnfantsCard(salarie, manager);
  assert.strictEqual(htmlManagerSurAutrui, '', 'un manager sans VOIR_INFOS_FINANCIERES ne doit pas voir le bloc Enfants d\'un autre salarié, comme pour le Confidentiel');

  const htmlSurSoiMeme = renderEnfantsCard(salarie, salarie);
  assert.ok(htmlSurSoiMeme.includes('Léo'), 'le salarié doit voir SES PROPRES enfants, même sans VOIR_INFOS_FINANCIERES (exception "soi-même", comme le Confidentiel)');

  // §RH n'a PAS VOIR_INFOS_FINANCIERES par défaut (voir DEFAULT_ROLE_PERMISSIONS, data.js) — seul
  // Propriétaire l'a de base, exactement comme pour la carte Confidentiel (salaire) qu'elle reprend.
  const proprietaire = DB.getEmployees().find(e => e.role === 'proprietaire');
  const htmlProprietaireSurAutrui = renderEnfantsCard(salarie, proprietaire);
  assert.ok(htmlProprietaireSurAutrui.includes('Léo'), 'un Propriétaire (VOIR_INFOS_FINANCIERES) doit voir le bloc Enfants de n\'importe quel salarié');

  console.log('OK — bloc-enfants-22-09.test.js (bloc Enfants aussi restreint que le Confidentiel)');
}

/** §note : addEventListener/querySelectorAll sont des no-op dans ce bac à sable (voir le commentaire
 * de load-app-js.js) — un clic/submit réel n'est pas simulable ici. openEnfantModal/deleteEnfant
 * sont donc vérifiées côté RENDU (bon formulaire, bonne prévisualisation, bon message de
 * confirmation), et la mutation réelle des données via employeeRepository.update directement —
 * exactement l'opération que le handler de soumission effectue une fois câblé dans un vrai
 * navigateur, même principe que les autres tests de modales de ce projet. */
function runFormulaireEtSuppressionDunEnfant() {
  const { DB, sandbox, openEnfantModal, deleteEnfant, employeeRepository } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');

  openEnfantModal(salarie.id);
  let modalHtml = sandbox.document.getElementById('modal-root').innerHTML;
  assert.ok(modalHtml.includes('>Ajouter un enfant<'), 'sans enfant existant, la modale doit proposer d\'en ajouter un');
  assert.ok(modalHtml.includes('id="f-enfant-prenom"') && modalHtml.includes('id="f-enfant-date-naissance"'), 'le formulaire doit se limiter au prénom et à la date de naissance (minimisation des données)');

  employeeRepository.update(salarie.id, { enfants: [{ id: 'enf1', prenom: 'Léo', dateNaissance: '2026-01-01' }] });

  openEnfantModal(salarie.id, 'enf1');
  modalHtml = sandbox.document.getElementById('modal-root').innerHTML;
  assert.ok(modalHtml.includes('>Modifier un enfant<'), 'avec un enfantId existant, la modale doit proposer de le modifier');
  assert.ok(modalHtml.includes('value="Léo"') && modalHtml.includes('value="2026-01-01"'), 'le formulaire de modification doit être prérempli avec les valeurs existantes');

  deleteEnfant(salarie.id, 'enf1');
  const confirmHtml = sandbox.document.getElementById('modal-root').innerHTML;
  assert.ok(confirmHtml.includes('Léo'), 'la confirmation de suppression doit nommer l\'enfant concerné');

  employeeRepository.update(salarie.id, { enfants: [] });
  const current = employeeRepository.getById(salarie.id);
  assert.strictEqual(current.enfants.length, 0, 'la suppression effective (via employeeRepository.update, exécutée par onConfirm une fois câblé) retire bien l\'enfant de la fiche');

  console.log('OK — bloc-enfants-22-09.test.js (formulaire d\'ajout/modification limité au strict nécessaire, confirmation de suppression nominative)');
}

try {
  runAucunBonusSansEnfant();
  runBonusSiUnEnfantMoinsDunAn();
  runBonusSiTroisEnfantsMoinsDe16Ans();
  runBonusReserveAuTypeEnfantMalade();
  runCalculateAcquisitionRefleteLeBonusDeBoutEnBout();
  runBlocEnfantsAussiRestreintQueLeConfidentiel();
  runFormulaireEtSuppressionDunEnfant();
} catch (err) {
  console.error('ÉCHEC — bloc-enfants-22-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
