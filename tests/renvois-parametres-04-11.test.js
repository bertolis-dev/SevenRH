/**
 * Seven RH — retour du 04/11/2026 (« regarde s'il y a d'autres problèmes de ce genre ») : plusieurs textes renvoyaient vers un onglet de Paramètres qui
 * n'existe plus ou qui n'héberge pas le réglage (« Paramètres > Listes », « Types d'absences », « Entreprise » pour un taux de charges réglé dans
 * Rémunération...). Ce test lit les textes visibles de app.js et vérifie que chaque « Paramètres > X » (et « Paramètres, onglet X » du guide)
 * désigne un onglet réel, et que quelques réglages clés sont bien annoncés là où ils se règlent vraiment.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const bloc = source.slice(source.indexOf('const PARAMETRES_TABS = ['));
  const onglets = [...bloc.slice(0, bloc.indexOf('];')).matchAll(/key: '([^']+)', label: '([^']+)'/g)]
    .map(m => ({ cle: m[1], libelle: m[2].replace(/&amp;/g, '&') }));
  assert.ok(onglets.length >= 15, 'liste des onglets de Paramètres trouvée');
  const libelles = onglets.map(o => o.libelle);
  const valide = (segment) => libelles.some(l => segment === l || segment.startsWith(l + ' ') || segment === l.replace('&', '&amp;'));

  const lignes = source.split('\n');
  const visibles = lignes.map((texte, i) => ({ texte: texte.replace(/\s\/\/\s.*$/, ''), numero: i + 1 })).filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l.texte));

  // 1. « Paramètres > Onglet » dans les textes affichés.
  visibles.forEach(({ texte, numero }) => {
    for (const m of texte.matchAll(/Paramètres (?:&gt;|>|›) ([^'"`<>.,;:)(]+)/g)) {
      const segment = m[1].replace(/&amp;/g, '&').replace(/\\$/, '').trim();
      assert.ok(valide(segment), `app.js:${numero} renvoie vers « Paramètres > ${segment} » : cet onglet n'existe pas (onglets : ${libelles.join(', ')})`);
    }
    // 2. Les renvois du guide : « Paramètres</strong>, onglet <strong>X</strong> » et « Paramètres, onglet « X » ».
    for (const m of texte.matchAll(/Paramètres<\/strong>[^<]{0,30}onglet <strong>([^<]+)<\/strong>/g)) {
      assert.ok(valide(m[1].replace(/&amp;/g, '&')), `app.js:${numero} : le guide renvoie vers l'onglet « ${m[1]} » qui n'existe pas dans Paramètres`);
    }
    for (const m of texte.matchAll(/Paramètres, onglet « ([^»]+) »/g)) {
      assert.ok(valide(m[1].replace(/&amp;/g, '&')), `app.js:${numero} : renvoi vers l'onglet « ${m[1]} » qui n'existe pas dans Paramètres`);
    }
  });

  // 3. Quelques réglages et l'onglet qui les héberge vraiment : le texte qui en parle doit nommer ce même onglet.
  const ongletDe = (idChamp) => {
    const i = source.indexOf(`id="${idChamp}"`);
    assert.ok(i > 0, `champ ${idChamp} introuvable`);
    const fonction = [...source.slice(0, i).matchAll(/^function (render\w+)\(/gm)].pop()[1];
    const ligne = bloc.split('\n').find(l => l.includes(`render: ${fonction},`));
    assert.ok(ligne, `${idChamp} : la fonction ${fonction} n'est pas un onglet de Paramètres`);
    return ongletsParLigne(ligne);
  };
  const ongletsParLigne = (ligne) => (ligne.match(/label: '([^']+)'/) || [])[1].replace(/&amp;/g, '&');
  assert.strictEqual(ongletDe('f-taux-charges-patronales'), 'Rémunération');
  assert.strictEqual(ongletDe('f-duree-hebdo-reference'), 'RH');
  assert.strictEqual(ongletDe('f-seuil-visite-reprise'), 'RH');
  assert.strictEqual(ongletDe('f-duree-conservation'), 'RH');
  assert.strictEqual(ongletDe('f-teletravail-quota'), 'Planning et télétravail');
  assert.ok(source.includes('(Paramètres > Rémunération), un ordre de grandeur'), 'le coût employeur renvoie vers Rémunération');
  assert.ok(source.includes('(Paramètres &gt; RH)'), 'la durée de référence renvoie vers RH');
  assert.ok(source.includes('seuil indicatif : voir Paramètres &gt; RH.'), 'le seuil de visite de reprise renvoie vers RH');
  assert.ok(source.includes('durée de conservation, voir Paramètres > RH'), 'la durée de conservation renvoie vers RH');

  console.log(`OK — renvois-parametres-04-11.test.js (${onglets.length} onglets, tous les renvois de Paramètres désignent un onglet réel)`);
}

try { run(); } catch (err) { console.error('ÉCHEC — renvois-parametres-04-11.test.js'); console.error(err.stack || err.message); process.exitCode = 1; }
