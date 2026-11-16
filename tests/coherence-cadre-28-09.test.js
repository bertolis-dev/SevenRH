/**
 * Seven RH — retour Betty du 28/09/2026 puis du 16/11/2026 (« doublon entre la catégorie de salarié et le statut ») : la fiche affichait deux champs
 * pour la même idée de statut cadre — « Catégorie de salarié » et « Statut » (case du contrat) — et ils pouvaient se contredire sans qu'on puisse corriger.
 * Désormais le statut cadre se déduit de la catégorie quand elle est sans ambiguïté ; la fiche n'affiche plus de ligne « Statut » en doublon ; la case du
 * contrat est verrouillée dans ce cas (et reste libre pour une catégorie personnalisée).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

const api = loadAppJs();
api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
api.DB.init();
const rh = api.DB.getEmployees().find(e => e.role === 'rh');
api.DB._currentEmployeeId = rh.id;
const { employeeRepository } = api;
const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
const effectif = () => api.sandbox.getStatutCadreEffectif(api.DB.getEmployeeById(salarie.id));

// Catégorie « Cadre » : cadre, même si l'ancienne case du contrat disait non-cadre.
employeeRepository.update(salarie.id, { statutPro: 'Cadre', categorieSalarieId: null, statutCadre: false });
assert.strictEqual(effectif(), true, 'catégorie Cadre : statut cadre déduit, jamais contredit');

// « Agent de maîtrise » : non-cadre, même avec une case cochée.
employeeRepository.update(salarie.id, { statutPro: 'Agent de maîtrise', statutCadre: true });
assert.strictEqual(effectif(), false, 'catégorie Agent de maîtrise : non-cadre');

// Catégorie personnalisée : la case du contrat reste la référence.
employeeRepository.update(salarie.id, { statutPro: 'Responsable régional (catégorie personnalisée)', statutCadre: true });
assert.strictEqual(effectif(), true, 'catégorie personnalisée : la case du contrat décide');
employeeRepository.update(salarie.id, { statutCadre: false });
assert.strictEqual(effectif(), false);

// Le contrat : case verrouillée quand la catégorie tranche, libre sinon.
employeeRepository.update(salarie.id, { statutPro: 'Cadre', statutCadre: false });
const htmlVerrouille = api.sandbox.renderContratFormFields({}, api.DB.getEmployeeById(salarie.id), api.DB.getSettings());
assert.ok(/id="f-contrat-statut-cadre"[^>]*checked[^>]*disabled/.test(htmlVerrouille), 'case cochée et verrouillée pour la catégorie Cadre');
assert.ok(htmlVerrouille.includes('Déduit de la catégorie de salarié'), 'explication affichée');
employeeRepository.update(salarie.id, { statutPro: 'Responsable régional (catégorie personnalisée)' });
const htmlLibre = api.sandbox.renderContratFormFields({}, api.DB.getEmployeeById(salarie.id), api.DB.getSettings());
assert.ok(!/id="f-contrat-statut-cadre"[^>]*disabled/.test(htmlLibre), 'case libre pour une catégorie personnalisée');

// Plus d'alerte « en désaccord » dans le contrôle des dossiers.
employeeRepository.update(salarie.id, { statutPro: 'Cadre', statutCadre: false });
assert.ok(!api.getDataQualityIssues().find(i => /en désaccord/.test(i.label)), 'plus d\'anomalie de désaccord catégorie/statut');

console.log('OK — coherence-cadre-28-09.test.js (statut cadre déduit de la catégorie, case du contrat verrouillée, plus de doublon)');
