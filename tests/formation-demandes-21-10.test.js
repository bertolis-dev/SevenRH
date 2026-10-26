/**
 * Seven RH — retour du 21/10/2026, module Formation : demande de formation financée par l'entreprise ou via le CPF, décision du manager
 * ou du RH, lettres à préparer. Vérifie la saisie, le délai de prévenance CPF, les droits, la synchronisation et l'écran.
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

function run() {
  const api = loadAppJs();
  const { DB, sandbox, formationRepository, validerDemandeFormation, delaiPrevenanceCpf, genererDocumentFormation, peutDeciderFormation, renderFormation } = api;
  const envois = [];
  sandbox.window.SupabaseSync = new Proxy({}, {
    get: (_, nom) => (...args) => { envois.push({ nom, args }); return Promise.resolve({ success: true }); }
  });
  DB.init();
  const company = DB.getCurrentCompany();
  company.abonnement.offre = 'a_la_carte';
  company.abonnement.modules = [{ key: 'entretiens' }];
  DB.saveCurrentCompany(company);

  // --- Saisie ---
  assert.strictEqual(validerDemandeFormation({ intitule: 'ab' }).ok, false, 'intitulé trop court');
  assert.strictEqual(validerDemandeFormation({ intitule: 'Excel avancé', financement: 'autre' }).ok, false, 'financement inconnu');
  assert.strictEqual(validerDemandeFormation({ intitule: 'Excel avancé', dateDebut: '2026-12-10', dateFin: '2026-12-01' }).ok, false, 'fin avant début');
  assert.strictEqual(validerDemandeFormation({ intitule: 'Excel avancé', dateFin: '2026-12-01' }).ok, false, 'fin sans début');
  assert.strictEqual(validerDemandeFormation({ intitule: 'Excel avancé', coutEstime: '-5' }).ok, false, 'coût négatif');
  assert.strictEqual(validerDemandeFormation({ intitule: 'Excel avancé', lien: 'javascript:alert(1)' }).ok, false, 'lien non http');
  const ok = validerDemandeFormation({ intitule: '  Excel   avancé ', financement: 'cpf', dureeHeures: '21,5', coutEstime: '1 200,50', lien: 'https://exemple.fr/p' });
  assert.ok(ok.ok, ok.error);
  assert.strictEqual(ok.demande.intitule, 'Excel avancé');
  assert.strictEqual(ok.demande.dureeHeures, 21.5);
  assert.strictEqual(ok.demande.coutEstime, 1200.5);

  // --- Délai de prévenance CPF ---
  const juillet = new Date(2026, 6, 1);
  const court = delaiPrevenanceCpf('2026-10-01', '2026-10-30', juillet);
  assert.strictEqual(court.requisJours, 60);
  assert.strictEqual(court.respecte, true);
  assert.strictEqual(delaiPrevenanceCpf('2026-07-20', '2026-08-20', juillet).respecte, false);
  assert.strictEqual(delaiPrevenanceCpf('2026-12-01', '2027-06-30', juillet).requisJours, 120, 'six mois ou plus');
  assert.strictEqual(delaiPrevenanceCpf('', '', juillet), null);

  // --- Cycle de vie ---
  const salarie = DB.getEmployees().find(e => e.role === 'salarie');
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  const manager = DB.getEmployees().find(e => e.role === 'manager');
  const f = formationRepository.creer(salarie.id, ok.demande, salarie.id);
  assert.strictEqual(f.statut, 'demandee');
  assert.ok(envois.some(e => e.nom === 'pushFormations'), 'la demande part vers le serveur');
  assert.strictEqual(formationRepository.getById(f.id).decisionPar, null);

  assert.strictEqual(formationRepository.modifier(f.id, { ...ok.demande, intitule: 'Excel expert' }).success, true);
  assert.strictEqual(formationRepository.getById(f.id).intitule, 'Excel expert');

  assert.strictEqual(formationRepository.decider(f.id, 'refusee', '', rh.id).success, false, 'refus sans motif');
  assert.strictEqual(formationRepository.decider(f.id, 'realisee', '', rh.id).success, false, 'réalisée avant acceptation');
  assert.strictEqual(formationRepository.decider(f.id, 'acceptee', 'Bon projet', rh.id).success, true);
  const acceptee = formationRepository.getById(f.id);
  assert.strictEqual(acceptee.statut, 'acceptee');
  assert.strictEqual(acceptee.decisionPar, rh.id);
  assert.ok(envois.some(e => e.nom === 'updateFormation'), 'la décision part vers le serveur');
  assert.strictEqual(formationRepository.decider(f.id, 'refusee', 'non', rh.id).success, false, 'déjà traitée');
  assert.strictEqual(formationRepository.modifier(f.id, ok.demande).success, false, 'plus modifiable une fois traitée');
  assert.strictEqual(formationRepository.decider(f.id, 'realisee', '', rh.id).success, true);

  // --- Droits ---
  assert.strictEqual(peutDeciderFormation(salarie, f, false), false, 'le salarié ne décide pas');
  assert.strictEqual(peutDeciderFormation(rh, f, false), true, 'le RH décide');
  assert.strictEqual(peutDeciderFormation(manager, f, true), true, 'le manager de l\'équipe décide');
  assert.strictEqual(peutDeciderFormation(rh, { employeeId: rh.id }, false), false, 'le RH ne décide pas pour lui-même');

  // --- Visibilité ---
  const autre = DB.getEmployees().find(e => e.role === 'salarie' && e.id !== salarie.id);
  if (autre) assert.strictEqual(formationRepository.getVisibleTo(autre).length, 0, 'un collègue ne voit pas la demande');
  assert.strictEqual(formationRepository.getVisibleTo(salarie).length, 1);
  assert.strictEqual(formationRepository.getVisibleTo(rh).length, 1);

  // --- Lettres ---
  const cpf = formationRepository.creer(salarie.id, { ...ok.demande, dateDebut: '2027-03-01', dateFin: '2027-03-31', pendantTempsTravail: true }, salarie.id);
  const demande = genererDocumentFormation({ type: 'demande', demande: cpf, employee: salarie, entreprise: DB.getCurrentCompany(), maintenant: new Date(2027, 0, 5) });
  assert.ok(demande.paragraphes.join(' ').includes('Excel avancé'));
  const absence = genererDocumentFormation({ type: 'absence-cpf', demande: cpf, employee: salarie, entreprise: DB.getCurrentCompany(), maintenant: new Date(2027, 0, 5) });
  assert.ok(absence.paragraphes.join(' ').includes('30 jours'), 'la lettre d\'absence rappelle le délai de réponse');
  assert.ok(absence.paragraphes.join(' ').includes('60 jours'), 'le délai de prévenance est cité');
  assert.strictEqual(absence.paragraphes.join(' ').split('01/03/2027').length - 1, 1, 'la période n\'est citée qu\'une fois dans la lettre d\'absence');
  formationRepository.decider(cpf.id, 'refusee', 'Budget épuisé', rh.id);
  const reponse = genererDocumentFormation({ type: 'reponse', demande: formationRepository.getById(cpf.id), employee: salarie, entreprise: DB.getCurrentCompany(), decideur: 'Mme RH', maintenant: new Date(2027, 0, 5) });
  assert.ok(reponse.paragraphes.join(' ').includes('Budget épuisé'));

  // --- Écran : un salarié ne voit que ses demandes, aucun bouton de décision ---
  DB._currentEmployeeId = salarie.id;
  const htmlSalarie = renderFormation();
  assert.ok(htmlSalarie.includes('Excel'), 'le salarié voit sa demande');
  assert.ok(!htmlSalarie.includes('data-formation-decider'), 'pas de boutons de décision pour le salarié');
  DB._currentEmployeeId = rh.id;
  const nouvelle = formationRepository.creer(salarie.id, ok.demande, salarie.id);
  assert.ok(renderFormation().includes(`data-formation-decider="${nouvelle.id}"`), 'le RH peut décider d\'une demande en attente');

  // --- Suppression ---
  assert.strictEqual(formationRepository.supprimer(nouvelle.id).success, true);
  assert.strictEqual(formationRepository.getById(nouvelle.id), null);

  console.log('OK — formation-demandes-21-10.test.js (saisie, délai CPF, décision, droits, lettres, écran)');
}

try { run(); } catch (err) { console.error('ÉCHEC — formation-demandes-21-10.test.js'); console.error(err.stack || err.message); process.exitCode = 1; }
