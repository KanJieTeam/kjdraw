---
slug: agent
title.en: Agent workflows
title.zh: Agent 工作流
summary.en: Give your agent focused drawing context, review its proposed edits, and let a person keep working on the result.
summary.zh: 让 Agent 按需读取图纸，检查它提出的修改，再由人接手继续编辑。
---
:::en
## Model-neutral CAD tools {#agent-tools}

The current source checkout adds `KJAgentToolSession` from `@kanjieteam/kjdraw/agent-tools`. Check source/package availability before using this new entry. The session binds one host-authorized document and provides serializable tool definitions plus a `call(name, arguments)` dispatcher.

| Tool | Result |
| --- | --- |
| `cad_read_drawing` | First page of visible model-space objects, layers and drawing units |
| `cad_read_page` | Revision-bound continuation with independent entity/layer offsets |
| `cad_measure_distance` | Planar point-to-point distance in the supplied drawing units |
| `cad_propose_lines` | Proposed batch of up to 64 XY lines |
| `cad_propose_circles` | Proposed batch of up to 64 XY circles |
| `cad_propose_move` | Proposed XY move of up to 64 visible editable model-space LINE/CIRCLE objects |

Expose **only the definitions and dispatcher** to your model adapter. `approve(planId, reviewerId)` and `reject(planId, reviewerId)` are trusted-host methods: the host authenticates the user, checks permissions and collects review of the exact proposed arguments. A reviewer string by itself is not authentication. There is no model-callable approval, arbitrary command, file or network tool.

Proposals validate their inputs and bind the current drawing, but they are **command arguments, not rendered geometric previews**. Execution can still reject geometry or editing policy. Approval attempts are not automatically retried; inspect the drawing and make a fresh proposal after a failed/uncertain result. There is no durable task resume or model connector in this starter session.

Creation uses the core batch command's default layer and explicitly targets model XY at z=0. Read results retain native coordinates and omission notices; they do not expand blocks or promise world-coordinate geometry. Each session accepts at most 128 proposals and permits one in-flight operation. The host still owns total session limits, model budgets, isolation, model-data disclosure and persistence. Provider-specific schema conversion must not remove the session's runtime validation.

