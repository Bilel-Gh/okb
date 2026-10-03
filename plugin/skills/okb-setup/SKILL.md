---
name: okb-setup
description: Install or reconfigure an okb profile — knowledge bundle location, language, concept-assist level, organisation policy overlay. Use when the user installs okb for the first time, adds a second profile, switches profile, or wants to change where the knowledge base lives or how much concept help they get. Do not use to ingest a source, to answer a question, or to change the content of a note.
---

# Install or reconfigure a profile

The product is generic; everything personal lives in a profile under `$OKB_HOME`
(default `~/.okb`). Re-running setup updates known keys and preserves every other
key the user added.

## Interview

Ask these once, in one message. Skip any the user already answered or supplied in
a file.

1. **Profile id** — lowercase, used as a folder name.
2. **Knowledge bundle root** — the directory holding the Markdown tree.
3. **Concept assist level** — ask explicitly, never choose silently:

   | Level | What it does |
   |---|---|
   | `off` | no detection, no insertion. Existing cards and links keep working. |
   | `targeted` | business vocabulary, internal terms, indispensable prerequisites. **Recommended.** |
   | `pedagogical` | targeted, plus the fundamental notions relevant to the subject. |

4. **Answer language** and the actor id to record in `generated.by`
   (`human:<id>`).
5. **Organisation overlay**, if the user has one. It can only narrow what the
   profile allows, never widen it.

A configuration file answers all of it without a questionnaire:

```bash
okb setup --from ./onboarding.yaml
```

## Apply

```bash
okb setup --profile <id> --kb-root <path> --concept-assist targeted \
  --human-actor human:<id> --answer-language fr --concepts-folder concepts
okb doctor
```

Then confirm what is on and what is off:

```bash
okb config show
```

Report `disabled` (capabilities left off because nothing configured them) and
`clamped` (settings an organisation policy narrowed). Do not present a clamped
value as a user choice.

## Second profile

```bash
okb setup --profile <other-id> --kb-root <other-path> --concept-assist off
okb setup switch <other-id>
```

Profiles never share state: proposals, approvals, caches and logs live under
`$OKB_HOME/profiles/<id>/state`.

## Changing the assist level later

- Globally: `conceptAssist.level` in the profile.
- Per domain: `conceptAssist.byDomain.<domain>`.
- For one import: `okb ingest … --concept-assist off`.

Turning it off stops new suggestions and insertions. Cards and links already in
the bundle keep working.
