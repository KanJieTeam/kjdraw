# @kanjieteam/kjdraw

Build browser-based CAD viewers, editors and engineering automation with one TypeScript package. KJDraw combines a ready-to-mount editor, Canvas rendering, CAD documents and commands, DXF/KJD project workflows, plugins, and reviewable AI-agent operations.

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

Apache-2.0 · Built by [KanJieTeam](https://github.com/KanJieTeam)
