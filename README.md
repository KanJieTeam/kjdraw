<p align="center"><img src="docs/assets/hero.svg" alt="KJDraw — Local-first CAD infrastructure for engineering applications and AI agents" width="100%"></p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-bcf878?style=flat-square&labelColor=17212f" alt="Apache 2.0"></a>
  <a href="docs/status.md"><img src="https://img.shields.io/badge/status-developer_preview-e8bc7b?style=flat-square&labelColor=17212f" alt="Developer preview"></a>
  <a href="https://github.com/KanJieTeam/kjdraw/actions/workflows/ci.yml"><img src="https://github.com/KanJieTeam/kjdraw/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="docs/getting-started.md"><img src="https://img.shields.io/badge/runtime-browser_%2B_Node.js-7db9e4?style=flat-square&labelColor=17212f" alt="Browser and Node.js"></a>
</p>

<p align="center"><strong>Open engineering. Drawn forward.</strong><br>Build CAD into your application. Keep control of the document. Give agents an explicit command interface.</p>
<p align="center"><a href="#try-it-locally">Get started</a> · <a href="docs/architecture.md">Architecture</a> · <a href="docs/roadmap.md">Roadmap</a> · <a href="CONTRIBUTING.md">Contribute</a> · <a href="README.zh-CN.md">简体中文</a></p>

## Why KJDraw

Engineering teams need more than a picture of a drawing. They need geometry they can inspect, objects they can edit, revisions they can review, and files their users can take with them.

KJDraw is an open foundation for that workflow: a framework-independent JavaScript SDK, a Rust/WebAssembly kernel, and a small browser playground built on the same public APIs. It grows out of **Kanjie (勘界)**, an engineering workspace for geotechnical practice. The public core is intended to serve engineering applications well beyond that first use case.

Our ambition is to make reliable, programmable CAD accessible to the teams building the next generation of engineering tools—for people and for AI agents.

## Try it locally

Install **Node.js 22 or newer**, then:

```sh
git clone https://github.com/KanJieTeam/kjdraw.git
cd kjdraw
node scripts/serve.mjs
```

Open **http://localhost:4173**. No package installation, account, model API key, or backend service is needed. A prebuilt WASM kernel is included; its Rust source is in this repository.

The playground uses an original, synthetic field-station plan. Select objects, draw lines and circles, toggle layers, undo changes, download a KJP project, or export the ASCII DXF core subset. In the **Agent Command Lab**, preview moving the survey-point layer, inspect the amber proposal, and explicitly confirm the change.

The command lab is a deterministic example of the agent protocol, not a connected language model. Files are processed in your browser. The playground does not upload drawings or include analytics. Download KJP before leaving the page to keep edits.

<p align="center"><img src="docs/assets/playground.png" alt="Actual KJDraw playground: editable synthetic field-station plan, layers, document inspector and Agent Command Lab" width="100%"></p>

<details><summary>See a command proposal before confirmation</summary>

![Actual command preview: proposed survey-point positions in amber](docs/assets/agent-preview.png)

</details>

## What you can build with it

| Foundation | Available in this preview |
| --- | --- |
| **Documents** | Stable object IDs and CAD handles; layers, blocks, model/paper spaces, resources and revisions |
| **Editing** | Atomic transactions, undo/redo, transforms, selection, snaps and a declared subset of trim/extend/offset/fillet operations |
| **File exchange** | JSON KJD documents, ZIP64 KJP projects, development ASCII DXF adapter with explicit limitations |
| **Extensions** | Registries for commands, entities, file adapters and other extension points; plugin compatibility and permission declarations |
| **Agent interfaces** | Plan/execute envelopes, expected revisions, confirmation metadata and execution receipts |
| **Rust + WASM** | Document validation/revisions, primitive geometry queries, and experimental solid-mesh operations |

**Developer preview:** API and file migration policies are still evolving. There is no supported DWG backend, complete CAD plotting pipeline, or general BRep modeler. The minimal playground renders fewer entity types than the SDK can store. Rust authority is scoped to implemented operations; many 2D edits remain JavaScript. See the [capability boundaries](docs/status.md) before using project deliverables in production.

## Start with the SDK

From a checkout:

```js
import { createKJDrawSDK } from './packages/kjdraw-sdk/src/index.js'

const sdk = createKJDrawSDK()
const drawing = sdk.createDocument({ documentId: 'first-drawing', units: 'meter' })

const line = await sdk.executeCommand('CREATE', {
  type: 'LINE',
  payload: { start: [0, 0, 0], end: [100, 0, 0] },
})
await sdk.executeCommand('MOVE', { id: line.id, dx: 5, dy: 0 })
await sdk.executeCommand('UNDO')

const kjd = drawing.serialize({ pretty: true })
const dxf = await sdk.writeDocument(drawing, { format: 'DXF', version: '2018' })
```

See [Getting started](docs/getting-started.md) for package installation from a checkout, browser imports, and rebuilding WASM. This release does not assume a package has already been published on npm.

## Give agents a reviewable interface

```text
Application / plugin / agent
            │
      Command proposal
            │
      Host preview + user confirmation
            │
      Expected revision + transaction
            │
      Receipt · updated document · undo
```

The host owns identity, permissions and user confirmation. The SDK validates the command envelope and provides transactional changes. Confirmation metadata is **not** a sandbox or cryptographic authorization system. A host must bind approval to the exact proposed arguments and revision. The playground demonstrates that binding for its local move example.

Run the small [agent command example](examples/agent-command.mjs):

```sh
node examples/agent-command.mjs
```

## One core, many engineering workflows

```text
Your application        Kanjie        Community plugins
        └──────────────────┼─────────────────┘
                       KJDraw SDK
                    commands + documents
                            │
                  Rust / WebAssembly bridges
                            │
                   Local KJD / KJP files
```

Kanjie is a downstream consumer of this public core. Shared fixes and improvements belong here first; domain-specific workflows remain in their own packages. We want other teams to have the same building blocks and the same extension interfaces as the original application.

Read the [architecture](docs/architecture.md) and [downstream integration policy](docs/downstream.md).

## Develop and contribute

```sh
node scripts/test.mjs    # SDK, WASM artifact, and public sample tests
node scripts/check.mjs   # release metadata, local links, package boundaries
node scripts/build.mjs   # standalone static playground → dist/
```

We welcome reproducible DXF issues, small geometry fixes, documentation, accessibility improvements, and integrations. Use synthetic or explicitly redistributable files in public issues. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and the [roadmap](docs/roadmap.md).

**Maintained by [KanJieTeam](https://github.com/KanJieTeam)** · Contact: [hanwei5512@126.com](mailto:hanwei5512@126.com)

Apache License 2.0. See [LICENSE](LICENSE), [NOTICE](NOTICE), and [provenance](docs/provenance.md). The license covers this repository, not private Kanjie project data, commercial services, or third-party CAD resources.
