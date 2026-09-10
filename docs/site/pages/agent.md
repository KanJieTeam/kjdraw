---
slug: agent
title.en: Agent workflows
title.zh: Agent 工作流
summary.en: Give your agent focused drawing context, review its proposed edits, and let a person keep working on the result.
summary.zh: 让 Agent 按需读取图纸，检查它提出的修改，再由人接手继续编辑。
---
:::en
## Model-neutral CAD tools {#agent-tools}

The current source checkout adds `KJAgentToolSession` from `@kanjieteam/kjdraw/agent-tools`. Check source/package availability before using this new entry. The session binds one host-authorized document and provides serializable tool definitions plus a `call(name, arguments)` dispatcher. Pass `session.definitions` to models: unit parameters are restricted to the current drawing's canonical unit name, such as `millimeter`, rather than relying on the model to guess an abbreviation.

| Tool | Result |
| --- | --- |
| `cad_read_drawing` | First page of visible model-space objects, layers and drawing units |
| `cad_read_page` | Revision-bound continuation with independent entity/layer offsets |
| `cad_read_layouts` | Discover layout IDs, owner spaces and numeric page settings with bounded pagination |
| `cad_query_drawing` | Filtered, revision-bound pages by ID, type, layer, owner space and XY region |
| `cad_measure_distance` | Planar point-to-point distance in the supplied drawing units |
| `cad_propose_lines` | Proposed batch of up to 64 XY lines |
| `cad_propose_circles` | Proposed batch of up to 64 XY circles |
| `cad_propose_move` | Proposed XY move of up to 64 visible editable model-space LINE/CIRCLE/ARC/LWPOLYLINE/XLINE/RAY objects; preserves guide directions |
| `cad_propose_drawing` | One mixed drawing proposal with lines, circles, arcs and polylines; up to 64 objects total |

Expose **only the definitions and dispatcher** to your model adapter. `approve(planId, reviewerId)` and `reject(planId, reviewerId)` are trusted-host methods: the host authenticates the user, checks permissions and collects review of the exact proposed arguments. A reviewer string by itself is not authentication. There is no model-callable approval, arbitrary command, file or network tool.

All drawing and move proposals return **before/after geometry** in `value.preview`. KJDraw runs the core operation on a detached copy, checking geometry and editing rules without changing the original drawing or its undo history. Creation IDs are allocated once and bound to the proposal, so approval uses the same objects that were previewed. Approval checks the drawing revision and the resulting geometry. Failed or uncertain approval attempts are never retried automatically.

Paint the preview using your editor's renderer (clear and redraw the overlay after a camera change). `before` is the old geometry and `after` is the proposed result:

```ts
import type { KJAgentGeometryPreview } from '@kanjieteam/kjdraw/agent-tools'

function showProposal(preview: KJAgentGeometryPreview) {
  renderer.render()
  renderer.drawPreview(preview.before, '#e87979')
  renderer.drawPreview(preview.after, '#52c99b')
}
// Clear the overlay with renderer.render() when rejected or applied.
```

