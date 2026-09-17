/**
 * Seven RH — retour Betty du 17/09/2026 : "quand on est dans l'endroit pour se connecter et que on
 * se trompe dans nos codes et qu'on valide, les choses qu'on a écris ne doivent pas s'effacer".
 * Avant ce correctif, renderLoginView() générait des <input> sans value liée à l'état, et l'échec de
 * connexion (bindLoginScreenEvents, formulaire #login-form) déclenchait state.authError puis
 * renderLoginScreen(), qui régénère tout le HTML depuis zéro — effaçant donc ce qui avait été saisi.
 * Correctif : state.loginDraft (email/password), en mémoire seulement, jamais persisté, lu par
 * renderLoginView() et écrit juste avant l'appel à authRepository.login().
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAppJs } = require('./load-app-js');

async function runRenderLoginViewRepercuteLeBrouillon() {
  const { renderLoginView, state } = loadAppJs();

  state.loginDraft = { email: 'a"b&c@exemple.fr', password: 'Sécret&1' };
  const html = renderLoginView();
  assert.ok(html.includes('value="a&quot;b&amp;c@exemple.fr"'), 'l\'email saisi doit réapparaître dans le champ, échappé pour ne pas casser l\'attribut HTML');
  assert.ok(html.includes('value="Sécret&amp;1"'), 'le mot de passe saisi doit réapparaître dans le champ, échappé de la même façon');

  state.loginDraft = { email: '', password: '' };
  const htmlVide = renderLoginView();
  assert.ok(htmlVide.includes('id="f-login-email" required autocomplete="username" value=""'), 'un brouillon vide doit laisser le champ email vide, pas planter');

  console.log('OK — connexion-conserve-saisie-17-09.test.js (renderLoginView réaffiche le brouillon de saisie)');
}

async function runSaisieCaptureeAvantAppelLoginEtPreserveeApresEchec() {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const fnStart = appSource.indexOf('function bindLoginScreenEvents(');
  const nextFnStart = appSource.indexOf('function renderUserMenuButton(');
  assert.ok(fnStart !== -1 && nextFnStart !== -1 && nextFnStart > fnStart, 'les deux fonctions doivent être localisées pour découper la bonne tranche de source');
  const fnBody = appSource.slice(fnStart, nextFnStart);

  const submitStart = fnBody.indexOf("getElementById('login-form')");
  const submitEnd = fnBody.indexOf("btn-oauth-google");
  const submitHandler = fnBody.slice(submitStart, submitEnd);

  assert.ok(/state\.loginDraft\s*=\s*\{\s*email,\s*password\s*\}/.test(submitHandler), 'la saisie doit être capturée dans state.loginDraft avant l\'appel à authRepository.login, pour survivre à un échec');

  const captureIndex = submitHandler.search(/state\.loginDraft\s*=\s*\{\s*email,\s*password\s*\}/);
  const loginCallIndex = submitHandler.indexOf('authRepository.login(');
  assert.ok(captureIndex !== -1 && captureIndex < loginCallIndex, 'la capture doit avoir lieu avant l\'appel réseau, pas après');

  const failureBranch = submitHandler.slice(submitHandler.indexOf('if (!result.success)'), submitHandler.indexOf('return;\n      }\n      state.loginDraft'));
  assert.ok(!/loginDraft\s*=\s*\{\s*email:\s*''/.test(failureBranch), 'un échec de connexion ne doit surtout pas effacer state.loginDraft');

  const successIndex = submitHandler.indexOf('return;\n      }\n');
  const afterFailure = submitHandler.slice(successIndex);
  assert.ok(/state\.loginDraft\s*=\s*\{\s*email:\s*''\s*,\s*password:\s*''\s*\}/.test(afterFailure), 'une connexion réussie doit vider le brouillon avant de rejoindre l\'application (rien à conserver après coup)');
  assert.ok(afterFailure.indexOf('showApp()') > afterFailure.search(/state\.loginDraft\s*=\s*\{\s*email:\s*''/), 'le vidage doit précéder showApp()');

  console.log('OK — connexion-conserve-saisie-17-09.test.js (capturé avant l\'appel réseau, jamais effacé après un échec, vidé après succès)');
}

async function runShowLoginRemetLeBrouillonAZeroPourUneNouvelleConnexion() {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const fnStart = appSource.indexOf('function showLogin(');
  const fnBody = appSource.slice(fnStart, fnStart + 800);
  assert.ok(/state\.loginDraft\s*=\s*\{\s*email:\s*''\s*,\s*password:\s*''\s*\}/.test(fnBody), 'showLogin() doit repartir avec un brouillon vide (nouvel écran de connexion : après déconnexion, changement de compte, etc.), pour ne pas montrer une saisie d\'une session précédente');

  console.log('OK — connexion-conserve-saisie-17-09.test.js (showLogin repart avec un brouillon vide)');
}

async function runBrouilletNestJamaisPersiste() {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.ok(!/loginDraft/.test(appSource.match(/function saveCurrentCompany[\s\S]{0,2000}/)?.[0] || ''), 'loginDraft ne doit jamais transiter par la sauvegarde entreprise (données en mémoire uniquement)');
  // Recherche large : aucune écriture de loginDraft vers localStorage/sessionStorage/Supabase.
  const suspects = appSource.match(/(?:localStorage|sessionStorage|SupabaseSync)[^\n]*loginDraft|loginDraft[^\n]*(?:localStorage|sessionStorage|SupabaseSync)/g);
  assert.ok(!suspects, 'le mot de passe saisi ne doit jamais être écrit dans un stockage persistant, même en cas d\'échec de connexion');

  console.log('OK — connexion-conserve-saisie-17-09.test.js (le brouillon reste strictement en mémoire, jamais persisté)');
}

runRenderLoginViewRepercuteLeBrouillon()
  .then(runSaisieCaptureeAvantAppelLoginEtPreserveeApresEchec)
  .then(runShowLoginRemetLeBrouillonAZeroPourUneNouvelleConnexion)
  .then(runBrouilletNestJamaisPersiste)
  .catch((err) => {
    console.error('ÉCHEC — connexion-conserve-saisie-17-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
