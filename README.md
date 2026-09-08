<p align="center"><img src="docs/assets/hero.svg" alt="KJDraw — CAD infrastructure for engineering applications and AI agents" width="100%"></p>

<p align="center">
  <a href="https://github.com/KanJieTeam/kjdraw/actions/workflows/ci.yml"><img src="https://github.com/KanJieTeam/kjdraw/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/@kanjieteam/kjdraw"><img src="https://img.shields.io/npm/v/@kanjieteam/kjdraw?style=flat-square&label=npm&labelColor=30363d&color=2863f0" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@kanjieteam/kjdraw"><img src="https://img.shields.io/npm/dm/@kanjieteam/kjdraw?style=flat-square&label=downloads&labelColor=30363d&color=2863f0" alt="npm downloads"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-2863f0?style=flat-square&labelColor=30363d" alt="Apache 2.0"></a>
  <a href="https://kanjieteam.github.io/kjdraw/"><img src="https://img.shields.io/badge/▲_Live_Demo-open-2863f0?style=flat-square&labelColor=30363d" alt="Live demo"></a>
  <a href="https://kanjieteam.github.io/kjdraw/docs/latest/"><img src="https://img.shields.io/badge/▣_Docs-latest-2863f0?style=flat-square&labelColor=30363d" alt="Documentation"></a>
</p>

<p align="center"><strong>The programmable CAD foundation for engineering software and AI agents.</strong><br>TypeScript-first. Rust/WASM accelerated. Browser-ready and provider-neutral.</p>

<p align="center"><a href="https://kanjieteam.github.io/kjdraw/"><strong>Launch the workbench</strong></a> · <a href="https://kanjieteam.github.io/kjdraw/docs/latest/"><strong>Read the docs</strong></a> · <a href="https://kanjieteam.github.io/kjdraw/docs/latest/api/"><strong>Explore the API</strong></a> · <a href="#install-and-draw">Install</a> · <a href="README.zh-CN.md">简体中文</a></p>

<p align="center"><img src="docs/assets/playground.png" alt="KJDraw browser CAD workbench with a large engineering drawing, ribbon tools, inspector and reviewable Agent changes" width="100%"></p>

KJDraw turns CAD from a closed desktop surface into an embeddable, typed and auditable platform. Use the headless SDK inside a web or Node.js product, start from the reference workbench, extend it with plugins, or put an AI agent behind the same transactional command boundary a human uses.

It grew out of the needs of **Kanjie (勘界)**, but the public core is intentionally general-purpose. Engineering-specific compilers, customer data and commercial services remain separate; shared CAD improvements land here first.

## See the complete workflow

The live workbench opens on an original synthetic engineering drawing with more than two thousand entities. In one session you can:

1. Inspect layers and objects, draw and edit geometry, measure, snap and undo.
2. Describe a change and review the exact move/delete/create diff before the document mutates.
3. Approve one atomic transaction and inspect its receipt, revision and content binding.
4. Download the KJP project, reopen it with a matching fingerprint, then undo the change.

No account, backend, model key or upload is required for the demo. The Agent journey is deterministic so its safety contract can be reproduced; connect your own model at the host boundary.

