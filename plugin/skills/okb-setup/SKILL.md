---
name: okb-setup
description: Set OKB up for the user, or add a brain — install the engine if missing, look at their folders (repositories, an old KB), recommend brains (work with products and repositories, personal projects, topics to learn, a portable career), ask at most three questions, preview, then create everything after one yes. Use when the user installs OKB, asks « configure OKB pour moi », adds a brain or changes a setting. Do not use to write a note, answer a question or ingest a source.
---

# Set OKB up for the user

> 📚 **First reply.** Speak the user's language. Plain words: they may know nothing about OKB.
> 🧭 **Choices are buttons** (AskUserQuestion, 2–4 options, recommended first with « (recommandé) », one question at a time).
> 🛡️ **Only OKB's own KBs.** Never read or write another tool's knowledge base. Setup writes no note, nothing in code repositories, never uses Git on a KB, never approves for the user.
> ✍️ **Format.** Short sections, tables, last line « ➡️ Prochaine étape : … ».

## 0. The engine

Run `okb version`. If it fails (`command not found`, or « the OKB engine is not
installed »), say in one line that OKB needs its engine on this computer, ask
« Installer le moteur OKB (recommandé) » · « Plus tard », and on yes run the
installer that sits beside this skill: `sh <this skill's base directory>/../../scripts/engine.sh`.
It prints one JSON line: `node-missing`/`node-too-old` → tell the user to
install Node.js 22 (https://nodejs.org) and stop. Never edit the user's shell
files or Claude settings.

## 1. Look — no AI, nothing written

`okb start --json` (`--cwd "<folder>"` when their folders are elsewhere: ask once
« Où sont tes repos ? »). It lists the KBs (`brain` tells which are brains),
a folder of repositories (`reposFolder`, `tree`), old KBs (`notesFolders`) and
the plugins.

## 2. Recommend brains

A brain is a KB organised in drawers: `0 Entrée`, `1` the world around,
`2` the main subjects, `3 Boîte à outils`, `4 Activité`. Recommend, with the reason:

| They have | Recommend | Preset |
|---|---|---|
| repositories of an employer or a team | 🧠 a work brain: products → repositories → tickets | `work` (needs the `okb-dev` module) |
| their own code projects | 🧠 a projects brain | `projects` (`okb-dev` too) |
| things to learn (courses, reading, a domain) | 🧠 a topics brain | `topics` |
| a career to keep track of | 🧠 a portable career brain | `career` |
| a KB made before 1.0 | keep it, move it into a brain | `okb brain migrate` |

Work and personal stay in separate brains, always. A company's brain is
confidential (`--confidential`).

## 3. At most three questions

1. **What OKB is for** (several allowed): « Mon travail de dev (recommandé) » ·
   « Mes projets perso » · « Apprendre » · « Ma carrière ».
2. **The name of each brain**, as free text (an example like « Travail »; never
   a person's first name).
3. **Reading profile**: « Débutant, visuel (recommandé pour débuter) » ·
   « Équilibré » · « Expert, concis » → `okb settings set reader.level=beginner|intermediate|expert`
   and `writing.preset=pedagogique|standard|expert`.

## 4. Products (work and projects brains)

Group the repositories found into products: read each one's README, `package.json`
or main folder names, then propose a table repository → product and ask « C'est
juste ? ». A repository shared by several products goes to « Socle commun ».

## 5. Preview, one yes, then run

A table: # · what · exact command · what it writes. Then « Lancer (recommandé) » ·
« Modifier » · « Annuler ». Commands (each with `--json`; `{id}` is the name in
lowercase with dashes):

- module for code, if a work or projects brain is wanted and `okb-dev` is not
  installed: ask, then `claude plugin install okb-dev@okb` and tell the user to
  run `/reload-plugins`;
- a brain: `okb init --name "<name>" --brain work|projects|topics|career [--confidential] [--dir <folder>]`;
- its repositories: `okb workspace add "<folder>" --kb {id}`, then
  `okb product set <repo> "<product>"` for each;
- an old KB: `okb kb add "<folder>"`, then `okb brain migrate --kb <id> --preset <p>`
  (writes a plan), refine the subjects and themes in the plan with the user,
  `okb brain migrate --kb <id> --build` (one proposal), review it with `okb-review`,
  then `okb brain migrate --kb <id> --finish`.

Stop at the first error, explain it in one line (`okb explain <code>`).

## 6. The first hour

Offer, as suggestion cards (nothing written without a yes): the page « en 5 min »
of the repository they are in, the brain's « Écosystème » from the READMEs.
Then: `okb now objective "…"` with their goal of the moment, a first backup
(`okb backup run`; an external disk via `okb settings set backup.dir=…`).

## Settings and other brains

`okb settings show --all` · `okb settings set <key>=<value>` · `okb kb switch <id>`
(« passe sur mon cerveau Sport ») · another tool's knowledge base:
`okb settings set routing.otherKnowledgeTools="<name>"`.
