/**
 * Seven RH — retour Betty du 14/09/2026 (revue concurrentielle, Planning point 1, "le planning doit
 * refuser ou au moins signaler en rouge") : contrôles légaux de durée du travail sur le modèle
 * hebdomadaire récurrent (shifts) — amplitude, repos quotidien (11h, L3131-1), repos hebdomadaire
 * (35h, L3132-2), durée max quotidienne (10h, L3121-18) et hebdomadaire (48h, L3121-20), pause
 * obligatoire (20min après 6h, L3121-16). Jamais un blocage : verifierControlesLegauxPlanning
 * retourne des violations à signaler (voir renderPlanningPostes, app.js), le quart reste enregistré.
 *
 * Couvre aussi le coût du planning (point 2, calculerTauxHoraireEmploye/calculerCoutShifts) et le
 * chevauchement avec une indisponibilité déclarée (point 4, shiftChevaucheIndisponibilite).
 */
const assert = require('assert');
const { loadDataJs } = require('./load-data-js');

function shift(employeeId, weekday, heureDebut, heureFin, pauseMinutes = 30) {
  return { id: `${employeeId}-${weekday}`, employeeId, weekday, heureDebut, heureFin, pauseMinutes };
}

async function run() {
  // ---- Semaine normale (5 jours, 8h/jour, pause déjeuner) : aucune violation ----
  {
    const { verifierControlesLegauxPlanning } = loadDataJs();
    const shifts = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'].map(j => shift('e1', j, '09:00', '17:00', 60));
    assert.strictEqual(verifierControlesLegauxPlanning('e1', shifts).length, 0, 'une semaine normale (40h, week-end complet) ne doit déclencher aucune violation');
  }

  // ---- Durée max quotidienne (10h, L3121-18) ----
  {
    const { verifierControlesLegauxPlanning } = loadDataJs();
    const shifts = [shift('e1', 'Lun', '08:00', '19:30', 60)]; // 10h30 travaillées
    const violations = verifierControlesLegauxPlanning('e1', shifts);
    assert.ok(violations.some(v => v.type === 'duree-max-quotidienne'), '10h30 en un jour doit dépasser le maximum légal de 10h');
  }

  // ---- Pause obligatoire (20 min après 6h continues, L3121-16) ----
  {
    const { verifierControlesLegauxPlanning } = loadDataJs();
    const shifts = [shift('e1', 'Lun', '09:00', '16:00', 10)]; // 6h50 travaillées, 10 min de pause seulement
    const violations = verifierControlesLegauxPlanning('e1', shifts);
    assert.ok(violations.some(v => v.type === 'pause-obligatoire'), 'plus de 6h de travail avec seulement 10 minutes de pause doit être signalé');
  }

  // ---- Repos quotidien (11h minimum entre deux journées, L3131-1) ----
  {
    const { verifierControlesLegauxPlanning } = loadDataJs();
    // Lundi finit à 23h, mardi reprend à 6h : seulement 7h de repos.
    const shifts = [shift('e1', 'Lun', '15:00', '23:00', 30), shift('e1', 'Mar', '06:00', '14:00', 30)];
    const violations = verifierControlesLegauxPlanning('e1', shifts);
    assert.ok(violations.some(v => v.type === 'repos-quotidien'), '7h de repos entre deux journées doit être signalé (minimum légal 11h)');
  }

  // ---- Repos hebdomadaire (35h consécutives minimum, L3132-2) : travailler les 7 jours de la
  // semaine ne laisse aucune coupure suffisante ----
  {
    const { verifierControlesLegauxPlanning } = loadDataJs();
    const shifts = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map(j => shift('e1', j, '09:00', '13:00', 0));
    const violations = verifierControlesLegauxPlanning('e1', shifts);
    // Avec les 7 jours travaillés, il n'y a par définition aucune coupure entre deux jours
    // travaillés sur laquelle chercher 35h : la boucle "jour suivant travaillé" retombe sur le
    // lendemain immédiat à chaque fois (repos quotidien seul, jamais 35h).
    assert.ok(violations.some(v => v.type === 'repos-hebdomadaire'), 'travailler les 7 jours de la semaine ne doit jamais satisfaire le repos hebdomadaire de 35h');
  }

  // ---- Repos hebdomadaire respecté : coupure du vendredi soir au lundi matin (largement > 35h) ----
  {
    const { verifierControlesLegauxPlanning } = loadDataJs();
    const shifts = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'].map(j => shift('e1', j, '09:00', '17:00', 60));
    const violations = verifierControlesLegauxPlanning('e1', shifts);
    assert.ok(!violations.some(v => v.type === 'repos-hebdomadaire'), 'un week-end complet (vendredi 17h → lundi 9h, soit largement plus de 35h) doit satisfaire le repos hebdomadaire');
  }

  // ---- Durée max hebdomadaire (48h absolues, L3121-20) ----
  {
    const { verifierControlesLegauxPlanning } = loadDataJs();
    const shifts = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'].map(j => shift('e1', j, '07:00', '17:00', 60)); // 9h/jour × 6 = 54h
    const violations = verifierControlesLegauxPlanning('e1', shifts);
    assert.ok(violations.some(v => v.type === 'duree-max-hebdomadaire'), '54h sur la semaine doit dépasser le plafond absolu de 48h');
  }

  // ---- Amplitude excessive (incompatible avec les 11h de repos quotidien) ----
  {
    const { verifierControlesLegauxPlanning } = loadDataJs();
    const shifts = [shift('e1', 'Lun', '06:00', '22:30', 60)]; // amplitude 16h30, > 13h max (24-11)
    const violations = verifierControlesLegauxPlanning('e1', shifts);
    assert.ok(violations.some(v => v.type === 'amplitude'), 'une amplitude de 16h30 doit être signalée (incompatible avec 11h de repos quotidien)');
  }

  // ---- Aucun quart : aucune violation (pas de division par zéro, pas de faux positif) ----
  {
    const { verifierControlesLegauxPlanning } = loadDataJs();
    assert.strictEqual(verifierControlesLegauxPlanning('e1', []).length, 0, 'un salarié sans aucun quart ne doit jamais déclencher de violation');
  }

  console.log('OK — planning-controles-legaux-14-09.test.js (durée max quotidienne/hebdomadaire, pause obligatoire, amplitude, repos quotidien/hebdomadaire)');
}

