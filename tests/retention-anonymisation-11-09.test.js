/**
 * Seven RH — retour Betty du 11/09/2026 (point 4.3, "durée de conservation") : rien ne purgeait ni
 * n'anonymisait jusqu'ici les données personnelles d'un salarié parti (obligation RGPD). Voir
 * 0049_retention_anonymisation.sql (anonymize_employee/anonymize_departed_employees, appelées par
 * pg_cron côté serveur — non testables ici, comme le reste de ce qui parle au vrai Supabase, voir
 * les autres tests "-grants-" de ce dossier pour le même type de limite assumée). Ce fichier couvre
 * la partie CLIENT : le réglage de durée (Paramètres > Listes > Salariés) et l'affichage d'une fiche
 * déjà anonymisée (jamais un écran qui ressemble à des données corrompues/perdues).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function run() {
  // ---- Réglage de durée : valeur par défaut (5 ans), rendue dans Paramètres > Listes ----
  {
    const { DB, sandbox, renderParametresListes } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const company = DB.getCurrentCompany();
    company.abonnement.offre = 'a_la_carte';
    company.abonnement.modules = [{ key: 'rh' }];
    DB.saveCurrentCompany(company);

    const html = renderParametresListes();
    assert.ok(html.includes('f-duree-conservation'), 'le champ de durée de conservation doit être rendu');
    assert.ok(html.includes('value="5"'), 'la valeur par défaut (5 ans) doit être pré-remplie');
    assert.ok(html.includes('juriste'), 'le champ doit rappeler qu\'il s\'agit d\'une valeur par défaut à faire confirmer, pas une certitude juridique');
  }

  // ---- Fiche anonymisée : jamais un écran qui ressemble à une perte de données, un message
  // explicite doit apparaître ----
  {
    const { DB, sandbox, renderEmployeeDetail } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const company = DB.getCurrentCompany();
    const salarie = company.employees.find(e => e.role === 'salarie');
    salarie.archive = true;
    salarie.nom = 'Salarié archivé';
    salarie.prenom = '';
    salarie.anonymise = true;
    salarie.dateAnonymisation = '2026-09-01';
    DB.saveCurrentCompany(company);

    const html = renderEmployeeDetail(salarie.id);
    assert.ok(html.includes('Anonymisé'), 'une fiche anonymisée doit porter un badge explicite');
    assert.ok(html.includes('anonymisée le'), 'un message doit expliquer POURQUOI les champs sont vides, jamais un silence qui ressemble à une perte de données');
    assert.ok(!html.includes('undefined') && !html.includes('null'), 'aucune fuite de valeur brute (undefined/null) dans le rendu d\'une fiche anonymisée');
  }

  // ---- Une fiche NORMALE (non anonymisée) ne doit jamais afficher ce badge (garde-fou anti-régression) ----
  {
    const { DB, sandbox, renderEmployeeDetail } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');

    const html = renderEmployeeDetail(salarie.id);
    assert.ok(!html.includes('Anonymisé'), 'un salarié actif normal ne doit jamais porter le badge "Anonymisé"');
  }

  console.log('OK — retention-anonymisation-11-09.test.js (durée de conservation configurable, fiche anonymisée affichée explicitement, jamais silencieuse)');
}

try {
  run();
} catch (err) {
  console.error('ÉCHEC — retention-anonymisation-11-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
