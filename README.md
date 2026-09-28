<div align="center">

<img src="docs/assets/mark.svg" width="72" alt="KJDraw logo" />

# KJDraw

### The open-source CAD engine for the AI era

The model describes engineering intent. KJDraw compiles it into real CAD drawings<br/>
that stay editable, verifiable, undoable, and reopenable.

[**Quick start**](#-quick-start) · [**Try with AI**](https://kanjieteam.github.io/kjdraw/ai/) · [**Live editor**](https://kanjieteam.github.io/kjdraw/) · [**Docs**](https://kanjieteam.github.io/kjdraw/docs/latest/) · [简体中文](README.zh-CN.md)

[![GitHub release](https://img.shields.io/github/v/release/KanJieTeam/kjdraw?include_prereleases&style=flat-square&labelColor=30363d&color=2863f0)](https://github.com/KanJieTeam/kjdraw/releases)
[![npm next](https://img.shields.io/npm/v/@kanjieteam/kjdraw/next?style=flat-square&label=npm&labelColor=30363d&color=2863f0)](https://www.npmjs.com/package/@kanjieteam/kjdraw)
[![License](https://img.shields.io/badge/license-Apache_2.0-2863f0?style=flat-square&labelColor=30363d)](LICENSE)

</div>

<p align="center">
  <a href="https://kanjieteam.github.io/kjdraw/">
    <img src="docs/media/kjdraw-workflow.gif" alt="KJDraw workbench: open a drawing, review a change, draw and dimension a part" width="100%" />
  </a>
  <br/>
  <sub>Recorded in the built-in workbench; the Agent panel replays a preset scenario. To use KJDraw from a real AI client, see Quick start.</sub>
</p>

## Built for the next edit

Generating something that looks like CAD is no longer hard. Engineering CAD means keeping hundreds of related objects correct across a long conversation: finding the same object again, preserving dimensions, layers, blocks, hatches and references, and getting a consistent result after Undo, export, save and reopen.

Re-emitting a whole DXF on every edit can use more tokens and produce invalid files. The interface matters: a large tool schema can cost **more** than direct DXF for a tiny one-shot drawing. Our [reproducible DeepSeek study](docs/benchmarks/deepseek-2026-09-28.md) publishes both outcomes and failed cases. A [follow-up timing study](docs/benchmarks/deepseek-2026-09-29.md) shows how process startup can reverse an apparent speed advantage; a separate [10,000-round local edit soak](docs/benchmarks/multi-round-editor-soak.md) checks history and file reopening without a model.

KJDraw gives any model or agent the same CAD execution layer: **the model decides what to draw; the engine makes sure it is drawn correctly.** Geometry, object identity, layers, references, transactions, validation and file output are handled deterministically by a local engine — and when key data is missing, it refuses instead of guessing.

## 🚀 Quick start

For Codex, Claude Code or Cursor, install the CAD runtime and the `kjdraw-cad` Skill (Node.js 22+):

```sh
npm install -g @kanjieteam/kjdraw@next
npx skills add KanJieTeam/kjdraw --skill kjdraw-cad -g -a codex -a claude-code -a cursor -y
```

Install only for the agents you use by removing the other `-a` options. Restart your agent, then ask:

```text
Use KJDraw to draw a circle with a radius of 5 mm.
```

The Skill calls `kjdraw agent` locally; **no MCP registration or model API key is needed by KJDraw**. `npx skills add` installs the Skill instructions, while `npm install -g` installs the CAD engine. Edits remain proposals until a human approves them. [Other agents, verification and optional MCP setup](docs/try-in-ai.md).

## What you can build

| Workflow | What works today |
| --- | --- |
| **Understand existing drawings** | Paged reads, spatial and property queries, stable IDs, layers, block references, topology and change-impact inspection |
| **Generate engineering drawings** | High-level compilers for manufacturing parts, floor plans, site and utility plans, road alignments, borehole logs, geological sections and charts |
| **Keep editing through conversation** | Select precisely, then move, copy, rotate, scale, offset, stretch, lengthen, edit text, change layers, and delete with relationships rebuilt |
| **Deterministic quality loop** | Every run checks geometry, layers, references and revision; each change is one undoable transaction you can save, reopen and re-verify |
| **Embed CAD in your product** | TypeScript/JavaScript SDK, React and Vue components, packaged editor, CLI, MCP and local file workflows — all on the same engine |

## Is KJDraw right for you?

| ✅ Good fit | ⏳ Not a fit yet |
| --- | --- |
| You want an AI agent to generate and repeatedly revise engineering drawings | You need to open and save DWG directly |
| You're building an AI product that changes drawings, with a human in the loop | You need full desktop-CAD parity or 3D solid modeling |
| You need a CAD editor inside a web product (review, inspection, configurators, internal tools) | You need certified plotting or print output |
| You process DXF/KJD in scripts or CI, headless, with no upload | |

KJDraw is a CAD engine and execution layer. It is not trying to replace desktop CAD.

## 📦 Add CAD to your app

```bash
npm install @kanjieteam/kjdraw@next
```

`next` currently points to the public `1.0.0-rc.3` release candidate; `latest` still points to an older preview. Pin `1.0.0-rc.3` if you need a reproducible installation.

```html
<div id="cad" style="height: 720px"></div>
```

```ts
import { createKJDrawEditor } from '@kanjieteam/kjdraw/editor'

const editor = createKJDrawEditor('#cad', {
  document: 'sample',
  locale: 'en',
  theme: 'dark',
  layout: 'classic', // 'classic' | 'compact' | 'focus'
})

await editor.ready
// await editor.open(file)                              // a File from your file picker
// await editor.save({ format: 'DXF', download: true })
```

<details>
<summary><b>React</b></summary>

```tsx
import { KJDraw } from '@kanjieteam/kjdraw/react'

export default function DrawingPage() {
  return <KJDraw document="sample" locale="en" style={{ height: 720 }} />
}
```

</details>

<details>
<summary><b>Vue 3</b></summary>

```vue
<script setup lang="ts">
import { KJDraw } from '@kanjieteam/kjdraw/vue'
</script>

<template>
  <KJDraw document="sample" locale="en" style="height: 720px" />
</template>
```

</details>

[Quickstart](https://kanjieteam.github.io/kjdraw/docs/latest/quickstart/) · [React guide](https://kanjieteam.github.io/kjdraw/docs/latest/react/) · [Vue guide](https://kanjieteam.github.io/kjdraw/docs/latest/vue/) · [Runnable examples](packages/kjdraw-sdk/examples) · [API reference](https://kanjieteam.github.io/kjdraw/docs/latest/api/)

## 🤖 Build a CAD agent into your own product

Your app brings the model. KJDraw brings the CAD tools, the review step and the undo history.

```mermaid
sequenceDiagram
    participant U as User
    participant M as Your model
    participant K as KJDraw
    U->>M: "Move the pump 500 mm east"
    M->>K: Query drawing (layers, entities, geometry)
    K-->>M: Read-only, revision-bound results
    M->>K: Propose move
    K-->>U: Preview the exact change
    U->>K: Approve
    K->>K: Commit as one transaction (undoable)
```

Each proposal is bound to the revision it was made against, can be used only once, and commits as a single transaction that undoes like a manual edit.

- [Agent workflow guide](https://kanjieteam.github.io/kjdraw/docs/latest/agent/): call drawing tools, review a change and apply it
- [Connecting a model](https://kanjieteam.github.io/kjdraw/docs/latest/models/): the host owns transport, budgets and approval
- [Instructions for coding agents](docs/agent.md)
- [Command example](examples/agent-command.mjs): propose, approve and undo without a model or API key

## Formats and scope

| Area | Status |
| --- | --- |
| **KJD** native drawings | ✅ Read/write, validation, transactions, revisions, undo/redo |
| **KJP** projects | ✅ Multiple drawings in one package with snapshots, hashes and command journals |
| **DXF** (ASCII) | ✅ Documented subset, R14–2024 version labels — [compatibility details](docs/dxf-compatibility.md) |
| Binary DXF | ❌ Not supported |
| **DWG** | ❌ Not in 1.0 — convert to DXF first (for example with ODA File Converter) |
| **3D** | 🧪 Experimental meshes, primitives and box booleans |
| CLI | ✅ Inspect, validate and convert KJD, KJP and DXF headless — [file guide](https://kanjieteam.github.io/kjdraw/docs/latest/files/) |

Unsupported content is rejected rather than silently dropped. Full boundaries: [release status](docs/status.md) · [1.0 scope](docs/1.0-scope.md).

## Contributing

**Our mission: make KJDraw the default open-source CAD engine for the AI era.**

The most useful contributions right now:

- **A drawing that breaks KJDraw.** Real DXF files that fail to open or render correctly are the fastest way to improve compatibility.
- **Try it in your AI client and report back**, especially failed generations or multi-turn edits that go wrong.
- **Editing tools, drawing types, performance, accessibility and docs.**

```bash
git clone https://github.com/KanJieTeam/kjdraw.git
cd kjdraw
npm ci --ignore-scripts
npm run dev          # http://localhost:4173
```

Before opening a PR, run `npm run typecheck` and `npm test` (plus `npm run test:browser` for UI changes). For larger changes, please [open an issue](https://github.com/KanJieTeam/kjdraw/issues) first. See [Contributing](CONTRIBUTING.md) · [Governance](GOVERNANCE.md) · [Roadmap](docs/roadmap.md) · [Support](SUPPORT.md).

## Star History

[![KJDraw Star History](https://api.star-history.com/svg?repos=KanJieTeam/kjdraw&type=Date)](https://www.star-history.com/#KanJieTeam/kjdraw&Date)

---

<div align="center">

If KJDraw is useful to you, a ⭐ helps other engineers find it.

Built by [KanJieTeam](https://github.com/KanJieTeam), open to contributors everywhere · [kanjieteam@163.com](mailto:kanjieteam@163.com) · [Apache-2.0](LICENSE)

</div>
