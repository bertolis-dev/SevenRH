// @ts-nocheck
// Seven RH — fonction « connecteur-tickets » : connecteurs de prestataires de titres-restaurant (retour du 20/11/2026).
// Premier prestataire : Swile (https://integrations.swile.co/docs/fr/).
//
// Trois actions, toutes appelées depuis Paramètres > Tickets restaurant et l'écran Tickets restaurant :
//   - tester         : vérifie la clé d'API enregistrée et renvoie les produits Swile (pour choisir le produit « titres-restaurant »).
//   - synchroniser   : crée / met à jour / inscrit / retire les salariés chez Swile d'après la fiche Nexus.
//   - envoyer-commande : envoie par email la commande mensuelle (nombre de titres par salarié, en pièce jointe CSV) au contact de commande
//                        enregistré dans Paramètres. L'API Swile ne reçoit pas de commande : l'envoi se fait par email.
//
// Sécurité :
//   - La clé secrète du prestataire vit dans connecteurs_tickets_secrets, lisible UNIQUEMENT avec la clé service-role utilisée ici.
//   - L'appelant est identifié par SON jeton : entreprise et droits sont lus avec ce jeton (current_company_id, has_permission), jamais
//     d'après le contenu de la requête. Le destinataire de la commande est lu en base, jamais fourni par l'appelant.
//   - Les salariés à synchroniser sont relus en base : l'appelant n'en fournit aucun.
//
// Secrets Supabase requis : RESEND_API_KEY (déjà utilisé par notify-request-email). SUPABASE_URL, SUPABASE_ANON_KEY et
// SUPABASE_SERVICE_ROLE_KEY sont fournis automatiquement.
//
// Déploiement : Supabase > Edge Functions > Create a new function « connecteur-tickets » > coller ce fichier > Deploy.
// La migration 0078_connecteurs_tickets_restaurant.sql doit avoir été exécutée avant.

import { createClient } from "npm:@supabase/supabase-js@2";

// =================================================================================================
// CŒUR (sans accès réseau direct ni base : testé par tests/connecteur-tickets-20-11.test.js)
// =================================================================================================

const SWILE_BASE = "https://integrations.swile.co";
const MAX_CHANGEMENTS_PAR_APPEL = 120; // reste sous la limite de durée d'une fonction ; l'appelant relance tant que « restant » > 0

function normaliserEmail(e) {
  return String(e || "").trim().toLowerCase();
}

/** Un salarié doit-il exister chez le prestataire à cette date ? */
function doitEtreProvisionne(row, aujourdhui) {
  const d = row.data || {};
  if (row.archive) return false;
  if (d.statut && d.statut !== "Actif") return false;
  if (d.dateDepart && String(d.dateDepart) <= aujourdhui) return false;
  if (d.dateEmbauche && String(d.dateEmbauche) > aujourdhui) return false; // pas encore arrivé
  return true;
}

/** Parti, archivé ou inactif (≠ « pas encore arrivé », qu'on laisse tranquille chez le prestataire). */
function estParti(row, aujourdhui) {
  const d = row.data || {};
  return Boolean(row.archive) || Boolean(d.statut && d.statut !== "Actif") || Boolean(d.dateDepart && String(d.dateDepart) <= aujourdhui);
}

function civiliteSwile(row) {
  const d = row.data || {};
  if (d.sexe === "Homme") return "mister";
  if (d.sexe === "Femme") return "missus";
  if (d.civilite === "Monsieur") return "mister";
  if (d.civilite === "Madame") return "missus";
  return "unknown";
}

