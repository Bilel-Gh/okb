# Modèles de notes

Un **modèle** fixe les sections d’un type de note, leur ordre, leur titre et ce
qu’on y met. Le **style** décide comment la prose est écrite à l’intérieur. Avec
les deux, toutes les notes d’un même type se ressemblent : on y retrouve ses
repères en quelques secondes, même après des centaines d’ajouts.

```bash
okb template list                    # les modèles disponibles
okb template show experience         # sections, ordre, consignes
okb template show concept --skeleton # squelette Markdown pour écrire à la main
```

## Les modèles fournis

| Modèle | Pour | Sections (obligatoires en gras) |
|---|---|---|
| `guide` | comprendre un système, un flux, un mécanisme | **🎯 À quoi ça sert**, **🔍 Comment ça marche**, 💡 Exemple concret, 🗂️ Où regarder, 🚧 Limites et pièges |
| `concept` | une notion en une minute (fiches de `concepts/`) | **🎯 En une phrase**, 🧭 Pour se le représenter, 🔍 Comment ça marche, 💡 Exemple, 🗺️ Schéma, ⚠️ À ne pas confondre, **📌 Ce que dit la source** |
| `procedure` | refaire une tâche pas à pas | **🎯 Quand l’utiliser**, ✅ Avant de commencer, **🪜 Étapes**, 🔎 Vérifier le résultat, 🧯 Si ça ne marche pas |
| `process` | une activité qui revient : la décrire, la prioriser, la déléguer | **🎯 Livrable produit**, **🔁 Fréquence et déclencheur**, 🧑‍💼 Qui s’en occupe, 📥 Entrées, **🪜 Étapes**, 🧰 Outils, ⚖️ Priorité : temps, pénibilité, impact, 🤖 Ce que l’IA peut en faire |
| `tool` | une fiche par outil utilisé ou évalué | **🎯 À quoi il sert**, ✅ Quand le choisir, 🔌 Accès et connexion, **🛠️ Utilisation courante**, 💶 Coûts et limites, 🔐 Données et confidentialité, 🔁 Alternatives |
| `automation` | un flux qui tourne seul (tâche planifiée, webhook, agent) | **🎯 Ce qu’elle fait**, **⏰ Déclencheur**, **🔀 Déroulé**, 🧰 Outils et accès, 🔎 Surveiller et vérifier, 🧯 En cas de panne, 🧑‍💼 Responsable et revue |
| `experience` | un incident résolu, réutilisable | **🧩 Contexte**, 🚨 Symptômes, 🔍 Diagnostic, 🚫 Pistes écartées, **✅ Résolution**, **💡 À retenir**, 🎯 Quand réutiliser ce retour |
| `decision` | un choix et ses raisons | **🧭 Contexte**, ⚖️ Options envisagées, **✅ Décision**, 📌 Conséquences, 🔁 Quand y revenir |
| `meeting` | un transcript, une démo, un transfert de connaissances | **🎯 L’essentiel**, ✅ Décisions, 📋 Actions, 🗂️ Sujets abordés |
| `tutorial` | apprendre à faire une chose la première fois | **🎯 Ce que tu sauras faire**, ✅ Avant de commencer, **🪜 Pas à pas**, ✔️ Vérifier que ça marche, 🧰 Si ça coince, 🧭 Pour aller plus loin |
| `client-case` | un client, un projet, une mission | **🏢 Le client et son contexte**, **🎯 Le besoin**, **🛠️ Ce qui a été fait**, 📈 Résultats, **💡 À retenir**, ♻️ Quand s’en resservir |
| `path` | un parcours de lecture vers d’autres notes | **🎯 Pour qui, pour quoi**, **🧭 Les étapes**, ✔️ Tu as compris si…, ➡️ Ensuite |

S’y ajoutent les sept modèles des repos de code (`repo-*`, voir [REPOS.md](REPOS.md)).
Chaque modèle place ses notes dans une **catégorie** (couleur du graphe, filtres) :
voir [le guide](../guide/graphe-et-categories.md). Un modèle propre à une KB peut
déclarer `category: <id>`.

Le produit ajoute toujours, quand il y a lieu : l’avertissement de provenance,
« À lire avant », « Corrections et exceptions », « Questions ouvertes », « Pour
aller plus loin » et les notes de bas de page.

## Comment un modèle s’applique

Dans le dossier d’analyse v2 :

```json
{
  "version": 2,
  "template": "experience",
  "sections": [
    { "role": "context", "claims": [ … ] },
    { "heading": "Une précision utile", "claims": [ … ] },
    { "role": "resolution", "claims": [ … ], "aids": [ … ] },
    { "role": "lessons", "claims": [ … ] }
  ]
}
```

- Une **section de rôle** porte `role` et pas de `heading` : son titre vient du
  modèle, dans la langue du style, avec son émoji si le style en met.
- Une **section libre** porte `heading` et pas de `role` ; elle peut s’insérer
  n’importe où.
- Le CLI refuse un rôle obligatoire manquant, un rôle inconnu, un rôle répété ou
  hors de l’ordre du modèle, et un rôle qui impose son propre titre.
- `okb ingest … --template --note-template experience` crée un dossier prérempli
  avec une section vide par rôle.
- Avec `kb.requireTemplate: true`, toute nouvelle note doit suivre un modèle.
- La note créée porte `type` (celui du modèle) et `x_okb.template`.
  Le dossier conseillé ne déplace pas une note : `--create` choisit son chemin.
  `--type` est une dérogation explicite au type du modèle.

## Les fiches concepts

Une fiche est écrite dans le tableau `concepts` du dossier :

