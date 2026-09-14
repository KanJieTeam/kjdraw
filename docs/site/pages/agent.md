---
slug: agent
title.en: Agent workflows
title.zh: Agent 工作流
summary.en: Let an AI read an authorized drawing, propose exact CAD changes, and hand the final decision to a trusted host.
summary.zh: 让 AI 读取获准访问的图纸、提出明确的 CAD 修改方案，并由可信宿主决定是否应用。
---
:::en
## Build a reviewed CAD workflow {#agent-tools}

The `@kanjieteam/kjdraw/agent-tools` entry point exports `KJAgentToolSession`, which gives any tool-calling model a controlled way to work with a KJDraw document. It exposes JSON-serializable tool definitions for reading, querying, measuring, checking and proposing CAD changes. Proposal tools return exact geometry for review and do not edit the document.

The host creates the session for one authorized `KJDocument`, sends selected tool definitions to the model, dispatches model calls through `session.call(name, arguments)`, and keeps approval in its own trusted user interface. The same API works with different model providers; provider connection examples are covered in [Models and harnesses](https://kanjieteam.github.io/kjdraw/docs/latest/models/).

### Capabilities {#capabilities}

- Read the current revision, units, layers, layouts and bounded drawing geometry.
- Query a user selection, object types, layers, owner space or an XY region without sending the entire file.
- Measure explicit points and check stated geometric requirements against native CAD objects.
- Propose editable native geometry and common edits with a before/after preview.
- Apply an approved proposal as one undoable transaction, with revision and argument checks before commit.
- Add project-specific guidance through host-trusted `KJAgentCapabilityRegistry` manifests without adding executable code to the model tool path.

KJDraw enforces the published input schemas again when `call()` runs. Tool descriptions guide the model, while the CAD core remains responsible for geometry, document revisions, limits and commit behavior.

## Install and import {#install}

Install the package in the application that owns the drawing and review UI:

```sh
npm install @kanjieteam/kjdraw@next
```

Import the SDK from the package root and Agent tools from the `agent-tools` entry point:

```ts
import { createKJDrawSDK } from '@kanjieteam/kjdraw'
import { KJAgentToolSession } from '@kanjieteam/kjdraw/agent-tools'

const sdk = createKJDrawSDK()
const drawing = sdk.createDocument({ units: 'millimeter' })
const session = new KJAgentToolSession(sdk, drawing)
```

`session.definitions` contains the tools available to that session. Definitions include each tool's `name`, `description`, `effect` and `inputSchema`; unit fields are restricted to the document's canonical unit name, such as `millimeter`. Preserve these schema constraints when adapting them to a provider.

The package requires Node.js 22 or later for its Node examples. To verify the installed tool-session path without a model or API key, run:

```sh
node node_modules/@kanjieteam/kjdraw/examples/agent-tools.mjs
```

The example proposes a circle, simulates the host approval step, rejects a duplicate approval, reopens the native file and verifies Undo. It checks integration behavior rather than natural-language drawing quality.

## Shortest working flow {#quickstart}

This runnable example creates a session and asks for a circle proposal. The document remains unchanged while the proposal is waiting for review:

```ts
import { createKJDrawSDK } from '@kanjieteam/kjdraw'
import {
  KJAgentToolSession,
  type KJAgentGeometryPreview,
} from '@kanjieteam/kjdraw/agent-tools'

const sdk = createKJDrawSDK()
const drawing = sdk.createDocument({ units: 'millimeter' })
const session = new KJAgentToolSession(sdk, drawing)

const result = await session.call('cad_propose_circles', {
  expectedRevision: drawing.revision,
  units: 'millimeter',
  circles: [{ center: { x: 20, y: 20 }, radius: 3 }],
})
if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)

const proposal = result.value as {
  status: 'awaiting-host-approval'
  preview: KJAgentGeometryPreview
}
console.log(proposal.status, proposal.preview)
if (drawing.revision !== 0) throw new Error('A proposal must not edit the drawing')
```

Connect it to a model in four steps:

1. Give the provider adapter the selected entries from `session.definitions`.
2. Forward each model tool call to `session.call(name, arguments)` and return the result to the same model conversation.
3. When a proposal succeeds, show its exact arguments and `value.preview` to the reviewer.
4. After the host authenticates the reviewer and checks permission, call `session.approve(planId, reviewerId)` or `session.reject(planId, reviewerId)` from the host action.

Do not include `approve` or `reject` in the model's tool list. A reviewer ID string identifies the decision in KJDraw; authentication and authorization happen in the host application.

## Choose the right tool {#tool-selection}

Start with the narrowest tool that matches the task. The table lists the common entry points; inspect `session.definitions` for the complete tool set and its current schemas.

| Tool | Use it for |
| --- | --- |
| `cad_read_drawing` | Read the first bounded page of visible model-space objects, layers, units and revision |
| `cad_read_page` | Continue the unfiltered read with the returned entity and layer offsets |
| `cad_read_layouts` | Discover model and paper layouts, exact owner-space IDs and numeric page settings |
| `cad_query_drawing` | Read a revision-bound page filtered by ID, type, layer, owner space or XY bounds |
| `cad_measure_distance` | Calculate an exact planar distance between two supplied points in drawing units |
| `cad_check_geometry` | Compare explicit lengths, radii, feature distances or topology checks with native objects |
| `cad_propose_lines` | Propose 1–64 model-space XY lines |
| `cad_propose_circles` | Propose 1–64 model-space XY circles |
| `cad_propose_move` | Propose one XY move for supported visible, editable objects or a named selection set |
| `cad_propose_drawing` | Propose a mixed batch of native lines, circles, arcs, ellipses, splines, polylines and hatches |

Use `cad_read_drawing` when the model needs an initial overview. Use `cad_query_drawing` for a user selection or a known region, and continue with identical filters plus the returned `nextOffset` and `nextLayerOffset`. Call `cad_read_layouts` first when paper space is involved, then pass its exact `spaceId` to `cad_query_drawing`. `cad_read_page` continues only an unfiltered read and does not remember query filters.

Use `cad_check_geometry` only after reading the real object IDs. An unmet requirement returns `ok: true` with `value.passed: false`: the tool executed successfully and the geometry failed the requested check. The result proves only the expectations and tolerances supplied by the host; it does not certify a complete design.

Choose a specific proposal tool for a focused edit. Use `cad_propose_drawing` for a mixed batch; the installed `examples/agent-drawing.mjs` builds a profile with holes and a slot, then verifies preview, approval, file reopen and history. More specialized proposal tools in `session.definitions` cover transforms, compact patterns, annotations and packaged engineering workflows.

Native coordinates can be object-local or block-local. Read tools do not expand block definitions or promise world coordinates, and XY bounds are drawing coordinates rather than screen pixels or paper viewport projections. Treat `spatialMatch: 'unclassified'` as requiring inspection, never as proof that an object intersects the requested region.

### Direct host-side drawing context {#drawing-context}

If the host needs drawing data outside a model tool loop, use the same bounded query implementation directly. `createLayoutContext(document, options)` provides the corresponding immutable layout catalog.

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

## Review and apply proposals {#review-and-apply}

Every successful proposal contains the document ID, expected revision, normalized arguments, a `planId` and exact before/after geometry in `value.preview`. Render that preview over the current drawing and show the proposed parameters. If the camera changes, redraw the overlay from the stored preview.

Approval is a one-shot host operation. KJDraw checks that the plan is still pending, the bound document and revision are unchanged, and the committed geometry matches the reviewed proposal. A successful commit becomes one normal Undo step. Rejecting a proposal consumes it without changing the drawing.

For lower-level SDK commands, the equivalent protocol uses `sdk.createCommandEnvelope(..., { mode: 'plan', origin: 'ai' })`, followed by a confirmed execution envelope after review. Keep the plan ID, command arguments and document revision unchanged between these steps.

### Preview and apply a trim {#geometric-preview}

The boundary-editing API can preview the exact retained geometry used by the workbench Trim/Extend tools. The example below creates a circle and cutting line, then proposes keeping the lower semicircle as an editable ARC:

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

Present `geometry.pieces` with the original drawing. Call the following function only from the host's approval action, using the authenticated reviewer's identity:

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

Reject with `sdk.agentPlans.reject(plan.id, reviewerId)` and `edit.cancel()`. Keep the original in-process preview object until review ends; create a new preview after any document change.

## Handle errors and enforce boundaries {#errors-and-boundaries}

`session.call()` resolves to a discriminated result. Read `value` only when `ok` is `true`; otherwise log the stable `error.code` and show an action-oriented message to the user.

| Result | Host response |
| --- | --- |
| `KJDOCUMENT_REVISION_CONFLICT` | Re-read the drawing and ask the model to produce a new proposal against the new revision |
| `KJDOCUMENT_INVALID` | Correct the tool name or arguments using this session's definition; do not retry unchanged input |
| `KJAGENT_TOOL_FAILED` | Stop automatic retries and let the host inspect the underlying failure |
| Successful read with `value.passed: false` | Report the failed geometric checks; do not convert it into a successful design result |

The session permits one operation at a time and at most 128 proposals. Individual definitions set their own object, byte and pagination limits. Start a new session only when the host intentionally begins a new authorized work period; do not use session replacement to bypass a rejected or stale plan.

These boundaries always remain with the host application:

- Authorize which document and drawing data the model may access.
- Authenticate reviewers and enforce project or organization permissions.
- Keep `approve`, `reject`, file access, network access and arbitrary command execution out of the model tool list.
- Preserve user-approved dimensions, tolerances and requirements; model text is not execution evidence.
- Set model budgets, timeouts, data-retention rules and provider-specific disclosure controls.
- Store receipts or approval records when a durable audit trail is required.

KJDraw validates tool inputs and reviewed CAD mutations inside one SDK host process. It does not sandbox a model, authenticate users, enforce policy across services or certify engineering fitness. Failed or uncertain approval attempts must be inspected and must not be retried automatically.

For the lifecycle and trust model, read the [Agent integration contract](https://github.com/KanJieTeam/kjdraw/blob/main/docs/agent.md) and [Agent protocol](https://github.com/KanJieTeam/kjdraw/blob/main/docs/agent-protocol.md).
:::
:::zh
## 构建可审核的 CAD 工作流 {#agent-tools}

`@kanjieteam/kjdraw/agent-tools` 入口导出的 `KJAgentToolSession` 为支持工具调用的模型提供受控的 KJDraw 图纸操作入口。它以可序列化的 JSON 定义提供读取、查询、测量、校核和修改提案能力。提案工具返回可供审核的准确几何，不会直接修改图纸。

宿主为一份获准访问的 `KJDocument` 创建会话，把选定的工具定义交给模型，通过 `session.call(name, arguments)` 分派模型调用，并在自己的可信界面中保留批准权。这套 API 不绑定模型厂商；厂商接入示例见[模型与执行框架](https://kanjieteam.github.io/kjdraw/docs/latest/models/)。

### 能力 {#capabilities}

- 读取当前修订号、单位、图层、布局和有界的图纸几何。
- 按用户选择、对象类型、图层、归属空间或 XY 范围查询，无需发送整个文件。
- 测量明确的点，并依据指定要求校核原生 CAD 对象。
- 提出可编辑的原生几何和常用修改，同时返回修改前后预览。
- 将批准后的提案作为一次可撤销事务应用，提交前核对修订号和参数。
- 通过宿主信任的 `KJAgentCapabilityRegistry` 清单添加项目能力说明，不向模型工具路径注入可执行代码。

`call()` 执行时，KJDraw 会再次按公开输入结构校验参数。工具描述用于指导模型，几何、图纸修订、用量限制和提交行为仍由 CAD 核心负责。

## 安装与导入 {#install}

在持有图纸和审核界面的应用中安装软件包：

```sh
npm install @kanjieteam/kjdraw@next
```

从包根目录导入 SDK，从 `agent-tools` 入口导入 Agent 工具：

```ts
import { createKJDrawSDK } from '@kanjieteam/kjdraw'
import { KJAgentToolSession } from '@kanjieteam/kjdraw/agent-tools'

const sdk = createKJDrawSDK()
const drawing = sdk.createDocument({ units: 'millimeter' })
const session = new KJAgentToolSession(sdk, drawing)
```

`session.definitions` 是该会话可以使用的工具清单。每项定义都包含 `name`、`description`、`effect` 和 `inputSchema`；单位字段会限定为图纸使用的规范名称，例如 `millimeter`。转换为模型厂商格式时，必须保留这些结构约束。

Node.js 示例要求 Node.js 22 或更高版本。无需模型或 API Key，即可验证安装包中的工具会话入口：

```sh
node node_modules/@kanjieteam/kjdraw/examples/agent-tools.mjs
```

该示例会提出圆形绘制方案、模拟宿主批准、拒绝重复批准、重新打开原生文件并验证撤销。它验证接入行为，不代表自然语言绘图质量。

## 最短工作流 {#quickstart}

下面的可运行示例创建会话并提出一个圆形方案。方案等待审核时，图纸保持不变：

```ts
import { createKJDrawSDK } from '@kanjieteam/kjdraw'
import {
  KJAgentToolSession,
  type KJAgentGeometryPreview,
} from '@kanjieteam/kjdraw/agent-tools'

const sdk = createKJDrawSDK()
const drawing = sdk.createDocument({ units: 'millimeter' })
const session = new KJAgentToolSession(sdk, drawing)

const result = await session.call('cad_propose_circles', {
  expectedRevision: drawing.revision,
  units: 'millimeter',
  circles: [{ center: { x: 20, y: 20 }, radius: 3 }],
})
if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)

const proposal = result.value as {
  status: 'awaiting-host-approval'
  preview: KJAgentGeometryPreview
}
console.log(proposal.status, proposal.preview)
if (drawing.revision !== 0) throw new Error('提案不得直接修改图纸')
```

接入模型需要四步：

1. 把 `session.definitions` 中经过宿主选择的工具交给模型厂商适配器。
2. 将模型的每次工具调用转发到 `session.call(name, arguments)`，再把结果返回同一个模型会话。
3. 提案成功后，向审核者展示准确参数和 `value.preview`。
4. 宿主完成审核人认证和权限检查后，在宿主操作中调用 `session.approve(planId, reviewerId)` 或 `session.reject(planId, reviewerId)`。

不要把 `approve` 或 `reject` 放进模型工具清单。审核人 ID 字符串只用于在 KJDraw 中标记决策，身份认证和权限判断由宿主应用完成。

## 选择合适的工具 {#tool-selection}

优先选择刚好满足任务的最小工具。下表列出常用入口；完整工具集和当前参数结构以 `session.definitions` 为准。

| 工具 | 适用场景 |
| --- | --- |
| `cad_read_drawing` | 读取可见模型空间对象、图层、单位和修订号的首个有界页面 |
| `cad_read_page` | 使用返回的对象和图层偏移继续未筛选读取 |
| `cad_read_layouts` | 发现模型/图纸布局、准确归属空间 ID 和数值页面设置 |
| `cad_query_drawing` | 按 ID、类型、图层、归属空间或 XY 范围读取绑定修订的分页结果 |
| `cad_measure_distance` | 用图纸单位计算两个给定点之间的准确平面距离 |
| `cad_check_geometry` | 将明确的长度、半径、特征点距离或拓扑检查与原生对象对比 |
| `cad_propose_lines` | 提出 1–64 条模型空间 XY 直线 |
| `cad_propose_circles` | 提出 1–64 个模型空间 XY 圆 |
| `cad_propose_move` | 对受支持的可见可编辑对象或命名选择集提出一次 XY 移动 |
| `cad_propose_drawing` | 成批提出原生直线、圆、圆弧、椭圆、样条、多段线和填充 |

模型首次了解图纸时使用 `cad_read_drawing`；目标是用户选择或已知范围时使用 `cad_query_drawing`，并保持筛选条件不变，以返回的 `nextOffset` 和 `nextLayerOffset` 继续分页。涉及图纸空间时，先调用 `cad_read_layouts`，再把返回的准确 `spaceId` 传给 `cad_query_drawing`。`cad_read_page` 只继续未筛选读取，不保存查询条件。

读取真实对象 ID 后再调用 `cad_check_geometry`。要求未满足时会返回 `ok: true` 和 `value.passed: false`：工具执行成功，但几何未通过指定检查。结果只证明宿主给出的期望和容差，不代表整套设计已经合格。

单一修改使用对应的专用提案工具；混合图形批量创建使用 `cad_propose_drawing`。安装包中的 `examples/agent-drawing.mjs` 会生成带孔和槽的轮廓，并验证预览、批准、文件重开和历史记录。`session.definitions` 中还有变换、紧凑阵列、标注和成套工程制图等专用提案工具。

原生坐标可能属于对象局部坐标或块内坐标。读取工具不会展开块定义，也不保证返回世界坐标；XY 范围使用图纸坐标，不是屏幕像素或图纸视口投影。`spatialMatch: 'unclassified'` 表示需要人工检查，不能作为对象与查询范围相交的证明。

### 宿主直接读取图纸上下文 {#drawing-context}

宿主需要在模型工具循环之外读取数据时，可以直接使用同一套有界查询实现。`createLayoutContext(document, options)` 提供对应的不可变布局目录。

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

## 审核并应用提案 {#review-and-apply}

每个成功提案都包含图档 ID、预期修订号、规范化参数、`planId`，以及 `value.preview` 中准确的修改前后几何。把预览叠加到当前图纸，并展示提案参数；相机改变后，应根据保存的预览重新绘制覆盖层。

批准是一次性的宿主操作。KJDraw 会检查方案仍在等待处理、绑定图纸和修订号没有变化，且提交几何与已审核提案一致。成功提交后可用一次普通撤销恢复；拒绝会消费该提案，但不修改图纸。

直接使用底层 SDK 命令时，对应流程先调用 `sdk.createCommandEnvelope(..., { mode: 'plan', origin: 'ai' })`，审核后再执行带确认信息的命令信封。两步之间必须保持方案 ID、命令参数和图纸修订号不变。

### 先预览，再应用修剪 {#geometric-preview}

边界编辑 API 可以预览工作台修剪/延伸工具使用的准确保留几何。以下示例创建一个圆和一条切割线，随后提出保留下半圆弧的方案：

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

把 `geometry.pieces` 与原图同时展示。仅在宿主的批准操作中调用以下函数，并传入经过认证的审核者身份：

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

拒绝时调用 `sdk.agentPlans.reject(plan.id, reviewerId)` 和 `edit.cancel()`。审核结束前保留原始的进程内预览对象；图纸发生任何变化后都应重新生成预览。

## 处理错误与守住边界 {#errors-and-boundaries}

`session.call()` 返回可区分的结果。仅当 `ok` 为 `true` 时读取 `value`；失败时记录稳定的 `error.code`，并向用户说明下一步操作。

| 结果 | 宿主处理方式 |
| --- | --- |
| `KJDOCUMENT_REVISION_CONFLICT` | 重新读取图纸，让模型基于新修订号生成新的提案 |
| `KJDOCUMENT_INVALID` | 按当前会话的工具定义修正工具名或参数，不要原样重试 |
| `KJAGENT_TOOL_FAILED` | 停止自动重试，由宿主检查底层失败原因 |
| 读取成功但 `value.passed: false` | 报告未通过的几何检查，不得把结果改写为设计成功 |

同一会话每次只允许一个操作，最多接受 128 个提案。每项工具定义还规定对象数量、字节数和分页上限。只有宿主明确开始新的授权工作阶段时才创建新会话；不能通过更换会话绕过被拒绝或已经过期的方案。

以下边界始终由宿主应用负责：

- 决定模型可以访问哪份图纸以及哪些图纸数据。
- 认证审核者，并执行项目或组织权限规则。
- 不向模型开放 `approve`、`reject`、文件访问、网络访问或任意命令执行。
- 保存用户批准的尺寸、容差和要求；模型文字不能代替执行证据。
- 设置模型预算、超时、数据保留规则和厂商数据披露范围。
- 需要持久审计轨迹时保存回执或批准记录。

KJDraw 在单个 SDK 宿主进程内校验工具参数和已审核的 CAD 修改。它不负责隔离模型、认证用户、跨服务执行策略或证明工程适用性。批准失败或结果不确定时，应先检查原因，不得自动重试。

完整生命周期和信任边界见 [Agent 集成契约](https://github.com/KanJieTeam/kjdraw/blob/main/docs/agent.md)与 [Agent 协议](https://github.com/KanJieTeam/kjdraw/blob/main/docs/agent-protocol.md)。
:::
