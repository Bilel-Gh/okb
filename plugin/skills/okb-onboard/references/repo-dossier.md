# Repository dossier v3 and findings

## Dossier v3

`okb repo template <kind> --json` writes a skeleton in the repository's drafts
folder. Save your completed dossier as another file, then
`okb repo write --analysis-file <file> [--after prepared] --json`.

```json
{
  "version": 3,
  "repo": "<repository id>",
  "note": "overview | start | architecture | interfaces | delivery | codemap | ticket",
  "template": "repo-overview",
  "style": { "...": "copied unchanged from the skeleton" },
  "read": [{ "file": "srv/service.js" }, { "file": "README.md", "lines": ["1-80"] }],
  "sections": [{
    "role": "how",
    "claims": [{
      "id": "how-credit-check",
      "text": "Before saving an order, the service refuses it when the customer's credit limit is exceeded.",
      "kind": "reported",
      "evidence": [{ "file": "srv/orders-service.js", "lines": "17", "quote": "if (!ok) return req.error(409, 'Credit limit exceeded');" }]
    }],
    "aids": [
      { "type": "explanation", "text": "Plain-language framing.", "basedOn": ["how-credit-check"] },
      { "type": "diagram", "caption": "What it shows", "basedOn": ["…"],
        "mermaid": "flowchart LR\n  UI[Fiori app] --> SRV[OrdersService]\n  SRV --> BP[S/4HANA BP]",
        "nodes": { "UI": "app/orders/", "SRV": "srv/orders-service.js", "BP": "external:S/4HANA (destination S4_BP)" } }
    ]
  }],
  "concepts": [{ "term": "Business partner", "aliases": ["BP"], "definition": "…", "evidence": [{ "file": "…", "quote": "…" }] }],
  "corrections": [{ "note": "The README says npm run seed; package.json has no seed script.", "evidence": [{ "file": "README.md", "quote": "npm run seed" }, { "file": "package.json", "quote": "\"scripts\"" }] }],
  "unknowns": [{ "question": "q-deploy", "text": "Who deploys to production, and how?", "askWho": "@acme/platform-team (CODEOWNERS)", "looked": ["README.md", ".github/workflows/ci.yml", "mta.yaml"] }],
  "answers": ["q-purpose", "q-flows"],
  "related": [{ "path": "repos/<id>/architecture.md", "relation": "next", "why": "…" }]
}
```

**Evidence is code addressing.** `file` is relative to the repository root
(an outside source — transcript, answer file, ticket context — by its absolute
path). `quote` is copied **exactly** from the current file (same spaces and
punctuation; one to three lines is enough). `lines` is optional: OKB finds the
quote and records its lines; when given, the quote must be there or OKB says
where it found it. A quote that is not in the file stops the proposal.

**Facts and aids.** Claims carry facts with evidence; `inferred` marks a
deduction (say why in the text). Aids (explanation, analogy with `limits`,
example, diagram) rephrase the claims in `basedOn` and add no fact. A diagram is
bare Mermaid (flowchart, sequenceDiagram, erDiagram), ≤ 12 boxes; with `nodes`,
**every** box it draws must map to a repository path (file or folder) or to
`external:<name>` for a system outside the repository — OKB checks both.

**Templates fix the sections.** Use the roles of the skeleton in their order;
drop optional ones you cannot fill; free sections have a `heading` and no role.

**Questions.** `answers` lists the onboarding questions this note answers
(OKB tracks them). `unknowns` are questions the repository does not answer:
they render as open questions with whom to ask and where you looked.

**Several notes in one session.** `--after prepared` lets a note link to notes
and concept cards prepared earlier; `okb combine <ids…>` then makes one review.

## Findings

What a reading agent returns for one area; save it with
`okb repo findings add <file> --json` (quotes are checked, lines filled in,
coverage recorded).

```json
{
  "version": 1,
  "repo": "<repository id>",
  "area": "srv",
  "read": [{ "file": "srv/orders-service.js", "lines": "all" }, { "file": "srv/big.js", "lines": ["1-120", "300-340"] }],
  "facts": [{
    "question": "q-flows",
    "topic": "order creation",
    "text": "Creating an order computes the total, then checks the customer's credit against S/4HANA.",
    "kind": "reported",
    "evidence": [{ "file": "srv/orders-service.js", "quote": "req.data.total = computeTotal(items);" }]
  }],
  "unknowns": [{ "question": "q-monitor", "text": "No logging or monitoring configuration in this area.", "looked": ["srv/"] }],
  "terms": [{ "term": "Credit limit", "meaning": "Maximum amount a customer may order on credit.", "evidence": [{ "file": "db/schema.cds", "quote": "creditLimit : Decimal(15, 2);" }] }],
  "incomplete": false
}
```

`read` is what the agent actually read (`all` or line ranges) — a declaration
the open-questions note reports, never a guess. `incomplete: true` when the
budget ran out: say what is left.
