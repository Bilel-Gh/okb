# Installation, mise à jour et profils

## Installation propre

Node 22.13+ et npm sont nécessaires. Le plugin vise Claude Code ; le fichier de
manifest peut être vérifié avec `claude plugin validate ./plugin`. Le chargement
local utilise `claude --plugin-dir "$PWD/plugin"`. Les évaluations natives livrées
nécessitent une version qui expose `claude plugin eval` (voir EVALUATION.md).

```bash
npm ci
npm run release:check
npm link
```

`npm link` n’est nécessaire que pour taper `okb` dans ton terminal : quand le
plugin est chargé, son `bin/okb` est sur le PATH de l’outil Bash de Claude.
`npm ci` utilise le verrouillage du dépôt. `npm pack` fabrique un paquet compilé
installable via `npm install -g /chemin/okb-0.3.0.tgz`. Le plugin reste dans ce paquet ;
avec une installation globale, son emplacement est `$(npm root -g)/okb/plugin`.
Les chemins du plugin n’assument jamais l’emplacement de ta KB.

Le test d’installation utilise un corpus fictif dans un dossier temporaire.
Pour configurer ton propre dossier, qui doit exister :

```bash
okb setup --profile moi --kb-root /chemin/vers/notes --concept-assist targeted \
  --human-actor human:moi --answer-language fr --locale fr-FR
okb doctor --profile moi
```

Ou copier [onboarding.yaml](../../examples/onboarding.yaml), le compléter hors du
dépôt et utiliser `okb setup --from /chemin/prive/onboarding.yaml`.
Les options explicites priment sur ce fichier. Le niveau d’aide aux concepts est
obligatoire au premier setup. La skill le demande une fois si aucun choix n’a été
fourni, sans redemander les paramètres connus.

## Installer sur un nouveau poste

Sur un poste professionnel ou celui d’un collègue, sans rien changer aux réglages
globaux de Claude :

1. Copier le dossier du produit sans `node_modules/`, ou le paquet
   `okb-<version>.tgz` produit par `npm pack`.
2. Dans le dossier : `npm ci` puis `npm run release:check` (accès au registre npm
   nécessaire). Avec le paquet : `npm install -g okb-<version>.tgz`.
3. Créer le profil à partir d’un fichier d’onboarding privé :
   `okb setup --from /chemin/prive/onboarding.yaml`, puis `okb doctor`,
   `okb style` et `okb template list` pour vérifier ce qui est actif.
4. KB existante : `okb maintain` et `okb links check` d’abord, en lecture seule.
   Les anomalies préexistantes se traitent par des propositions, jamais en masse.
5. Claude : `claude --plugin-dir /chemin/du/produit/plugin`, puis `/okb:doctor`.
   `okb` doit répondre dans le terminal de Claude (via `plugin/bin/okb`).
6. Mesurer le comportement réel : `claude plugin eval ./plugin --no-publish`
   (consomme le quota) et `/context` avec et sans le plugin.
7. Obsidian : « Ouvrir un dossier comme coffre » sur `kb.root`. Le dossier
   `.obsidian/` qu’il crée est exclu par défaut.

## Préférences et politiques

`OKB_HOME` vaut `~/.okb` par défaut. Les profils sont sous `profiles/<id>/`.
`okb setup switch <id>` change le profil actif ; `--profile` choisit celui d’une
commande et prime sur `OKB_PROFILE`. Refaire setup conserve les valeurs non
remplacées et les clés personnalisées ; le YAML du profil peut être reformaté.

Les couches sont defaults → org → team → profil → KB-local → environnement → flags.
`orgConfig` et `teamConfig` peuvent désigner des fichiers privés ; les variables
`OKB_ORG_CONFIG` et `OKB_TEAM_CONFIG` permettent de les fournir sans toucher le profil.
Un fichier déclaré absent bloque la configuration au lieu d’effacer la politique.
Une KB-local `.okb/kb.yaml` ne peut pas rediriger la racine, l’identité ou l’état.
Les politiques de toutes les couches s’intersectent ; les exclusions s’additionnent.

