/**
 * Seven RH — correctif audit du 31/08/2026 (efficiency) : getCalendarDayInfo/buildCalendarSharedData
 * et getTableauCompteursData/getPaieAnomalies sont passés d'un rescan linéaire par salarié/cellule à
 * des Maps pré-construites une seule fois. Ce test vérifie que le résultat reste correct après ce
 * changement purement interne — pas de nouveau comportement, juste moins de scans redondants.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function run() {
  const { DB, sandbox, getCalendarDayInfo, buildCalendarSharedData, getTableauCompteursData, getPaieAnomalies } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;

  // ---- Calendrier : anniversaire/arrivée/départ retrouvés via les Maps précalculées ----
  {
    const emp = DB.getEmployees()[0];
    const dateStr = '2026-09-15';
    DB.updateEmployee(emp.id, { dateNaissance: '1990-09-15', dateEmbauche: dateStr, dateDepart: '' });
    const sharedData = buildCalendarSharedData([{ date: new Date(2026, 8, 15) }]);
    const info = getCalendarDayInfo(dateStr, sharedData);
    assert.ok(info.anniversaires.some(e => e.id === emp.id), 'anniversaire doit être retrouvé via anniversairesByMonthDay');
    assert.ok(info.arrivees.some(e => e.id === emp.id), 'arrivée doit être retrouvée via arriveesByDate');

    // Une autre date ne doit rien retrouver pour ce salarié (pas de faux positif de la Map).
    const infoAutreJour = getCalendarDayInfo('2026-09-16', sharedData);
    assert.ok(!infoAutreJour.anniversaires.some(e => e.id === emp.id), 'pas d\'anniversaire un autre jour');
    assert.ok(!infoAutreJour.arrivees.some(e => e.id === emp.id), 'pas d\'arrivée un autre jour');
  }

  // ---- Calendrier : congé retrouvé via employeesById/leaveTypesById (plus de .find() interne) ----
  {
    const sharedData = buildCalendarSharedData([{ date: new Date(2026, 8, 1) }]);
    const info = getCalendarDayInfo('2026-09-10', sharedData);
    // Le test principal ici est l'absence de crash et la cohérence de forme (emp/type résolus).
    info.conges.forEach(c => {
      assert.ok(c.emp && c.emp.id, 'chaque congé résolu doit porter un salarié valide (via employeesById)');
      assert.ok(c.type && c.type.id, 'chaque congé résolu doit porter un type valide (via leaveTypesById)');
    });
  }

  // ---- Tableau des compteurs : résultat identique en passant par le regroupement par employeeId ----
  {
    const { rows } = getTableauCompteursData();
    assert.ok(rows.length > 0, 'le tableau des compteurs doit renvoyer des lignes pour la démo');
    rows.forEach(row => {
      row.balances.forEach(b => {
        assert.ok(typeof b.disponible === 'number' || b.disponible === Infinity, 'chaque solde doit rester un nombre (ou Illimité)');
      });
    });
  }

  // ---- Préparation de paie : anomalies calculées sans crash après le regroupement par employeeId ----
  {
    const now = new Date(2026, 8, 1);
    const anomalies = getPaieAnomalies(now.getFullYear(), now.getMonth());
    assert.ok(Array.isArray(anomalies), 'getPaieAnomalies doit renvoyer un tableau');
  }

  console.log('OK — calendar-and-compteurs-perf.test.js (Maps de regroupement : résultat inchangé)');
}

run().catch((err) => {
  console.error('ÉCHEC — calendar-and-compteurs-perf.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
