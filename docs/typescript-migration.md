# TypeScript source migration

KJDraw is moving the SDK to TypeScript-owned source without breaking its zero-install browser demo or existing ESM consumers.

## Source authority

Modules listed in `scripts/build-typescript.mjs` are owned by their `.ts` file. Their neighboring `.js` file is a committed browser/Node artifact and starts with a generated-file warning. Do not edit that JavaScript directly.

The first two migrated vertical slices are the deployment Provider system and the Agent plan registry:

- `deployment.ts` defines typed deployment modes, profiles and project-store, compute and scene Provider interfaces.
- `deployment.js` is reproducibly generated and remains the stable runtime import.
- `agent-plans.ts` defines the typed, review-bound plan lifecycle; `agent-plans.js` is its generated runtime artifact.
- the published declaration bundle exposes the same Provider contracts.
- CI fails if the committed ESM differs from the TypeScript source.

Build or verify generated ESM with Node.js 22 or newer:

```sh
node --no-warnings scripts/build-typescript.mjs
node --no-warnings scripts/build-typescript.mjs --check
```

The build uses Node's type-stripping transform and requires no installed package to reproduce the runtime artifact. KJDraw deliberately avoids TypeScript-only runtime constructs in migrated modules. This is a source migration mechanism, not a claim that the whole SDK is already TypeScript-owned; remaining JavaScript modules are migrated incrementally behind the same parity gate.
