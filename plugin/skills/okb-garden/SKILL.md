---
name: okb-garden
description: Keep an OKB brain healthy and well organised — storage health (sync copies, moved links, ids, backups, trash, history), moving a KB made before 1.0 into a brain, moving notes with their links, themes and duplicates, weak or outdated notes, restyling one note, converting an old vault. Use when the user asks to check, tidy, repair, migrate or restyle (« range mon cerveau », « réécris cette fiche plus simplement »). Do not use for a new source, a knowledge question or an installation problem.
---

# Garden the brain

> 📚 **First reply.** `okb profile --json` once; open with `📚 <KB name>`. Speak the user's language.
> 🧭 **Choices are buttons** (AskUserQuestion, 2–4 options, recommended first with « (recommandé) », one question at a time).
> 🛡️ **Only OKB's own KBs.** Never another tool's knowledge base. Every change is a proposal the user approves (`okb-review`); never edit notes directly.
> ✍️ **Format.** Short, tables for lists, last line « ➡️ Prochaine étape : … ».

## Health of the storage

`okb brain check --json`: sync copies (« 2 »), conflict files, duplicate or
missing ids, notes outside the drawers, broken links, links to a note moved by
hand, orphan attachments, disk encryption for a confidential brain, backups (none,
old, not verified). Summarise by code, worst first. Then:

- `okb brain repair --json`: one proposal (identical copies removed, ids added,
  moved links fixed) → `okb-review`. Different copies and true broken links stay
  for the user: show both versions, ask.
- backups: `okb backup run`, `okb backup verify`, an external disk with
  `okb settings set backup.dir=<folder>`; a restore goes to a new folder only
  (`okb backup restore <date> --to <folder>`). A note deleted by mistake:
  `okb trash`, `okb trash restore "<path>"`; an older version: `okb history "<path>"`.

## Organisation

`okb maintain --json` and `okb links check --json`: conformance, product rules,
consistency. A date or an unchanged hash never proves a note is still true.

- **Move or rename** a note: `okb links move <from> <to> --json` (every link follows).
  In a brain, the right place comes from `okb where <type> …`.
- **Themes**: `okb brain types`, the theme pages under `1 …/Domaines/`; merge
  synonyms, split a theme of more than 60 notes, fix notes without a parent.
- **Weak notes**: `okb scores --below 50 --json` → for each: improve (a
  suggestion card), merge with another, or archive (`status: deprecated`).
- **Outdated**: notes « à rafraîchir » or tied to code that changed → a suggestion
  card each; nothing is rewritten by itself.

## A KB made before 1.0 into a brain

1. `okb brain migrate --preset work|projects|topics|career --json`: a plan with
   OKB's guesses (type of each note, its repository).
2. Read the plan (`planPath`); complete what OKB cannot guess: the product or topic
   of a guide, the theme of a business concept. Show the table of changes, ask.
3. `okb brain migrate --plan-file <file> --json` (or `--build`): one proposal,
   every link rewritten, ids added, subject pages created. Review with `okb-review`.
4. After it is applied: `okb brain migrate --finish`.

## Other procedures

- Rewrite one note in another style: [revise](references/revise.md).
- Convert an old KB or Obsidian vault: [convert](references/convert.md).
- Navigation indexes: `okb nav --json`; legacy links: `okb migrate portable-links --json`.
