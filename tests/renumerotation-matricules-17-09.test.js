/**
 * Seven RH — retour Betty du 17/09/2026, point 3 : "les matricules sont mélangés" — une entreprise
 * peut avoir des salariés au format ancien (ex. SRH-0001) et au nouveau format AAAA-NNNN
 * (0040_matricule_atomique.sql) côte à côte, jamais harmonisés. employees_matricule_immutable (0040)
 * bloque par construction toute modification d'un matricule déjà attribué — la seule façon de
 * renumériser est donc désormais renumber_company_matricules (0058_renumerotation_matricules.sql),
 * une fonction serveur dédiée qui lève temporairement cette protection UNIQUEMENT pour sa propre
 * transaction (set_config(..., true)), réservée à RH/Propriétaire, journalisant chaque changement.
 * Ce fichier teste le comportement CÔTÉ CLIENT (DB.renumberMatricules via employeeRepository,
 * app.js) et vérifie statiquement les garde-fous posés dans la migration SQL elle-même (l'exécution
 * réelle d'un trigger/d'une fonction PL/pgSQL n'est pas testable sans Postgres).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAppJs } = require('./load-app-js');

function buildSandbox(rpcImpl) {
  const { sandbox, DB, employeeRepository } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, {
    get: (target, prop) => {
      if (prop === 'renumberCompanyMatricules') return rpcImpl;
      return async () => ({ success: true });
    }
  });
  DB.init();
  return { DB, employeeRepository };
}

async function runAppliqueLeMappingLocalement() {
  const calls = [];
  const { DB, employeeRepository } = buildSandbox(async (companyId, avecTiret) => {
    calls.push({ companyId, avecTiret });
    const company = DB.getCurrentCompany();
    const employees = DB.getEmployees();
    return {
      success: true,
      mappings: employees.map((e, i) => ({ employeeId: e.id, ancien: e.matricule, nouveau: `2026-${String(i + 1).padStart(4, '0')}` }))
    };
  });

  const company = DB.getCurrentCompany();
  const result = await employeeRepository.renumberMatricules();

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].companyId, company.id, 'l\'entreprise transmise au serveur doit être celle en session, jamais une autre');
  assert.strictEqual(calls[0].avecTiret, true, 'le séparateur configuré (settings.matriculeAvecTiret, vrai par défaut) doit être transmis au serveur');

  const after = DB.getEmployees();
  after.forEach((e, i) => assert.strictEqual(e.matricule, `2026-${String(i + 1).padStart(4, '0')}`, 'chaque salarié doit recevoir le matricule renvoyé par le serveur, jamais recalculé localement'));
  assert.strictEqual(result.count, after.length);

  console.log('OK — renumerotation-matricules-17-09.test.js (mapping serveur appliqué au cache local, séparateur transmis)');
}

async function runRespecteLeSeparateurSansTiret() {
  const calls = [];
  const { DB, employeeRepository } = buildSandbox(async (companyId, avecTiret) => {
    calls.push(avecTiret);
    return { success: true, mappings: [] };
  });
  const company = DB.getCurrentCompany();
  company.settings.matriculeAvecTiret = false;
  DB.saveCurrentCompany(company);

  await employeeRepository.renumberMatricules();
  assert.strictEqual(calls[0], false, 'settings.matriculeAvecTiret désactivé doit être transmis tel quel au serveur, pas ignoré');

  console.log('OK — renumerotation-matricules-17-09.test.js (séparateur désactivé bien transmis au serveur)');
}

async function runEchecServeurNeModifieRien() {
  const { DB, employeeRepository } = buildSandbox(async () => ({ success: false, error: 'Panne réseau simulée.' }));
  const avant = DB.getEmployees().map(e => e.matricule);

  let threw = false;
  try {
    await employeeRepository.renumberMatricules();
  } catch (err) {
    threw = true;
    assert.strictEqual(err.message, 'Panne réseau simulée.');
  }
  assert.strictEqual(threw, true, 'un échec côté serveur doit bloquer l\'opération (exception), jamais un repli local');
  const apres = DB.getEmployees().map(e => e.matricule);
  assert.deepStrictEqual(avant, apres, 'aucun matricule local ne doit changer si le serveur n\'a rien confirmé');

  console.log('OK — renumerotation-matricules-17-09.test.js (panne serveur : aucun matricule local modifié)');
}

async function runNeCompteQueLesVraisChangements() {
  const { DB, employeeRepository } = buildSandbox(async () => {
    const employees = DB.getEmployees();
    // Le serveur renvoie exactement les mêmes matricules qu'avant (déjà dans le bon ordre) : aucun
    // changement réel, même si le mapping complet est bien renvoyé pour chaque salarié.
    return { success: true, mappings: employees.map(e => ({ employeeId: e.id, ancien: e.matricule, nouveau: e.matricule })) };
  });
  const result = await employeeRepository.renumberMatricules();
  assert.strictEqual(result.changed, 0, 'un salarié dont le matricule ne change pas ne doit pas compter dans "changed"');
  assert.strictEqual(result.count, DB.getEmployees().length);

  console.log('OK — renumerotation-matricules-17-09.test.js ("changed" ne compte que les matricules réellement différents)');
}

function runMigrationSqlGardeFous() {
  const sqlPath = path.join(__dirname, '..', 'supabase', 'migrations', '0058_renumerotation_matricules.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  assert.ok(/current_setting\('sevenrh\.allow_matricule_renumbering', true\)/.test(sql), 'le trigger doit vérifier le drapeau de contournement par son nom exact');
  assert.ok(/set_config\('sevenrh\.allow_matricule_renumbering', 'on', true\)/.test(sql), 'le drapeau doit être positionné en LOCAL (is_local=true) : jamais persistant au-delà de la transaction de renumérotation');

  const fnStart = sql.indexOf('function renumber_company_matricules');
  const fnBody = sql.slice(fnStart, sql.indexOf('revoke all', fnStart));
  assert.ok(/current_company_id\(\) is distinct from p_company_id/.test(fnBody), 'la fonction doit refuser de renumériser une AUTRE entreprise que celle de l\'appelant');
  assert.ok(/v_role not in \('rh', 'proprietaire'\)/.test(fnBody), 'seuls rh/proprietaire doivent pouvoir déclencher une renumérotation (même périmètre que MODIFIER_SALARIE, data.js)');
  assert.ok(/insert into audit_log/.test(fnBody), 'chaque changement doit être journalisé dans audit_log, comme la correction de doublons de 0040');

  assert.ok(/revoke all on function renumber_company_matricules\(text, boolean\) from public, anon, authenticated/.test(sql), 'la fonction doit être révoquée de public/anon avant d\'être regrantée à authenticated (défense en profondeur, même si le rôle est déjà vérifié à l\'intérieur)');
  assert.ok(/grant execute on function renumber_company_matricules\(text, boolean\) to authenticated/.test(sql));

  console.log('OK — renumerotation-matricules-17-09.test.js (migration SQL : contournement transactionnel, rôle vérifié, journalisé, revoke/grant en place)');
}

function runEcranAvertitAvantExecution() {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

  const btnStart = appSource.indexOf('btn-renumeroter-matricules');
  // §point 9 du 22/09/2026 : "Salariés" (et son bouton de renumérotation) a quitté l'onglet
  // "Référentiels" pour rejoindre le nouvel onglet "RH" (Paramètres réorganisés par module).
  assert.ok(btnStart !== -1, 'le bouton doit exister dans le rendu de l\'onglet RH (renderParametresRH)');

  const bindStart = appSource.indexOf('function bindParametresRHEvents(');
  const bindEnd = appSource.indexOf('function renderParametresRemuneration(');
  const bindBody = appSource.slice(bindStart, bindEnd);
  assert.ok(bindBody.includes('renumeroterMatriculesBtn'), 'le clic doit être lié depuis bindParametresRHEvents');
  assert.ok(bindBody.includes('openConfirm('), 'une confirmation explicite doit être demandée avant toute renumérotation');

  const confirmStart = bindBody.indexOf('openConfirm({');
  const confirmBlock = bindBody.slice(confirmStart, bindBody.indexOf('});', confirmStart));
  assert.ok(/document.*émis|émis.*document/i.test(confirmBlock) || confirmBlock.includes('bulletins de paie'), 'le message de confirmation doit avertir que les matricules figurent déjà sur des documents émis');
  assert.ok(confirmBlock.includes('employeeRepository.renumberMatricules()'), 'la confirmation doit être le seul déclencheur de l\'appel réel, jamais le simple clic sur le bouton');

  console.log('OK — renumerotation-matricules-17-09.test.js (écran : bouton réservé à Référentiels, avertissement explicite avant exécution)');
}

runAppliqueLeMappingLocalement()
  .then(runRespecteLeSeparateurSansTiret)
  .then(runEchecServeurNeModifieRien)
  .then(runNeCompteQueLesVraisChangements)
  .then(() => { runMigrationSqlGardeFous(); runEcranAvertitAvantExecution(); })
  .catch((err) => {
    console.error('ÉCHEC — renumerotation-matricules-17-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
