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
