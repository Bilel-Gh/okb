---
name: okb-learn
description: Help the user learn and retain a note or topic from their OKB knowledge bundle by active recall — short questions one at a time, feedback grounded in the note's cited evidence, and the gaps left to explore. Use when the user wants to revise, be quizzed, check understanding or learn a concept from the KB. Do not use to add knowledge, answer a factual question once, or audit the KB, nor for another tool's or agent's knowledge base.
---

# Learn by recalling, not by re-reading

> 📚 **Before your first reply.** Run `okb profile --json` once and open with one line `📚 <KB name>` (add ` · 🎯 focus <n> j` when the focus is stale). If the session context lacks the user's OKB focus, `okb focus --context` gives it: use it silently. Speak the user's language.
> 🧭 **Choices are buttons.** Whenever the user must choose (which KB, which proposal, keep or drop, go or not), ask with AskUserQuestion: 2 to 4 options, the recommended one first with « (recommandé) », one question at a time.
> 🛡️ **Only OKB's own KBs.** Never read or write another tool's or agent's knowledge base (a support agent's KB, a wiki, another plugin's folder, `routing.otherKnowledgeTools`). If a request could concern one of them, ask which knowledge base is meant before acting.
> ✍️ **Format.** Short sections, a table for lists, quotations as `>` blocks with `path:line`, and a last line « ➡️ Prochaine étape : … ». OKB refuses secrets (`E_SECRET`): offer a placeholder such as `<API_KEY>`.

Work only from the KB: find the note with `okb ask "<topic>" --json` or read the
given note. Each fact you test must come from a claim of that note and its
quotation; never invent facts to make a question.

1. **Orient** (one message): what the note is for, in two sentences, and which
   concept cards it links to.
2. **Recall**: ask ONE question at a time, from simple to applied:
   definition, why it matters, how it works, a case from the user's own work.
   Wait for the answer. Do not reveal it first.
3. **Feedback**: say what is right, what is missing, then show the supporting
   passage from the note with its link. Rephrase with an analogy only if the
   user struggles, and say where the analogy stops.
4. After 3 to 6 questions, list what is solid, what to re-read (note sections),
   and open questions the note does not answer.

Write nothing by default. If the user wants to keep a gap or a correction,
capture it with `okb capture` (it lands in the private inbox) or prepare a
proposal with `okb-ingest`. Prefer short sessions; `okb weekly` lists notes due
for review (1, 7, 30, 90 days after creation).
