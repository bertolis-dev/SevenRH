/**
 * Seven RH — teste le point 6.5 (retour QA du 26/08/2026) : récupération des vacances scolaires
 * depuis l'API officielle (data.education.gouv.fr, dataset fr-en-calendrier-scolaire) plutôt qu'une
 * saisie manuelle chaque année. Couverture ciblée sur les deux pièges vérifiés en direct contre la
 * vraie API avant d'écrire ce code :
 * - les horodatages sont en UTC mais représentent minuit HEURE FRANÇAISE (Europe/Paris, sensible à
 *   l'heure d'été/hiver) — un décalage naïf donnerait la mauvaise date calendaire ;
 * - l'API renvoie une ligne par ACADÉMIE (plusieurs dizaines) pour une même zone/période — sans
 *   déduplication, chaque période apparaîtrait des dizaines de fois.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function run() {
  const { parisDateFromISO, nextAnneeScolaire, fetchOfficialSchoolHolidays } = loadAppJs();

  // ---- parisDateFromISO : conversion sensible au fuseau, y compris à cheval sur le changement d'heure ----
  // Vérifié en direct contre l'API le 26/08/2026 : "2025-10-17T22:00:00+00:00" (host encodé, heure
  // d'été encore active mi-octobre) doit donner le 18, pas le 17 (un décalage naïf tronquant juste
  // la date UTC se tromperait ici).
  assert.strictEqual(parisDateFromISO('2025-10-17T22:00:00+00:00'), '2025-10-18',
    'doit convertir en date française (UTC+2, heure d\'été encore active mi-octobre), pas la date UTC brute');
  // Fin novembre, la France est repassée à l'heure d'hiver (UTC+1).
  assert.strictEqual(parisDateFromISO('2025-11-02T23:00:00+00:00'), '2025-11-03',
    'doit convertir en date française (UTC+1, heure d\'hiver) — vérifie que la bascule été/hiver est gérée, pas un décalage fixe codé en dur');

  // ---- nextAnneeScolaire ----
  assert.strictEqual(nextAnneeScolaire('2025-2026'), '2026-2027');
  assert.strictEqual(nextAnneeScolaire(''), `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`,
    'une valeur absente/invalide doit se rabattre sur l\'année scolaire courante plutôt que planter');

  // ---- fetchOfficialSchoolHolidays : déduplication multi-académies + fusion des zones ----
  {
    const loaded = loadAppJs();
    // Reproduit fidèlement la forme réelle de l'API : plusieurs académies (Besançon, Grenoble...)
    // partagent les mêmes dates pour une même zone — doit fusionner en UNE période avec zones:['A'].
    const makeRecord = (description, start, end) => ({ fields: { description, start_date: start, end_date: end, population: '-' } });
    loaded.sandbox.window.fetch = async (url) => {
      const isZoneA = url.includes('Zone%20A') || url.includes('Zone+A');
      const isZoneB = url.includes('Zone%20B') || url.includes('Zone+B');
      // Zone A : Toussaint (deux académies, mêmes dates) — doit se dédupliquer à 1 entrée.
      // Zone B : Toussaint aux MÊMES dates que zone A — doit FUSIONNER dans la même entrée
      // (zones: ['A','B']), pas créer une entrée séparée.
      const records = isZoneA
        ? [makeRecord('Vacances de la Toussaint', '2025-10-17T22:00:00+00:00', '2025-11-02T23:00:00+00:00'),
           makeRecord('Vacances de la Toussaint', '2025-10-17T22:00:00+00:00', '2025-11-02T23:00:00+00:00')]
        : isZoneB
        ? [makeRecord('Vacances de la Toussaint', '2025-10-17T22:00:00+00:00', '2025-11-02T23:00:00+00:00')]
        : [];
      return { ok: true, json: async () => ({ records }) };
    };
    const periods = await loaded.fetchOfficialSchoolHolidays('2025-2026');
    assert.strictEqual(periods.length, 1, 'des académies dupliquées ET des zones aux mêmes dates doivent fusionner en UNE seule période');
    assert.strictEqual(periods[0].nom, 'Vacances de la Toussaint');
    assert.strictEqual(periods[0].debut, '2025-10-18');
    assert.strictEqual(periods[0].fin, '2025-11-02', 'fin doit être la dernière date INCLUSE (end_date de l\'API est exclusif, un jour de moins)');
    assert.deepStrictEqual([...periods[0].zones].sort(), ['A', 'B'], 'les zones A et B doivent être fusionnées dans la même période (mêmes dates)');
  }

  // ---- Repères ponctuels (fin < debut après ajustement "fin exclusive") ignorés ----
  // Cas réel observé en testant contre la vraie API le 26/08/2026 : "Pont de l'Ascension" et "Début
  // des Vacances d'Été" ne sont pas de vraies périodes, juste un repère où start_date/end_date
  // désignent quasiment le même instant — sans ce filtre, ils produiraient une plage absurde
  // (ex. début 07/05, fin 06/05).
  {
    const loaded = loadAppJs();
    const makeRecord = (description, start, end) => ({ fields: { description, start_date: start, end_date: end, population: '-' } });
    loaded.sandbox.window.fetch = async (url) => {
      const isZoneA = url.includes('Zone%20A');
      const records = isZoneA
        ? [makeRecord('Pont de l\'Ascension', '2027-05-06T22:00:00+00:00', '2027-05-06T22:00:00+00:00'),
           makeRecord('Vacances de la Toussaint', '2025-10-17T22:00:00+00:00', '2025-11-02T23:00:00+00:00')]
        : [];
      return { ok: true, json: async () => ({ records }) };
    };
    const periods = await loaded.fetchOfficialSchoolHolidays('2026-2027');
    assert.strictEqual(periods.length, 1, 'un repère ponctuel (fin < debut) doit être filtré, seule la vraie période doit rester');
    assert.strictEqual(periods[0].nom, 'Vacances de la Toussaint');
  }

  // ---- Réponse HTTP en erreur ----
  {
    const loaded = loadAppJs();
    loaded.sandbox.window.fetch = async () => ({ ok: false, status: 503 });
    await assert.rejects(() => loaded.fetchOfficialSchoolHolidays('2099-2100'), /503/,
      'une réponse HTTP en erreur doit rejeter avec un message exploitable, jamais planter silencieusement');
  }

  // ---- Aucune donnée publiée pour l'année demandée ----
  {
    const loaded = loadAppJs();
    loaded.sandbox.window.fetch = async () => ({ ok: true, json: async () => ({ records: [] }) });
    const periods = await loaded.fetchOfficialSchoolHolidays('2099-2100');
    assert.strictEqual(periods.length, 0, 'aucune donnée publiée doit renvoyer une liste vide, jamais une erreur');
  }

  console.log('OK — school-holidays-fetch.test.js (fuseau horaire, déduplication académies/zones, erreurs réseau)');
}

run().catch((err) => {
  console.error('ÉCHEC — school-holidays-fetch.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
