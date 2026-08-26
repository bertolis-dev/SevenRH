/**
 * Seven RH — teste la régression du point B.2 (retour QA du 26/08/2026) : ensureDefaultLeaveTypesBackfilled
 * s'exécutait pour N'IMPORTE QUEL rôle, alors que la policy RLS leave_types_write exige gererParametres —
 * pour un salarié/manager, l'écriture serveur était silencieusement rejetée, laissant le cache local
 * avec des types de congés dont l'ID n'existe pas côté serveur (toute demande posée sur un de ces types
 * finit rejetée par la contrainte de clé étrangère). Deuxième défaut, permanent : la comparaison par
 * NOM SEUL ne distingue pas "jamais existé" de "existait puis a été supprimé volontairement" — un type
 * par défaut supprimé exprès (ex. "Sans solde") revenait à la connexion RH suivante.
 */
const assert = require('assert');
const { loadDataJs } = require('./load-data-js');

function installSupabaseSyncMock(sandbox) {
  const calls = { pushedLeaveTypes: null, pushedCompanyProfile: null };
  sandbox.window.SupabaseSync = {
    async pushLeaveTypes(leaveTypes) { calls.pushedLeaveTypes = leaveTypes; },
    async pushCompanyProfile(id, raisonSociale, data) { calls.pushedCompanyProfile = data; },
  };
  return calls;
}

async function run() {
  const { sandbox, ensureDefaultLeaveTypesBackfilled } = loadDataJs();

  // Cas 1 : un salarié (pas de gererParametres) ne doit produire AUCUN effet, ni local ni serveur —
  // sinon son cache se retrouve avec des types que le serveur a rejetés silencieusement.
  {
    const calls = installSupabaseSyncMock(sandbox);
    const salarieUser = { id: 'x', role: 'salarie' };
    const company = { id: 'c1', leaveTypes: [{ nom: 'Congés payés', ordre: 0 }], defaultLeaveTypesSeeded: undefined };
    await ensureDefaultLeaveTypesBackfilled(company, salarieUser);
    assert.strictEqual(company.leaveTypes.length, 1, 'un salarié ne doit jamais déclencher le backfill (types modifiés localement)');
    assert.strictEqual(company.defaultLeaveTypesSeeded, undefined, 'un salarié ne doit jamais déclencher le backfill (seeded modifié)');
    assert.strictEqual(calls.pushedLeaveTypes, null, 'un salarié ne doit jamais écrire les types de congés côté serveur');
    assert.strictEqual(calls.pushedCompanyProfile, null, 'un salarié ne doit jamais écrire le profil entreprise côté serveur');
  }

  // Cas 2 : un RH (a gererParametres) doit voir le backfill s'exécuter normalement, avec la liste
  // "déjà proposés" persistée pour éviter de le refaire à chaque connexion.
  let seededAfterRh;
  {
    const calls = installSupabaseSyncMock(sandbox);
    const rhUser = { id: 'y', role: 'rh' };
    const company = { id: 'c2', leaveTypes: [{ nom: 'Congés payés', ordre: 0 }], defaultLeaveTypesSeeded: undefined };
    await ensureDefaultLeaveTypesBackfilled(company, rhUser);
    assert.ok(company.leaveTypes.length > 1, 'un RH doit déclencher le backfill des types manquants');
    assert.ok(Array.isArray(company.defaultLeaveTypesSeeded) && company.defaultLeaveTypesSeeded.length > 0,
      'la liste des types déjà proposés doit être persistée après un backfill RH');
    assert.ok(calls.pushedLeaveTypes, 'un RH doit effectivement écrire les nouveaux types côté serveur');
    assert.ok(calls.pushedCompanyProfile && Array.isArray(calls.pushedCompanyProfile.defaultLeaveTypesSeeded),
      'le profil entreprise poussé doit inclure la liste des types déjà proposés');
    seededAfterRh = { leaveTypes: company.leaveTypes, seeded: company.defaultLeaveTypesSeeded };
  }

  // Cas 3 : une suppression volontaire d'un type par défaut ("Sans solde") ne doit JAMAIS être
  // ré-importée à la connexion RH suivante, même si le nom ne réapparaît dans aucune liste locale.
  {
    const calls = installSupabaseSyncMock(sandbox);
    const rhUser = { id: 'y', role: 'rh' };
    const company = {
      id: 'c3',
      leaveTypes: seededAfterRh.leaveTypes.filter(t => t.nom.trim().toLowerCase() !== 'sans solde'),
      defaultLeaveTypesSeeded: [...seededAfterRh.seeded],
    };
    const countBefore = company.leaveTypes.length;
    await ensureDefaultLeaveTypesBackfilled(company, rhUser);
    assert.strictEqual(company.leaveTypes.length, countBefore, 'un type supprimé volontairement ne doit jamais être ré-ajouté');
    assert.ok(!company.leaveTypes.some(t => t.nom.trim().toLowerCase() === 'sans solde'), '"Sans solde" doit rester absent après une nouvelle connexion RH');
    assert.strictEqual(calls.pushedLeaveTypes, null, 'rien de nouveau à écrire : aucun push de types ne doit avoir lieu');
    assert.strictEqual(calls.pushedCompanyProfile, null, 'rien de nouveau à écrire : aucun push de profil ne doit avoir lieu');
  }

  console.log('OK — leave-types-backfill.test.js (permission gate, backfill normal, non-résurrection)');
}

run().catch((err) => {
  console.error('ÉCHEC — leave-types-backfill.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
