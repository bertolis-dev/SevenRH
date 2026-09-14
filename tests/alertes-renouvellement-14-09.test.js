/**
 * Seven RH — retour Betty du 14/09/2026 (Module RH point 5, "alertes de renouvellement complètes") :
 * le seuil d'alerte (jours avant échéance) sur les documents à date d'expiration (permis,
 * habilitation, autorisation de conduite, visite médicale...) était fixé à 30 jours en dur. Devient
 * paramétrable par l'entreprise (settings.delaiPrevenanceDocumentsJours), appliqué à la fois au badge
 * de la fiche salarié et à la notification générée par syncNotifications — les deux doivent
 * s'accorder, sinon une notification apparaît sans jamais montrer le badge correspondant (ou l'inverse).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function dansNJours(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

async function run() {
  // ---- documentExpirationInfo respecte le seuil passé, jamais un 30 fixe caché ----
  {
    const { documentExpirationInfo } = loadAppJs();
    const dansQuaranteCinqJours = dansNJours(45);
    assert.strictEqual(documentExpirationInfo(dansQuaranteCinqJours, 30).level, 'muted', 'avec un seuil de 30 jours, une échéance à 45 jours ne doit pas encore alerter');
    assert.strictEqual(documentExpirationInfo(dansQuaranteCinqJours, 60).level, 'warning', 'avec un seuil de 60 jours (ex. CACES), la même échéance à 45 jours doit déjà alerter');
    // Repli à 30 si le paramètre est absent (entreprise jamais resauvegardée depuis ce correctif).
    assert.strictEqual(documentExpirationInfo(dansNJours(20), undefined).level, 'warning');
  }

  // ---- "Autorisation de conduite" fait partie des catégories par défaut ----
  {
    const { DB, sandbox } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const settings = DB.getSettings();
    assert.ok(settings.categoriesDocuments.includes('Autorisation de conduite'), 'la catégorie doit exister par défaut, sans que l\'entreprise ait besoin de la créer elle-même');
  }

  // ---- Le badge de la fiche ET la notification s'accordent sur le MÊME seuil configuré ----
  {
    const { DB, sandbox, documentRepository, renderEmployeeDetail, syncNotifications } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({
      async resolveValidatorEmployeeIdsForStep() { throw new Error('mock : indisponible en test'); },
    }, { get(target, prop) { return prop in target ? target[prop] : async () => ({ success: true }); } });
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');

    // Seuil élevé à 60 jours (ex. CACES à renouveler avec un préavis long) — une échéance à 45 jours
    // doit alerter, alors qu'elle ne l'aurait pas fait avec l'ancien 30 fixe.
    const settings = DB.getSettings();
    settings.delaiPrevenanceDocumentsJours = 60;
    DB.saveSettings(settings);

    documentRepository.create({ employeeId: salarie.id, categorie: 'Autorisation de conduite', nom: 'CACES R489', dateExpiration: dansNJours(45) });

    const html = renderEmployeeDetail(salarie.id);
    assert.ok(html.includes('badge-warning'), 'le badge doit signaler l\'échéance à 45 jours avec un seuil configuré à 60');

    await syncNotifications();
    const notifs = DB.getNotifications().filter(n => n.sourceKey.startsWith('document-expiry-'));
    assert.strictEqual(notifs.length, 1, 'la notification doit être générée avec ce même seuil de 60 jours, pas l\'ancien 30 fixe');
  }

  console.log('OK — alertes-renouvellement-14-09.test.js (seuil paramétrable respecté par le badge ET la notification, "Autorisation de conduite" en catégorie par défaut)');
}

run().catch((err) => {
  console.error('ÉCHEC — alertes-renouvellement-14-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
