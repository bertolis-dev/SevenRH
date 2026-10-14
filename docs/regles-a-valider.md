# Règles à valider

Ce fichier liste toutes les règles de gestion ou de droit social que l'application applique, ou propose
d'appliquer, **sans qu'elles aient été validées** par un expert (expert-comptable, juriste, convention
collective). Aucune de ces valeurs n'est une décision juridique : ce sont des propositions, toutes
modifiables dans Paramètres quand c'est indiqué.

La colonne « Validé » est volontairement vide : à remplir (nom, date) une fois la règle confirmée.

Les « sources supposées » sont citées de mémoire pour orienter la vérification : **elles doivent être relues
sur Légifrance ou auprès d'un professionnel avant tout usage**.

## Règles appliquées par défaut

| Règle | Valeur retenue | Source supposée | Où dans le code / où la régler | Validé |
|---|---|---|---|---|
| Pause déduite par défaut d'un nouveau créneau de planning | 30 min, modifiable par créneau | Pratique courante ; la pause minimale légale (20 min après 6 h de travail) est contrôlée séparément | `pauseParDefautMinutes` (data.js, `DEFAULT_SETTINGS`) ; Paramètres > Planning | |
| Durée maximale de travail par jour (alerte planning) | 10 h | Code du travail L3121-18 (dérogeable par accord) | `planningDureeMaxQuotidienneHeures` ; Paramètres > Planning > Alertes du planning | |
| Durée maximale de travail par semaine (alerte planning) | 48 h | Code du travail L3121-20 | `planningDureeMaxHebdomadaireHeures` ; idem | |
| Repos minimum entre deux journées | 11 h | Code du travail L3131-1 | `planningReposQuotidienHeures` ; idem | |
| Repos hebdomadaire minimum | 35 h consécutives | Code du travail L3132-2 (24 h) + L3131-1 (11 h) | `planningReposHebdomadaireHeures` ; idem | |
| Alerte « travail le dimanche » | Désactivée par défaut, signalement non bloquant | Repos dominical (L3132-3) et ses nombreuses dérogations (L3132-12 et suivants) | `planningAlerteDimanche` ; idem | |
| Pause obligatoire : 20 min dès 6 h de travail | 20 min / 6 h (non paramétrable aujourd'hui) | Code du travail L3121-16 | `SEUIL_PAUSE_OBLIGATOIRE_MINUTES`, `PAUSE_OBLIGATOIRE_MIN_MINUTES` (data.js) | |
| Congés par anticipation | **Aucun contrôle** par défaut (comportement antérieur : une demande peut dépasser le solde, la paie signale ensuite un solde négatif). Options : interdite (jamais au-delà du solde disponible) ou autorisée dans la limite des jours déjà acquis à date | Pas de règle unique : dépend de l'accord d'entreprise ou de la convention | `congesAnticipation` ; Paramètres > Congés et absences > Congés par anticipation | |
| Télétravail et tickets restaurant | Un jour de télétravail **ne réduit pas** le nombre de tickets | À vérifier : égalité de traitement avec un salarié sur site, convention, accord télétravail | `ticketsInclureTeletravail` ; Paramètres > Tickets restaurant | |
| Libellé d'une note de frais | 3 caractères minimum et au moins une lettre | Règle de gestion interne (pas une règle de droit) | `validerLibelleNoteFrais` (data.js) | |
| Justificatif d'une note de frais | Obligatoire pour toute note (réglage général, activé par défaut ; désactivé, les règles par catégorie s'appliquent) | Pratique de contrôle des frais ; à confronter à la politique de remboursement et aux exigences de l'organisme de recouvrement | `justificatifNoteFraisObligatoire` ; Paramètres > Notes de frais > Justificatif | |
| Barème kilométrique | **Vide par défaut** : l'entreprise saisit puis confirme son barème par année et par motorisation. Tant qu'il est vide, les valeurs indicatives de la plateforme servent de repli, affichées « non validé » | Barème fiscal officiel publié chaque année (service-public.fr, impots.gouv.fr) | `baremesKilometriques` (réglage) et `BAREMES_KILOMETRIQUES` (repli indicatif, data.js) ; Paramètres > Notes de frais > Barème kilométrique | |
| Tolérance du pointage face au planning | 10 min (retard, départ anticipé, dépassement) | Règle de gestion interne | `pointageToleranceMinutes` ; Paramètres > Planning | |
| Rappel avant perte de congés | Premier rappel 60 jours avant la clôture du compteur, dernier rappel 14 jours avant | Règle de gestion interne ; la perte elle-même dépend du report configuré sur chaque type de congé | `delaiRappelPerteCongesJours` ; Paramètres > Congés et absences | |
| Entretien professionnel | Tous les 2 ans après le dernier entretien (ou l'embauche) ; rappels à 30 jours, 7 jours et en retard | Code du travail L6315-1 | `getUpcomingEntretiensProfessionnels` (app.js) ; la clôture d'un entretien met à jour la date du dernier entretien | |
| Bilan à 6 ans | 6 ans après l'embauche, puis 6 ans après chaque bilan réalisé ; mêmes rappels | Code du travail L6315-1 (II) | `getUpcomingBilansSixAns` (app.js) ; `dateDernierBilanSixAns` | |
| Indemnité compensatrice de congés payés | Au départ, tous les jours acquis et non pris sont dus, **y compris ceux acquis sur la période en cours** (avant, seule la période close était comptée) ; type en jours ouvrables : brut / 26, en jours ouvrés : brut / 22. Les types de congé payés actifs sont tous inclus (un RTT actif l'est aussi : à confirmer) | Code du travail L3141-28 ; diviseurs d'usage (mois moyen), pas une valeur légale unique | `calculateIndemniteCompensatrice` (data.js) | |
| Maintien de salaire en cas d'arrêt maladie | Carence de 3 jours (celle des indemnités journalières de la Sécurité sociale) réutilisée pour le maintien employeur. **Signalé par la revue du 13/10 : la carence d'indemnisation employeur pour maladie ordinaire serait de 7 jours — non modifié, à confirmer avec votre juriste** | Code du travail D1226-3 (à vérifier) | `data.js`, calcul du maintien de salaire | |
| Ancienneté en années | Différence de jours divisée par 365,25 : un anniversaire peut donner 4,9993 an au lieu de 5 (seuils d'ancienneté manqués d'un jour). **Non modifié** : toucher à ce calcul déplace les paliers de plusieurs règles (congés d'ancienneté, maintien de salaire) | Règle de gestion interne | `calculateAncienneteYears` (data.js) | |
| Cycle de statuts d'une note de frais | Soumise, Validée (à payer), Remboursée (date de paiement), Refusée, Annulée ; pas de retour en arrière | Règle de gestion interne | `TRANSITIONS_NOTE_FRAIS`, `libelleStatutNoteFrais` (data.js) | |
| Types de congé inactifs | Chiffres masqués dans le Tableau des compteurs, ignorés par les anomalies de paie | Règle de gestion interne | `renderTableauCompteurs`, `getPaieAnomalies` (app.js) | |
| Export vers Nexus Gestion : mois d'une note | Une note « Remboursée » est exportée dans le mois de sa validation/remboursement (même règle que la Préparation de paie) | Règle de gestion interne, contrat partagé avec Nexus Gestion (format v1) | `construireExportNexusGestion` (data.js) ; docs/exemple-export-nexus-rh-v1.json | |
| Export vers Nexus Gestion : bloc « paie » | Rempli **uniquement** avec le journal de paie du mois saisi ou importé (Nexus RH ne calcule pas la paie) ; sinon null. Un journal enregistré mais incomplet bloque l'export. Droit « voir les infos financières » requis pour le voir, le saisir et l'inclure dans l'export (le RH ne l'a pas par défaut) | Choix de confidentialité interne | `validerJournalPaie`, table `paie_journaux` (0071) ; docs/exemple-export-nexus-rh-v1-avec-paie.json | |
| Import d'un journal de paie CSV/Excel | Colonnes reconnues d'après leur titre (brut, cotisations salariales/patronales, net à payer, organisme, montant) et corrigeables ; additionne toutes les lignes en ignorant celles intitulées « Total » ; un montant français (« 1 234,56 ») est lu tel quel. Rien n'est enregistré sans clic sur Enregistrer | Choix de conception | `devinerColonnesJournalPaie`, `agregerJournalPaie` (data.js) | |

## Limites connues

- **Échéance de report des congés.** `dateLimiteReportMMJJ` tombe, par construction du calcul, dans la période de référence déjà close : il n'y a donc jamais d'échéance de report « à venir » à rappeler. Les rappels portent sur la perte à la clôture du compteur.
- **Pointage.** Un salarié en congé validé (journée entière), en télétravail validé ou un jour férié/fermé n'est jamais signalé en écart ; une demi-journée de congé isolée ne l'excuse pas.

## Limites connues des contrôles du planning

- Les contrôles de repos portent sur le **modèle hebdomadaire récurrent** et ne tiennent pas compte d'un
  quart à cheval sur minuit (l'écran refuse d'ailleurs un quart dont la fin est avant le début).
- Les seuils sont des valeurs de repli légales : une convention collective peut les relever ou les abaisser.
  Ils ne remplacent pas un contrôle de la durée du travail par un professionnel.

## Conception proposée, non livrée : acquisition de congés pendant un arrêt maladie (B3)

**État actuel.** L'acquisition de congés payés suit le temps écoulé : un arrêt maladie ne la réduit pas.
Une option existe pour suspendre l'acquisition d'un type d'absence entier (`suspendAcquisitionAutresCompteurs`),
mais elle n'est pas liée à la nature de l'arrêt (maladie, accident du travail, accident de trajet, maladie
professionnelle) et ne connaît ni plafond ni règle de report. Le code ne gère pas la loi d'avril 2024.

**Règle à valider (ne rien livrer avant).** Source supposée : loi du 22 avril 2024 portant diverses
dispositions d'adaptation au droit de l'Union européenne, et articles L3141-3 et suivants du Code du travail.
Éléments à faire confirmer, chacun avec sa valeur proposée :

| Élément | Valeur proposée (à confirmer) | Remarque |
|---|---|---|
| Acquisition pendant un arrêt non professionnel | 2 jours ouvrables par mois d'arrêt | À confirmer, y compris la période de référence |
| Plafond annuel pour cet acquis | 24 jours ouvrables | À confirmer |
| Acquisition pendant un accident du travail / maladie professionnelle | Selon la règle applicable à ces arrêts | À confirmer (traitement distinct de l'arrêt non professionnel) |
| Report des congés non pris du fait de l'arrêt | 15 mois à compter de la reprise ou de la fin de la période de référence | À confirmer, avec le point de départ exact |
| Information du salarié | Message à la reprise indiquant les jours à prendre et le délai | À confirmer |

**Conception technique envisagée.**
1. Réglage par entreprise « Appliquer les règles légales d'acquisition pendant un arrêt maladie », désactivé par
   défaut (comportement actuel inchangé), avec les valeurs ci-dessus modifiables.
2. Calcul fondé sur `request.arretTravail.typeArret` (déjà saisi dans la demande) plutôt que sur le type d'absence
   entier ; l'acquisition « arrêt » est ajoutée séparément et plafonnée, jamais mélangée au calcul courant.
3. Report : une échéance propre à ces jours (date limite + rappel avant perte), distincte de la date limite de
   report habituelle (`dateLimiteReportMMJJ`).
4. Tests de non-régression : entreprise sans le réglage = résultats identiques à aujourd'hui.
5. Affichage : mention explicite « acquis pendant un arrêt maladie » sur la carte du solde.

À livrer uniquement après validation des cinq éléments ci-dessus.
