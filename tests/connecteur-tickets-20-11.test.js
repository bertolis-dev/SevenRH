/**
 * Retour du 20/11/2026 : connecteur de prestataire de titres-restaurant (Swile) — synchronisation des salariés et envoi de la commande mensuelle.
 * La fonction serveur (supabase/functions/connecteur-tickets/index.ts) est un fichier unique déployé à la main ; son cœur (sans réseau ni base)
 * est extrait ici et exécuté contre une simulation de l'API Swile.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'connecteur-tickets', 'index.ts'), 'utf8');
const debutCoeur = source.indexOf('const SWILE_BASE');
const finCoeur = source.indexOf('// =====', source.indexOf('// FIN DU CŒUR') - 120);
assert.ok(debutCoeur > 0 && finCoeur > debutCoeur, 'cœur de la fonction repéré');
const debutClient = source.indexOf('function clientSwile');
const finClient = source.indexOf('Deno.serve(');
assert.ok(debutClient > 0 && finClient > debutClient, 'client Swile repéré');

const code = source.slice(debutCoeur, finCoeur) + '\n' + source.slice(debutClient, finClient) + `
  return { doitEtreProvisionne, estParti, profilSouhaite, differences, synchroniser, periodeLibelle, echapperCsv, validerLignesCommande, construireCsvCommande, clientSwile, nettoyerEnTete, MAX_CHANGEMENTS_PAR_APPEL };`;
const C = new Function(code)();

const AUJ = '2026-11-20';
const ligne = (id, extra = {}, data = {}) => ({ id, email: `${id}@exemple.fr`, nom: 'DUPONT', prenom: 'Léa', matricule: `SRH-${id}`, manager_ids: [], archive: false, data: { statut: 'Actif', dateEmbauche: '2024-01-01', ...data }, ...extra });

// ---- Qui doit exister chez le prestataire ----
assert.strictEqual(C.doitEtreProvisionne(ligne('a'), AUJ), true);
assert.strictEqual(C.doitEtreProvisionne(ligne('a', { archive: true }), AUJ), false, 'archivé');
assert.strictEqual(C.doitEtreProvisionne(ligne('a', {}, { statut: 'Inactif' }), AUJ), false, 'inactif');
assert.strictEqual(C.doitEtreProvisionne(ligne('a', {}, { dateDepart: '2026-11-20' }), AUJ), false, 'parti ce jour');
assert.strictEqual(C.doitEtreProvisionne(ligne('a', {}, { dateDepart: '2026-12-31' }), AUJ), true, 'départ à venir : encore présent');
assert.strictEqual(C.doitEtreProvisionne(ligne('a', {}, { dateEmbauche: '2026-12-01' }), AUJ), false, 'pas encore arrivé');
assert.strictEqual(C.estParti(ligne('a', {}, { dateEmbauche: '2026-12-01' }), AUJ), false, 'pas encore arrivé n\'est pas « parti »');

// ---- Profil souhaité : nom d'usage, civilité, date de naissance ----
const p = C.profilSouhaite(ligne('b', { email: ' Lea.Dupont@Exemple.FR ' }, { nomUsage: 'MARTIN', sexe: 'Femme', dateNaissance: '1990-05-14' }));
assert.strictEqual(p.email, 'lea.dupont@exemple.fr');
assert.strictEqual(p.lastName, 'MARTIN', 'le nom d\'usage est le nom de la carte');
assert.strictEqual(p.civility, 'missus');
assert.strictEqual(p.birthday, '1990-05-14');
assert.strictEqual(C.profilSouhaite(ligne('c', {}, { civilite: 'Monsieur' })).civility, 'mister');
assert.strictEqual(C.profilSouhaite(ligne('c')).civility, 'unknown');
assert.ok(!('birthday' in C.profilSouhaite(ligne('c', {}, { dateNaissance: '14/05/1990' }))), 'une date mal formée n\'est pas envoyée');

// ---- Différences : on ne corrige que ce qui diffère, on n'efface rien ----
const voulu = C.profilSouhaite(ligne('d'));
assert.deepStrictEqual(JSON.parse(JSON.stringify(C.differences(voulu, { email: 'D@exemple.fr', firstName: 'Léa', lastName: 'DUPONT', civility: 'unknown', employeeNumber: 'SRH-d' }))), {}, 'déjà à jour');
assert.deepStrictEqual(JSON.parse(JSON.stringify(C.differences(voulu, { email: 'autre@exemple.fr', firstName: 'Léa', lastName: 'DURAND', employeeNumber: '' }))), { email: 'd@exemple.fr', lastName: 'DUPONT', employeeNumber: 'SRH-d' });
assert.ok(!('civility' in C.differences(voulu, { civility: 'mister', email: 'd@exemple.fr', firstName: 'Léa', lastName: 'DUPONT', employeeNumber: 'SRH-d' })), 'une civilité inconnue côté Nexus n\'écrase jamais celle du prestataire');

// ---- Simulation de l'API Swile ----
function simulation(existants) {
  const appels = [];
  let n = 100;
  return {
    appels,
    async lister() { return existants; },
    async creer(profil) { appels.push(['creer', profil.email]); if (profil.email.startsWith('doublon')) { const e = new Error('Email déjà utilisé'); e.code = '409'; throw e; } return { id: 'sw-' + (++n) }; },
    async modifier(id, patch) { appels.push(['modifier', id, JSON.stringify(patch)]); return {}; },
    async retirer(id) { appels.push(['retirer', id]); return null; },
    async inscrire(id, produit, invitation) { appels.push(['inscrire', id, produit, invitation]); return {}; }
  };
}
const PRODUIT = 'prod-titres';
const swileExistants = [
  { id: 'sw-1', email: 'b@exemple.fr', firstName: 'Léa', lastName: 'ANCIEN', employeeNumber: 'SRH-b', civility: 'unknown', leftAt: null, enrollments: [] },
  { id: 'sw-2', email: 'c@exemple.fr', firstName: 'Léa', lastName: 'DUPONT', employeeNumber: 'SRH-c', civility: 'unknown', leftAt: null, enrollments: [{ productId: PRODUIT }] },
  { id: 'sw-3', email: 'd@exemple.fr', firstName: 'Léa', lastName: 'DUPONT', employeeNumber: 'SRH-d', civility: 'unknown', leftAt: null, enrollments: [{ productId: PRODUIT }] },
  { id: 'sw-9', email: 'inconnu@autre.fr', firstName: 'X', lastName: 'Y', employeeNumber: 'EXT-1', leftAt: null, enrollments: [] }
];
const rows = [
  ligne('a'), // nouveau : création + inscription avec invitation
  ligne('b'), // existe (matricule), nom à corriger + inscription manquante, sans nouvelle invitation
  ligne('c'), // déjà à jour
  ligne('d', { archive: true }), // archivé : retiré
  ligne('e', { archive: true }), // archivé, jamais chez le prestataire : ignoré
  ligne('f', { email: '' }), // sans email : erreur claire
  ligne('doublon1') // le prestataire refuse (409)
];
(async () => {
  const sim = simulation(swileExistants);
  const r = await C.synchroniser({ swile: sim, rows, liaisons: [], produitId: PRODUIT, aujourdhui: AUJ });
  const appels = sim.appels.map(a => a.join('|'));
  assert.ok(appels.includes('creer|a@exemple.fr'), 'création du nouveau salarié');
  assert.ok(appels.some(a => /^inscrire\|sw-101\|prod-titres\|true$/.test(a)), 'inscription du nouveau avec invitation');
  assert.ok(appels.some(a => a.startsWith('modifier|sw-1|') && a.includes('"lastName":"DUPONT"')), 'nom corrigé');
  assert.ok(appels.includes('inscrire|sw-1|prod-titres|false'), 'inscription d\'un salarié déjà connu : sans nouvelle invitation');
  assert.ok(!appels.some(a => a.includes('sw-2')), 'salarié déjà à jour : aucun appel');
  assert.ok(appels.includes('retirer|sw-3'), 'salarié archivé retiré');
  assert.ok(!appels.some(a => a.includes('sw-9')), 'un salarié du prestataire inconnu de Nexus n\'est jamais touché');
  assert.strictEqual(r.resume.crees, 1);
  assert.strictEqual(r.resume.misAJour, 1);
  assert.strictEqual(r.resume.retires, 1);
  assert.strictEqual(r.resume.dejaAJour, 1);
  assert.strictEqual(r.resume.inscrits, 2);
  assert.strictEqual(r.resume.erreurs.length, 2, 'sans email + refus du prestataire');
  assert.ok(r.resume.erreurs.some(e => /email/i.test(e.message)));
  assert.ok(r.resume.erreurs.some(e => /409/.test(e.message)));
  const statuts = Object.fromEntries(r.liaisonsAEcrire.map(l => [l.employee_id, l.statut]));
  assert.strictEqual(statuts.a, 'synchronise'); assert.strictEqual(statuts.d, 'retire'); assert.strictEqual(statuts.e, 'ignore'); assert.strictEqual(statuts.f, 'erreur'); assert.strictEqual(statuts.doublon1, 'erreur');
  assert.strictEqual(r.restant, 0);

  // Un retrait ne se fait pas deux fois : un salarié déjà parti chez le prestataire n'est pas retiré de nouveau
  const sim2 = simulation([{ ...swileExistants[2], leftAt: '2026-10-01' }]);
  await C.synchroniser({ swile: sim2, rows: [ligne('d', { archive: true })], liaisons: [], produitId: PRODUIT, aujourdhui: AUJ });
  assert.ok(!sim2.appels.some(a => a[0] === 'retirer'), 'déjà retiré : aucun appel');

  // Sans produit choisi : on crée mais on n'inscrit pas
  const sim3 = simulation([]);
  await C.synchroniser({ swile: sim3, rows: [ligne('a')], liaisons: [], produitId: null, aujourdhui: AUJ });
  assert.ok(sim3.appels.some(a => a[0] === 'creer') && !sim3.appels.some(a => a[0] === 'inscrire'), 'pas de produit : pas d\'inscription');

  // Limite par appel : le reste est signalé pour un nouvel appel
  const beaucoup = Array.from({ length: 5 }, (_, i) => ligne('n' + i));
  const sim4 = simulation([]);
  const r4 = await C.synchroniser({ swile: sim4, rows: beaucoup, liaisons: [], produitId: PRODUIT, aujourdhui: AUJ, limite: 3 });
  assert.strictEqual(r4.resume.crees, 3, 'trois créations dans cet appel');
  assert.strictEqual(r4.restant, 2, 'deux restent à faire');

  // Managers : renseignés une fois tout le monde connu chez le prestataire
  const sim5 = simulation([]);
  await C.synchroniser({ swile: sim5, rows: [ligne('chef'), ligne('equipier', { manager_ids: ['chef'] })], liaisons: [], produitId: null, aujourdhui: AUJ });
  assert.ok(sim5.appels.some(a => a[0] === 'modifier' && a[2].includes('managerId')), 'manager renseigné');

  // ---- Commande mensuelle ----
  assert.strictEqual(C.periodeLibelle('2026-11'), 'novembre 2026');
  assert.strictEqual(C.periodeLibelle('2026-13'), null);
  assert.strictEqual(C.periodeLibelle('novembre'), null);
  assert.strictEqual(C.echapperCsv('=1+1'), "'=1+1", 'pas de formule dans un tableur');
  assert.strictEqual(C.echapperCsv('Dupont; Jean'), '"Dupont; Jean"');
  assert.ok(!C.validerLignesCommande([]).ok, 'commande vide refusée');
  assert.ok(!C.validerLignesCommande([{ nombreTitres: -1 }]).ok, 'nombre négatif refusé');
  assert.ok(!C.validerLignesCommande([{ nombreTitres: 1.5 }]).ok, 'nombre non entier refusé');
  assert.ok(!C.validerLignesCommande([{ nombreTitres: 9999 }]).ok, 'nombre absurde refusé');
  const lignes = C.validerLignesCommande([
    { matricule: 'SRH-1', nom: 'DUPONT', prenom: 'Léa', email: 'lea@exemple.fr', nombreTitres: 18, extra: 'ignoré' },
    { matricule: 'SRH-2', nom: '=CMD', prenom: 'Zoé', email: 'zoe@exemple.fr', nombreTitres: 0 },
    { matricule: 'SRH-3', nom: 'MARTIN', prenom: 'Paul', email: 'paul@exemple.fr', nombreTitres: 21 }
  ]);
  assert.ok(lignes.ok);
  assert.ok(!('extra' in lignes.lignes[0]), 'seuls les champs attendus sont gardés');
  const csv = C.construireCsvCommande(lignes.lignes);
  assert.ok(csv.startsWith('﻿Matricule;Nom;Prénom;Email;Nombre de titres\r\n'), 'en-têtes et BOM pour Excel');
  assert.ok(csv.includes('SRH-1;DUPONT;Léa;lea@exemple.fr;18') && csv.includes('SRH-3;MARTIN;Paul;paul@exemple.fr;21'));
  assert.ok(!csv.includes('SRH-2'), 'un salarié à 0 titre n\'est pas dans la commande');
  assert.strictEqual(C.nettoyerEnTete('Ma "Société"\r\nBCC: x'), 'Ma SociétéBCC: x', 'pas d\'injection dans l\'en-tête de l\'email');

  // ---- Client Swile : jeton mis en cache, pagination par curseur ----
  let jetons = 0;
  const pages = { '': { data: [{ id: '1' }, { id: '2' }], nextCursor: 'p2' }, p2: { data: [{ id: '3' }], nextCursor: null } };
  const faux = async (url, opts) => {
    const rep = (corps, ok = true, status = 200) => ({ ok, status, json: async () => corps });
    if (url.endsWith('/v1/oauth/token')) { jetons++; assert.ok(String(opts.body).includes('grant_type=client_credentials')); return rep({ access_token: 'jeton', expires_in: 120 }); }
    assert.strictEqual(opts.headers.Authorization, 'Bearer jeton');
    const m = /cursor=([^&]+)/.exec(url);
    return rep(pages[m ? decodeURIComponent(m[1]) : '']);
  };
  const client = C.clientSwile('id', 'secret', faux);
  const tous = await client.lister();
  assert.strictEqual(tous.length, 3, 'toutes les pages lues');
  assert.strictEqual(jetons, 1, 'un seul jeton pour plusieurs appels');
  const refus = C.clientSwile('id', 'mauvais', async () => ({ ok: false, status: 401, json: async () => ({ title: 'Unauthorized' }) }));
  await assert.rejects(() => refus.produits(), /Unauthorized/, 'clé refusée : message clair');

  // ---- La migration protège le secret ----
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '0078_connecteurs_tickets_restaurant.sql'), 'utf8');
  assert.ok(/alter table connecteurs_tickets_secrets enable row level security/.test(sql), 'table des secrets sous RLS');
  assert.ok(!/create policy [^;]*on connecteurs_tickets_secrets/.test(sql), 'aucune politique sur les secrets : illisibles depuis le navigateur');
  assert.ok(/revoke all on connecteurs_tickets_secrets from public, anon, authenticated/.test(sql), 'droits retirés');
  assert.ok(/insert into schema_migrations \(version\) values \('0078_connecteurs_tickets_restaurant'\)/.test(sql), 'la migration s\'enregistre');

  console.log('OK — connecteur-tickets-20-11.test.js');
})().catch(err => { console.error(err); process.exit(1); });
