# @kanjie/kjdraw-sdk

Extensible CAD documents, commands, transactions, editing, file adapters, deployment providers and review-bound agent plans. Framework-independent ES modules with no runtime npm dependencies.

Install the current developer preview from npm's `next` channel:

```sh
npm install @kanjie/kjdraw-sdk@next
```

The package ships TypeScript declarations and TypeScript-owned source slices. Runtime modules remain standards-based ESM during the incremental migration, so browser and Node.js consumers do not need a framework wrapper.

Part of [KJDraw](https://github.com/KanJieTeam/kjdraw). See the repository README and `docs/getting-started.md` for the playground, optional Rust/WASM backend, and preview limitations.

```js
import { createKJDrawSDK } from '@kanjie/kjdraw-sdk'
const sdk = createKJDrawSDK()
const drawing = sdk.createDocument({ documentId: 'demo' })
await sdk.executeCommand('CREATE', {
  type: 'LINE', payload: { start: [0, 0], end: [100, 0] },
})
console.log(drawing.serialize())
```

Run the packaged example with `node node_modules/@kanjie/kjdraw-sdk/examples/quickstart.mjs`. It creates and moves real geometry, performs a KJD reopen and prints a JSON result.

Apache-2.0. The package version follows the repository release. This is a developer preview: DWG, arbitrary-DXF fidelity, certified plotting and general BRep are not included guarantees. Agent plan binding strengthens review workflows but does not replace host identity, permissions or isolation.
