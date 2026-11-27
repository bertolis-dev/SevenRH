# Nexus RH (Seven RH) : guide d'onboarding développeur

Mis à jour le 27/11/2026 (audit du 26/11/2026, point « ONBOARDING.md périmé »). Ce document donne le nécessaire pour être opérationnel rapidement : architecture, lancement, tests, déploiement, et les règles à ne pas casser.

## En une phrase

Un SIRH (logiciel RH) en **JavaScript vanilla, sans bundler ni framework** : pas de React/Vue, pas de webpack/vite, aucune dépendance à installer. Le backend est **Supabase** (Postgres, Auth, Row Level Security, Edge Functions). Le front est un site statique hébergé sur **GitHub Pages**, sous le domaine `nexus-rh.com` (fichier `CNAME`).

## Démarrer en local

1. Servir le dossier tel quel avec n'importe quel serveur statique (`npx serve .`, extension « Live Server »). Avec Claude Code, `.claude/launch.json` définit un serveur statique (`.claude/serve.ps1`). Aucune étape de compilation.
2. Le front se connecte au **Supabase de production** (URL et clé anonyme dans `supabase-client.js`). Il n'existe pas encore d'environnement de recette : en créer un (second projet Supabase, copie de la production) avant d'appliquer tout durcissement serveur. En attendant, en test local, ne saisir que des données fictives.

## Tests et contrôles

- `npm run ci` : vérification de syntaxe (`node --check`), contrôle des tirets longs (`tools/check-em-dash.js`) puis tous les tests (`tests/run-all.js`, environ 230 fichiers). **Doit être vert avant chaque mise en ligne.**
- Les tests chargent `data.js` et `app.js` dans un bac à sable Node (`tests/load-data-js.js`, `tests/load-app-js.js`). Un symbole déclaré par `const` au niveau racine n'est pas visible : l'exposer dans le chargeur (`globalThis.__NOM = NOM`). Les objets créés dans le bac à sable ne sont pas comparables par `deepStrictEqual` : comparer via `JSON.stringify`.
- Aucun test ne contacte le vrai Supabase, Stripe, Resend ou Swile (les fonctions serveur sont testées contre des simulations).
- Les données de test sont toujours fictives.

## Structure du projet

```
index.html            Page unique (SPA) : squelette HTML, le reste est généré en JS (les ?v= sont mis à jour par npm run bump)
data.js               Couche données : modèle, logique métier, repositories, cache local
app.js                Couche UI : rendu des vues, événements, routing interne (fichier volumineux, découpage prévu)
style.css             Tous les styles
supabase-client.js    Client Supabase (module ES, expose window.SupabaseSync) : auth, synchronisation, appels aux Edge Functions
sw.js, manifest.webmanifest   Application installable (PWA)
supabase/
  migrations/         Fichiers SQL numérotés (0001 à 0078 aujourd'hui), appliqués à la main dans l'ordre
  functions/          Edge Functions Deno (_shared, billing, stripe-webhook, notify-*, calendar-feed, connecteur-tickets, ...)
tests/                Tests Node (un fichier par sujet, nommé avec sa date)
tools/                bump-version.js (numéro de version), check-em-dash.js
docs/                 Documentation fonctionnelle (connecteur Swile, exemples d'export Nexus Gestion, règles à valider)
développement/        Ce guide
desktop-app/          Enveloppe application de bureau
```

## Règles à connaître avant de modifier quoi que ce soit

