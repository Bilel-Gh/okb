# Architecture et décisions

## Frontières de responsabilité

Le plugin orchestre le travail intellectuel dans Claude. Le CLI s’occupe des
opérations reproductibles. Obsidian reste un lecteur/éditeur des fichiers ; il
n’est pas nécessaire pour exécuter les tests. Aucun MCP n’est requis par défaut.

```mermaid
flowchart TD
  S[Source] --> N[Extraction bornée]
  N --> A[Analyse par Claude]
  K[KB privée] --> R[Recherche et vocabulaire]
  R --> A
  A --> P[Proposition immuable]
  P --> V[Revue des preuves]
  V --> H[Approbation de la sélection]
  H --> B[Reçu initial et sauvegardes privés]
  B --> W[Écriture contrôlée]
  W --> K
  W --> J[Reçu finalisé]
```

Le dossier d’analyse porte les blocs déclarés lus, les affirmations rapportées ou
déduites et leurs extraits exacts. Le noyau vérifie les identifiants et les citations ;
le réviseur évalue si elles soutiennent réellement le texte. Aucun test structurel
ne transforme une affirmation en fait techniquement vérifié.

## Modules

| Module | Contrat |
|---|---|
| `sources/` | acquisition limitée, adaptateurs, blocs normalisés et localisateurs |
| `pipeline/analysis.ts` | dossier v1/v2, couverture déclarée sur toutes les sources, identité des extraits, aides reliées aux affirmations, rendu stylé |
| `kb/`, `concepts/` | recherche locale, alias, sens, propositions de définitions et de liens |
| `proposal/` | contenu exact, dépendances, sélection, hash recalculable, validation, combinaison de propositions |
| `apply/` | autorisation, limites de chemin, verrou, préparation durable, reprise et rollback |
| `config/`, `setup/` | profils privés, précédence, restrictions cumulées |
| `okf/`, `links/`, `markdown/` | format ouvert, références relatives, modifications par positions AST |
| `nav/`, `migrate/`, `maintain/` | opérations d’entretien utilisant le même contrat de proposition |
| `style/` | préréglages, résolution par couches et demande ponctuelle, brief de rédaction, libellés fixes |
| `templates/` | modèles de notes (sections, ordre, titres, consignes), surcharges par KB |
| `revise/` | révision du style d’une note : éléments protégés, frontmatter, proposition de remplacement |
| `web/` | lecteur local sans mutations : notes, recherche, propositions exactes, style et audit |
| `plugin/` | six skills, huit commandes, deux agents, un hook limité et `bin/okb` |

## Choix assumés

**Fichiers avant base vectorielle.** Les notes restent lisibles, diffables et
transportables. La recherche actuelle est lexicale, avec titres, alias, rubriques
et extraits. Claude peut reformuler une recherche. Un index sémantique pourra être
ajouté comme cache dérivé, jamais comme source canonique. Aucune promesse de rappel
sémantique universel n’est faite pour cette version.

**Configuration plutôt que forks personnels.** Les profils portent le domaine,
la langue et le niveau d’assistance. Une couche équipe est distincte de la couche
organisation. Les listes d’interdiction s’unissent ; chaque groupe d’autorisation
d’écriture doit accepter le chemin ; les plafonds prennent le minimum. Les
préférences ne rétablissent pas une permission interdite par une couche supérieure.
Un profil demeure modifiable par le propriétaire de la machine : ce n’est pas un
service d’administration central avec identité forte.

**Sources complètes, sorties bornées.** Les blocs trop longs sont fractionnés sans
perte de texte. Les pages respectent un budget estimé et un curseur. Le snapshot
normalisé est conservé hors KB ; `--run` le réutilise sans relire le réseau. Le
curseur signifie « livré au caller ». La couverture sémantique est déclarée dans
le dossier puis contrôlée par revue, pas déduite du nombre de tokens envoyés.

