# A ticket in a work brain

The ticket note lives at `2 Produits/<product>/Code/<repo>/Tickets/<year>/<REF> — <title>.md`
and follows the `ticket` template: **En bref**, the problem in plain words, the
resolution (`path:line`), the method followed, how it is tested, what was
learned. `okb template show ticket --example` is the model to imitate.

## Cards first, one list

At « j'ai fini », gather what deserves a note, then **one** multi-select question
(`okb suggest list --json` after adding each card), each line with its type,
place and cost, the total at the end:

| What happened | Card (`okb suggest add --type …`) | Level (the elevator) |
|---|---|---|
| the ticket itself | `ticket` `--repo <repo> --ref <REF>` | repository |
| a trap or a debugging step | dated section of `repo-debug`, or `known-error` | repository, or product when users see it |
| a business rule that changed | `business-rule` `--product <product>` | product |
| a flow across repositories | `flow` `--product <product>` | product |
| a method reusable elsewhere | `method` | toolbox |
| a word with no card | `concept` | toolbox / world |
| something the user is proud of | `achievement` (STAR: situation, task, action, result) | career |

Use `--signal ticket`; the journal's decisions become `--why`. Accept only the
selected ones (`okb suggest accept <id>`), then write each with `--suggestion
<id>` and, after `okb:okb-quality-reviewer`, `--quality <justness>`.

## Nothing reusable

Say so plainly and offer only the ticket note — or nothing.
