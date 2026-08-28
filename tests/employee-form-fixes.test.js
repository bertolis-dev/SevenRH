/**
 * Seven RH — retour QA du 27/08/2026 sur la création de salariés, 4 points :
 * 1. "Le statut « cadre » n'apparaît pas dans la liste déroulante"
 * 2. "La convention collective n'existe pas encore non plus"
 * 3. "Il faudrait pouvoir mettre un chiffre à virgule pour les horaires hebdomadaires"
 * 4. "la RH ne peut pas modifier sa propre fiche il faut changer ça"
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadDataJs } = require('./load-data-js');
const { loadAppJs } = require('./load-app-js');

async function run() {
  // ---- Point 1 : deriveCategoriesSalarieFromStatutPro inclut toujours le socle standard ----
  {
    const { deriveCategoriesSalarieFromStatutPro, DEFAULT_SETTINGS } = loadDataJs();

    // Aucun salarié encore créé : le socle standard complet doit être là, "Cadre" y compris.
    const vide = deriveCategoriesSalarieFromStatutPro([]);
    DEFAULT_SETTINGS.statutsPro.forEach(nom => {
      assert.ok(vide.some(c => c.nom === nom), `catégorie standard "${nom}" doit être proposée même sans aucun salarié`);
    });

    // Des salariés déjà créés avec un statutPro hors socle (personnalisation) : le socle reste
    // présent EN PLUS, rien n'est perdu.
    const avecPerso = deriveCategoriesSalarieFromStatutPro([{ statutPro: 'Alternant' }, { statutPro: 'Cadre' }]);
    assert.ok(avecPerso.some(c => c.nom === 'Cadre'), '"Cadre" doit rester présent quand des salariés l\'utilisent déjà');
    assert.ok(avecPerso.some(c => c.nom === 'Alternant'), 'une catégorie personnalisée déjà en usage ne doit pas être perdue');
    assert.ok(avecPerso.some(c => c.nom === 'Non cadre'), '"Non cadre" (socle standard) doit rester proposé même si aucun salarié ne l\'utilise encore');
    // Pas de doublon si un salarié utilise déjà une catégorie du socle standard.
    assert.strictEqual(avecPerso.filter(c => c.nom === 'Cadre').length, 1, 'pas de doublon "Cadre"');
  }

  // ---- Point 2 : conventions collectives, backfill d'une liste figée/dégradée ----
  {
    const { DB, sandbox, DEFAULT_SETTINGS } = loadDataJs();
    sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
    DB.init();
    const company = DB.getCurrentCompany();
    // Simule une entreprise dont settings.conventionsCollectives a été figé, à la création, à une
    // liste bien plus courte que la liste officielle actuelle (exactement le scénario "n'existe pas
    // encore") — avec une convention ajoutée manuellement par l'entreprise, qui ne doit pas se perdre.
    company.settings.conventionsCollectives = ['Aucune', 'Ma convention perso'];
    DB.saveCurrentCompany(company);

    const settings = DB.getSettings();
    DEFAULT_SETTINGS.conventionsCollectives.forEach(nom => {
      assert.ok(settings.conventionsCollectives.includes(nom), `convention officielle "${nom}" doit être présente après backfill`);
    });
    assert.ok(settings.conventionsCollectives.includes('Ma convention perso'), 'une convention ajoutée manuellement par l\'entreprise ne doit pas être perdue par le backfill');

    // Idempotent : un deuxième appel ne duplique rien.
    const settings2 = DB.getSettings();
    const occurrences = settings2.conventionsCollectives.filter(c => c === 'Aucune').length;
    assert.strictEqual(occurrences, 1, 'pas de doublon "Aucune" après plusieurs lectures');
  }

  // ---- Point 3 : le champ horaires hebdomadaires accepte la virgule décimale française ----
  {
    const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    assert.ok(
      /id="f-horairesHebdo"[^>]*type="text"[^>]*inputmode="decimal"|type="text"[^>]*inputmode="decimal"[^>]*id="f-horairesHebdo"/.test(appSource),
      'le champ Heures hebdomadaires doit être un input texte (inputmode decimal), pas un <input type="number"> qui refuse la virgule française'
    );
    assert.ok(
      appSource.includes("patch.horairesHebdo = Number(String(patch.horairesHebdo || '').replace(',', '.')) || 35;"),
      'la sauvegarde doit normaliser la virgule en point avant conversion numérique'
    );
  }

  // ---- Point 4 : un RH peut désormais modifier sa propre fiche ----
  {
    const { DB, canEditEmployeeRecord } = loadAppJs();
    DB.init();
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    assert.ok(rh, 'un salarié RH doit exister dans le jeu de données de démo');
    DB._currentEmployeeId = rh.id;

    assert.strictEqual(canEditEmployeeRecord(rh), true, 'un RH (permission MODIFIER_SALARIE) doit pouvoir modifier sa propre fiche');

    // Un autre salarié RH peut toujours être modifié aussi (comportement inchangé).
    const autre = DB.getEmployees().find(e => e.id !== rh.id);
    assert.strictEqual(canEditEmployeeRecord(autre), true, 'un RH doit toujours pouvoir modifier la fiche d\'un autre salarié');

    // Un salarié sans MODIFIER_SALARIE ne peut toujours pas modifier sa propre fiche (pas de régression de sécurité).
    const salarie = DB.getEmployees().find(e => e.role === 'salarie');
    if (salarie) {
      DB._currentEmployeeId = salarie.id;
      assert.strictEqual(canEditEmployeeRecord(salarie), false, 'un simple salarié sans permission ne doit pas pouvoir modifier sa propre fiche via ce chemin');
    }
  }

  console.log('OK — employee-form-fixes.test.js (catégorie Cadre toujours proposée, conventions collectives complétées, virgule décimale, RH peut modifier sa propre fiche)');
}

run().catch((err) => {
  console.error('ÉCHEC — employee-form-fixes.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
