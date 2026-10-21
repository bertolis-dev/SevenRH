/**
 * Seven RH — retour du 21/10/2026 : « un module Info retraite, avec les informations liées à l'activité du salarié dans l'entreprise et,
 * si possible, l'historique de carrière complet ». Écran « Ma retraite » : carrière dans l'entreprise (d'après les contrats), périodes
 * hors entreprise saisies par le salarié, âge légal de départ indicatif d'après sa génération, liens officiels. Nexus n'est PAS la caisse
 * de retraite : aucun calcul de pension ni de trimestres validés (ils dépendent des salaires), seulement des repères et un renvoi vers
 * les services officiels.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function setup() {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  return api;
}

function run() {
  const api = setup();
  const { DB, sandbox } = api;

  // âge légal indicatif par génération (réforme de 2023), « à valider » dans docs/regles-a-valider.md
  const age = (iso) => { const r = sandbox.ageLegalDepartRetraite(iso); return r && [r.annees, r.mois]; };
  assert.deepStrictEqual(age('1958-05-10'), [62, 0], 'avant septembre 1961 : 62 ans');
  assert.deepStrictEqual(age('1961-10-02'), [62, 3], 'septembre à décembre 1961 : 62 ans 3 mois');
  assert.deepStrictEqual(age('1962-03-01'), [62, 6]);
  assert.deepStrictEqual(age('1963-12-31'), [62, 9]);
  assert.deepStrictEqual(age('1964-01-01'), [63, 0]);
  assert.deepStrictEqual(age('1967-07-14'), [63, 9]);
  assert.deepStrictEqual(age('1968-01-01'), [64, 0], '1968 et après : 64 ans');
  assert.deepStrictEqual(age('1990-06-15'), [64, 0]);
  assert.strictEqual(sandbox.ageLegalDepartRetraite(''), null, 'sans date de naissance : rien');
  assert.strictEqual(sandbox.ageLegalDepartRetraite('pas une date'), null);
  assert.strictEqual(sandbox.ageLegalDepartRetraite('1990-06-15').trimestres, 172, 'durée d\'assurance requise : 172 trimestres pour les plus jeunes générations');
  const dateDepart = sandbox.ageLegalDepartRetraite('1990-06-15').date;
  assert.strictEqual(dateDepart, '2054-06-15', 'date : 64 ans après la naissance');
  assert.strictEqual(sandbox.ageLegalDepartRetraite('1961-10-02').date, '2024-01-02', '62 ans 3 mois après le 02/10/1961');

  // carrière : périodes qui se chevauchent comptées une seule fois, hors entreprise ajoutée
  const resume = sandbox.resumerCarriere({
    dateEmbauche: '2020-01-01', dateDepart: '',
    contrats: [
      { id: 'c1', dateDebut: '2020-01-01', dateFin: '2021-12-31', typeContrat: 'CDD' },
      { id: 'c2', dateDebut: '2021-07-01', dateFin: '', typeContrat: 'CDI' }
    ],
    carriereExterne: [{ id: 'x1', employeur: 'Ancienne société', dateDebut: '2015-09-01', dateFin: '2019-08-31', commentaire: '' }]
  }, new Date(2026, 0, 1));
  assert.ok(Math.abs(resume.dansEntreprise.mois - 72) <= 1, 'janvier 2020 à janvier 2026 : environ 72 mois, sans double compte du chevauchement');
  assert.ok(Math.abs(resume.horsEntreprise.mois - 48) <= 1, 'quatre ans hors entreprise');
  assert.strictEqual(resume.totalMois, resume.dansEntreprise.mois + resume.horsEntreprise.mois);
  assert.ok(resume.maxTrimestres >= 40 && resume.maxTrimestres <= 41, '4 trimestres par an au plus : 10 ans, environ 40');
  assert.strictEqual(sandbox.resumerCarriere({}, new Date()).totalMois, 0, 'fiche vide : zéro, pas d\'erreur');

  // saisie d'une période hors entreprise : contrôlée
  const bon = sandbox.validerPeriodeCarriere({ employeur: '  Société X ', dateDebut: '2010-01-01', dateFin: '2012-12-31', commentaire: 'CDI' }, new Date(2026, 9, 21));
  assert.strictEqual(bon.ok, true, bon.error);
  assert.strictEqual(bon.periode.employeur, 'Société X');
  assert.ok(bon.periode.id);
  const refus = (p, motif) => assert.strictEqual(sandbox.validerPeriodeCarriere(p, new Date(2026, 9, 21)).ok, false, motif);
  refus({ employeur: '', dateDebut: '2010-01-01', dateFin: '2011-01-01' }, 'employeur obligatoire');
  refus({ employeur: 'X', dateDebut: '2011-01-01', dateFin: '2010-01-01' }, 'fin avant début');
  refus({ employeur: 'X', dateDebut: '2010-01-01', dateFin: '2030-01-01' }, 'fin dans le futur');
  refus({ employeur: 'X', dateDebut: '2010-02-30', dateFin: '2011-01-01' }, 'date impossible');
  refus({ employeur: 'X', dateDebut: '', dateFin: '2011-01-01' }, 'début obligatoire');

  // enregistrement par le salarié lui-même, sans passer par une modification générique de sa fiche
  const salarie = DB.getEmployees().find(e => e.role === 'salarie');
  DB._currentEmployeeId = salarie.id;
  const ajout = api.employeeRepository.majMaCarriere(salarie.id, [bon.periode]);
  assert.strictEqual(ajout.success, true);
  assert.strictEqual(DB.getEmployeeById(salarie.id).carriereExterne.length, 1);
  assert.strictEqual(api.employeeRepository.majMaCarriere(salarie.id, 'n importe quoi').success, false, 'liste invalide refusée');
  DB._currentEmployeeId = DB.getEmployees().find(e => e.role === 'manager').id;
  assert.strictEqual(api.employeeRepository.majMaCarriere(salarie.id, []).success, false, 'personne d\'autre ne modifie la carrière d\'un salarié par ce chemin');

  // écran
  DB._currentEmployeeId = salarie.id;
  const html = sandbox.renderRetraite();
  assert.ok(/Ma retraite/.test(html));
  assert.ok(/info-retraite\.fr/.test(html) && /lassuranceretraite\.fr/.test(html), 'liens officiels');
  assert.ok(/rel="noopener noreferrer"/.test(html) && /target="_blank"/.test(html), 'liens externes sûrs');
  assert.ok(/relevé de carrière/i.test(html), 'renvoi vers le relevé officiel');
  assert.ok(/Société X/.test(html), 'la période hors entreprise saisie apparaît');
  assert.ok(/id="retraite-periode-form"/.test(html), 'formulaire d\'ajout');
  assert.ok(/pas la caisse de retraite|ne remplace pas/i.test(html), 'avertissement : indicatif, ne remplace pas les caisses');
  assert.ok(!html.includes('undefined') && !html.includes('NaN'));
  const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8');
  assert.ok(source.split(String.fromCharCode(10)).some(l => /key: 'retraite'/.test(l) && /label:/.test(l)), 'entrée de menu');
  console.log('OK — info-retraite-21-10.test.js (âge légal par génération, carrière sans double compte, saisie contrôlée et réservée au salarié, liens officiels)');
}

try { run(); } catch (err) { console.error('ÉCHEC — info-retraite-21-10.test.js'); console.error(err.stack || err.message); process.exitCode = 1; }
