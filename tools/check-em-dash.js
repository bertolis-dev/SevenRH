#!/usr/bin/env node
/**
 * Seven RH — point 6 (retour QA du 27/08/2026) : "ajoute une vérification dans la chaîne
 * d'intégration qui échoue si un tiret cadratin apparaît au milieu d'une phrase dans une chaîne
 * affichée. La règle est simple : un tiret précédé d'un mot et suivi d'une espace puis d'un mot, et
 * elle laisse passer les tirets de valeur vide." Un tiret cadratin (—) mi-phrase signe un texte
 * écrit par une machine — une virgule, un deux-points, un point ou une parenthèse fait le même
 * travail sans la signature.
 *
 * Approche : ne scanne que les lignes de CODE (jamais les commentaires) — un commentaire, écrit dans
 * la même prose que le texte affiché, matcherait tout aussi bien la règle sans jamais atteindre un
 * utilisateur. Pour index.html (HTML simple, pas de piège "// dans une URL"), les blocs <!-- --> sont
 * retirés proprement avant le scan. Pour app.js/data.js, une ligne dont le contenu (après l'espace de
 * tête) commence par // ou * ou <!-- est traitée comme un commentaire, et tout ce qui suit un // en
 * milieu de ligne est ignoré pour la détection — approximation délibérée (pas un vrai analyseur JS),
 * suffisante pour ce dépôt où les URLs en dur ne contiennent jamais de tiret cadratin juste après.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EM_DASH_MID_SENTENCE = /[\p{L}\p{N}] ?— ?[\p{L}\p{N}]/u;

function findViolationsInJs(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const violations = [];
  let inHtmlComment = false; // <!-- ... --> à l'intérieur d'un template HTML sur plusieurs lignes
  lines.forEach((raw, i) => {
    const trimmed = raw.replace(/^[ \t]+/, '');
    if (inHtmlComment) {
      if (trimmed.includes('-->')) inHtmlComment = false;
      return;
    }
    if (/^(\/\/|\*|\/\*|<!--)/.test(trimmed)) {
      if (trimmed.startsWith('<!--') && !trimmed.includes('-->')) inHtmlComment = true;
      return; // ligne de commentaire
    }
    let code = trimmed;
    const idx = code.indexOf('//');
    if (idx > -1) {
      const before = code.slice(0, idx);
      if (!EM_DASH_MID_SENTENCE.test(before)) return; // le tiret n'existe que dans la partie commentaire
      code = before;
    }
    if (EM_DASH_MID_SENTENCE.test(code)) violations.push({ line: i + 1, text: trimmed.slice(0, 160) });
  });
  return violations;
}

function findViolationsInHtml(filePath) {
  const content = fs.readFileSync(filePath, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const violations = [];
  content.split('\n').forEach((raw, i) => {
    if (EM_DASH_MID_SENTENCE.test(raw)) violations.push({ line: i + 1, text: raw.trim().slice(0, 160) });
  });
  return violations;
}

const targets = [
  { file: 'app.js', check: findViolationsInJs },
  { file: 'data.js', check: findViolationsInJs },
  { file: 'index.html', check: findViolationsInHtml },
];

let total = 0;
targets.forEach(({ file, check }) => {
  const violations = check(path.join(ROOT, file));
  if (violations.length) {
    console.error(`\n${file} — tiret cadratin mi-phrase (${violations.length}) :`);
    violations.forEach(v => console.error(`  ligne ${v.line} : ${v.text}`));
    total += violations.length;
  }
});

if (total > 0) {
  console.error(`\nÉCHEC — check-em-dash.js (${total} occurrence${total > 1 ? 's' : ''} à corriger : remplacez par une virgule, un deux-points, un point ou une parenthèse — jamais un tiret cadratin mi-phrase dans une chaîne affichée).`);
  process.exitCode = 1;
} else {
  console.log('OK — check-em-dash.js (aucun tiret cadratin mi-phrase dans app.js/data.js/index.html)');
}
