# Utilisation, coûts et rapport d'amélioration

OKB te montre ce qu'il coûte et si son travail te convient, pour qu'on puisse
l'améliorer au fil de l'usage. Tout est lu **sur ton ordinateur**. Voir ces
chiffres ne dépense **aucun token** : aucun modèle n'est appelé.

## Ce qu'OKB mesure

| | D'où ça vient | Ce que tu y vois |
|---|---|---|
| **Coût** | les journaux que Claude Code garde déjà (`~/.claude/projects`) | ce que coûte chaque tâche OKB : import d'une source, onboarding d'un repo, question… |
| **Contexte** | les mêmes journaux | ce qu'OKB fait lire à Claude : instructions des skills, sorties des commandes `okb`, contexte de début de session |
| **Qualité** | tes propositions et leurs reçus | les propositions appliquées, les changements écartés à la relecture, les notes retouchées à la main ensuite |
| **Commandes** | une ligne par commande `okb` (sans ses arguments) | les commandes qui échouent ou qui traînent |
| **Tes retours** | `okb feedback` ou le bouton de l'application web | ce qui t'a gêné, au moment où tu le vis |

Une **tâche OKB**, c'est ce qui se passe entre un de tes messages à Claude et le
suivant, quand Claude utilise OKB : un skill (`/okb:ingest`…), ses sous-agents et
les commandes `okb`. Le reste de ton usage de Claude Code est compté à part, pour
comparer. Le travail sur le code d'OKB lui-même n'est pas compté.

**Le coût est un équivalent API.** Avec un abonnement Claude, tu ne paies pas au
token : le chiffre dit ce que le même travail coûterait avec l'API. Il sert à
comparer les tâches et les réglages, pas à te facturer. Les prix publics sont
datés dans chaque écran.

## Où le voir

- **Application web**, page **Utilisation** (`okb serve`) :
  - les chiffres clés ;
  - le coût par jour ;
  - le coût par tâche, par modèle et par sous-agent ;
  - ce qui remplit le contexte ;
  - la qualité par KB et les commandes ;
  - les pistes d'amélioration.
- **Terminal** :

```bash
okb usage
```

```bash
okb usage --days 7
```

- **Dans Claude** : « combien me coûte OKB ? » ; Claude propose `okb usage`.

## Le rapport, pour améliorer OKB

```bash
okb report
```

Il écrit une page Markdown dans `~/.okb/usage/reports/` avec :
- le coût ;
- le contexte ;
- la qualité ;
- les erreurs ;
- tes retours ;
- les pistes d'amélioration.

Il ne contient **aucun texte de tes notes ni de tes sources** : seulement des
chiffres, des noms de commandes et l'identifiant de tes KB. Ajoute
`--with-paths` pour y inclure le chemin des notes retouchées à la main.

Donne-le à Claude dans le dossier d'OKB : « Voici mon rapport d'usage, propose
des améliorations. » Dans l'application web, le bouton **Afficher et copier le
rapport** fait la même chose.

## Noter un retour

Quand quelque chose te gêne, note-le tout de suite :

```bash
okb feedback "le résumé a oublié la décision sur les relances"
```

Ou dis-le à Claude : « note un retour sur OKB : … ». Ou utilise le cadre
**Signaler un problème ou une idée** de la page Utilisation. Les retours vont
dans le prochain rapport.

## Les pistes d'amélioration

OKB les tire des chiffres, sans modèle :

- un sous-agent sur un modèle très cher alors qu'il pèse lourd ;
- une commande dont la sortie remplit le contexte ;
- un cache rarement utilisé (de longues pauses au milieu d'une tâche) ;
- une tâche qui a coûté bien plus que d'habitude ;
- beaucoup de changements écartés à la relecture, ou de notes retouchées à la
  main : OKB n'écrit pas encore ce que tu attends ;
- des propositions qui attendent longtemps : la relecture est trop lourde.

## Ce qui reste privé

- Rien n'est envoyé : OKB lit des fichiers locaux.
- Le journal des commandes ne garde jamais leurs arguments (une capture ou un
  chemin peut être privé).
- Pour couper ce journal :

```bash
export OKB_NO_EVENTS=1
```
