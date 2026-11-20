/**
 * Retour du 20/11/2026 : « Tickets restaurant » de Mon espace ouvrait la vue ÉQUIPE. Une entrée par vue, comme Calendrier :
 * Mon espace > vue personnelle, Mon équipe > vue équipe.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

const api = loadAppJs();
api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
api.DB.init();
const { DB, NAV_ITEMS } = api;

const entrees = NAV_ITEMS.filter(i => i.key === 'tickets');
assert.strictEqual(entrees.length, 2, 'deux entrées de menu pour les tickets restaurant');
const perso = entrees.find(i => i.group === 'personnel');
const equipe = entrees.find(i => i.group === 'equipe');
assert.strictEqual(JSON.stringify(perso.navParams), JSON.stringify({ ticketsRestaurantVue: 'personnel' }), 'Mon espace ouvre la vue personnelle');
assert.strictEqual(JSON.stringify(equipe.navParams), JSON.stringify({ ticketsRestaurantVue: 'equipe' }), 'Mon équipe ouvre la vue équipe');
assert.ok(perso.roles.includes('salarie'), 'tout le monde garde sa vue personnelle');
assert.ok(!equipe.roles, 'la vue équipe dépend d\'une permission, pas d\'un rôle');

// Un salarié ne voit que sa vue personnelle ; le RH voit les deux
const salarie = DB.getEmployees().find(e => e.role === 'salarie');
const rh = DB.getEmployees().find(e => e.role === 'rh');
const entreesDe = (user) => api.sandbox.baseNavItemsForRole(user).filter(i => i.key === 'tickets').map(i => i.group);
assert.strictEqual(JSON.stringify(entreesDe(salarie)), JSON.stringify(['personnel']), 'salarié : une seule entrée');
assert.strictEqual(JSON.stringify(entreesDe(rh).sort()), JSON.stringify(['equipe', 'personnel']), 'RH : les deux');

// Les liens de l'accueil vers les tickets de l'équipe ouvrent bien la vue équipe
const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8');
assert.ok(src.includes("nav: 'tickets', navParams: { ticketsRestaurantVue: 'equipe' }"), 'Centre d\'action : vue équipe');
assert.ok(src.includes("data-nav=\"tickets\" data-nav-params='{\"ticketsRestaurantVue\":\"equipe\"}'"), 'Accès rapides : vue équipe');

console.log('OK — tickets-menu-moi-equipe-20-11.test.js');
