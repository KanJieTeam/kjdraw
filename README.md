<p align="center"><img src="docs/assets/mark.svg" alt="KJDraw" width="88" height="88"></p>

<h1 align="center">KJDraw</h1>

<p align="center"><strong>Open, inspect, edit and automate engineering drawings in the browser—from one TypeScript package.</strong></p>

<p align="center">An extensible CAD foundation for engineering applications, interactive workbenches and reviewable AI agents.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@kanjieteam/kjdraw"><img src="https://img.shields.io/npm/v/@kanjieteam/kjdraw?style=flat-square&label=npm&labelColor=30363d&color=2863f0" alt="npm version"></a>
  <a href="https://kanjieteam.github.io/kjdraw/"><img src="https://img.shields.io/badge/▲_Live_Demo-open-2863f0?style=flat-square&labelColor=30363d" alt="Live demo"></a>
  <a href="https://kanjieteam.github.io/kjdraw/docs/latest/"><img src="https://img.shields.io/badge/▣_Docs-latest-2863f0?style=flat-square&labelColor=30363d" alt="Documentation"></a>
  <a href="https://github.com/KanJieTeam/kjdraw"><img src="https://img.shields.io/badge/GitHub-source-181717?style=flat-square&logo=github" alt="GitHub source"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-2863f0?style=flat-square&labelColor=30363d" alt="Apache 2.0"></a>
</p>

<p align="center"><a href="https://kanjieteam.github.io/kjdraw/"><img src="docs/media/kjdraw-workflow.gif" alt="KJDraw opens an engineering drawing, previews an Agent-authored CAD diff, commits it atomically, verifies the saved project and undoes the result" width="100%"></a></p>

<p align="center"><sub>Real workbench capture: explore industry drawings, review an Agent change, save and undo.</sub></p>

<p align="center"><a href="https://kanjieteam.github.io/kjdraw/"><strong>Open the workbench</strong></a> · <a href="https://kanjieteam.github.io/kjdraw/docs/latest/"><strong>Get started</strong></a> · <a href="https://kanjieteam.github.io/kjdraw/docs/latest/api/"><strong>API reference</strong></a> · <a href="README.zh-CN.md">简体中文</a></p>

Explore original site plans, architectural floor plans, road profiles and mechanical details. Switch drawings, inspect layers, edit geometry and save your work. The energy-campus example also includes an interactive Agent review workflow. No account or upload is needed to try the workbench.

## What you can build

