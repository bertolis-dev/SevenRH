// Seven RH — fonction "calendar-feed" : flux d'abonnement iCal en lecture seule (audit du
// 23/08/2026, §7.19). "Les absences validées n'apparaissent nulle part dans Outlook ou Google
// Agenda. Un flux d'abonnement en lecture seule, par salarié et par équipe."
//
// IMPORTANT côté configuration Supabase : cette fonction doit être créée avec la vérification JWT
// DÉSACTIVÉE ("Enforce JWT verification" décoché) — comme candidature-submit/stripe-webhook.
// Raison spécifique ici : Outlook et Google Agenda s'abonnent par une simple requête GET
// PÉRIODIQUE, sans en-tête d'authentification d'aucune sorte. Le jeton dans l'URL (voir
// ical_tokens, migration 0034) EST l'authentification — connaître le jeton, c'est avoir le droit
// de lire ce calendrier, exactement comme un lien de partage "quiconque a le lien" classique.
//
// Sécurité : ical_tokens n'a AUCUNE policy RLS pour anon/authenticated (voir la migration) — seule
// cette fonction (clé service-role) peut la lire. `scope=equipe` est revérifié ICI, côté serveur,
// à partir du RÔLE RÉEL du titulaire du jeton en base — jamais fait confiance à ce que le paramètre
// de requête prétend, un visiteur ne pouvant de toute façon fournir que le jeton lui-même.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function textResponse(body: string, status = 200, contentType = "text/plain; charset=utf-8") {
  return new Response(body, { status, headers: { ...CORS_HEADERS, "Content-Type": contentType } });
}

/** RFC 5545 impose des retours ligne CRLF et un repli des lignes de plus de 75 octets — le repli
 * n'est pas fait ici (nos lignes générées, résumés de congé compris, restent courtes en pratique) ;
 * seuls les retours CRLF sont réellement indispensables pour que les clients (Outlook en
 * particulier, plus strict que Google Agenda) acceptent le flux. */
function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
}

function toIcsDate(isoDate: string): string {
  return isoDate.replace(/-/g, "");
}

/** DTEND d'un événement "journée entière" est EXCLUSIF en iCalendar (RFC 5545) — le lendemain du
 * dernier jour réellement absent, sinon la plupart des clients affichent un jour de trop. */
function nextDay(isoDate: string): string {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function buildEvent(uid: string, dateDebut: string, dateFin: string, summary: string, description: string, stamp: string): string {
  return [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${toIcsDate(dateDebut)}`,
    `DTEND;VALUE=DATE:${toIcsDate(nextDay(dateFin))}`,
    `SUMMARY:${icsEscape(summary)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    "TRANSP:TRANSPARENT",
    "END:VEVENT",
  ].join("\r\n");
}

function buildCalendar(calname: string, events: string[]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Nexus RH//Calendar Feed//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(calname)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n") + "\r\n";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "GET") return textResponse("Méthode non autorisée.", 405);

  const url = new URL(req.url);
  const token = (url.searchParams.get("token") || "").trim();
  const scope = url.searchParams.get("scope") === "equipe" ? "equipe" : "perso";
  if (!token) return textResponse("Jeton manquant.", 400);

  const { data: tokenRow } = await supabaseAdmin.from("ical_tokens").select("employee_id").eq("token", token).maybeSingle();
  if (!tokenRow) return textResponse("Lien invalide ou révoqué.", 404);

  const { data: owner } = await supabaseAdmin
    .from("employees")
    .select("id, company_id, prenom, nom, role, archive")
    .eq("id", tokenRow.employee_id)
    .maybeSingle();
  if (!owner || owner.archive) return textResponse("Lien invalide ou révoqué.", 404);

  // Même règle de visibilité que getVisibleEmployeeIdsForCurrentUser (app.js) côté client, mais
  // revérifiée ici à partir du RÔLE RÉEL en base du titulaire du jeton — jamais fait confiance au
  // paramètre scope seul, qui ne prouve rien par lui-même.
  let employeeIds: string[];
  let calname: string;
  if (scope === "equipe" && ["rh", "proprietaire", "comptabilite"].includes(owner.role)) {
    const { data: all } = await supabaseAdmin.from("employees").select("id").eq("company_id", owner.company_id).eq("archive", false);
    employeeIds = (all || []).map((e: { id: string }) => e.id);
    calname = `Nexus — Absences de l'entreprise (${owner.prenom} ${owner.nom})`;
  } else if (scope === "equipe" && owner.role === "manager") {
    const { data: team } = await supabaseAdmin.from("employees").select("id").eq("company_id", owner.company_id).eq("archive", false).contains("manager_ids", [owner.id]);
    employeeIds = [owner.id, ...(team || []).map((e: { id: string }) => e.id)];
    calname = `Nexus — Absences de mon équipe (${owner.prenom} ${owner.nom})`;
  } else {
    // scope=perso, ou scope=equipe demandé par un salarié sans équipe : repli silencieux sur le
    // calendrier personnel plutôt qu'une erreur — l'abonnement reste utile, juste plus restreint.
    employeeIds = [owner.id];
    calname = `Nexus — Mes absences (${owner.prenom} ${owner.nom})`;
  }

  const { data: employees } = await supabaseAdmin.from("employees").select("id, prenom, nom").in("id", employeeIds);
  const employeeById = new Map((employees || []).map((e: { id: string; prenom: string; nom: string }) => [e.id, e]));

  const { data: leaveRequests } = await supabaseAdmin
    .from("leave_requests")
    .select("id, employee_id, type_id, date_debut, date_fin, statut, data, updated_at")
    .in("employee_id", employeeIds)
    .eq("statut", "Validé");

  const { data: leaveTypes } = await supabaseAdmin.from("leave_types").select("id, nom").eq("company_id", owner.company_id);
  const typeById = new Map((leaveTypes || []).map((t: { id: string; nom: string }) => [t.id, t.nom]));

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const events = (leaveRequests || []).map((r: { id: string; employee_id: string; type_id: string; date_debut: string; date_fin: string; updated_at: string }) => {
    const emp = employeeById.get(r.employee_id);
    const typeNom = typeById.get(r.type_id) || "Absence";
    const label = scope === "equipe" && employeeIds.length > 1 && emp
      ? `${emp.prenom} ${emp.nom} — ${typeNom}`
      : typeNom;
    return buildEvent(`nexus-leave-${r.id}@nexus-rh.com`, r.date_debut, r.date_fin, label, `Généré automatiquement par Nexus RH — ${typeNom}`, r.updated_at ? r.updated_at.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z") : stamp);
  });

  return textResponse(buildCalendar(calname, events), 200, "text/calendar; charset=utf-8");
});