Exemples génériques : [org-policy.yaml](../../examples/org-policy.yaml) et
[team.yaml](../../examples/team.yaml). `okb config show --json` indique les couches,
valeurs effectives, restrictions appliquées et clés inconnues conservées mais inactives.
`okb config show --defaults` présente le schéma complet ; ce n’est pas le format
simplifié de `setup --from`.

Le style de rédaction (`writing`) et le niveau du lecteur (`reader`) se règlent
avec `--writing-preset` ou les clés `writing:`/`reader:` d’un fichier d’onboarding,
puis dans le profil. `okb style` affiche le brief effectif. Voir [STYLE.md](STYLE.md).

Pour les concepts, modifier `conceptAssist.level`, `byDomain`, `known`, `deepen`,
`fundamentals`, `stoplist` et les limites dans le profil. Une désactivation ne
supprime pas les anciennes fiches ou les liens existants. Le choix ponctuel
`--concept-assist off` n’affecte que cet import.

## Mise à jour depuis 0.1

Conserver une copie de la KB et du dossier d’état avant le changement de version.
Installer le nouveau code puis refaire `doctor` ; ne pas réinitialiser le profil.
Cette version corrige le contrat de hash et les reçus : **les anciennes propositions
et approbations doivent être recréées**, elles ne sont pas réautorisées implicitement.
Les anciens reçus/sauvegardes sont conservés, mais leur restauration automatique
n’est pas compatible avec le nouveau moteur. Une ancienne opération interrompue
exige une inspection des fichiers et sauvegardes avant toute reprise.

`nav`, `links move` et `migrate portable-links` préparent désormais des propositions.
L’ancien `--write` ne les applique pas directement. `--section-file` est remplacé
par `--analysis-file`, qui porte couverture et preuves. Voir WORKFLOWS.md.

## Désinstaller

Retirer le chargement du plugin de Claude puis `npm uninstall -g okb` (ou
`npm unlink -g okb` pour une installation liée). Cela retire le produit, pas les
profils, l’état ni la KB. Ne pas supprimer l’état si tu veux garder le rollback.
Le produit ne crée ni dépôt, ni remote, ni commit, ni push.

## Installer le plugin dans l'application Claude

`--plugin-dir` charge le plugin pour une session de terminal seulement. Pour l'avoir dans
toutes les sessions, y compris l'application de bureau, ce dossier sert de catalogue local
(`.claude-plugin/marketplace.json`) :

```bash
claude plugin marketplace add /chemin/du/produit
claude plugin install okb@okb
```

Claude Code copie alors le plugin dans son cache, sans le dossier `dist/` du produit. Le
script `plugin/bin/okb` cherche donc le moteur dans cet ordre : `dist/` voisin, `$OKB_CLI`,
`~/.okb/bin/okb`, puis un `okb` sur le PATH. Crée le lanceur une fois :

```bash
mkdir -p ~/.okb/bin && printf '#!/bin/sh\nexec node /chemin/du/produit/dist/cli/index.js "$@"\n' > ~/.okb/bin/okb && chmod +x ~/.okb/bin/okb
```

Après une modification du plugin à version égale : `claude plugin uninstall okb@okb`
puis `claude plugin install okb@okb`. Une nouvelle session est nécessaire pour la
charger. Les deux hooks du plugin s'appliquent alors à toutes tes sessions Claude Code :
l'un bloque seulement l'approbation de propositions par l'agent ; l'autre, au démarrage
d'une session, donne à Claude ta note de focus et la dernière « prochaine fois » du journal
(il ne dit rien tant qu'aucun focus ni journal n'existe ; `focus.sessionStart: false` dans
le profil le coupe). `okb profile` dit quel profil et quelle
KB les commandes utilisent ; chaque skill l'affiche en tête de sa première réponse.
