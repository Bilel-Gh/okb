# Acme Robotics — dispatcher notes

The dispatcher assigns one job per robot. Idempotence matters because the
customer service retries aggressively.

## Code sample

```js
// The word Idempotence inside a fence must never be linked.
const dispatcher = createDispatcher({ idempotence: true });
```

> "The telemetry channel is one-way."
> — verbatim quote that must stay untouched

Later in the document the dispatcher appears again, and idempotence too.
