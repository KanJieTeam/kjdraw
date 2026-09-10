---
slug: files
title.en: Files and projects
title.zh: 文件与工程
summary.en: Read and write KJD, package multi-drawing KJP projects and use the explicitly bounded ASCII DXF compatibility profile.
summary.zh: 读写 KJD、打包多图档 KJP 工程，并在明确边界内使用 ASCII DXF 兼容能力。
---
:::en
## Choose a format {#choose-a-format}

| Format | Use it for | Contract boundary |
| --- | --- | --- |
| KJD | One canonical transactional drawing | JSON model, validation and revisions |
| KJP | A portable project with drawings, assets, snapshots and journal | Deterministic ZIP64 package with hashes and read budgets |
| DXF | Interchange with the published ASCII subset | Named entities, resources and versions only |

The maintained compatibility matrix is the authority for format versions and semantic coverage.

## Read and write a drawing {#read-and-write}

```ts
const drawing = await sdk.readDocument(await file.arrayBuffer(), {
  format: 'DXF',
})

const kjd = await sdk.writeDocument(drawing, { format: 'KJD' })
const dxf = await sdk.writeDocument(drawing, {
  format: 'DXF',
  version: '2018',
})
```

Adapters share the same document model. Keep the original input when evaluating interoperability, and treat an exported file as a new artifact rather than proof of application-specific durable storage.

DXF 2000 and newer exports retain named and empty layout identities, tab order and entity ownership. Import resolves layout/block references even without entity `410` hints; non-primary paper entities are written inside their space blocks for independent readers. Full paper settings, viewports and plotting fidelity remain outside this guarantee. Conflicting layout identities or ambiguous entity ownership fail the import instead of silently moving geometry.

## Preserve DXF page configuration {#dxf-page-configuration}

Imported layout `payload.dxfPlotSettings` retains 30 scalar `AcDbPlotSettings` fields, including paper dimensions, margins, offsets, window, units, rotation, scale and resource names. `KJDxfPlotSettings` is exported from the package; `transaction.createLayout({ name, dxfPlotSettings })` also accepts it. The fields remain in KJD and DXF 2000+.

In the embedded editor, open **Page setup** from the top bar, choose a sheet and edit physical paper dimensions, margins, plot units, rotation or custom scale. Blank fields keep existing values. Apply changes only that sheet; Cancel/Escape and applying an unchanged form leave the drawing/history untouched. Changing either custom-scale field clears the standard-scale flag while preserving other flags. If the drawing changes while the form is open, close and reopen it before applying. Readonly editors disable the entry. This form configures exports; it does not provide print preview or drive a printer.

```ts
await sdk.executeCommand('PAGESETUP', {
  layoutName: 'Layout1',
  dxf: { paperWidth: 594, paperHeight: 841, paperUnits: 1, rotation: 1,
    scaleNumerator: 1, scaleDenominator: 100 },
})
```

`dxf` patches only supplied fields and supports undo/redo. Physical paper dimensions, margins and origin offsets always use millimeters; `paperUnits` is 0/inches, 1/mm or 2/pixels. `rotation` is the DXF index 0/1/2/3 for 0/90/180/270 degrees counterclockwise. This explicit mode preserves the existing native `PLOTSETUP` settings contract (degree rotation, nested scale, output device). Native `plotSettings` and the legacy `paper` envelope are not silently converted to DXF configuration; use `dxf` for interchange. R12/R14 exports reject populated DXF page settings. Invalid settings fail atomically.

This is configuration preservation, not physical printing or a page preview. Layout limits/extents, viewport projection, named page-setup dictionaries, shade-object handles, transparency XDATA and referenced printer/style files remain outside this guarantee. KJDraw does not execute resource names or load local printer configuration.

## Package a project {#package-a-project}

Use `KJProjectSession` when the application needs active-drawing state, membership and a command journal. Use `createKjpPackage()` and `openKjpPackage()` for lower-level package assembly and inspection. A browser file binding can download and reopen a KJP; a desktop or server provider defines atomic replacement and fsync guarantees.

## Limits and DXF evidence {#limits-and-dxf-evidence}

KJD, KJP and DXF readers accept configurable byte/object/entity/archive budgets and abort signals. Export diagnostics make format decisions observable to the host.

