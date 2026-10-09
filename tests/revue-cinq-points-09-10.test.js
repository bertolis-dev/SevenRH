/**
 * Seven RH — tour de l'application du 09/10/2026, points « à décider » traités :
 *  1. Le salaire d'un contrat suit la règle de la fiche (VOIR_INFOS_FINANCIERES) : onglet Contrat,
 *     formulaires, avenants et documents fusionnés ne l'affichent plus à qui n'a pas ce droit.
 *  3. Le pointage d'un salarié/manager n'atteignait jamais le serveur (companies_update exige
 *     gererParametres, UPDATE refusé en silence) : écriture par la fonction dédiée enregistrer_pointage.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAppJs } = require('./load-app-js');

function setupRh(avecDroitFinancier) {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  const rh = api.DB.getEmployees().find(e => e.role === 'rh');
  api.DB._currentEmployeeId = rh.id;
  if (avecDroitFinancier) api.DB.updateEmployee(rh.id, { permissionsOverrides: { voirInfosFinancieres: true } });
  return { ...api, rh };
}

async function runLeSalaireDuContratSuitLeDroitFinancier() {
  for (const droit of [false, true]) {
    const { employeeRepository, openCorrigerContratModal, sandbox, DB } = setupRh(droit);
    const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
    employeeRepository.update(salarie.id, { dateEmbauche: '2020-01-01' });
    await employeeRepository.ajouterContrat(salarie.id, { dateDebut: '2020-01-01', typeContrat: 'CDD', tempsTravail: 'Temps plein', forfait: 'Aucun', salaireBrutMensuel: 2000 });
    const contrat = employeeRepository.getById(salarie.id).contrats[0];
    openCorrigerContratModal(salarie.id, contrat.id);
    const html = sandbox.document.getElementById('modal-root').innerHTML;
    assert.strictEqual(html.includes('id="f-contrat-salaire"'), droit, droit ? 'avec le droit, le champ salaire est affiché' : 'sans le droit, le champ salaire ne doit pas être affiché');
    if (!droit) assert.ok(html.includes('droit « Voir les informations financières »'), 'une explication remplace le champ');
    assert.ok(!html.includes('2000') || droit, 'sans le droit, le montant ne doit apparaître nulle part dans le formulaire');
  }
  console.log('OK — revue-cinq-points-09-10.test.js (formulaire de contrat : salaire affiché seulement avec le droit financier)');
}

function runLeSalaireNEstPasEcraseSansLeDroit() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.ok(/salaireBrutMensuel: peutVoirSalaireContrat\(\) \? \(Number\(document\.getElementById\('f-contrat-salaire'\)\.value\) \|\| 0\) : \(Number\(depart\.salaireBrutMensuel\) \|\| 0\)/.test(src), 'sans le champ, le salaire du contrat de départ est conservé, jamais remis à 0');
  assert.ok(/CHAMP_AVENANT_OPTIONS\.filter\(o => o\.value !== 'salaireBrutMensuel' \|\| peutVoirSalaireContrat\(\)\)/.test(src), 'l\'avenant de salaire n\'est pas proposé sans le droit');
  console.log('OK — revue-cinq-points-09-10.test.js (le salaire existant est conservé, avenant de salaire réservé au droit financier)');
}

function runLesDocumentsFusionnesNImprimentPasLeSalaireSansLeDroit() {
  for (const droit of [false, true]) {
    const { DB, sandbox, rh } = setupRh(droit);
    const company = DB.getCurrentCompany();
    company.settings = Object.assign({}, company.settings, { masseSalarialeActivee: true });
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    const employe = Object.assign({}, salarie, { salaireBrutMensuel: 3210 });
    const valeurs = sandbox.construireValeursFusionModele(employe, company);
    assert.strictEqual(valeurs.salaireBrutMensuel === 3210, droit, droit ? 'avec le droit, le salaire est fusionné' : 'sans le droit, le salaire reste vide');
    const propre = sandbox.construireValeursFusionModele(Object.assign({}, rh, { salaireBrutMensuel: 1800 }), company);
    assert.strictEqual(propre.salaireBrutMensuel, 1800, 'chacun garde accès à SON propre salaire dans ses propres documents');
  }
  console.log('OK — revue-cinq-points-09-10.test.js (documents fusionnés : salaire seulement avec le droit, ou pour soi-même)');
}

function mockServeurPointage(sandbox, { recu, echec }) {
  sandbox.window.SupabaseSync = new Proxy({
    verifierPointageCode: async () => true,
    enregistrerPointageServeur: async (etablissementId, code, pointage) => {
      if (echec) throw new Error('refusé par le serveur');
      recu.push({ etablissementId, code, pointage: JSON.parse(JSON.stringify(pointage)) });
    }
  }, { get(target, prop) { return prop in target ? target[prop] : async () => ({ success: true }); } });
}

async function runLePointageEstEcritParLaFonctionDediee() {
  const { sandbox, DB, pointageRepository, etablissementRepository } = setupRh(false);
  const recu = [];
  mockServeurPointage(sandbox, { recu, echec: false });
  const salarie = DB.getEmployees().find(e => e.role === 'salarie');
  DB._currentEmployeeId = salarie.id;
  const etab = etablissementRepository.getAll()[0];

  const arrivee = await pointageRepository.enregistrer(salarie.id, etab.id, 'code-1');
  assert.strictEqual(arrivee.success, true);
  assert.strictEqual(arrivee.type, 'arrivee');
  assert.strictEqual(recu.length, 1, 'l\'arrivée doit partir vers enregistrer_pointage');
  assert.strictEqual(recu[0].code, 'code-1', 'le code du QR est transmis pour être revérifié côté serveur');
  assert.strictEqual(recu[0].pointage.employeeId, salarie.id);

  const depart = await pointageRepository.enregistrer(salarie.id, etab.id, 'code-2');
  assert.strictEqual(depart.type, 'depart');
  assert.strictEqual(recu.length, 2, 'le départ aussi');
  assert.ok(recu[1].pointage.heureDepart, 'le pointage envoyé porte l\'heure de départ');
  assert.strictEqual(recu[1].pointage.id, recu[0].pointage.id, 'même pointage, jamais une arrivée fantôme');
  console.log('OK — revue-cinq-points-09-10.test.js (pointage : arrivée et départ passent par enregistrer_pointage avec le code du QR)');
}

async function runUnEchecServeurNeLaisseAucunPointageFantome() {
  const { sandbox, DB, pointageRepository, etablissementRepository } = setupRh(false);
  mockServeurPointage(sandbox, { recu: [], echec: true });
  const salarie = DB.getEmployees().find(e => e.role === 'salarie');
  DB._currentEmployeeId = salarie.id;
  const etab = etablissementRepository.getAll()[0];
  const avant = DB.getPointages().length;

  const resultat = await pointageRepository.enregistrer(salarie.id, etab.id, 'code-1');
  assert.strictEqual(resultat.success, false, 'un refus serveur doit être signalé à l\'utilisateur');
  assert.ok(/serveur/.test(resultat.error));
  assert.strictEqual(DB.getPointages().length, avant, 'rien ne doit rester dans le navigateur seul (c\'était le bug : pointage visible puis perdu au rechargement)');
  console.log('OK — revue-cinq-points-09-10.test.js (pointage refusé par le serveur : erreur claire, aucun pointage fantôme)');
}

function runLaMigrationPointageRevérifieLeQrEtLIdentite() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '0068_pointage_enregistrer_rpc.sql'), 'utf8');
  assert.ok(/security definer/.test(sql) && /set search_path = public/.test(sql));
  assert.ok(/verifier_pointage_code\(p_etablissement_id, p_code\)/.test(sql), 'le code du QR est revérifié côté serveur');
  assert.ok(/p_pointage->>'employeeId' is distinct from v_emp/.test(sql), 'uniquement son propre pointage');
  assert.ok(/e->>'employeeId' is distinct from v_emp/.test(sql), 'jamais écraser le pointage d\'un autre en réutilisant son id');
  assert.ok(/revoke all on function enregistrer_pointage\(text, text, jsonb\) from public, anon;/.test(sql));
  assert.ok(/grant execute on function enregistrer_pointage\(text, text, jsonb\) to authenticated;/.test(sql));
  console.log('OK — revue-cinq-points-09-10.test.js (migration 0068 : QR revérifié, identité contrôlée, anon exclu)');
}

function runLeRemplacantVoitSaDelegationSansLireLaFicheDuDelegant() {
  const { DB, employeeRepository, isManagerOfEmployee } = setupRh(false);
  const manager = DB.getEmployees().find(e => e.role === 'manager');
  const salarie = DB.getEmployees().find(e => e.role === 'salarie');
  const remplacant = DB.getEmployees().find(e => e.id !== manager.id && e.id !== salarie.id && e.role !== 'proprietaire');
  employeeRepository.update(salarie.id, { managerIds: [manager.id] });
  const iso = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  // La fiche du délégant n'est PAS dans le cache du remplaçant : seule la fonction serveur l'informe.
  const company = DB.getCurrentCompany();
  company.delegationsRecues = [{ delegantId: manager.id, dateDebut: iso(-1), dateFin: iso(5) }];
  DB.saveCurrentCompany(company);

  DB._currentEmployeeId = remplacant.id;
  assert.strictEqual(isManagerOfEmployee(remplacant.id, salarie.id), true, 'le remplaçant doit être reconnu manager de l\'équipe déléguée');

  company.delegationsRecues = [{ delegantId: manager.id, dateDebut: iso(-10), dateFin: iso(-2) }];
  DB.saveCurrentCompany(company);
  assert.strictEqual(isManagerOfEmployee(remplacant.id, salarie.id), false, 'jamais hors de la fenêtre de délégation');

  company.delegationsRecues = [{ delegantId: 'quelqu-un-d-autre', dateDebut: iso(-1), dateFin: iso(5) }];
  DB.saveCurrentCompany(company);
  assert.strictEqual(isManagerOfEmployee(remplacant.id, salarie.id), false, 'une délégation d\'un manager qui n\'est pas celui du salarié ne donne rien');

  company.delegationsRecues = [{ delegantId: manager.id, dateDebut: iso(-1), dateFin: iso(5) }];
  DB.saveCurrentCompany(company);
  DB._currentEmployeeId = salarie.id;
  assert.strictEqual(isManagerOfEmployee(remplacant.id, salarie.id), false, 'les délégations reçues ne valent que pour l\'utilisateur connecté, jamais pour un tiers');
  console.log('OK — revue-cinq-points-09-10.test.js (délégation : le remplaçant est reconnu grâce aux délégations reçues du serveur, jamais hors fenêtre ni pour un tiers)');
}

function runLaMigrationDelegationsNExposeQueLaFenetre() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '0069_delegations_recues.sql'), 'utf8');
  assert.ok(/security definer/.test(sql) && /set search_path = public/.test(sql));
  assert.ok(/d->>'delegataireId' = current_employee_id\(\)/.test(sql), 'uniquement les délégations adressées à l\'appelant');
  assert.ok(/'delegantId', e\.id, 'dateDebut', d->>'dateDebut', 'dateFin', d->>'dateFin'/.test(sql), 'seulement l\'identifiant du délégant et la fenêtre, jamais sa fiche');
  assert.ok(/revoke all on function delegations_recues\(\) from public, anon;/.test(sql) && /grant execute on function delegations_recues\(\) to authenticated;/.test(sql));
  const client = fs.readFileSync(path.join(__dirname, '..', 'supabase-client.js'), 'utf8');
  assert.ok(/supabase\.rpc\('delegations_recues'\)/.test(client) && /delegationsRecues,\n/.test(client), 'l\'hydratation charge les délégations reçues, sans jamais bloquer la connexion si la fonction manque');
  const data = fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8');
  assert.ok(!/abonnement, \.\.\.companyData \} = company;/.test(data), 'delegationsRecues ne doit jamais partir dans le blob companies.data');
  console.log('OK — revue-cinq-points-09-10.test.js (migration 0069 : seule la fenêtre de délégation est exposée, hydratation tolérante)');
}

(async () => {
  try {
    runLeRemplacantVoitSaDelegationSansLireLaFicheDuDelegant();
    runLaMigrationDelegationsNExposeQueLaFenetre();
    await runLeSalaireDuContratSuitLeDroitFinancier();
    runLeSalaireNEstPasEcraseSansLeDroit();
    runLesDocumentsFusionnesNImprimentPasLeSalaireSansLeDroit();
    await runLePointageEstEcritParLaFonctionDediee();
    await runUnEchecServeurNeLaisseAucunPointageFantome();
    runLaMigrationPointageRevérifieLeQrEtLIdentite();
  } catch (err) {
    console.error('ÉCHEC — revue-cinq-points-09-10.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  }
})();