**[Run the 90-second demo →](https://kanjieteam.github.io/kjdraw/)**

## Install and draw

```sh
npm install @kanjieteam/kjdraw
```

```ts
import {
  createKJDrawSDK,
  type KJReadonlyObjectRecord,
} from '@kanjieteam/kjdraw'

const cad = createKJDrawSDK()
const drawing = cad.createDocument({
  documentId: 'site-plan',
  units: 'millimeter',
})

const line = await cad.executeCommand<KJReadonlyObjectRecord>('CREATE', {
  type: 'LINE',
  payload: { start: [0, 0, 0], end: [100, 40, 0] },
})

await cad.executeCommand('MOVE', { id: line.id, dx: 25, dy: 10 })
console.log(drawing.revision, drawing.fingerprint())
```

The npm package is ESM-first, has zero runtime dependencies, and exposes documented root and subpath imports for documents, geometry, file adapters, deployment providers, projects, plugins and Agent plans.

### React, Vue, Vanilla and CLI

| Start here | What it shows |
| --- | --- |
| [Vanilla quickstart](packages/kjdraw-sdk/examples/quickstart.mjs) | Create, edit and inspect a document with the package API |
| [React hook](packages/kjdraw-sdk/examples/react.tsx) | Stable SDK lifetime, typed events and component cleanup |
| [Vue composable](packages/kjdraw-sdk/examples/vue.ts) | Reactive document state and scope disposal |
| [Plugin starter](examples/plugin-starter/README.md) | Manifest compatibility, permissions, activation and disposal |

The package also includes a local headless CLI:

```sh
npx @kanjieteam/kjdraw inspect drawing.dxf
npx @kanjieteam/kjdraw validate project.kjp
npx @kanjieteam/kjdraw convert drawing.kjd drawing.dxf --dxf-version 2018
```

## A foundation for real engineering products

| Layer | Public 1.0 contract |
| --- | --- |
| **Document model** | Stable IDs and CAD handles, ownership, tables, blocks, model/paper spaces, resources and revisions |
| **Editing** | Atomic transactions, rollback, undo/redo, expected revisions, selection, snapping and declared 2D operations |
| **Files and projects** | KJD documents, deterministic ZIP64 KJP projects and a bounded ASCII DXF compatibility profile |
| **Workbench** | Bilingual multi-drawing CAD UI built only on public package APIs |
| **Extensibility** | Versioned plugin manifests plus command, entity, renderer, file, tool, snap, property and workspace extension points |
| **AI agents** | Review-bound plans, exact arguments, SHA-256 content binding, expiry, one-shot execution, receipts and undo |
| **Kernel** | Rebuildable Rust/WASM document authority, geometry predicates and explicitly bounded solid-mesh operations |
| **Deployment** | Browser-local by default; explicit project, compute and scene providers for desktop, self-hosted, cloud-assisted or hybrid products |

```text
Your product · Reference workbench · Plugins · AI agents
                         │
              Commands + transactions
                         │
        Typed document model + KJD / KJP / DXF
                         │
        TypeScript SDK ↔ optional Rust / WASM
                         │
 Browser-local · Desktop · Self-hosted · Cloud-assisted
```

KJDraw does not force a “local-only” architecture. The public demo processes drawings in the browser; an embedding host may register remote providers deliberately. Provider registration itself never starts network activity.

## Agent changes are reviewable changesets

An AI-origin command cannot silently reuse an old approval. The SDK binds the reviewed plan to its exact arguments, document identity, complete document digest, fingerprint, expected revision, expiry and reviewer. Concurrent replay and document drift fail closed; an accepted change still enters the ordinary transaction history and can be undone.

```text
Intent → immutable proposal → visual diff → human approval
       → one atomic command → receipt → save / reopen / undo
```

This is an application protocol, not an identity system or hostile-code sandbox. Hosts still own authentication, authorization, model isolation and durable audit storage. See the [Agent protocol](docs/agent-protocol.md) and [security model](SECURITY_ARCHITECTURE.md).

## File interoperability without inflated claims

| Format | What KJDraw promises |
| --- | --- |
| **KJD** | Canonical transactional document format with validation and revisions |
| **KJP** | Multi-drawing ZIP64 project, manifest, hashes, snapshots and command journal |
| **DXF** | ASCII import/export for the published entity/resource/version profile, with corpus and cross-tool audits |
| **DWG** | Not included in KJDraw 1.0 |

Unsupported known export semantics reject rather than being advertised as lossless. Keep original files when evaluating interoperability. Read the [DXF evidence](docs/dxf-compatibility.md), [capability matrix](docs/capability-matrix.md) and [current status](docs/status.md).

## The 1.0 contract

`1.0.0-rc.1` is the immutable candidate for the stable contract. Stable 1.0 is promoted only when every in-scope gate passes on this candidate line, including the packed npm artifact, browser matrix, live Demo/Docs and release provenance.

KJDraw 1.0 deliberately does **not** claim DWG support, arbitrary-DXF losslessness, general BRep modelling, full parametric constraints, complete font/layout fidelity, real-time collaboration or device-certified plotting. Experimental solid meshes remain labelled experimental.

See the [1.0 scope](docs/1.0-scope.md), [machine-readable acceptance matrix](docs/KJDRAW_1_0_ACCEPTANCE_MATRIX.json) and [release notes](docs/releases/1.0.0-rc.1.md).

## Run locally and contribute

```sh
git clone https://github.com/KanJieTeam/kjdraw.git
cd kjdraw
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
npm run test:browser
```

`node scripts/serve.mjs` starts the workbench at **http://localhost:4173**. Use synthetic or explicitly redistributable drawings in public issues.

Good first contributions include reproducible DXF cases, geometry fixes, plugins, framework integrations, accessibility improvements and documentation. Read [Contributing](CONTRIBUTING.md), [Governance](GOVERNANCE.md), [Support](SUPPORT.md) and the [roadmap](docs/roadmap.md).

**Maintained by [KanJieTeam](https://github.com/KanJieTeam)** · [kanjieteam@163.com](mailto:kanjieteam@163.com) · Apache-2.0

The Apache license covers this repository, not private Kanjie data, proprietary domain packages, commercial services or third-party CAD assets. See [LICENSE](LICENSE), [NOTICE](NOTICE) and [provenance](docs/provenance.md).
