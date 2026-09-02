/**
 * Seven RH — refonte visuelle "produit premium" demandée par Betty le 01/09/2026, vague 2 : couvre
 * les points qui touchent à de la vraie logique (pas seulement du CSS, déjà vérifié en direct dans le
 * navigateur) — auteur capturé dans le journal d'audit, historique d'activité par fiche salarié, fil
 * d'Ariane, et surtout la non-régression des 4 badges de type de contrat (Stage/Alternance/
 * Apprentissage/Intérim), qui réutilisaient les classes .avatar-color-* AVANT que ces dernières ne
 * soient repassées au marine uni pour l'accent chromatique unique — sans palette dédiée (.tag-color-*),
 * les 4 badges seraient devenus visuellement identiques.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function run() {
  const { DB, sandbox, renderContratBadge, renderBreadcrumb, getEmployeeActivityHistory, auditLogRepository, getThemePreference, applyThemePreference, performGlobalSearch, renderCongesDemandes, bulkSelection } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();

  // ---- Non-régression : les 4 badges catégoriels restent visuellement distincts (classes .tag-color-*
  //      dédiées), jamais recollés sur .avatar-color-* (repassées au marine uni pour tout le monde) ----
  {
    const classes = ['Stage', 'Alternance', 'Apprentissage', 'Intérim'].map(t => {
      const html = renderContratBadge(t);
      const m = html.match(/class="badge ([\w-]+)"/);
      return m && m[1];
    });
    assert.ok(classes.every(c => /^tag-color-\d$/.test(c)), `les 4 badges catégoriels doivent utiliser .tag-color-*, jamais .avatar-color-* (obtenu ${classes})`);
    assert.strictEqual(new Set(classes).size, 4, 'les 4 badges catégoriels doivent rester 4 classes distinctes, sinon ils redeviennent indiscernables à l\'œil');
    // CDI/CDD gardent leur portée sémantique (badge-success/warning), jamais touchés par ce correctif.
    assert.ok(renderContratBadge('CDI').includes('badge-success'));
    assert.ok(renderContratBadge('CDD').includes('badge-warning'));
  }

  // ---- Fil d'Ariane : dernier maillon toujours du texte simple (jamais un lien vers soi-même) ----
  {
    const html = renderBreadcrumb([{ label: 'Salariés', nav: 'employees' }, { label: 'Jean Dupont' }]);
    assert.ok(html.includes('data-nav="employees"'), 'le premier maillon doit être cliquable (retour à la liste)');
    assert.ok(/<span>Jean Dupont<\/span>/.test(html), 'le dernier maillon (page courante) doit être du texte simple, jamais un lien');
    assert.ok(!html.includes('data-nav="employees">Jean Dupont'), 'le nom du salarié ne doit jamais être rendu cliquable');
  }

  // ---- Auteur capturé automatiquement dans le journal d'audit (nouveau champ, 0044_audit_log_auteur) ----
  {
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    DB.logAudit('Modification', 'Test', 'Une cible quelconque');
    const last = auditLogRepository.getAuditLog()[0];
    assert.strictEqual(last.auteur, `${rh.prenom} ${rh.nom}`, 'logAudit doit capturer automatiquement l\'utilisateur courant comme auteur, sans que chaque appel n\'ait à le préciser');
  }

  // ---- Historique d'activité par fiche : filtre par nom, respecte la limite, plus récent d'abord ----
  {
    const employee = DB.getEmployees().find(e => e.role !== 'rh');
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const fullName = `${employee.prenom} ${employee.nom}`;
    DB.logAudit('Modification', 'Salarié', fullName);
    DB.logAudit('Modification', 'Compteur congé', `${fullName} · CP · ajustement +1 j`);
    DB.logAudit('Modification', 'Salarié', 'Quelqu\'un d\'autre entièrement');

    const history = getEmployeeActivityHistory(employee, 8);
    assert.ok(history.length >= 2, 'doit retrouver les entrées dont la cible mentionne ce salarié');
    assert.ok(history.every(h => h.cible.includes(fullName)), 'ne doit jamais faire remonter une entrée d\'un autre salarié');
    assert.ok(new Date(history[0].date) >= new Date(history[history.length - 1].date), 'doit rester trié du plus récent au plus ancien (ordre de getAuditLog)');

    const limited = getEmployeeActivityHistory(employee, 1);
    assert.strictEqual(limited.length, 1, 'doit respecter la limite demandée');
  }

  // ---- §correctif audit du 01/09/2026 : jamais de fuite vers un autre salarié dont le nom complet
  //      contient celui-ci comme préfixe (nom composé) — un simple .includes() les confondait ----
  {
    const employee = DB.getEmployees().find(e => e.role !== 'rh');
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const fullName = `${employee.prenom} ${employee.nom}`;

    DB.logAudit('Modification', 'Salarié', fullName);
    // Nom composé qui commence PAR le nom de cet employé, mais désigne quelqu'un d'autre.
    DB.logAudit('Régularisation congé', 'Congé', `${fullName}-Martin · CP → RTT · 12/08/2026`);
    // Nom composé qui se TERMINE par le nom de cet employé, mais désigne quelqu'un d'autre.
    DB.logAudit('Prolongation arrêt', 'Maladie', `Jean-${fullName} · Maladie · jusqu'au 20/08/2026`);

    const history = getEmployeeActivityHistory(employee, 8);
    assert.ok(history.some(h => h.cible === fullName), 'doit toujours retrouver la vraie entrée de ce salarié');
    assert.ok(!history.some(h => h.cible.startsWith(`${fullName}-Martin`)), 'un nom composé qui COMMENCE par ce nom (ex. "-Martin") ne doit jamais être confondu avec ce salarié');
    assert.ok(!history.some(h => h.cible.includes(`Jean-${fullName}`)), 'un nom composé qui SE TERMINE par ce nom ne doit jamais être confondu avec ce salarié');
  }

  // ---- Mode sombre manuel : 'system' n'écrit rien (suit l'OS), 'light'/'dark' persistent et se relisent ----
  {
    assert.strictEqual(getThemePreference(), 'system', 'par défaut, sans réglage enregistré, doit suivre le système');

    applyThemePreference('dark');
    assert.strictEqual(getThemePreference(), 'dark', 'un choix "dark" doit être relu tel quel');
    assert.strictEqual(sandbox.localStorage.getItem('nexus_theme'), 'dark', 'doit être persisté en localStorage pour survivre à un rechargement');

    applyThemePreference('light');
    assert.strictEqual(getThemePreference(), 'light');

    applyThemePreference('system');
    assert.strictEqual(getThemePreference(), 'system', 'revenir à "system" doit repasser au comportement par défaut');
    assert.strictEqual(sandbox.localStorage.getItem('nexus_theme'), null, '"system" ne doit laisser aucune valeur en localStorage (jamais confondu avec un choix explicite)');
  }

  // ---- Palette de commandes (Ctrl+K) : une action correspondante apparaît en tête, avec run() exécutable ----
  {
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const results = performGlobalSearch('salarié');
    const command = results.find(r => r.label === 'Ajouter un salarié');
    assert.ok(command, 'RH (a CREER_SALARIE) doit voir la commande "Ajouter un salarié" en cherchant "salarié"');
    assert.strictEqual(command.sublabel, 'Action rapide', 'une commande doit se distinguer visuellement d\'un résultat de donnée');
    assert.strictEqual(typeof command.run, 'function', 'une commande doit être directement exécutable, pas juste une navigation');
    assert.strictEqual(results[0].label, command.label, 'les commandes doivent apparaître en tête, jamais reléguées derrière les résultats de données');

    const manager = DB.getEmployees().find(e => e.role === 'manager');
    DB._currentEmployeeId = manager.id;
    const resultsManager = performGlobalSearch('salarié');
    assert.ok(!resultsManager.some(r => r.label === 'Ajouter un salarié'), 'un manager (sans CREER_SALARIE) ne doit jamais voir cette commande, même en cherchant le même terme');

    DB._currentEmployeeId = rh.id;
  }

  // ---- Hiérarchie de boutons : jamais 2 boutons pleins en même temps sur l'écran Congés/Absences ----
  {
    const rh = DB.getEmployees().find(e => e.role === 'rh');
    DB._currentEmployeeId = rh.id;
    const countPrimary = (html) => (html.match(/btn-primary/g) || []).length;

    bulkSelection.conge.clear();
    const htmlSansSelection = renderCongesDemandes('conge');
    assert.strictEqual(countPrimary(htmlSansSelection), 1, 'sans sélection active, "+ Nouvelle demande" doit être le seul bouton plein');

    bulkSelection.conge.add('un-id-quelconque');
    const htmlAvecSelection = renderCongesDemandes('conge');
    assert.strictEqual(countPrimary(htmlAvecSelection), 1, 'avec une sélection active, "Valider la sélection" doit être seul en plein — "+ Nouvelle demande" repasse en secondaire, jamais les deux en même temps');
    assert.ok(htmlAvecSelection.includes('btn-bulk-approve'), 'le bouton de validation groupée doit toujours être présent quand une sélection existe');

    bulkSelection.conge.clear();
  }

  console.log('OK — design-refonte-wave2.test.js (badges catégoriels non régressés, fil d\'Ariane, auteur capturé, historique d\'activité par fiche, réglage de thème, palette de commandes, hiérarchie de boutons)');
}

run().catch((err) => {
  console.error('ÉCHEC — design-refonte-wave2.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
