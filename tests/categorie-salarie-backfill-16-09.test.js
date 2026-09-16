/**
 * Seven RH — retour Betty du 16/09/2026, 2 points sur la fiche salarié :
 * 1. "Je ne vois pas non plus le statut cadre" — le correctif du 27/08/2026
 *    (deriveCategoriesSalarieFromStatutPro inclut toujours le socle standard) ne s'applique QUE
 *    tant que settings.categoriesSalarie est encore vide au moment de la lecture. Une entreprise
 *    déjà migrée AVANT ce correctif (donc avec un tableau déjà rempli, mais incomplet) restait
 *    figée pour toujours, sans jamais rattraper "Cadre" si elle ne l'avait pas au moment migré.
 * 2. "Le champ s'appelle « Statut Professionnel » en lecture et « Catégorie de salarié » en
 *    modification" — même donnée (employee.statutPro), harmonisé sur "Catégorie de salarié"
 *    (le nom déjà utilisé partout ailleurs : formulaire d'édition, Paramètres → Référentiels).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadDataJs } = require('./load-data-js');

async function runBackfillCategoriesDejaMigrees() {
  const { DB, sandbox, DEFAULT_SETTINGS } = loadDataJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const company = DB.getCurrentCompany();

  // Simule une entreprise migrée AVANT le correctif du 27/08/2026 : categoriesSalarie déjà rempli,
  // mais seulement avec "Non cadre" (aucun salarié n'avait encore "Cadre" au moment de la migration
  // à l'époque) — le tableau n'est jamais vide, donc l'ancien correctif ne se déclenche plus jamais.
  company.settings.categoriesSalarie = [{ id: 'cat-existant', nom: 'Non cadre', description: '', ordre: 0 }];
  DB.saveCurrentCompany(company);

  const settings = DB.getSettings();
  DEFAULT_SETTINGS.statutsPro.forEach(nom => {
    assert.ok(settings.categoriesSalarie.some(c => c.nom === nom), `catégorie standard "${nom}" doit apparaître après rattrapage, même sur une entreprise déjà migrée`);
  });
  // La catégorie déjà existante (avec son id d'origine) ne doit jamais être recréée/dupliquée.
  assert.strictEqual(settings.categoriesSalarie.filter(c => c.nom === 'Non cadre').length, 1, 'pas de doublon "Non cadre"');
  assert.strictEqual(settings.categoriesSalarie.find(c => c.nom === 'Non cadre').id, 'cat-existant', 'la catégorie déjà existante garde son id (les règles d\'éligibilité de congé s\'y accrochent par id)');

  // Idempotent : un deuxième appel ne duplique rien.
  const settings2 = DB.getSettings();
  assert.strictEqual(settings2.categoriesSalarie.filter(c => c.nom === 'Cadre').length, 1, 'pas de doublon "Cadre" après plusieurs lectures');

  console.log('OK — categorie-salarie-backfill-16-09.test.js (rattrapage du socle standard même sur une entreprise déjà migrée avec une liste incomplète)');
}

async function runPreserveCategoriePersonnalisee() {
  const { DB, sandbox, DEFAULT_SETTINGS } = loadDataJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const company = DB.getCurrentCompany();
  company.settings.categoriesSalarie = [{ id: 'cat-existant', nom: 'Alternant', description: '', ordre: 0 }];
  DB.saveCurrentCompany(company);

  const settings = DB.getSettings();
  assert.ok(settings.categoriesSalarie.some(c => c.nom === 'Alternant'), 'une catégorie personnalisée déjà ajoutée par l\'entreprise ne doit jamais être perdue par le rattrapage');
  DEFAULT_SETTINGS.statutsPro.forEach(nom => {
    assert.ok(settings.categoriesSalarie.some(c => c.nom === nom), `le socle standard doit s'ajouter EN PLUS de "${nom}"`);
  });

  console.log('OK — categorie-salarie-backfill-16-09.test.js (une catégorie personnalisée existante n\'est jamais perdue par le rattrapage)');
}

async function runHarmonisationLibelle() {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.ok(!appSource.includes('Statut professionnel'), 'l\'ancien libellé "Statut professionnel" ne doit plus apparaître : harmonisé sur "Catégorie de salarié" partout, comme dans le formulaire d\'édition et Paramètres → Référentiels');
  const occurrences = appSource.match(/infoRow\('Catégorie de salarié', e\.statutPro\)/g) || [];
  assert.strictEqual(occurrences.length, 2, 'les deux fiches salarié (résumé + détail complet) doivent afficher le même libellé "Catégorie de salarié"');

  console.log('OK — categorie-salarie-backfill-16-09.test.js (libellé harmonisé sur "Catégorie de salarié" en lecture comme en modification)');
}

runBackfillCategoriesDejaMigrees()
  .then(runPreserveCategoriePersonnalisee)
  .then(runHarmonisationLibelle)
  .catch((err) => {
    console.error('ÉCHEC — categorie-salarie-backfill-16-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
