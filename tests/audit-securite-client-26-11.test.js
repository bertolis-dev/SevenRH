/**
 * 26/11/2026 — audit, section 1 (côté site) : un motif de santé ne part jamais vers Slack / Teams / calendrier abonné.
 * Le durcissement serveur (hors dépôt public) est vérifié sur un projet Supabase de recette, pas ici ; on contrôle seulement qu'il ne s'est pas glissé dans les migrations.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadDataJs } = require('./load-data-js');

const { sandbox } = loadDataJs();
const type = (nom, extra) => Object.assign({ id: 't', nom }, extra);
assert.strictEqual(sandbox.motifAbsenceConfidentiel(type('Maladie')), true);
assert.strictEqual(sandbox.motifAbsenceConfidentiel(type('Arrêt maladie')), true);
assert.strictEqual(sandbox.motifAbsenceConfidentiel(type('Accident du travail')), true);
assert.strictEqual(sandbox.motifAbsenceConfidentiel(type('Congé maternité')), true);
assert.strictEqual(sandbox.motifAbsenceConfidentiel(type('Congés payés')), false);
assert.strictEqual(sandbox.motifAbsenceConfidentiel(type('RTT')), false);
assert.strictEqual(sandbox.motifAbsenceConfidentiel(type('Autre', { confidentiel: true })), true, 'marquage manuel');
assert.strictEqual(sandbox.libelleAbsencePartage(type('Maladie')), 'Absence');
assert.strictEqual(sandbox.libelleAbsencePartage(type('Congés payés')), 'Congés payés');
assert.strictEqual(sandbox.libelleAbsencePartage(null), '—');

// Le site passe bien par le libellé masqué pour Slack, et le calendrier abonné reprend la même règle
const data = fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8');
assert.ok(data.includes('libelleAbsencePartage(leaveType)'), 'la notification Slack utilise le libellé masqué');
assert.ok(!/notifySlack\('🏖️'[^\n]*leaveType\.nom/.test(data), 'plus de nom de type brut dans la notification de congé');
const ics = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'calendar-feed', 'index.ts'), 'utf8');
assert.ok(ics.includes('libelleAbsencePartage(t.nom'), 'le calendrier abonné masque aussi le motif');
// Même liste de mots des deux côtés
const motsData = /MOTS_MOTIF_CONFIDENTIEL = (\[[^\]]*\])/.exec(data)[1];
const motsIcs = /MOTS_MOTIF_CONFIDENTIEL = (\[[^\]]*\])/.exec(ics)[1];
assert.deepStrictEqual(JSON.parse(motsData.replace(/'/g, '"')), JSON.parse(motsIcs));

// Le durcissement serveur reste hors des migrations tant qu'il n'a pas passé la recette
const migrations = fs.readdirSync(path.join(__dirname, '..', 'supabase', 'migrations'));
assert.ok(!migrations.some(f => f.includes('securite_serveur_audit')), 'à ne déplacer dans migrations/ qu\'après recette');

console.log('OK — audit-securite-client-26-11.test.js');