/** Ce que Nexus veut voir chez le prestataire pour ce salarié (nom d'usage si le salarié en a un : c'est le nom de sa carte). */
function profilSouhaite(row) {
  const d = row.data || {};
  const nomUsage = String(d.nomUsage || "").trim();
  const profil = {
    email: normaliserEmail(row.email),
    firstName: String(row.prenom || "").trim(),
    lastName: nomUsage || String(row.nom || "").trim(),
    civility: civiliteSwile(row),
    employeeNumber: String(row.matricule || "").trim(),
  };
  if (d.dateNaissance && /^\d{4}-\d{2}-\d{2}$/.test(String(d.dateNaissance))) profil.birthday = String(d.dateNaissance);
  return profil;
}

/** Champs à corriger chez le prestataire (vide = déjà à jour). Les champs que Nexus ne renseigne pas ne sont jamais effacés. */
function differences(souhaite, existant) {
  const patch = {};
  if (souhaite.email && normaliserEmail(existant.email) !== souhaite.email) patch.email = souhaite.email;
  if (souhaite.firstName && (existant.firstName || "") !== souhaite.firstName) patch.firstName = souhaite.firstName;
  if (souhaite.lastName && (existant.lastName || "") !== souhaite.lastName) patch.lastName = souhaite.lastName;
  if (souhaite.civility && souhaite.civility !== "unknown" && existant.civility !== souhaite.civility) patch.civility = souhaite.civility;
  if (souhaite.birthday && (existant.birthday || "") !== souhaite.birthday) patch.birthday = souhaite.birthday;
  if (souhaite.employeeNumber && (existant.employeeNumber || "") !== souhaite.employeeNumber) patch.employeeNumber = souhaite.employeeNumber;
  return patch;
}

/** Retrouve le salarié du prestataire qui correspond à un salarié Nexus : correspondance enregistrée, puis matricule, puis email. */
function retrouverChezPrestataire(row, souhaite, liaison, parId, parMatricule, parEmail) {
  if (liaison && liaison.externe_id && parId.has(liaison.externe_id)) return parId.get(liaison.externe_id);
  if (souhaite.employeeNumber && parMatricule.has(souhaite.employeeNumber)) return parMatricule.get(souhaite.employeeNumber);
  if (souhaite.email && parEmail.has(souhaite.email)) return parEmail.get(souhaite.email);
  return null;
}

function indexer(existants) {
  const parId = new Map();
  const parMatricule = new Map();
  const parEmail = new Map();
  for (const e of existants) {
    parId.set(e.id, e);
    if (e.employeeNumber) parMatricule.set(String(e.employeeNumber), e);
    if (e.email) parEmail.set(normaliserEmail(e.email), e);
  }
  return { parId, parMatricule, parEmail };
}

function messageErreur(err) {
  if (!err) return "Erreur inconnue";
  const base = err.detail || err.title || err.message || String(err);
  return (err.code ? `${err.code} : ` : "") + String(base).slice(0, 300);
}

/**
 * Orchestre la synchronisation. `swile` expose : lister(), creer(profil), modifier(id, patch), retirer(id), inscrire(id, produitId, avecInvitation).
 * `rows` : lignes de la table employees (id, email, nom, prenom, matricule, manager_ids, archive, data).
 * `liaisons` : lignes de connecteurs_tickets_salaries. Retourne { resume, liaisonsAEcrire, restant }.
 */
