<p align="center"><img src="docs/assets/mark.svg" alt="KJDraw" width="80" height="80"></p>

<h1 align="center">KJDraw</h1>

<p align="center"><strong>The open-source CAD engine for the AI era.</strong></p>

<p align="center">Create, understand, and edit structured engineering drawings<br>from natural language or code.</p>

<p align="center">
  <a href="#quick-start"><strong>Quick start</strong></a> ·
  <a href="https://kanjieteam.github.io/kjdraw/"><strong>Live editor</strong></a> ·
  <a href="#add-cad-to-your-app"><strong>Add CAD to your app</strong></a> ·
  <a href="#give-your-agent-cad-tools"><strong>Build a CAD agent</strong></a> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/KanJieTeam/kjdraw/releases"><img src="https://img.shields.io/github/v/release/KanJieTeam/kjdraw?include_prereleases&style=flat-square&labelColor=30363d&color=2863f0" alt="GitHub release"></a>
  <a href="https://www.npmjs.com/package/@kanjieteam/kjdraw"><img src="https://img.shields.io/npm/v/@kanjieteam/kjdraw/next?style=flat-square&label=npm_next&labelColor=30363d&color=2863f0" alt="npm release candidate"></a>
  <a href="https://kanjieteam.github.io/kjdraw/docs/latest/"><img src="https://img.shields.io/badge/Docs-get_started-2863f0?style=flat-square&labelColor=30363d" alt="Documentation"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-2863f0?style=flat-square&labelColor=30363d" alt="Apache 2.0"></a>
</p>

<p align="center"><a href="https://kanjieteam.github.io/kjdraw/"><img src="docs/media/kjdraw-workflow.gif" alt="KJDraw AI creates, edits, saves and reopens a verified 409-object fixture-plate drawing" width="100%"></a></p>

<p align="center"><sub>Recorded real-model workflow: 2 model requests · 5,439 total tokens · 409 editable objects · one exact edit · saved and reopened.</sub></p>

## CAD infrastructure designed for AI agents

| Work at the intent level | Execute deterministically | Keep the drawing editable |
| --- | --- | --- |
| A model supplies requirements, constraints, and changes through a small set of high-level tools. | KJDraw resolves supported geometry, object identity, layers, references, and transactions. | Every accepted result remains structured CAD with Undo/Redo, save, and reopen support. |

### From a prompt to a verified change

`Intent → KJDraw Skill → high-level MCP tool → deterministic candidate → host review → atomic edit → validate, save, reopen`

The model expresses drawing intent, supplied facts, constraints, and requested changes. KJDraw resolves supported geometry and object identity, rejects operations when required facts are missing or a protected boundary would be crossed, and returns evidence the host can review. This division keeps model output compact and gives different agent clients the same CAD contract.

## What you can build

| Workflow | Built-in foundation |
| --- | --- |
| **Understand existing drawings** | Paged reads, spatial and property queries, stable IDs, layers, references, topology, and change-impact inspection. |
| **Generate supported drawing types** | High-level compilers for manufacturing, architecture, site, road, data visualization, and geology workflows. |
| **Continue editing through conversation** | Precise selection, move, copy, rotate, scale, offset, stretch, lengthen, text/layer edits, and structural delete/reconnect/relayer operations. |
| **Embed CAD in your product** | JavaScript/TypeScript SDK, React and Vue components, packaged editor, CLI, and MCP tools powered by the same engine. |

## Quick start

### Use KJDraw from an AI agent

Run the installer from the root of the project you want to connect. It adds KJDraw's MCP server and CAD Skill to supported clients and creates a project-local drawing host. Your model key stays with your AI client.

**Windows PowerShell**

```powershell
irm https://raw.githubusercontent.com/KanJieTeam/kjdraw/main/scripts/install-ai.ps1 | iex
```

**macOS / Linux**

```sh
curl -fsSL https://raw.githubusercontent.com/KanJieTeam/kjdraw/main/scripts/install-ai.sh | sh
```

The connector currently writes project configuration for Kimi Code, WorkBuddy, ZCode, and TraeCode in one transaction. [Installation details and security model](docs/try-in-ai.md)

> **1.0 release candidate:** command-line configuration and real-engine smoke tests pass; independent GUI/model acceptance remains a release gate. No model key is collected. Source drawings are opened read-only and changes remain proposals until the host approves them.

### Explore the editor

