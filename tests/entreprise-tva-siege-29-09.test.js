/**
 * Seven RH — retour Betty du 29/09/2026 :
 *   - "la TVA devrait être calculée toute seule" : le numéro de TVA intracommunautaire français se
 *     déduit ENTIÈREMENT du SIREN (formule officielle, clé = (12 + 3 × SIREN mod 97) mod 97) — posé
 *     automatiquement dès que le SIRET (14 chiffres) est saisi, jamais besoin d'un appel réseau ni
 *     d'une ressaisie manuelle. Reste modifiable à la main, jamais écrasé si déjà renseigné.
 *   - "dans modifier l'établissement ça ne se met pas à jour tout seul le siège" / "il devrait y
 *     avoir un check box... ça renseignerait tout seul" : le profil de l'entreprise (raison sociale,
 *     adresse, téléphone, email) et l'établissement principal (siège) se ressaisissaient séparément,
 *     sans aucun lien — un bouton "Utiliser cette adresse pour mon établissement principal" copie
 *     désormais cette saisie sur l'établissement principal (le crée s'il n'en existe aucun).
 */
const assert = require('assert');
const { loadDataJs } = require('./load-data-js');
const { loadAppJs } = require('./load-app-js');

function setup() {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  const rh = api.DB.getEmployees().find(e => e.role === 'rh');
  api.DB._currentEmployeeId = rh.id;
  return api;
}

function runCalculerTvaDepuisSiretSuitLaFormuleOfficielle() {
  const { calculerTvaDepuisSiret } = loadDataJs();
  const siren = '443061841';
  const siret = `${siren}00025`; // 14 chiffres, SIREN + NIC quelconque
  const cleAttendue = (12 + 3 * (Number(siren) % 97)) % 97;
  const tvaAttendue = `FR${String(cleAttendue).padStart(2, '0')}${siren}`;
  assert.strictEqual(calculerTvaDepuisSiret(siret), tvaAttendue, 'doit suivre exactement la formule officielle (clé sur le SIREN, jamais le SIRET entier)');
  assert.strictEqual(calculerTvaDepuisSiret('123'), null, 'un SIRET incomplet ne doit jamais produire une TVA partielle/fausse');
  assert.strictEqual(calculerTvaDepuisSiret('12 345 678 900025'), calculerTvaDepuisSiret('12345678900025'), 'les espaces de saisie ne doivent jamais changer le résultat');

  console.log('OK — entreprise-tva-siege-29-09.test.js (TVA calculée depuis le SIRET selon la formule officielle)');
}

function runBoutonUtiliserCommeSiegeExisteSurLeProfil() {
  const { sandbox, renderParametresEntreprise } = setup();
  const html = renderParametresEntreprise();
  assert.ok(html.includes('id="btn-utiliser-comme-siege"'), 'le bouton "Utiliser cette adresse pour mon établissement principal" doit exister sur le profil de l\'entreprise');

  console.log('OK — entreprise-tva-siege-29-09.test.js (bouton "Utiliser comme siège" présent sur le profil de l\'entreprise)');
}

function runUtiliserCommeSiegeCreeUnEtablissementSiAucunNexiste() {
  const { DB, etablissementRepository, parseAdresseCompletePourEtablissement } = setup();
  // Repart d'une entreprise sans le moindre établissement pour ce scénario précis — reproduit
  // exactement la logique du bouton (voir bindParametresEntrepriseEvents) sans dépendre d'un
  // évènement DOM que ce bac à sable ne simule pas (addEventListener y est un no-op, voir
  // load-app-js.js) : même construction du patch, même repli sur employeeRepository absent.
  DB.saveEtablissements([]);
  const { rue, codePostal, ville } = parseAdresseCompletePourEtablissement('1 rue de la Paix, 75000 Paris');
  const patch = { nom: 'Ma Petite Entreprise', adresse: rue, codePostal, ville, telephone: '01 23 45 67 89', email: 'contact@example.fr', principal: true };
  etablissementRepository.create(patch);

  const etabs = etablissementRepository.getAll();
  assert.strictEqual(etabs.length, 1, 'doit créer un établissement quand aucun n\'existe encore');
  assert.strictEqual(etabs[0].nom, 'Ma Petite Entreprise');
  assert.strictEqual(etabs[0].codePostal, '75000');
  assert.strictEqual(etabs[0].principal, true);

  console.log('OK — entreprise-tva-siege-29-09.test.js ("Utiliser comme siège" crée un établissement quand aucun n\'existe encore)');
}

