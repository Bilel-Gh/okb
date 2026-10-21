# Complete a ticket's sheet

The sheet is the ticket's single truth (`okb ticket sheet <ref> --json`): each
field keeps its origin, a value the person wrote is never replaced, the next
step is the first open todo. The session brief lists **open requests**; handle
them, or the user's « complète ce ticket ».

1. Read the sheet and `okb ticket requests list --json`.
2. Look at the tools **you actually have in this session**: a Jira, ServiceNow
   or wiki MCP, a skill. Read only. Never write to Jira or ServiceNow. No tool,
   refused access, ticket not found: say so; it is not a failure of the work.
3. For each value found: `okb ticket set <ref> --field title|summary|description|sourceStatus|team|product|done|blocker --value "…" --origin jira|servicenow|wiki|agent --url <page> --json`.
   Team and product are often the source's assignment group and component.
   Summary: problem and goal in 1 to 3 sentences, not the reference. A refused
   value (empty, « unknown », the reference) stays undefined: never invent one.
   A conflict returned means the person wrote another value: leave it for them.
4. From the session: what was really done and tested (`done`), the blocker or
   « Aucun blocage », decisions (`okb ticket note … --kind decision`), and the
   todos that matter: `okb action add "<what>" --ticket <ref> --importance high|medium|low`.
5. Close each request with an honest report:
   `okb ticket requests close <id> --found a,b --missing c --read jira --unavailable servicenow --note "…" --json`.
   Never list a source you could not read in `--read`.
6. Tell the person in three lines what was filled (with its source), what is
   still missing, and the completeness: « Contexte renseigné : N % ».

A note written for the ticket carries `tickets: [<REF>]` in its `x_okb`
metadata (the resume proposal does it): it then appears on the sheet wherever
it is filed. `okb ticket links scan` suggests links from notes that only
mention the reference; the person confirms them.
