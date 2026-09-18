/**
 * Seven RH — retour Betty du 18/09/2026, point 4 ("convention collective automatique"), traité en
 * dernier comme convenu (elle m'a explicitement demandé de vérifier moi-même les deux API
 * candidates avant de choisir). Vérifié dans le navigateur avec plusieurs SIRET réels, dont
 * Sopra Steria (IDCC 1486, Syntec confirmé) :
 *   - recherche-entreprises.api.gouv.fr (déjà utilisée pour la raison sociale/l'adresse) ne renvoie
 *     qu'un code IDCC brut, avec un sentinelle "9999" ("aucune convention déterminée") à gérer soi-même ;
 *   - api.recherche-entreprises.fabrique.social.gouv.fr (retenue) renvoie directement le libellé
 *     OFFICIEL et un lien Légifrance pointant sur LE TEXTE PRÉCIS de la convention (identifiant
 *     Légifrance opaque, impossible à reconstruire à partir du seul IDCC), un tableau vide et
 *     jamais un sentinelle quand aucune convention n'est déterminée. Les deux sont gratuites, sans
 *     clé, avec CORS ouvert depuis nexus-rh.com (vérifié en direct).
 * Jamais appliquée automatiquement : seulement proposée, avec confirmation explicite (voir
 * renderParametresEntreprise, #convention-suggestion).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function runFetchRenvoieLeLibelleEtLeLienLegifrance() {
  const { sandbox, fetchConventionCollectiveFromSiret } = loadAppJs();
  sandbox.window.fetch = async (url) => {
    assert.ok(url.includes('32682006500083'), 'doit interroger avec le bon SIRET');
    return {
      ok: true,
      json: async () => ({
        conventions: [{
          idcc: 1486,
          shortTitle: 'Bureaux d\'études techniques, cabinets d\'ingénieurs-conseils et sociétés de conseils',
          title: 'Convention collective nationale des bureaux d\'études techniques...',
          url: 'https://www.legifrance.gouv.fr/affichIDCC.do?idConvention=KALICONT000005635173'
        }]
      })
    };
  };

  const result = await fetchConventionCollectiveFromSiret('32682006500083');
  assert.strictEqual(result.idcc, '1486');
  assert.ok(result.label.includes('Bureaux d\'études techniques'));
  assert.ok(result.url.includes('legifrance.gouv.fr'));

  console.log('OK — convention-collective-auto-18-09.test.js (SIRET connu : libellé officiel + lien Légifrance direct)');
}

async function runAucuneConventionRenvoieNull() {
  const { sandbox, fetchConventionCollectiveFromSiret } = loadAppJs();
  // Confirmé en direct sur le SIRET du siège de Danone : conventions: [] (pas de sentinelle "9999"
  // comme sur l'autre API candidate) quand aucune convention n'est déterminée pour ce SIRET.
  sandbox.window.fetch = async () => ({ ok: true, json: async () => ({ conventions: [] }) });

  const result = await fetchConventionCollectiveFromSiret('55203253400703');
  assert.strictEqual(result, null, 'aucune convention déterminée doit renvoyer null, jamais un objet vide à afficher comme une vraie suggestion');

  console.log('OK — convention-collective-auto-18-09.test.js (SIRET sans convention déterminée : null, jamais un faux positif)');
}

async function runSiretInconnuOuEchecReseauRenvoieNullSansPlanter() {
  const { sandbox, fetchConventionCollectiveFromSiret } = loadAppJs();

  sandbox.window.fetch = async () => ({ ok: false, status: 404 });
  assert.strictEqual(await fetchConventionCollectiveFromSiret('00000000000000'), null, 'un SIRET inconnu (404) doit renvoyer null, jamais lever une exception');

  sandbox.window.fetch = async () => { throw new Error('panne réseau simulée'); };
  assert.strictEqual(await fetchConventionCollectiveFromSiret('32682006500083'), null, 'une panne réseau ne doit jamais empêcher la saisie manuelle (null, jamais une exception qui remonte)');

  console.log('OK — convention-collective-auto-18-09.test.js (SIRET inconnu/panne réseau : null, jamais bloquant)');
}

async function runSecteurExtraitDuLibelleOuNullSiInconnu() {
  const { secteurForConventionLabel } = loadAppJs();
  assert.strictEqual(secteurForConventionLabel('Industries textiles (IDCC 18)'), 'Industrie');
  assert.strictEqual(secteurForConventionLabel('Une convention ajoutée depuis l\'API (IDCC 9001)'), null,
    'une convention ajoutée automatiquement depuis l\'API (hors du catalogue statique des ~180 courantes) ne doit jamais planter, simplement ne pas afficher de secteur');
  assert.strictEqual(secteurForConventionLabel('texte sans IDCC du tout'), null);

  console.log('OK — convention-collective-auto-18-09.test.js (secteur affiché pour le catalogue connu, jamais une erreur pour une convention ajoutée automatiquement)');
}

async function runChampDeSaisieRemplaceLaListeDerouLante() {
  const { DB, sandbox, openEmployeeModal, employeeRepository } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  employeeRepository.update(salarie.id, { conventionCollective: 'Industries chimiques (IDCC 44)' });

  openEmployeeModal(salarie.id);
  const html = sandbox.document.getElementById('modal-root').innerHTML;
  assert.ok(html.includes('id="f-conventionCollective"') && html.includes('data-convention-autocomplete="true"'),
    'la convention collective doit être un champ de recherche texte, plus une liste déroulante native');
  assert.ok(html.includes('value="Industries chimiques (IDCC 44)"'), 'la valeur déjà enregistrée doit être reprise telle quelle dans le champ de recherche');
  assert.ok(!/<select[^>]*id="f-conventionCollective"/.test(html), 'aucun <select> natif ne doit plus subsister pour ce champ');

  console.log('OK — convention-collective-auto-18-09.test.js (fiche salarié : recherche texte à la place de la liste déroulante native)');
}

async function runSuggestionJamaisAppliqueeAutomatiquement() {
  // Contrôle défensif : le mécanisme de suggestion doit exiger un clic explicite ("Confirmer"),
  // jamais écrire conventionCollective de sa propre initiative. Vérifié sur le code source : la
  // seule écriture de settings.conventionsCollectives/du champ se trouve dans le gestionnaire du
  // bouton "Confirmer", jamais dans le corps de la promesse de fetchConventionCollectiveFromSiret
  // elle-même ni juste après son résolution.
  const fs = require('fs');
  const path = require('path');
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const fnStart = appSource.indexOf('async function fetchConventionCollectiveFromSiret(');
  const fnBody = appSource.slice(fnStart, fnStart + 900);
  assert.ok(!fnBody.includes('conventionField.value =') && !fnBody.includes('saveSettings'),
    'fetchConventionCollectiveFromSiret elle-même ne doit jamais écrire quoi que ce soit, uniquement renvoyer la suggestion à afficher');

  console.log('OK — convention-collective-auto-18-09.test.js (garde-fou : la fonction de recherche ne modifie jamais rien elle-même)');
}

runFetchRenvoieLeLibelleEtLeLienLegifrance()
  .then(runAucuneConventionRenvoieNull)
  .then(runSiretInconnuOuEchecReseauRenvoieNullSansPlanter)
  .then(runSecteurExtraitDuLibelleOuNullSiInconnu)
  .then(runChampDeSaisieRemplaceLaListeDerouLante)
  .then(runSuggestionJamaisAppliqueeAutomatiquement)
  .catch((err) => {
    console.error('ÉCHEC — convention-collective-auto-18-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
