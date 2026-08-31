/**
 * Seven RH — "Radar Trésorerie RH" (roadmap différenciation #4, 01/09/2026) : projection de
 * l'impact des embauches/départs déjà planifiés sur la masse salariale à 30/60/90 jours. Vérifie que
 * seuls les évènements réels (embauche future, départ futur + indemnité compensatrice) ont un effet
 * — jamais les congés payés ordinaires, jamais un évènement hors des 90 jours.
 */
const assert = require('assert');
const { loadDataJs } = require('./load-data-js');

function shiftDaysISO(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function run() {
  const { DB, sandbox, getRadarTresorerieRH } = loadDataJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();

  const TODAY = new Date().toISOString().slice(0, 10);
  const company = DB.getCurrentCompany();

  // Nettoie les salaires du jeu de démo pour un calcul de base prévisible, et ajoute nos propres cas.
  company.employees.forEach(e => { e.salaireBrutMensuel = 0; });

  const enPoste = company.employees[0];
  enPoste.dateEmbauche = shiftDaysISO(TODAY, -365);
  enPoste.dateDepart = '';
  enPoste.salaireBrutMensuel = 2500;

  const futurEmbauche = { ...company.employees[1], id: 'emp-embauche', dateEmbauche: shiftDaysISO(TODAY, 20), dateDepart: '', salaireBrutMensuel: 3000 };
  const futurDepart = { ...company.employees[2], id: 'emp-depart', dateEmbauche: shiftDaysISO(TODAY, -1000), dateDepart: shiftDaysISO(TODAY, 45), salaireBrutMensuel: 2000, compteurs: {} };
  const embaucheHorsHorizon = { ...company.employees[3], id: 'emp-hors-horizon', dateEmbauche: shiftDaysISO(TODAY, 120), dateDepart: '', salaireBrutMensuel: 5000 };
  // §correctif audit du 31/08/2026 : un départ dont dateDepart EST le jour même (ni avant, ni après)
  // ne doit jamais disparaître du radar — son indemnité compensatrice de congés payés non pris est
  // une vraie sortie de trésorerie qui survient précisément ce jour-là.
  const departAujourdhui = { ...company.employees[4], id: 'emp-depart-aujourdhui', dateEmbauche: shiftDaysISO(TODAY, -1000), dateDepart: TODAY, salaireBrutMensuel: 1800, compteurs: {} };

  company.employees = [enPoste, futurEmbauche, futurDepart, embaucheHorsHorizon, departAujourdhui];
  DB.saveCurrentCompany(company);

  const radar = getRadarTresorerieRH(DB.getEmployees(), TODAY);

  // ---- Coût actuel : les 2 salariés déjà en poste comptent (enPoste + futurDepart, pas encore parti) ;
  //      ni le futur embauché (+20j, pas encore commencé) ni celui hors horizon (+120j) ne comptent.
  assert.strictEqual(radar.coutMensuelActuel, 2500 + 2000, 'seuls les salariés réellement en poste aujourd\'hui doivent compter dans le coût actuel');

  const [h30, h60, h90] = radar.horizons;

  // ---- À 30 jours : l'embauche (+20j) est dedans, le départ (+45j) et l'embauche hors horizon (+120j) non ----
  assert.ok(h30.evenements.some(e => e.type === 'embauche' && e.employeeId === 'emp-embauche'), 'l\'embauche à +20 jours doit apparaître dès l\'horizon 30 jours');
  assert.ok(!h30.evenements.some(e => e.employeeId === 'emp-depart'), 'le départ à +45 jours ne doit pas encore apparaître à 30 jours');
  assert.strictEqual(h30.coutMensuelProjete, 4500 + 3000, 'le coût projeté à 30 jours doit inclure la future embauche');

  // ---- À 60 jours : le départ (+45j) apparaît, avec son impact négatif ET l'indemnité compensatrice ----
  assert.ok(h60.evenements.some(e => e.type === 'depart' && e.employeeId === 'emp-depart' && e.impactMensuel < 0), 'le départ à +45 jours doit apparaître à 60 jours avec un impact mensuel négatif');
  const indemnite = h60.evenements.find(e => e.type === 'indemnite_compensatrice' && e.employeeId === 'emp-depart');
  assert.ok(indemnite, 'une indemnité compensatrice doit être calculée pour un départ avec un solde de congés payés disponible');
  assert.ok(indemnite.montantUnique > 0, 'l\'indemnité compensatrice doit être un montant positif (sortie de trésorerie ponctuelle)');
  assert.strictEqual(h60.coutMensuelProjete, 4500 + 3000 - 2000, 'le coût mensuel récurrent projeté à 60 jours doit refléter embauche ET départ');

  // ---- Jamais au-delà de 90 jours ----
  assert.ok(!h90.evenements.some(e => e.employeeId === 'emp-hors-horizon'), 'une embauche à +120 jours ne doit jamais apparaître, même à l\'horizon le plus large (90 jours)');

  // ---- Un départ dont dateDepart EST aujourd'hui doit produire son indemnité compensatrice, dès le
  //      plus petit horizon (jamais d'impactMensuel : déjà reflété par son exclusion de coutMensuelActuel) ----
  {
    const indemniteAujourdhui = h30.evenements.find(e => e.type === 'indemnite_compensatrice' && e.employeeId === 'emp-depart-aujourdhui');
    assert.ok(indemniteAujourdhui, 'un départ dont dateDepart est exactement aujourd\'hui doit générer son indemnité compensatrice, dès l\'horizon 30 jours');
    assert.ok(indemniteAujourdhui.montantUnique > 0, 'l\'indemnité doit être un montant positif');
    assert.ok(!h30.evenements.some(e => e.type === 'depart' && e.employeeId === 'emp-depart-aujourdhui'),
      'un départ aujourd\'hui ne doit jamais produire un évènement "depart" avec impactMensuel (déjà reflété par l\'exclusion de coutMensuelActuel, l\'ajouter doublerait la baisse)');
  }

  // ---- Aucun horizon ne duplique un évènement (cumulatif, pas de double comptage dans un même horizon) ----
  [h30, h60, h90].forEach(h => {
    const ids = h.evenements.map(e => `${e.type}-${e.employeeId}`);
    assert.strictEqual(new Set(ids).size, ids.length, 'aucun évènement ne doit apparaître deux fois dans le même horizon');
  });

  console.log('OK — radar-tresorerie-rh.test.js (embauche/départ/indemnité compensatrice, horizons cumulatifs 30/60/90j, rien au-delà, départ le jour même couvert)');
}

run().catch((err) => {
  console.error('ÉCHEC — radar-tresorerie-rh.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
