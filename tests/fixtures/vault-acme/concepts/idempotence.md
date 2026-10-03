---
type: Concept
title: Idempotence
description: Replaying the same operation without changing the result beyond the first application.
tags: [concept, reliability]
status: stable
generated: { by: "human:testuser", at: 2026-01-15T09:40:00Z }
x_okb:
  v: 1
  domain: reliability
  aliases: [Idempotency, Idempotent]
---

An operation is idempotent when running it twice leaves the system in the same
state as running it once.

# Where it is used

A retried delivery request carries an idempotency key, so the
[dispatcher](dispatcher.md) creates one job, not two.
