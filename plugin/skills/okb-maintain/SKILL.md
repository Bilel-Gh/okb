---
name: okb-maintain
description: Audit an OKB knowledge bundle, prepare navigation updates, move notes with link rewrites or migrate legacy links. Use when checking broken links, ambiguous concepts, stale notes, prerequisite cycles or KB organisation. Do not use for a new source, a knowledge question or a software installation problem, nor for another tool's or agent's knowledge base.
---

# Maintain the bundle

> 📚 **Before your first reply.** Run `okb profile --json` once and open with one line `📚 <KB name>` (add ` · 🎯 focus <n> j` when the focus is stale). If the session context lacks the user's OKB focus, `okb focus --context` gives it: use it silently. Speak the user's language.
> 🧭 **Choices are buttons.** Whenever the user must choose (which KB, which proposal, keep or drop, go or not), ask with AskUserQuestion: 2 to 4 options, the recommended one first with « (recommandé) », one question at a time.
> 🛡️ **Only OKB's own KBs.** Never read or write another tool's or agent's knowledge base (a support agent's KB, a wiki, another plugin's folder, `routing.otherKnowledgeTools`). If a request could concern one of them, ask which knowledge base is meant before acting.
> ✍️ **Format.** Short sections, a table for lists, quotations as `>` blocks with `path:line`, and a last line « ➡️ Prochaine étape : … ». OKB refuses secrets (`E_SECRET`): offer a placeholder such as `<API_KEY>`.

Run `okb maintain --json` and `okb links check --json`.
Separate OKF conformance, configured product rules, and consistency findings.
A structurally valid document can still be wrong or stale. A date or unchanged
hash is never proof of current truth. Surface contradictions and cycles without
inventing a resolution. Unknown optional OKF fields must survive edits.
`STYLE_DIFFERS` is a candidate for a requested revision, never permission to
rewrite the bundle. `TEMPLATE_UNKNOWN` and `TEMPLATE_DRIFT` report absent models
or lost required headings; read `okb template show <id>` before proposing a fix.
KB-local models live in `.okb/templates/<id>.yaml`; changing one does not rewrite
notes. Template checks do not assess semantic completeness or all section order.

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
