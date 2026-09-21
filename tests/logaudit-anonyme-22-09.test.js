/**
 * Seven RH — revue de bugs du 22/09/2026 ("fais vraiment un tour bout par bout de toute
 * l'application et le site") : trouvé en testant réellement la page d'accueil publique dans le
 * navigateur intégré (pas seulement en lisant le code) — un visiteur JAMAIS connecté voyait
 * apparaître le bandeau "Échec de synchronisation en ligne : ... Ne fermez pas cette page" dès le
 * premier chargement, sans avoir rien fait.
 *
 * Cause : DB.init() sème toujours une entreprise de démonstration en local (localStorage),
 * MÊME sur la page d'accueil publique, avant tout login. `company` existe donc déjà quand
 * reportClientError() (déclenché ici par un simple rejet de promesse sans rapport, ex. un souci
 * d'enregistrement du service worker) appelle DB.logAudit() — qui tentait alors de pousser
 * l'entrée vers Supabase SANS utilisateur authentifié, systématiquement rejeté par la policy RLS de
 * audit_log (code 42501). Vérifié en direct : après correctif, le bandeau n'apparaît plus sur un
 * chargement propre de la page d'accueil.
 */
const assert = require('assert');
const { loadDataJs } = require('./load-data-js');

function run() {
  const { DB, sandbox } = loadDataJs();
  let pushAttempted = false;
  sandbox.window.SupabaseSync = new Proxy({}, {
    get(target, prop) {
      if (prop === 'pushAuditLogEntry') return async () => { pushAttempted = true; return { success: true }; };
      return async () => ({ success: true });
    }
  });
  DB.init();
  // Aucun DB._currentEmployeeId posé : reproduit exactement un visiteur de la page d'accueil, jamais
  // connecté, alors qu'une entreprise de démonstration existe déjà en local (voir DB.init()).
  assert.strictEqual(DB.getCurrentUser(), null, 'préalable du test : aucun utilisateur ne doit être connecté');

  DB.logAudit('Erreur', 'Application', 'unhandledrejection : test', '');
  assert.strictEqual(pushAttempted, false, 'logAudit ne doit jamais tenter de pousser vers Supabase sans utilisateur authentifié (sinon rejeté par la policy RLS de audit_log, provoquant le bandeau "Échec de synchronisation" pour un visiteur qui n\'a pourtant rien à synchroniser)');

  const company = DB.getCurrentCompany();
  assert.ok((company.auditLog || []).some(e => e.details === '' || e.entite === 'Application'), 'l\'entrée doit tout de même rester journalisée localement, seule la tentative réseau est sautée');

  // Contrôle positif : avec un utilisateur réellement connecté, la tentative de push doit avoir lieu
  // comme avant (comportement normal d'une session authentifiée, non régressé).
  DB._currentEmployeeId = DB.getEmployees()[0].id;
  DB.logAudit('Création', 'Test', 'contrôle positif');
  assert.strictEqual(pushAttempted, true, 'avec un utilisateur connecté, logAudit doit continuer à pousser vers Supabase normalement');

  console.log('OK — logaudit-anonyme-22-09.test.js (logAudit ne pousse plus vers Supabase pour un visiteur jamais connecté, reste local ; comportement normal préservé pour une session authentifiée)');
}

try {
  run();
} catch (err) {
  console.error('ÉCHEC — logaudit-anonyme-22-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