Preview preparation uses a detached copy-on-write document branch: unrelated drawing data no longer has to fit a 4 MiB serialized-source limit. The current limits are 250,000 document objects, 4 MiB of combined command arguments and touched input records, 64 changed objects and 256 KiB of returned geometry. Full-document validation and change inspection still run; this is not a constant-time or isolated-memory guarantee. It uses built-in core commands, not host replacements. A preview is not a mechanical-design or manufacturing validation. For model connections and the bounded execution loop, see [Models and harnesses](https://kanjieteam.github.io/kjdraw/docs/latest/models/).

For custom host-side experiments, `document.fork()` creates a branch at the current revision with independent edits and undo history. It retains the document ID but does not inherit authority, listeners, queued edits or earlier undo entries. Do not attach both branches to the same SDK document map under that ID. A fork does not approve or merge changes; apply reviewed commands through the original document's normal host approval flow.

Creation uses the core batch command's default layer and explicitly targets model XY at z=0. Read results retain native coordinates and omission notices; they do not expand blocks or promise world-coordinate geometry. Each session accepts at most 128 proposals and permits one in-flight operation. The host still owns total session limits, model budgets, isolation, model-data disclosure and persistence. Provider-specific schema conversion must not remove the session's runtime validation.

Run the installed [tool-session example](https://github.com/KanJieTeam/kjdraw/blob/main/packages/kjdraw-sdk/examples/agent-tools.mjs):

```sh
node node_modules/@kanjieteam/kjdraw/examples/agent-tools.mjs
```

It exercises proposal, simulated host approval, duplicate rejection, native-file reopen and undo without a model or API key. This verifies tool plumbing, not natural-language design success.

## Draw a profile and holes in one proposal {#compose-drawing}

Use `cad_propose_drawing` when one request describes multiple kinds of geometry. The groups share a total limit of 64 objects. All four arrays are required; leave unused ones empty. Polyline vertices form straight segments (2–64 vertices, at least 3 when closed). Arc angles use degrees from positive X, counterclockwise; for example, 270 → 90 wraps through 0 degrees. Use a circle for a full revolution.

```ts
import { createKJDrawSDK } from '@kanjieteam/kjdraw'
import { KJAgentToolSession, type KJAgentDrawingInput } from '@kanjieteam/kjdraw/agent-tools'

const sdk = createKJDrawSDK()
const drawing = sdk.createDocument({ units: 'millimeter' })
const session = new KJAgentToolSession(sdk, drawing)
const input: KJAgentDrawingInput = {
  expectedRevision: drawing.revision, units: 'millimeter',
  lines: [], arcs: [],
  circles: [{ center: { x: 20, y: 20 }, radius: 3 }],
  polylines: [{
    vertices: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 40 }, { x: 0, y: 40 }],
    closed: true,
  }],
}
const proposal = await session.call('cad_propose_drawing', input)
// Show proposal.value.preview when proposal.ok is true.
// Apply only after host review. No model approval tool is provided.
```

The installed example builds a 120 × 60 mm profile with four holes and a rounded slot, then checks preview, test-only approval, KJD/DXF reopen, undo and redo:

```sh
node node_modules/@kanjieteam/kjdraw/examples/agent-drawing.mjs
```

The example is deterministic and needs no API key. To connect a model, expose this same tool through [Models and harnesses](https://kanjieteam.github.io/kjdraw/docs/latest/models/). These shapes remain regular editable CAD entities. The tool does not infer dimensions, manufacturing tolerances, constraints or whether a design is fit for use.

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

## Query a region or selected objects {#query-region}

To discover paper space before querying its contents, call `cad_read_layouts` with `expectedRevision`, `offset: 0`, `limit` (1–100), and `maxBytes` (1024–262144). Use the returned layout's exact `spaceId` in `cad_query_drawing.filters.spaceId`. The public `createLayoutContext(document, options)` API returns the same immutable catalog; its default page is 20 layouts and 16 KiB. Continuations require the same revision and `nextOffset`; restart after a revision conflict.

Each row includes layout identity/name, model/active flags, tab order, and numeric `pageSettings` from `dxfPlotSettings`. Paper dimensions, margins and origin offsets remain millimeters even when `paperUnits` is 0 (inches) or 2 (pixels). Rotation is a 0–3 quarter-turn index; window coordinates use drawing units. Printer, paper, setup, view and style resource names, native output preferences and custom payloads are excluded. `null` page settings mean unavailable unless `omitted` contains `page-settings`; over-budget names/settings are explicitly omitted and identities are never shortened. `truncated` covers both continuation and omitted fields. Layout names are untrusted drawing data. Byte limits cover the context JSON, excluding tool/protocol wrappers, and do not bound snapshot allocation or scan time. This reads owner-space geometry; viewport projection and page-edit proposals remain outside this tool.

Use `cad_query_drawing` with a revision from `cad_read_drawing` or the trusted editor. `filters` may contain `ids`, `types`, `layerIds`, `spaceId`, `includeHidden` and `bounds`; all filters intersect. Omitted filters are unrestricted; empty arrays match nothing. The default owner is model space. Hidden/frozen objects are excluded unless requested; locked objects remain readable and are marked noneditable.

```ts
import type { KJAgentDrawingQuery } from '@kanjieteam/kjdraw/agent-tools'
const query: KJAgentDrawingQuery = {
  expectedRevision: drawing.revision,
  filters: { types: ['LINE', 'ARC'], bounds: [0, 0, 120, 60] },
  offset: 0, layerOffset: 0, limit: 50, maxLayers: 20, maxBytes: 16384,
}
const page = await session.call('cad_query_drawing', query)
```

Continue with **this same tool and identical filters**, replacing offsets with `nextOffset` / `nextLayerOffset`. Set `limit: 0` or `maxLayers: 0` for a completed collection. A null next offset means that collection ended. `cad_read_page` is the older unfiltered query and does not remember filters. A revision mismatch requires a fresh query. Limits are 200 entities, 100 layers and 1–256 KiB for the JSON context (excluding the tool wrapper); geometry omissions and byte-budget continuation remain explicit. Scanning time is not bounded by the output byte cap.

`bounds` is an ordered `[minX,minY,maxX,maxY]` crossing rectangle in the selected owner's XY coordinates. A host can derive it from `renderer.screenToWorld()` at opposite canvas corners. It is not a paper viewport projection or a screen pixel rectangle. Lines, rays, construction lines, points, circles, arcs and polyline segments/bulges use the shared CAD intersection geometry. A circle surrounding the rectangle without touching it is outside. Text, blocks, other unsupported types, tilted normals and polylines exceeding 4,096 vertices are conservatively retained as `spatialMatch: 'unclassified'`; they are not proof of intersection. Other results are marked `intersects`. `spatialQuery` echoes the coordinate semantics and bounds. No block contents are expanded or converted to world coordinates, and geometry stays in its original native coordinates. Inspect unclassified results before acting; never infer that unsupported geometry is absent.

HATCH regions with polygon/bulge or LINE/ARC boundaries support the even-odd rule: holes are excluded and nested solid islands included. Circular arcs use analytic intersections and ray crossings rather than display chords, including clockwise arcs and two-bulge circles. Queries concern the filled geometric region, not individual pattern ink or gaps. Ellipse/spline HATCH boundaries, unknown patterns, more than 128 loops or more than 4,096 boundary edges remain `unclassified`; dense drawing budgets do not change the stored region. Canvas may still approximate curved fills for display; a sub-pixel query can resolve geometry that the display approximation does not show.

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

当前源码新增 `@kanjieteam/kjdraw/agent-tools` 中的 `KJAgentToolSession`。使用前核对源码与安装包的发布状态。一个会话绑定一份由宿主授权的图纸，提供可序列化的工具定义和 `call(name, arguments)` 调用入口。向模型传递 `session.definitions`：单位参数会限定为当前图纸的规范名称，例如 `millimeter`，不再让模型猜测缩写。

| 工具 | 返回结果 |
| --- | --- |
| `cad_read_drawing` | 可见模型空间对象、图层和单位的第一页 |
| `cad_read_page` | 绑定图纸版本、分别按对象和图层偏移继续读取 |
| `cad_read_layouts` | 有界分页发现布局 ID、归属空间和数值页面参数 |
| `cad_query_drawing` | 按 ID、类型、图层、归属空间和 XY 范围筛选并绑定版本分页 |
| `cad_measure_distance` | 使用图纸单位计算同一坐标系中两点的平面距离 |
| `cad_propose_lines` | 最多 64 条 XY 直线的创建方案 |
| `cad_propose_circles` | 最多 64 个 XY 圆的创建方案 |
| `cad_propose_move` | 最多 64 个可见且可编辑的模型空间直线、圆、圆弧、轻量多段线、构造线或射线的 XY 移动方案；保留辅助线方向 |
| `cad_propose_drawing` | 将直线、圆、圆弧和多段线组成同一个绘图方案，总计最多 64 个对象 |

向模型适配器**只提供工具定义和调用入口**。`approve(planId, reviewerId)` 与 `reject(planId, reviewerId)` 仅供可信宿主使用：宿主验证身份、检查权限，并让用户审核确切的修改参数。填写审核人字符串不等于完成身份验证。工具列表没有批准、任意命令、文件或网络执行入口。

所有绘图和移动方案在 `value.preview` 中返回**修改前后的真实几何**。KJDraw 在图纸副本上执行核心操作，检查几何及编辑规则，不改动原图或撤销记录。新对象 ID 在提案时固定，批准时使用预览中的同一批对象，并核对图纸修订和实际修改结果。批准失败或结果不确定时不会自动重试。

使用编辑器的渲染器叠加显示预览；相机变化后需清除并重绘。`before` 是修改前图形，`after` 是拟应用结果：

```ts
import type { KJAgentGeometryPreview } from '@kanjieteam/kjdraw/agent-tools'

function showProposal(preview: KJAgentGeometryPreview) {
  renderer.render()
  renderer.drawPreview(preview.before, '#e87979')
  renderer.drawPreview(preview.after, '#52c99b')
}
// 拒绝或应用后调用 renderer.render() 清除叠加预览。
```

预览改用隔离的写时复制图档分支，不再要求整张图序列化后小于 4 MiB。当前限制为图档最多 250,000 个对象、命令参数与待修改输入记录合计最多 4 MiB、最多 64 个修改对象和 256 KiB 返回几何。仍会执行完整图档校验和变化检查，不保证恒定耗时或独立内存上限。预演使用内置核心命令，不执行宿主替换命令；图形预览不等于机械设计或制造校核。模型接入与有预算限制的执行循环见[模型与执行框架](https://kanjieteam.github.io/kjdraw/docs/latest/models/)。

宿主需要自行试算时，可调用 `document.fork()`：分支从当前修订开始，修改和撤销记录彼此独立，保留图档 ID，但不继承权威后端、监听器、排队任务或已有撤销记录。不要把同 ID 的原图和分支同时注册到同一个 SDK 图档表。分支不会批准或合并修改；正式应用仍须通过原图的正常宿主审核流程。

创建操作使用核心批量命令的默认图层，明确在模型 XY 平面 z=0 上创建。读取保留原生坐标和省略说明，不展开图块或保证世界坐标。每个会话最多接受 128 个方案，同时只允许一个正在执行的操作。会话总量、模型费用、隔离、向模型发送数据的权限和持久化仍由宿主管理。厂家参数格式转换不能取消会话中的运行时验证。

运行安装包中的[工具会话示例](https://github.com/KanJieTeam/kjdraw/blob/main/packages/kjdraw-sdk/examples/agent-tools.mjs)：

```sh
node node_modules/@kanjieteam/kjdraw/examples/agent-tools.mjs
```

示例不调用模型或使用密钥，验证提案、模拟宿主批准、重复执行拒绝、原生文件重开和撤销。这是工具链验证，不是自然语言设计成功率的证明。

## 一次提出轮廓和孔位的组合绘图方案 {#compose-drawing}

一个需求包含多种图形时，使用 `cad_propose_drawing`。四组图形合计最多 64 个对象；四个数组都必须提供，不使用的组填空数组。多段线由直线段组成，允许 2–64 个顶点，闭合时至少 3 个；无需重复首点。圆弧从 X 正方向逆时针计角，单位是度，例如 270 → 90 会跨过 0 度。整圆请放在 circles 中。

```ts
import { createKJDrawSDK } from '@kanjieteam/kjdraw'
import { KJAgentToolSession, type KJAgentDrawingInput } from '@kanjieteam/kjdraw/agent-tools'

const sdk = createKJDrawSDK()
const drawing = sdk.createDocument({ units: 'millimeter' })
const session = new KJAgentToolSession(sdk, drawing)
const input: KJAgentDrawingInput = {
  expectedRevision: drawing.revision, units: 'millimeter',
  lines: [], arcs: [],
  circles: [{ center: { x: 20, y: 20 }, radius: 3 }],
  polylines: [{
    vertices: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 40 }, { x: 0, y: 40 }],
    closed: true,
  }],
}
const proposal = await session.call('cad_propose_drawing', input)
// proposal.ok 为 true 时展示 proposal.value.preview。
// 用户审核后才由宿主批准；不要向模型暴露批准入口。
```

安装包示例绘制 120 × 60 mm 轮廓、四个孔和一个长圆槽，并验证预览、模拟批准、KJD/DXF 重开、撤销和重做：

```sh
node node_modules/@kanjieteam/kjdraw/examples/agent-drawing.mjs
```

示例无需 API Key，使用确定性输入。真实模型接入复用同一个工具，见[模型与执行框架](https://kanjieteam.github.io/kjdraw/docs/latest/models/)。结果是可继续编辑的常规 CAD 对象；工具不自动推断标注、制造公差、约束或设计适用性。

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

## 查询局部范围或指定对象 {#query-region}

查询纸空间内容前，先以 `expectedRevision`、`offset: 0`、`limit`（1–100）和 `maxBytes`（1024–262144）调用 `cad_read_layouts`，将目标布局返回的准确 `spaceId` 传给 `cad_query_drawing.filters.spaceId`。公开 API `createLayoutContext(document, options)` 返回同一不可变目录，默认每页 20 布局、16 KiB；继续分页使用相同修订和 `nextOffset`，版本冲突后重新读取。

每行包含布局标识/名称、模型/活动状态、页签顺序和 `dxfPlotSettings` 的数值 `pageSettings`。纸张、边距和原点偏移仍以毫米计，即使 `paperUnits` 为 0（英寸）或 2（像素）；旋转为 0–3 的四分之一圈索引，窗口坐标为绘图单位。不输出打印机、纸型、设置、视图或样式资源名称，也不输出原生输出偏好和自定义负载。页面参数为 `null` 表示未提供，若因预算省略则 `omitted` 明确包含 `page-settings`；名称和页面参数可省略，身份字符串绝不截短。`truncated` 同时标记未读完与字段省略。布局名称是非可信图纸数据。字节上限只涵盖上下文 JSON（不含工具和协议包装），不限制快照分配或扫描时间。本工具读取对象归属空间，不执行视口投影或页面编辑提案。

`cad_query_drawing` 使用 `cad_read_drawing` 或可信编辑器提供的修订号。`filters` 可包含 `ids`、`types`、`layerIds`、`spaceId`、`includeHidden` 和 `bounds`，各过滤条件取交集。省略条件表示不限制，空数组表示不匹配任何对象。默认查询模型空间；隐藏/冻结对象默认排除，锁定对象可读且标为不可编辑。

```ts
import type { KJAgentDrawingQuery } from '@kanjieteam/kjdraw/agent-tools'
const query: KJAgentDrawingQuery = {
  expectedRevision: drawing.revision,
  filters: { types: ['LINE', 'ARC'], bounds: [0, 0, 120, 60] },
  offset: 0, layerOffset: 0, limit: 50, maxLayers: 20, maxBytes: 16384,
}
const page = await session.call('cad_query_drawing', query)
```

继续分页时必须使用**相同工具和相同过滤条件**，将偏移替换为 `nextOffset` / `nextLayerOffset`。某个集合读完后将 `limit` 或 `maxLayers` 设为 0；下一偏移为 null 表示该集合结束。旧的 `cad_read_page` 不保存过滤条件。修订冲突必须重新查询。上限为 200 个对象、100 个图层和 1–256 KiB 的上下文 JSON（不含工具外层包装）；几何遗漏和字节预算分页都有明确字段。输出字节上限不是扫描耗时上限。

`bounds` 是选定归属空间 XY 坐标下的有序交叉矩形 `[minX,minY,maxX,maxY]`，宿主可用画布对角的 `renderer.screenToWorld()` 得出；它不是屏幕像素或图纸视口投影。直线、射线、构造线、点、圆、圆弧和多段线直线/凸度段复用 CAD 的几何相交判断。完全包围矩形但圆周不接触的圆不算相交。文字、图块、其他不支持类型、倾斜法向量和超过 4096 顶点的多段线保守保留为 `spatialMatch: 'unclassified'`，不能把它当成已证明相交；其他返回对象标为 `intersects`。`spatialQuery` 返回坐标语义及范围。图块不展开，坐标不转世界坐标，返回几何保留原生坐标。操作前应检查未分类对象，不能推断不支持的图形不存在。

HATCH 的多边形/凸度段和 LINE/ARC 边界环支持奇偶填充规则：排除孔洞，包含嵌套实心区域。圆弧用解析相交和射线穿越判断，不使用显示折线；支持顺时针圆弧和两个凸度半圆组成的圆。查询的是填充几何区域，不是某条虚线的墨迹或间隙。椭圆/样条填充边界、未知图案、超过 128 个边界环或 4096 条边仍返回 `unclassified`；密集绘制预算不改变图档中的区域。Canvas 曲面填充仍可能近似显示，亚像素查询可分辨显示近似未画出的几何。

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
