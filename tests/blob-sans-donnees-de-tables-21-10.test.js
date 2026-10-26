/**
 * Seven RH — constaté le 21/10/2026 en préparant le module Formation : à chaque enregistrement du bloc entreprise par un
 * administrateur, le site y recopiait aussi les entretiens (auto-évaluations, retours managers), les tickets support, les idées et les
 * licences de modules, qui ont pourtant leurs propres tables protégées. Le bloc (companies.data) est lisible par tout salarié via
 * l'API : ces contenus confidentiels y étaient donc exposés. Ils n'y sont plus envoyés, et le serveur les en retire (0075).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAppJs } = require('./load-app-js');

const CLES_EXCLUES = ['supportTickets', 'entretiens', 'idees', 'moduleLicenses', 'formations'];

function run() {
  const api = loadAppJs();
  const envois = [];
  api.sandbox.window.SupabaseSync = new Proxy({}, {
    get: (_, nom) => nom === 'pushCompanyProfile' ? (id, raison, data) => { envois.push(data); return Promise.resolve(); } : async () => ({ success: true })
  });
  api.DB.init();
  const rh = api.DB.getEmployees().find(e => e.role === 'rh');
  const salarie = api.DB.getEmployees().find(e => e.role === 'salarie');
  api.DB._currentEmployeeId = rh.id;
  const entretien = api.entretienRepository.create({ employeeId: salarie.id, type: 'professionnel', datePrevue: '2026-12-01' });
  api.entretienRepository.submitAutoEvaluation(entretien.id, 'Texte confidentiel de l\'auto-évaluation');
  const company = api.DB.getCurrentCompany();
  company.idees = [{ id: 'i1', titre: 'Idée', description: 'x' }];
  company.moduleLicenses = { conges: [salarie.id] };
  company.formations = [{ id: 'f1', employeeId: salarie.id, intitule: 'Excel' }];
  api.DB.saveCurrentCompany(company);

  api.DB.saveShifts(api.DB.getShifts());
  assert.ok(envois.length >= 1);
  const blob = envois[envois.length - 1];
  CLES_EXCLUES.forEach(cle => assert.ok(!(cle in blob), `« ${cle} » n'est plus envoyé dans le bloc entreprise`));
  assert.ok(!JSON.stringify(blob).includes('Texte confidentiel'), 'aucun contenu d\'entretien dans le bloc');
  assert.ok('shifts' in blob && 'documentTemplates' in blob, 'le reste du bloc part normalement');

  // même règle pour la reprise après échec et pour les autres chemins d'écriture du bloc
  const source = fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8');
  const sites = source.split(String.fromCharCode(10)).filter(l => /delegationsRecues(: [A-Za-z_]+)?, .*\.\.\.companyData/.test(l));
  assert.ok(sites.length >= 6, 'tous les chemins d\'écriture du bloc sont couverts');
  sites.forEach(l => CLES_EXCLUES.forEach(cle => assert.ok(l.includes(cle), `chemin d'écriture du bloc sans exclusion de ${cle} : ${l.trim()}`)));

  // la migration retire aussi ces clés côté serveur
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '0075_formations_et_blob_propre.sql'), 'utf8');
  CLES_EXCLUES.forEach(cle => assert.ok(sql.includes(`'${cle}'`), `0075 retire ${cle} du bloc`));
  console.log('OK — blob-sans-donnees-de-tables-21-10.test.js (entretiens, tickets, idées, licences et formations ne sont plus recopiés dans le bloc entreprise)');
}

try { run(); } catch (err) { console.error('ÉCHEC — blob-sans-donnees-de-tables-21-10.test.js'); console.error(err.stack || err.message); process.exitCode = 1; }
