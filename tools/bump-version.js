/**
 * Seven RH : passe l'application au numéro de version suivant. À lancer (npm run bump) à CHAQUE modification mise en ligne.
 *
 * Format : AAAA.MM.JJ.N, où N est le numéro de la mise en ligne du jour (1, 2, 3...). Le script change, en une fois :
 *   - APP_VERSION dans app.js (affiché dans le menu du compte, le guide et les Nouveautés) ;
 *   - le ?v= de tous les fichiers chargés par index.html (pour que chaque navigateur recharge la dernière version).
 * Il ne touche pas aux Nouveautés : ajoutez-y une ligne à la main dans la première entrée de CHANGELOG_ENTRIES (app.js).
 * Le test version-application-26-10 vérifie que tout reste aligné.
 */
const fs = require('fs');
const path = require('path');

const racine = path.join(__dirname, '..');
const appPath = path.join(racine, 'app.js');
const htmlPath = path.join(racine, 'index.html');

function aujourdhui() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

const app = fs.readFileSync(appPath, 'utf8');
const trouve = /const APP_VERSION = '(\d{4}\.\d{2}\.\d{2})(?:\.(\d+))?';/.exec(app);
if (!trouve) { console.error('APP_VERSION introuvable dans app.js'); process.exit(1); }
const dateActuelle = trouve[1];
const numeroActuel = trouve[2] ? parseInt(trouve[2], 10) : 0;
const date = aujourdhui();
const suivant = `${date}.${date === dateActuelle ? numeroActuel + 1 : 1}`;

fs.writeFileSync(appPath, app.replace(trouve[0], `const APP_VERSION = '${suivant}';`));

const html = fs.readFileSync(htmlPath, 'utf8');
const nouveauHtml = html.replace(/\?v=[0-9A-Za-z.]+/g, `?v=${suivant}`);
if (nouveauHtml === html && !html.includes(`?v=${suivant}`)) { console.error('Aucun ?v= trouvé dans index.html'); process.exit(1); }
fs.writeFileSync(htmlPath, nouveauHtml);

console.log(`Version : ${trouve[1]}${trouve[2] ? '.' + trouve[2] : ''} -> ${suivant}`);
console.log('Pensez à ajouter une ligne dans la première entrée de CHANGELOG_ENTRIES (app.js) si la modification est visible des utilisateurs.');
