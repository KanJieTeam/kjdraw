# @kanjie/kjdraw-sdk

Local-first CAD documents, commands, transactions, editing and file adapters. Framework-independent ES modules with no runtime npm dependencies.

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

Apache-2.0. The current API baseline is 0.2.0; the repository release is a developer preview. DWG, complete DXF fidelity and a full CAD editor are not included guarantees. Plugin declarations and command confirmation metadata require host enforcement and are not security isolation.
