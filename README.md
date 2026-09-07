<p align="center"><img src="docs/assets/hero.svg" alt="KJDraw — Extensible CAD infrastructure for engineering applications and AI agents" width="100%"></p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-bcf878?style=flat-square&labelColor=17212f" alt="Apache 2.0"></a>
  <a href="docs/status.md"><img src="https://img.shields.io/badge/status-developer_preview-e8bc7b?style=flat-square&labelColor=17212f" alt="Developer preview"></a>
  <a href="https://github.com/KanJieTeam/kjdraw/actions/workflows/ci.yml"><img src="https://github.com/KanJieTeam/kjdraw/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://kanjieteam.github.io/kjdraw/"><img src="https://img.shields.io/badge/demo-open_playground-bdf878?style=flat-square&labelColor=17212f" alt="Open live playground"></a>
  <a href="docs/getting-started.md"><img src="https://img.shields.io/badge/runtime-browser_%2B_Node.js-7db9e4?style=flat-square&labelColor=17212f" alt="Browser and Node.js"></a>
</p>

<p align="center"><strong>Extensible CAD infrastructure for engineering applications and AI agents.</strong><br>Browser-native. Server-accelerated. Deploy anywhere.</p>
<p align="center"><a href="https://kanjieteam.github.io/kjdraw/"><strong>Live demo</strong></a> · <a href="#run-it-in-30-seconds">Run in 30 seconds</a> · <a href="docs/capability-matrix.md">Capabilities</a> · <a href="docs/architecture.md">Architecture</a> · <a href="docs/roadmap.md">Roadmap</a> · <a href="CONTRIBUTING.md">Contribute</a> · <a href="README.zh-CN.md">简体中文</a></p>

## Why KJDraw

Engineering teams need more than a picture of a drawing. They need geometry they can inspect, objects they can edit, revisions they can review, and files their users can take with them.

KJDraw is an open foundation for that workflow: a framework-independent TypeScript/ESM SDK, a Rust/WebAssembly kernel, deployment-provider contracts, and a real browser workbench built on the same public APIs. It grows out of **Kanjie (勘界)**, an engineering product, while the public core is deliberately general-purpose and independently useful.

Our ambition is to make reliable, programmable CAD accessible to the teams building the next generation of engineering tools—for people and for AI agents.

## Verified today

| 65 executable commands | 28 entity contracts | 93 automated tests | Bound agent plans |
| :---: | :---: | :---: | :---: |
| Transactions and editing | 2D plus bounded solid meshes | SDK, files, WASM and samples | Exact review → execute binding |

These are repository-backed counts, not a claim of complete CAD parity. See the machine-tested [capability matrix](docs/capability-matrix.md) and the honest [known limits](docs/status.md).

## Run it in 30 seconds

