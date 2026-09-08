---
slug: commands
title.en: Commands and transactions
title.zh: 命令与事务
summary.en: Make every UI, automation and Agent edit observable through the same revisioned transactional boundary.
summary.zh: 让 UI、自动化与 Agent 修改都经过同一条带修订号、可观察的事务边界。
---
:::en
## Execute a command {#execute-a-command}

```ts
const line = await sdk.executeCommand('CREATE', {
  type: 'LINE',
  payload: { start: [0, 0, 0], end: [100, 0, 0] },
}, { document: drawing })

await sdk.executeCommand(
  'MOVE',
  { id: line.id, dx: 10, dy: 5 },
  { document: drawing, expectedRevision: drawing.revision },
)
```

`expectedRevision` closes stale-write races. A mismatch fails before mutation. Successful commits advance the revision and emit typed events; undo/redo enters the same history.

When using a mounted editor, prefer `editor.execute(command, args)`: it always targets that editor's drawing. With a shared SDK, pass `{ document: drawing }` explicitly for background tasks. A bare `sdk.executeCommand()` uses the SDK's single active drawing, which follows editor focus and can change when another view becomes active.

## Atomicity and rollback {#atomicity-and-rollback}

A command runs against a transaction draft. Validation and any configured authority backend complete before publication. If execution or validation fails, the live document does not expose the partial draft.

Built-in editing includes declared combinations for creation, properties, move/copy/rotate/scale/mirror, arrays, offset, break/explode, trim/extend, chamfer/fillet and grips. Consult **Capabilities** for exact boundaries rather than inferring support from a command name.

## Select geometry {#select-geometry}

The packaged workbench includes click selection, directional box selection, an open fence and editable grips. For your own toolbar or automation, query the drawing in model coordinates:

```ts
import { selectEntitiesInBox, selectEntitiesByFence } from '@kanjieteam/kjdraw/selection'

const ids = selectEntitiesInBox(drawing, [0, 0], [100, 80], 'window')
await sdk.executeCommand('SELECT', { ids: [...ids], operation: 'replace' }, { document: drawing })

// Find objects touched by an open line across the drawing.
const crossed = selectEntitiesByFence(drawing, [[0, 20], [100, 20]])
```

| API / option | Purpose |
| --- | --- |
| `selectEntitiesInBox(drawing, first, second, mode, options?)` | `window` requires the whole object inside; `crossing` also accepts geometry touching the frame |
| `selectEntitiesByFence(drawing, points, options?)` | At least two points; the last point is not automatically joined to the first |
| `spaceId` | Query a particular drawing space; defaults to model space |
| `includeLocked: true` | Include visible locked-layer entities for inspection; does not make them editable |
| `tolerance` | Non-negative distance in model units; defaults to `1e-8` |

Both functions return object IDs without changing selection or undo history. Hidden and frozen layers are excluded. Circles, arcs, ellipses and bulged polyline segments use curve intersections; splines follow the displayed curve and text uses approximate label extents.

For custom Canvas UI, `editor.workbench.renderer.selectBox(first, second)` and `selectFence(points)` accept **canvas-relative CSS pixels**, not model coordinates. `selectBox` automatically chooses window for left-to-right dragging and crossing for right-to-left. Apply the returned IDs with `editor.setSelection(ids)`.

## Protected layers {#protected-layers}

Editing commands reject writes to locked, frozen or hidden layers, including moving an object into a protected layer. A multi-object command fails as a whole; it does not move the writable objects and leave the others behind. Read-only measurements and queries still work. Use the Layers panel to unlock, thaw or show a layer, or update it explicitly:

```ts
await editor.execute('LAYERUPDATE', {
  id: layerId,
  patch: { locked: false, frozen: false, visible: true },
})
```

This editing policy applies to transactional commands, including registered extensions. Direct `drawing.transact(...)` remains available for importers and data migrations that reconstruct protected drawings; it is a low-level data API, not a user permission system.

## Use command envelopes {#command-envelopes}

```ts
const envelope = sdk.createCommandEnvelope('MOVE', {
  ids: selectedIds,
  dx: 3,
  dy: 0,
}, {
  document: drawing,
  origin: 'automation',
  expectedRevision: drawing.revision,
})

const receipt = await sdk.executeCommandEnvelope(envelope)
console.log(receipt.command, receipt.afterRevision)
```

Envelopes make command identity, arguments, origin, target document and expected revision explicit. AI-origin envelopes add the Agent plan review protocol described in **Agent workflows**.

## Observe changes {#observe-changes}

Subscribe through `sdk.events.on('command:committed', listener)` and dispose the returned function when its owning UI scope unmounts. Renderers should derive their display state from the committed document rather than mutate canonical geometry directly.
:::
:::zh
## 执行命令 {#execute-a-command}

