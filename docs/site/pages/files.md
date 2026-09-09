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

## 打包工程 {#package-a-project}

应用需要活动图档、成员关系和命令日志时使用 `KJProjectSession`。需要更底层的工程包组装与检查时使用 `createKjpPackage()` 和 `openKjpPackage()`。浏览器文件绑定可以下载并重开 KJP；桌面或服务端 Provider 则负责定义原子替换与 fsync 保证。

## 资源上限与 DXF 证据 {#limits-and-dxf-evidence}

KJD、KJP、DXF 读取器支持可配置的字节、对象、实体、压缩包预算与中止信号。导出诊断会让格式决策对宿主保持可观察。

精确版本、实体/资源子集与独立 ezdxf 审计记录在 [DXF 兼容契约](https://github.com/KanJieTeam/kjdraw/blob/main/docs/dxf-compatibility.md)中。
:::
