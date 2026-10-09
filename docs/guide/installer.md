# Installer OKB

Il te faut **Node.js 22.12 ou plus récent** (`node --version`) et
[Claude Code](https://code.claude.com). [Obsidian](https://obsidian.md) est
facultatif : l'application web d'OKB lit et cherche tes notes.

## Le chemin le plus simple : par Claude (version 1)

Dans Claude Code :

1. ajoute la marketplace d'OKB (`/plugin marketplace add <adresse du dépôt OKB>`) ;
2. installe le plugin `okb`, et le module `okb-dev` si tu travailles sur du code ;
3. dis « configure OKB pour moi ».

Claude installe le moteur OKB s'il manque (après ton oui), regarde tes dossiers,
te recommande un ou plusieurs cerveaux (travail, projets perso, sujets à
apprendre, carrière), pose **au plus trois questions**, te montre l'aperçu, puis
crée tout. Aucune commande à taper dans un terminal.

## Depuis un terminal

Depuis le dossier d’OKB :

```bash
./scripts/install.sh
```

Le script vérifie Node, installe et compile OKB **dans ce dossier seulement**,
puis lance l’assistant `okb init`. **Aucune KB n’est connectée d’office.**
L’assistant te demande par quoi commencer :

- **créer une nouvelle KB** : tu lui donnes un nom (rien n’est pré-rempli), puis
  son type (un sujet, un repo de code, les repos d'une équipe), son dossier, les
  langues, le style ;
- **connecter un dossier de notes existant** (une ancienne KB, un coffre
  Obsidian) : voir [Plusieurs KB](reglages.md#plusieurs-kb) ;
- **plus tard** : OKB est installé, sans KB.

Il propose enfin le plugin Claude Code et une commande `okb` utilisable partout.
Tant qu’aucune KB n’est connectée, OKB l’affiche là où apparaît d’habitude le
nom de la KB : barre d’état de Claude Code, application web, menu `okb`.

Rien n’est installé hors du dossier d’OKB sans ton « oui ». Tes réglages Claude et
tes fichiers de shell ne sont jamais modifiés. Aucun nom de personne n’est lu
(ni Git, ni compte de l’ordinateur) : tes approbations sont signées `human:me`.

### Le plus simple ensuite : laisser OKB s'installer pour toi

Dans Claude Code, ouvert dans ton dossier de travail ou dans un repo, dis
« configure OKB pour moi » (ou tape `/okb:setup`). Dans un terminal :
`okb start`. OKB, sans IA et sans rien écrire :
- regarde les dossiers autour : un repo seul, un dossier de repos (jusqu'à deux
  niveaux), une ancienne KB, tes KB existantes, le plugin ;
- te montre ce qu'il a trouvé, dossier par dossier, et te recommande une
  organisation, avec la raison ;
- te propose un plan précis, les commandes exactes, et le lance après ton
  accord.

Si un espace de travail existe déjà, il vérifie que tous les repos du dossier y
sont, et propose d'ajouter ceux qui manquent.

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
okb update --from okb-1.5.0.tgz
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