**Le style est un paramètre, pas une réécriture.** Le brief est généré à la
demande depuis quelques valeurs du profil ; le style utilisé est figé dans le
dossier et dans `x_okb.writing`. Les faits restent des affirmations sourcées ;
les analogies, schémas et exemples sont des aides rattachées à ces affirmations.
Voir [STYLE.md](STYLE.md).

**Des modèles pour que la KB reste lisible en grandissant.** Chaque note suit un
modèle (guide, concept, procédure, retour d’expérience, décision, réunion) qui
fixe ses sections et leurs titres ; le CLI refuse un dossier qui s’en écarte. Voir
[TEMPLATES.md](TEMPLATES.md).

**Propositions avant mutations.** Import, navigation, migration et déplacement
produisent le même objet. Un déplacement est un groupe indivisible. Le hash porte
sur le contenu, les preuves, dépendances, profil et KB. Une approbation vise la
sélection exacte. La sélection modifie le résultat : une approbation de tous les
changements ne vaut donc pas pour n’importe quel sous-ensemble.

**Écritures récupérables.** Tous les résultats sont matérialisés et contrôlés avant
la première mutation. Sauvegardes et contenus attendus utilisent des noms dérivés
du hash du chemin, sans collisions entre `a/b.md` et `a__b.md`. Un reçu incomplet
existe avant l’écriture. Au redémarrage, chaque fichier doit correspondre à son
état initial ou à son résultat attendu ; la reprise reconnaît même le crash situé
entre `rename()` et le journal. L’annulation précontrôle tous les fichiers et
refuse les modifications ultérieures. Les fichiers sont atomiques séparément,
mais un lecteur externe peut observer un lot partiellement appliqué.

L’état de départ est revérifié pendant la préparation des écritures : une
édition Obsidian entre le contrôle initial et la lecture à sauvegarder n’est pas
adoptée silencieusement comme nouvelle référence. La reprise revalide le résultat
structurel et les liens sur la KB courante avant ses prochains fichiers.

**Fraîcheur sur demande.** L’entretien peut comparer une référence locale à son
empreinte d’ingestion à partir des métadonnées privées déjà présentes. Il ne
recontacte pas les URL et n’interprète pas le changement de contenu. Une comparaison
impossible reste « inconnue », et aucune note n’est réécrite automatiquement.

**Lecture avant approbation.** Le serveur local réutilise recherche et
matérialisation du CLI, affiche des données via DOM texte et accepte uniquement
des lectures depuis son origine sur 127.0.0.1. L’approbation reste dans le terminal.
Ce choix réduit le coût de revue sans ajouter un second moteur d’écriture.

**Une intelligence éditoriale, pas un générateur de fiches vides.** Les heuristiques
remontent des termes et les définitions explicites. Le dossier peut proposer des
notions sémantiquement utiles avec preuves. Les sens ambigus ne sont pas fusionnés.
Les prérequis d’un article ne deviennent pas automatiquement ceux d’un nouveau
concept. Les liens sont planifiés par section et chaque lien dépend seulement de
sa cible. Les citations, le code et les liens existants sont protégés.

**Conservation des intentions éditoriales.** Les opérations Markdown utilisent
les positions de l’AST et modifient les sous-chaînes concernées. Un déplacement
recalcule les destinations entrantes et sortantes ; une migration n’utilise pas
un remplacement global de texte. Le YAML conserve les champs inconnus. Le formatage
YAML peut changer pour une clé modifiée ; le corps ne subit pas de réécriture globale.

## Ce que « devient plus intelligent » signifie ici

Les nouvelles notes validées, les alias, les définitions et les préférences connues
enrichissent les prochains résultats. Le logiciel n’entraîne pas Claude et ne
déduit pas automatiquement un profil psychologique. Les corrections de savoir
passent par une proposition. Pour aller plus loin, mesurer d’abord les réponses
utiles, les fausses attributions et le temps de revue sur un corpus représentatif.