The exact versions, entity/resource subset and independent ezdxf audit are maintained in the [DXF compatibility contract](https://github.com/KanJieTeam/kjdraw/blob/main/docs/dxf-compatibility.md).
:::
:::zh
## 选择格式 {#choose-a-format}

| 格式 | 适用场景 | 契约边界 |
| --- | --- | --- |
| KJD | 单个规范事务图档 | JSON 模型、校验与修订号 |
| KJP | 包含图档、资产、快照和日志的可移植工程 | 带哈希与读取预算的确定性 ZIP64 包 |
| DXF | 与公开 ASCII 子集互操作 | 仅承诺列明的实体、资源与版本 |

持续维护的兼容矩阵是格式版本与语义覆盖范围的权威依据。

## 读取与写出图档 {#read-and-write}

```ts
const drawing = await sdk.readDocument(await file.arrayBuffer(), {
  format: 'DXF',
})

const kjd = await sdk.writeDocument(drawing, { format: 'KJD' })
const dxf = await sdk.writeDocument(drawing, {
  format: 'DXF',
  version: '2018',
})
```

不同适配器共用同一个图档模型。评估互操作时请保留原始输入；导出文件只是一个新产物，不能自动证明具体应用已经完成持久落盘。

DXF 2000 及更新版本导出保留命名布局、空布局、标签顺序和实体归属。导入在没有实体 `410` 提示时仍解析布局与空间块引用；非主图纸空间实体写入对应空间块，供独立读取器正确识别。此保证不包含完整纸张设置、视口和打印保真。布局身份冲突或实体归属无法判定时导入会报错，避免静默移动图形。

## 保留 DXF 页面配置 {#dxf-page-configuration}

导入布局的 `payload.dxfPlotSettings` 保留 30 个 `AcDbPlotSettings` 标量字段，包括纸张尺寸、边距、偏移、窗口、单位、旋转、比例及资源名称。包导出 `KJDxfPlotSettings` 类型，`transaction.createLayout({ name, dxfPlotSettings })` 也可设置。字段保存在 KJD 和 DXF 2000+ 中。

在嵌入式编辑器顶部打开**页面设置**，选择图纸布局，编辑物理纸张尺寸、边距、打印单位、旋转或自定义比例。空字段保留已有值；应用只修改选定布局，取消/Escape及未修改表单不会改变图档或新增历史。修改任一比例值会清除标准比例标志，其余标志保持不变。打开表单后若图档变更，需要关闭重开才能应用；只读模式禁用入口。该表单配置导出，尚不提供打印预览或实际打印。

```ts
await sdk.executeCommand('PAGESETUP', {
  layoutName: 'Layout1',
  dxf: { paperWidth: 594, paperHeight: 841, paperUnits: 1, rotation: 1,
    scaleNumerator: 1, scaleDenominator: 100 },
})
```

`dxf` 仅修改提供的字段，支持撤销/重做。物理纸张、边距和原点偏移始终以毫米表示；`paperUnits` 的 0/1/2 分别表示英寸/毫米/像素。`rotation` 使用 DXF 索引 0/1/2/3，对应逆时针 0/90/180/270 度。显式模式兼容现有原生 `PLOTSETUP` 契约（角度旋转、嵌套比例、输出设备）；原生 `plotSettings` 与旧 `paper` 信息不会静默转换为 DXF 配置，交换页面参数请使用 `dxf`。R12/R14 导出会拒绝丢失已设置的 DXF 页面参数；非法修改完整回滚。

本项保留配置，尚不等于实际打印或页面预览。布局范围、视口投影、命名页面设置字典、着色对象句柄、透明度 XDATA 及引用的打印机/样式文件仍不在保证内。资源名称不会被执行，也不会自动加载本地打印机配置。

## 打包工程 {#package-a-project}

应用需要活动图档、成员关系和命令日志时使用 `KJProjectSession`。需要更底层的工程包组装与检查时使用 `createKjpPackage()` 和 `openKjpPackage()`。浏览器文件绑定可以下载并重开 KJP；桌面或服务端 Provider 则负责定义原子替换与 fsync 保证。

## 资源上限与 DXF 证据 {#limits-and-dxf-evidence}

KJD、KJP、DXF 读取器支持可配置的字节、对象、实体、压缩包预算与中止信号。导出诊断会让格式决策对宿主保持可观察。

精确版本、实体/资源子集与独立 ezdxf 审计记录在 [DXF 兼容契约](https://github.com/KanJieTeam/kjdraw/blob/main/docs/dxf-compatibility.md)中。
:::
