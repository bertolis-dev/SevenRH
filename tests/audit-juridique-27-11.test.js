/**
 * 27/11/2026 — audit, lot A : politique de confidentialité exacte, case d'acceptation à l'inscription, mention de réserve unique.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAppJs } = require('./load-app-js');

const api = loadAppJs();
api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
api.DB.init();
api.DB._currentEmployeeId = api.DB.getEmployees().find(e => e.role === 'rh').id;
const sb = api;
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

// ---- Politique de confidentialité : sous-traitants réels, plus d'affirmation que le serveur ne tient pas ----
const politique = /confidentialite: \{[\s\S]*?\n  \}\n\};/.exec(app)[0];
['Supabase', 'Stripe', 'Resend', 'Anthropic', 'GitHub Pages', 'Slack', 'Swile'].forEach(nom => assert.ok(politique.includes(nom), nom + ' cité comme sous-traitant ou destinataire'));
assert.ok(!/contrôlé[es]? côté serveur/.test(politique), 'plus de promesse de contrôle côté serveur');
assert.ok(!/strictement limité/.test(politique));
assert.ok(!/conforme à l'article 28/.test(politique), 'plus d\'affirmation d\'un contrat conforme non fourni');
assert.ok(/communiqué sur demande/.test(politique));

// ---- Inscription : case d'acceptation obligatoire, version conservée ----
const formulaire = /id="f-signup-company-accept"[^>]*>/.exec(app)[0];
assert.ok(/required/.test(formulaire), 'case obligatoire');
assert.ok(/CONDITIONS_VERSION = '\d{4}-\d{2}-\d{2}'/.test(app), 'version des conditions');
assert.ok(app.includes("authRepository.signUpNewCompany(raisonSociale, email, p1, nom, prenom, acceptation)"));
assert.ok(fs.readFileSync(path.join(__dirname, '..', 'supabase-client.js'), 'utf8').includes('acceptationConditions'), 'acceptation conservée avec le compte');
assert.ok(fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8').includes('signUpNewCompany(raisonSociale, email, password, nom, prenom, acceptation)'));

// ---- Mention de réserve : une seule, réglable, avec source et date ----
const mention = api.sandbox.renderMentionReserve('décret 2025-160');
assert.ok(mention.includes('à jour au 27/11/2026'), 'date de mise à jour');
assert.ok(mention.includes('décret 2025-160'), 'source citée');
assert.ok(/title="[^"]*évolution de la législation/.test(mention), 'bulle avec le texte complet');
const reglages = api.DB.getSettings();
reglages.mentionReserveTexte = 'Texte maison';
api.DB.saveSettings(reglages);
assert.ok(api.sandbox.renderMentionReserve().includes('title="Texte maison"'), 'le texte des paramètres remplace le défaut');
assert.ok(api.sandbox.renderParametresTypesAbsences().includes('id="f-mention-reserve-texte"'), 'réglage dans Paramètres');
['renderEstimationIndemnitesArret', 'renderMentionReserve(\'barème', 'renderMentionReserve(\'loi PACTE', 'renderMentionReserve(\'Code de la sécurité sociale, caisses'].forEach(m => assert.ok(app.includes(m)));
console.log('OK — audit-juridique-27-11.test.js');
