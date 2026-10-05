# Analysis dossier v2

Create a template with
`okb ingest "<primary>" --run <runId> [--with "<other>"]… --template --note-template <id> --json`.
It returns its state path, the sources and the resolved `style`. Save your
completed dossier as a different file so a later template cannot overwrite it.

```json
{
  "version": 2,
  "template": "guide",
  "sources": ["<sha256 of the primary source>", "<sha256 of each --with source>"],
  "style": { "...": "copied unchanged from okb style --json / the template" },
  "reviewedBlockIds": ["<every block of every source actually read; runs as <source>#0-70>"],
  "summary": "Private working summary; not published as uncited prose.",
  "sections": [{
    "role": "purpose",
    "claims": [{
      "id": "stable-unique-label",
      "text": "A concise useful statement, without manual footnote labels.",
      "kind": "reported",
      "evidence": [{"blockId": "<id>", "quote": "<verbatim substring of that block>"}]
    }],
    "aids": [
      {"type": "explanation", "text": "Plain-language framing.", "basedOn": ["stable-unique-label"]},
      {"type": "analogy", "text": "Like …", "limits": "Where the comparison stops.", "basedOn": ["…"]},
      {"type": "diagram", "mermaid": "flowchart LR\n  A --> B", "caption": "What it shows", "basedOn": ["…"]},
      {"type": "example", "text": "A concrete case from the source.", "basedOn": ["…"]}
    ]
  }],
  "concepts": [{
    "term": "Domain term",
    "aliases": ["plural or translation"],
    "definition": "Short sourced meaning; not an invented expansion.",
    "evidence": [{"blockId": "<id>", "quote": "<short verbatim evidence>"}],
    "sections": [],
    "aids": [{"type": "analogy", "text": "Like …", "limits": "…", "basedOn": ["definition"]}],
    "seeAlso": ["concepts/other-card.md"]
  }],
  "corrections": [{"earlierBlockId": "<optional id>", "laterBlockId": "<id>", "note": "…"}],
  "openQuestions": ["An unresolved point explicitly separated from facts."],
  "related": [{"path": "folder/note.md", "relation": "prerequisite|next|deeper", "why": "…"}]
}
```

**Templates fix the structure.** `template` names a note template (`okb template
show <id>`). A section with a `role` takes its heading from the template and has no
`heading`; a free section has a `heading` and no `role` and may sit anywhere. Roles
keep the template order; required roles must be present. Concepts follow the
`concept` template: `definition` (one sentence, plain words), an `analogy` aid with
`limits`, `how` and `pitfalls` claim sections, an `example` and a `diagram` when
useful, and `aliases` (plurals, translations) so later notes link to the card.
Concept aids may be `basedOn` the concept's own claims or `"definition"`.
Omit unused concept sections; each supplied `how` or `pitfalls` section needs at
least one claim and each role appears once. Claim ids are unique across the
whole dossier; `definition` is reserved in concept claims. Read the local
concept template before writing: local headings and order apply to generated
cards, and any locally required role must have sourced content. `seeAlso`
contains bundle-relative `.md` paths, not paths relative to the concept card.

**Claims carry the facts.** Every claim has at least one real supporting quote;
use `inferred` for deductions and explain why. There is no `verified` option.
Exact-quote checking cannot prove the quote supports the claim: the independent
review assesses scope, negations, speaker attribution and late corrections.
Keep quotes short — the defining phrase or the lines of code that matter.

**Aids carry no facts.** An aid rephrases the claims in `basedOn` for this
reader. An analogy always states its `limits`. A diagram is bare Mermaid code
(no fences, ≤ 12 nodes). Explanations and analogies render before the claims of
their section, diagrams and examples after; set `placement` to override. The CLI
refuses analogies, diagrams or examples when the recorded style turns them off. A section
may contain only aids, but the dossier needs at least one claim.

**Several sources.** List each one in `sources`; block ids are unique across
sources, and `reviewedBlockIds` covers all of them. A claim may cite blocks from
several sources; its footnote names each file and locator (lines for code).

**Short concept quotations.** Concept evidence may include `displayQuote`, a
nonempty exact substring of its full `quote`. Only the published source excerpt
uses it; validation and proposal evidence retain the full quote. Keep enough
context to avoid misleading readers. Never shorten the proof itself merely to
make the displayed card smaller.

**Related notes.** `prerequisite` renders as "read first" and feeds
`x_okb.prereqs`; `next`/`deeper` render under "going further". A link is only
written when the target already exists (or is loaded from a pending proposal
with `--after`); otherwise the proposal says so.

Review every normalised block, including the end. Save work between pages. If
coverage is incomplete, hand off the saved dossier/fragments and the next cursor;
do not manufacture a list of reviewed ids. Basic vocabulary is proposed in
pedagogical mode only when useful; seniority does not imply expertise everywhere.

The CLI makes footnotes, source ids, concept links and related links. Do not
handwrite local links or paste source paths into claims or aids. External
reference URLs may be retained. Keep literal code and quotations out of prose.

A source set reimported into the same target is a no-op for the same hashes.
`--reprocess` deliberately overrides this: inspect the diff to avoid duplicate
sections. Corrections to an existing KB statement are surfaced for human choice,
not silently overwritten by an automated contradiction heuristic.

Version 1 dossiers (`"version": 1`, `"sourceSha256"`, sections with claims only,
fixed French labels) remain accepted for one source.
