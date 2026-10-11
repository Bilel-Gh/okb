# Brancher un assistant du terminal (MCP)

Claude Code, Codex, Copilot ou Cursor peuvent lire tes notes et te proposer d'en
écrire, par MCP (le standard qui permet à un assistant de se brancher sur un
outil). C'est la même mécanique que l'application et le terminal : les mêmes
règles, les mêmes résultats.

## Le brancher

Pour Claude Code :

```bash
claude mcp add okb -- okb mcp
```

Pour un autre assistant, déclare un serveur MCP en stdio dont la commande est
`okb mcp`. Pour viser une KB précise plutôt que ta KB active :
`okb mcp --kb <id>`.

OKB ne s'inscrit pas tout seul dans tes assistants : tu choisis où le brancher.

## Ce que l'assistant peut faire

| Outil | Ce qu'il fait |
|---|---|
| `notes_find` | chercher dans tes notes (fautes de frappe, deux langues) ; les documents trouvés viennent avec |
| `notes_read` | lire une note par son chemin |
| `kb_status` | l'état de tes notes : combien, ce qui attend ton oui, leur santé |
| `suggestions_list` | les cartes de suggestion qui attendent ta décision |
| `suggestions_add` | te proposer une note : une carte, rien n'est écrit |
| `today_view` | ta journée : projets à reprendre, actions, attentes, ce qui s'est passé |
| `projects_list`, `projects_get` | tes projets, où chacun en est, sa prochaine étape |
| `projects_create`, `projects_update`, `projects_leave` | créer un projet, dire où il en est, préparer « Où j'en étais » |
| `actions_list`, `actions_add`, `actions_update`, `actions_detect` | tes actions et ce que tu attends ; ce qu'il ajoute est marqué « proposé par l'IA » |
| `journal_list`, `journal_add` | le journal d'un projet ou d'un jour |
| `documents_list` | chercher dans tes documents (les fichiers gardés tels quels) |
| `baggage_draft`, `baggage_keep` | « Garder dans mon bagage » : une note de travail sans aucun détail du travail, préparée pour ton bagage ; tu l'approuves là-bas |
| `evening_view` | ce qui attend ton oui : les notes proposées et les changements prêts |
| `day_view` | ce qui s'est passé un jour donné (« mardi », « hier », une date) |
| `indicators_view` | quatre indicateurs séparés : couverture, fraîcheur, qualité, compréhension, avec quoi faire pour chaque manque |
| `backup_status` | où en est la sauvegarde, et quand une restauration a été essayée |
| `repos_list` | les repos documentés (module développeur) |

## Ce qu'il ne peut pas faire

- **Voir une note 🔒.** Elle n'apparaît ni dans ses recherches ni dans ses
  lectures. Tu l'ouvres toi-même dans OKB.
- **Décider à ta place.** Approuver, appliquer, accepter une carte, dire « oui à
  tout » : ces gestes restent les tiens, dans l'application ou le terminal.
- **Garder ou modifier un document.** Il peut les chercher ; déposer un fichier,
  le renommer ou lever un cadenas restent tes gestes. Un document 🔒 lui est caché.
- **Écrire une note.** Il peut tenir tes projets, tes actions et ton journal, qui
  sont l'état de ton travail. Une note, elle, passe toujours par une carte et ton oui.
- **Utiliser un module que tu as éteint.** `okb modules off dev` retire aussi
  `repos_list` de sa liste ; tes notes restent lisibles.

## Les mêmes réponses partout

Une recherche faite par l'assistant donne les mêmes notes, dans le même ordre
et avec les mêmes étoiles qu'une recherche faite par Claude dans le terminal.
Seules les notes 🔒 manquent, et le résultat le dit (`hidden`). Une demande
mal formée est refusée de la même façon partout, avec le champ en cause.
