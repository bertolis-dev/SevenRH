/**
 * Seven RH — retour Betty du 14/09/2026 (Module RH point 4, "accusé de lecture") : quand
 * l'entreprise remet un document nécessitant confirmation (règlement intérieur, note de service...),
 * elle doit pouvoir prouver que le salarié en a pris connaissance. Un horodatage + une confirmation
 * suffisent (pas de signature électronique, chantier séparé). La confirmation ne peut venir QUE du
 * salarié concerné lui-même — jamais RH/Propriétaire à sa place, sinon la preuve ne vaut plus rien.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function run() {
  // ---- Document sans accusé requis : jamais de badge ni de bouton, comportement d'avant inchangé ----
  {
    const { DB, sandbox, documentRepository, renderEmployeeDetail } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    documentRepository.create({ employeeId: salarie.id, categorie: 'Administratif', nom: 'Carte vitale' });

    const html = renderEmployeeDetail(salarie.id);
    assert.ok(!html.includes('En attente de lecture') && !html.includes("J'en ai pris connaissance"), 'un document ordinaire ne doit jamais afficher de badge ou de bouton d\'accusé de lecture');
  }

  // ---- Document nécessitant un accusé : badge "en attente" visible par RH, mais PAS de bouton de
  // confirmation pour RH — seul le salarié concerné peut confirmer ----
  {
    const { DB, sandbox, documentRepository, renderEmployeeDetail } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    const doc = documentRepository.create({ employeeId: salarie.id, categorie: 'Règlement', nom: 'Règlement intérieur', accuseLectureRequis: true });

    const htmlRh = renderEmployeeDetail(salarie.id);
    assert.ok(htmlRh.includes('En attente de lecture'), 'RH doit voir que la confirmation est en attente');
    assert.ok(!htmlRh.includes("J'en ai pris connaissance"), 'RH ne doit jamais voir le bouton de confirmation à la place du salarié');

    // Le salarié consulte SA PROPRE fiche : le bouton doit apparaître.
    DB._currentEmployeeId = salarie.id;
    const htmlSalarie = renderEmployeeDetail(salarie.id);
    assert.ok(htmlSalarie.includes("J'en ai pris connaissance"), 'le salarié concerné doit voir le bouton de confirmation sur son propre document');
    assert.ok(htmlSalarie.includes(`data-confirmer-accuse-lecture="${doc.id}"`), 'le bouton doit cibler le bon document');
  }

  // ---- Confirmation : seul le salarié concerné peut confirmer, jamais un tiers (RH y compris) ----
  {
    const { DB, sandbox, documentRepository, confirmerAccuseLectureDocument } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    const doc = documentRepository.create({ employeeId: salarie.id, categorie: 'Règlement', nom: 'Règlement intérieur', accuseLectureRequis: true });

    // RH tente de confirmer À LA PLACE du salarié : doit être refusé, jamais enregistré.
    DB._currentEmployeeId = rh.id;
    confirmerAccuseLectureDocument(doc.id);
    assert.strictEqual(documentRepository.getById(doc.id).accuseLectureAt, null, 'RH ne doit jamais pouvoir confirmer à la place du salarié, même en appelant la fonction directement');

    // Le salarié concerné confirme : horodatage + auteur enregistrés.
    DB._currentEmployeeId = salarie.id;
    confirmerAccuseLectureDocument(doc.id);
    const docConfirme = documentRepository.getById(doc.id);
    assert.ok(docConfirme.accuseLectureAt, 'la confirmation par le bon salarié doit enregistrer un horodatage');
    assert.strictEqual(docConfirme.accuseLecturePar, salarie.id);

    // Une seconde tentative (déjà confirmé) ne doit rien changer, ni planter.
    const horodatageInitial = docConfirme.accuseLectureAt;
    confirmerAccuseLectureDocument(doc.id);
    assert.strictEqual(documentRepository.getById(doc.id).accuseLectureAt, horodatageInitial, 'une confirmation déjà enregistrée ne doit jamais être écrasée par une seconde tentative');
  }

  console.log('OK — accuse-lecture-14-09.test.js (badge en attente, bouton réservé au salarié concerné, confirmation jamais usurpable ni écrasée)');
}

run().catch((err) => {
  console.error('ÉCHEC — accuse-lecture-14-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
