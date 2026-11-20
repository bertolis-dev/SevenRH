# Connecteur de prestataire de titres-restaurant (Swile)

Ajouté le 20/11/2026. Premier prestataire : **Swile** (https://integrations.swile.co/docs/fr/).

## Ce qu'il fait

1. **Synchronise les salariés** : Nexus crée le salarié chez Swile à l'embauche, met à jour ses informations (nom d'usage, civilité, date de naissance, matricule, manager),
   l'inscrit au produit « titres-restaurant » (les nouveaux reçoivent l'invitation Swile ; un salarié déjà connu de Swile est inscrit sans nouvelle invitation) et le retire
   au départ ou à l'archivage. Un salarié de Swile inconnu de Nexus n'est **jamais** touché.
2. **Envoie la commande mensuelle** par email, avec le fichier de commande en pièce jointe (CSV, séparateur point-virgule : matricule, nom, prénom, email, nombre de titres),
   à l'adresse de commande enregistrée dans Paramètres. L'API Swile ne reçoit pas de commande : c'est la raison de l'envoi par email.
   Le nombre commandé est enregistré (comme pour le fichier de commande), ce qui permet la régularisation automatique du mois suivant.

## Où se règle-t-il

Paramètres > Tickets restaurant > « Prestataire de titres-restaurant (Swile) » (propriétaire et RH) : identifiant client, clé secrète, produit, adresse de commande.
Boutons : Enregistrer, Tester la connexion (liste les produits Swile pour choisir celui des titres-restaurant), Synchroniser maintenant.
L'envoi de la commande se fait depuis l'écran « Tickets de l'équipe » (bouton « Envoyer la commande », avec confirmation).

La synchronisation automatique s'exécute au plus une fois par jour, à l'ouverture de Nexus par un RH ou un propriétaire (il n'y a pas de tâche planifiée côté serveur).

## Mise en ligne (à faire à la main, une seule fois)

1. **Migration** : Supabase > SQL Editor > coller `supabase/migrations/0078_connecteurs_tickets_restaurant.sql` > Run.
2. **Fonction serveur** : Supabase > Edge Functions > créer la fonction `connecteur-tickets` > coller `supabase/functions/connecteur-tickets/index.ts` > Deploy.
   Le secret `RESEND_API_KEY` doit exister (il sert déjà aux autres fonctions d'email).
3. Dans Swile (administrateur) : Intégrations > Développeurs > créer une clé d'API avec les droits `company:employees:read`, `company:employees:provision`,
   `company:employees:deprovision`, `company:employees:enroll`. Copier l'identifiant client et la clé secrète (affichée une seule fois) dans Nexus.
4. Dans Nexus : Tester la connexion, choisir le produit titres-restaurant, renseigner l'adresse de commande, cocher « Connecteur activé », Enregistrer.

Tant que la migration n'est pas exécutée, l'écran l'indique et rien ne s'active.

## Sécurité

- La clé secrète est écrite par une fonction réservée à `gererParametres` et lue seulement par la fonction serveur (clé service-role). La table des secrets n'a aucune politique : aucun
  navigateur, RH compris, ne peut la lire. L'écran ne la ré-affiche jamais.
- Entreprise et droits de l'appelant sont lus avec son propre jeton ; l'adresse de commande est lue en base ; les salariés synchronisés sont relus en base.
- Les lignes de commande sont contrôlées (nombre entier de 0 à 400, 5 000 lignes au plus) et les cellules commençant par `=`, `+`, `-` ou `@` sont neutralisées dans le CSV.

## Ajouter un autre prestataire

Le cadre est prévu pour : `fournisseur` est une colonne des quatre tables (contrainte `check` à élargir dans une nouvelle migration), et le cœur de la fonction
(`synchroniser`, `construireCsvCommande`) ne connaît Swile que par `clientSwile`. Il suffit d'écrire un client équivalent à partir de la documentation du prestataire.

## Tests

`tests/connecteur-tickets-20-11.test.js` exécute le cœur de la fonction serveur contre une simulation de l'API Swile (création, mise à jour, inscription, retrait, limites, managers, CSV, jetons, pagination).
`tests/connecteur-tickets-ecran-20-11.test.js` vérifie l'écran. Aucun test ne contacte le vrai Swile.
