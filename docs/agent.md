# KJDraw Agent integration contract

This page is the stable entry point for an AI agent or host that needs to inspect, propose, approve and deliver KJDraw changes. The public unit of change is a command envelope; the portable unit of delivery is a KJP project artifact.

## Command-plan lifecycle

1. Read the current document identity, revision and relevant objects.
2. Create an AI-origin command envelope in `plan` mode with exact arguments and `expectedRevision`.
3. Execute the plan envelope to register a short-lived proposal and receive its content binding.
4. Present the exact proposed change to a human reviewer.
5. Create a confirmed execution envelope that references the original `planId` and reviewer identity.
6. Execute once, retain the receipt, then save or package the resulting project.

The SDK binds command, arguments, document identity, complete document digest, fingerprint, revision and expiry. A changed document or proposal requires a new review. Successful execution produces a revisioned receipt and remains undoable through the ordinary command history.

```ts
const plan = sdk.createCommandEnvelope('MOVE', { ids, dx: 5, dy: 0 }, {
  mode: 'plan',
  origin: 'ai',
  expectedRevision: document.revision,
})

const preview = await sdk.executeCommandEnvelope(plan)

const execution = sdk.createCommandEnvelope(plan.command, plan.arguments, {
  origin: 'ai',
  expectedRevision: plan.expectedRevision,
  confirmation: {
    status: 'confirmed',
    planId: plan.id,
    confirmedBy: reviewerId,
  },
})

const receipt = await sdk.executeCommandEnvelope(execution)
```

## KJP artifact contract

A KJP file is the preferred portable handoff when the result includes one or more drawings, project metadata, snapshots, assets or a command journal. The deterministic ZIP64 package carries integrity hashes and configurable read budgets.

For an automated handoff, report:

- the KJP filename and byte length;
- project and active-document identifiers;
- the final document revision and fingerprint;
- the execution receipt or its durable host-side reference;
- validation results and any file-format diagnostics.

The headless CLI can inspect and validate an artifact without opening the workbench:

```sh
npx @kanjieteam/kjdraw@next inspect result.kjp
npx @kanjieteam/kjdraw@next validate result.kjp
```

## Host-owned controls

The host supplies user identity, authorization, model/tool isolation, durable approval records, storage policy and any cross-process signing. Keep customer data out of public issues and use synthetic or explicitly redistributable fixtures for reproduction.

Continue with the [full Agent protocol](agent-protocol.md), [KJP and file guide](https://kanjieteam.github.io/kjdraw/docs/latest/files/), and generated [`KJAgentPlanRegistry` API](https://kanjieteam.github.io/kjdraw/docs/latest/api/reference/#agent-plans-class-kjagentplanregistry).
