# 原创图框／标题栏资源包

一个小而可执行的出图资源型工作流：读取原创 A4 横向图框、标题栏模板及图层／符号规则，生成原生 CAD 待审提案。复用现有 LINE、LWPOLYLINE、TEXT 操作，不新增引擎图元。[English](README.md)。

资源为原创社区示例，按仓库 Apache-2.0 许可证分发，**不是经过认证的行业标准**。采用 A4 名义尺寸，不代表图框边距、标题栏、符号或打印设置满足 ISO、国标、企业规范。

## 资源确实参与执行

| 资源 | 对产物的影响 |
| --- | --- |
| [assets/a4-landscape.json](assets/a4-landscape.json) | 297 × 210 mm 名义尺寸、10 mm 内缩图框、180 × 32 mm 标题网格、四个字段单元和修订三角形顶点。 |
| [references/layer-rules.json](references/layer-rules.json) | 四个图层角色的名称、颜色、线宽及允许的符号名。 |
| [scripts/sheet-template.mjs](scripts/sheet-template.mjs) | 读取上述实际文件，校验事实，确定性编译参数，调用现有原生提案工具。 |

`planSheetTemplate` 只读；`proposeSheetTemplate` 通过 `cad_propose_drawing_annotated` 登记待审计划。两者均不批准、不执行、不导出、不安装依赖、不覆盖文件。修改合法模板／规则会实际改变图元或图层，不只是改变提示词。回执摘要针对解析后资源的 `JSON.stringify` 内容，不是原文件字节哈希。

## 输入与输出

须使用没有同名模板图层的空白毫米图纸，helper 会验证原生工具会话确实绑定该图纸。必填：`version: '1.0.0'`、`templateId: 'community-a4-landscape-v1'`、调用方指定的 ASCII `sheetId`、当前 `expectedRevision`、`units: 'millimeter'`、有限 `[x,y]` 原点，以及明确的单行字段 `title`、`drawingNumber`、`revision`、`scaleLabel`。未知字段拒绝，不推断项目事实。

可选 `size: [宽,高]` 替代所选模板的名义尺寸，宽 240–600 mm、高 160–450 mm，仍须容纳图框／标题栏。可选 `symbols` 最多 16 项 `{name: 'revision-triangle', position: [x,y]}`，坐标为图纸绝对坐标；符号必须位于图框内且不与标题栏相交。省略表示不插入符号，不能猜测修订位置。

返回 `status: 'awaiting-host-approval'`、含原生计划 ID／CREATEBATCH 参数／预览的 `proposal`，及含图纸标识、尺寸、图框／标题栏边界、数量、资源摘要的 `evidence`。默认尺寸加一个三角形的预览包含 5 条线、8 个文字、2 个闭合多段线，分配到四个专用图层。

```js
// 在已安装兼容 KJDraw SDK 的现有 Node 宿主中运行，只生成待审提案。
import { createKJDrawSDK, KJAgentToolSession } from '@kanjieteam/kjdraw'
import { proposeSheetTemplate } from './scripts/sheet-template.mjs'

const sdk = createKJDrawSDK()
const document = sdk.createDocument({ documentId: 'public-sheet', units: 'millimeter' })
const session = new KJAgentToolSession(sdk, document)
const result = await proposeSheetTemplate(session, document, {
  version: '1.0.0', templateId: 'community-a4-landscape-v1', sheetId: 'public-a4',
  expectedRevision: document.revision, units: 'millimeter', origin: [0, 0],
  fields: { title: 'PUBLIC A4 FRAME', drawingNumber: 'EXAMPLE-001', revision: 'A', scaleLabel: '1:1' },
  symbols: [{ name: 'revision-triangle', position: [35, 60] }],
})
console.log(result.status, result.proposal.planId, result.evidence)
// 通过宿主现有审核界面展示 result.proposal.preview；这里不批准、不保存。
```

## 审批与交付

只有取得用户明确批准的宿主负责执行；模型／helper 不得自行批准或伪造审批证据。审批前源 DXF 字节、图元、历史均不变；执行时仍检查当前修订号。无效输入或原生提案失败，不留下登记计划或图纸变更。

审批后以 DXF 为主要交付物，导出到用户选择的**新目标**，校验并独立重开，对比原生几何／图层语义。DXF 不保留内部对象 ID、审批状态和撤销历史。helper 没有文件写入器；不替换既有源图来插入模板，应新建空白图纸。

本包生成模型空间 XY 几何，不生成图纸空间布局、视口或打印配置；`scaleLabel` 只是文字，不缩放图形。文字适配使用保守字符宽度估算，字体与视觉效果仍需宿主预览确认。不宣称工程计算、标准认证或监管符号语义。

## 可复现验证

在源码仓库运行下列公开合成测试。测试调用实际 SDK 提案／审批／历史和 DXF 读写，审批者是确定性测试宿主；不代表真实模型或人工审批已通过。具体观察项及拒绝条件见 [acceptance](references/acceptance.md)。

```sh
npm run check:skill -- skills/kjdraw-sheet-template
```

需要现有兼容 SDK 提供 `KJAgentToolSession` 和 `cad_propose_drawing_annotated`。安装技能包不会安装运行时，也不证明所有已发布 SDK／宿主版本兼容。
