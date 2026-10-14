/**
 * Seven RH — point en attente de la revue du 13/10/2026, traité le 14/10 (migration 0074) : la rémunération (salaire, historique,
 * primes, part variable, avantages ; fiche, contrats, avenants) et les campagnes de révision salariale ne sont plus dans la fiche
 * lisible par l'API mais dans deux tables réservées au droit « voir les informations financières ». Le site recompose la fiche à la
 * lecture, reste compatible tant que la migration n'est pas appliquée, et n'envoie jamais de valeurs par défaut quand la lecture a échoué.
 */
const assert = require('assert');
const { loadSupabaseClient } = require('./load-supabase-client');

// Faux client Supabase : un constructeur de requêtes qui répond avec les tables fournies.
function fauxSupabase(tables, erreurs) {
  const builder = (table) => {
    const etat = { table, single: false, eqs: {} };
    const b = new Proxy({}, {
      get: (_, prop) => {
        if (prop === 'then') {
          return (resolve, reject) => {
            if (erreurs && erreurs[etat.table]) return resolve({ data: null, error: erreurs[etat.table] });
            const lignes = tables[etat.table] || [];
            if (etat.single) {
              const ligne = etat.table === 'employees' && etat.eqs.auth_user_id ? tables.moi : lignes[0];
              return resolve({ data: ligne || null, error: null });
            }
            return resolve({ data: lignes, error: null });
          };
        }
        if (prop === 'maybeSingle' || prop === 'single') return () => { etat.single = true; return b; };
        if (prop === 'eq') return (col, val) => { etat.eqs[col] = val; return b; };
        return () => b;
      }
    });
    return b;
  };
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u-moi' } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    from: builder,
    rpc: async () => ({ data: [], error: null })
  };
}

const ficheE4 = {
  id: 'E4', company_id: 'C1', email: 'a@x', role: 'salarie', nom: 'A', prenom: 'A', manager_ids: [], archive: false, permissions_overrides: {}, auth_user_id: 'u-moi',
  data: {
    poste: 'Dev',
    contrats: [{ id: 'c1', dateDebut: '2024-01-01' }, { id: 'c2', dateDebut: '2026-01-01' }],
    avenants: [{ id: 'av1', type: 'Salaire', champModifie: 'salaireBrutMensuel', nouvelleValeur: null }, { id: 'av3', champModifie: 'poste', nouvelleValeur: 'Lead' }]
  }
};
const priveE4 = {
  salaireBrutMensuel: 2800, historiqueSalaire: [{ ancienMontant: 2500, nouveauMontant: 2800 }], nombreMoisSalaire: 13, partVariable: '5%',
  contrats: { c1: { salaireBrutMensuel: 2400 }, c2: { salaireBrutMensuel: 2800, nombreMoisSalaire: 13 } },
  avenants: { av1: 2800 }
};

async function hydrater(tables, erreurs) {
  const base = { companies: [{ id: 'C1', raison_sociale: 'Test', data: { reglage: 1 } }], employees: [ficheE4], moi: ficheE4 };
  const client = loadSupabaseClient({ supabase: fauxSupabase({ ...base, ...tables }, erreurs) });
  const entreprise = await client.sandbox.window.SupabaseSync.hydrateCurrentCompany();
  return { client, entreprise };
}

