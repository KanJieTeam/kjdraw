---
slug: concepts
title.en: Core concepts
title.zh: 核心概念
summary.en: Learn the document, object identity, command, transaction, adapter and proposal concepts shared by every KJDraw integration.
summary.zh: 理解所有 KJDraw 接入共同使用的图档、对象身份、命令、事务、适配器与提案概念。
---
:::en
## One drawing, several projections {#document}

`KJDocument` is the source of truth. The canvas, property panel, selection overlay, SVG preview and exported file are projections of that document; none of them replaces it. A document owns its units, resources, model and paper spaces, layouts and drawing objects.

Saving KJD preserves KJDraw's native document data. DXF is an interchange projection with an explicitly published compatibility boundary. Reopen the produced file when a workflow needs evidence that serialization did not change the drawing.

## Stable object identity {#identity}

Every drawing object has a stable ID. Application code and agent workflows should keep and query IDs instead of locating an object again from approximate coordinates or display order. A revision identifies the document state against which a read or proposal was prepared.

```ts
const created = await sdk.executeCommand<{ id: string }>('CREATE', {
  type: 'CIRCLE',
  payload: { center: [20, 20, 0], radius: 5 },
})

const circleId = created.result.id
console.log(document.revision, circleId)
```

## Commands and transactions {#commands}

Commands are the public mutation boundary. They validate arguments, change the document and return a receipt. Related low-level changes can be grouped into one transaction so they commit or fail together. The editor, plugins and approved automation use the same command path, which keeps undo, redo and document events consistent.

Do not mutate a serialized KJD object or a renderer display list and expect the active document to update. Use a command or a document transaction.

## Files and adapters {#adapters}

File adapters translate between a `KJDocument` and a bounded format. KJD is native, KJP packages a project, and DXF supports the subset documented in the compatibility contract. Storage, authentication and upload policy remain host responsibilities; opening a file does not silently send it to a service.

## Agent proposals are not implicit edits {#proposals}

An agent session reads a bounded drawing context and returns a proposal. A trusted host previews and approves the operation before applying it. The proposal carries the revision it was prepared against so a stale operation can be rejected instead of being applied to a different drawing state.

```text
read bounded context -> propose -> preview -> approve -> apply -> save -> reopen
```

Use the direct command API for deterministic application code. Use proposal tools when a person or host policy must review a model-produced change.

## Knowledge packs compile domain facts {#knowledge-packs}

A knowledge pack is versioned declarative engineering knowledge. It combines an ontology and bounded templates or rules with a semantic intent, then compiles them into deterministic command arguments. It is not a dump of a private drawing and it does not grant a model access to source files.

Continue with **Commands and transactions** for application edits, **Agent workflows** for reviewed model changes, and **Knowledge packs** for domain compilers.
:::
:::zh
## 一份图档，多种投影 {#document}

`KJDocument` 是规范真相。画布、属性面板、选择覆盖层、SVG 预览和导出文件都是图档的投影，任何一个都不能替代图档本身。图档管理单位、资源、模型/图纸空间、布局和绘图对象。

保存 KJD 会保留 KJDraw 原生图档数据；DXF 是有明确公开兼容边界的交换投影。流程需要证明序列化没有改变图纸时，应重新打开生成的文件进行验证。

## 稳定对象身份 {#identity}

每个绘图对象都有稳定 ID。应用代码与 Agent 流程应保留并查询 ID，不要再根据近似坐标或显示顺序猜测对象。revision 标识某次读取或提案所依据的图档状态。

```ts
const created = await sdk.executeCommand<{ id: string }>('CREATE', {
  type: 'CIRCLE',
  payload: { center: [20, 20, 0], radius: 5 },
})

const circleId = created.result.id
console.log(document.revision, circleId)
```

## 命令与事务 {#commands}

命令是公开的修改边界：它校验参数、修改图档并返回回执。相关的底层修改可以组成一个事务，要么一起提交，要么一起失败。编辑器、插件和获批自动化都走同一命令路径，因此撤销、重做和图档事件保持一致。

不要直接修改序列化后的 KJD 对象或渲染器显示列表并期待活动图档自动变化；请使用命令或图档事务。

## 文件与适配器 {#adapters}

文件适配器在 `KJDocument` 与边界明确的格式之间转换。KJD 是原生格式，KJP 用于打包工程，DXF 支持兼容契约中列明的子集。存储、认证与上传策略由宿主负责；打开文件不会把文件静默发送到某个服务。

## Agent 提案不等于隐式修改 {#proposals}

Agent 会话读取有界图档上下文并返回提案；可信宿主在应用前负责预览和批准。提案携带生成时所依据的 revision，因此过期操作会被拒绝，而不会误用到另一份图档状态。

```text
读取有界上下文 -> 提案 -> 预览 -> 批准 -> 应用 -> 保存 -> 重开
```

确定性的应用逻辑使用直接命令 API；模型生成的修改需要人员或宿主策略审核时，使用提案工具。

## 知识包编译领域事实 {#knowledge-packs}

知识包是版本化的声明式工程知识。它把本体、边界明确的模板或规则与语义意图组合，再编译为确定性的命令参数。知识包不是私有图纸转储，也不会让模型获得源文件访问权限。

应用修改继续阅读**命令与事务**，模型审核流程阅读 **Agent 工作流**，领域编译器阅读**知识包**。
:::