[Open the editor](https://kanjieteam.github.io/kjdraw/)—no account or upload required. Explore mechanical, architectural, site, and road samples; inspect layers; make an edit; Undo it; save; and reopen the drawing. Samples demonstrate the product and are not construction documents. See the [workbench guide](https://kanjieteam.github.io/kjdraw/docs/latest/workbench/).

## Add CAD to your app

Install the release-candidate channel:

```sh
npm install @kanjieteam/kjdraw@next
```

These examples require **1.0.0-rc.3 or newer**. Use the `next` channel; `latest` may be older. See [release status](docs/status.md) for published versions and source changes not yet on npm.

### JavaScript / TypeScript

Give the editor a container with a height:

```html
<div id="cad" style="height: 720px"></div>
```

```ts
import { createKJDrawEditor } from '@kanjieteam/kjdraw/editor'

const editor = createKJDrawEditor('#cad', {
  document: 'sample',
  locale: 'en',
  theme: 'dark',
  layout: 'classic',
})

await editor.ready
// await editor.open(file) // File from your file picker
// await editor.save({ format: 'DXF', download: true })
```

### React

In an existing React application:

```tsx
import { KJDraw } from '@kanjieteam/kjdraw/react'

export default function DrawingPage() {
  return <KJDraw document="sample" locale="en" style={{ height: 720 }} />
}
```

### Vue

In an existing Vue 3 application:

```vue
<script setup lang="ts">
import { KJDraw } from '@kanjieteam/kjdraw/vue'
</script>

<template>
  <KJDraw document="sample" locale="en" style="height: 720px" />
</template>
```

Choose **Classic**, **Compact** or **Focus** to suit your application. Changing the layout keeps the drawing and Undo history.

[Quickstart](https://kanjieteam.github.io/kjdraw/docs/latest/quickstart/) · [React guide](https://kanjieteam.github.io/kjdraw/docs/latest/react/) · [Vue guide](https://kanjieteam.github.io/kjdraw/docs/latest/vue/) · [Runnable examples](packages/kjdraw-sdk/examples)

## Give your agent CAD tools

Your application supplies the AI model; KJDraw supplies the CAD tools. Connect your agent to create and modify drawing objects, preview supported changes for approval, and apply edits that users can continue working on or undo.

For example, an agent host can turn a request to move selected equipment into a proposed move, ask the user to approve it, and apply it to the same drawing. The approved edit can be undone like a manual edit.

- [Build an Agent workflow](https://kanjieteam.github.io/kjdraw/docs/latest/agent/): call drawing tools, review a change and apply it.
- [Agent integration guide](docs/agent.md): integration instructions for coding agents.
- [Run the command example](examples/agent-command.mjs): exercise a proposed edit, approval and Undo without a model or API key.

## Files and automation

Read, edit and save drawings from code or the CLI, without an AI model. See the [file guide](https://kanjieteam.github.io/kjdraw/docs/latest/files/) for examples.

KJDraw supports native KJD drawings and KJP projects, plus a documented [DXF compatibility range](docs/dxf-compatibility.md). Direct DWG support is not included.

## Contributing

**Our mission is to make KJDraw the default open-source CAD engine for the AI era.**

Bring a drawing that exposes a bug, build an integration, or help improve the engine. Work that directly helps users includes geometry and file compatibility, editing tools, Agent examples, accessibility, performance and documentation.

Read [Contributing](CONTRIBUTING.md) for the development workflow and [Governance](GOVERNANCE.md) for how decisions and maintenance work. For substantial changes, open an [issue](https://github.com/KanJieTeam/kjdraw/issues) to discuss the design first.

```sh
git clone https://github.com/KanJieTeam/kjdraw.git
cd kjdraw
npm ci --ignore-scripts
npm run dev
```

Open **http://localhost:4173**. Before submitting changes, run `npm run typecheck` and `npm test`; UI changes also need `npm run test:browser`.

[Documentation](https://kanjieteam.github.io/kjdraw/docs/latest/) · [API reference](https://kanjieteam.github.io/kjdraw/docs/latest/api/) · [Roadmap](docs/roadmap.md) · [Support](SUPPORT.md) · [Release status](docs/status.md) · [License](LICENSE)

**Built by [KanJieTeam](https://github.com/KanJieTeam), open to contributors everywhere.**

[kanjieteam@163.com](mailto:kanjieteam@163.com) · Apache-2.0
