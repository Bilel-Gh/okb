---
name: okb-setup
description: Set OKB up for the user, guided — read where they stand (their KBs, a folder of repositories, a KB written before OKB, the Claude plugin), recommend the right organisation (a subject KB, a KB for one repository, or a workspace for a team's repositories) with the reason, ask only what is needed, show a preview of exactly what will be done, then do it after one confirmation. Use when the user installs OKB or asks to set it up for them (« configure OKB pour moi », « je commence avec OKB », "set up okb"), adds a KB, or wants a setting changed. Do not use to ingest a source, answer a question, or change the content of a note.
---

# Set OKB up for the user

> 🌐 **Speak the user's language.** Plain words: they may know nothing about OKB.
> 🧭 **Choices are buttons.** Whenever the user must choose, ask with AskUserQuestion: 2 to 4 options, the recommended one first with « (recommandé) », one question at a time.
> 🛡️ **Only OKB's own KBs.** Never read or write another tool's knowledge base. OKB writes no note during setup, nothing in code repositories, and never uses Git on a KB. Never approve a proposal for the user.
> ✍️ **Format.** Short sections, tables for lists, last line « ➡️ Prochaine étape : … ».

## 1. Read where they stand — no AI, nothing written

```bash
okb start --json
```

Add `--cwd "<folder>"` when the user's folders are elsewhere (Claude opened in
their home folder): ask once « Où sont tes repos ? » (or « Où est ton ancienne
KB ? ») and run it again. It returns `situation`, `kbs`, `workspaces`,
`reposFolder` (a folder of repositories, up to two levels down), `tree` (each
subfolder: repository in OKB or not, OKB KB, old KB, team group, other),
`notesFolders` (KBs written before OKB, `kb: null` when not connected), `tools`,
`advice`, `plan` and `next`.

## 2. Overview and recommendation

One short table of what OKB found: the KBs (kind, folder), the plugin, and
`tree` as the folder's map — one row per subfolder with what it is and what
OKB will do with it. Then the recommendation from `advice`, with its reason:

| `situation` | Recommend | Why, in a few words |
|---|---|---|
| `team-repos` | 🗂️ a workspace for that folder | one KB for the team, one space per repository, shared business notes, links between repositories |
| `single-repo` | 📦 a KB for that repository | its notes at the root, nothing to choose later |
| `notes` | connect the old KB, convert it later | everything already written is kept |
| `subject` | 📚 a subject KB | notes filed by kind |
| `ready-repo`, `ready-workspace` | nothing to install, unless `plan` adds the repositories left out (`syncWorkspace`) or makes the folder a workspace | go to §6 |

Every repository of a workspace's folder must be in it: `missingRepos` lists
the ones left out. Several team groups (`groups`): one workspace for one team or
employer, else ask, and one workspace per group (`--cwd` on each).

An old KB found beside the repositories: recommend making it the work KB.
Read `level: warn` items as they are (a KB in a synchronised folder, a missing
folder).

## 3. Ask only what is needed — one question at a time

1. **The organisation**, the recommended one first; alternatives only when they
   fit (a workspace anyway for one repository when more will come; a KB for one
   repository inside a team folder when it is more confidential).
2. **The old KB**, when one is found: « La reprendre comme KB de travail
   (recommandé) » · « Non, une KB neuve ». Not reused: replace its steps by
   `okb workspace add "<folder>" --new-kb "{name}"`.
3. **The KB's name**: ask it as free text; the step's `nameHint` or a subject
   word may be offered as an example, never a person's first name.
4. **Confidential?** For code: « Oui, sur cet ordinateur (recommandé) ».

## 4. Preview, then one confirmation

A table: # · what · exact command (`{name}` and `{id}` filled: the id is the
name in lowercase with dashes, as `okb kb` shows it) · what it writes. Say what
is not done: no note written, nothing in the repositories, no Git, no AI before
`/okb:convert` or `/okb:onboard`. Then ask: « Lancer (recommandé) » ·
« Modifier » · « Annuler ».

## 5. Run

Each step with `argv`, in order: `okb <argv> --json`. Stop at the first error,
explain it in one line (`okb explain <code>`) and offer the fix. A step marked
`interactive` (the plugin and the `okb` command) asks its own questions: ask the
user to run it in a terminal. Steps with `inClaude` are not run now: offer them
(`/okb:convert`: one proposal to review, can take a while; `/okb:onboard` for
the ticket's repository). Report each step with ✔ and its result (repositories
found, ticket prefixes learned, a landscape proposal to review in `okb serve`).

## 6. How to work now

From `next` (or `okb start --json` again): for a ticket, open Claude Code **in
the folder of the ticket's repository**, type `/okb:ticket ABC-123` and paste
the ticket's text; at the end, « j'ai fini mon ticket ». The guide:
`docs/guide/choisir-son-organisation.md`.

## Changing a setting, other KBs

- A setting: `okb settings set <key>=<value>` (`okb settings show --all` lists
  them, with labels in the user's language): languages, writing style, reader
  level, help with notions.
- The active KB: `okb kb switch <id>` (« passe sur la KB atlas »); one command
  for another KB: `--kb <id>`. A KB is removed with `okb kb remove <id>` (its
  folder stays).
- Another tool's knowledge base: record its name so OKB never touches it,
  `okb settings set routing.otherKnowledgeTools="<name>"`.
- In a terminal, `okb start` shows the same overview and runs the plan after
  one confirmation.
