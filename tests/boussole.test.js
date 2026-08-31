/**
 * Seven RH — "Boussole" (roadmap différenciation #2, 01/09/2026) : agent conversationnel scopé
 * strictement aux données Nexus de l'entreprise. Ce test couvre la partie testable sans appel réseau
 * réel à l'API Anthropic (le contenu de la question/réponse dépend du modèle, hors périmètre d'un
 * test unitaire) : l'instantané de données envoyé (buildBoussoleContext), le rendu de l'écran, et le
 * fait que l'entrée de navigation reste hors de portée d'un manager.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function run() {
  const { DB, sandbox, buildBoussoleContext, renderBoussole, NAV_ITEMS } = loadAppJs();
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

  console.log('OK — boussole.test.js (nav réservée RH/Propriétaire/Comptabilité, instantané compact et sans champ sensible, écran rendu correctement)');
}

run().catch((err) => {
  console.error('ÉCHEC — boussole.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