Run the installed [tool-session example](https://github.com/KanJieTeam/kjdraw/blob/main/packages/kjdraw-sdk/examples/agent-tools.mjs):

```sh
node node_modules/@kanjieteam/kjdraw/examples/agent-tools.mjs
```

It exercises proposal, simulated host approval, duplicate rejection, native-file reopen and undo without a model or API key. This verifies tool plumbing, not natural-language design success.

## Give the agent the drawing it needs {#drawing-context}

Your host connects the model and decides which drawing data it may receive. KJDraw provides the editing tools and a read-only context query. Query only the objects relevant to the task instead of sending the entire drawing file.

Available in the current source checkout; check the installed package version before using this new entry point.

```ts
import { createKJDrawSDK } from '@kanjieteam/kjdraw'
import { createDrawingContext } from '@kanjieteam/kjdraw/drawing-context'

const sdk = createKJDrawSDK()
const drawing = sdk.createDocument({ units: 'millimeter' })
await sdk.executeCommand('CREATE', {
  type: 'CIRCLE', payload: { center: [20, 30, 0], radius: 4 },
})

const context = createDrawingContext(drawing, {
  types: ['CIRCLE'],
  expectedRevision: drawing.revision,
  limit: 20,
  maxLayers: 0,
  maxBytes: 16_384,
})
// context.entities contains native geometry, IDs and editing eligibility.
// Reading context does not change the drawing or contact a model.
```

Use `ids` for a user selection, `types` for object kinds, or `layerIds` to focus on particular layers. These filters combine. Hidden and frozen objects are excluded by default; locked objects remain readable with `editable: false`. Editing eligibility is not authorization or a promise that every command supports the object.

For another entity page, use `offset: context.nextOffset` and the same filters, with `expectedRevision: context.revision` and `maxLayers: 0`. Stop when `nextOffset === null`. Query the layer catalog separately with `limit: 0`, then use `layerOffset` / `nextLayerOffset`; zero is a valid continuation value. Keep the same revision for every page, including offset zero, and start over if the drawing changes.

The response reports `truncated`, `truncationReasons` and `geometryOmittedReason`. An oversized or unsupported geometry is omitted as a whole, never shortened into a different shape. Native coordinates may be object-coordinate or block-local coordinates; orientation fields are retained, and INSERT definitions are not expanded. The response is a focused read result, not a replacement drawing file.

`maxBytes` caps the UTF-8 size of the JSON response, not model tokens, snapshot memory or query time. Raw source tags, custom metadata, history and resource bytes are not included. Drawing text remains untrusted data; your host controls permissions and any transfer to an external model.

Run the packaged [drawing context example](https://github.com/KanJieTeam/kjdraw/blob/main/packages/kjdraw-sdk/examples/drawing-context.mjs) for independent entity and layer pagination.

## Review before mutation {#review-before-mutation}

```text
Intent → plan envelope → exact preview → human approval
       → verified one-shot execution → receipt → undo
```

An AI-origin command cannot mutate a document unless its exact proposal has first been registered, reviewed and confirmed. The SDK binds the plan to command arguments, document identity, full document digest, fingerprint, expected revision and expiry.

## Plan and execute {#plan-and-execute}

```ts
const plan = sdk.createCommandEnvelope('MOVE', {
  ids: selectedIds,
  dx: 5,
  dy: 0,
}, {
  mode: 'plan',
  origin: 'ai',
  expectedRevision: drawing.revision,
})

const registeredPlan = await sdk.executeCommandEnvelope(plan)
// This result is plan metadata, not a rendered geometric diff.
// Show the proposed MOVE and collect explicit approval in your UI.

const execution = sdk.createCommandEnvelope(plan.command, plan.arguments, {
  origin: 'ai',
  expectedRevision: plan.expectedRevision,
  confirmation: {
    status: 'confirmed',
    planId: plan.id,
    confirmedBy: currentUser.id,
  },
})

const receipt = await sdk.executeCommandEnvelope(execution)
```

## Preview and apply a trim {#geometric-preview}

Give a reviewer the actual geometry before changing the drawing. The public boundary-editing API computes the same retained lines and arcs used by the Trim/Extend tools in the workbench. It works without a model provider, network service or API key.

This example creates a circle and a cutting line. Picking the upper half proposes keeping the lower semicircle as an editable ARC:

```ts
import { createKJDrawSDK } from '@kanjieteam/kjdraw'
import { createBoundaryEditSession } from '@kanjieteam/kjdraw/boundary-edit'

const sdk = createKJDrawSDK()
const drawing = sdk.createDocument({ units: 'millimeter' })
const boundary = await sdk.executeCommand<{ id: string }>('CREATE', {
  type: 'LINE', payload: { start: [-15, 0, 0], end: [15, 0, 0] },
})
const circle = await sdk.executeCommand<{ id: string }>('CREATE', {
  type: 'CIRCLE', payload: { center: [0, 0, 0], radius: 10 },
})
const edit = createBoundaryEditSession('trim', {
  document: drawing, boundaryIds: [boundary.id],
})
edit.confirmBoundaries()
const geometry = edit.preview(circle.id, [0, 10])
// geometry.pieces contains the retained ARC; no document mutation occurred.
// With a mounted KJCanvasRenderer: renderer.drawPreview(geometry.pieces).

const plan = sdk.createCommandEnvelope(
  geometry.command.command, geometry.command.arguments,
  { document: drawing, expectedRevision: geometry.revision, origin: 'ai', mode: 'plan' },
)
await sdk.executeCommandEnvelope(plan, { document: drawing })
```

Present `geometry.pieces` alongside the original drawing. Only call the following function from your host's approval action, with the authenticated reviewer's identity:

```ts
async function applyApprovedTrim(confirmedBy: string) {
  const receipt = await edit.apply(geometry, request =>
    sdk.executeCommandEnvelope(sdk.createCommandEnvelope(
      request.command, request.arguments, {
        document: drawing, expectedRevision: request.expectedRevision, origin: 'ai',
        confirmation: { status: 'confirmed', planId: plan.id, confirmedBy },
      },
    ), { document: drawing }),
  )
  edit.finish()
  return receipt
}
```

For a rejected proposal, call `sdk.agentPlans.reject(plan.id, reviewerId)` and `edit.cancel()`. Clear the preview overlay when the review ends. A committed edit is one ordinary Undo step.

For a person-operated tool, use the same `edit.apply` callback with `origin: 'ui'` and no AI confirmation. Leave the session open to preview and edit another target against the same boundaries; create a fresh preview after each commit.

| API | What your application does |
| --- | --- |
| `setBoundaries(ids)` → `confirmBoundaries()` | Choose the cutting boundaries once; confirm when the user is ready |
| `preview(targetId, pickPoint)` | Read immutable `pieces` and `command`; render a temporary overlay |
| `apply(preview, execute)` | Execute the supplied command through the SDK and return its envelope receipt |
| `state` / `prompt` / `setLocale('zh')` | Display the phase, completed-edit count and localized instruction |
| `finish()` / `cancel()` | End the session; already committed edits remain undoable |

Changing the drawing revision, reusing a consumed preview or changing the command arguments prevents the session from reporting success. `apply` checks the actual commit and retained geometry as well as the SDK receipt. If a faulty host executor commits something else, the session ends with `boundary-edit.unexpected-commit`; it does not automatically undo that host mutation. Inspect the drawing and use the normal history controls.

The preview is an in-process object: keep the original instance instead of serializing and reconstructing it. For a service-backed agent, send validated intent into the host, generate the preview there, then use the existing reviewed-plan flow. Bind `isDocumentCurrent` to the mounted document object and your readonly state when an editor can switch documents.

## Fail-closed cases {#fail-closed-cases}

- Missing, rejected, expired or already consumed plan.
- Changed arguments, target document or expected revision.
- Document drift after the preview was created.
- Missing reviewer identity or replay of a successful execution envelope.

## Security boundary {#security-boundary}

This is an application protocol inside one SDK host process. It does not authenticate users, sandbox a model, enforce organization policy across services or persist a durable approval ledger. The host owns those controls and may store the returned receipt as audit evidence.

Start with the stable [Agent integration contract](https://github.com/KanJieTeam/kjdraw/blob/main/docs/agent.md), then use the maintained [Agent protocol](https://github.com/KanJieTeam/kjdraw/blob/main/docs/agent-protocol.md) for the complete lifecycle and boundary.
:::
:::zh
## 模型无关的 CAD 工具 {#agent-tools}

当前源码新增 `@kanjieteam/kjdraw/agent-tools` 中的 `KJAgentToolSession`。使用前核对源码与安装包的发布状态。一个会话绑定一份由宿主授权的图纸，提供可序列化的工具定义和 `call(name, arguments)` 调用入口。

| 工具 | 返回结果 |
| --- | --- |
| `cad_read_drawing` | 可见模型空间对象、图层和单位的第一页 |
| `cad_read_page` | 绑定图纸版本、分别按对象和图层偏移继续读取 |
| `cad_measure_distance` | 使用图纸单位计算同一坐标系中两点的平面距离 |
| `cad_propose_lines` | 最多 64 条 XY 直线的创建方案 |
| `cad_propose_circles` | 最多 64 个 XY 圆的创建方案 |
| `cad_propose_move` | 最多 64 个可见且可编辑的模型空间直线或圆的 XY 移动方案 |

向模型适配器**只提供工具定义和调用入口**。`approve(planId, reviewerId)` 与 `reject(planId, reviewerId)` 仅供可信宿主使用：宿主验证身份、检查权限，并让用户审核确切的修改参数。填写审核人字符串不等于完成身份验证。工具列表没有批准、任意命令、文件或网络执行入口。

方案验证输入并绑定当前图纸，但返回的是**命令参数，不是图形预览**。实际执行仍可能因几何或编辑规则失败。批准尝试不会自动重放；失败或结果不确定时，先检查图纸，再创建新方案。此基础会话尚不包含持久化任务恢复或模型连接器。

创建操作使用核心批量命令的默认图层，明确在模型 XY 平面 z=0 上创建。读取保留原生坐标和省略说明，不展开图块或保证世界坐标。每个会话最多接受 128 个方案，同时只允许一个正在执行的操作。会话总量、模型费用、隔离、向模型发送数据的权限和持久化仍由宿主管理。厂家参数格式转换不能取消会话中的运行时验证。

运行安装包中的[工具会话示例](https://github.com/KanJieTeam/kjdraw/blob/main/packages/kjdraw-sdk/examples/agent-tools.mjs)：

```sh
node node_modules/@kanjieteam/kjdraw/examples/agent-tools.mjs
```

示例不调用模型或使用密钥，验证提案、模拟宿主批准、重复执行拒绝、原生文件重开和撤销。这是工具链验证，不是自然语言设计成功率的证明。

## 先让 Agent 读到任务需要的图纸内容 {#drawing-context}

宿主应用负责连接模型，并决定它可以读取哪些图纸数据。KJDraw 提供编辑工具和只读查询接口，让你按任务选取对象，不必把整份图纸文件发送出去。

该接口已加入当前源码；使用前请确认安装的 npm 版本已包含这个新入口。

```ts
import { createKJDrawSDK } from '@kanjieteam/kjdraw'
import { createDrawingContext } from '@kanjieteam/kjdraw/drawing-context'

const sdk = createKJDrawSDK()
const drawing = sdk.createDocument({ units: 'millimeter' })
await sdk.executeCommand('CREATE', {
  type: 'CIRCLE', payload: { center: [20, 30, 0], radius: 4 },
})

const context = createDrawingContext(drawing, {
  types: ['CIRCLE'],
  expectedRevision: drawing.revision,
  limit: 20,
  maxLayers: 0,
  maxBytes: 16_384,
})
// context.entities 包含原生几何、对象 ID 和编辑条件。
// 读取不会修改图纸，也不会连接模型。
```

用 `ids` 查询用户选中的对象，用 `types` 筛选图元类型，用 `layerIds` 筛选图层；多个条件同时生效。默认排除隐藏和冻结对象；锁定对象仍可读取，但标记为 `editable: false`。这个标记不代表访问权限，也不代表所有命令都支持该对象。

查询下一页对象时，使用 `offset: context.nextOffset`、相同筛选条件、`expectedRevision: context.revision` 和 `maxLayers: 0`；`nextOffset === null` 表示结束。图层目录单独设置 `limit: 0` 查询，再使用 `layerOffset` / `nextLayerOffset` 翻页，零也是有效的续页位置。所有分页都保留同一修订号，包括位置为零的续页；图纸变化后重新开始。

返回值通过 `truncated`、`truncationReasons` 和 `geometryOmittedReason` 明示省略内容。过大或尚不支持的几何会整体省略，不会截短坐标数组而变成另一种图形。原生坐标可能属于对象坐标系或块内局部坐标；接口保留方向字段，不展开 INSERT 块定义。查询结果只供任务读取，不能当作完整图纸覆盖原文件。

`maxBytes` 限制 JSON 响应的 UTF-8 字节数，不限制模型 token、快照内存或查询耗时。结果不包含原始文件标签、自定义元数据、历史和资源字节。图纸文字仍是不可信数据；权限和发送到外部模型的决定由宿主负责。

可运行包内的[图纸查询示例](https://github.com/KanJieTeam/kjdraw/blob/main/packages/kjdraw-sdk/examples/drawing-context.mjs)，查看对象和图层分别分页的完整做法。

## 修改前先审核 {#review-before-mutation}

```text
意图 → 计划信封 → 精确预览 → 人工批准
     → 校验后一次性执行 → 回执 → 撤销
```

AI 来源命令必须先完成精确提案的注册、审核和确认，才能修改图档。SDK 会把计划绑定到命令参数、图档身份、完整内容摘要、指纹、预期修订号和有效期。

## 计划与执行 {#plan-and-execute}

```ts
const plan = sdk.createCommandEnvelope('MOVE', {
  ids: selectedIds,
  dx: 5,
  dy: 0,
}, {
  mode: 'plan',
  origin: 'ai',
  expectedRevision: drawing.revision,
})

const registeredPlan = await sdk.executeCommandEnvelope(plan)
// 返回值是计划元数据，不是图形差异。
// 在界面展示 MOVE 的修改内容，并等待用户明确批准。

const execution = sdk.createCommandEnvelope(plan.command, plan.arguments, {
  origin: 'ai',
  expectedRevision: plan.expectedRevision,
  confirmation: {
    status: 'confirmed',
    planId: plan.id,
    confirmedBy: currentUser.id,
  },
})

const receipt = await sdk.executeCommandEnvelope(execution)
```

## 先预览，再应用修剪 {#geometric-preview}

让审核者先看到实际的图形变化。公开的连续边界编辑 API 与工作台的修剪、延伸工具使用同一套剩余线段和圆弧计算，不依赖模型服务、网络请求或 API Key。

以下示例创建一个圆和一条切割线。点选上半圆后，预览结果是一条仍可继续编辑的下半圆弧：

```ts
import { createKJDrawSDK } from '@kanjieteam/kjdraw'
import { createBoundaryEditSession } from '@kanjieteam/kjdraw/boundary-edit'

const sdk = createKJDrawSDK()
const drawing = sdk.createDocument({ units: 'millimeter' })
const boundary = await sdk.executeCommand<{ id: string }>('CREATE', {
  type: 'LINE', payload: { start: [-15, 0, 0], end: [15, 0, 0] },
})
const circle = await sdk.executeCommand<{ id: string }>('CREATE', {
  type: 'CIRCLE', payload: { center: [0, 0, 0], radius: 10 },
})
const edit = createBoundaryEditSession('trim', {
  document: drawing, boundaryIds: [boundary.id],
})
edit.confirmBoundaries()
const geometry = edit.preview(circle.id, [0, 10])
// geometry.pieces 是保留的 ARC，此时图纸尚未修改。
// 已挂载 KJCanvasRenderer 时：renderer.drawPreview(geometry.pieces)。

const plan = sdk.createCommandEnvelope(
  geometry.command.command, geometry.command.arguments,
  { document: drawing, expectedRevision: geometry.revision, origin: 'ai', mode: 'plan' },
)
await sdk.executeCommandEnvelope(plan, { document: drawing })
```

把 `geometry.pieces` 与原图同时展示。仅在宿主的批准操作中调用下列函数，传入经过认证的审核者身份：

```ts
async function applyApprovedTrim(confirmedBy: string) {
  const receipt = await edit.apply(geometry, request =>
    sdk.executeCommandEnvelope(sdk.createCommandEnvelope(
      request.command, request.arguments, {
        document: drawing, expectedRevision: request.expectedRevision, origin: 'ai',
        confirmation: { status: 'confirmed', planId: plan.id, confirmedBy },
      },
    ), { document: drawing }),
  )
  edit.finish()
  return receipt
}
```

用户拒绝时，调用 `sdk.agentPlans.reject(plan.id, reviewerId)` 和 `edit.cancel()`；审核结束后清除预览覆盖层。成功提交后，一次普通撤销即可恢复图形。

人工工具同样使用 `edit.apply`，但执行回调选择 `origin: 'ui'`，不填写 AI 确认信息。保持会话开启，即可继续使用同一组边界修改其他目标；每次提交后重新生成预览。

| API | 宿主应用的操作 |
| --- | --- |
| `setBoundaries(ids)` → `confirmBoundaries()` | 选择一次切割边界，在用户准备好时确认 |
| `preview(targetId, pickPoint)` | 读取不可变的 `pieces` 与 `command`，绘制临时覆盖层 |
| `apply(preview, execute)` | 通过 SDK 执行收到的命令，并返回命令信封回执 |
| `state` / `prompt` / `setLocale('zh')` | 展示当前阶段、完成次数和本地化提示 |
| `finish()` / `cancel()` | 结束会话；已经提交的修改仍可逐次撤销 |

修订变化、重复使用预览或执行参数改变时，会话不会误报成功。`apply` 除了核对 SDK 回执，还会核对实际提交与保留图形。宿主执行器错误地提交其他修改时，会话以 `boundary-edit.unexpected-commit` 结束，不会自动撤销宿主提交；请检查图纸并通过正常历史操作处理。

预览是进程内对象，请保留原实例，不要序列化后重新拼装。接入服务端 Agent 时，由宿主接收并校验意图、生成预览，再进入既有的计划审核流程。宿主允许切换图纸时，应把 `isDocumentCurrent` 绑定到当前图档对象及只读状态。

## 关闭执行的情况 {#fail-closed-cases}

- 计划缺失、被拒绝、已过期或已消费。
- 参数、目标图档或预期修订号发生变化。
- 生成预览后图档又发生漂移。
- 缺少审核人身份，或重放已经成功的执行信封。

## 安全边界 {#security-boundary}

这是单个 SDK 宿主进程内的应用协议。它不负责认证用户、隔离模型、跨服务执行组织策略，也不会替代持久批准账本。宿主负责这些控制，并可以保存返回回执作为审计证据。

Agent 开发者先阅读稳定的 [Agent 集成契约](https://github.com/KanJieTeam/kjdraw/blob/main/docs/agent.md)，完整生命周期和边界见持续维护的 [Agent 协议](https://github.com/KanJieTeam/kjdraw/blob/main/docs/agent-protocol.md)。
:::
