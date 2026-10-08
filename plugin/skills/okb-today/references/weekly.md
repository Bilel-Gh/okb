# Weekly review (about 20 minutes)

Run `okb weekly --json` (add `--days N` for another period). It writes nothing.
Walk through it in this order, one block at a time, waiting for the user:

1. **Inbox and suggestions**: open count and items waiting 21 days or more, and
   the suggestion cards waiting (`okb suggest list --json`). Offer to triage now
   with the `okb-capture` workflow, or to drop what no longer matters.
2. **Proposals waiting**: list them oldest first; offer `okb-review` for each.
   Never approve on the user's behalf.
3. **Re-read** (`toReview`, notes created 1, 7, 30 or 90 days ago): for up to
   three notes, ask one or two short questions with the `okb-learn` workflow, or
   just list the titles if the user is short on time.
4. **Maintenance and storage**: summarise errors and warnings by code; `SECRET_IN_NOTE` and
   broken links first; `okb brain check --json` for backups and moved notes;
   `okb scores --below 50 --json` for weak notes. Offer `okb-garden` for fixes.
5. **Focus and sessions**: `focus` says how old the focus note is; `sessions`
   lists this period's journaled sessions and their open "next time". Ask whether
   the focus is still right; if not, update it with the `okb-today` workflow
   (after the user agrees). No focus yet: offer `okb focus init`.
6. **Next week**: ask which one to three topics deserve attention and which
   sources to capture. Keep the answer in the conversation unless the user asks
   for a note (then prepare it with `okb-ingest`, template `decision` or `guide`).

End with a five-line recap. Do not create files, schedule tasks or change the
profile during the review; the focus note changes only when the user agrees.
