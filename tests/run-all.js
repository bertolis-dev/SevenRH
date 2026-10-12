/**
 * Lanceur de la suite de tests : exécute chaque tests/*.test.js l'un après l'autre (un processus Node par
 * fichier, comme l'ancienne chaîne « node a && node b && ... ») et sort en erreur si l'un d'eux échoue.
 * Remplace cette chaîne, devenue trop longue pour la ligne de commande de Windows
 * (« La ligne de commande est trop longue ») — et qui obligeait à enregistrer à la main chaque nouveau
 * fichier dans package.json : tout fichier tests/*.test.js est désormais exécuté d'office.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dossier = __dirname;
const fichiers = fs.readdirSync(dossier).filter(f => f.endsWith('.test.js')).sort();
const echecs = [];

fichiers.forEach(f => {
  const resultat = spawnSync(process.execPath, [path.join(dossier, f)], { stdio: 'inherit' });
  if (resultat.status !== 0) echecs.push(f);
});

console.log(`\n${fichiers.length - echecs.length}/${fichiers.length} fichiers de tests réussis.`);
if (echecs.length) {
  console.error('Fichiers en échec :\n  ' + echecs.join('\n  '));
  process.exit(1);
}