| Build | Start with | The useful part |
| --- | --- | --- |
| **Embedded CAD viewer/editor** | [`@kanjieteam/kjdraw/editor`](https://kanjieteam.github.io/kjdraw/docs/latest/quickstart/) | Mount a bilingual drawing surface with ribbon tools, layers, properties, command input and local file actions |
| **Purpose-built engineering app** | [`@kanjieteam/kjdraw`](https://kanjieteam.github.io/kjdraw/docs/latest/architecture/) | Keep product UI and domain workflows above a typed document, command and transaction core |
| **File and automation pipeline** | [File guide](https://kanjieteam.github.io/kjdraw/docs/latest/files/) + CLI | Read, validate, transform and write KJD, KJP and the published DXF profile in browsers or Node.js |
| **Reviewable CAD copilot** | [Agent guide](https://kanjieteam.github.io/kjdraw/docs/latest/agent/) | Turn intent into exact commands, show a visual diff, require approval, then return a verifiable receipt |
| **CAD extension ecosystem** | [Plugin guide](https://kanjieteam.github.io/kjdraw/docs/latest/plugins/) | Add commands, entities, renderers, file adapters, tools, snaps, properties and workspace panels |

KJDraw grew out of real product work at **Kanjie (勘界)**. The open core stays general-purpose, and reusable improvements flow back into this repository so the public project and Kanjie's products share one CAD foundation.

## One drawing, many ways to build

Human tools, plugins and AI agents all use the same typed commands. Every accepted operation becomes one document revision with ordinary undo/redo and project history—so an Agent is a participant in the CAD application, not a side door around it.

```text
Human tools ─┐
Plugins ─────┼─→ typed command → preview → atomic transaction → revision → KJD / KJP / DXF
AI agents ───┘                         │
                                      └─→ receipt → verify → undo
```

Build the interface your users need while sharing drawing data, commands and undo history across your application and its extensions.

## Start in 60 seconds

Install the published package:

```sh
npm install @kanjieteam/kjdraw
```

The examples below target the upcoming 1.0 editor API in this branch. Until this candidate is published, use the repository checkout to try these new entry points.

Mount the editor:

```ts
import { createKJDrawEditor } from '@kanjieteam/kjdraw/editor'

const editor = createKJDrawEditor(
  '#cad',
  {
    document: 'sample',
    locale: 'en',
    theme: 'dark',
  },
)

await editor.ready
// await editor.open(file) // File from an <input type="file">
// await editor.save({ format: 'DXF', download: true })
```

```html
<div id="cad" style="height: 720px"></div>
```

Or use the headless SDK and bring your own interface:

```ts
import { createKJDrawSDK } from '@kanjieteam/kjdraw/core'

const cad = createKJDrawSDK()
const drawing = cad.createDocument({
  documentId: 'site-plan',
  units: 'millimeter',
})

const line = await cad.executeCommand('CREATE', {
  type: 'LINE',
  payload: { start: [0, 0, 0], end: [100, 40, 0] },
})

await cad.executeCommand('MOVE', { id: line.id, dx: 25, dy: 10 })
console.log(drawing.revision, drawing.fingerprint())
```

### Vanilla, React and Vue

Use the packaged components in your application. They manage editor mounting and cleanup, and update appearance without replacing your drawing.

**React**

```tsx
import { KJDraw } from '@kanjieteam/kjdraw/react'

export default function DrawingPage() {
  return <KJDraw document="sample" locale="en" style={{ height: 720 }} />
}
```

**Vue**

```vue
<script setup lang="ts">
import { KJDraw } from '@kanjieteam/kjdraw/vue'
</script>

<template>
  <KJDraw document="sample" locale="en" style="height: 720px" />
</template>
```

| Stack | Guide | Runnable source |
| --- | --- | --- |
| **Vanilla TypeScript** | [Quickstart](https://kanjieteam.github.io/kjdraw/docs/latest/quickstart/) | [`vanilla-workbench.ts`](packages/kjdraw-sdk/examples/vanilla-workbench.ts) |
| **React** | [React integration](https://kanjieteam.github.io/kjdraw/docs/latest/react/) | [`react.tsx`](packages/kjdraw-sdk/examples/react.tsx) |
| **Vue** | [Vue integration](https://kanjieteam.github.io/kjdraw/docs/latest/vue/) | [`vue.ts`](packages/kjdraw-sdk/examples/vue.ts) |
| **Plugin** | [Plugin system](https://kanjieteam.github.io/kjdraw/docs/latest/plugins/) | [`plugin-starter`](examples/plugin-starter/README.md) |

### Start with an industry drawing

The same original drawings used by the demo are available to applications:

```ts
import { createKJDrawSDK } from '@kanjieteam/kjdraw/core'
import { createIndustrySample } from '@kanjieteam/kjdraw/samples'
import { createKJDrawEditor } from '@kanjieteam/kjdraw/editor'

const sdk = createKJDrawSDK()
const drawing = await createIndustrySample(sdk, 'sample-architecture')
const editor = createKJDrawEditor('#cad', { sdk, document: drawing })
await editor.ready
```

Choose `sample-site-plan`, `sample-architecture`, `sample-road-profile` or `sample-mechanical`. These are editable sample drawings, not customer data or construction deliverables.

## Files, projects and CLI

| Format | Role in KJDraw |
| --- | --- |
| **KJD** | Canonical transactional drawing with validation, stable IDs and revisions |
| **KJP** | Deterministic multi-drawing project with manifests, hashes, snapshots and command journal |
| **DXF** | Documented ASCII compatibility profile backed by corpus and independent cross-tool audits |

Use the same package from a terminal:

```sh
npx @kanjieteam/kjdraw@next inspect drawing.dxf
npx @kanjieteam/kjdraw@next validate project.kjp
npx @kanjieteam/kjdraw@next convert drawing.kjd drawing.dxf --dxf-version 2018
```

See [Loading and files](https://kanjieteam.github.io/kjdraw/docs/latest/files/), the [DXF compatibility evidence](docs/dxf-compatibility.md) and [known limits](docs/status.md).

## Agent changes you can inspect and undo

KJDraw binds a reviewed Agent plan to the exact command arguments, document identity, content digest, fingerprint, expected revision, expiry and reviewer. The approved plan executes once, produces a receipt and enters normal undo/redo history.

```text
Intent → immutable proposal → visual diff → human approval
       → one atomic command → receipt → save / reopen / undo
```

Start with the [Agent workflow guide](https://kanjieteam.github.io/kjdraw/docs/latest/agent/), hand a coding agent the stable [`docs/agent.md`](docs/agent.md) contract, or run [`examples/agent-command.mjs`](examples/agent-command.mjs).

## Designed to be extended

| Layer | Public contract |
| --- | --- |
| **Document** | Entities, tables, blocks, model/paper spaces, resources, stable handles and revisions |
| **Editing** | Transactions, rollback, undo/redo, selections, snapping and typed 2D commands |
| **Rendering** | Reference Canvas renderer plus replaceable scene-provider and renderer seams |
| **Workbench** | Mountable bilingual CAD UI built on public package exports |
| **Plugins** | Versioned manifests, explicit permissions, activation and complete disposal |
| **Kernel** | Rebuildable Rust/WASM authority for document operations and geometry predicates |
| **Deployment** | Browser, desktop, self-hosted, cloud-assisted or hybrid through explicit providers |

The package is ESM-first and has zero runtime dependencies. Read the [architecture guide](https://kanjieteam.github.io/kjdraw/docs/latest/architecture/) before extending a core boundary.

## Workbench controls

| Input | Action |
| --- | --- |
| `V` / `L` / `P` / `C` / `A` | Select / line / polyline / circle / arc |
| `R` / `E` / `T` / `D` | Rectangle / ellipse / text / distance |
| Mouse wheel / middle drag | Zoom / pan |
| `Ctrl` or `⌘` + `Z` | Undo; add `Shift` to redo |
| `Ctrl` or `⌘` + `Enter` | Preview the selected Agent scenario |
| `Esc` | Return to select and clear the active preview |

## Toward 1.0

The next candidate is `1.0.0-rc.2`. Follow the [release notes](docs/releases/1.0.0-rc.2.md) for changes and the [roadmap](docs/roadmap.md) for what comes next. The npm badge above shows the published version.

## Develop and contribute

```sh
git clone https://github.com/KanJieTeam/kjdraw.git
cd kjdraw
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
npm run test:browser
```

Run `npm run dev` and open **http://localhost:4173**. High-value contributions include reproducible DXF cases, geometry and rendering fixes, framework integrations, plugins, accessibility, performance and documentation.

Read [Contributing](CONTRIBUTING.md), [Governance](GOVERNANCE.md), [Support](SUPPORT.md) and the [roadmap](docs/roadmap.md).

**Maintained by [KanJieTeam](https://github.com/KanJieTeam)** · [kanjieteam@163.com](mailto:kanjieteam@163.com) · Apache-2.0