async function run() {
  // 1. fusion pure
  {
    const { appliquerRemuneration, employeeFromRow } = loadSupabaseClient();
    const fiche = employeeFromRow(ficheE4);
    const complete = appliquerRemuneration(fiche, priveE4);
    assert.strictEqual(complete.salaireBrutMensuel, 2800);
    assert.strictEqual(complete.nombreMoisSalaire, 13);
    assert.strictEqual(complete.partVariable, '5%');
    assert.strictEqual(complete.historiqueSalaire.length, 1);
    assert.strictEqual(complete.contrats[0].salaireBrutMensuel, 2400, 'salaire du contrat c1 recomposé');
    assert.strictEqual(complete.contrats[1].salaireBrutMensuel, 2800);
    assert.strictEqual(complete.contrats[1].dateDebut, '2026-01-01', 'le reste du contrat est conservé');
    assert.strictEqual(complete.avenants[0].nouvelleValeur, 2800, 'valeur de l\'avenant de salaire recomposée');
    assert.strictEqual(complete.avenants[1].nouvelleValeur, 'Lead', 'un avenant non financier reste tel quel');
    assert.strictEqual(appliquerRemuneration(fiche, null), fiche, 'rien à fusionner : fiche inchangée');
    assert.strictEqual(fiche.salaireBrutMensuel, 0, 'la fiche d\'origine n\'est pas modifiée');
    console.log('OK — remuneration-separee-14-10.test.js (fusion : fiche, contrats, avenants)');
  }

  // 2. compte autorisé : tout est recomposé, campagnes comprises
  {
    const { entreprise } = await hydrater({
      employee_remuneration: [{ employee_id: 'E4', company_id: 'C1', data: priveE4 }],
      company_remuneration: [{ company_id: 'C1', data: { campagnesRevisionSalariale: [{ id: 'cr1', nom: 'Révision 2026' }] } }]
    });
    const e = entreprise.employees[0];
    assert.strictEqual(e.salaireBrutMensuel, 2800);
    assert.strictEqual(e.contrats[1].salaireBrutMensuel, 2800);
    assert.strictEqual(entreprise.campagnesRevisionSalariale[0].nom, 'Révision 2026', 'campagnes lues dans leur table');
    assert.strictEqual(entreprise.reglage, 1, 'le reste du bloc entreprise est intact');
    console.log('OK — remuneration-separee-14-10.test.js (compte autorisé : salaires et campagnes recomposés à la connexion)');
  }

  // 3. compte sans droit : aucune ligne, la fiche reste sans salaire
  {
    const { entreprise } = await hydrater({ employee_remuneration: [], company_remuneration: [] });
    assert.strictEqual(entreprise.employees[0].salaireBrutMensuel, 0, 'aucun salaire visible sans le droit');
    assert.strictEqual(entreprise.campagnesRevisionSalariale, undefined, 'aucune campagne sans le droit');
    console.log('OK — remuneration-separee-14-10.test.js (compte sans droit : ni salaire ni campagne)');
  }

  // 4. migration pas encore appliquée : table absente = comportement d'avant, rien n'est cassé
  {
    const absente = { code: 'PGRST205', message: "Could not find the table 'public.employee_remuneration' in the schema cache" };
    const ancien = { ...ficheE4, data: { ...ficheE4.data, salaireBrutMensuel: 2500 } };
    const { client, entreprise } = await hydrater({ employees: [ancien], moi: ancien }, { employee_remuneration: absente, company_remuneration: { ...absente, message: "relation \"company_remuneration\" does not exist", code: '42P01' } });
    assert.strictEqual(entreprise.employees[0].salaireBrutMensuel, 2500, 'avant la migration : le salaire encore dans la fiche reste lu');
    const ligne = client.employeeToRow(entreprise.employees[0], 'C1');
    assert.strictEqual(ligne.data.salaireBrutMensuel, 2500, 'et reste envoyé tel quel (le serveur le rangera après la migration)');
    console.log('OK — remuneration-separee-14-10.test.js (avant la migration : comportement d\'avant, rien de cassé)');
  }

  // 5. lecture en échec (autre erreur) : on n'envoie plus de valeurs par défaut qui écraseraient les vrais salaires
  {
    const { client, entreprise } = await hydrater({}, { employee_remuneration: { code: '500', message: 'boom' } });
    const ligne = client.employeeToRow(entreprise.employees[0], 'C1');
    ['salaireBrutMensuel', 'historiqueSalaire', 'nombreMoisSalaire', 'primesRecurrentes', 'partVariable', 'avantagesNature'].forEach(k =>
      assert.ok(!(k in ligne.data), `${k} n'est pas renvoyé quand la rémunération n'a pas pu être lue`));
    ligne.data.contrats.forEach(c => assert.ok(!('salaireBrutMensuel' in c), 'ni le salaire des contrats'));
    assert.strictEqual(ligne.data.poste, 'Dev', 'le reste de la fiche part normalement');
    // et une lecture réussie ensuite rétablit l'envoi normal
    const { client: client2, entreprise: ent2 } = await hydrater({ employee_remuneration: [{ employee_id: 'E4', company_id: 'C1', data: priveE4 }] });
    assert.strictEqual(client2.employeeToRow(ent2.employees[0], 'C1').data.salaireBrutMensuel, 2800);
    console.log('OK — remuneration-separee-14-10.test.js (lecture en échec : aucune valeur par défaut renvoyée au serveur)');
  }

  // 6. la migration et ses garde-fous sont bien dans le dépôt
  {
    const sql = require('fs').readFileSync(require('path').join(__dirname, '..', 'supabase', 'migrations', '0074_remuneration_separee.sql'), 'utf8');
    assert.ok(/create trigger employees_separer_remuneration_trg/.test(sql) && /create trigger companies_separer_remuneration_trg/.test(sql));
    assert.ok(/revoke all on employee_remuneration from anon, authenticated/.test(sql), 'aucune écriture directe pour les utilisateurs');
    assert.ok(/has_permission\('voirInfosFinancieres'\)/.test(sql));
    console.log('OK — remuneration-separee-14-10.test.js (migration 0074 : déclencheurs et droits présents)');
  }
}

run().catch(err => { console.error('ÉCHEC — remuneration-separee-14-10.test.js'); console.error(err.stack || err.message); process.exitCode = 1; });
