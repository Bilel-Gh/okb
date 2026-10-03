---
name: okb-weekly
description: Run the weekly OKB review with the user — what waits in the inbox and in proposals, which notes to re-read while they are fresh, and what maintenance found. Use when the user wants a weekly or periodic review of their second brain. Do not use for a single question, a new source or a one-off audit.
---

# Weekly review (about 20 minutes)

> 📚 **Which KB.** Start your first reply with one line `📚 KB: <profile>` taken from `okb profile --json` (again after any `okb setup switch` or explicit `--profile`), so the user always sees which knowledge bundle is in use.

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
5. **Next week**: ask which one to three topics deserve attention and which
   sources to capture. Keep the answer in the conversation unless the user asks
   for a note (then prepare it with `okb-ingest`, template `decision` or `guide`).

End with a five-line recap. Do not create files, schedule tasks or change the
profile during the review.
