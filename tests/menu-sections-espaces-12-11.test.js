/**
 * Revue Nexus (n° 12, 15, 17) : Calendrier dans la section Équipe, sections du menu repliables, espace courant (Personnel / Équipe / Paramètres).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

const api = loadAppJs();
const items = api.NAV_ITEMS || (api.sandbox && api.sandbox.NAV_ITEMS);
assert.ok(items, 'NAV_ITEMS exposé');

const cals = items.filter(i => i.key === 'calendrier');
assert.strictEqual(cals.length, 2, 'deux entrées Calendrier (Personnel + Équipe)');
const equipe = cals.find(i => i.group === 'equipe');
assert.ok(equipe, 'une entrée Calendrier dans le groupe Équipe');
assert.ok(!equipe.roles.includes('salarie'), 'le salarié simple n\'a pas de menu Équipe');
assert.strictEqual(equipe.navParams.calendrierVue, 'entreprise');
assert.strictEqual(cals.find(i => i.group === 'personnel').navParams.calendrierVue, 'personnel');

console.log('OK — menu-sections-espaces-12-11.test.js');
