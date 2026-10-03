# OKB — Open Knowledge Brain · 0.3.0

A configurable local knowledge workflow for Claude Code and Obsidian. Claude
reads and synthesises; the TypeScript core validates evidence references,
prepares exact diffs, and applies authorised changes with recoverable receipts.
The knowledge base is a separate directory of ordinary Markdown files.

**Start in French:** [DEMARRER.md](DEMARRER.md).

## Install

Node **22.12+** and npm. From this source directory:

```bash
npm ci
npm run build
npm link
okb version
claude plugin validate ./plugin
claude --plugin-dir "$PWD/plugin"
```

The plugin ships `bin/okb`, which Claude Code puts on the Bash tool's PATH while
the plugin is enabled; it runs the CLI compiled beside the plugin, so `npm link`
is only needed to use `okb` in your own terminal. A plugin copied without its
package falls back to another `okb` on PATH.
To install from a packed release instead: `npm install -g ./okb-0.3.0.tgz`.
Do not run `npx okb` against an unverified public package of the same name.

Configure an existing or separately created empty KB directory:

```bash
okb setup --profile me --kb-root /path/to/my-vault --concept-assist targeted \
  --answer-language fr --locale fr-FR --human-actor human:me
okb doctor
okb config show
```

Setup writes the private profile, not the KB. No Git operation is performed.
Concept assistance is explicitly chosen: off, targeted, or pedagogical.

## Daily use

| Intent | Workflow |
|---|---|
| Import a transcript/document/code, alone or together | `okb-ingest` skill or `/okb:ingest` |
| Find an answer in existing notes | `okb-ask` or `/okb:ask` |
| Rewrite one note in another style | `okb-revise` or `/okb:revise` |
| Review a proposed change | `okb-review` or `/okb:review` |
| Apply an approved selection | `/okb:apply` |
| Audit, organise or move notes | `okb-maintain` or `/okb:maintain` |
| Change configuration | `okb-setup` or `/okb:setup` |
| Inspect installation/context | `/okb:doctor` |
| See which profile/KB is in use, switch | `okb profile` · `okb setup switch <id>` |
| See or adjust the writing brief | `okb style [--set knob=value]` |
| See the note templates | `okb template list` · `okb template show <id>` |
| Read notes and exact proposal previews in a local browser | `okb serve --profile <id>` |
| Check local source fingerprints on request | `okb maintain --check-sources` |
| Jot something down now, decide later (private inbox, not the KB) | `/okb:capture` · `okb capture "<text>"` |
| Triage the inbox into proposals, one item at a time | `okb-inbox` or `/okb:inbox` |
| Weekly review: inbox, waiting proposals, notes to re-read, audit | `okb-weekly` or `/okb:weekly` · `okb weekly` |
| Revise a note by active recall (short questions, cited feedback) | `okb-learn` or `/okb:learn` |

Nothing credential-shaped (API keys, tokens, private keys, passwords in URLs or
assignments) can enter a proposal, a capture or an applied note: OKB refuses with
`E_SECRET` and a masked excerpt, and `okb maintain` reports `SECRET_IN_NOTE` in
hand-written notes.

Articles follow a configurable **writing style** (presets `standard`,
`pedagogique`, `expert`, plus overrides), kept separate from the reader's prior
knowledge, from concept assistance and from the fixed reliability rules. A
style change never rewrites existing notes. See [style](docs/STYLE.md).

Every note follows a **template** (guide, concept, procedure, experience,
decision, meeting) that fixes its sections, their order and headings, so the
bundle stays navigable as it grows; concept cards teach a notion in a minute
(definition, analogy and its limit, how it works, example, diagram, pitfalls).
See [templates](docs/TEMPLATES.md).

A source follows: bounded extraction → source analysis → KB search → proposal →
independent evidence review → human approval → transactional apply.
The core does **not** call a language model or fine-tune one. Personal knowledge,
aliases and configuration improve retrieval; this is not automatic model training.
The no-dossier CLI fallback is a labelled **partial evidence preview**, never a
complete semantic summary. See [analysis dossier](docs/WORKFLOWS.md).

## Separation

| Location | Responsibility |
|---|---|
| This repository | Shareable code, skills, fictitious tests, example settings |
| Organisation/team overlays | Defaults plus policy ceilings |
| `$OKB_HOME/profiles/<id>/profile.yaml` | Private preferences and KB location |
| `kb.root` | Canonical notes, independently versionable and privately owned |
| Profile `state/`, outside the KB | Source snapshots, analyses, proposals, approvals, receipts, backups |

Preference order: defaults → organisation → team → profile → KB-local →
environment → flags. Policies accumulate restrictions instead of following
last-write-wins. This is a configuration boundary under one user account, not
centrally enforced enterprise access control.

## Supported input and storage

VTT captions with timecodes/speakers; Markdown/text; static HTML or explicitly
allowed public URLs; PDF text layers; DOCX body text; source and configuration
files read as text with line ranges and top-level symbols (nothing executed).
One article may synthesise several sources (`--with`). Scanned PDF, protected or
JavaScript-only pages, and unsupported document parts are reported as absent.
No audio transcription, OCR or browser automation is bundled.

Storage targets Google's **Open Knowledge Format 0.2**, pinned to an exact
specification revision. Generated internal links use standard relative Markdown
with `.md`, computed from the containing file: `[Run](../flows/run.md)`.
External references retain their URLs. Unknown YAML fields survive updates.

## Validation and limits

```bash
npm run release:check
npm audit
```

The release gate runs TypeScript checks, regression tests, static plugin checks,
and a clean packed installation with a complete fictitious workflow. The native
Claude validator checks the plugin manifest separately. Native model routing and
semantic quality require the supplied [Claude eval suite](docs/EVALUATION.md)
in your own authenticated runtime; a passing keyword-router test does not prove
Claude selected the correct skill.

Apply checks the recomputed proposal hash, exact approved selection, target
baselines, path policy and structural changes. Backups and expected output are
saved before KB writes. Local writers share a lock, and rollback refuses later
edits. Per-file writes are atomic; a group of files is recoverable, **not** a
single filesystem transaction. Arbitrary same-account shell access remains
outside the approval mechanism's isolation guarantees.

Read [architecture](docs/ARCHITECTURE.md), [decisions](docs/DECISIONS.md), [style](docs/STYLE.md), [templates](docs/TEMPLATES.md), [installation](docs/INSTALL.md),
[security](docs/SECURITY.md), [OKF conformance](docs/OKF-CONFORMANCE.md),
[context](docs/CONTEXT.md) and release notes ([0.3.0](docs/RELEASE-0.3.0.md), [0.2.0](docs/RELEASE-0.2.0.md)).
See also the [local reader](docs/LOCAL-READER.md), [independent diagnosis](docs/DIAGNOSTIC-2026-10.md)
and [verified Claude contracts](docs/CLAUDE-COMPATIBILITY.md).
