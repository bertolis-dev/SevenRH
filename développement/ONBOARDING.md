# Nexus RH (Seven RH) — Guide d'onboarding développeur

Bienvenue sur le projet. Ce document donne le nécessaire pour être opérationnel rapidement : architecture, comment lancer le projet, où sont les choses, et ce qui reste à faire.

## En une phrase

Un SIRH (logiciel RH) en **JavaScript vanilla, sans build, sans framework** — pas de React/Vue, pas de webpack/vite, pas de `npm install`. Le backend est **Supabase** (Postgres + Auth + Row Level Security + Edge Functions). Le front est hébergé sur **GitHub Pages**, statique.

## Démarrer en local

1. Ouvrir simplement `index.html` avec un serveur statique (le projet contient un script tout prêt) :
   - Avec Claude Code / VS Code : le fichier `.claude/launch.json` définit un serveur `seven-rh-static` (PowerShell, port 8811) qui sert le dossier tel quel.
   - Sans outil particulier : n'importe quel serveur statique (`npx serve .`, extension "Live Server" de VS Code...) suffit. Il n'y a aucune étape de compilation.
2. Le front se connecte au **vrai Supabase de production** (URL + clé anon codées en dur dans `supabase-client.js`) — il n'y a pas d'environnement de dev séparé aujourd'hui. Attention en testant : on touche la vraie base.

## Structure du projet

```
index.html            Page unique (SPA) — juste le squelette HTML, tout le reste est généré en JS
data.js                Couche données : modèle, logique métier, repositories, cache local
app.js                 Couche UI : rendu de toutes les vues, gestion des événements, routing interne
style.css              Tous les styles
supabase-client.js     Client Supabase (module ES) : auth, synchronisation, appels aux Edge Functions
supabase/
  migrations/          Fichiers SQL numérotés (0001 à 0018), à appliquer dans l'ordre
  functions/           Edge Functions Deno (backend serverless)
.claude/               Config pour Claude Code (serveur de dev local, permissions)
```

Il n'y a **pas de framework de test automatisé** dans ce projet — toute vérification se fait en chargeant réellement l'app dans un navigateur.

## Patterns importants à connaître avant de modifier quoi que ce soit

- **Cache local optimiste** : `data.js` lit/écrit de façon synchrone dans `localStorage` (rapide, jamais d'attente réseau pour l'utilisateur), puis pousse chaque changement vers Supabase **en arrière-plan** via `DB._pushInBackground(promise)`. Un échec réseau ne perd jamais la donnée locale, juste une notification "pas encore synchronisé".
- **Repository pattern** : chaque entité a un repository (`employeeRepository`, `leaveRepository`, `supportTicketRepository`...) qui est une fine couche au-dessus des méthodes `DB.xxx()`. Toujours passer par le repository depuis `app.js`, jamais `DB` directement.
- **Deux façons de stocker une entité côté Supabase** :
  - **Table dédiée** (ex. `leave_requests`, `support_tickets`) : pour tout ce qui doit être interrogé/filtré individuellement ou lu par un autre acteur (ex. BERTOLIS cross-entreprises).
  - **Blob dans `settings`** (colonne jsonb) : pour des listes de configuration propres à une entreprise (catégories de salariés, fermetures...) — évite une migration SQL à chaque petit ajout.
