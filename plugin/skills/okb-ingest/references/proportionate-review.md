# Which review is needed?

Name the step, rather than saying “verification skipped”:

| Step | What it checks |
|---|---|
| Deterministic engine checks | Exact quotations, source hashes, block membership and coverage declarations, links, policy, secrets and preservation rules. These do not establish truth or entailment. |
| Editorial/evidence review | Whether a conclusion follows, ambiguities, omissions, late corrections, conflicting passages and useful wording. |
| Suggestion consent | Whether the person wants this knowledge change prepared. |
| Proposal review | The actual change, its source and effect, with its diff and limits. |
| Human approval/application | Authorization to write, then the protected write and receipt. |

Do not pay another model to repeat checks the engine already performs. A short
faithful excerpt without unresolved ambiguity may omit independent editorial
review: explicitly report deterministic checks and that prose still needs the
person's review. Never invent a quality grade when no reviewer produced it.

Use `okb:okb-quality-reviewer` or `okb:okb-evidence-reviewer` for a complete
long-source report, inferred technical conclusions, contradictory sources,
late corrections, uncertain commitments or a user request. Explain the reason
and send only the draft, cited passages and relevant counterevidence. These
cases need semantic judgment that quote matching cannot provide.

Editorial review grants no approval. Human consent and existing proposal/
approval/application protections remain in place. Resolve blocking findings
through a corrected proposal, not a direct KB edit. Keep the review short: the
change, source, consequence and limitation. Offer few changes, allow nothing to
keep, and honour refusal or “not now” without automatically repeating the same
unchanged offer.

Measure useful recovery time, review/maintenance time, total cost and quality
together. Local byte/token estimates do not prove billed-token savings or
product-market fit. A comparison to an assistant alone needs authorization
for actual calls and equivalent evidence/quality; do not substitute a smaller
retrieval payload for that experiment.
