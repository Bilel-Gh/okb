# OKB — Open Knowledge Brain · 0.2.0

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

The plugin needs the matching `okb` CLI on PATH. The npm package includes the
compiled CLI and plugin, but Claude does not install this CLI automatically.
To install from a packed release instead: `npm install -g ./okb-0.2.0.tgz`.
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
| Import a transcript/document | `okb-ingest` skill or `/okb:ingest` |
| Find an answer in existing notes | `okb-ask` or `/okb:ask` |
| Review a proposed change | `okb-review` or `/okb:review` |
| Apply an approved selection | `/okb:apply` |
| Audit, organise or move notes | `okb-maintain` or `/okb:maintain` |
| Change configuration | `okb-setup` or `/okb:setup` |
| Inspect installation/context | `/okb:doctor` |

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
allowed public URLs; PDF text layers; DOCX body text. Scanned PDF, protected or
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

Read [architecture](docs/ARCHITECTURE.md), [installation](docs/INSTALL.md),
[security](docs/SECURITY.md), [OKF conformance](docs/OKF-CONFORMANCE.md),
[context](docs/CONTEXT.md) and [release notes](docs/RELEASE-0.2.0.md).