```ts
const line = await sdk.executeCommand('CREATE', {
  type: 'LINE',
  payload: { start: [0, 0, 0], end: [100, 0, 0] },
}, { document: drawing })

await sdk.executeCommand(
  'MOVE',
  { id: line.id, dx: 10, dy: 5 },
  { document: drawing, expectedRevision: drawing.revision },
)
```

`expectedRevision` 用于关闭陈旧写入竞态。版本不匹配时会在修改前失败。提交成功后修订号递增并发出类型化事件；撤销/重做也进入同一段历史。

使用已挂载的编辑器时，优先调用 `editor.execute(command, args)`，它始终操作该编辑器的图纸。多个编辑器共享 SDK 时，后台任务应显式传入 `{ document: drawing }`。不指定图纸的 `sdk.executeCommand()` 会使用 SDK 的活动图纸；切换编辑器焦点也会切换这一目标。

## 原子性与回滚 {#atomicity-and-rollback}

命令在事务草稿上执行。校验与已配置的权威后端都成功后才会发布。执行或校验失败时，活动图档不会暴露部分修改的草稿。

内置编辑覆盖已声明组合下的创建、属性、移动/复制/旋转/缩放/镜像、阵列、偏移、打断/分解、修剪/延伸、倒角/圆角与夹点。请从**能力与边界**确认精确范围，不要只根据命令名称推断支持程度。

## 按几何范围选择 {#select-geometry}

内置工作台提供单击选择、方向框选、开放围栏和可编辑夹点。开发自己的工具栏或自动化流程时，可直接按模型坐标查询：

```ts
import { selectEntitiesInBox, selectEntitiesByFence } from '@kanjieteam/kjdraw/selection'

const ids = selectEntitiesInBox(drawing, [0, 0], [100, 80], 'window')
await sdk.executeCommand('SELECT', { ids: [...ids], operation: 'replace' }, { document: drawing })

// 查询与一条开放折线相交的对象。
const crossed = selectEntitiesByFence(drawing, [[0, 20], [100, 20]])
```

| API / 参数 | 用途 |
| --- | --- |
| `selectEntitiesInBox(drawing, first, second, mode, options?)` | `window` 要求对象完全位于框内；`crossing` 也包含与边框相交的图形 |
| `selectEntitiesByFence(drawing, points, options?)` | 至少两个点，不自动连接最后一点与第一点 |
| `spaceId` | 指定绘图空间，默认查询模型空间 |
| `includeLocked: true` | 检查时可包含锁定层对象，但不解除其编辑保护 |
| `tolerance` | 模型单位下的非负距离容差，默认 `1e-8` |

两个函数只返回对象 ID，不改变选择和撤销历史。隐藏、冻结图层不参与查询。圆、圆弧、椭圆和带凸度的多段线按曲线求交；样条按显示曲线判断，文字采用近似标签范围。

自定义 Canvas 界面时，可使用 `editor.workbench.renderer.selectBox(first, second)` 和 `selectFence(points)`，坐标为**相对画布的 CSS 像素**，不是模型坐标。`selectBox` 根据拖动方向自动选择全包含或交叉模式。再调用 `editor.setSelection(ids)` 应用查询结果。

## 图层编辑保护 {#protected-layers}

编辑命令不能修改锁定、冻结或隐藏图层上的对象，也不能把对象移入这些图层。批量命令整体失败，不会只修改其中可写的对象。测量和只读查询仍可使用。可以通过图层面板解锁、解冻或显示图层，也可以显式更新：

```ts
await editor.execute('LAYERUPDATE', {
  id: layerId,
  patch: { locked: false, frozen: false, visible: true },
})
```

这一编辑策略覆盖事务命令及注册的扩展命令。底层 `drawing.transact(...)` 仍可用于导入、迁移等需要重建受保护图纸的数据操作；它不是面向用户的权限系统。

## 使用命令信封 {#command-envelopes}

```ts
const envelope = sdk.createCommandEnvelope('MOVE', {
  ids: selectedIds,
  dx: 3,
  dy: 0,
}, {
  document: drawing,
  origin: 'automation',
  expectedRevision: drawing.revision,
})

const receipt = await sdk.executeCommandEnvelope(envelope)
console.log(receipt.command, receipt.afterRevision)
```

命令信封显式记录命令身份、参数、来源、目标图档与预期修订。AI 来源信封还会进入**Agent 工作流**所述的计划审核协议。

## 观察变更 {#observe-changes}

通过 `sdk.events.on('command:committed', listener)` 订阅，并在所属 UI 生命周期结束时调用返回的释放函数。渲染器应从已提交图档派生显示状态，而不是直接修改规范几何。
:::
