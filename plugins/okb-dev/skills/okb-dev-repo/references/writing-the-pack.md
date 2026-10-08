# Writing the repository pack

Seven notes in `repos/<id>/`, each with a job. The reader is a developer who
knows how to program but not this repository, nor its business. Every note must
let them *do* something sooner.

| Note | Its job | Must contain |
|---|---|---|
| `start` — Démarrer | Run, test and debug it on day one | access to request, tools with versions, exact commands in order, what `run` needs, how to test, where logs are, a first-week path |
| `architecture` | See how it is built | context diagram, module diagram (boxes = folders), 2–3 sequence diagrams of real flows, data model (erDiagram), integrations, choices with reasons, sensitive areas |
| `interfaces` | Know what breaks whom | every exposed service/route/event with its declaration, every consumed system with how (destination, URL variable, binding, auth), roles and scopes |
| `delivery` | Configure and ship it | variables (names only, which are sensitive), destinations, environments, CI stages, deployment (who, how), monitoring |
| `codemap` | Find where to change things | folder → responsibility, central files, « pour … → fichier:fonction » entries, conventions, people, traps |
| `overview` — Comprendre en 10 minutes | Understand it in one read | business purpose, users, context diagram, the main flow in 3–6 steps, stack, words to know, what is *not* here, where to go next |
| open questions (generated) | Know what nobody wrote down | built by `okb repo questions --propose` from your `unknowns` |

## Rules that make the difference

- **Business first.** Start from what the repository does for whom (README,
  service names, UI texts in `i18n`, entity names), then the technique.
- **One fact per claim, cited at the line.** Commands from `package.json` or the
  Makefile cite the script line; behaviour cites the code that does it, not a
  comment that says it should.
- **Flows from the code, not from names.** A sequence diagram follows calls you
  read: participant = file or system (`nodes`), arrow = a call you can cite.
  Between repositories, `okb arch flow --json` gives the calls already matched
  (route here, call there); its `questions` are unknowns, never arrows.
- **Docs are claims too.** A README says what someone believed; when the code
  disagrees, write both in `corrections`. A command not run yet is « d'après le
  README » (or « d'après package.json »).
- **Inferred is allowed, labelled.** « Probablement… parce que … » → `kind:
  inferred` with the reasoning in the text and the evidence it rests on.
- **Unknowns are useful.** Access rights, who deploys, production monitoring,
  business rules not in the code: an `unknown` with `askWho` (CODEOWNERS, Git
  facts) and `looked` is worth more than a vague sentence.
- **Teach.** Define each business term at first use; 3–8 concept cards for the
  terms the reader meets everywhere (entities, statuses, partner systems). An
  analogy states its `limits`. An `example` uses this repository's real names.
- **Keep it short.** Overview ≤ ~60 lines of reading; diagrams ≤ 12 boxes; tables
  for lists. Long details belong in architecture or interfaces, linked.
- **Link the pack.** `related`: overview → start (next), → architecture (deeper);
  start → codemap (next); each note → open questions when it has unknowns.

## Per note

**start.** `access` (accounts, BTP subaccount/space roles, destinations to see,
repository rights — often unknown: ask), `prerequisites` (Node/Java/… versions
from `engines`, `.nvmrc`, `pom.xml`; CLIs: cds, mbt, cf, docker), `install`
(clone, `npm ci`…), `run` (the start command, what it starts, default port,
mocked or real services: CAP profiles, `default-env.json` needed?), `test`,
`debug` (logs, debugger, `DEBUG=` variables), `firstweek` (an `example` aid: run
it, follow flow X from file A to file B, read test T, try a small change).

**architecture.** `context` (C4 level 1: users, this system, every neighbour
with its declaration), `modules` (flowchart of folders with `nodes`), `flows`
(one sequenceDiagram per main flow, participants tied to files), `data`
(erDiagram of the main entities from the schema), `integrations`, `decisions`
(ADRs, transcript explanations; reasons only if a source gives them),
`fragile` (central files from the scan, hotspots, TODO, long files).

**codemap.** `where` is the most valuable section for a first ticket: one claim
per common change — « ajouter un champ à une commande → `db/schema.cds`
(entité `Orders`) puis l'annotation UI dans `app/…` », each cited.

**overview.** Written last, from the other notes' findings. It must stand alone:
someone who reads only it can explain the repository to a colleague.

## Tickets (`/okb-dev:ticket`)

A `ticket` note (`--note ticket --title "…"`): the need (ticket text from the
context file, cited by absolute path), what changed (final code), how it is
tested, what to remember. Reusable knowledge also goes into `codemap` as a dated
section (`--heading "Ticket … (date)"`).