Try the browser workbench first: **[kanjieteam.github.io/kjdraw](https://kanjieteam.github.io/kjdraw/)**. This public deployment runs entirely in the browser and uploads no drawing data.

For SDK consumers, the prepared npm path is:

```sh
npm install @kanjie/kjdraw-sdk@next
```

```js
import { createKJDrawSDK } from '@kanjie/kjdraw-sdk'
const sdk = createKJDrawSDK()
const drawing = sdk.createDocument({ documentId: 'hello-cad' })
```

The package and guarded [npm publishing workflow](docs/npm-publishing.md) are ready; the command becomes available after KanJieTeam completes the first npm registry publication for the `@kanjie` scope. Until then, the repository checkout below is the verified zero-install path.

Install **Node.js 22 or newer**, then:

```sh
git clone https://github.com/KanJieTeam/kjdraw.git
cd kjdraw
node scripts/serve.mjs
```

Open **http://localhost:4173**. No package installation, account, model API key, or backend service is needed. A prebuilt WASM kernel is included; its Rust source is in this repository. Applications can later attach explicit project, compute or scene providers for self-hosted and cloud-assisted deployments.

The playground uses an original, synthetic field-station plan. Open or drop DXF/KJD/KJP files; create multiple drawings in one project; capture project-wide snapshots; draw lines, polylines, circles, arcs and text; Shift-select and transform object sets; toggle grid, object snap and orthographic constraints; edit layers and properties; measure geometry; undo changes; download a KJP project; or export the ASCII DXF core subset. In the **Agent Command Lab**, preview moving the survey-point layer, inspect the amber proposal, and explicitly confirm the change.

The command lab is a deterministic example of the agent protocol, not a connected language model. Files are processed in your browser. The playground does not upload drawings or include analytics. Download KJP before leaving the page to keep edits.

<p align="center"><img src="docs/assets/playground.png" alt="Actual KJDraw playground: editable synthetic field-station plan, layers, document inspector and Agent Command Lab" width="100%"></p>

<details><summary>See a command proposal before confirmation</summary>

![Actual command preview: proposed survey-point positions in amber](docs/assets/agent-preview.png)

</details>

## What you can build with it

| Foundation | Available in this preview |
| --- | --- |
| **Documents** | Stable object IDs and CAD handles; layers, blocks, model/paper spaces, resources and revisions |
| **Workbench** | Multi-drawing project tabs, project snapshots, multi-selection, drafting toggles, properties, measurements and responsive layouts |
| **Editing** | Atomic transactions, undo/redo, transforms, selection, snaps and a declared subset of trim/extend/offset/fillet operations |
| **File exchange** | JSON KJD documents, ZIP64 KJP projects, development ASCII DXF adapter with a [7-version synthetic corpus](docs/dxf-compatibility.md) |
| **Extensions** | Registries for commands, entities, file adapters and other extension points; plugin compatibility and permission declarations |
| **Agent interfaces** | One-shot [reviewed plans](docs/agent-protocol.md) bound to exact arguments, document fingerprint, revision, expiry and reviewer; execution receipts and undo |
| **Rust + WASM** | Document validation/revisions, primitive geometry queries, and experimental solid-mesh operations |
| **Typed integration** | TypeScript-owned Provider source, public declarations and reproducible browser ESM; [remaining modules migrate incrementally](docs/typescript-migration.md) |
| **Deployment providers** | Host-selected project storage, compute and scene contracts for local, self-hosted, cloud-assisted or hybrid applications |

**Developer preview:** API and file migration policies are still evolving. There is no certified public DWG backend, complete CAD plotting pipeline, or general BRep modeler. The reference workbench renders fewer entity variants than the SDK can store. Rust authority is scoped to implemented operations; many 2D edits remain JavaScript. See the [capability boundaries](docs/status.md) before using project deliverables in production.

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

## Deploy without rewriting the core

```text
Workbench · Your application · AI agents
                   │
        Documents + commands + files
                   │
       TypeScript SDK ↔ Rust / WASM
                   │
    ┌──────────────┼────────────────┐
Local project   Self-hosted      Cloud-assisted
   provider      providers          providers
```

KJDraw is deployment-neutral. The public demo needs no server; an embedding host can explicitly register project storage, compute or streamed-scene providers without forking the CAD core. Registration itself never initiates network access. Run `node examples/deployment-providers.mjs` and read the [deployment guide](docs/deployment.md).

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

The SDK now registers AI plans, binds approval to the exact command arguments, document fingerprint and revision, enforces expiry, and consumes each plan once before transactional execution. The host still owns identity, permissions and user confirmation; this is **not** a sandbox or cryptographic authorization system. The playground exposes a short binding digest for its local move example. Read the [agent protocol and security boundary](docs/agent-protocol.md).

Run the small [agent command example](examples/agent-command.mjs):

```sh
node examples/agent-command.mjs
```

## Open foundation, protected domain value

```text
Your application · Community plugins · Commercial products
                           │
           KJDraw Core + Workbench + contracts
                           │
          Domain extensions stay in separate packages
```

Kanjie is a downstream consumer of this public core. Shared CAD fixes belong here first; domain compilers, proprietary datasets, templates, customer systems and managed enterprise services stay separate. Other teams get the same general-purpose building blocks and extension interfaces without requiring Kanjie's private engineering layer.

Read the [architecture](docs/architecture.md), [open-source boundary](docs/open-source-boundary.md), [security architecture](SECURITY_ARCHITECTURE.md) and [downstream integration policy](docs/downstream.md).

## Develop and contribute

```sh
node scripts/test.mjs    # SDK, WASM artifact, and public sample tests
node --no-warnings scripts/build-typescript.mjs --check # TypeScript source/ESM parity
node scripts/audit-dxf-corpus.mjs # per-version DXF semantic preservation evidence
node scripts/check.mjs   # release metadata, local links, package boundaries
node scripts/build.mjs   # standalone static playground → dist/
```

We welcome reproducible DXF issues, small geometry fixes, documentation, accessibility improvements, and integrations. Use synthetic or explicitly redistributable files in public issues. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and the [roadmap](docs/roadmap.md).

**Maintained by [KanJieTeam](https://github.com/KanJieTeam)** · Contact: [kanjieteam@163.com](mailto:kanjieteam@163.com)

Apache License 2.0. See [LICENSE](LICENSE), [NOTICE](NOTICE), and [provenance](docs/provenance.md). The license covers this repository, not private Kanjie project data, commercial services, or third-party CAD resources.
