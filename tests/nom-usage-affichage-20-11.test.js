/**
 * Retour du 20/11/2026 : le nom d'usage (quand le salarié en a un) doit s'afficher partout dans l'application à la place du nom de naissance ;
 * les documents officiels et le journal d'audit gardent le nom légal.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAppJs } = require('./load-app-js');

const api = loadAppJs();
api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
api.DB.init();
const sb = api.sandbox;

const avecUsage = { prenom: 'Marie-Caroline', nom: 'BELETRE', nomUsage: 'DUPONT' };
const sansUsage = { prenom: 'Ludovic', nom: 'BAILLOEUL', nomUsage: '' };
const vide = { prenom: 'Camille', nom: 'BOUSQUET' };

assert.strictEqual(sb.nomAffiche(avecUsage), 'DUPONT', 'le nom d\'usage remplace le nom');
assert.strictEqual(sb.nomAffiche(sansUsage), 'BAILLOEUL', 'sans nom d\'usage : le nom');
assert.strictEqual(sb.nomAffiche({ prenom: 'A', nom: 'B', nomUsage: '   ' }), 'B', 'un nom d\'usage vide ou d\'espaces est ignoré');
assert.strictEqual(sb.nomAffiche(vide), 'BOUSQUET', 'champ absent : le nom');
assert.strictEqual(sb.nomCompletAffiche(avecUsage), 'Marie-Caroline DUPONT');
assert.strictEqual(sb.personNameHtml(avecUsage), 'Marie-Caroline DUPONT', 'personNameHtml (utilisé dans toutes les listes et la fiche) affiche le nom d\'usage');
assert.strictEqual(sb.personNameHtml(sansUsage), 'Ludovic BAILLOEUL');
assert.ok(sb.renderAvatar(avecUsage).includes('>MD<'), 'les initiales de l\'avatar suivent le nom d\'usage');
assert.ok(sb.personNameHtml({ prenom: '<b>', nom: 'X', nomUsage: '<i>' }).includes('&lt;i&gt;'), 'le nom d\'usage est échappé');

// Fiche : l'en-tête utilise le nom affiché
const rh = api.DB.getEmployees().find(e => e.role === 'rh');
const salarie = api.DB.getEmployees().find(e => e.role === 'salarie');
api.DB._currentEmployeeId = rh.id;
api.DB.updateEmployee(salarie.id, { nomUsage: 'MARTIN-USAGE' });
const fiche = sb.renderEmployeeDetail(salarie.id);
assert.ok(fiche.includes(salarie.prenom + ' MARTIN-USAGE'), 'la fiche affiche le nom d\'usage');
assert.ok(!fiche.includes('<h1>' + salarie.prenom + ' ' + salarie.nom + '</h1>'), 'et plus le nom de naissance dans le titre');

// La recherche retrouve un salarié par l'un ou l'autre
const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
assert.ok(src.includes("normalizeForSearch(`${e.prenom} ${e.nom} ${e.nomUsage || ''}"), 'la recherche accepte aussi le nom d\'usage');

// Le journal d'audit et les documents officiels gardent le nom légal
assert.ok(/logAudit\('Export', 'Attestation employeur', `\$\{e\.prenom\} \$\{e\.nom\}`\)/.test(src), 'journal d\'audit : nom légal');
assert.ok(/renderPrintDocumentHeader\(companyRepository\.getProfile\(\), `\$\{e\.prenom\} \$\{e\.nom\}`/.test(src), 'fiche imprimable : nom légal');

console.log('OK — nom-usage-affichage-20-11.test.js');
