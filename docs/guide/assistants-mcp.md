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
| `notes_find` | chercher dans tes notes (fautes de frappe, deux langues) |
| `notes_read` | lire une note par son chemin |
| `kb_status` | l'état de ta KB : notes, propositions, cartes en attente |
| `suggestions_list` | les cartes de suggestion qui attendent ta décision |
| `suggestions_add` | te proposer une note : une carte, rien n'est écrit |
| `repos_list` | les repos documentés (module développeur) |

## Ce qu'il ne peut pas faire

- **Voir une note 🔒.** Elle n'apparaît ni dans ses recherches ni dans ses
  lectures. Tu l'ouvres toi-même dans OKB.
- **Décider à ta place.** Approuver, appliquer, accepter une carte : ces gestes
  restent les tiens, dans l'application ou le terminal.
- **Utiliser un module que tu as éteint.** `okb modules off dev` retire aussi
  `repos_list` de sa liste ; tes notes restent lisibles.

## Les mêmes réponses partout

Une recherche faite par l'assistant donne les mêmes notes, dans le même ordre
et avec les mêmes étoiles qu'une recherche faite par Claude dans le terminal.
Seules les notes 🔒 manquent, et le résultat le dit (`hidden`). Une demande
mal formée est refusée de la même façon partout, avec le champ en cause.
