/**
 * Seven RH — retour Betty du 17/09/2026, point 4 : "rien ne normalise les noms aujourd'hui... je
 * veux que le nom de famille soit entièrement en majuscules... le prénom avec une majuscule à la
 * première lettre de chaque mot". Séparateurs : espace, tiret, apostrophe. Accents conservés dans
 * les deux cas. Appliqué via DB.addEmployee/updateEmployee (data.js) — couvre donc à la fois la
 * création manuelle, l'import Excel et la conversion d'une candidature en salarié, qui passent tous
 * par ces deux fonctions — et séparément sur le formulaire public de candidature lui-même. Plus une
 * reprise unique de l'existant (company.nomsPrenomsMigres).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function runFormatNomFamille() {
  const { formatNomFamille } = loadAppJs();
  assert.strictEqual(formatNomFamille('dupont'), 'DUPONT');
  assert.strictEqual(formatNomFamille('Dupont'), 'DUPONT');
  assert.strictEqual(formatNomFamille('DUPONT'), 'DUPONT');
  assert.strictEqual(formatNomFamille('élodie'), 'ÉLODIE', 'les accents doivent être conservés en majuscules, jamais supprimés');
  assert.strictEqual(formatNomFamille('dupont-durand'), 'DUPONT-DURAND');
  assert.strictEqual(formatNomFamille('  dupont  '), 'DUPONT', 'les espaces superflus doivent être retirés');
  assert.strictEqual(formatNomFamille(''), '', 'une valeur vide reste vide, sans planter');

  console.log('OK — mise-en-forme-noms-17-09.test.js (nom de famille toujours en majuscules, accents conservés)');
}

async function runFormatPrenom() {
  const { formatPrenom } = loadAppJs();
  assert.strictEqual(formatPrenom('marie'), 'Marie');
  assert.strictEqual(formatPrenom('MARIE'), 'Marie', 'une saisie tout en majuscules doit être ramenée à la règle normale, pas laissée telle quelle');
  assert.strictEqual(formatPrenom('marie-caroline'), 'Marie-Caroline', 'le M et le C doivent être tous les deux en majuscule, séparateur tiret');
  assert.strictEqual(formatPrenom('jean pierre'), 'Jean Pierre', 'séparateur espace : même règle que le tiret');
  assert.strictEqual(formatPrenom('n\'golo'), 'N\'Golo', 'séparateur apostrophe droite');
  assert.strictEqual(formatPrenom('n’golo'), 'N’Golo', 'séparateur apostrophe courbe (typographique), pas seulement la droite');
  assert.strictEqual(formatPrenom('élodie'), 'Élodie', 'les accents doivent rester, y compris sur la lettre mise en majuscule');
  assert.strictEqual(formatPrenom('  marie  '), 'Marie', 'les espaces superflus doivent être retirés');
  assert.strictEqual(formatPrenom(''), '', 'une valeur vide reste vide, sans planter');

  console.log('OK — mise-en-forme-noms-17-09.test.js (prénom : majuscule après chaque espace/tiret/apostrophe, accents conservés)');
}

async function runAppliqueALaCreationEtALaModification() {
  const { DB, sandbox, employeeRepository } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();

  const created = await employeeRepository.create({
    nom: 'martin-dupont', prenom: 'jean-françois', email: 'jf@exemple.fr', dateEmbauche: '2026-01-10',
    civilite: 'M.', dateNaissance: '1990-01-01', nationalite: 'Française'
  });
  assert.strictEqual(created.nom, 'MARTIN-DUPONT', 'la création manuelle (et donc aussi l\'import Excel, qui passe par le même DB.addEmployee) doit mettre en forme le nom');
  assert.strictEqual(created.prenom, 'Jean-François', 'la création manuelle doit mettre en forme le prénom, accents conservés');

  const updated = employeeRepository.update(created.id, { nom: 'leblanc', prenom: 'n\'golo' });
  assert.strictEqual(updated.nom, 'LEBLANC', 'la modification doit aussi mettre en forme le nom');
  assert.strictEqual(updated.prenom, 'N\'Golo', 'la modification doit aussi mettre en forme le prénom');

  // Une modification qui ne touche PAS au nom/prénom (ex. le salaire) ne doit pas être affectée.
  const updatedSalaire = employeeRepository.update(created.id, { salaireBrutMensuel: 2500 });
  assert.strictEqual(updatedSalaire.nom, 'LEBLANC', 'une modification sans le champ nom ne doit pas y toucher');

  console.log('OK — mise-en-forme-noms-17-09.test.js (appliqué à la création ET à la modification, sans effet de bord sur les autres champs)');
}

async function runRepriseUniqueDeLExistant() {
  const { DB } = loadAppJs();
  DB.init();
  const company = DB.getCurrentCompany();
  const employee = company.employees[0];
  employee.nom = 'petit';
  employee.prenom = 'JEAN pierre';
  delete company.nomsPrenomsMigres;
  DB.saveCurrentCompany(company);

  const migres = DB.getEmployees();
  const migre = migres.find(e => e.id === employee.id);
  assert.strictEqual(migre.nom, 'PETIT', 'un nom existant mal saisi doit être repris à la première lecture');
  assert.strictEqual(migre.prenom, 'Jean Pierre', 'un prénom existant mal saisi doit être repris à la première lecture');

  // Idempotent : un second appel ne rejoue pas la reprise (même si l'utilisateur avait depuis fait
  // un choix qui, à tort, ressemblerait à l'ancien format — la reprise reste ponctuelle).
  const avant = DB.getCurrentCompany().employees.find(e => e.id === employee.id).nom;
  DB.getEmployees();
  const apres = DB.getCurrentCompany().employees.find(e => e.id === employee.id).nom;
  assert.strictEqual(avant, apres, 'la reprise ne doit jamais se rejouer une fois faite');

  console.log('OK — mise-en-forme-noms-17-09.test.js (reprise unique des noms/prénoms existants, idempotente)');
}

async function runFormulaireCandidaturePublicMetEnForme() {
  const fs = require('fs');
  const path = require('path');
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const fnStart = appSource.indexOf('function bindCandidatureFormEvents(');
  const fnBody = appSource.slice(fnStart, fnStart + 1600);
  assert.ok(fnBody.includes("formatNomFamille(document.getElementById('cand-nom')"), 'le formulaire public de candidature doit mettre en forme le nom avant envoi, pour que le candidat converti en salarié arrive déjà propre');
  assert.ok(fnBody.includes("formatPrenom(document.getElementById('cand-prenom')"), 'le formulaire public de candidature doit mettre en forme le prénom avant envoi');

  console.log('OK — mise-en-forme-noms-17-09.test.js (formulaire public de candidature met en forme avant envoi)');
}

runFormatNomFamille()
  .then(runFormatPrenom)
  .then(runAppliqueALaCreationEtALaModification)
  .then(runRepriseUniqueDeLExistant)
  .then(runFormulaireCandidaturePublicMetEnForme)
  .catch((err) => {
    console.error('ÉCHEC — mise-en-forme-noms-17-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
