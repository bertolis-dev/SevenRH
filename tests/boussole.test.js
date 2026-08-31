/**
 * Seven RH — "Boussole" (roadmap différenciation #2, 01/09/2026) : agent conversationnel scopé
 * strictement aux données Nexus de l'entreprise. Ce test couvre la partie testable sans appel réseau
 * réel à l'API Anthropic (le contenu de la question/réponse dépend du modèle, hors périmètre d'un
 * test unitaire) : l'instantané de données envoyé (buildBoussoleContext), le rendu de l'écran, et le
 * fait que l'entrée de navigation reste hors de portée d'un manager.
 *
 * §correctif du 01/09/2026 : fonctionnalité désactivée à la demande de Betty ("je veux pas on
 * annule" — coût API Anthropic). L'entrée NAV_ITEMS reste en place pour ne jamais laisser la vue
 * accessible à n'importe quel rôle (voir navigateTo, qui ne bloque une vue par rôle QUE si elle est
 * listée dans NAV_ITEMS) — seul renderSidebar() l'exclut désormais de l'affichage, exactement comme
 * 'parametres'. Un dernier bloc de test verrouille précisément ce point : présente dans NAV_ITEMS
 * (gating actif) mais absente du rendu réel de la barre latérale (jamais cliquable).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAppJs } = require('./load-app-js');

async function run() {
  const { DB, sandbox, buildBoussoleContext, renderBoussole, renderSidebar, NAV_ITEMS } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();

  // ---- L'entrée de navigation ne doit jamais être accessible à un manager (portée entreprise, pas équipe) ----
  {
    const item = NAV_ITEMS.find(i => i.key === 'boussole');
    assert.ok(item, 'l\'entrée de navigation "boussole" doit exister');
    assert.ok(!item.roles.includes('manager'), 'un manager ne doit jamais voir la Boussole (instantané = toute l\'entreprise)');
    assert.ok(item.roles.includes('rh') && item.roles.includes('proprietaire'), 'RH et Propriétaire doivent y avoir accès');
  }

  // ---- buildBoussoleContext : instantané correct, compact (pas de champs sensibles superflus) ----
  {
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const context = buildBoussoleContext();

    assert.ok(Array.isArray(context.salaries), 'le contexte doit contenir un tableau de salariés');
    assert.ok(context.salaries.length > 0, 'le contexte doit couvrir les salariés actifs de la démo');

    const first = context.salaries[0];
    assert.ok(typeof first.nom === 'string' && first.nom.includes(' '), 'chaque salarié doit avoir un nom complet (prénom + nom)');
    assert.ok(Array.isArray(first.soldesConges), 'chaque salarié doit porter ses soldes de congés');
    first.soldesConges.forEach(s => {
      assert.ok(typeof s.type === 'string', 'chaque solde doit préciser le type de congé');
      assert.ok(typeof s.joursDisponibles === 'number' || s.joursDisponibles === 'illimité', 'le solde doit être un nombre ou "illimité"');
    });

    // Data minimization : pas de champs sensibles qui n'ont rien à faire dans un contexte envoyé à un LLM tiers.
    assert.strictEqual(first.numeroSecu, undefined, 'le numéro de sécurité sociale ne doit jamais être envoyé à la Boussole');
    assert.strictEqual(first.adresse, undefined, 'l\'adresse ne doit jamais être envoyée à la Boussole');
    assert.strictEqual(first.salaireBrutMensuel, undefined, 'le salaire ne doit jamais être envoyé à la Boussole');

    assert.ok(context.notesDeFraisMoisEnCours && typeof context.notesDeFraisMoisEnCours.montantTTCParService === 'object',
      'le contexte doit inclure les notes de frais du mois en cours par service');
  }

  // ---- Rendu de l'écran : pas de crash, invite affichée sans historique, formulaire présent ----
  {
    const html = renderBoussole();
    assert.ok(html.includes('id="boussole-form"'), 'le formulaire de question doit être présent');
    assert.ok(html.includes('id="f-boussole-question"'), 'le champ de saisie doit être présent');
    assert.ok(html.includes('Qui a plus de 20 jours'), 'un exemple de question doit guider l\'utilisateur sans historique');
    assert.ok(html.includes('vérifier avant toute décision importante'), 'le rappel IA doit être visible sur l\'écran, pas seulement dans le code');
  }

  // ---- Désactivée le 01/09/2026 : jamais dans la barre latérale réelle, même pour RH ----
  {
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    renderSidebar();
    const sidebarHtml = (sandbox.document.getElementById('sidebar-nav').innerHTML || '') + (sandbox.document.getElementById('sidebar-nav-pinned').innerHTML || '');
    assert.ok(!sidebarHtml.includes('Boussole'), 'la Boussole ne doit plus apparaître dans la barre latérale (désactivée), même pour RH');
  }

  // ---- §correctif audit du 31/08/2026 : bindBoussoleEvents doit protéger l'appel askBoussole d'un
  //      rejet de promesse (réseau/DNS/CORS), sinon state.boussoleLoading reste bloqué à `true` pour
  //      toujours. Le gestionnaire de clic réel n'est pas déclenchable dans ce harnais vm (les
  //      addEventListener y sont des no-op, voir load-app-js.js) — vérifié en direct dans le
  //      navigateur ; ce test verrouille au moins la présence du garde-fou dans le code source. ----
  {
    const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    const bindBody = appSource.slice(appSource.indexOf('function bindBoussoleEvents'), appSource.indexOf('function bindBoussoleEvents') + 1500);
    assert.ok(/try\s*\{[\s\S]*askBoussole[\s\S]*\}\s*catch/.test(bindBody),
      'l\'appel à askBoussole() doit être protégé par un try/catch, pour ne jamais bloquer state.boussoleLoading en cas de rejet réseau');
  }

  console.log('OK — boussole.test.js (nav réservée RH/Propriétaire/Comptabilité, instantané compact et sans champ sensible, écran rendu correctement, désactivation confirmée hors de la barre latérale, garde-fou réseau vérifié)');
}

run().catch((err) => {
  console.error('ÉCHEC — boussole.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
