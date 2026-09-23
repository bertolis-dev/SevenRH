/**
 * §retour Betty du 22/09/2026 : "je préfère cette présentation dans les catégories de salariés...
 * je voudrais que tu fasses la même chose pour les postes, les conventions, les types de contrats,
 * les forfaits, les catégories de documents, les checklists... fais que les lignes soient moins
 * hautes... tu mets bien l'ascenseur quand on peut afficher 7 lignes".
 *
 * Vérifie la PRÉSENTATION (un bouton "Ajouter" en en-tête, un formulaire replié, une liste de
 * lignes, un conteneur à ascenseur) et surtout que les crochets d'événements existants n'ont pas
 * bougé : le retrait et l'ajout passent toujours par data-list-key, donc bindChipListEvents
 * continue de fonctionner sans modification.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js.js');

const { sandbox } = loadAppJs();
const { renderSettingsListCard, renderPostesCard } = sandbox;

function test(nom, fn) {
  try { fn(); console.log(`OK — listes-reference-presentation-22-09.test.js (${nom})`); }
  catch (e) { console.error(`ÉCHEC — ${nom}`); throw e; }
}

const listDef = { key: 'typesContrat', label: 'Types de contrat' };
const items = ['CDI', 'CDD', 'Stage', 'Alternance', 'Apprentissage', 'Intérim', 'Saisonnier', 'Extra'];

test('un bouton "Ajouter" en en-tête, plus de champ toujours visible', () => {
  const html = renderSettingsListCard(listDef, items);
  assert.ok(html.includes('data-toggle-add-list="typesContrat"'), 'bouton Ajouter attendu');
  assert.ok(/class="chip-add-form settings-list-add"[^>]*hidden/.test(html), 'formulaire replié attendu');
});

test('les crochets d\'événements sont inchangés (data-list-key sur retrait et ajout)', () => {
  const html = renderSettingsListCard(listDef, items);
  assert.ok(html.includes('class="btn-link btn-link-danger chip-remove" data-list-key="typesContrat" data-index="0"'),
    'bindChipListEvents cible .chip-remove[data-list-key] avec data-index');
  assert.ok(html.includes('<form class="chip-add-form settings-list-add" data-list-key="typesContrat"'),
    'bindChipListEvents cible .chip-add-form avec data-list-key');
});

test('la liste passe dans un conteneur à ascenseur', () => {
  const html = renderSettingsListCard(listDef, items);
  assert.ok(html.includes('class="settings-list-scroll"'), 'conteneur à ascenseur attendu');
  assert.ok(html.includes('table-settings-list'), 'table compacte attendue');
});

test('une entrée officielle ne propose pas de suppression', () => {
  const html = renderSettingsListCard(
    { key: 'conventionsCollectives', label: 'Conventions collectives' },
    ['Aucune', 'Ma convention ajoutée'],
    new Set(['Aucune'])
  );
  assert.ok(html.includes('>Officielle<'), 'mention "Officielle" attendue');
  assert.ok(!/data-index="0"/.test(html), 'aucun bouton Supprimer sur l\'entrée officielle');
  assert.ok(html.includes('data-index="1"'), 'la convention ajoutée reste retirable');
});

test('liste vide : un message, jamais un tableau à un en-tête seul', () => {
  const html = renderSettingsListCard(listDef, []);
  assert.ok(html.includes('Aucun élément'), 'message de liste vide attendu');
  assert.ok(!html.includes('settings-list-scroll'), 'pas de conteneur à ascenseur sur une liste vide');
});

test('les postes suivent le même patron, en gardant leurs trois formes', () => {
  const html = renderPostesCard([{ neutre: 'Commercial·e', masculin: 'Commercial', feminin: 'Commerciale' }]);
  assert.ok(html.includes('data-toggle-add-list="poste"'), 'bouton Ajouter attendu');
  assert.ok(html.includes('class="settings-list-scroll"'), 'conteneur à ascenseur attendu');
  assert.ok(html.includes('data-champ="masculin"') && html.includes('data-champ="feminin"'),
    'les deux formes restent modifiables en ligne');
  assert.ok(html.includes('data-delete-poste="0" data-index="0"'),
    'bindPostesCardEvents lit btn.dataset.index');
});
