---
type: Architecture
title: Fleet overview
description: How depots, the dispatcher and delivery robots fit together at Acme Robotics.
tags: [architecture, fleet]
status: stable
generated: { by: "human:testuser", at: 2026-01-15T09:00:00Z }
verified: { by: "human:testuser", at: 2026-01-16T09:00:00Z }
x_okb:
  v: 1
  domain: fleet
  prereqs:
    - concepts/dispatcher.md
---

A depot holds robots. The dispatcher assigns jobs. Robots report through the
telemetry channel.

# Components

| Component | Role |
|---|---|
| Depot | Physical site where robots are docked and charged. |
| Dispatcher | Assigns a delivery job to exactly one robot. |
| Robot | Executes the job and reports progress. |

# Example payload

```json
{ "jobId": "J-1001", "robotId": "R-07", "idempotencyKey": "abc" }
```

> "The dispatcher never assigns the same job twice."
> — Acme internal note, quoted verbatim

# See also

- [Run a delivery job](../flows/run-a-delivery-job.md)
- [Dispatcher](../concepts/dispatcher.md)

# Sources

- Acme Robotics internal handbook, 2026 edition.
