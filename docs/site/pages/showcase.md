---
slug: showcase
title.en: Showcase
title.zh: 案例库
summary.en: Browse original editable drawings by discipline, open them in the Playground and trace each example to its public source.
summary.zh: 按专业浏览原创可编辑图纸，在 Playground 中直接体验，并追溯每个案例的公开源码。
---
:::en
## Find an example {#find-an-example}

Every card above is generated from a public KJDraw sample. Its thumbnail, object count, layer count and entity-type totals are rebuilt from the same editable document during the documentation build. The examples are fictional engineering drawings, not customer drawings or measured project data.

Search by title, drawing type, object or workflow; combine search with a discipline or tag filter; then switch between grid and list views. **Open Playground** activates that public sample directly; **Sample drawings** can then switch among the complete drawings. Counts describe the generated baseline, not an accuracy score.

## Multidisciplinary coordination {#multidisciplinary-coordination}

**Resilient energy campus / coordination plan** combines a site boundary, topography, roads, buildings, two photovoltaic fields, an electrical network, landscape objects, survey control and annotations. It is the largest current public sample and is useful for navigation, dense selection, layers and reviewable Agent edits.

- Sample ID: `sample-resilient-campus`
- Units: metres
- Source: [examples/sample.js](https://github.com/KanJieTeam/kjdraw/blob/main/examples/sample.js)
- Try: select separate solar modules, isolate a layer, make an edit, undo it, then save and reopen the project.

## Civil site plan {#civil-site-plan}

**Riverside research park / site plan** includes a bounded sheet, synthetic contours, road geometry, buildings, utilities, planting, dimensions and a title block. Use it to inspect metre-based site geometry and layered plan composition.

- Sample ID: `sample-site-plan`
- Units: metres
- Source: [samples.ts](https://github.com/KanJieTeam/kjdraw/blob/main/packages/kjdraw-sdk/src/samples.ts)
- Try: measure a building or road, edit an object on one discipline layer, then export the active drawing.

## Architectural floor plan {#architectural-floor-plan}

**Innovation hub / ground floor** demonstrates a sheeted architectural plan with structural grid, walls, rooms, openings, fixtures, dimensions, tags and title information. Individual lines, polylines, arcs, circles and text remain normal CAD objects.

- Sample ID: `sample-architecture`
- Units: millimetres
- Source: [samples.ts](https://github.com/KanJieTeam/kjdraw/blob/main/packages/kjdraw-sdk/src/samples.ts)
- Try: select a room boundary, inspect its layer and geometry, copy an object and verify undo/redo.

## Road longitudinal profile {#road-longitudinal-profile}

**Hill route C2 / longitudinal profile** shows station-based profile geometry, existing and proposed levels, a profile grid, labels, dimensions and a title block. It provides a compact transportation example for coordinate inspection and precise editing.

- Sample ID: `sample-road-profile`
- Units: metres
- Source: [samples.ts](https://github.com/KanJieTeam/kjdraw/blob/main/packages/kjdraw-sdk/src/samples.ts)
- Try: inspect profile points, measure a segment, change a label and export DXF.

## Mechanical manufacturing drawing {#mechanical-manufacturing-drawing}

**Bearing bracket / manufacturing drawing** contains orthographic manufacturing views, holes, centre lines, dimensions, notes and a title block on millimetre units. It is the fastest current sample for testing precise selection, modification and dimensional output.

- Sample ID: `sample-mechanical`
- Units: millimetres
- Source: [samples.ts](https://github.com/KanJieTeam/kjdraw/blob/main/packages/kjdraw-sdk/src/samples.ts)
- Try: inspect a hole radius, select a view, move or copy geometry, then verify undo and save/reopen.

## Build from the same catalog {#build-from-the-same-catalog}

The Playground and SDK use the same public sample builders. Applications can create one drawing by ID or load the complete collection:

```ts
import { createKJDrawSDK } from '@kanjieteam/kjdraw/core'
import { createIndustrySample } from '@kanjieteam/kjdraw/samples'

const sdk = createKJDrawSDK()
const drawing = await createIndustrySample(sdk, 'sample-mechanical')
```

The sample source is the canonical definition. Showcase copy describes what is currently generated; it does not replace drawing validation or real-project acceptance.
:::
:::zh
## 查找案例 {#find-an-example}

上方每张卡片都来自 KJDraw 的公开案例。文档构建时，会从同一份可编辑图纸重新生成缩略图，并计算对象数、图层数与图元类型数量。它们是虚构的工程图纸，不是客户图纸，也不是项目实测数据。

可以按标题、图纸类型、对象或工作流搜索，并叠加专业与标签筛选，再切换网格或列表视图。点击**在线体验**会直接激活对应公开案例，随后可通过**示例图纸**切换其他完整图纸。数量只描述生成基线，不代表准确率评分。

## 多专业协调总图 {#multidisciplinary-coordination}

**韧性能源园区 / 协调总图**组合了场地边界、地形、道路、建筑、两组光伏阵列、电气网络、景观对象、测量控制点与标注。它是当前对象数量最多的公开示例，适合验证大图导航、密集选择、图层管理以及可审核的 Agent 修改。

- 案例 ID：`sample-resilient-campus`
- 单位：米
- 源码：[examples/sample.js](https://github.com/KanJieTeam/kjdraw/blob/main/examples/sample.js)
- 建议体验：分别选择光伏组件、隔离图层、执行一次编辑并撤销，最后保存并重新打开工程。

## 场地总图 {#civil-site-plan}

**滨河研发园 / 场地总图**包含完整图框、示意等高线、道路、建筑、管线、绿化、尺寸和标题栏，可用于检查以米为单位的场地几何与分层组织。

- 案例 ID：`sample-site-plan`
- 单位：米
- 源码：[samples.ts](https://github.com/KanJieTeam/kjdraw/blob/main/packages/kjdraw-sdk/src/samples.ts)
- 建议体验：测量建筑或道路，在指定专业图层修改一个对象，然后导出当前图纸。

## 建筑平面图 {#architectural-floor-plan}

**创新中心 / 首层平面**展示带图框的建筑平面，包括轴网、墙体、房间、洞口、设施、尺寸、编号与标题信息。直线、多段线、圆弧、圆和文字仍是普通的独立 CAD 对象。

- 案例 ID：`sample-architecture`
- 单位：毫米
- 源码：[samples.ts](https://github.com/KanJieTeam/kjdraw/blob/main/packages/kjdraw-sdk/src/samples.ts)
- 建议体验：选择房间边界，检查其图层与几何属性，复制一个对象并验证撤销、重做。

## 道路纵断面 {#road-longitudinal-profile}

**山区道路 C2 / 纵断面**包含按桩号组织的断面几何、现状与设计高程、断面网格、文字、尺寸和标题栏，是检查坐标与精确编辑的紧凑道路案例。

- 案例 ID：`sample-road-profile`
- 单位：米
- 源码：[samples.ts](https://github.com/KanJieTeam/kjdraw/blob/main/packages/kjdraw-sdk/src/samples.ts)
- 建议体验：检查断面点、测量线段、修改文字并导出 DXF。

## 机械制造工程图 {#mechanical-manufacturing-drawing}

**轴承支架 / 制造工程图**使用毫米单位，包含正投影视图、孔、中心线、尺寸、技术说明与标题栏，是当前最快可以用于精确选择、修改和尺寸输出测试的案例。

- 案例 ID：`sample-mechanical`
- 单位：毫米
- 源码：[samples.ts](https://github.com/KanJieTeam/kjdraw/blob/main/packages/kjdraw-sdk/src/samples.ts)
- 建议体验：检查孔半径，选择一个视图，移动或复制几何，然后验证撤销以及保存重开。

## 使用同一案例目录 {#build-from-the-same-catalog}

Playground 与 SDK 使用相同的公开案例生成器。应用既可以按 ID 创建一张图，也可以加载整套案例：

```ts
import { createKJDrawSDK } from '@kanjieteam/kjdraw/core'
import { createIndustrySample } from '@kanjieteam/kjdraw/samples'

const sdk = createKJDrawSDK()
const drawing = await createIndustrySample(sdk, 'sample-mechanical')
```

案例源码是生成定义的唯一依据。案例库文案只描述当前生成内容，不能代替图纸校验或真实项目验收。
:::
