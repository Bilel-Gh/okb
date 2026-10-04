# Reprise de la version 0.1.0

La première version apportait déjà TypeScript, les adaptateurs, la recherche locale,
OKF, les propositions et un plugin Claude. Ses tests ne couvraient pas plusieurs
cas qui contredisaient les garanties annoncées. Cette reprise conserve les modules
utiles et corrige les frontières avant d’élargir l’automatisation.

## Changements principaux

- Hash de proposition recalculé avant usage, couvrant preuves, dépendances,
  identité et sélection exactement approuvée. Rejet des identifiants-chemins.
- Politiques restrictives cumulées et couche équipe ; protection de la séparation
  état/KB et des fichiers d’instructions. Priorité correcte de `--profile`.
- Sauvegardes et reçu préparés avant mutation, verrou par KB, simulation de panne,
  reprise du crash après rename, annulation refusant les modifications ultérieures.
- Même mécanisme pour navigation, migration et déplacement. Plus de chemins de
  mutation directe derrière leurs anciens `--write`.
- Dossier d’analyse versionné avec couverture déclarée, citations exactes et
  séparation rapporté/déduit. Sources longues fractionnées sans perte ; snapshots
  réutilisables entre sessions. L’aperçu brut est identifié comme partiel.
- Liens de concepts dans le nouvel article, refus indépendant par fiche, aucune
  fiche vide publiée pour un terme inconnu, comptage par section tenant compte
  des liens déjà présents.
- Migration par positions de l’AST, protection des citations/code, encodage des
  noms de fichiers, résolution des images existantes et lignes de recherche exactes.
- Limites réseau avant/pendant acquisition et contrôle de chaque redirection.
- Révision officielle OKF figée ; règles optionnelles distinguées de la conformité.
- Plugin simplifié avec découverte standard, sous-agents sans shell, commandes
  manuelles distinctes des skills automatiques, évaluations natives fournies.
- Dépendances vulnérables retirées ou mises à jour ; installation du paquet
  effectivement testable dans un environnement propre.

## Compatibilité et limites

Node 22.12+ ; profils version 1 conservés. Recréer les propositions/approbations 0.1.
Les reçus 0.1 ne sont pas automatiquement convertis. Aucun vrai corpus personnel
n’est migré par cette livraison, aucun remote n’est configuré, aucun contenu n’est
poussé. La KB et les profils restent indépendants du produit.

Le modèle ne devient pas parfait grâce à des validations de schéma : sélection
réelle des skills, synthèse métier et qualité des preuves doivent être mesurées
avec Claude dans l’environnement cible. La suite native est prête, avec cette
validation explicitement distincte des tests logiciels.
