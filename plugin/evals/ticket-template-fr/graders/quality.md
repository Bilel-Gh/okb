---
type: llm
weight: 3
focus: { source: file, path: brouillon-ticket.md }
---
PASS if the note follows the ticket template: an « En bref » of three lines at most that says what it is and the thing to remember; the problem explained simply; the resolution citing `src/export/csv.ts` and why streaming fixes the memory; the method as reusable steps; the test from `tests/export.test.ts`. Every fact must come from the given context. FAIL if a required part is missing, if a fact is invented (another file, another figure, another ticket), or if the brief is longer than five lines.
