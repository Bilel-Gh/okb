---
name: okb-maintain
description: Audit an OKB knowledge bundle, prepare navigation updates, move notes with link rewrites or migrate legacy links. Use when checking broken links, ambiguous concepts, stale notes, prerequisite cycles or KB organisation. Do not use for a new source, a knowledge question or a software installation problem.
---

# Maintain the bundle

Run `okb maintain --json` and `okb links check --json`.
Separate OKF conformance, configured product rules, and consistency findings.
A structurally valid document can still be wrong or stale. A date or unchanged
hash is never proof of current truth. Surface contradictions and cycles without
inventing a resolution. Unknown optional OKF fields must survive edits.

Mechanical operations prepare ordinary proposals:

- `okb nav --json`: navigation indexes; inspect any replacement of a custom index.
- `okb links move old/note.md new/note.md --json`: all inbound and outbound links;
  refuse an existing destination. The complete move must be selected together.
- `okb migrate portable-links --json`: AST-based rewrites; ambiguous or missing
  targets are listed for a human decision. Quotes and code stay untouched.

Use `okb-review` for the returned proposal id. `--write` is retained only as a
compatibility spelling and never bypasses review. Do not write Markdown directly.
After apply, rerun the link audit. Provide the receipt for rollback. No commit,
push, remote creation or source-code execution from notes is part of maintenance.