async function synchroniser({ swile, rows, liaisons, produitId, aujourdhui, limite = MAX_CHANGEMENTS_PAR_APPEL }) {
  const existants = await swile.lister();
  const { parId, parMatricule, parEmail } = indexer(existants);
  const liaisonParEmploye = new Map((liaisons || []).map((l) => [l.employee_id, l]));
  const resume = { crees: 0, misAJour: 0, inscrits: 0, retires: 0, dejaAJour: 0, ignores: 0, erreurs: [] };
  const liaisonsAEcrire = [];
  const idSwileParEmploye = new Map(); // pour renseigner les managers une fois tout le monde connu
  let changements = 0;
  let restant = 0;

  const noter = (row, statut, externeId, erreur) => liaisonsAEcrire.push({ employee_id: row.id, externe_id: externeId || null, statut, erreur: erreur || null });
  const coupe = () => changements >= limite;

  for (const row of rows) {
    const souhaite = profilSouhaite(row);
    const veut = doitEtreProvisionne(row, aujourdhui);
    const existant = retrouverChezPrestataire(row, souhaite, liaisonParEmploye.get(row.id), parId, parMatricule, parEmail);
    if (existant) idSwileParEmploye.set(row.id, existant.id);

    if (!veut) {
      // Parti, archivé ou pas encore arrivé : on ne retire que ce qui est chez le prestataire et encore actif.
      if (existant && !existant.leftAt && estParti(row, aujourdhui)) {
        if (coupe()) { restant++; continue; }
        changements++;
        try {
          await swile.retirer(existant.id);
          resume.retires++;
          noter(row, "retire", existant.id);
        } catch (err) {
          resume.erreurs.push({ salarie: row.id, action: "retirer", message: messageErreur(err) });
          noter(row, "erreur", existant.id, messageErreur(err));
        }
      } else {
        resume.ignores++;
        noter(row, "ignore", existant ? existant.id : null);
      }
      continue;
    }

    if (!souhaite.email) {
      resume.ignores++;
      resume.erreurs.push({ salarie: row.id, action: "ignorer", message: "Pas d'adresse email dans la fiche : impossible de créer le compte chez le prestataire." });
      noter(row, "erreur", null, "Pas d'adresse email dans la fiche");
      continue;
    }

    try {
      if (!existant) {
        if (coupe()) { restant++; continue; }
        changements++;
        const cree = await swile.creer(souhaite);
        resume.crees++;
        idSwileParEmploye.set(row.id, cree.id);
        if (produitId) { await swile.inscrire(cree.id, produitId, true); resume.inscrits++; }
        noter(row, "synchronise", cree.id);
        continue;
      }
      const patch = differences(souhaite, existant);
      let touche = false;
      if (Object.keys(patch).length) {
        if (coupe()) { restant++; continue; }
        changements++;
        await swile.modifier(existant.id, patch);
        resume.misAJour++;
        touche = true;
      }
      const dejaInscrit = (existant.enrollments || []).some((e) => e.productId === produitId);
      if (produitId && !dejaInscrit && !existant.leftAt) {
        if (coupe()) { restant++; continue; }
        changements++;
        await swile.inscrire(existant.id, produitId, false); // déjà connu du prestataire : inscription sans nouvelle invitation
        resume.inscrits++;
        touche = true;
      }
      if (!touche) resume.dejaAJour++;
      noter(row, "synchronise", existant.id);
    } catch (err) {
      resume.erreurs.push({ salarie: row.id, action: "synchroniser", message: messageErreur(err) });
      noter(row, "erreur", existant ? existant.id : null, messageErreur(err));
    }
  }

  // Managers : une fois tous les salariés connus chez le prestataire.
  for (const row of rows) {
    const mgrNexus = (row.manager_ids || [])[0];
    const moi = idSwileParEmploye.get(row.id);
    const mgr = mgrNexus ? idSwileParEmploye.get(mgrNexus) : null;
    if (!moi || !mgr || moi === mgr) continue;
    const existant = parId.get(moi);
    if (existant && existant.managerId === mgr) continue;
    if (coupe()) { restant++; continue; }
    try {
      changements++;
      await swile.modifier(moi, { managerId: mgr });
    } catch (err) {
      resume.erreurs.push({ salarie: row.id, action: "manager", message: messageErreur(err) });
    }
  }

  return { resume, liaisonsAEcrire, restant };
}

// ---- Commande mensuelle -------------------------------------------------------------------------

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

function periodeLibelle(periode) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(periode || ""));
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  return `${MOIS[Number(m[2]) - 1]} ${m[1]}`;
}

