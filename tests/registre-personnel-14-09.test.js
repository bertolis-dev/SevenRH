/**
 * Seven RH — retour Betty du 14/09/2026 (Module RH point 6, "registre du personnel toujours à
 * jour") : anonymize_employee (0049_retention_anonymisation.sql) effaçait nom/prénom/date de
 * naissance/nationalité/civilité d'un salarié parti après la durée de conservation — or le registre
 * unique du personnel (Code du travail) doit présenter exactement ces mentions pour CHAQUE salarié
 * ayant travaillé dans l'entreprise, même parti depuis longtemps. 0053_anonymize_conserve_registre.sql
 * retire ces champs précis de l'anonymisation automatique ; tout le reste (coordonnées, identifiants)
 * continue d'être effacé comme avant. Vérifié statiquement sur le texte SQL (non exécutable ici, voir
 * retention-rpc-grants-11-09.test.js pour la même limite assumée sur ces fonctions).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAppJs } = require('./load-app-js');

function run() {
  const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));
  const allSql = files.map(f => fs.readFileSync(path.join(migrationsDir, f), 'utf8')).join('\n');

  // Seule la DERNIÈRE définition (create or replace) est réellement active — jamais la première
  // (même bug déjà rencontré et corrigé sur pointage-rpc-grants-13-09.test.js).
  const definitions = allSql.match(/create (or replace )?function\s+anonymize_employee\s*\([\s\S]*?\$\$;/gi);
  assert.ok(definitions && definitions.length, 'anonymize_employee introuvable');
  const derniere = definitions[definitions.length - 1];

  ['nom', 'prenom', 'dateNaissance', 'nationalite', 'civilite'].forEach((champ) => {
    assert.ok(!new RegExp(`'${champ}'`).test(derniere) && !new RegExp(`\\b${champ}\\s*=`).test(derniere),
      `${champ} est requis par le registre unique du personnel : la dernière définition d'anonymize_employee ne doit plus jamais l'effacer`);
  });

  ['telephone', 'adresse', 'numeroSecu', 'photo'].forEach((champ) => {
    assert.ok(new RegExp(`'${champ}'`).test(derniere),
      `${champ} n'est pas requis par le registre : doit continuer à être effacé par anonymize_employee`);
  });
  assert.ok(/email\s*=\s*'anonymise-'/.test(derniere), 'l\'email doit continuer à être anonymisé (pas requis par le registre)');

  console.log('OK — registre-personnel-14-09.test.js (nom/prénom/date de naissance/nationalité/civilité préservés, le reste toujours anonymisé)');
}

function runUi() {
  const { DB, sandbox, renderEmployeeDetail } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;
  const company = DB.getCurrentCompany();
  const salarie = company.employees.find(e => e.role === 'salarie');
  salarie.archive = true;
  salarie.anonymise = true;
  salarie.dateAnonymisation = '2026-09-01';
  DB.saveCurrentCompany(company);

  const html = renderEmployeeDetail(salarie.id);
  assert.ok(html.includes('registre unique du personnel'), 'la fiche anonymisée doit expliquer pourquoi nom/prénom restent visibles (exception légale), jamais laisser croire à une anonymisation incomplète par erreur');

  console.log('OK — registre-personnel-14-09.test.js (message explicatif de l\'exception registre affiché sur une fiche anonymisée)');
}

try {
  run();
  runUi();
} catch (err) {
  console.error('ÉCHEC — registre-personnel-14-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