```json
{
  "term": "Sous-agent",
  "aliases": ["sous-agents", "subagent"],
  "definition": "assistant isolé, avec sa propre mémoire de travail, qui ne renvoie qu’un résumé",
  "evidence": [{ "blockId": "…", "quote": "…" }],
  "sections": [
    { "role": "how", "claims": [ … ] },
    { "role": "pitfalls", "claims": [ … ] }
  ],
  "aids": [
    { "type": "analogy", "text": "…", "limits": "…", "basedOn": ["definition"] },
    { "type": "example", "text": "…", "basedOn": ["…"] },
    { "type": "diagram", "mermaid": "flowchart LR …", "caption": "…", "basedOn": ["…"] }
  ],
  "seeAlso": ["concepts/skill.md"]
}
```

- `aliases` : pluriels, traductions, abréviations. Ils servent aux liens
  automatiques (« sous-agents » renvoie vers la fiche) et à la recherche (+10).
- `basedOn: ["definition"]` permet à une aide de reformuler la définition.
- Les identifiants des affirmations restent uniques dans tout le dossier ;
  `definition` est réservé dans les fiches. Omettre une section inutilisée :
  `claims: []` n’est pas une section de concept valide.
- Une aide suit les préférences du dossier : `analogies: off`, `diagrams: off`
  et `examples: none` empêchent respectivement ces aides. Une analogie et un
  schéma sans légende gardent eux aussi leurs références de preuves.
- Les titres suivent la langue du style : français, ou anglais pour les autres
  langues actuellement. Les émojis disparaissent avec `emojis: off`. Le texte
  des affirmations et des aides doit déjà être rédigé dans la langue souhaitée :
  le CLI n’effectue aucune traduction.
- Les fiches nouvelles se relient entre elles et aux fiches existantes ; un article
  reçoit un lien à la première mention de chaque fiche connue, sous son titre ou un
  alias.
- `seeAlso` accepte des chemins de notes `.md` relatifs à la racine de la KB.
  Le rendu écrit les liens relatifs depuis la fiche ; seules les cibles existantes
  ou présentes dans des propositions chargées avec `--after` sont incluses.
  Une fiche cite chaque document qui soutient sa définition ou ses affirmations.

## Adapter les modèles

Un fichier `<kb>/.okb/templates/<id>.yaml` remplace le modèle de même `id` (ou en
ajoute un) pour cette KB seulement : même structure que les modèles fournis
(`src/templates/builtin.ts`). C’est le moyen de traduire la charte d’une équipe.
Chaque commande recharge ces fichiers à la demande ; aucun modèle n’est ajouté
au contexte global de Claude. Le fichier est une configuration locale ; il ne
modifie ni les modèles fournis ni les notes déjà écrites.

Exemple fictif dans `.okb/templates/guide.yaml` :

```yaml
id: guide
okfType: Guide
folder: guides
label: { fr: Guide de notre équipe, en: Our team guide }
when: { fr: Comprendre une opération, en: Understand an operation }
sections:
  - role: purpose
    emoji: "🎯"
    heading: { fr: Le besoin, en: The need }
    required: true
    guide: { fr: À quoi cela sert, en: What this is for }
  - role: how
    emoji: "🔍"
    heading: { fr: Le fonctionnement, en: How it works }
    required: true
    guide: { fr: Les étapes appuyées par les sources, en: Source-backed steps }
tips: []
```

Le nom du fichier et son `id` doivent correspondre. Les rôles sont uniques,
les titres tiennent sur une ligne et `folder` est un dossier relatif sans `..`.
Un fichier YAML mal formé ou deux fichiers locaux de même identifiant bloquent
la commande avec une erreur de configuration explicite.

Le modèle `concept` accepte les rôles `definition`, `analogy`, `how`, `example`,
`diagram`, `pitfalls`, `source` : l’ordre et les titres sont personnalisables,
mais `definition` et `source` doivent rester obligatoires. Un autre rôle peut
être rendu obligatoire : une fiche qui n’en fournit pas le contenu est refusée.
Le CLI refuse aussi le contenu d’un rôle absent du modèle ; il ne le supprime
pas discrètement. Les modèles des autres notes peuvent définir leurs propres
rôles. Choisir les modèles avant de rédiger le dossier évite ces incohérences.

`okb maintain` signale `TEMPLATE_UNKNOWN` et `TEMPLATE_DRIFT` si une note nomme
un modèle absent ou manque un titre obligatoire. Un changement de modèle peut
donc signaler les anciennes notes ; il ne les réécrit pas. Cet audit vérifie les
repères requis, pas le sens du contenu ni toutes les différences d’ordre.

## Écrire une note à la main

Une fiche peut afficher un extrait court via `concepts[].evidence[].displayQuote`.
Ce champ doit être un sous-extrait exact et non vide du `quote` complet. Seul
l’affichage « Ce que dit la source » change ; la validation et les preuves de la
proposition conservent le texte complet. Choisir un extrait qui respecte le sens
de la source, puis relire la définition à partir des preuves complètes.

`okb template show <id> --skeleton` affiche un squelette à coller dans Obsidian.
Une note écrite à la main ne passe pas par une proposition : elle n’a ni preuves
contrôlées ni reçu. `okb maintain` la vérifie comme les autres.
Remplacer les marqueurs du squelette (titre, description, auteur et date) avant
de considérer la note comme un document OKF complet.

Les propositions générées par OKB, y compris les fiches et les révisions,
continuent à passer par revue, approbation humaine, application et reçu.
Un modèle fixe la structure ; il ne valide jamais la véracité d’une note.
