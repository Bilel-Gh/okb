# Workflows concrets

## Import complet

1. `okb ingest /chemin/source.vtt --extract-only --json` fournit un `runId` et une page.
2. Lire la suite avec le même `--run` et `--cursor`. Les blocs trop longs sont
   fractionnés ; chaque fragment conserve son localisateur. Lire jusqu’au bout.
3. `okb ask "sujet" --limit 5 --json` cherche une destination existante.
   `okb style --json` donne le brief de rédaction (avec ajustements ponctuels).
4. `okb ingest /chemin/source.vtt --run <runId> [--with autre-source]… --template --json`
   crée un modèle de dossier v2 (sources, style) dans l’état privé. Claude le remplit selon
   [le contrat d’analyse](../../plugin/skills/okb-ingest/references/analysis-dossier.md).
5. Préparer, sans modifier la KB :

```bash
okb ingest /chemin/source.vtt --run <runId> --analysis-file /chemin/prive/dossier.json \
  --append flows/executer-un-job.md --heading "Exceptions et décisions" --json
```

6. `okb review <id> --diff --json`, puis revue indépendante par le sous-agent de
   preuves. Lire les pages supplémentaires si nécessaire. Le dossier complet
   et le snapshot sont dans l’état, pas dans le contexte permanent de Claude.
7. Une personne signe `okb review <id> --approve --only c-article,c-concept-0` pour
   la sélection qu’elle vient de lire ; l’agent applique exactement cette sélection
   avec `okb apply <id> --json`.

Le dossier impose une preuve par affirmation et refuse les citations inventées
ou une couverture incomplète déclarée. Cela ne garantit pas qu’un extrait soutient
logiquement l’affirmation. Le réviseur cherche les négations et corrections tardives.
Le résumé privé n’est pas publié comme prose non sourcée.

Sans dossier, le noyau peut préparer un aperçu brut explicitement partiel pour
inspection. Il ne constitue pas un enrichissement intelligent terminé. La skill
normale utilise toujours le dossier. Une source sans contenu lisible ne produit
pas de proposition.

## Plusieurs sources et code

Un article qui explique « où regarder dans le code » cite souvent une note de
conception et les fichiers qui l’implémentent. Chaque source est extraite et lue
dans son propre run, puis le dossier v2 liste leurs empreintes dans `sources` ;
la préparation reçoit la source principale et `--with` pour les autres. Les
notes de bas de page indiquent le fichier et les lignes (`assignJob, l.6–14`).
Le titre d’un fichier de code est son chemin relatif au projet, sans chemin
personnel. Lire un fichier de code ne prouve pas son comportement à l’exécution.

## Construire plusieurs notes liées

Un parcours de lecture (accueil, articles, fiches) se prépare en plusieurs
propositions. `okb ingest … --after prepared` laisse une proposition s’appuyer
sur les notes que d’autres propositions en attente vont créer : liens et fiches
concepts sont résolus et la proposition le signale. `okb combine <id> <id>…`
les fusionne ensuite en une proposition unique : un diff, une approbation, un
reçu, un retour arrière. Appliquée seule et trop tôt, une proposition dépendante
est refusée par le contrôle des liens cassés ; rien n’est écrit.

## Réviser le style d’une note

`okb revise <note> --file <brouillon> --reason "…"` prépare le remplacement
d’une seule note. Citations, code, définitions et références de notes de bas de
page doivent rester identiques ; le frontmatter n’accepte que `title`,
`description` et `tags`. Revue, approbation et retour arrière sont les mêmes que
pour un import. Voir [STYLE.md](STYLE.md).

## Concepts et refus partiels

Les nouvelles définitions demandent des extraits source. Les acronymes inconnus
sont des candidats à clarifier et ne créent pas de fichiers vides. Les définitions
existantes et alias sont réutilisés ; un domaine peut désambiguïser un terme.

Le texte rédigé de l’article reçoit des liens par section. Les extraits bruts,
le code, les citations et les liens existants sont protégés. Chaque insertion est
un changement distinct : refuser une fiche enlève ses insertions sans effacer
les liens vers les autres concepts. Refuser un article neuf enlève les insertions
qui dépendent de sa création. Les migrations de fichiers sont indivisibles.

Un import identique dans la même cible est un no-op fondé sur le hash source,
même si la prose générée varie. `--reprocess` sert à une reprise volontaire et peut
proposer un nouvel ajout ; inspecter le diff pour éviter des sections redondantes.
Une nouvelle révision de source est différente et doit conserver la visibilité
des divergences avec la KB existante.

## Capturer, trier, revoir

Capturer ne coûte rien, décider reste délibéré. `okb capture "texte"` (ou
`--from-file`, `--title`, `--source`, `--tag`) range une capture dans l'**inbox
privée** du profil (`<état>/inbox/`), hors de la KB : ce n'est pas encore une
connaissance. La skill `okb-inbox` propose ensuite, élément par élément, une
destination (compléter une note, nouvelle note avec son modèle, fiche concept,
abandon) ; seul `okb ingest` crée une proposition, approuvée par l'utilisateur.
`okb inbox done <id> --proposal <p>` ou `okb inbox drop <id> --reason …` déplace
l'élément dans `done/` ou `dropped/` : rien n'est supprimé.

