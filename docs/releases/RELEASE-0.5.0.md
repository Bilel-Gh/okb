# Version 0.5.0

Cette version rend OKB agréable à installer et à utiliser au quotidien, sans
connaître ses commandes : un assistant d’installation, un menu, des messages
clairs en français ou en anglais, une application web complète, et un plugin
Claude qui comprend les demandes en langage naturel.

## Installation et configuration

- **`./scripts/install.sh`** : vérifie Node, compile OKB dans son dossier, puis lance
  l’assistant. Aucun réglage Claude ou shell n’est modifié.
- **`okb init`** et **`okb new`** : une question à la fois, réponse recommandée (★),
  récapitulatif avant d’écrire. Nom, dossier, langues, style, aide aux notions,
  focus, Git, dépôt GitHub privé (désactivé par défaut), plugin Claude, commande `okb`.
  `--yes` accepte les recommandations.
- **`okb settings`** : tous les réglages, en menu ou en une ligne
  (`okb settings set clé=valeur` ou `okb settings set clé valeur`) ; les
  commentaires des fichiers YAML sont conservés.
- **`okb kb`** : lister, changer, archiver, adopter une KB. **`okb doctor --fix`**
  répare plugin, commande `okb`, marqueur de propriété et focus. **`okb update`**
  met à jour moteur et plugin.

## Au quotidien

- **`okb`** seul : ce qui t’attend et les actions utiles, en menu.
- **`okb review`** : propositions numérotées (`okb review 1`), changements fichier
  par fichier, sélection, puis « Approuver et appliquer » en une étape.
- **`okb undo`** : annule exactement le dernier changement appliqué.
- **`okb tour`** : visite guidée de 2 minutes sur une KB jetable.
- **`okb explain <code>`**, **`okb glossary`**, **`okb help <commande>`** avec exemples,
  **`okb completion zsh|bash`**.
- Couleurs, tableaux, liens cliquables dans le terminal ; `NO_COLOR` respecté.

## Langues

- **Interface** en français ou en anglais (`ui.language`, automatique par défaut).
- **Rédaction des notes** par KB (`writing.language`) : français, anglais, espagnol,
  allemand, italien, portugais.
- Chaque erreur dit ce qui s’est passé, pourquoi, et quoi faire.

## Claude Code

- **Langage naturel** : « ok fin de session », « lis ce transcript », « note ça : … »,
  « que dit ma KB sur … » — OKB reconnaît la demande et propose la commande adaptée,
  avec un bouton. Rien ne se lance sans ton clic ; `routing.suggest: false` coupe.
- **Cohabitation** : OKB n’écrit que dans ses KB (marqueur `.okb/owner.yaml`), ne se
  propose pas pour la KB d’un autre outil (agent support, wiki, serveur MCP) et
  demande laquelle tu vises en cas de doute (`routing.otherKnowledgeTools`).
- **Interface** : entrée dans la barre d’état, commande `/okb` (panneau), notification
  quand une proposition attend ; nouvelle skill `okb-guide` ; choix par boutons dans
  toutes les skills.
- Le hook d’approbation refuse aussi l’approbation via l’API web, les clics scriptés
  sur le dialogue de confirmation et les pseudo-terminaux autour de `okb review`.

## Application web

`okb serve` ouvre une application locale qui fait tout ce que fait le terminal :
accueil, lecture des notes (tableaux, Mermaid, encadrés, notes de bas de page,
rétroliens, sommaire), recherche et palette ⌘K, relecture et approbation,
historique et annulation, inbox, focus et fin de session, revue de la semaine,
cartes de révision, santé, sources, procédures → skills, modèles et style,
diagnostic, aide, réglages, KB et assistant de création. Thèmes clair et sombre,
lisible sur téléphone, accessible au clavier.

Approuver depuis la page demande une confirmation sur l’écran de la personne
(dialogue macOS) ou dans le terminal de `okb serve` ; sinon la page affiche la
commande. Les réglages s’appliquent sans redémarrer.

## Documentation

Guide utilisateur en français dans `docs/guide/` (installer, au quotidien,
application web, réglages, dépannage) ; documentation technique déplacée dans
`docs/dev/`, notes de version dans `docs/releases/`.

## Mise à jour depuis 0.4.0

Les profils, KB, propositions et reçus existants restent valides.

```bash
cd /chemin/du/produit && git pull && npm ci && npm run build
claude plugin uninstall okb@okb && claude plugin install okb@okb
okb doctor --fix
```

Ouvre ensuite une nouvelle session Claude. `okb doctor --fix` propose d’ajouter le
marqueur de propriété aux KB créées avant 0.5.0 (sinon il est ajouté à la première
application d’une proposition, si toutes les notes viennent d’OKB). Les nouvelles
notes portent `generated.by: okb/0.5`.

Voir [DECISIONS.md](../dev/DECISIONS.md), D21 à D27.