async function runCoutEtIndisponibilite() {
  // ---- Taux horaire et coût des quarts, approximation 151,67h/mois (35h × 52 / 12) ----
  {
    const { calculerTauxHoraireEmploye, calculerCoutShifts } = loadDataJs();
    const employee = { id: 'e1', salaireBrutMensuel: 3033.4 }; // ≈ 20 €/h
    assert.strictEqual(calculerTauxHoraireEmploye(employee), 20, 'sanity : 3033,40 / 151,67 ≈ 20 €/h');
    assert.strictEqual(calculerTauxHoraireEmploye({ id: 'e2' }), 0, 'sans salaire renseigné, taux à zéro plutôt qu\'un NaN');

    const shifts = [shift('e1', 'Lun', '09:00', '17:00', 60)]; // 7h travaillées
    assert.strictEqual(calculerCoutShifts(shifts, [employee]), 140, '7h à 20 €/h = 140 €');
    assert.strictEqual(calculerCoutShifts(shifts, []), 0, 'un salarié introuvable ne doit jamais planter le calcul, juste ne rien compter pour lui');
  }

  // ---- Chevauchement avec une indisponibilité récurrente déclarée ----
  {
    const { shiftChevaucheIndisponibilite } = loadDataJs();
    const s = shift('e1', 'Mer', '09:00', '17:00', 60);
    assert.ok(shiftChevaucheIndisponibilite(s, [{ weekday: 'Mer', heureDebut: '12:00', heureFin: '14:00' }]), 'un quart qui englobe l\'indisponibilité doit être détecté');
    assert.ok(!shiftChevaucheIndisponibilite(s, [{ weekday: 'Jeu', heureDebut: '12:00', heureFin: '14:00' }]), 'une indisponibilité un autre jour ne doit jamais être un faux positif');
    assert.ok(!shiftChevaucheIndisponibilite(s, [{ weekday: 'Mer', heureDebut: '17:00', heureFin: '18:00' }]), 'des plages qui se touchent sans se recouvrir ne doivent pas être un conflit');
    assert.ok(!shiftChevaucheIndisponibilite(s, []), 'aucune indisponibilité déclarée : jamais de conflit');
  }

  console.log('OK — planning-controles-legaux-14-09.test.js (coût des quarts par taux horaire approximatif, chevauchement indisponibilité)');
}

run().then(runCoutEtIndisponibilite).catch((err) => {
  console.error('ÉCHEC — planning-controles-legaux-14-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
