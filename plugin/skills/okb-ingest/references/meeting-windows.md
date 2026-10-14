# Long meeting windows

Use the source snapshot and timecoded blocks returned by `okb ingest <source>
--extract-only --json`. Preserve the original; do not deduplicate or rewrite
caption blocks used as evidence. The run freezes bytes and extractor version.
Read a changed file in a new run, without the old `--run`.

For a **question**, add `--query "<terms>" --run <run>`. Search is lexical;
synonyms and complementary reading may be needed. A passage, even with a valid
quotation, does not prove the answer follows. Report missing or contrary evidence.

For a **complete report**, read each delivered page and save a result outside
the knowledge bundle. Each page has `window.id`; submit that exact id:

```json
{
  "windowId": "<returned window id>",
  "facts": [
    {
      "id": "retention-initial",
      "kind": "fact",
      "text": "The initial retention period was thirty days.",
      "evidence": [{"blockId": "<returned block id>", "quote": "<exact quotation>"}]
    }
  ]
}
```

Submit with `okb ingest <source> --extract-only --run <run> --window-result
<result.json> --json`. An empty `facts` array explicitly means nothing to retain
from a window that was nevertheless read. The ledger validates quotations and
window membership, not semantic completeness. Result kinds are `fact`,
`decision`, `action`, `suggestion`, `question`, `uncertainty`, `correction`.
Only an explicit `action` may have `owner` and `due`; these must appear in the
evidence (a named speaker may identify the owner). Never turn a suggestion into
an undertaking or invent an acronym expansion.

Continue with `--cursor <nextCursor> --run <run>`. `--coverage` reports delivered
and caller-reported processed blocks separately, including unprocessed ranges.
`--meeting-report` pages the accumulated facts. Read every fact page before
merging the report; use `truncation.nextCursor`. `coverage.complete` covers all
valid **extracted** blocks; partial extraction still has limitations.

A later correction uses a new fact id, quotes the later window and declares
`"supersedes": ["retention-initial"]`. Keep the original fact and evidence:
the report labels it `superseded` and names its replacement. Do not infer
supersession from a lexical candidate alone. If the correction only applies
under certain conditions, state them; unresolved contradictions stay visible.
The merged facts are input to the existing analysis dossier/proposal workflow,
never an automatic KB write or approval. Full-report editorial review considers
the final correction, initial statement, unknowns and extraction limitations.

Repeating a result updates the same issued window; it creates no duplicate
facts. Unique fact ids span the run. A referenced fact cannot be removed by
accident. Cache and checkpoints invalidate on source/extractor changes. The
CLI bounds extraction, search and report envelopes with an estimated token
budget; “delivered” and “reported processed” remain distinct from proven reading.
