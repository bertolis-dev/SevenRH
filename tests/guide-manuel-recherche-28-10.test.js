/**
 * Seven RH — retour du 28/10/2026 : « il faut que le mode d'emploi soit le plus complet possible, avec toutes les réponses possibles, et qu'on
 * puisse rechercher pour trouver ce que l'on cherche ». Vérifie que chaque entrée du manuel est bien formée, qu'un rôle ne voit que ce qui le
 * concerne, que la recherche ignore accents/casse/petits mots, comprend les abréviations courantes et mène à la bonne réponse.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function run() {
  const api = loadAppJs();
  const { DB, sandbox, guideSections, guideRechercher, guideNormaliser, guideSurligner, GUIDE_THEMES, NAV_ITEMS, authRepository } = api;
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();

  const pour = (role) => {
    const emp = DB.getEmployees().find(e => e.role === role);
    if (!emp) return null;
    DB._currentEmployeeId = emp.id;
    return authRepository.getCurrentUser();
  };

  // --- Normalisation ---
  assert.strictEqual(guideNormaliser('Congés payés !'), 'conges payes');
  assert.strictEqual(guideNormaliser('  Œuvre, ÉCOLE  '), 'oeuvre ecole');

  // --- Les entrées du manuel sont bien formées (toutes, indépendamment du rôle) ---
  const ids = new Set();
  const navKeys = new Set(NAV_ITEMS.map(i => i.key));
  let total = 0;
  GUIDE_THEMES.forEach(t => {
    assert.ok(t.id && t.titre && t.intro, `thème ${t.id} : id, titre et introduction`);
    assert.ok(!ids.has(t.id), `identifiant de thème en double : ${t.id}`);
    ids.add(t.id);
    t.entrees.forEach(e => {
      total++;
      assert.ok(e.id && e.q && e.r && e.r.length > 40, `entrée ${e.id} : question et réponse non vides`);
      assert.ok(!ids.has(e.id), `identifiant d'entrée en double : ${e.id}`);
      ids.add(e.id);
      assert.ok(e.mots === undefined || typeof e.mots === 'string', `entrée ${e.id} : mots proches en texte`);
      if (e.vue) assert.ok(navKeys.has(e.vue), `entrée ${e.id} : l'écran « ${e.vue} » existe dans le menu`);
      assert.ok(!/\$\{|undefined|\[object/.test(e.r), `entrée ${e.id} : pas de texte non résolu dans la réponse`);
    });
  });
  assert.ok(total >= 100, `le manuel doit rester complet (au moins 100 réponses, ${total} trouvées)`);

  // --- Chaque rôle : identifiants uniques, thèmes adaptés, aucune réponse vide ---
  const parRole = {};
  ['salarie', 'manager', 'rh', 'comptabilite', 'proprietaire'].forEach(role => {
    const user = pour(role);
    if (!user) return;
    const sections = guideSections(user);
    parRole[role] = sections;
    const vus = new Set();
    sections.forEach(s => {
      assert.ok(!vus.has(s.id), `${role} : chapitre en double ${s.id}`);
      vus.add(s.id);
      (s.entrees || []).forEach(e => {
        assert.ok(!vus.has(e.id), `${role} : question en double ${e.id}`);
        vus.add(e.id);
        assert.ok(s.html.includes(`data-guide-entry="${e.id}"`), `${role} : la question ${e.id} est dans le chapitre ${s.id}`);
      });
    });
    ['depannage', 'glossaire', 'faire-compte', 'faire-conges'].forEach(id => assert.ok(sections.some(s => s.id === id), `${role} : chapitre ${id}`));
  });
  const ids2 = (role) => new Set((parRole[role] || []).map(s => s.id));
  assert.ok(!ids2('salarie').has('faire-salaries'), 'un salarié ne voit pas les chapitres de gestion RH');
  assert.ok(!ids2('salarie').has('faire-paie'), 'un salarié ne voit pas la paie');
  assert.ok(!ids2('salarie').has('faire-proprietaire'), 'un salarié ne voit pas la propriété du compte');
  assert.ok(ids2('rh').has('faire-salaries') && ids2('rh').has('faire-paie') && ids2('rh').has('faire-parametres'), 'les RH voient la gestion');
  assert.ok(!ids2('rh').has('faire-proprietaire'), 'les RH ne voient pas le chapitre réservé au propriétaire');
  assert.ok(ids2('proprietaire').has('faire-proprietaire'), 'le propriétaire voit son chapitre');
  assert.ok(ids2('manager').has('faire-equipe') && !ids2('salarie').has('faire-equipe'), 'le suivi d\'équipe est réservé aux rôles d\'équipe');
  const entreesSalarie = new Set((parRole.salarie || []).flatMap(s => (s.entrees || []).map(e => e.id)));
  assert.ok(entreesSalarie.has('c-poser') && !entreesSalarie.has('c-valider'), 'un salarié voit « poser un congé » mais pas « valider une demande »');
  const entreesManager = new Set((parRole.manager || []).flatMap(s => (s.entrees || []).map(e => e.id)));
  assert.ok(entreesManager.has('c-valider') && !entreesManager.has('s-ajouter'), 'un manager valide mais n\'ajoute pas de salarié');

  // --- Recherche : on trouve la bonne réponse en tête, avec les mots de tous les jours ---
  const rh = parRole.rh;
  const premier = (sections, requete) => {
    const { resultats } = guideRechercher(sections, requete);
    return resultats[0] && (resultats[0].entreeId || resultats[0].sectionId);
  };
  const sal = parRole.salarie;
  assert.strictEqual(premier(sal, 'poser un congé'), 'c-poser');
  assert.strictEqual(premier(sal, 'comment poser un conge ?'), 'c-poser', 'accents et petits mots ignorés');
  assert.strictEqual(premier(sal, 'POSER CONGÉ'), 'c-poser', 'majuscules ignorées');
  assert.strictEqual(premier(sal, 'mot de passe oublié'), 'k-mdp-oublie');
  assert.strictEqual(premier(sal, 'mdp'), 'k-mdp', 'abréviation « mdp »');
  assert.strictEqual(premier(sal, 'changer mon mot de passe'), 'k-mdp');
  assert.strictEqual(premier(sal, 'kilométrique'), 'f-km');
  assert.strictEqual(premier(sal, 'brouillon'), 'c-brouillon');
  assert.strictEqual(premier(sal, 'mode sombre'), 'k-theme');
  assert.strictEqual(premier(sal, 'rgpd'), 'd-rgpd');
  assert.strictEqual(premier(rh, 'importer des salariés'), 's-import');
  assert.strictEqual(premier(rh, 'soldes initiaux'), 's-import-soldes');
  assert.strictEqual(premier(rh, 'mise en service'), 'g-mise-en-service', 'les RH voient la définition, pas le mode d\x27emploi réservé au propriétaire');
  assert.strictEqual(premier(parRole.proprietaire, 'mise en service'), 'o-mise-en-service');
  const cpf = guideRechercher(sal, 'cpf').resultats.map(r => r.entreeId);
  assert.ok(cpf.includes('e-cpf') && cpf.includes('g-cpf'), 'cpf trouve la formation et le glossaire');
  assert.ok(guideRechercher(sal, 'cp').resultats.some(r => r.entreeId === 'g-cp'), '« cp » = congés payés (mot exact, pas « cpf »)');
  assert.ok(guideRechercher(sal, 'vacances').resultats.some(r => r.entreeId === 'c-poser'), 'synonyme « vacances » mène à poser un congé');
  assert.ok(guideRechercher(sal, 'teletravail').resultats.length > 0 && guideRechercher(sal, 'télétravail').resultats.length > 0, 'avec ou sans accent');

  // --- Résultats propres au rôle : un salarié ne se voit pas proposer la paie ---
  assert.ok(!guideRechercher(sal, 'export csv paie').resultats.some(r => r.entreeId === 'p-preparer'), 'la préparation de paie reste invisible pour un salarié');
  assert.ok(guideRechercher(rh, 'préparer la paie').resultats.some(r => r.entreeId === 'p-preparer'), 'les RH la trouvent');

  // --- Cas limites ---
  assert.strictEqual(guideRechercher(sal, '').resultats.length, 0, 'recherche vide');
  assert.strictEqual(guideRechercher(sal, '   ').resultats.length, 0, 'recherche d\'espaces');
  assert.strictEqual(guideRechercher(sal, 'xyzqwvk').resultats.length, 0, 'mot inconnu : aucun résultat');
  assert.strictEqual(guideRechercher(sal, 'comment je').resultats.length >= 0, true, 'que des petits mots : pas de plantage');
  const approchant = guideRechercher(sal, 'poser congé xyzqwvk');
  assert.ok(approchant.approchant && approchant.resultats.length > 0, 'si aucun résultat ne contient tous les mots, repli sur les plus proches');
  assert.ok(guideRechercher(sal, 'congé', { max: 5 }).resultats.length <= 5, 'limite de résultats');
  assert.doesNotThrow(() => guideRechercher(sal, '<script>alert(1)</script> (a+b)* [x'), 'caractères spéciaux sans effet');

  // --- Mise en évidence : accents ignorés, HTML échappé ---
  const { termes } = guideRechercher(sal, 'conge');
  assert.strictEqual(guideSurligner('Poser un congé payé', termes), 'Poser un <mark>congé</mark> payé');
  assert.ok(guideSurligner('<b>congé</b> & co', termes).includes('&lt;b&gt;<mark>congé</mark>'), 'le texte est échappé avant affichage');

  // --- Schémas (retour du 29/10/2026) : bien formés, accessibles, jamais dans les extraits de recherche ---
  const figures = [];
  const collecte = (html, ou) => { (String(html).match(/<figure class="guide-figure">[\s\S]*?<\/figure>/g) || []).forEach(h => figures.push({ ou, h })); };
  GUIDE_THEMES.forEach(t => t.entrees.forEach(e => collecte(e.r, e.id)));
  ['rh', 'salarie'].forEach(role => (parRole[role] || []).filter(x => ['reperes', 'role'].includes(x.id)).forEach(x => collecte(x.html, `${role}:${x.id}`)));
  assert.ok(figures.length >= 14, `au moins 14 schémas dans le guide (${figures.length} trouvés)`);
  figures.forEach(({ ou, h }) => {
    assert.ok(/<svg viewBox="0 0 560 \d+" role="img" aria-label="[^"]{15,}"/.test(h), `${ou} : le schéma a un titre lisible par les lecteurs d'écran`);
    assert.ok(!/NaN|undefined|Infinity|\[object/.test(h), `${ou} : aucune valeur de dessin invalide`);
    assert.ok((h.match(/<(rect|text|line|polygon|circle|path)\b/g) || []).length >= 3, `${ou} : le schéma contient des éléments`);
    assert.strictEqual((h.match(/<text\b/g) || []).length, (h.match(/<\/text>/g) || []).length, `${ou} : balises text équilibrées`);
    assert.strictEqual((h.match(/<svg\b/g) || []).length, 1, `${ou} : un seul dessin par schéma`);
    assert.ok(h.includes('</svg>'), `${ou} : dessin fermé`);
  });
  const idsAvecSchema = new Set(figures.map(x => x.ou));
  ['c-solde', 'c-suivre', 't-quota', 'f-km', 'e-formation', 's-import', 's-import-soldes', 'p-preparer', 'r-cloture'].forEach(id => assert.ok(idsAvecSchema.has(id), `schéma attendu dans ${id}`));
  guideRechercher(sal, 'solde').resultats.forEach(r => assert.ok(!/Acquis \+|Ajustement −|En attente Validé/.test(r.brut), "l'extrait ne reprend pas le texte d'un schéma"));

  // --- Captures réelles (retour du 29/10/2026) : chaque image existe, a un texte alternatif, reste légère ---
  const path = require("path");
  const fs = require("fs");
  const dossier = path.join(__dirname, "..", "guide-images");
  const sources = new Set();
  const lire = (html) => (String(html).match(/<img class="guide-shot-img"[^>]*>/g) || []).forEach(t => { sources.add(t); });
  GUIDE_THEMES.forEach(t => t.entrees.forEach(e => lire(e.r)));
  Object.values(parRole).forEach(secs => secs.forEach(x => lire(x.html)));
  assert.ok(sources.size >= 16, "au moins 16 captures différentes dans le guide (" + sources.size + ")");
  sources.forEach(tag => {
    const src = (tag.match(/src="guide-images\/([a-z0-9-]+\.jpg)"/) || [])[1];
    assert.ok(src, "source d'image valide : " + tag.slice(0, 80));
    const chemin = path.join(dossier, src);
    assert.ok(fs.existsSync(chemin), "fichier de capture présent : " + src);
    const taille = fs.statSync(chemin).size;
    assert.ok(taille > 8000 && taille < 300000, "taille raisonnable pour " + src + " (" + taille + " octets)");
    const octets = fs.readFileSync(chemin);
    assert.ok(octets[0] === 0xff && octets[1] === 0xd8, src + " est bien une image JPEG");
    assert.ok(/alt="[^"]{25,}"/.test(tag), "texte alternatif descriptif pour " + src);
  });
  assert.ok(fs.readdirSync(dossier).every(n => [...sources].some(t => t.includes("guide-images/" + n))), "aucune capture inutilisée dans le dossier");
  assert.ok((parRole.salarie.find(x => x.id === "ecran-dashboard").html).includes("accueil-salarie.jpg"), "un salarié voit sa propre page d'accueil");
  assert.ok((parRole.rh.find(x => x.id === "ecran-dashboard").html).includes("guide-images/accueil.jpg"), "un RH voit l'accueil RH");
  assert.ok(!(parRole.salarie.find(x => x.id === "ecran-calendrier").html).includes("calendrier-equipe"), "pas de calendrier d'équipe pour un salarié");
  assert.ok((parRole.manager.find(x => x.id === "ecran-calendrier").html).includes("calendrier-equipe"), "calendrier d'équipe pour un manager");

  console.log(`OK — guide-manuel-recherche-28-10.test.js (${total} réponses, recherche tolérante aux accents, abréviations, rôles)`);
}

try { run(); } catch (err) { console.error('ÉCHEC — guide-manuel-recherche-28-10.test.js'); console.error(err.stack || err.message); process.exitCode = 1; }