- **Cache local optimiste** : `data.js` lit et écrit de façon synchrone en local (jamais d'attente réseau), puis pousse chaque changement vers Supabase en arrière-plan (`DB._pushInBackground`, file `_pendingSync`). Un échec réseau ne perd pas la donnée locale.
- **Repository pattern** : chaque entité a son repository (`employeeRepository`, `leaveRepository`...), fine couche au-dessus de `DB.xxx()`. Depuis `app.js`, passer par le repository.
- **Deux façons de stocker une entité côté Supabase** : table dédiée (ce qui est interrogé ou lu par un autre acteur) ou blob jsonb dans `settings` (configuration propre à l'entreprise, sans migration). Les champs d'une fiche salarié vivent dans `employees.data` (jsonb) : un nouveau champ de fiche ne demande pas de migration. La rémunération vit à part (migration 0074) et n'est lisible qu'avec le droit « voir les informations financières ».
- **RLS** : les politiques sont dans les migrations (cœur : `0002_rls_policies.sql`, `current_company_id()`, `has_permission()`). **Toute permission ajoutée dans `PERMISSIONS` / `DEFAULT_ROLE_PERMISSIONS` (`data.js`) doit être recopiée à la main dans la fonction SQL `has_permission()`**, sinon le serveur ne la connaît pas.
- **Les droits côté navigateur ne protègent rien seuls** : ce que l'écran interdit, le serveur doit aussi l'interdire (déclencheurs et politiques). Une règle d'accès sans test de recette ne compte pas comme corrigée.
- **Définitions uniques** : effectif et masse salariale passent par `getEffectifEnPoste` / `getMasseSalarialeEnPoste` (`data.js`) ; le nombre de jours d'une demande passe par `computeWorkingDays()` / `countRequestDaysInMonth()`. Ne pas réécrire de variante.
- **Aucune valeur légale ou comptable en dur sans statut** : SMIC, durées d'entretien, plafonds se règlent dans les paramètres ; les valeurs par défaut sont « non validées » tant que l'expert-comptable ou le juriste ne les a pas confirmées (`docs/regles-a-valider.md`).
- **Données de santé** : un motif d'absence de type santé ne part jamais vers Slack, Teams, Google Chat ni le calendrier abonné (`motifAbsenceConfidentiel`, `libelleAbsencePartage`).
- **Écritures atomiques en jsonb** : quand plusieurs acteurs écrivent la même ligne, passer par une fonction SQL dédiée plutôt que lire-modifier-réécrire côté client.

## Fonctionnalités principales

Salariés et fiches, congés et absences (demi-journées, compteurs à clôture, report, paliers d'ancienneté, conventions collectives), télétravail, notes de frais, circuit de validation par étapes, calendrier d'équipe, planning, pointeuse, tickets restaurant (calcul, pointage des écarts, commande Swile avec double validation, connecteur Swile), entretiens, formations, documents, préparation de paie et export, abonnement Stripe, console BERTOLIS (tickets support), assistant Boussole (API Claude).

## Version et mise en ligne

1. **Avant chaque mise en ligne** : `npm run ci`, puis `npm run bump` (change `APP_VERSION` dans `app.js` et les `?v=` de `index.html`), puis une ligne dans la première entrée de `CHANGELOG_ENTRIES` (`app.js`) si le changement est visible. Un test vérifie que le tout reste aligné.
2. **Front** : `git push` sur `master`, GitHub Pages redéploie.
3. **Migration SQL** : coller le fichier dans Supabase > SQL Editor > Run. **Jamais appliquée automatiquement.** Un durcissement de règles d'accès s'applique d'abord sur un projet de recette.
4. **Edge Function** : coller le fichier unique `supabase/functions/<nom>/index.ts` dans Supabase > Edge Functions > Deploy (pas de CLI). Penser à redéployer une fonction modifiée (ex. `calendar-feed`, `connecteur-tickets`).

## Secrets à configurer côté Supabase (Edge Functions > Secrets)

| Secret | Utilisé par | Pour quoi |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | toutes les fonctions | fournis automatiquement |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | `billing`, `stripe-webhook` | abonnements |
| `RESEND_API_KEY` (+ `BERTOLIS_NOTIFY_EMAIL`) | `notify-*`, `connecteur-tickets`, `notify-bertolis-ticket` | envoi des e-mails |
| `BERTOLIS_TICKETS_SECRET` | `bertolis-tickets` | doit être identique à la constante de `data.js` (compromis connu, voir ci-dessous) |
| `ANTHROPIC_API_KEY` | `analyze-ticket`, `ask-boussole` | IA ; sans elle, les fonctions échouent proprement |

## Points d'architecture connus

- La console BERTOLIS n'a pas de compte Supabase Auth : son accès passe par un secret partagé visible dans le bundle public (compromis assumé, à revoir quand le nombre de clients grandira).
- Les secrets des connecteurs (clé Swile) ne sont lisibles que par la clé de service (table sans politique, voir migration 0078).

## En attente (au 27/11/2026)

- Migrations 0077 et 0078 et fonction `connecteur-tickets` : écrites, à confirmer appliquées en production.
- Durcissement des règles d'accès côté serveur (audit du 26/11/2026, section 1) : préparé hors du dépôt public, à passer en recette puis en production.
- Correction du double décompte des congés : codée, désactivée, à activer après validation du comparatif par l'expert-comptable.
- Feuille de route de l'audit : lots A et B avant toute autre évolution.
