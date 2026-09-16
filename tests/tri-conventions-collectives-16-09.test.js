/**
 * Seven RH — retour Betty du 16/09/2026 : "serait-ce possible de trier les conventions collectives
 * par numéro d'IDCC ? Celles où le numéro n'apparaît pas seraient en fin de liste." Tri appliqué à
 * la LECTURE (DB.getSettings), jamais persisté trié — reste correct quel que soit l'ordre déjà
 * enregistré pour une entreprise existante (même principe que les autres rattrapages de ce fichier).
 */
const assert = require('assert');
const { loadDataJs } = require('./load-data-js');

async function runTriParDefaut() {
  const { DB, sandbox } = loadDataJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();

  const settings = DB.getSettings();
  const codes = settings.conventionsCollectives.map(c => {
    const m = c.match(/IDCC\s*(\d+)/i);
    return m ? Number(m[1]) : null;
  });

  const avecCode = codes.filter(c => c !== null);
  const sansCode = codes.filter(c => c === null);
  const triee = avecCode.slice().sort((a, b) => a - b);
  assert.deepStrictEqual(avecCode, triee, 'les conventions avec un numéro IDCC doivent être triées par ordre croissant');

  // "Aucune" (sans numéro) doit être en fin de liste, jamais mélangée avec les numérotées.
  const dernierIndexAvecCode = codes.lastIndexOf(avecCode[avecCode.length - 1]);
  const premierIndexSansCode = codes.indexOf(null);
  assert.ok(sansCode.length > 0, 'sanity : "Aucune" doit être présente par défaut');
  assert.ok(premierIndexSansCode > dernierIndexAvecCode, 'toute entrée sans numéro IDCC (ex. "Aucune") doit venir APRÈS toutes les entrées numérotées');

  console.log('OK — tri-conventions-collectives-16-09.test.js (tri croissant par IDCC, "Aucune" en fin de liste)');
}

async function runTriPreserveListeFigee() {
  // Même scénario que le rattrapage "liste ancienne" déjà testé (employee-form-fixes.test.js) :
  // une entreprise dont la liste a été figée dans le désordre doit AUSSI voir le tri s'appliquer,
  // pas seulement une entreprise toute neuve — le tri se fait à la lecture, jamais une seule fois.
  const { DB, sandbox } = loadDataJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const company = DB.getCurrentCompany();
  company.settings.conventionsCollectives = ['Aucune', 'Négoce médico-technique (IDCC 1982)', 'Publicité (IDCC 86)', 'Ma convention perso'];
  DB.saveCurrentCompany(company);

  const settings = DB.getSettings();
  const idccOrdre = settings.conventionsCollectives
    .map(c => { const m = c.match(/IDCC\s*(\d+)/i); return m ? Number(m[1]) : null; })
    .filter(c => c !== null);
  assert.deepStrictEqual(idccOrdre.slice().sort((a, b) => a - b), idccOrdre, 'même une liste déjà enregistrée dans le désordre doit être triée à la lecture');
  assert.ok(settings.conventionsCollectives.indexOf('Aucune') > settings.conventionsCollectives.findIndex(c => c.includes('IDCC 86')), '"Aucune" doit passer après une convention numérotée');
  assert.ok(settings.conventionsCollectives.includes('Ma convention perso'), 'une convention personnalisée déjà ajoutée par l\'entreprise ne doit jamais être perdue par le tri');

  console.log('OK — tri-conventions-collectives-16-09.test.js (le tri s\'applique aussi à une liste déjà enregistrée dans le désordre)');
}

runTriParDefaut()
  .then(runTriPreserveListeFigee)
  .catch((err) => {
    console.error('ÉCHEC — tri-conventions-collectives-16-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
