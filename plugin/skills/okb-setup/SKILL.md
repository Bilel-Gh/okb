---
name: okb-setup
description: Install or reconfigure an okb profile — knowledge bundle location, language, concept-assist level, organisation policy overlay. Use when the user installs okb for the first time, adds a second profile, switches profile, or wants to change where the knowledge base lives or how much concept help they get. Do not use to ingest a source, to answer a question, or to change the content of a note.
---

# Install or reconfigure a profile

> 📚 **Which KB.** Start your first reply with one line `📚 KB: <profile>` taken from `okb profile --json` (again after any `okb setup switch` or explicit `--profile`), so the user always sees which knowledge bundle is in use. If the session context does not already hold the user's OKB focus, `okb focus --context` gives it: use it silently to choose examples and priorities.

The product is generic; everything personal lives in a profile under `$OKB_HOME`
(default `~/.okb`). Re-running setup updates known keys and preserves every other
key the user added.

## Interview — one question at a time

Ask ONE question per message, each with your recommended answer so the user can
simply say yes. Skip what the user already said or supplied in a file. Keep a
short running summary of the answers.

1. **What is this KB about?** A subject (lasting knowledge) or a project (shared
   with others, ends one day)? Who else will read it? Propose a name following the
   naming convention below.
2. **Where does it live?** If the user already has an Obsidian vault with other
   `kb-*` folders, recommend `<vault>/kb-<name>`. Otherwise an empty folder of
   their choice. The KB is a separate directory of ordinary Markdown files.
3. **Who reads it?** The reader's level (`beginner`, `intermediate`, `expert`)
   and the domains where they start from zero (`reader.byDomain`).
4. **Concept assist level** — ask explicitly, never choose silently:

   | Level | What it does |
   |---|---|
   | `off` | no detection, no insertion. Existing cards and links keep working. |
   | `targeted` | business vocabulary, internal terms, indispensable prerequisites. **Recommended.** |
   | `pedagogical` | targeted, plus the fundamental notions relevant to the subject. |

5. **Language and actor**: answer language, and the id recorded in
   `generated.by` (`human:<id>`). Propose what the conversation already shows.
6. **Writing style**: preset `standard` (default), `pedagogique` or `expert`
   (`okb style presets` if they hesitate). Style, reader level and concept assist
   are three separate settings. For a KB that should stay uniform, recommend
   `kb.requireTemplate: true` (`okb template list`).
7. **Confidentiality**: private, or shareable with someone? Third-party paid
   content (a course, a book) stays private. Record it as a writing instruction
   or a comment so the next session knows.
8. **Focus and history**: if another profile already has a focus note, propose to
   share it (`focus.file`, `focus.journal`). If the KB folder is a Git repository,
   propose `git.autoCommit: true` (each apply becomes a commit; nothing is pushed).
9. **Organisation overlay**, only if the user mentions one. It can only narrow
   what the profile allows, never widen it.

Then show the whole configuration as a short table and ask for one confirmation
before running setup.

## Naming convention (recommend it)

One name per KB, used everywhere so it is easy to tell KBs apart:

| What | Pattern | Example |
|---|---|---|
| Folder | `kb-<name>` | `kb-atlas` |
| Profile id | `<name>` | `atlas` |
| Git repository | `kb-<name>` | `kb-atlas` |

`<name>` is one or two lowercase words the user would say aloud: a subject
(`ia`, `finance-perso`) or a project (`atlas`). Keep all KBs as sibling folders of
one Obsidian vault, with a hand-written home page at the vault root linking them.
Create a separate KB when sharing, confidentiality or reader level differ;
otherwise prefer one KB with folders, so notes can link to each other.

A configuration file answers all of it without a questionnaire:

```bash
okb setup --from ./onboarding.yaml
```

The file may carry `writing:` (preset plus knobs to override, see
`okb config show --defaults`), `reader:` (`level`, `byDomain`), `focus:` (`file`,
`journal`) and `git:` (`autoCommit`).

## Apply

```bash
okb setup --profile <id> --kb-root <path> --concept-assist targeted \
  --human-actor human:<id> --answer-language fr --concepts-folder concepts \
  --writing-preset pedagogique
okb doctor
okb style            # the brief the writing workflows will follow
```

Then confirm what is on and what is off:

```bash
okb config show
```

Report `disabled` (capabilities left off because nothing configured them) and
`clamped` (settings an organisation policy narrowed). Do not present a clamped
value as a user choice.

## Second profile

```bash
okb setup --profile <other-id> --kb-root <other-path> --concept-assist off
okb setup switch <other-id>
```

Profiles never share state: proposals, approvals, caches and logs live under
`$OKB_HOME/profiles/<id>/state`.

## Changing the assist level later

- Globally: `conceptAssist.level` in the profile.
- Per domain: `conceptAssist.byDomain.<domain>`.
- For one import: `okb ingest … --concept-assist off`.

Turning it off stops new suggestions and insertions. Cards and links already in
the bundle keep working.
