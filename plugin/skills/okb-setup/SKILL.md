---
name: okb-setup
description: Install or reconfigure an okb profile — knowledge bundle location, language, concept-assist level, organisation policy overlay. Use when the user installs okb for the first time, adds a second profile, switches profile, or wants to change where the knowledge base lives or how much concept help they get. Do not use to ingest a source, to answer a question, or to change the content of a note.
---

# Install or reconfigure a profile

> 📚 **Before your first reply.** Run `okb profile --json` once and open with one line `📚 <KB name>` (add ` · 🎯 focus <n> j` when the focus is stale). If the session context lacks the user's OKB focus, `okb focus --context` gives it: use it silently. Speak the user's language.
> 🧭 **Choices are buttons.** Whenever the user must choose (which KB, which proposal, keep or drop, go or not), ask with AskUserQuestion: 2 to 4 options, the recommended one first with « (recommandé) », one question at a time.
> 🛡️ **Only OKB's own KBs.** Never read or write another tool's or agent's knowledge base (a support agent's KB, a wiki, another plugin's folder, `routing.otherKnowledgeTools`). If a request could concern one of them, ask which knowledge base is meant before acting.
> ✍️ **Format.** Short sections, a table for lists, quotations as `>` blocks with `path:line`, and a last line « ➡️ Prochaine étape : … ». OKB refuses secrets (`E_SECRET`): offer a placeholder such as `<API_KEY>`.

The product is generic; everything personal lives in a profile under `$OKB_HOME`
(default `~/.okb`). Re-running setup updates known keys and preserves every other
key the user added.

## The easy way: `okb init`

In a terminal, `okb init` (first KB) or `okb new` (another KB) is a guided
wizard: quick or custom mode, detected Obsidian vaults, the naming convention,
Git and GitHub, the Claude plugin and the `okb` command. Recommend it first
when the user has a terminal at hand.

## In this conversation — one question at a time, with buttons

Ask ONE question per message with AskUserQuestion, the recommended answer first.
Skip what the user already said. Keep a short running summary.

1. **What is this KB about?** A subject (lasting knowledge) or a project (shared
   with others, ends one day)? Propose a name following the naming convention.
2. **Where?** If the user has an Obsidian vault with other `kb-*` folders,
   recommend `<vault>/kb-<name>`. A folder holding notes another tool wrote may
   belong to another agent: say so, and only continue on an explicit yes
   (`--adopt`).
3. **Interface language** of OKB (menus, messages): français, English or
   automatic — and **writing language** of the notes, asked separately.
4. **Quick or custom?** Quick keeps safe defaults. Custom asks: reader level
   (`beginner`, `intermediate`, `expert`), style (`standard`, `pedagogique`,
   `expert`), help with notions (`targeted` recommended, `pedagogical`, `off`).
5. **Git history** (recommended when Git exists), a **private GitHub repository**
   (only if `gh` is logged in and the user wants it), the **Claude plugin** and the
   **okb command** on the PATH.

Then show the whole configuration as a short table and ask for one confirmation.
Run it without questions:

```bash
okb init --yes --name "<Name>" --dir "<folder>" --lang fr --writing-lang fr \
  --preset standard [--git] [--github] [--adopt]
okb settings set reader.level=intermediate conceptAssist.level=targeted --kb <id>
okb doctor --kb <id>
```

Change any setting later with `okb settings set <key>=<value>` (`okb settings
show --all` lists them, with their labels in the user's language).

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

## Switching, other KBs, other tools

- Switch the active KB: `okb kb switch <id>` (the user may simply say « passe sur
  la KB atlas »). One command for another KB: add `--kb <id>`.
- Several KBs live as sibling folders of one Obsidian vault, each with its own
  settings. A folder belongs to one KB only (OKB marks it in `.okb/owner.yaml`).
- Another tool or agent with its own knowledge base (a support agent, a wiki):
  record its name so OKB never touches it and asks when a request is ambiguous:
  `okb settings set routing.otherKnowledgeTools="support-kb, wiki produit"`.
- Natural-language offers (« fin de session » → /okb:done) can be turned off:
  `okb settings set routing.suggest=false`.

For scripts, `okb setup --profile <id> --kb-root <path> --concept-assist targeted`
still works, and `okb setup --from answers.yaml` reads `writing`, `reader`,
`focus` and `git`. Profiles never share state: proposals, approvals and logs live
under `$OKB_HOME/profiles/<id>/state`.
