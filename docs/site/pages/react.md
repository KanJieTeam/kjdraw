---
slug: react
title.en: React integration
title.zh: React 集成
summary.en: Mount the complete KJDraw editor as a React component, control it through a typed ref, or build a custom headless integration.
summary.zh: 将完整 KJDraw 编辑器作为 React 组件挂载，通过类型化 ref 控制，或构建自定义无界面集成。
---
:::en
## Render the editor component {#editor-component}

```tsx
import { useRef } from 'react'
import { KJDraw, type KJDrawEditor } from '@kanjieteam/kjdraw/react'

export function DrawingEditor() {
  const editor = useRef<KJDrawEditor | null>(null)

  return (
    <KJDraw
      ref={editor}
      document="sample"
      locale="en"
      theme="dark"
      style={{ width: '100%', height: 720 }}
      onReady={instance => instance.fit()}
    />
  )
}
```

`KJDraw` mounts the complete editor and gives the ref a `KJDrawEditor`. Use the ref for `open()`, `save()`, `execute()`, selection and view methods. The component updates compatible options in place and disposes its editor when React unmounts it. See the [Editor API](https://kanjieteam.github.io/kjdraw/docs/latest/api/) for every prop and method.

## A minimal hook {#minimal-hook}

```tsx
import { useEffect, useRef, useState } from 'react'
import { createKJDrawSDK, type KJDrawSDK } from '@kanjieteam/kjdraw'

export function useKJDraw() {
  const sdkRef = useRef<KJDrawSDK | null>(null)
  if (!sdkRef.current) {
    sdkRef.current = createKJDrawSDK()
    sdkRef.current.createDocument({
      documentId: 'react-drawing',
      units: 'millimeter',
    })
  }

  const sdk = sdkRef.current
  const document = sdk.activeDocument
  if (!document) throw new Error('KJDraw initialization failed')

  const [revision, setRevision] = useState(document.revision)
  useEffect(
    () => sdk.events.on('command:committed', ({ document: changed }) => {
      if (changed === document) setRevision(changed.revision)
    }),
    [sdk, document],
  )

  const drawLine = () => sdk.executeCommand('CREATE', {
    type: 'LINE',
    payload: { start: [0, 0, 0], end: [100, 0, 0] },
  }, { document })

  return { sdk, document, revision, drawLine }
}
```

## Lifecycle rules {#lifecycle-rules}

- Create the SDK once for the editor scope, not during every render.
- Return the event disposer from `useEffect`; React will unsubscribe on cleanup.
- Store small reactive signals such as revision, selection or active tool. Keep canonical geometry in `KJDocument`.
- Execute edits through SDK commands so React, plugins and agents share transactions and undo.

## Rendering {#rendering}

The `/core` headless entry does not impose a React renderer or state library. A custom canvas component can redraw after committed events, while property panels select typed records from the active document. For large drawings, derive viewport-specific display data instead of copying the entire object graph into React state.

Use `KJDraw` when you need a working CAD surface immediately, or the headless hook when your product owns every interface layer. The maintained examples are [compiled against the npm package](https://github.com/KanJieTeam/kjdraw/tree/main/packages/kjdraw-sdk/examples) during release checks.
:::
:::zh
## 渲染编辑器组件 {#editor-component}

```tsx
import { useRef } from 'react'
import { KJDraw, type KJDrawEditor } from '@kanjieteam/kjdraw/react'

export function DrawingEditor() {
  const editor = useRef<KJDrawEditor | null>(null)

  return (
    <KJDraw
      ref={editor}
      document="sample"
      locale="zh-CN"
      theme="dark"
      style={{ width: '100%', height: 720 }}
      onReady={instance => instance.fit()}
    />
  )
}
```

`KJDraw` 会挂载完整编辑器，并把 `KJDrawEditor` 暴露给 ref。可通过 ref 调用 `open()`、`save()`、`execute()`、选择与视图方法。兼容选项会原位更新，React 卸载组件时会自动释放编辑器。全部属性与方法见 [Editor API](https://kanjieteam.github.io/kjdraw/docs/latest/api/)。

## 最小 Hook {#minimal-hook}

```tsx
import { useEffect, useRef, useState } from 'react'
import { createKJDrawSDK, type KJDrawSDK } from '@kanjieteam/kjdraw'

export function useKJDraw() {
  const sdkRef = useRef<KJDrawSDK | null>(null)
  if (!sdkRef.current) {
    sdkRef.current = createKJDrawSDK()
    sdkRef.current.createDocument({
      documentId: 'react-drawing',
      units: 'millimeter',
    })
  }

  const sdk = sdkRef.current
  const document = sdk.activeDocument
  if (!document) throw new Error('KJDraw initialization failed')

  const [revision, setRevision] = useState(document.revision)
  useEffect(
    () => sdk.events.on('command:committed', ({ document: changed }) => {
      if (changed === document) setRevision(changed.revision)
    }),
    [sdk, document],
  )

  const drawLine = () => sdk.executeCommand('CREATE', {
    type: 'LINE',
    payload: { start: [0, 0, 0], end: [100, 0, 0] },
  }, { document })

  return { sdk, document, revision, drawLine }
}
```

## 生命周期规则 {#lifecycle-rules}

- 每个编辑器作用域只创建一次 SDK，不要在每次渲染时重新创建。
- 从 `useEffect` 返回事件释放函数，React 会在清理时取消订阅。
- React 状态只保存修订号、选择集、活动工具等小型响应信号；规范几何留在 `KJDocument`。
- 所有编辑通过 SDK 命令执行，让 React、插件与 Agent 共用事务和撤销历史。

## 渲染方式 {#rendering}

`/core` 无界面入口不强制 React 渲染器或状态库。自定义 Canvas 组件可以在命令提交后重绘，属性面板则从活动图档读取类型化记录。面对大型图纸，应按视口派生显示数据，不要把完整对象图复制进 React state。

需要立即可用的 CAD 界面时使用 `KJDraw`，产品希望完全掌控每层界面时使用无界面 Hook。[持续维护的示例](https://github.com/KanJieTeam/kjdraw/tree/main/packages/kjdraw-sdk/examples)会在发布检查中针对实际 npm 包编译。
:::
