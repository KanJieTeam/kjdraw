<p align="center"><img src="docs/assets/mark.svg" alt="KJDraw" width="80" height="80"></p>

<h1 align="center">KJDraw</h1>

<p align="center"><strong>A new generation of CAD.</strong></p>

<p align="center">An open-source CAD engine and ready-to-use editor.<br>Create, edit, and automate engineering drawings—with code, with AI, or by hand.</p>

<p align="center">
  <a href="https://kanjieteam.github.io/kjdraw/"><strong>Try the editor</strong></a> ·
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

<p align="center"><a href="https://kanjieteam.github.io/kjdraw/"><img src="docs/media/kjdraw-workflow.gif" alt="KJDraw workbench: explore drawings, review a preset change, draw a mounting plate, repeat its bolt holes and add dimensions" width="100%"></a></p>

<p align="center"><sub>Recorded in the workbench: explore drawings, review a preset change, then draw and dimension a part. The built-in Agent scene uses a preset workflow, not a connected language model.</sub></p>

## Why KJDraw?

- **Keep automated work editable.** Continue editing drawings created or modified by code or an AI agent, using the same drawing objects and undo history.
- **Start with a ready-to-use editor.** Drawing tools, layers, properties and file operations are included, with three layouts and English and Chinese interfaces.
- **Build on the CAD engine.** Embed the editor in your application, create your own interface, or extend the engine with tools for your industry.

## Try the editor

[Open the editor](https://kanjieteam.github.io/kjdraw/)—no account or upload required to try the samples.

1. Choose a mechanical detail, building floor plan, site plan or road profile.
2. Select objects, move them, inspect their layers or start drawing a part of your own.
3. Undo a change, save the drawing, and open it again to keep working.

The included sample drawings are for exploration, not construction. The [workbench guide](https://kanjieteam.github.io/kjdraw/docs/latest/workbench/) explains drawing, selection, dimensions and saving.

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

[Documentation](https://kanjieteam.github.io/kjdraw/docs/latest/) · [API reference](https://kanjieteam.github.io/kjdraw/docs/latest/api/) · [Roadmap](docs/product/roadmap-to-core.md) · [Support](SUPPORT.md) · [Release status](docs/status.md) · [License](LICENSE)

**Built by [KanJieTeam](https://github.com/KanJieTeam), open to contributors everywhere.**

[kanjieteam@163.com](mailto:kanjieteam@163.com) · Apache-2.0