function echapperCsv(v) {
  let t = String(v == null ? "" : v);
  // Une cellule qui commence par = + - @ serait interprétée comme une formule à l'ouverture dans un tableur.
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
  return /[";\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
}

/** Contrôle les lignes envoyées par le navigateur : seule la liste (matricule, nom, prénom, email, nombre de titres) est acceptée. */
function validerLignesCommande(lignes) {
  if (!Array.isArray(lignes) || lignes.length === 0) return { ok: false, error: "La commande est vide." };
  if (lignes.length > 5000) return { ok: false, error: "Trop de lignes pour une commande (5 000 au plus)." };
  const propres = [];
  for (const l of lignes) {
    const n = Number(l && l.nombreTitres);
    if (!Number.isInteger(n) || n < 0 || n > 400) return { ok: false, error: "Nombre de titres invalide pour un salarié." };
    propres.push({
      matricule: String(l.matricule || "").slice(0, 60),
      nom: String(l.nom || "").slice(0, 120),
      prenom: String(l.prenom || "").slice(0, 120),
      email: String(l.email || "").slice(0, 200),
      nombreTitres: n,
    });
  }
  return { ok: true, lignes: propres };
}

function construireCsvCommande(lignes) {
  const entetes = ["Matricule", "Nom", "Prénom", "Email", "Nombre de titres"];
  const corps = lignes.filter((l) => l.nombreTitres > 0).map((l) => [l.matricule, l.nom, l.prenom, l.email, l.nombreTitres].map(echapperCsv).join(";"));
  return "﻿" + [entetes.join(";"), ...corps].join("\r\n") + "\r\n";
}

function echapperHtml(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function nettoyerEnTete(v) {
  return String(v || "").replace(/["\r\n<>]/g, "").trim();
}

// =================================================================================================
// FIN DU CŒUR
// =================================================================================================

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reponse(corps, statut = 200) {
  return new Response(JSON.stringify(corps), { status: statut, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

/** Client de l'API Swile (jeton OAuth 2.0 « client credentials », valable 2 minutes, renouvelé au besoin). */
function clientSwile(clientId, clientSecret, fetchImpl = fetch) {
  let jeton = null;
  let expire = 0;

  async function authentifier() {
    if (jeton && Date.now() < expire - 15000) return jeton;
    const r = await fetchImpl(`${SWILE_BASE}/v1/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) {
      const e = new Error(j.detail || j.title || "Clé d'API refusée par Swile");
      e.code = "AUTH_" + r.status;
      throw e;
    }
    jeton = j.access_token;
    expire = Date.now() + (Number(j.expires_in) || 120) * 1000;
    return jeton;
  }

  async function appeler(methode, chemin, corps) {
    const r = await fetchImpl(`${SWILE_BASE}${chemin}`, {
      method: methode,
      headers: { Authorization: `Bearer ${await authentifier()}`, "Content-Type": "application/json" },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    });
    if (r.status === 204) return null;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(j.detail || j.title || `Swile a répondu ${r.status}`);
      e.code = j.code || j.type || String(r.status);
      e.status = r.status;
      throw e;
    }
    return j;
  }

  return {
    async produits() { return (await appeler("GET", "/v1/products")).data || []; },
    async lister() {
      const tous = [];
      let curseur = null;
      for (let i = 0; i < 200; i++) {
        const page = await appeler("GET", `/v1/employees?limit=100${curseur ? `&cursor=${encodeURIComponent(curseur)}` : ""}`);
        tous.push(...(page.data || []));
        curseur = page.nextCursor;
        if (!curseur) break;
      }
      return tous;
    },
    async creer(profil) {
      const { email, firstName, lastName, civility, birthday, employeeNumber } = profil;
      return appeler("POST", "/v1/employees", { email, firstName, lastName, civility, ...(birthday ? { birthday } : {}), ...(employeeNumber ? { employeeNumber } : {}) });
    },
    async modifier(id, patch) { return appeler("PATCH", `/v1/employees/${id}`, patch); },
    async retirer(id) { return appeler("DELETE", `/v1/employees/${id}`); },
    async inscrire(id, produitId, avecInvitation) {
      return appeler("POST", `/v1/employees/${id}/enrollments`, { productId: produitId, ...(avecInvitation ? { invitation: { language: "fr-FR" } } : {}) });
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return reponse({ error: "Méthode non autorisée" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const ANON = Deno.env.get("SUPABASE_ANON_KEY");
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const RESEND = Deno.env.get("RESEND_API_KEY");

  let corps;
  try { corps = await req.json(); } catch { return reponse({ error: "Requête invalide" }, 400); }
  const action = corps && corps.action;
  const fournisseur = (corps && corps.fournisseur) || "swile";
  if (fournisseur !== "swile") return reponse({ error: "Prestataire inconnu" }, 400);

  // Identité et droits de l'appelant, lus avec SON jeton.
  const authHeader = req.headers.get("Authorization") || "";
  const user = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
  const admin = createClient(SUPABASE_URL, SERVICE);
  const { data: companyId } = await user.rpc("current_company_id");
  const { data: moiId } = await user.rpc("current_employee_id");
  if (!companyId || !moiId) return reponse({ error: "Non authentifié" }, 401);
  const droit = async (cle) => (await user.rpc("has_permission", { permission_key: cle })).data === true;
  const peutParametrer = await droit("gererParametres");
  const peutCommander = await droit("calculerTicketsRestaurant");

  const { data: config } = await admin.from("connecteurs_tickets").select("*").eq("company_id", companyId).eq("fournisseur", fournisseur).maybeSingle();

  async function swile() {
    if (!config || !config.client_id) throw Object.assign(new Error("Renseignez l'identifiant client Swile dans Paramètres > Tickets restaurant."), { code: "NON_CONFIGURE" });
    const { data: secret } = await admin.from("connecteurs_tickets_secrets").select("client_secret").eq("company_id", companyId).eq("fournisseur", fournisseur).maybeSingle();
    if (!secret) throw Object.assign(new Error("Aucune clé secrète Swile enregistrée."), { code: "NON_CONFIGURE" });
    return clientSwile(config.client_id, secret.client_secret);
  }

  try {
    // ---------------------------------------------------------------------------------------------
    if (action === "tester") {
      if (!peutParametrer) return reponse({ error: "Permission refusée" }, 403);
      const produits = await (await swile()).produits();
      return reponse({ ok: true, produits: produits.filter((p) => p.active) });
    }

    // ---------------------------------------------------------------------------------------------
    if (action === "synchroniser") {
      if (!peutParametrer && !peutCommander) return reponse({ error: "Permission refusée" }, 403);
      if (!config || !config.actif) return reponse({ error: "Le connecteur n'est pas activé." }, 409);
      const client = await swile();
      const { data: rows } = await admin.from("employees").select("id, email, nom, prenom, matricule, manager_ids, archive, data").eq("company_id", companyId);
      const { data: liaisons } = await admin.from("connecteurs_tickets_salaries").select("*").eq("company_id", companyId).eq("fournisseur", fournisseur);
      const aujourdhui = new Date().toISOString().slice(0, 10);
      const { resume, liaisonsAEcrire, restant } = await synchroniser({ swile: client, rows: rows || [], liaisons: liaisons || [], produitId: config.produit_id || null, aujourdhui });
      if (liaisonsAEcrire.length) {
        await admin.from("connecteurs_tickets_salaries").upsert(
          liaisonsAEcrire.map((l) => ({ company_id: companyId, fournisseur, ...l, synchro_le: new Date().toISOString() })),
          { onConflict: "company_id,fournisseur,employee_id" },
        );
      }
      const bilan = { ...resume, erreurs: resume.erreurs.slice(0, 20), nombreErreurs: resume.erreurs.length, restant, date: new Date().toISOString() };
      await admin.from("connecteurs_tickets").update({ dernier_sync_at: bilan.date, dernier_sync_resume: bilan }).eq("company_id", companyId).eq("fournisseur", fournisseur);
      return reponse({ ok: true, ...bilan });
    }

    // ---------------------------------------------------------------------------------------------
    if (action === "envoyer-commande") {
      if (!peutCommander) return reponse({ error: "Permission refusée" }, 403);
      const libelle = periodeLibelle(corps.periode);
      if (!libelle) return reponse({ error: "Période invalide." }, 400);
      if (!config || !config.commande_email) return reponse({ error: "Renseignez l'adresse de commande dans Paramètres > Tickets restaurant." }, 409);
      if (!RESEND) return reponse({ error: "Envoi d'email non configuré (RESEND_API_KEY)." }, 500);
      const controle = validerLignesCommande(corps.lignes);
      if (!controle.ok) return reponse({ error: controle.error }, 400);

      const { data: societe } = await admin.from("companies").select("raison_sociale").eq("id", companyId).maybeSingle();
      const { data: moi } = await admin.from("employees").select("prenom, nom, email").eq("id", moiId).maybeSingle();
      const nombreSalaries = controle.lignes.filter((l) => l.nombreTitres > 0).length;
      const nombreTitres = controle.lignes.reduce((s, l) => s + l.nombreTitres, 0);
      const csv = construireCsvCommande(controle.lignes);
      const nomSociete = nettoyerEnTete(societe && societe.raison_sociale) || "Nexus RH";
      const expediteur = moi ? `${nettoyerEnTete(moi.prenom)} ${nettoyerEnTete(moi.nom)}`.trim() : "";
      const base64 = btoa(String.fromCharCode(...new TextEncoder().encode(csv)));
      const nomFichier = `commande-titres-restaurant-${corps.periode}.csv`;
      const html = `
        <p>Bonjour,</p>
        <p>Veuillez trouver ci-joint la commande de titres-restaurant de <strong>${echapperHtml(nomSociete)}</strong> pour <strong>${echapperHtml(libelle)}</strong> :
        <strong>${nombreTitres}</strong> titre${nombreTitres > 1 ? "s" : ""} pour <strong>${nombreSalaries}</strong> salarié${nombreSalaries > 1 ? "s" : ""}.</p>
        <p>Fichier : ${echapperHtml(nomFichier)} (CSV, séparateur point-virgule).</p>
        <p>Cordialement,<br>${echapperHtml(expediteur || nomSociete)}</p>`;
      const destinataires = [config.commande_email];
      const copie = config.commande_copie_email ? [config.commande_copie_email] : [];
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: `"${nomSociete}" <notifications@nexus-rh.com>`,
          to: destinataires,
          ...(copie.length ? { cc: copie } : {}),
          ...(moi && moi.email ? { reply_to: moi.email } : {}),
          subject: `Commande de titres-restaurant ${libelle} · ${nomSociete}`,
          html,
          attachments: [{ filename: nomFichier, content: base64 }],
        }),
      });
      const statut = r.ok ? "envoyee" : "erreur";
      const erreur = r.ok ? null : `Envoi refusé (${r.status})`;
      await admin.from("commandes_tickets").insert({
        company_id: companyId, fournisseur, periode: corps.periode, envoyee_par: moiId, destinataire: config.commande_email,
        nombre_salaries: nombreSalaries, nombre_titres: nombreTitres, statut, erreur,
      });
      if (!r.ok) return reponse({ error: "L'email de commande n'a pas pu être envoyé. Réessayez, ou téléchargez le fichier de commande." }, 502);
      return reponse({ ok: true, destinataire: config.commande_email, nombreSalaries, nombreTitres });
    }

    return reponse({ error: "Action inconnue" }, 400);
  } catch (err) {
    const code = err && err.code;
    const statut = code === "NON_CONFIGURE" ? 409 : (code && String(code).startsWith("AUTH_")) ? 502 : 500;
    return reponse({ error: messageErreur(err), code }, statut);
  }
});
