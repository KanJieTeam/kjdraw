# @kanjieteam/kjdraw

**A new generation of CAD.**

An open-source CAD engine and ready-to-use editor.
Create, edit, and automate engineering drawings—with code, with AI, or by hand.

[Live Demo](https://kanjieteam.github.io/kjdraw/) · [Developer Docs](https://kanjieteam.github.io/kjdraw/docs/latest/) · [GitHub](https://github.com/KanJieTeam/kjdraw)

## Why KJDraw?

- **Give your agent CAD tools.** Read drawing objects, call drawing commands, and review proposed changes through a programmable API.
- **Add CAD without starting from scratch.** Bring drawing tools, layers, properties and file operations into your JavaScript, React or Vue application.
- **Use the editor. Extend the engine.** Start with the packaged interface, customize the workspace, or build your own tools on the CAD engine.

## Install

```sh
npm install @kanjieteam/kjdraw@next
```

KJDraw ships as ESM with TypeScript declarations. These examples require **1.0.0-rc.3 or newer**. Use the `next` channel; `latest` may be older. See [release status](https://github.com/KanJieTeam/kjdraw/blob/main/docs/status.md) for published versions and source changes not yet on npm.

## Vanilla TypeScript

```html
<div id="kjdraw" style="height: 720px"></div>
```

```ts
import { createKJDrawEditor } from '@kanjieteam/kjdraw/editor'

const editor = createKJDrawEditor(
  document.querySelector('#kjdraw')!,
  {
    document: 'sample',
    locale: 'en', // or 'zh-CN'
    theme: 'dark',
    layout: 'classic', // 'classic' | 'compact' | 'focus'
  },
)

await editor.ready
```

The editor includes drawing and modification tools, layers, properties, command input, file open/save, DXF export, and English/Chinese UI. Move or copy a selection using a base and destination point, drag selected objects, or enter an exact displacement such as `MOVE 10 0`. Undo and Redo restore geometry.

Choose Classic, Compact or Focus from the app bar, or call `editor.setLayout('compact')`. Layout changes keep the same drawing and undo history. The right-center navigation toolbar provides Select, Pan, Fit view and Zoom controls. See the [workbench guide](https://kanjieteam.github.io/kjdraw/docs/latest/workbench/) for the complete interaction.

## React

```tsx
import { useRef } from 'react'
import { KJDraw, type KJDrawEditor } from '@kanjieteam/kjdraw/react'

export function DrawingEditor() {
  const editor = useRef<KJDrawEditor | null>(null)
  return <KJDraw ref={editor} document="sample" layout="compact" style={{ height: 720 }} />
}
```

## Vue

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { KJDraw, type KJDrawExposed } from '@kanjieteam/kjdraw/vue'

const editor = ref<KJDrawExposed | null>(null)
</script>

<template>
  <KJDraw ref="editor" document="sample" layout="compact" style="height: 720px" />
</template>
```

## CAD engine

Use the framework-independent engine when you want to compose your own UI or automation pipeline.

```ts
import { createKJDrawSDK } from '@kanjieteam/kjdraw'

const sdk = createKJDrawSDK()
const drawing = sdk.createDocument({ documentId: 'demo', units: 'millimeter' })

await sdk.executeCommand('CREATE', {
  type: 'LINE',
  payload: { start: [0, 0, 0], end: [100, 0, 0] },
})

const dxf = await sdk.writeDocument(drawing, { format: 'DXF' })
```

Explore complete React, Vue and Vanilla TypeScript examples in the package's `examples` directory. Run the Node.js quickstart with:

```sh
node node_modules/@kanjieteam/kjdraw/examples/quickstart.mjs
```

## Give your agent CAD tools

Your application supplies the AI model; KJDraw supplies the CAD tools. Connect your agent to create and modify drawing objects, preview supported changes for approval, and apply edits that users can continue working on or undo. Follow the [Agent guide](https://kanjieteam.github.io/kjdraw/docs/latest/agent/) to get started.

The built-in Agent Demo uses preset scenarios, not a connected language model.

## Files and automation

Read, edit and save drawings from code or the CLI, without an AI model. See the [file guide](https://kanjieteam.github.io/kjdraw/docs/latest/files/) for examples.

KJDraw supports native KJD drawings and KJP projects, plus a documented [DXF compatibility range](https://github.com/KanJieTeam/kjdraw/blob/main/docs/dxf-compatibility.md). Direct DWG support is not included.

## Contributing

Our mission is to make KJDraw the default open-source CAD engine for the AI era. Explore the [roadmap](https://github.com/KanJieTeam/kjdraw/blob/main/docs/product/roadmap-to-core.md) or [contribute](https://github.com/KanJieTeam/kjdraw#contributing).

Apache-2.0 · Built by [KanJieTeam](https://github.com/KanJieTeam)
