/**
 * Seven RH — retour Betty du 21/09/2026 ("j'ai repris l'application non plus écran par écran, mais
 * rôle par rôle") : 5 points, le premier jugé le plus important de tous.
 *
 * 1. VOIR_PROPRE_FICHE (PERMISSIONS, data.js) existait déjà, accordée par défaut à tous les rôles,
 *    mais n'était lue nulle part — "la fonction a été pensée, elle n'a jamais été branchée". Une
 *    nouvelle entrée de menu "Ma fiche" la branche enfin sur renderEmployeeDetail (déjà en lecture
 *    seule pour qui n'a pas canEdit, voir canEditEmployeeRecord) : aucun nouvel écran, juste le
 *    câblage manquant. À décider ensemble : salaire contractuel et suivi médical visibles pour
 *    soi-même (son avis, confirmé), mais jamais le coût employeur ni l'historique/ses motifs
 *    (appréciation RH interne potentielle).
 * 2. "Mes documents" (NAV_ITEMS, roles: ['salarie']) ouvert à tous les rôles — un RH/manager est
 *    aussi un salarié avec ses propres bulletins.
 * 3. Le type de contrat s'affichait sans condition à 4 endroits (pastille, carte "Contrat & poste",
 *    colonne de la liste, fiche imprimable) alors que le reste des informations contractuelles y
 *    était déjà masqué pour qui n'a pas VOIR_INFOS_CONTRACTUELLES — même garde-fou partout désormais
 *    (canSeeContractuel = soi-même OU la permission).
 * 4. "Mes tickets" renommé "Aide et support" (confusion avec "Tickets restaurant", même groupe de
 *    menu, noms presque identiques pour deux écrans sans rapport).
 * 5. Planning : le seul filtre service réintroduit (vue équipe uniquement, jamais le reste du
 *    panneau retiré le 10/09/2026). Entretiens : la pagination existe déjà (getFilteredEntretiens/
 *    renderEntretiens, socle commun du 19/09/2026) — vérifié ici pour ne pas la "corriger" à tort.
 *    Mes documents : recherche + regroupement par catégorie ajoutés.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function setup() {
  const api = loadAppJs();
  api.sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  api.DB.init();
  const rh = api.DB.getEmployees().find(e => e.role === 'rh');
  api.DB._currentEmployeeId = rh.id;
  const sarah = api.employeeRepository.getAll().find(e => e.prenom === 'Sarah');
  const nicolas = api.employeeRepository.getAll().find(e => e.prenom === 'Nicolas');
  return { ...api, rh, sarah, nicolas };
}

// ---- Point 1 : Ma fiche ----

async function runVoirProprePermissionEnfinBrancheeSurMaFiche() {
  const { NAV_ITEMS, PERMISSIONS } = setup();
  const item = NAV_ITEMS.find(i => i.key === 'ma-fiche');
  assert.ok(item, '"Ma fiche" doit exister dans NAV_ITEMS');
  assert.ok(Array.isArray(item.permissions) && item.permissions.includes(PERMISSIONS.VOIR_PROPRE_FICHE),
    '"Ma fiche" doit être gatée par VOIR_PROPRE_FICHE — jamais un simple roles en dur, sinon la permission reste morte');

  console.log('OK — revue-par-role-21-09.test.js (point 1 : VOIR_PROPRE_FICHE enfin branchée sur "Ma fiche")');
}

async function runSalarieVoitSaPropreFicheEnLectureSeule() {
  const { DB, sandbox, navigateTo, render, state, sarah } = setup();
  DB._currentEmployeeId = sarah.id;

  navigateTo('ma-fiche');
  assert.strictEqual(state.view, 'ma-fiche', 'la navigation doit réussir pour un salarié (VOIR_PROPRE_FICHE accordée par défaut)');
  render();
  const html = sandbox.document.getElementById('view-root').innerHTML;
  assert.ok(html.includes('Sarah') && html.includes('BENALI'), 'la fiche affichée doit être celle du salarié connecté');
  assert.ok(html.includes('Ancienneté'), 'l\'ancienneté doit être visible, comme demandé');
  assert.ok(!html.includes('data-nouveau-contrat') && !html.includes('id="btn-avenant"'),
    'aucun bouton de modification (nouveau contrat/avenant) ne doit apparaître : lecture seule, sauf coordonnées');
  assert.ok(html.includes('Accueil') , 'le fil d\'Ariane doit renvoyer vers l\'Accueil, jamais vers "Salariés" (inaccessible à ce rôle)');

  console.log('OK — revue-par-role-21-09.test.js (point 1 : le salarié voit sa propre fiche en lecture seule via "Ma fiche")');
}

async function runSalarieVoitSonSalaireLimiteSansCoutEmployeurNiHistorique() {
  const { DB, settingsRepository, employeeRepository, renderEmployeeDetail, sarah } = setup();
  const settings = settingsRepository.getSettings();
  settings.masseSalarialeActivee = true;
  settingsRepository.saveSettings(settings);
  employeeRepository.update(sarah.id, {
    salaireBrutMensuel: 2400,
    historiqueSalaire: [{ date: '2026-06-01T00:00:00.000Z', ancienMontant: 2200, nouveauMontant: 2400, motif: 'Refus d\'augmentation initial, accordée ensuite après négociation difficile' }]
  });
  DB._currentEmployeeId = sarah.id;

  const html = renderEmployeeDetail(sarah.id);
  assert.ok(html.includes('Rémunération'), 'une carte "Rémunération" doit apparaître pour le salarié lui-même');
  assert.ok(html.includes('2') && /2[\s ]*400/.test(html.replace(/&nbsp;/g, ' ')), 'le salaire brut mensuel actuel doit être affiché');
  assert.ok(!html.includes('Coût employeur'), 'le coût employeur (donnée de gestion interne, jamais sur un bulletin) ne doit jamais être montré au salarié');
  assert.ok(!html.includes('négociation difficile'), 'le motif de l\'historique (appréciation RH interne potentielle) ne doit jamais être montré au salarié');

  console.log('OK — revue-par-role-21-09.test.js (point 1 : salaire actuel visible pour soi-même, coût employeur et motifs d\'historique masqués)');
}

// ---- Point 2 : Mes documents ouvert à tous ----

async function runMesDocumentsOuvertATousLesRoles() {
  const { NAV_ITEMS, ROLES } = setup();
  const item = NAV_ITEMS.find(i => i.key === 'mes-documents');
  Object.values(ROLES).forEach(role => {
    assert.ok(item.roles.includes(role), `"Mes documents" doit être accessible au rôle ${role}`);
  });

  console.log('OK — revue-par-role-21-09.test.js (point 2 : "Mes documents" ouvert à tous les rôles)');
}

async function runMesDocumentsAfficheLesDocumentsDeLUtilisateurConnecteQuelQueSoitSonRole() {
  const { DB, documentRepository, renderMesDocuments, nicolas } = setup();
  documentRepository.create({ employeeId: nicolas.id, categorie: 'Bulletin de paie', nom: 'Bulletin août 2026' });
  DB._currentEmployeeId = nicolas.id;

  const html = renderMesDocuments();
  assert.ok(html.includes('Bulletin août 2026'), 'un manager doit voir SES PROPRES documents dans "Mes documents", comme un salarié');

  console.log('OK — revue-par-role-21-09.test.js (point 2 : un manager voit ses propres documents via "Mes documents")');
}

// ---- Point 3 : type de contrat cloisonné ----

async function runTypeContratMasquePourManagerSansPermissionVisiblePourSoiMeme() {
  const { DB, hasPermission, PERMISSIONS, renderEmployeeDetail, nicolas, sarah } = setup();
  // Sarah est managée par Nicolas (seedEmployees, data.js) — Nicolas n'a pas VOIR_INFOS_CONTRACTUELLES
  // par défaut (DEFAULT_ROLE_PERMISSIONS, réservée à RH/Propriétaire).
  DB._currentEmployeeId = nicolas.id;
  assert.strictEqual(hasPermission(nicolas, PERMISSIONS.VOIR_INFOS_CONTRACTUELLES), false,
    'contrôle : un manager ne doit pas avoir VOIR_INFOS_CONTRACTUELLES par défaut, sinon ce test ne prouve rien');

  // >CDD< (valeur affichée telle quelle, badge ou infoRow) plutôt qu'un simple .includes() : les
  // commentaires du fichier source mentionnent eux-mêmes "CDD" en toutes lettres (ex. le commentaire
  // sur dateFinContrat/dateDepart un peu plus loin dans la même fonction), un faux positif garanti.
  const htmlEquipe = renderEmployeeDetail(sarah.id);
  assert.ok(!htmlEquipe.includes(`>${sarah.typeContrat}<`), 'un manager sans VOIR_INFOS_CONTRACTUELLES ne doit plus voir le type de contrat d\'un membre de son équipe (pastille + carte)');

  const htmlSoiMeme = renderEmployeeDetail(nicolas.id);
  assert.ok(htmlSoiMeme.includes(`>${nicolas.typeContrat}<`), 'un manager doit continuer à voir SON PROPRE type de contrat (exception "soi-même", comme le reste des informations contractuelles)');

  console.log('OK — revue-par-role-21-09.test.js (point 3 : type de contrat masqué pour un tiers sans permission, visible pour soi-même)');
}

async function runTypeContratMasqueDansLaColonneDeLaListeDesSalaries() {
  const { DB, renderEmployeesList, nicolas, sarah } = setup();
  DB._currentEmployeeId = nicolas.id;

  // On isole la ligne DE SARAH par son data-id avant de vérifier sa cellule "Contrat" : le
  // toolbar de cet écran contient lui-même un <select> listant tous les types de contrat possibles
  // (filtre), un .includes() global sur "CDD" y trouverait toujours un faux positif.
  const html = renderEmployeesList();
  const rowStart = html.indexOf(`data-id="${sarah.id}"`);
  assert.ok(rowStart !== -1, 'la ligne de Sarah doit être présente dans la liste (elle est dans l\'équipe du manager connecté)');
  const row = html.slice(rowStart, html.indexOf('</tr>', rowStart));
  assert.ok(row.includes('data-label="Contrat"></td>'), 'la cellule "Contrat" de sa ligne doit être vide pour un rôle sans VOIR_INFOS_CONTRACTUELLES, jamais fuiter le badge');

  console.log('OK — revue-par-role-21-09.test.js (point 3 : la colonne "Contrat" de la liste des salariés respecte le même cloisonnement)');
}

// ---- Point 4 : renommage "Aide et support" ----

async function runMesTicketsRenommeAideEtSupport() {
  const { NAV_ITEMS, renderMesTickets, HELP_CONTENT } = setup();
  const item = NAV_ITEMS.find(i => i.key === 'mes-tickets');
  assert.strictEqual(item.label, 'Aide et support', 'l\'entrée de menu doit être renommée, pour ne plus prêter à confusion avec "Tickets restaurant"');
  assert.ok(renderMesTickets().includes('Aide et support'), 'le titre affiché à l\'écran doit suivre le même renommage');
  assert.strictEqual(HELP_CONTENT['mes-tickets'].title, 'Aide et support', 'l\'aide contextuelle doit être alignée sur le nouveau nom');

  console.log('OK — revue-par-role-21-09.test.js (point 4 : "Mes tickets" renommé "Aide et support", écran et aide contextuelle alignés)');
}

// ---- Point 5 : Planning (filtre service), Entretiens (pagination déjà là), Mes documents (recherche + classement) ----

async function runPlanningFiltreServiceReintroduitEnEquipeSeulement() {
  const { DB, shiftRepository, renderPlanning, state, nicolas, sarah } = setup();
  DB._currentEmployeeId = nicolas.id;
  // Nicolas (manager, service IT) encadre Sarah (service Commercial) — les deux sont dans son
  // équipe visible (getVisibleEmployeeIdsForCurrentUser), donc les deux services apparaissent dans
  // sa grille équipe sans filtre.
  shiftRepository.create({ employeeId: sarah.id, weekday: 'Lun', heureDebut: '09:00', heureFin: '17:00', pauseMinutes: 60 });
  shiftRepository.create({ employeeId: nicolas.id, weekday: 'Lun', heureDebut: '10:00', heureFin: '18:00', pauseMinutes: 60 });

  state.planningVue = 'equipe';
  state.planningPostesFilters.service = '';
  const sansFiltre = renderPlanning();
  assert.ok(sansFiltre.includes('09:00-17:00') && sansFiltre.includes('10:00-18:00'), 'sans filtre, les deux services doivent apparaître');

  state.planningPostesFilters.service = 'Commercial';
  const avecFiltre = renderPlanning();
  assert.ok(avecFiltre.includes('09:00-17:00'), 'le service filtré doit rester visible');
  assert.ok(!avecFiltre.includes('10:00-18:00'), 'un manager de vingt personnes doit pouvoir isoler un seul service : les autres doivent disparaître');

  state.planningVue = 'personnel';
  state.planningPostesFilters.service = '';
  const vueMoi = renderPlanning();
  assert.ok(!vueMoi.includes('id="planning-postes-filter-service"'), 'le filtre ne doit jamais apparaître en vue "Moi" (un seul salarié déjà affiché)');

  console.log('OK — revue-par-role-21-09.test.js (point 5 : le filtre service du Planning isole réellement un service, absent en vue "Moi")');
}

async function runEntretiensPaginationDejaPresenteAvantCetteLettre() {
  const appSource = require('fs').readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8');
  const fnStart = appSource.indexOf('function renderEntretiens(');
  const fnEnd = appSource.indexOf('\nfunction ', fnStart + 30);
  const body = appSource.slice(fnStart, fnEnd);
  assert.ok(body.includes("paginate(filtered, 'entretiensPage')"), 'la pagination des Entretiens existe déjà (socle commun du 19/09/2026) — la lettre du 21/09 se trompait sur ce point précis, rien à corriger ici');
  assert.ok(body.includes('renderPaginationControls('), 'les contrôles de pagination doivent bien être rendus');

  console.log('OK — revue-par-role-21-09.test.js (point 5 : la pagination des Entretiens était déjà présente, aucune correction nécessaire)');
}

async function runMesDocumentsRechercheEtRegroupementParCategorie() {
  const { DB, documentRepository, renderMesDocuments, state, sarah } = setup();
  documentRepository.create({ employeeId: sarah.id, categorie: 'Bulletin de paie', nom: 'Bulletin juillet 2026' });
  documentRepository.create({ employeeId: sarah.id, categorie: 'Attestation', nom: 'Attestation employeur' });
  DB._currentEmployeeId = sarah.id;

  const html = renderMesDocuments();
  assert.ok(html.includes('id="mes-documents-search"'), 'un champ de recherche doit être présent');
  assert.ok(html.includes('Attestation') && html.includes('Bulletin de paie'), 'les catégories doivent apparaître comme en-têtes de regroupement');

  state.mesDocumentsSearch = 'attestation';
  const htmlFiltre = renderMesDocuments();
  assert.ok(htmlFiltre.includes('Attestation employeur'), 'la recherche doit retrouver un document par son nom/catégorie');
  assert.ok(!htmlFiltre.includes('Bulletin juillet 2026'), 'la recherche doit exclure les documents qui ne correspondent pas');

  console.log('OK — revue-par-role-21-09.test.js (point 5 : "Mes documents" a désormais une recherche et un classement par catégorie)');
}

runVoirProprePermissionEnfinBrancheeSurMaFiche()
  .then(runSalarieVoitSaPropreFicheEnLectureSeule)
  .then(runSalarieVoitSonSalaireLimiteSansCoutEmployeurNiHistorique)
  .then(runMesDocumentsOuvertATousLesRoles)
  .then(runMesDocumentsAfficheLesDocumentsDeLUtilisateurConnecteQuelQueSoitSonRole)
  .then(runTypeContratMasquePourManagerSansPermissionVisiblePourSoiMeme)
  .then(runTypeContratMasqueDansLaColonneDeLaListeDesSalaries)
  .then(runMesTicketsRenommeAideEtSupport)
  .then(runPlanningFiltreServiceReintroduitEnEquipeSeulement)
  .then(runEntretiensPaginationDejaPresenteAvantCetteLettre)
  .then(runMesDocumentsRechercheEtRegroupementParCategorie)
  .catch((err) => {
    console.error('ÉCHEC — revue-par-role-21-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
