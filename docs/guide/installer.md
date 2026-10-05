# Installer OKB

Il te faut **Node.js 22.12 ou plus récent** (`node --version`), et de préférence
[Claude Code](https://code.claude.com) et [Obsidian](https://obsidian.md).

## En une commande

Depuis le dossier d’OKB :

```bash
./scripts/install.sh
```

Le script vérifie Node, installe et compile OKB **dans ce dossier seulement**,
puis lance l’assistant `okb init`. **Aucune KB n’est connectée d’office.**
L’assistant te demande par quoi commencer :

- **créer une nouvelle KB** : tu lui donnes un nom (rien n’est pré-rempli), puis
  son dossier, les langues, le style, l’historique Git ;
- **connecter un dossier de notes existant** (une ancienne KB, un coffre
  Obsidian) : voir [Plusieurs KB](reglages.md#plusieurs-kb) ;
- **plus tard** : OKB est installé, sans KB.

Il propose enfin le plugin Claude Code et une commande `okb` utilisable partout.
Tant qu’aucune KB n’est connectée, OKB l’affiche là où apparaît d’habitude le
nom de la KB : barre d’état de Claude Code, application web, menu `okb`.

Rien n’est installé hors du dossier d’OKB sans ton « oui ». Tes réglages Claude et
tes fichiers de shell ne sont jamais modifiés. Aucun nom de personne n’est lu
(ni Git, ni compte de l’ordinateur) : tes approbations sont signées `human:me`.

Sans question : `./scripts/install.sh --yes` installe OKB sans créer de KB.
Si OKB est déjà configuré, le script propose les réparations utiles (commande
`okb`, plugin).

## À la main

```bash
npm ci
npm run build
node dist/cli/index.js init
```

## Ensuite

```bash
okb            # le menu : ce qui t’attend, et les actions utiles
okb tour       # une visite guidée de 2 minutes, sur une KB jetable
okb serve      # l’application web
okb doctor     # tout vérifier ; okb doctor --fix répare ce qui peut l’être
```

Dans Claude, tape `/okb` ou demande simplement « aide-moi avec OKB ».

## Mettre à jour

```bash
okb update
```

Récupère la dernière version avec `git pull` (OKB installé depuis le dépôt Git),
réinstalle, recompile et met à jour le plugin Claude. Tes profils, tes KB et ton
historique sont conservés. Il faut pouvoir lire le dépôt : sans accès, `okb
update` le dit et indique la solution ci-dessous.

## Partager OKB sans accès au dépôt

Le dépôt d’OKB peut être privé. Pour l’installer chez quelqu’un qui n’y a pas
accès, partage un **paquet** :

1. Chez toi, dans le dossier d’OKB, crée le paquet `okb-x.y.z.tgz` :

```bash
npm pack
```

2. Chez la personne, avec le fichier reçu :

```bash
npm install -g okb-0.8.0.tgz
```

```bash
okb init
```

3. Pour une nouvelle version, avec le nouveau fichier :

```bash
okb update --from okb-0.9.0.tgz
```

`okb update --from` accepte aussi un dossier qui contient une copie d’OKB. Il
remplace les fichiers d’OKB, réinstalle ses dépendances et met le plugin à jour.
Les profils et les KB ne sont jamais touchés.

## Ajouter le plugin Claude plus tard

Si tu as répondu non pendant l’installation :

```bash
okb doctor --fix
```

ou, à la main, depuis le dossier d’OKB :

```bash
claude plugin marketplace add "$PWD"
claude plugin install okb@okb
```

Ouvre ensuite une nouvelle session Claude.

## Désinstaller

```bash
claude plugin uninstall okb@okb
```

puis supprime le dossier d’OKB et, si tu l’avais créée, la commande `okb`
indiquée par `okb doctor`. Tes notes ne sont pas touchées ; tes réglages et ton
historique restent dans `~/.okb` (supprime-le seulement si tu ne veux plus pouvoir
annuler d’anciens changements).
