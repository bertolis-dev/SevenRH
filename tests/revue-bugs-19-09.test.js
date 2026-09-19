/**
 * Seven RH — revue de bugs du 19/09/2026 ("règle les bugs", demandée après la journée de travail sur
 * la lettre d'audit) : relecture ciblée du diff du jour (955603e~1..HEAD) pour trouver de vraies
 * régressions/incohérences, pas du style. Trois corrections retenues :
 *
 * 1. "Nouveau contrat" ne validait la date de début que contre dateEmbauche, jamais contre la date de
 *    début du contrat en cours lui-même. DB.addContrat clôture toujours le contrat ouvert à la veille
 *    de la nouvelle date (data.js) : sans ce garde-fou, un utilisateur pouvait saisir une date de
 *    début antérieure au contrat en cours, produisant une plage inversée (dateFin < dateDebut sur ce
 *    contrat) et écrasant silencieusement les champs à plat de l'employé par des valeurs plus
 *    anciennes que celles déjà en place.
 *
 * 2. L'ajout rapide famille 1 (ex. catégories de notes de frais, postes...) posait la nouvelle valeur
 *    sur le <select> sans jamais déclencher d'événement 'change' — contrairement à la famille 2
 *    (applyQuickCreateValue, qui le fait). Un champ dépendant du <select> (ex. mention obligatoire du
 *    justificatif selon la catégorie de frais) restait donc figé sur l'ancienne sélection tant que
 *    l'utilisateur ne retouchait pas manuellement le menu.
 *
 * 3. Le garde-fou anti-soumission-silencieuse du 19/09 (bascule d'onglet si le premier champ requis
 *    invalide est caché) ne regardait que les champs [required] — un champ invalide pour une autre
 *    raison (ex. f-nombreJoursForfait, min=1/max=218, jamais required) resté cassé sur un onglet fermé
 *    reproduisait exactement le même échec silencieux que le correctif prétendait avoir éliminé.
 *    Même angle mort sur le point rouge d'erreur par onglet (updateEmployeeFormTabErrors).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAppJs } = require('./load-app-js');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function setup() {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  const rh = api.DB.getEmployees().find(e => e.role === 'rh');
  api.DB._currentEmployeeId = rh.id;
  return { ...api, rh };
}

async function runNouveauContratRefuseUneDateAnterieureAuContratEnCours() {
  const fnStart = appSource.indexOf('function openNouveauContratModal(');
  const fnEnd = appSource.indexOf('\nfunction ', fnStart + 30);
  const body = appSource.slice(fnStart, fnEnd);

  assert.ok(body.includes('contratsExistants') && body.includes("sort((a, b) => (b.dateDebut || '').localeCompare(a.dateDebut || ''))"),
    'doit retrouver le contrat le plus récent (même tri que openAjouterAvenantModal), pas seulement se fier à dateEmbauche');
  assert.ok(/contratCourant\.dateDebut\s*&&\s*dateDebut\s*<=\s*contratCourant\.dateDebut/.test(body),
    'doit refuser une nouvelle date de début antérieure ou égale à celle du contrat en cours, pour ne jamais produire une plage inversée dans DB.addContrat');

  // Confirme aussi, côté données, que sans ce garde-fou DB.addContrat produirait bien la plage
  // inversée décrite : c'est la preuve que le garde-fou est nécessaire, pas décoratif.
  const { employeeRepository } = setup();
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  employeeRepository.update(salarie.id, { dateEmbauche: '2020-01-01' });
  employeeRepository.ajouterContrat(salarie.id, { dateDebut: '2024-01-01', typeContrat: 'CDI', tempsTravail: 'Temps plein', forfait: 'Aucun', salaireBrutMensuel: 2500 });
  employeeRepository.ajouterContrat(salarie.id, { dateDebut: '2023-06-01', typeContrat: 'CDD', tempsTravail: 'Temps plein', forfait: 'Aucun', salaireBrutMensuel: 2000 });
  const employe = employeeRepository.getById(salarie.id);
  const contratOuvertAvant = employe.contrats[0];
  assert.ok(contratOuvertAvant.dateFin < contratOuvertAvant.dateDebut, 'sans le garde-fou côté UI, DB.addContrat produit bien une plage inversée : la validation doit donc empêcher ce cas en amont');

  console.log('OK — revue-bugs-19-09.test.js ("Nouveau contrat" refuse une date antérieure ou égale au contrat en cours)');
}

async function runAjoutRapideFamille1DeclencheChangeCommeFamille2() {
  const fnStart = appSource.indexOf('function applyQuickAddValue(');
  const fnEnd = appSource.indexOf('\nfunction ', fnStart + 30);
  const body = appSource.slice(fnStart, fnEnd);

  assert.ok(/select\.dispatchEvent\(new Event\('change', \{ ?bubbles: ?true ?\}\)\)/.test(body),
    'applyQuickAddValue (famille 1) doit déclencher un événement change comme applyQuickCreateValue (famille 2), sinon les champs dépendants du <select> restent figés');

  console.log('OK — revue-bugs-19-09.test.js (ajout rapide famille 1 déclenche change, cohérent avec la famille 2)');
}

async function runGardeFouSoumissionCouvreTousLesChampsInvalidesPasSeulementRequired() {
  const bindStart = appSource.indexOf('function bindEmployeeFormTabs()');
  const bindEnd = appSource.indexOf('\nfunction ', bindStart + 30);
  const bindBody = appSource.slice(bindStart, bindEnd);
  const submitClickStart = bindBody.indexOf('if (submitBtn)');
  const submitClickBody = bindBody.slice(submitClickStart);

  assert.ok(!submitClickBody.includes("form.querySelectorAll('[required]')"),
    'le garde-fou de clic sur "Enregistrer" ne doit plus se limiter aux champs [required] : un champ invalide pour une autre raison (min/max, pattern) sur un onglet caché reproduirait le même échec silencieux');
  assert.ok(/Array\.from\(form\.elements\)\.find\(el => el\.willValidate && !el\.checkValidity\(\)\)/.test(submitClickBody),
    'doit détecter le premier champ invalide parmi TOUS les champs du formulaire (willValidate exclut nativement les champs non concernés par la validation)');

  const errStart = appSource.indexOf('function updateEmployeeFormTabErrors()');
  const errEnd = appSource.indexOf('\nfunction ', errStart + 30);
  const errBody = appSource.slice(errStart, errEnd);
  assert.ok(!errBody.includes("panel.querySelectorAll('[required]')"),
    'le point rouge par onglet doit lui aussi couvrir tout champ invalide, pas seulement [required], pour rester cohérent avec le garde-fou de soumission');

  console.log('OK — revue-bugs-19-09.test.js (garde-fou de soumission et point rouge par onglet couvrent tout champ invalide, pas seulement [required])');
}

runNouveauContratRefuseUneDateAnterieureAuContratEnCours()
  .then(runAjoutRapideFamille1DeclencheChangeCommeFamille2)
  .then(runGardeFouSoumissionCouvreTousLesChampsInvalidesPasSeulementRequired)
  .catch((err) => {
    console.error('ÉCHEC — revue-bugs-19-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
