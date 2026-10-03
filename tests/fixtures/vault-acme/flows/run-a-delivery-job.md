---
type: Runbook
title: Run a delivery job
description: What happens between a delivery request and the signed receipt.
tags: [flow, delivery]
status: draft
generated: { by: "human:testuser", at: 2026-01-15T10:00:00Z }
x_okb:
  v: 1
  domain: fleet
  prereqs:
    - concepts/idempotence.md
    - concepts/dispatcher.md
---

The sequence from a customer request to a signed receipt.

# Steps

1. The customer service creates a delivery request.
2. The dispatcher picks a free robot in the nearest depot.
3. The robot drives, then uploads a receipt over the telemetry channel.

# Retry behaviour

A retried request carries the same idempotency key, so the dispatcher does not
create a second job.
