---
name: okb-weekly
description: Run the weekly OKB review with the user — what waits in the inbox and in proposals, which notes to re-read while they are fresh, and what maintenance found. Use when the user wants a weekly or periodic review of their second brain. Do not use for a single question, a new source or a one-off audit.
---

# Weekly review (about 20 minutes)

> 📚 **Before your first reply.** Run `okb profile --json` once and open with one line `📚 <KB name>` (add ` · 🎯 focus <n> j` when the focus is stale). If the session context lacks the user's OKB focus, `okb focus --context` gives it: use it silently. Speak the user's language.
> 🧭 **Choices are buttons.** Whenever the user must choose (which KB, which proposal, keep or drop, go or not), ask with AskUserQuestion: 2 to 4 options, the recommended one first with « (recommandé) », one question at a time.
> 🛡️ **Only OKB's own KBs.** Never read or write another tool's or agent's knowledge base (a support agent's KB, a wiki, another plugin's folder, `routing.otherKnowledgeTools`). If a request could concern one of them, ask which knowledge base is meant before acting.
> ✍️ **Format.** Short sections, a table for lists, quotations as `>` blocks with `path:line`, and a last line « ➡️ Prochaine étape : … ». OKB refuses secrets (`E_SECRET`): offer a placeholder such as `<API_KEY>`.

Run `okb weekly --json` (add `--days N` for another period). It writes nothing.
Walk through it in this order, one block at a time, waiting for the user:

1. **Inbox**: open count and items waiting 21 days or more. Offer to triage now
   with the `okb-inbox` workflow, or to drop what no longer matters.
2. **Proposals waiting**: list them oldest first; offer `okb-review` for each.
   Never approve on the user's behalf.
3. **Re-read** (`toReview`, notes created 1, 7, 30 or 90 days ago): for up to
   three notes, ask one or two short questions with the `okb-learn` workflow, or
   just list the titles if the user is short on time.
4. **Maintenance**: summarise errors and warnings by code; `SECRET_IN_NOTE` and
   broken links first. Offer `okb-maintain` for fixes.
5. **Focus and sessions**: `focus` says how old the focus note is; `sessions`
   lists this period's journaled sessions and their open "next time". Ask whether
   the focus is still right; if not, update it with the `okb-focus` workflow
   (after the user agrees). No focus yet: offer `okb focus init`.
6. **Next week**: ask which one to three topics deserve attention and which
   sources to capture. Keep the answer in the conversation unless the user asks
   for a note (then prepare it with `okb-ingest`, template `decision` or `guide`).

End with a five-line recap. Do not create files, schedule tasks or change the
profile during the review; the focus note changes only when the user agrees.
