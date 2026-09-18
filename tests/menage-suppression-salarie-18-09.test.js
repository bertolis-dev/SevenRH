/**
 * Seven RH — retour Betty du 18/09/2026, point 9 ("ménage") : trois correctifs indépendants trouvés
 * en creusant sa question "que devient réellement congés/notes de frais/documents quand on supprime
 * un salarié ?" (voir deleteEmployee, data.js : la réponse factuelle est que tout est bien détecté et
 * transmis à Supabase via saveLeaveRequests/saveExpenses/saveDocuments, qui suppriment réellement les
 * lignes retirées côté serveur, pas seulement en local, pas une reprise à faire ici) :
 *   1. "rien n'empêche actuellement un Propriétaire de supprimer sa propre fiche" : confirmé, corrigé
 *      côté client (canDeleteEmployeeRecord) ET côté serveur (migration 0060, la policy employees_delete
 *      ne l'excluait pas non plus, un simple bouton caché n'aurait rien empêché via un appel direct).
 *   2. le droit "Supprimer définitivement un salarié" ne doit jamais être accordable comme exception
 *      individuelle (déjà réservé au Propriétaire par défaut, ce qui reste vrai).
 *   3. la confirmation de suppression doit expliquer l'archivage (chemin normal) et l'obligation de
 *      conservation de 5 ans du registre, et exiger de taper le nom du salarié.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAppJs } = require('./load-app-js');

function setupFiche() {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  const proprietaire = api.DB.getEmployees().find(e => e.role === 'proprietaire');
  const salarie = api.DB.getEmployees().find(e => e.role === 'salarie');
  return { ...api, proprietaire, salarie };
}

async function runAutoSuppressionImpossibleCoteClient() {
  const { renderEmployeeDetail, DB, proprietaire } = setupFiche();
  DB._currentEmployeeId = proprietaire.id;

  const htmlSurSoiMeme = renderEmployeeDetail(proprietaire.id);
  assert.ok(!htmlSurSoiMeme.includes('id="btn-delete-employee"'), 'un Propriétaire consultant SA PROPRE fiche ne doit jamais voir le bouton "Supprimer" (irréversible, laisserait l\'entreprise sans Propriétaire)');

  console.log('OK — menage-suppression-salarie-18-09.test.js (auto-suppression impossible côté client)');
}

async function runSuppressionDeQuelquUnDAutreResteProposee() {
  // Non-régression : la restriction ne doit viser QUE soi-même, jamais bloquer la suppression légitime
  // d'un autre salarié par qui a le droit.
  const { renderEmployeeDetail, DB, proprietaire, salarie } = setupFiche();
  DB._currentEmployeeId = proprietaire.id;

  const htmlAutrui = renderEmployeeDetail(salarie.id);
  assert.ok(htmlAutrui.includes('id="btn-delete-employee"'), 'le Propriétaire doit garder la possibilité de supprimer la fiche de quelqu\'un d\'autre');

  console.log('OK — menage-suppression-salarie-18-09.test.js (non-régression : suppression de la fiche d\'un autre salarié toujours proposée)');
}

async function runAutoSuppressionBloqueeCoteServeurAussi() {
  // Un bouton caché côté client n'empêcherait rien via un appel API direct : la vraie policy RLS
  // (0002_rls_policies.sql) doit, elle aussi, exclure sa propre ligne, pas seulement l'affichage.
  const migration0002 = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '0002_rls_policies.sql'), 'utf8');
  assert.ok(migration0002.includes("create policy employees_delete on employees for delete"), 'contrôle : la policy employees_delete existe toujours à l\'emplacement attendu');

  const migration0060 = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '0060_interdire_auto_suppression_salarie.sql'), 'utf8');
  assert.ok(migration0060.includes('drop policy if exists employees_delete'), 'la migration doit remplacer la policy existante, pas en ajouter une seconde en parallèle');
  assert.ok(migration0060.includes("id <> current_employee_id()"), 'la policy corrigée doit explicitement exclure sa propre ligne, pas seulement compter sur has_permission');
  assert.ok(migration0060.includes("has_permission('supprimerSalarie')"), 'la condition de permission d\'origine doit être conservée, pas remplacée');

  console.log('OK — menage-suppression-salarie-18-09.test.js (auto-suppression aussi bloquée côté serveur, migration 0060)');
}

async function runDroitSuppressionJamaisAccordableEnException() {
  const { DB, proprietaire, employeeRepository, renderPermissionsIndividuellesCard } = setupFiche();
  DB._currentEmployeeId = proprietaire.id;
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');

  const html = renderPermissionsIndividuellesCard ? renderPermissionsIndividuellesCard(salarie) : null;
  if (html === null) {
    // Fonction non exposée par load-app-js.js : contrôle statique équivalent sur le code source,
    // plus robuste qu'un ajout d'exposition juste pour ce test.
    const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    const wiredStart = appSource.indexOf("const wired = [");
    const wiredEnd = appSource.indexOf('];', wiredStart);
    const wiredBlock = appSource.slice(wiredStart, wiredEnd);
    assert.ok(!wiredBlock.includes('PERMISSIONS.SUPPRIMER_SALARIE'), '"Supprimer définitivement un salarié" ne doit jamais apparaître dans la liste des permissions accordables en exception individuelle');
  } else {
    assert.ok(!html.includes('Supprimer définitivement'), '"Supprimer définitivement un salarié" ne doit jamais apparaître dans la liste des permissions accordables en exception individuelle');
  }

  console.log('OK — menage-suppression-salarie-18-09.test.js (suppression de salarié jamais accordable en exception individuelle)');
}

async function runModaleDeConfirmationExpliqueEtExigeLeNom() {
  // openConfirmerSuppressionSalarieModal n'est pas exposée (fonction d'écran, comme les autres
  // modales de ce fichier) : contrôle statique du contenu réellement affiché, même esprit que
  // runFonctionServeurQuantiteGeneralisee (abonnement-quantite-par-module-16-09.test.js).
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const fnStart = appSource.indexOf('function openConfirmerSuppressionSalarieModal(');
  assert.ok(fnStart !== -1, 'openConfirmerSuppressionSalarieModal doit exister');
  const fnBody = appSource.slice(fnStart, fnStart + 2200);

  assert.ok(fnBody.includes('archiver'), 'la modale doit rappeler que l\'archivage est le chemin normal pour un départ');
  assert.ok(fnBody.includes('5 ans'), 'la modale doit citer l\'obligation légale de conservation de 5 ans (registre unique du personnel)');
  assert.ok(fnBody.includes('f-confirmation-suppression'), 'un champ de saisie du nom doit exister');
  assert.ok(fnBody.includes("input.value.trim() !== nomAttendu"), 'le bouton de confirmation ne doit s\'activer QUE si le nom tapé correspond exactement, jamais par défaut');
  assert.ok(fnBody.includes('disabled'), 'le bouton de confirmation doit être désactivé par défaut, avant toute saisie');

  console.log('OK — menage-suppression-salarie-18-09.test.js (modale de confirmation : archivage rappelé, obligation de 5 ans citée, nom exigé)');
}

runAutoSuppressionImpossibleCoteClient()
  .then(runSuppressionDeQuelquUnDAutreResteProposee)
  .then(runAutoSuppressionBloqueeCoteServeurAussi)
  .then(runDroitSuppressionJamaisAccordableEnException)
  .then(runModaleDeConfirmationExpliqueEtExigeLeNom)
  .catch((err) => {
    console.error('ÉCHEC — menage-suppression-salarie-18-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
