/**
 * Seven RH — teste le point 7.21 ("compteur en heures", retour QA du 26/08/2026) : solde de repos
 * compensateur, calculé à partir de deux journaux bruts déjà existants dans le même esprit que le
 * reste du module heures sup/variables de paie (saisie manuelle, aucune automatisation de calcul de
 * paie) — jamais un taux de conversion présumé par l'app (voir DEFAULT_SETTINGS.tauxReposCompensateur,
 * toujours configurable et jamais imposé).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function run() {
  const { sandbox, DB, getReposCompensateurSolde } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const company = DB.getCurrentCompany();
  const employee = DB.getEmployees()[0];

  // ---- Aucune donnée saisie : solde nul, pas d'erreur ----
  // (assertions champ par champ, pas deepStrictEqual sur l'objet entier : `solde` est un objet
  // construit À L'INTÉRIEUR du contexte vm, un autre "realm" JS que ce fichier de test —
  // deepStrictEqual le considère "non référentiellement égal" à un littéral de CE fichier même à
  // structure identique, un piège du module vm plutôt qu'un vrai problème d'égalité.)
  {
    const solde = getReposCompensateurSolde(employee);
    assert.strictEqual(solde.credit, 0);
    assert.strictEqual(solde.pris, 0);
    assert.strictEqual(solde.solde, 0);
  }

  // ---- Cumul TOUTES années confondues (contrairement à getHeuresSupAnnee, qui est annuel) ----
  {
    const e = DB.getEmployeeById(employee.id);
    e.heuresSupplementaires = { '2024-03': 10, '2025-11': 5, '2026-08': 4 }; // 3 années différentes
    company.settings.tauxReposCompensateur = 25;
    DB.saveCurrentCompany(company);
    const solde = getReposCompensateurSolde(DB.getEmployeeById(employee.id));
    // (10 + 5 + 4) × 1.25 = 23.75
    assert.strictEqual(solde.credit, 23.75, 'le crédit doit cumuler TOUTES les années, pas seulement l\'année civile en cours');
    assert.strictEqual(solde.pris, 0);
    assert.strictEqual(solde.solde, 23.75);
  }

  // ---- Heures déjà prises réduisent le solde ----
  {
    const e = DB.getEmployeeById(employee.id);
    e.reposCompensateurPris = { '2026-06': 10 };
    DB.saveCurrentCompany(company);
    const solde = getReposCompensateurSolde(DB.getEmployeeById(employee.id));
    assert.strictEqual(solde.pris, 10);
    assert.strictEqual(solde.solde, 13.75, '23.75 acquises - 10 prises = 13.75');
  }

  // ---- Taux configurable : un taux différent change le crédit, jamais codé en dur ----
  {
    company.settings.tauxReposCompensateur = 50;
    DB.saveCurrentCompany(company);
    const solde = getReposCompensateurSolde(DB.getEmployeeById(employee.id));
    // (10 + 5 + 4) × 1.50 = 28.5
    assert.strictEqual(solde.credit, 28.5, 'un taux d\'entreprise différent (50% au lieu de 25%) doit changer le crédit calculé');
  }

  // ---- Taux à 0 (entreprise n'ayant pas encore configuré) : jamais une erreur, jamais NaN ----
  {
    company.settings.tauxReposCompensateur = 0;
    DB.saveCurrentCompany(company);
    const solde = getReposCompensateurSolde(DB.getEmployeeById(employee.id));
    assert.strictEqual(solde.credit, 19, '(10+5+4) × 1.0 = 19, un taux à 0% ne doit jamais planter');
    assert.ok(Number.isFinite(solde.credit) && Number.isFinite(solde.solde), 'jamais NaN/Infinity, quel que soit le taux');
  }

  // ---- DB.ajusterReposCompensateurPris : validation + remplacement (pas un cumul) ----
  {
    const rh = DB.getEmployees().find(e => e.role === 'rh') || DB.getEmployees()[0];
    DB._currentEmployeeId = rh.id;
    const negResult = DB.ajusterReposCompensateurPris(employee.id, 2026, 5, -3, 'test');
    assert.strictEqual(negResult.success, false, 'une valeur négative doit être rejetée');

    const okResult = DB.ajusterReposCompensateurPris(employee.id, 2026, 5, 7, 'après-midi');
    assert.strictEqual(okResult.success, true);
    assert.strictEqual(DB.getEmployeeById(employee.id).reposCompensateurPris['2026-06'], 7);

    // Deuxième saisie sur le MÊME mois : remplace, ne s'additionne pas.
    DB.ajusterReposCompensateurPris(employee.id, 2026, 5, 2, 'correction');
    assert.strictEqual(DB.getEmployeeById(employee.id).reposCompensateurPris['2026-06'], 2,
      'une nouvelle saisie sur le même mois doit REMPLACER la précédente, pas s\'additionner');
  }

  console.log('OK — repos-compensateur.test.js (cumul multi-années, taux configurable, validation, remplacement mensuel)');
}

try {
  run();
} catch (err) {
  console.error('ÉCHEC — repos-compensateur.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
