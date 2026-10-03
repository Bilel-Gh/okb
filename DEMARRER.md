# Reprendre le projet

Cette version fournit les fondations et les workflows exécutables. Elle ne touche
pas à ta KB pendant l’installation. Commence par la démonstration fictive ; tu
n’as pas besoin de donner un vrai transcript pour vérifier le système.

## 1. Installer et vérifier

Dans le dossier du projet, avec Node 22.12 ou plus récent :

```bash
npm ci
npm run release:check
npm link
okb version
claude plugin validate ./plugin
```

`release:check` crée son propre dossier temporaire, installe le paquet compilé,
teste un import fictif, puis annule l’import et nettoie ce dossier. Il ne lit pas
ta KB. Il nécessite l’accès au registre npm pour l’installation du paquet.

## 2. Relier ton profil privé

Si ton profil existe déjà, garde-le et commence par `okb config show --profile <id>`.
La mise à jour du code ne remplace pas les profils. Pour un nouveau profil :

```bash
okb setup --profile moi --kb-root /chemin/vers/ma-kb --concept-assist targeted \
  --answer-language fr --locale fr-FR --human-actor human:moi
okb doctor --profile moi
```

Ajoute `--writing-preset pedagogique` (ou `standard`, `expert`) pour choisir le
style des articles, puis `okb style` pour lire le brief que Claude suivra.
Remplace les chemins et identifiants. Tu peux choisir `off` pour désactiver l’aide
aux concepts, `targeted` pour le vocabulaire utile au sujet, ou `pedagogical` pour
ajouter les notions fondamentales. Ce choix reste modifiable, notamment par domaine.
La configuration contient des données personnelles : garde-la hors du dépôt du
produit. Aucun dépôt distant n’est créé et rien n’est poussé sur Git.

Pour consulter tes notes et les propositions dans le navigateur :

```bash
okb serve --profile moi
```

Ouvre l’adresse locale affichée, puis « À relire » pour lire les contenus proposés
avant leur intégration. Les signatures restent dans ton terminal. Voir
[le lecteur local](docs/LOCAL-READER.md).

## 3. Charger Claude

Depuis ce dossier :

```bash
claude --plugin-dir "$PWD/plugin"
```

Vérifie les commandes `/okb:doctor`, `/okb:setup`, `/okb:ingest`, `/okb:ask`,
`/okb:review`, `/okb:apply`, `/okb:maintain` et `/okb:revise`. Le CLI `okb` doit être accessible
depuis le terminal de Claude. Les skills sont sélectionnés par leurs descriptions ;
les commandes sont des raccourcis explicites.

## 4. Valider le comportement de Claude

Le code peut être testé ici ; ton fournisseur de modèle, tes autorisations et tes
MCP nécessitent une validation dans ton environnement. Le protocole et les cas
fictifs sont prêts dans [EVALUATION.md](docs/EVALUATION.md). Lancer les évaluations
appelle réellement ton modèle et consomme les quotas de ton compte.

Ensuite, tu pourras demander simplement : « Enrichis ma KB avec ce transcript ».
Claude prépare une synthèse sourcée et une proposition. Tu lis le diff, choisis
ce qui te sert, puis autorises cette sélection. Les liens vers les concepts sont
optionnels ; les acronymes sans définition fiable restent à clarifier.

Pour comprendre le projet sans tout lire : commence par le dossier d’analyse,
puis le contrat de proposition, puis l’application transactionnelle. Les tests de
régression illustrent les situations où chaque frontière évite une perte de données.

## Si plusieurs versions de Node sont installées

`node --version` dans le terminal et le Node lancé par npm peuvent différer.
En cas d’erreur comme `node:util ... styleText`, vérifier le runtime des scripts :

```bash
npm exec -- node --version
```

Sélectionner Node 22.12+ avec le gestionnaire déjà installé et vérifier à nouveau.
Avec nvm, `nvm use 24` agit sur le terminal courant si cette version est présente.
La commande `doctor` vérifie le processus qui exécute OKB, pas tous les Node de la
machine. Aucun changement global Claude ou MCP n’est nécessaire.
