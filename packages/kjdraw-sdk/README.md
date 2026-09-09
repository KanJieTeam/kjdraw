# @kanjieteam/kjdraw

**CAD for engineers and AI.**

An open-source CAD engine and ready-to-use editor. Build engineering drawing apps, or give your AI agent tools to create and edit drawings that people can continue working on.

Use the editor in your browser app, customize it for your industry, or automate drawing operations from code. Drawing tools, layers, properties, English/Chinese UI and three layouts are included.

[Live Demo](https://kanjieteam.github.io/kjdraw/) · [Developer Docs](https://kanjieteam.github.io/kjdraw/docs/latest/) · [GitHub](https://github.com/KanJieTeam/kjdraw)

## Install

```sh
npm install @kanjieteam/kjdraw@next
```

KJDraw ships as standards-based ESM with first-class TypeScript declarations. Interactive movement and selectable layouts require **1.0.0-rc.3 or newer**; release candidates use the `next` channel.

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

Your application connects the AI model; KJDraw provides drawing commands and a review-and-approval workflow. A person can continue editing the result and undo an approved edit. Follow the [Agent guide](https://kanjieteam.github.io/kjdraw/docs/latest/agent/) to connect your host.

The built-in Agent Demo uses preset scenarios. A general-purpose natural-language design assistant is not included. Native KJD/KJP files and a documented [DXF compatibility range](https://github.com/KanJieTeam/kjdraw/blob/main/docs/dxf-compatibility.md) are supported; direct DWG support is not included.

Our mission is to make KJDraw the default open-source CAD engine for the AI era. [Explore the roadmap and contribute](https://github.com/KanJieTeam/kjdraw#build-it-with-us).

Apache-2.0 · Built by [KanJieTeam](https://github.com/KanJieTeam)
