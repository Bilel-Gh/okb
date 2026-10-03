---
name: okb-ask
description: Answer a question from the user's OKF knowledge bundle, quoting located evidence with file paths and line numbers. Use when the user asks what the knowledge base says about a topic, wants to find a note, or asks a question their knowledge base is likely to cover. Do not use for general world knowledge, for questions about code in the open repository, or when the user is adding content rather than retrieving it.
---

# Answer from the knowledge bundle

## Steps

1. Retrieve. The command returns hits, located excerpts and prerequisites:

   ```bash
   okb ask "<the user's question>" --json --limit 8
   ```

2. Read the matching files only when an excerpt is not enough. Paths come from
   the JSON; do not glob the vault.

3. Answer with attribution. Each claim names the document it came from, as a
   relative Markdown link when you are writing into a note, as a plain path when
   you are answering in chat.

4. Qualify the trust level, every time:

   | Signal | How to say it |
   |---|---|
   | `status: draft` | "written but not checked against the system" |
   | `trust: unverified` | "reported, not confirmed" |
   | `trust: machine-confirmed` | "confirmed by a process, not by a person" |
   | stale (`notes` mentions it) | "the freshness date has passed; the content may still be true" |

5. When `hits` is empty, say the bundle does not cover it. Offer to ingest a
   source. Do not answer from memory and present it as knowledge-base content.

6. If `truncation.truncated`, say how many results are hidden and offer
   `--cursor <nextCursor>`.

## Gaps

`prerequisites` lists concept cards worth reading first. If a term in the
question has no card, mention it once and offer to create one through
`okb-ingest`; do not create anything here — `ask` never writes.
