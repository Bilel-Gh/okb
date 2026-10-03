---
type: Concept
title: Dispatcher
description: The Acme component that assigns a delivery job to exactly one robot.
tags: [concept, fleet]
status: stable
generated: { by: "human:testuser", at: 2026-01-15T09:30:00Z }
x_okb:
  v: 1
  domain: fleet
  aliases: [Job dispatcher, Assigner]
  senses:
    - key: fleet
      domain: fleet
      summary: assigns delivery jobs to robots
  prereqs:
    - concepts/idempotence.md
---

The dispatcher is the single place that decides which robot runs which job.

# Why it exists

Without it, two depots could claim the same delivery.

# Where it is used

[Fleet overview](../architecture/fleet-overview.md) and
[Run a delivery job](../flows/run-a-delivery-job.md).