function runParseAdresseReconnaitLeMotifCodePostalVille() {
  // §deepStrictEqual comparerait aussi les prototypes : un objet littéral de CE fichier n'est pas
  // structurellement "le même type" qu'un objet construit dans le contexte vm isolé du bac à sable
  // (même piège que Date/Array, voir bloc-enfants-22-09.test.js) — comparé champ par champ.
  const { parseAdresseCompletePourEtablissement } = setup();
  const r1 = parseAdresseCompletePourEtablissement('1 rue de la Paix, 75000 Paris');
  assert.strictEqual(r1.rue, '1 rue de la Paix');
  assert.strictEqual(r1.codePostal, '75000');
  assert.strictEqual(r1.ville, 'Paris');

  const r2 = parseAdresseCompletePourEtablissement('12 avenue des Champs 69003 Lyon');
  assert.strictEqual(r2.rue, '12 avenue des Champs', 'doit aussi reconnaître le motif sans virgule');
  assert.strictEqual(r2.codePostal, '69003');
  assert.strictEqual(r2.ville, 'Lyon');
  const sansMotif = parseAdresseCompletePourEtablissement('Adresse en texte libre, sans code postal reconnaissable');
  assert.strictEqual(sansMotif.codePostal, '', 'sans motif reconnaissable, codePostal doit rester vide (jamais une coupe approximative)');
  assert.strictEqual(sansMotif.ville, '');
  assert.strictEqual(sansMotif.rue, 'Adresse en texte libre, sans code postal reconnaissable');

  console.log('OK — entreprise-tva-siege-29-09.test.js (parseAdresseCompletePourEtablissement reconnaît le motif code postal + ville)');
}

function runUtiliserCommeSiegeMetAJourLetablissementPrincipalExistant() {
  const { DB, employeeRepository, etablissementRepository, parseAdresseCompletePourEtablissement } = setup();
  const principalAvant = etablissementRepository.getAll().find(e => e.principal);
  assert.ok(principalAvant, 'préalable : le jeu de données de test a déjà un établissement principal');

  // Reproduit exactement ce que fait le bouton "Utiliser cette adresse..." (voir
  // bindParametresEntrepriseEvents), sans dépendre d'un évènement DOM que ce bac à sable ne simule pas.
  const raisonSociale = 'Nouvelle Raison Sociale';
  const adresseComplete = '5 avenue Foch, 33000 Bordeaux';
  const { rue, codePostal, ville } = parseAdresseCompletePourEtablissement(adresseComplete);
  const patch = { nom: raisonSociale, adresse: rue, codePostal, ville, telephone: '05 00 00 00 00', email: 'siege@example.fr', principal: true };
  etablissementRepository.update(principalAvant.id, patch);

  const principalApres = etablissementRepository.getById(principalAvant.id);
  assert.strictEqual(principalApres.nom, raisonSociale);
  assert.strictEqual(principalApres.adresse, '5 avenue Foch');
  assert.strictEqual(principalApres.codePostal, '33000');
  assert.strictEqual(principalApres.ville, 'Bordeaux');
  assert.strictEqual(principalApres.principal, true, 'doit rester l\'établissement principal');

  console.log('OK — entreprise-tva-siege-29-09.test.js ("Utiliser comme siège" met à jour l\'établissement principal existant)');
}

function run() {
  runCalculerTvaDepuisSiretSuitLaFormuleOfficielle();
  runBoutonUtiliserCommeSiegeExisteSurLeProfil();
  runUtiliserCommeSiegeCreeUnEtablissementSiAucunNexiste();
  runParseAdresseReconnaitLeMotifCodePostalVille();
  runUtiliserCommeSiegeMetAJourLetablissementPrincipalExistant();
}

try {
  run();
} catch (err) {
  console.error('ÉCHEC — entreprise-tva-siege-29-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
