# Analysis dossier v1

Create an empty template with:
`okb ingest "<source>" --run <runId> --template --json`.
The command returns its state path. Save your completed dossier as a different
file there so a subsequent template request cannot overwrite it.

```json
{
  "version": 1,
  "sourceSha256": "<exact hash returned by extraction>",
  "reviewedBlockIds": ["<every block actually read>"],
  "summary": "Private working summary; not published as uncited prose.",
  "sections": [{
    "heading": "Procedure or decision",
    "claims": [{
      "id": "stable-unique-label",
      "text": "A concise useful statement, without manual footnote labels.",
      "kind": "reported",
      "evidence": [{"blockId": "<id>", "quote": "<verbatim substring of that block>"}]
    }]
  }],
  "concepts": [{
    "term": "Domain term",
    "definition": "Short sourced meaning; not an invented expansion.",
    "evidence": [{"blockId": "<id>", "quote": "<verbatim evidence>"}]
  }],
  "corrections": [{
    "earlierBlockId": "<optional id>",
    "laterBlockId": "<id>",
    "note": "Explain the correction and use the corrected claim above."
  }],
  "openQuestions": ["An unresolved point explicitly separated from facts."]
}
```

Use `inferred` for deductions and explain why in the claim. There is no `verified`
option. Every claim has at least one real supporting quote. Exact-quote checking
cannot prove the quote supports the claim: the independent review must assess
scope, negations, speaker attribution and late corrections.

Review every normalised block, including the end. Save work between pages. If
coverage is incomplete, hand off the saved dossier/fragments and the next cursor;
do not manufacture a list of reviewed ids. Basic vocabulary is proposed in
pedagogical mode only when useful; seniority does not imply expertise everywhere.

The CLI makes footnotes, source ids and concept links. Do not handwrite local
links in claims or paste source paths into notes. External reference URLs may be
retained. Keep literal code and source quotations separate from explanatory prose.

A source reimported into the same target is a no-op for the same source hash.
`--reprocess` deliberately overrides this: inspect the diff to avoid duplicate
sections. Corrections to an existing KB statement are surfaced for human choice,
not silently overwritten by an automated contradiction heuristic.
