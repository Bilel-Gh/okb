---
description: Where the current repository's knowledge base stands — notes, coverage, open questions — and what to do next, as buttons.
disable-model-invocation: true
---

Use the `okb-guide` skill for the current code repository: run `okb repo status --json` in the current folder (not registered: `okb repo list --json` and offer `/okb-dev:onboard`).
Show, in a few lines: the repository and its KB, which notes exist, how much was read, the onboarding questions answered and open, notes that may be outdated, proposals waiting. Then ask ONE question with buttons (AskUserQuestion), recommended first: continue or refresh the onboarding (`/okb-dev:onboard`), answer open questions (`okb repo questions`), enrich after a ticket (`/okb-dev:ticket`), or open the notes (`okb serve`). The user adds: $ARGUMENTS
