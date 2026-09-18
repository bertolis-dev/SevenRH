/**
 * Seven RH — retour Betty du 18/09/2026, point 5 ("sexe et civilité") : jusqu'ici, civilite ('M.' ou
 * 'Mme', forcée à 'M.' par défaut à la création) faisait à la fois office de civilité de politesse
 * ET de seule mention de sexe disponible pour le registre unique du personnel — deux besoins
 * différents mélangés dans un seul champ mal défaulté. Séparé en deux :
 *   - sexe (état civil) : binaire (Homme/Femme), obligatoire, alimente registre/DSN/index égalité
 *     (getSexe, data.js) ;
 *   - civilite (civilité D'USAGE) : Madame/Monsieur/ne pas accorder, optionnelle, jamais de défaut
 *     forcé, déduite du sexe seulement à l'affichage si jamais choisie (getCiviliteAffichee).
 * Une reprise serveur (ensureCiviliteSexeMigresVersServeur) amorce sexe depuis l'ancien civilite
 * ('M.'/'Mme', qui servait déjà de facto de mention de sexe) pour qu'un salarié déjà existant ne
 * perde pas sa mention de sexe sur le registre du jour au lendemain.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function runGetSexeBinaireAvecRepliSurAncienGenre() {
  const { getSexe } = loadAppJs();
  assert.strictEqual(getSexe({ sexe: 'Homme' }), 'Homme', 'le nouveau champ sexe doit être lu en priorité');
  assert.strictEqual(getSexe({ sexe: 'Femme' }), 'Femme');
  assert.strictEqual(getSexe({ genre: 'Homme' }), 'Homme', 'à défaut de sexe, l\'ancien champ genre doit encore être lu (fiche créée avant ce champ)');
  assert.strictEqual(getSexe({ genre: 'Autre' }), '', '"Autre" (ancienne valeur, plus proposée à la saisie) ne doit jamais être renvoyé comme un sexe valide : binaire uniquement');
  assert.strictEqual(getSexe({}), '', 'aucune valeur ne doit jamais planter, une fiche sans rien renseigné renvoie une chaîne vide');
  assert.strictEqual(getSexe({ sexe: 'Homme', genre: 'Femme' }), 'Homme', 'le nouveau champ prime toujours sur l\'ancien s\'ils sont incohérents');

  console.log('OK — sexe-civilite-18-09.test.js (getSexe : binaire, repli sur l\'ancien champ genre)');
}

async function runGetCiviliteAfficheeDeduiteOuExplicite() {
  const { getCiviliteAffichee } = loadAppJs();
  assert.strictEqual(getCiviliteAffichee({ civilite: 'Madame' }), 'Madame', 'un choix explicite doit être respecté tel quel');
  assert.strictEqual(getCiviliteAffichee({ civilite: 'Monsieur' }), 'Monsieur');
  assert.strictEqual(getCiviliteAffichee({ civilite: 'ne_pas_accorder', sexe: 'Homme' }), '', '"ne pas accorder" doit rester vide même si le sexe est connu : c\'est un choix explicite, jamais contourné');
  assert.strictEqual(getCiviliteAffichee({ sexe: 'Homme' }), 'Monsieur', 'sans choix explicite, la civilité doit être déduite du sexe à l\'état civil');
  assert.strictEqual(getCiviliteAffichee({ sexe: 'Femme' }), 'Madame');
  assert.strictEqual(getCiviliteAffichee({}), '', 'ni civilité ni sexe renseignés : aucune civilité inventée, jamais "M." par défaut (l\'ancien comportement)');

  console.log('OK — sexe-civilite-18-09.test.js (getCiviliteAffichee : choix explicite respecté, déduction seulement en son absence, jamais de défaut forcé)');
}

async function runNouvelleFicheSansDefautForce() {
  const { makeEmptyEmployee } = loadAppJs();
  const vide = makeEmptyEmployee();
  assert.strictEqual(vide.civilite, '', 'une nouvelle fiche ne doit plus jamais démarrer sur "M." (ancien défaut forcé, explicitement à corriger)');
  assert.strictEqual(vide.sexe, '', 'le sexe ne doit jamais être présumé, seulement choisi');
  assert.strictEqual(vide.nomUsage, '', 'le nom d\'usage (nouveau champ) doit exister, vide par défaut');

  console.log('OK — sexe-civilite-18-09.test.js (nouvelle fiche : plus aucun défaut forcé sur civilité, nom d\'usage présent)');
}

async function runReglageDejaBonSurUneFicheExistanteNestJamaisModifie() {
  const { ensureCiviliteSexeMigresVersServeur, DB, sandbox } = loadAppJs();
  sandbox.window.SupabaseSync = { pushEmployees: async () => { throw new Error('ne doit jamais être appelé : rien à corriger'); } };
  const rh = { id: 'rh1', role: 'rh' };
  const employeeDejaAJour = { id: 'e1', role: 'salarie', civilite: 'Madame', sexe: 'Femme' };
  const company = { id: 'c1', employees: [employeeDejaAJour, rh] };

  await ensureCiviliteSexeMigresVersServeur(company, rh);
  assert.strictEqual(employeeDejaAJour.civilite, 'Madame', 'une fiche déjà au nouveau format ne doit jamais être retouchée');

  console.log('OK — sexe-civilite-18-09.test.js (reprise : rien à faire, rien de retouché sur une fiche déjà à jour)');
}

async function runRepriseAmorceLeSexeDepuisLancienneCivilite() {
  const { sandbox, ensureCiviliteSexeMigresVersServeur } = loadAppJs();
  const rh = { id: 'rh1', role: 'rh' };
  const employeeM = { id: 'e1', role: 'salarie', civilite: 'M.', sexe: '' };
  const employeeMme = { id: 'e2', role: 'salarie', civilite: 'Mme', sexe: '' };
  const company = { id: 'c1', employees: [employeeM, employeeMme, rh] };

  const pushed = [];
  sandbox.window.SupabaseSync = { pushEmployees: async (payload) => { pushed.push(payload); } };
  await ensureCiviliteSexeMigresVersServeur(company, rh);

  assert.strictEqual(employeeM.sexe, 'Homme', '"M." doit amorcer sexe à "Homme" pour une fiche qui ne l\'a pas encore');
  assert.strictEqual(employeeM.civilite, 'Monsieur', 'civilite doit aussi migrer vers le nouveau format ("Monsieur"), pour ne pas rester sur une valeur qui n\'existe plus dans le sélecteur');
  assert.strictEqual(employeeMme.sexe, 'Femme', '"Mme" doit amorcer sexe à "Femme"');
  assert.strictEqual(employeeMme.civilite, 'Madame');
  assert.ok(pushed.length >= 1, 'la reprise doit réellement pousser les changements à Supabase, jamais rester seulement locale (retour Betty du 18/09/2026 sur les précédentes reprises)');

  console.log('OK — sexe-civilite-18-09.test.js (reprise : amorce sexe depuis l\'ancienne civilité, migre le format, envoyée réellement à Supabase)');
}

async function runFicheModaleAffichesLesTroisChamps() {
  const { DB, sandbox, openEmployeeModal } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;

  openEmployeeModal();
  const html = sandbox.document.getElementById('modal-root').innerHTML;
  assert.ok(html.includes('id="f-sexe"') && html.includes('required'), 'le champ sexe doit exister et être obligatoire');
  assert.ok(html.includes('value="Madame"') && html.includes('value="Monsieur"') && html.includes('value="ne_pas_accorder"'), 'les 3 valeurs de civilité d\'usage doivent être proposées');
  assert.ok(html.includes('id="f-nomUsage"'), 'le champ "nom d\'usage" (manquant jusqu\'ici) doit exister');
  assert.ok(!html.includes('value="M."') && !html.includes('>Mme<'), 'les anciennes valeurs "M."/"Mme" ne doivent plus être proposées à la saisie');

  console.log('OK — sexe-civilite-18-09.test.js (modale fiche salarié : sexe obligatoire, civilité à 3 choix, nom d\'usage présent)');
}

async function runDocumentsLegauxUtilisentLaCiviliteAffichee() {
  const fs = require('fs');
  const path = require('path');
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

  // Les 4 documents légaux cités par Betty : attestation employeur, certificat de travail et
  // registre (deux versions, modale + écran Paramètres) ne doivent plus jamais lire employee.civilite
  // directement (qui peut désormais valoir 'ne_pas_accorder', un mot-clé interne à ne jamais imprimer).
  assert.ok(!/escapeHtml\(e\.civilite\)/.test(appSource), 'aucun document ne doit plus imprimer employee.civilite brute (getCiviliteAffichee/getSexe uniquement)');

  console.log('OK — sexe-civilite-18-09.test.js (documents légaux : plus aucune lecture brute d\'employee.civilite)');
}

runGetSexeBinaireAvecRepliSurAncienGenre()
  .then(runGetCiviliteAfficheeDeduiteOuExplicite)
  .then(runNouvelleFicheSansDefautForce)
  .then(runReglageDejaBonSurUneFicheExistanteNestJamaisModifie)
  .then(runRepriseAmorceLeSexeDepuisLancienneCivilite)
  .then(runFicheModaleAffichesLesTroisChamps)
  .then(runDocumentsLegauxUtilisentLaCiviliteAffichee)
  .catch((err) => {
    console.error('ÉCHEC — sexe-civilite-18-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
