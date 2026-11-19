/**
 * Retour du 19/11/2026 : après l'import de 101 congés, le bandeau rouge « 101 lignes refusées sur 101 (leave_requests), première erreur : duplicate key value violates
 * unique constraint "leave_requests_pkey" » restait affiché, et « Réessayer maintenant » ne changeait rien : les 101 lignes étaient pourtant bien sur le serveur.
 * Une ligne dont l'id existe déjà (code 23505) a été enregistrée par une tentative précédente : ce n'est pas un échec. Seules les vraies erreurs doivent remonter.
 */
const assert = require('assert');
const { loadSupabaseClient } = require('./load-supabase-client');

function fabrique(reponseParId) {
  const appels = [];
  const supabase = {
    auth: { onAuthStateChange: () => {} },
    from: () => ({
      insert: (row) => {
        appels.push(row.id);
        const erreur = reponseParId(row.id);
        return Promise.resolve({ error: erreur || null });
      }
    })
  };
  return { supabase, appels };
}

const doublon = { code: '23505', message: 'duplicate key value violates unique constraint "leave_requests_pkey"' };
const refus = { code: '42501', message: 'new row violates row-level security policy for table "leave_requests"' };

async function run() {
  const demandes = (n) => Array.from({ length: n }, (_, i) => ({ id: 'lr_' + i, employeeId: 'e1', typeId: 't1', dateDebut: '2026-09-02', dateFin: '2026-09-02', nbJours: 1, statut: 'Validé' }));

  // 1. Toutes les lignes existent déjà : la nouvelle tentative réussit.
  {
    const { supabase, appels } = fabrique(() => doublon);
    const client = loadSupabaseClient({ supabase });
    await client.sandbox.window.SupabaseSync.pushLeaveRequests({ added: demandes(101), modified: [] }, 'co1');
    assert.strictEqual(appels.length, 101, 'les 101 lignes sont bien tentées');
  }

  // 2. Un doublon mêlé à un vrai refus : seul le vrai refus remonte (le doublon n'est pas compté).
  {
    const { supabase } = fabrique(id => (id === 'lr_3' ? refus : doublon));
    const client = loadSupabaseClient({ supabase });
    let erreur = null;
    try { await client.sandbox.window.SupabaseSync.pushLeaveRequests({ added: demandes(5), modified: [] }, 'co1'); } catch (err) { erreur = err; }
    assert.ok(erreur, 'un vrai refus doit toujours remonter');
    assert.strictEqual(erreur.code, '42501', 'l\'erreur remontée est le vrai refus, pas le doublon');
  }

  // 3. Aucune ligne en doublon, une seule en échec : comportement inchangé.
  {
    const { supabase } = fabrique(id => (id === 'lr_1' ? refus : null));
    const client = loadSupabaseClient({ supabase });
    let erreur = null;
    try { await client.sandbox.window.SupabaseSync.pushLeaveRequests({ added: demandes(3), modified: [] }, 'co1'); } catch (err) { erreur = err; }
    assert.ok(erreur && erreur.code === '42501');
  }

  console.log('doublon-nouvelle-tentative-19-11 : OK');
}

run().catch(err => { console.error(err); process.exit(1); });
