---
description: Check the okb installation, configuration, adapters and context footprint.
disable-model-invocation: true
---

Run `okb doctor --json` and `okb context --json`, then summarise:

1. Every failing or unknown check, with its hint.
2. The declared source support matrix — say which kinds are enabled and what each
   adapter cannot do.
3. The context footprint. Byte counts are measured; token counts are estimated
   with a fixed divisor and no tokenizer — never present them as measured.
4. Anything reported as `unknown` (runtime identity, MCP discovery) stays unknown;
   do not infer it.

Do not change configuration here. If a check fails because no profile exists, point
at the `okb-setup` skill.
