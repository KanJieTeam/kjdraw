# Agent plan protocol

KJDraw gives AI agents the same versioned command surface used by UI and plugin clients, with an additional review boundary. An AI-origin command cannot mutate a document unless its exact proposal has first been registered, reviewed and confirmed.

## Lifecycle

```text
AI proposes a plan envelope
          │
          ▼
SDK binds command + arguments + document id + revision + fingerprint
          │
          ▼
Host renders a preview and records the human reviewer
          │
          ▼
SDK verifies the binding, expiry and current document state
          │
          ▼
Plan is consumed once → transaction commits → receipt → undo
```

`KJAgentPlanRegistry` is created by every SDK instance. Executing an AI `plan` envelope registers a short-lived record. Executing the corresponding confirmed envelope consumes that record before mutation.

The following cases fail closed:

- no registered plan or a different `planId`;
- changed command arguments, target document or expected revision;
- changed document fingerprint after preview;
- missing reviewer identity;
- expired, rejected or already consumed plan;
- replay of a previously successful execution envelope.

```js
const plan = sdk.createCommandEnvelope('MOVE', { ids, dx: 5, dy: 0 }, {
  mode: 'plan', origin: 'ai', expectedRevision: document.revision,
})
const preview = await sdk.executeCommandEnvelope(plan)
console.log(preview.result.binding, preview.result.expiresAt)

// Render the proposal and collect explicit host/user approval.
const execution = sdk.createCommandEnvelope(plan.command, plan.arguments, {
  origin: 'ai', expectedRevision: plan.expectedRevision,
  confirmation: { status: 'confirmed', planId: plan.id, confirmedBy: user.id },
})
const receipt = await sdk.executeCommandEnvelope(execution)
```

## Security boundary

This protocol prevents accidental argument substitution, stale-plan execution and replay inside one SDK host process. It is not authentication, a hostile-code sandbox or a distributed authorization system. The embedding host still owns user identity, permission checks, durable approval records, provider isolation and any cryptographic signing required across process or network boundaries.
