---
name: okb-learn
description: Help the user learn and retain a note or topic from their OKB knowledge bundle by active recall — short questions one at a time, feedback grounded in the note's cited evidence, and the gaps left to explore. Use when the user wants to revise, be quizzed, check understanding or learn a concept from the KB. Do not use to add knowledge, answer a factual question once, or audit the KB.
---

# Learn by recalling, not by re-reading

> 📚 **Which KB.** Start your first reply with one line `📚 KB: <profile>` taken from `okb profile --json` (again after any `okb setup switch` or explicit `--profile`), so the user always sees which knowledge bundle is in use. If the session context does not already hold the user's OKB focus, `okb focus --context` gives it: use it silently to choose examples and priorities.

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
