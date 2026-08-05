// Seven RH — fonction "manage-employee-account" : un Directeur/RH crée ou réinitialise directement
// le compte de connexion d'un salarié de SON entreprise, sans que celui-ci ait besoin de s'inscrire
// lui-même (l'ancien parcours "Créer un compte", qui rattachait par correspondance de domaine
// d'email, a été retiré — chaque compte est désormais créé explicitement par un administrateur).
//
// Deux actions :
// - "create" : le salarié n'a encore aucun auth_user_id — crée un vrai compte Supabase Auth
//   (email déjà confirmé, pas besoin d'un aller-retour par email) avec un mot de passe temporaire
//   généré côté serveur, renvoyé une seule fois à l'appelant pour qu'il le transmette au salarié
//   par un autre canal (oral, SMS...). Le salarié devra le changer à sa première connexion
//   (data.mustChangePassword, vérifié côté site après login).
// - "reset" : le salarié a déjà un compte — réinitialise son mot de passe (le champ "Réinitialiser
//   le mot de passe" existait déjà côté site mais n'écrivait que dans une colonne locale devenue
//   sans effet depuis la migration vers Supabase Auth ; ceci le fait enfin réellement).
//
// Sécurité : comme billing/index.ts, has_permission()/current_company_id()/current_employee_id()
// sont appelées AVEC LE JETON DE L'APPELANT (pas la clé service-role) pour obtenir la vraie réponse
// pour ce salarié précis. La création/modification du compte cible, elle, exige la clé service-role
// (auth.admin.*), donc un client séparé. Le salarié cible doit appartenir à la même entreprise que
// l'appelant, et ne jamais être l'appelant lui-même (même règle que partout ailleurs dans ce
// projet : on n'agit jamais sur sa propre fiche via les outils d'administration).

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/** Mot de passe temporaire lisible (évite les caractères ambigus 0/O/1/l/I) — assez long pour
 * rester sûr même communiqué à l'oral. */
function generateTempPassword(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Non authentifié." }, 401);

  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Corps de requête invalide." }, 400);
  }

  const { employeeId, action } = body;
  if (!employeeId || (action !== "create" && action !== "reset")) {
    return jsonResponse({ error: "Requête invalide." }, 400);
  }

  const { data: companyId, error: companyErr } = await supabaseUser.rpc("current_company_id");
  if (companyErr || !companyId) return jsonResponse({ error: "Entreprise introuvable pour ce compte." }, 400);

  const { data: canManage, error: permErr } = await supabaseUser.rpc("has_permission", {
    permission_key: "gererUtilisateurs",
  });
  if (permErr || !canManage) {
    return jsonResponse({ error: "Vous n'avez pas le droit de gérer les comptes de connexion." }, 403);
  }

  const { data: callerEmployeeId } = await supabaseUser.rpc("current_employee_id");
  if (callerEmployeeId === employeeId) {
    return jsonResponse({ error: "Impossible d'agir sur son propre compte par cet outil." }, 400);
  }

  const { data: employee, error: empErr } = await supabaseAdmin
    .from("employees")
    .select("id, email, company_id, auth_user_id, data")
    .eq("id", employeeId)
    .maybeSingle();
  if (empErr || !employee || employee.company_id !== companyId) {
    return jsonResponse({ error: "Salarié introuvable dans votre entreprise." }, 404);
  }

  const tempPassword = generateTempPassword();
  const nextData = { ...(employee.data || {}), mustChangePassword: true };

  try {
    if (action === "create") {
      if (employee.auth_user_id) {
        return jsonResponse({ error: "Ce salarié a déjà un compte de connexion." }, 400);
      }
      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email: employee.email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { intent: "admin_created" },
      });
      if (createErr) throw createErr;

      const { error: updateErr } = await supabaseAdmin
        .from("employees")
        .update({ auth_user_id: created.user.id, data: nextData })
        .eq("id", employeeId);
      if (updateErr) throw updateErr;

      return jsonResponse({ success: true, password: tempPassword });
    }

    // action === "reset"
    if (!employee.auth_user_id) {
      return jsonResponse({ error: "Ce salarié n'a pas encore de compte de connexion à réinitialiser." }, 400);
    }
    const password = typeof body.password === "string" && body.password.length >= 6 ? body.password : tempPassword;
    const { error: resetErr } = await supabaseAdmin.auth.admin.updateUserById(employee.auth_user_id, { password });
    if (resetErr) throw resetErr;

    const { error: updateErr } = await supabaseAdmin.from("employees").update({ data: nextData }).eq("id", employeeId);
    if (updateErr) throw updateErr;

    return jsonResponse({ success: true, password });
  } catch (err) {
    console.error("manage-employee-account error:", err);
    return jsonResponse({ error: "Erreur : " + (err as Error).message }, 500);
  }
});