`okb weekly [--days 7]` prépare la revue hebdomadaire sans rien écrire : captures
en attente (signalées à partir de 21 jours), propositions non relues (anciennes
après 7 jours), notes appliquées pendant la période, notes **à relire** parce
qu'elles ont été créées il y a 1, 7, 30 ou 90 jours (relire au bon moment fixe la
mémoire), et synthèse de `okb maintain`. La skill `okb-weekly` déroule ce rituel ;
`okb-learn` pose des questions courtes sur une note et corrige en montrant le
passage cité, sans rien écrire par défaut.

## Focus du moment et fin de session

La **note de focus** dit à Claude sur quoi tu travailles maintenant : 3 à 8 lignes
(ce que tu fais, ce que tu veux apprendre, la prochaine échéance, ce que Claude doit
savoir). `okb focus init` la crée avec son mode d'emploi ; `okb focus` l'affiche avec
son âge ; `okb focus set "…"` (ou `--from-file`) la remplace en gardant l'ancienne
version dans l'état du profil. Par défaut elle vit dans l'état du profil ;
`focus.file` peut la placer ailleurs, par exemple à la racine d'un coffre Obsidian,
et plusieurs profils peuvent la partager.

En fin de session, `/okb:done` (skill `okb-focus`) relit la conversation et appelle
`okb done` : une entrée dans le **journal des sessions** (un fichier par mois :
résumé, fait, décidé, prochaine fois) et une capture d'inbox par connaissance à
garder (`--keep`). Rien n'entre dans la KB : les captures suivent le tri habituel.

Au démarrage d'une session, le hook `SessionStart` du plugin donne à Claude la note
de focus et la dernière « prochaine fois » (`okb focus --context`). C'est ainsi que
la session suivante reprend là où l'autre s'est arrêtée. `okb weekly` demande si le
focus est encore juste après `focus.staleDays` jours (14 par défaut).

## Des process aux skills

`okb skillify <note>` transforme une note `procedure`, `process` ou `automation` en
brouillon de skill Claude Code : ses sections deviennent « Quand l'utiliser »,
« Avant de commencer », des étapes numérotées, « Vérifier le résultat » et « Si ça
ne marche pas », et le brouillon cite la note. Sans `--out`, il s'affiche
seulement ; `--out <projet>/.claude/skills` écrit `<nom>/SKILL.md`. La skill
`okb-skillify` le relit ensuite avec toi, une question à la fois (déclencheur, cas
où ne pas l'utiliser, chaque étape, contrôle final), puis le fait tester sur un cas
réel.

## Historique Git d'une KB

Si la KB est un dépôt Git, `git.autoCommit: true` dans le profil fait de chaque
`okb apply` (et de chaque `--rollback`) un commit qui ne contient que les fichiers du
reçu. Le message cite la proposition et le reçu. Rien n'est poussé : `git push`
reste ton geste. Un `README.md` destiné à GitHub se place dans `.github/` : OKB
ignore les dossiers cachés.

## Lire et entretenir

`okb ask "question" --json` retourne des passages, chemins, lignes réelles,
statuts et niveaux de confiance. Claude formule la réponse avec ces références.
S’il ne trouve pas, il reformule/recherche puis indique la limite ; il ne complète
pas la KB à partir de sa propre réponse.

`okb maintain`, `okb links check` auditent. `okb nav`, `okb links move` et
`okb migrate portable-links` retournent des identifiants de propositions. Un index
personnalisé peut être remplacé par la navigation générée : cette perte potentielle
est visible dans le diff et l’ancienne version reste dans la sauvegarde après apply.

`okb maintain --check-sources` ajoute une comparaison des empreintes des sources
locales déjà ingérées. `SOURCE_CHANGED` signale des octets différents,
`SOURCE_MISSING` un fichier absent, `SOURCE_FRESHNESS_UNKNOWN` un contrôle
impossible (métadonnées absentes/ambiguës, source distante, symlink, taille ou
instabilité). Aucune connexion réseau, copie ou mise à jour des notes. Une
empreinte identique ne prouve pas que les connaissances restent vraies. Une
source secondaire doit disposer de son extraction enregistrée ou d’une archive
pour être retrouvée. Sans `--check-sources`, les fichiers d’origine ne sont pas lus.

`okb serve` ouvre l’application web locale : tout ce que fait le terminal
(lire, chercher, relire, approuver, appliquer, annuler, capturer, focus, fin de
session, revue, réglages, KB). Approuver depuis la page exige la présence de la
personne (dialogue natif macOS ou question dans le terminal de `okb serve`) ;
sinon la page affiche la commande à lancer soi-même. Voir [WEB-APP.md](WEB-APP.md).

## Reprendre ou annuler

`okb apply <id> --resume` reprend uniquement le même contenu et la même sélection.
`okb apply --rollback rcpt-<id>` annule aussi une application interrompue, grâce au
reçu écrit avant la première mutation. Si un humain a modifié un fichier depuis,
l’annulation s’arrête avant d’écraser ce travail. Après rollback, recréer une
proposition : l’ancienne autorisation est supprimée.

La reprise recontrôle également le résultat prévu sur la KB courante : une cible
de lien supprimée pendant l’interruption bloque les écritures restantes.
`okb review <id> --discard` écarte une proposition préparée et retire sa signature
éventuelle. Une proposition écartée ne peut plus être approuvée ou appliquée.
