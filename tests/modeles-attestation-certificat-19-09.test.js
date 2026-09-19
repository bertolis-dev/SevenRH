/**
 * Seven RH — retour Betty du 19/09/2026 (point 2, "l'attestation employeur et le certificat de
 * travail... livrés comme modèles de base dans cet écran, modifiables, avec un bouton pour revenir
 * au texte d'origine") : leur texte était jusqu'ici écrit en dur dans openAttestationEmployeurModal/
 * openCertificatTravailModal (app.js), impossible à relire/adapter. Ils sont désormais 2 vrais
 * modèles (documentTemplateRepository, cle 'attestation_employeur'/'certificat_travail'), livrés par
 * défaut aux nouvelles entreprises (seedCompany) et rattrapés pour les entreprises déjà existantes
 * (ensureDocumentTemplatesAttestationCertificatBackfilled, même patron que
 * ensureDefaultLeaveTypesBackfilled : drapeau append-only, jamais de résurrection après suppression
 * volontaire).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function runSeedLivreDeuxModelesAvecCleEtCorpsOrigine() {
  const { seedDocumentTemplatesDefaut } = loadAppJs();
  const modeles = seedDocumentTemplatesDefaut();
  assert.strictEqual(modeles.length, 2);
  const attestation = modeles.find(m => m.cle === 'attestation_employeur');
  const certificat = modeles.find(m => m.cle === 'certificat_travail');
  assert.ok(attestation && certificat, 'les deux clés stables doivent être présentes');
  assert.strictEqual(attestation.corps, attestation.corpsOrigine, 'corpsOrigine doit être identique à corps au moment du seed');
  assert.ok(attestation.corps.includes('{{raisonSociale}}') && attestation.corps.includes('{{posteAccorde}}'));
  assert.ok(certificat.corps.includes('{{dateDepart}}') && certificat.corps.includes('{{service}}'));

  console.log('OK — modeles-attestation-certificat-19-09.test.js (seed : 2 modèles avec cle stable et corpsOrigine = corps)');
}

async function runNouvelleEntrepriseDemoLesADejaViaDBInit() {
  const { DB, sandbox, documentTemplateRepository } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const cles = documentTemplateRepository.getAll().map(t => t.cle);
  assert.ok(cles.includes('attestation_employeur') && cles.includes('certificat_travail'), 'seedCompany doit inclure les 2 modèles système, comme les autres données de démo');

  console.log('OK — modeles-attestation-certificat-19-09.test.js (nouvelle entreprise : les 2 modèles déjà présents via seedCompany)');
}

async function runEntrepriseExistanteEstRattrapeeParLaMigration() {
  const { DB, sandbox, ensureDocumentTemplatesAttestationCertificatBackfilled } = loadAppJs();
  sandbox.window.SupabaseSync = { pushCompanyProfile: async () => {} };
  const rh = { id: 'rh1', role: 'rh' };
  const company = { id: 'c1', documentTemplates: [] }; // entreprise créée avant ce changement : aucun modèle système

  await ensureDocumentTemplatesAttestationCertificatBackfilled(company, rh);

  const cles = company.documentTemplates.map(t => t.cle);
  assert.ok(cles.includes('attestation_employeur') && cles.includes('certificat_travail'));
  assert.ok((company.defaultDocumentTemplatesSeeded || []).includes('attestation_employeur'), 'le drapeau append-only doit être posé, pour ne jamais ressusciter un modèle supprimé ensuite');

  console.log('OK — modeles-attestation-certificat-19-09.test.js (entreprise déjà existante : rattrapée par la migration, comme les types de congés par défaut)');
}

async function runSuppressionVolontaireNestJamaisResuscitee() {
  const { DB, sandbox, ensureDocumentTemplatesAttestationCertificatBackfilled } = loadAppJs();
  sandbox.window.SupabaseSync = { pushCompanyProfile: async () => {} };
  const rh = { id: 'rh1', role: 'rh' };
  // Le client a explicitement supprimé "certificat_travail" (documentTemplates ne le contient plus)
  // ET le drapeau append-only le mentionne déjà (posé lors d'un rattrapage précédent) — ne doit
  // jamais être recréé, contrairement à "attestation_employeur", jamais encore vu.
  const company = { id: 'c1', documentTemplates: [], defaultDocumentTemplatesSeeded: ['certificat_travail'] };

  await ensureDocumentTemplatesAttestationCertificatBackfilled(company, rh);

  const cles = company.documentTemplates.map(t => t.cle);
  assert.ok(!cles.includes('certificat_travail'), 'un modèle système explicitement supprimé ne doit jamais être ressuscité');
  assert.ok(cles.includes('attestation_employeur'), 'un modèle système jamais encore vu doit quand même être livré');

  console.log('OK — modeles-attestation-certificat-19-09.test.js (suppression volontaire jamais ressuscitée, jamais deux fois pour un client réel)');
}

async function runAucunReportSansLaPermission() {
  const { ensureDocumentTemplatesAttestationCertificatBackfilled } = loadAppJs();
  const managerSansDroit = { id: 'm1', role: 'manager' };
  const company = { id: 'c1', documentTemplates: [] };

  await ensureDocumentTemplatesAttestationCertificatBackfilled(company, managerSansDroit);

  assert.strictEqual(company.documentTemplates.length, 0, 'sans gererParametres, aucun modèle ne doit être ajouté');

  console.log('OK — modeles-attestation-certificat-19-09.test.js (migration réservée à gererParametres, comme les autres migrations de ce type)');
}

async function runOpenAttestationEmployeurModalUtiliseLeModeleModifiable() {
  const { DB, sandbox, employeeRepository, documentTemplateRepository, openAttestationEmployeurModal } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');

  // Modifie le modèle système (ajoute une mention personnalisée) : le document généré doit refléter
  // ce changement, preuve que le texte n'est plus écrit en dur dans openAttestationEmployeurModal.
  const template = documentTemplateRepository.getAll().find(t => t.cle === 'attestation_employeur');
  documentTemplateRepository.update(template.id, { corps: template.corps + '\n\nMention ajoutée par l\'entreprise.' });

  openAttestationEmployeurModal(salarie.id);
  const html = sandbox.document.getElementById('modal-root').innerHTML;
  assert.ok(html.includes('Mention ajoutée par l&#39;entreprise.'),
    'la modification du modèle doit apparaître dans le document généré : preuve que le texte vient bien du modèle, plus du code en dur');
  assert.ok(html.includes('print-signature'), 'l\'en-tête/le bloc signature générés par code doivent rester présents autour du corps modifiable');

  console.log('OK — modeles-attestation-certificat-19-09.test.js (attestation employeur : le document généré reflète une modification du modèle)');
}

async function runOpenCertificatTravailModalUtiliseLeModeleModifiable() {
  const { DB, sandbox, employeeRepository, documentTemplateRepository, openCertificatTravailModal } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();
  const rh = DB.getEmployees().find(e => e.role === 'rh');
  DB._currentEmployeeId = rh.id;
  const salarie = employeeRepository.getAll().find(e => e.role === 'salarie');
  employeeRepository.update(salarie.id, { dateDepart: '2026-06-30', dateEmbauche: '2020-01-01' });

  const template = documentTemplateRepository.getAll().find(t => t.cle === 'certificat_travail');
  documentTemplateRepository.update(template.id, { corps: template.corps.replace('Le salarié est libre', 'Le salarié Seven RH est libre') });

  openCertificatTravailModal(salarie.id);
  const html = sandbox.document.getElementById('modal-root').innerHTML;
  assert.ok(html.includes('Le salarié Seven RH est libre'), 'la modification du modèle doit apparaître dans le certificat généré');
  assert.ok(html.includes('30/06/2026'), 'la date de départ doit rester correctement formatée (JJ/MM/AAAA), pas la valeur ISO brute');

  console.log('OK — modeles-attestation-certificat-19-09.test.js (certificat de travail : le document généré reflète une modification du modèle, dates toujours formatées)');
}

async function runBoutonRevenirAuTexteOrigineVisibleSeulementPourLesModelesSysteme() {
  const { DB, sandbox, documentTemplateRepository, openModeleDocumentModal } = loadAppJs();
  sandbox.window.SupabaseSync = new Proxy({}, { get: () => async () => ({ success: true }) });
  DB.init();

  const modeleSysteme = documentTemplateRepository.getAll().find(t => t.cle === 'attestation_employeur');
  openModeleDocumentModal(modeleSysteme);
  const htmlSysteme = sandbox.document.getElementById('modal-root').innerHTML;
  assert.ok(htmlSysteme.includes('btn-revenir-texte-origine'), 'un modèle système doit proposer "Revenir au texte d\'origine"');

  const modeleClient = documentTemplateRepository.create({ nom: 'Mon modèle perso', corps: 'Bonjour {{prenom}}.' });
  openModeleDocumentModal(modeleClient);
  const htmlClient = sandbox.document.getElementById('modal-root').innerHTML;
  assert.ok(!htmlClient.includes('btn-revenir-texte-origine'), 'un modèle créé normalement par le client n\'a pas de "texte d\'origine" auquel revenir');

  openModeleDocumentModal(null);
  const htmlNouveau = sandbox.document.getElementById('modal-root').innerHTML;
  assert.ok(!htmlNouveau.includes('btn-revenir-texte-origine'), 'un nouveau modèle en cours de création n\'a évidemment pas de bouton "revenir"');

  console.log('OK — modeles-attestation-certificat-19-09.test.js ("Revenir au texte d\'origine" : uniquement sur les 2 modèles système, jamais sur un modèle client)');
}

runSeedLivreDeuxModelesAvecCleEtCorpsOrigine()
  .then(runNouvelleEntrepriseDemoLesADejaViaDBInit)
  .then(runEntrepriseExistanteEstRattrapeeParLaMigration)
  .then(runSuppressionVolontaireNestJamaisResuscitee)
  .then(runAucunReportSansLaPermission)
  .then(runOpenAttestationEmployeurModalUtiliseLeModeleModifiable)
  .then(runOpenCertificatTravailModalUtiliseLeModeleModifiable)
  .then(runBoutonRevenirAuTexteOrigineVisibleSeulementPourLesModelesSysteme)
  .catch((err) => {
    console.error('ÉCHEC — modeles-attestation-certificat-19-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
