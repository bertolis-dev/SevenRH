/**
 * Seven RH — teste le correctif du bug des matricules dupliqués (retour QA du 27/08/2026) :
 * company.matriculeSeq était un compteur EN MÉMOIRE jamais persisté par saveEmployees (voir
 * l'ancien code d'addEmployee), donc réinitialisé à chaque session — deux salariés créés depuis des
 * sessions différentes pouvaient recevoir le même matricule. La numérotation vient désormais d'un
 * appel serveur atomique (assign_matricule_number, 0040_matricule_atomique.sql), jamais d'un calcul
 * local — ce fichier teste le comportement CÔTÉ CLIENT (formatage, blocage si le serveur est
 * injoignable, respect du matricule fourni par un import) : l'atomicité elle-même (deux appels
 * concurrents ne reçoivent jamais le même numéro) ne peut être vérifiée que côté SQL réel, hors de
 * la portée d'un test Node sans Postgres.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function runAsync() {
  const { sandbox, DB, buildImportPreviewRows, importEmployeesRows } = loadAppJs();

  const assignCalls = [];
  const counters = {};
  let assignImpl = async (companyId, year) => {
    const key = companyId + ':' + year;
    counters[key] = (counters[key] || 0) + 1;
    return { success: true, number: counters[key] };
  };
  sandbox.window.SupabaseSync = new Proxy({}, {
    get: (target, prop) => {
      if (prop === 'assignMatriculeNumber') {
        return (...args) => { assignCalls.push(args); return assignImpl(...args); };
      }
      return async () => ({ success: true });
    }
  });

  DB.init();
  const company = DB.getCurrentCompany();

  // ---- Format par défaut : AAAA-NNNN, année = celle de dateEmbauche (pas l'année courante) ----
  {
    const emp = await DB.addEmployee({ nom: 'Un', prenom: 'Test', email: 'un@test.local', dateEmbauche: '2026-03-15' });
    assert.strictEqual(emp.matricule, '2026-0001');
    assert.strictEqual(assignCalls.length, 1);
    assert.strictEqual(assignCalls[0][0], company.id);
    assert.strictEqual(assignCalls[0][1], 2026, 'l\'année transmise au serveur doit être celle de la date d\'embauche, pas l\'année courante');
  }

  // ---- Compteur cumulatif pour la MÊME année (2ᵉ salarié 2026 → 0002) ----
  {
    const emp = await DB.addEmployee({ nom: 'Deux', prenom: 'Test', email: 'deux@test.local', dateEmbauche: '2026-06-01' });
    assert.strictEqual(emp.matricule, '2026-0002');
  }

  // ---- Un compteur DISTINCT par année — un salarié embauché en 2019 ne consomme pas la séquence 2026 ----
  {
    const emp2019 = await DB.addEmployee({ nom: 'Ancien', prenom: 'Test', email: 'ancien@test.local', dateEmbauche: '2019-01-10' });
    assert.strictEqual(emp2019.matricule, '2019-0001', 'un embauché de 2019 doit repartir à 0001 sur SA propre année, pas hériter du compteur 2026');
    const emp2026 = await DB.addEmployee({ nom: 'Trois', prenom: 'Test', email: 'trois@test.local', dateEmbauche: '2026-07-01' });
    assert.strictEqual(emp2026.matricule, '2026-0003', 'le compteur 2026 doit continuer sa propre séquence, non affecté par l\'ajout d\'un salarié 2019');
  }

  // ---- Séparateur configurable (settings.matriculeAvecTiret), jamais l'unicité elle-même ----
  {
    company.settings.matriculeAvecTiret = false;
    DB.saveCurrentCompany(company);
    const emp = await DB.addEmployee({ nom: 'Quatre', prenom: 'Test', email: 'quatre@test.local', dateEmbauche: '2026-01-01' });
    assert.strictEqual(emp.matricule, '20260004');
    company.settings.matriculeAvecTiret = true;
    DB.saveCurrentCompany(company);
  }

  // ---- data.matricule fourni (import "conserver les matricules du fichier") : AUCUN appel serveur ----
  {
    const before = assignCalls.length;
    const emp = await DB.addEmployee({ nom: 'Cinq', prenom: 'Test', email: 'cinq@test.local', dateEmbauche: '2026-01-01', matricule: 'ANCIEN-042' });
    assert.strictEqual(emp.matricule, 'ANCIEN-042');
    assert.strictEqual(assignCalls.length, before, 'un matricule fourni explicitement ne doit jamais déclencher d\'appel serveur');
  }

  // ---- Serveur injoignable : la création est BLOQUÉE, jamais un repli local (voir DB.assignMatricule)
  //      — contrairement à resolveWorkflowWithFallback, qui se replie toujours ; l'ancien calcul local
  //      (company.matriculeSeq) est précisément la cause du bug corrigé ici.
  {
    const previousImpl = assignImpl;
    assignImpl = async () => ({ success: false, error: 'Panne réseau simulée.' });
    let threw = false;
    try {
      await DB.addEmployee({ nom: 'Six', prenom: 'Test', email: 'six@test.local', dateEmbauche: '2026-01-01' });
    } catch (err) {
      threw = true;
      assert.strictEqual(err.message, 'Panne réseau simulée.');
    }
    assert.strictEqual(threw, true, 'un échec serveur doit bloquer la création (exception), jamais créer un salarié avec un matricule deviné localement');
    assert.strictEqual(DB.getEmployees().some(e => e.email === 'six@test.local'), false, 'aucun salarié ne doit être créé si l\'attribution du matricule échoue');
    assignImpl = previousImpl;
  }

  // ---- Import Excel : preserveMatricule=false ignore la colonne matricule du fichier (toujours auto) ----
  {
    const mapping = { matricule: 0, nom: 1, prenom: 2, email: 3, dateEmbauche: 4 };
    const rows = [['DOUBLON-1', 'Sept', 'Test', 'sept@test.local', '15/01/2026']];
    const preview = buildImportPreviewRows(rows, mapping, false);
    assert.strictEqual(preview[0].status, 'ok');
    assert.strictEqual(preview[0].record.matricule, '', 'preserveMatricule=false doit ignorer la colonne matricule du fichier, même non vide');
  }

  // ---- Import Excel : preserveMatricule=true + doublon avec un salarié EXISTANT → ligne rejetée ----
  {
    const realMatricule = (await DB.addEmployee({ nom: 'Huit', prenom: 'Test', email: 'huit@test.local', dateEmbauche: '2026-01-01' })).matricule;
    const mapping = { matricule: 0, nom: 1, prenom: 2, email: 3, dateEmbauche: 4 };
    const rows = [[realMatricule, 'Neuf', 'Test', 'neuf@test.local', '15/01/2026']];
    const preview = buildImportPreviewRows(rows, mapping, true);
    assert.strictEqual(preview[0].status, 'error', 'un matricule du fichier déjà utilisé par un salarié existant doit être rejeté (pas silencieusement écrasé)');
  }

  // ---- Import Excel : preserveMatricule=true + doublon ENTRE DEUX LIGNES du même fichier → la 2ᵉ rejetée ----
  {
    const mapping = { matricule: 0, nom: 1, prenom: 2, email: 3, dateEmbauche: 4 };
    const rows = [
      ['DIX-001', 'Dix', 'Un', 'dixun@test.local', '15/01/2026'],
      ['DIX-001', 'Dix', 'Deux', 'dixdeux@test.local', '16/01/2026'],
    ];
    const preview = buildImportPreviewRows(rows, mapping, true);
    assert.strictEqual(preview[0].status, 'ok');
    assert.strictEqual(preview[1].status, 'error', 'deux lignes du même fichier avec le même matricule : la première passe, la seconde est rejetée');
  }

  // ---- Import Excel : preserveMatricule=true + cellule matricule VIDE → jamais une erreur, auto-généré ----
  {
    const mapping = { matricule: 0, nom: 1, prenom: 2, email: 3, dateEmbauche: 4 };
    const rows = [['', 'Onze', 'Test', 'onze@test.local', '15/01/2026']];
    const preview = buildImportPreviewRows(rows, mapping, true);
    assert.strictEqual(preview[0].status, 'ok', 'une cellule matricule vide reste toujours auto-générée, même en mode "conserver"');
    assert.strictEqual(preview[0].record.matricule, '');
  }

  // ---- importEmployeesRows : une ligne dont l'attribution serveur échoue compte en erreur, pas en créée ----
  {
    const mapping = { matricule: 0, nom: 1, prenom: 2, email: 3, dateEmbauche: 4 };
    const rows = [
      ['', 'Douze', 'A', 'douzea@test.local', '15/01/2026'],
      ['', 'Douze', 'B', 'douzeb@test.local', '16/01/2026'],
    ];
    const preview = buildImportPreviewRows(rows, mapping, false);
    let call = 0;
    const previousImpl = assignImpl;
    assignImpl = async (companyId, year) => {
      call++;
      if (call === 1) return { success: false, error: 'panne' };
      counters[companyId + ':' + year] = (counters[companyId + ':' + year] || 0) + 1;
      return { success: true, number: counters[companyId + ':' + year] };
    };
    const results = await importEmployeesRows(preview);
    assert.strictEqual(results.created, 1, 'une seule des deux lignes doit être créée (la première échoue)');
    assert.strictEqual(results.errors, 1);
    assignImpl = previousImpl;
  }

  console.log('OK — matricule-numbering.test.js (compteur par année, séparateur configurable, blocage si serveur injoignable, import préserve/valide)');
}

runAsync().catch(err => {
  console.error('ÉCHEC — matricule-numbering.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