- **RLS (Row Level Security)** : chaque table a ses policies dans les migrations (voir `0002_rls_policies.sql` pour le cœur : `current_company_id()`, `has_permission()`). **Toute nouvelle permission ajoutée dans `data.js` (`PERMISSIONS`/`DEFAULT_ROLE_PERMISSIONS`) doit être répercutée à la main dans la fonction SQL `has_permission()`** — ce n'est pas partagé automatiquement, c'est documenté dans le code.
- **Écritures atomiques en jsonb** : quand plusieurs acteurs peuvent modifier la même ligne presque simultanément (ex. commentaires d'un ticket support), on passe par une fonction SQL dédiée (`append_ticket_comment`, `update_ticket_statut`) qui fait un `jsonb_set` en un seul `update`, plutôt que de lire-modifier-réécrire toute la ligne côté client (qui écraserait un changement concurrent).

## Ce qui est déjà construit (grandes fonctionnalités)

- Gestion des salariés, congés/absences (avec demi-journées), télétravail, notes de frais, workflow de validation par étapes.
- Calendrier interactif : clic sur un jour pour créer une demande, légende filtrable par catégorie.
- Catégories de salariés extensibles, règles d'éligibilité de congés personnalisables, clôture/report de compteurs.
- Jours fériés enrichis (exceptions par catégorie) + module "Fermetures".
- Abonnement Stripe (Checkout + Portail client + webhooks), code promo natif Stripe.
- Console **BERTOLIS** (éditeur du logiciel) : écran séparé (`#bertolis-root`), login local (mot de passe en clair, volontairement — voir plus bas), gestion des abonnements clients, et un système de **tickets support** cross-entreprises.
- Tickets support : un salarié crée un ticket (bouton "🆘 Aide" dans le menu utilisateur), suivi de statut (Nouvelle demande → En cours → Terminé → Livré, ou Fermé si annulé/doublon), historique horodaté, notification email à BERTOLIS, et **analyse automatique du contenu par l'API Claude** (catégorie/priorité/résumé suggérés — jamais appliqués automatiquement, juste affichés à part).

## Points d'architecture à connaître absolument

- **La console BERTOLIS n'a pas de vrai compte Supabase Auth** (choix explicite du client, pas une négligence) — son accès cross-entreprises passe par un **secret partagé** (`BERTOLIS_TICKETS_SECRET`) envoyé à l'Edge Function `bertolis-tickets`. Ce secret est codé en dur dans `data.js`, donc **visible dans le bundle JS public** — compromis assumé et documenté en commentaire à cet endroit précis du code. Si le nombre de clients grandit significativement, il faudra revoir ça (vrai compte Auth pour BERTOLIS).
- **`computeWorkingDays()`/`countRequestDaysInMonth()`** (`data.js`) calculent le nombre de jours décomptés pour une demande en excluant week-ends **et** jours fériés/fermetures (via `isJourTravaillePourSalarie()`). Toute nouvelle logique de comptage de jours doit réutiliser ces fonctions plutôt que refaire une boucle de dates.

## Secrets à configurer côté Supabase (Edge Functions → Secrets)

| Secret | Utilisé par | Pour quoi |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | toutes les fonctions | fournis automatiquement par Supabase, pas à saisir |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | `billing`, `stripe-webhook` | abonnements |
| `BERTOLIS_TICKETS_SECRET` | `bertolis-tickets` | doit être **identique** à la constante `BERTOLIS_TICKETS_SECRET` dans `data.js` |
| `RESEND_API_KEY`, `BERTOLIS_NOTIFY_EMAIL` | `notify-bertolis-ticket` | email envoyé à BERTOLIS à chaque nouveau ticket |
| `ANTHROPIC_API_KEY` | `analyze-ticket` | analyse IA des tickets (Claude) — si absente, l'analyse échoue proprement, la création de ticket n'est jamais bloquée |

## Déployer une modification

1. **Front** (`index.html`/`app.js`/`data.js`/`style.css`/`supabase-client.js`) : un simple `git push` sur `master` suffit — GitHub Pages redéploie automatiquement (~15-30s).
2. **Nouvelle migration SQL** : coller le contenu dans Supabase → SQL Editor → Run. Les migrations ne sont **pas appliquées automatiquement**, c'est un geste manuel à chaque fois.
3. **Edge Function modifiée ou nouvelle** : coller le code dans Supabase → Edge Functions → (créer ou éditer) → Deploy. Pas de CLI utilisée sur ce projet, tout se fait depuis le Dashboard.

## En attente / à vérifier en priorité

- La migration `0018_ticket_suivi_livraison.sql` et le déploiement de `analyze-ticket` sont écrits mais **pas encore confirmés appliqués en production** au moment de la rédaction de ce document — à vérifier en premier.
- Le secret `ANTHROPIC_API_KEY` n'est probablement pas encore configuré — sans lui, tout fonctionne normalement, seule la suggestion IA sur les tickets ne s'affiche pas.
