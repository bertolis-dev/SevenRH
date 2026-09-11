/**
 * Seven RH — retour Betty du 11/09/2026 (point 3, "les photos de profil sont accessibles
 * publiquement") : employee-photos était un bucket PUBLIC (comme company-logos), or une URL
 * publique Supabase Storage est valable INDÉFINIMENT et contourne les policies RLS de
 * storage.objects (qui ne protègent que le chemin API authentifié, jamais l'URL publique directe).
 * Un salarié parti gardait donc l'accès aux photos de ses ex-collègues sans limite de temps.
 *
 * Voir 0046_employee_photos_private.sql (bucket passé en privé + reprise des URLs déjà enregistrées
 * vers un simple chemin) et supabase-client.js (uploadEmployeePhoto retourne un chemin,
 * getEmployeePhotoUrl le résout en URL signée d'1h). Ce fichier couvre la partie client : renderAvatar
 * ne doit plus jamais poser employee.photo directement en src (ce serait de nouveau une URL/chemin
 * exposé tel quel dans le DOM sans passer par une résolution signée), et resolveAvatarUrl doit mettre
 * en cache le résultat (jamais un appel réseau par avatar affiché à chaque re-render).
 */
const assert = require('assert');
const { loadAppJs } = require('./load-app-js');

async function run() {
  // ---- renderAvatar : plus jamais de src direct sur le chemin de stockage ----
  {
    const { renderAvatar } = loadAppJs();
    const html = renderAvatar({ prenom: 'Ana', nom: 'Test', photo: 'company1/emp1.jpg' });
    assert.ok(html.includes('data-photo-path="company1/emp1.jpg"'), 'le chemin doit être posé en data-attribute, pas en src direct');
    assert.ok(!html.includes('src="company1/emp1.jpg"'), 'le chemin de stockage ne doit jamais apparaître directement comme src (ce serait de nouveau une donnée non résolue exposée telle quelle)');
  }

  // ---- renderAvatar sans photo : inchangé (initiales) ----
  {
    const { renderAvatar } = loadAppJs();
    const html = renderAvatar({ prenom: 'Ana', nom: 'Test' });
    assert.ok(html.includes('avatar-initials'), 'sans photo, les initiales restent affichées comme avant');
  }

  // ---- resolveAvatarUrl : résout via SupabaseSync.getEmployeePhotoUrl et met en cache (jamais un
  // second appel réseau pour le même chemin tant que l'URL signée n'a pas expiré) ----
  {
    const { sandbox, resolveAvatarUrl } = loadAppJs();
    let calls = 0;
    sandbox.window.SupabaseSync = new Proxy({
      async getEmployeePhotoUrl(path) {
        calls++;
        return `https://storage.example.com/signed/${path}?token=abc`;
      }
    }, { get(target, prop) { return prop in target ? target[prop] : async () => ({ success: true }); } });

    const url1 = await resolveAvatarUrl('company1/emp1.jpg');
    const url2 = await resolveAvatarUrl('company1/emp1.jpg');
    assert.strictEqual(url1, 'https://storage.example.com/signed/company1/emp1.jpg?token=abc');
    assert.strictEqual(url2, url1, 'même chemin, même URL en cache');
    assert.strictEqual(calls, 1, 'un seul appel réseau pour deux résolutions du même chemin encore valide');

    // Un chemin différent redéclenche bien un appel distinct.
    const url3 = await resolveAvatarUrl('company1/emp2.jpg');
    assert.strictEqual(calls, 2);
    assert.notStrictEqual(url3, url1);
  }

  // ---- resolveAvatarUrl : un échec réseau/RLS ne doit jamais faire planter l'affichage (l'avatar
  // reste simplement sans photo plutôt qu'une exception remontant jusqu'à render()) ----
  {
    const { sandbox, resolveAvatarUrl } = loadAppJs();
    sandbox.window.SupabaseSync = new Proxy({
      async getEmployeePhotoUrl() { throw new Error('accès refusé'); }
    }, { get(target, prop) { return prop in target ? target[prop] : async () => ({ success: true }); } });

    const url = await resolveAvatarUrl('company1/emp1.jpg');
    assert.strictEqual(url, null, 'un échec de résolution retourne null plutôt que de lever une exception');
  }

  console.log('OK — photo-privee-11-09.test.js (bucket employee-photos privé, chemin résolu en URL signée en cache, jamais de src direct)');
}

run().catch((err) => {
  console.error('ÉCHEC — photo-privee-11-09.test.js');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
