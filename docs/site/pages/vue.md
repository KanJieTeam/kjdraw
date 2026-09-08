---
slug: vue
title.en: Vue integration
title.zh: Vue 集成
summary.en: Mount the complete KJDraw editor as a Vue component, control it through an exposed ref, or build a custom composable.
summary.zh: 将完整 KJDraw 编辑器作为 Vue 组件挂载，通过暴露的 ref 控制，或构建自定义 Composable。
---
:::en
## Render the editor component {#editor-component}

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { KJDraw, type KJDrawExposed } from '@kanjieteam/kjdraw/vue'

const editor = ref<KJDrawExposed | null>(null)
</script>

<template>
  <KJDraw
    ref="editor"
    document="sample"
    locale="en"
    theme="dark"
    style="width: 100%; height: 720px"
  />
</template>
```

This is the shortest path to a functional CAD surface. The exposed ref provides `ready`, `open()`, `save()`, `execute()`, selection, view and lifecycle methods. Compatible prop changes update the editor in place, and Vue disposes it when the component unmounts. See the [Editor API](https://kanjieteam.github.io/kjdraw/docs/latest/api/) for every option and method.

## A minimal composable {#minimal-composable}

```ts
import { onScopeDispose, ref, shallowRef } from 'vue'
import { createKJDrawSDK } from '@kanjieteam/kjdraw'

export function useKJDraw() {
  const sdk = createKJDrawSDK()
  const document = shallowRef(sdk.createDocument({
    documentId: 'vue-drawing',
    units: 'millimeter',
  }))
  const revision = ref(document.value.revision)

  const off = sdk.events.on('command:committed', ({ document: changed }) => {
    if (changed === document.value) revision.value = changed.revision
  })
  onScopeDispose(off)

  const drawLine = () => sdk.executeCommand('CREATE', {
    type: 'LINE',
    payload: { start: [0, 0, 0], end: [100, 0, 0] },
  }, { document: document.value })

  return { sdk, document, revision, drawLine }
}
```

## Reactivity rules {#reactivity-rules}

- Use `shallowRef` for a `KJDocument`; do not ask Vue to proxy its complete object graph.
- Mirror committed revision, selection or tool state with small refs.
- Register the event disposer with `onScopeDispose`.
- Keep mutations inside SDK commands so validation, receipts and undo remain intact.

## Share an editor scope {#share-an-editor-scope}

For one editor, create the composable once in a provider component and expose it with Vue dependency injection or your state store. Create separate SDK instances only when documents need separate command registries, plugin scopes or lifecycle boundaries.

Use `KJDraw` for an immediately usable CAD surface or the composable for a product-owned interface. The [maintained examples](https://github.com/KanJieTeam/kjdraw/tree/main/packages/kjdraw-sdk/examples) are compiled against the packed package in release checks.
:::
:::zh
## 渲染编辑器组件 {#editor-component}

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { KJDraw, type KJDrawExposed } from '@kanjieteam/kjdraw/vue'

const editor = ref<KJDrawExposed | null>(null)
</script>

<template>
  <KJDraw
    ref="editor"
    document="sample"
    locale="zh-CN"
    theme="dark"
    style="width: 100%; height: 720px"
  />
</template>
```

这是得到可用 CAD 界面的最短路径。暴露的 ref 提供 `ready`、`open()`、`save()`、`execute()`、选择、视图与生命周期方法。兼容属性变化会原位更新编辑器，Vue 卸载组件时会自动释放资源。全部选项与方法见 [Editor API](https://kanjieteam.github.io/kjdraw/docs/latest/api/)。

## 最小 Composable {#minimal-composable}

```ts
import { onScopeDispose, ref, shallowRef } from 'vue'
import { createKJDrawSDK } from '@kanjieteam/kjdraw'

export function useKJDraw() {
  const sdk = createKJDrawSDK()
  const document = shallowRef(sdk.createDocument({
    documentId: 'vue-drawing',
    units: 'millimeter',
  }))
  const revision = ref(document.value.revision)

  const off = sdk.events.on('command:committed', ({ document: changed }) => {
    if (changed === document.value) revision.value = changed.revision
  })
  onScopeDispose(off)

  const drawLine = () => sdk.executeCommand('CREATE', {
    type: 'LINE',
    payload: { start: [0, 0, 0], end: [100, 0, 0] },
  }, { document: document.value })

  return { sdk, document, revision, drawLine }
}
```

## 响应式规则 {#reactivity-rules}

- `KJDocument` 使用 `shallowRef`，不要让 Vue 代理完整对象图。
- 用小型 ref 映射已提交修订号、选择集或工具状态。
- 使用 `onScopeDispose` 注册事件释放函数。
- 修改始终放在 SDK 命令中，保留校验、回执与撤销能力。

## 共享编辑器作用域 {#share-an-editor-scope}

同一个编辑器应在 Provider 组件中只创建一次 Composable，再通过 Vue 依赖注入或状态库暴露。只有当图档需要独立命令注册表、插件作用域或生命周期边界时，才创建不同 SDK 实例。

需要立即可用的 CAD 界面时使用 `KJDraw`，产品自建全部界面时使用 Composable。[持续维护的示例](https://github.com/KanJieTeam/kjdraw/tree/main/packages/kjdraw-sdk/examples)会在发布检查中针对打包后的 npm 包编译。
:::
