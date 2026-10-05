---
slug: knowledge-packs
title.en: Compile knowledge packs
title.zh: 编译知识包
summary.en: Turn licensed, versioned semantic rules and explicit engineering facts into deterministic editable CAD transactions.
summary.zh: 将有授权、有版本的语义规则与明确工程事实编译为确定、可编辑的 CAD 事务。
---
:::en
## Understand the pipeline {#pipeline}

A KJDraw knowledge pack is declarative data, not a drawing dump or executable plugin. It declares source provenance, license flags, an ontology and bounded templates or rules. A semantic intent supplies the facts for one drawing. `compileKnowledgeDrawing()` validates both inputs and returns one deterministic `CREATEBATCH` argument plus evidence hashes:

```text
licensed sources -> versioned pack -> semantic intent -> compiler -> CREATEBATCH -> KJD/DXF reopen
```

Keep project measurements in the intent, not in the reusable pack. Do not place original drawing binaries or copied entity arrays in a pack. Each source entry needs a stable ID, title, license and content hash; publish only material you are authorized to redistribute.

## Compile a synthetic borehole {#compile-example}

Create `compile-knowledge.mjs` in a project that has `@kanjieteam/kjdraw` installed. This complete example uses the packaged public geology pack and synthetic facts; it does not represent measured site data:

```js
import {
  KJDRAW_SEMANTIC_IR_SCHEMA,
  createKJDrawSDK,
} from '@kanjieteam/kjdraw'
import { compileKnowledgeDrawing } from '@kanjieteam/kjdraw/knowledge-compiler'
import { KJDRAW_GEOLOGY_KNOWLEDGE_PACK } from '@kanjieteam/kjdraw/knowledge-packs/geology-core'

const intent = {
  schema: KJDRAW_SEMANTIC_IR_SCHEMA,
  packId: 'geology.core',
  packVersion: '1.0.0',
  drawing: { kind: 'borehole-column', title: 'Synthetic ZK-01', units: 'meter' },
  objects: [
    { id: 'hole:zk-01', kind: 'borehole', properties: {
      name: 'ZK-01', depth: 18, verticalScale: 1,
    } },
    { id: 'layer:upper', kind: 'stratum', properties: {
      top: 0, bottom: 6.5, lithology: 'clay',
    } },
    { id: 'layer:lower', kind: 'stratum', properties: {
      top: 6.5, bottom: 18, lithology: 'sand',
    } },
  ],
  relations: [
    { kind: 'contains-stratum', from: 'hole:zk-01', to: 'layer:upper' },
    { kind: 'contains-stratum', from: 'hole:zk-01', to: 'layer:lower' },
  ],
}

const compiled = compileKnowledgeDrawing({
  pack: KJDRAW_GEOLOGY_KNOWLEDGE_PACK,
  intent,
  templateId: 'borehole-column',
  rootObjectId: 'hole:zk-01',
  expectedRevision: 0,
})

const sdk = createKJDrawSDK()
const drawing = sdk.createDocument({ documentId: 'knowledge-demo', units: 'meter' })
await sdk.executeCommand('CREATEBATCH', compiled.commandArgs, {
  document: drawing,
  expectedRevision: compiled.evidence.expectedRevision,
})

const kjd = await sdk.writeDocument(drawing, { format: 'KJD', version: '1' })
const dxf = await sdk.writeDocument(drawing, { format: 'DXF', version: '2018' })
const reopenedKjd = await sdk.readDocument(kjd, { format: 'KJD', version: '1' })
const reopenedDxf = await sdk.readDocument(dxf, { format: 'DXF', version: '2018' })

console.log({
  evidence: compiled.evidence,
  kjdEntities: reopenedKjd.listEntities().length,
  dxfEntities: reopenedDxf.listEntities().length,
  dxfValid: reopenedDxf.validate().valid,
})
```

Run `node compile-knowledge.mjs`. The compiler rejects a stratum gap or overlap, an undeclared object/relation kind, an unknown lithology lookup, an identity mismatch or an unsupported executable field before CAD mutation.

## Author and register a pack {#author-pack}

Use `validateKnowledgePack(source)` while developing one pack and `KJKnowledgePackRegistry.register(source)` when a host manages several redistributable packs. The minimum contract is:

- `schema`, stable lowercase `id`, semantic `version`, `title` and `domain`;
- explicit SPDX license, redistribution flag and training-permission flag;
- one or more content-hashed `sources`;
- declared semantic `objectKinds` and `relationKinds`;
- bounded declarative `templates` and `rules` consumed by a compiler.

The generic compiler supports bounded expressions (`get`, arithmetic, concatenation and lookup), relation selection, continuity checks and native line, polyline, rectangle, rectangular hatch and text emission. It does not execute JavaScript stored in pack data. Domain compilers may consume additional validated rules through their published APIs.

Version every behavior change. Store the selected pack ID, version, content hash, intent hash, template ID and compiler evidence with regression results. A model should supply engineering facts only; the trusted host selects and hash-locks the knowledge pack.

## Close the regression loop {#regression-loop}

For every published pack and representative intent, verify:

1. two compiles produce identical command arguments and evidence hashes;
2. the result applies as one `CREATEBATCH` transaction;
3. Undo removes the batch and Redo restores it;
4. KJD and DXF both reopen and pass document validation;
5. expected native entity, layer, hatch and text counts survive reopen;
6. invalid, missing or discontinuous facts fail before mutation;
7. provenance and redistribution declarations match the material actually published.

This proves the stated fixture and rules only. It does not turn synthetic facts into measured data or certify an arbitrary engineering drawing.
:::
:::zh
## 理解编译管线 {#pipeline}

KJDraw 知识包是声明式数据，不是图纸转储，也不是可执行插件。它声明来源追溯、授权标志、语义本体以及有界模板或规则；语义意图提供一张图所需的明确事实。`compileKnowledgeDrawing()` 校验两份输入，返回确定的 `CREATEBATCH` 参数和证据哈希：

```text
授权来源 -> 版本化知识包 -> 语义意图 -> 编译器 -> CREATEBATCH -> KJD/DXF 重开
```

项目实测值应放在意图中，不要写进可复用知识包。知识包中不得放原始图纸二进制或复制的图元数组。每条来源都要有稳定 ID、标题、许可证和内容哈希；只能发布获得再分发授权的材料。

## 编译一份合成钻孔数据 {#compile-example}

在已经安装 `@kanjieteam/kjdraw` 的工程中新建 `compile-knowledge.mjs`。以下完整示例使用安装包内的公开地质知识包和合成事实，不代表任何场地实测数据：

```js
import {
  KJDRAW_SEMANTIC_IR_SCHEMA,
  createKJDrawSDK,
} from '@kanjieteam/kjdraw'
import { compileKnowledgeDrawing } from '@kanjieteam/kjdraw/knowledge-compiler'
import { KJDRAW_GEOLOGY_KNOWLEDGE_PACK } from '@kanjieteam/kjdraw/knowledge-packs/geology-core'

const intent = {
  schema: KJDRAW_SEMANTIC_IR_SCHEMA,
  packId: 'geology.core',
  packVersion: '1.0.0',
  drawing: { kind: 'borehole-column', title: 'Synthetic ZK-01', units: 'meter' },
  objects: [
    { id: 'hole:zk-01', kind: 'borehole', properties: {
      name: 'ZK-01', depth: 18, verticalScale: 1,
    } },
    { id: 'layer:upper', kind: 'stratum', properties: {
      top: 0, bottom: 6.5, lithology: 'clay',
    } },
    { id: 'layer:lower', kind: 'stratum', properties: {
      top: 6.5, bottom: 18, lithology: 'sand',
    } },
  ],
  relations: [
    { kind: 'contains-stratum', from: 'hole:zk-01', to: 'layer:upper' },
    { kind: 'contains-stratum', from: 'hole:zk-01', to: 'layer:lower' },
  ],
}

const compiled = compileKnowledgeDrawing({
  pack: KJDRAW_GEOLOGY_KNOWLEDGE_PACK,
  intent,
  templateId: 'borehole-column',
  rootObjectId: 'hole:zk-01',
  expectedRevision: 0,
})

const sdk = createKJDrawSDK()
const drawing = sdk.createDocument({ documentId: 'knowledge-demo', units: 'meter' })
await sdk.executeCommand('CREATEBATCH', compiled.commandArgs, {
  document: drawing,
  expectedRevision: compiled.evidence.expectedRevision,
})

const kjd = await sdk.writeDocument(drawing, { format: 'KJD', version: '1' })
const dxf = await sdk.writeDocument(drawing, { format: 'DXF', version: '2018' })
const reopenedKjd = await sdk.readDocument(kjd, { format: 'KJD', version: '1' })
const reopenedDxf = await sdk.readDocument(dxf, { format: 'DXF', version: '2018' })

console.log({
  evidence: compiled.evidence,
  kjdEntities: reopenedKjd.listEntities().length,
  dxfEntities: reopenedDxf.listEntities().length,
  dxfValid: reopenedDxf.validate().valid,
})
```

运行 `node compile-knowledge.mjs`。如果地层存在空隙/重叠、使用未声明的对象或关系、岩性查表无匹配、知识包身份不一致，或规则中出现不支持的可执行字段，编译器会在修改 CAD 前拒绝输入。

## 编写并注册知识包 {#author-pack}

开发单个知识包时使用 `validateKnowledgePack(source)`；宿主管理多个可再分发知识包时，使用 `KJKnowledgePackRegistry.register(source)`。最小契约包括：

- `schema`、稳定的小写 `id`、语义化 `version`、`title` 与 `domain`；
- 明确的 SPDX 许可证、可再分发标志和训练许可标志；
- 至少一个带内容哈希的 `sources` 条目；
- 已声明的语义 `objectKinds` 与 `relationKinds`；
- 由编译器消费的有界声明式 `templates` 与 `rules`。

通用编译器支持有界表达式（`get`、算术、拼接、查表）、关系选择、连续性校验，以及原生直线、多段线、矩形、矩形填充与文字输出。它不会执行知识包数据中的 JavaScript。领域编译器可以通过已发布 API 消费额外的已校验规则。

任何行为变化都应升级版本。回归结果应保存所选知识包 ID、版本、内容哈希、意图哈希、模板 ID 和编译证据。模型只提供工程事实；可信宿主负责选择知识包并锁定其哈希。

## 完成回归闭环 {#regression-loop}

每个发布的知识包和代表性意图都应验证：

1. 两次编译产生完全一致的命令参数和证据哈希；
2. 结果作为单个 `CREATEBATCH` 事务应用；
3. Undo 完整移除该批次，Redo 完整恢复；
4. KJD、DXF 均可重新打开并通过图档校验；
5. 预期的原生图元、图层、填充和文字数量在重开后不变；
6. 无效、缺失或不连续事实在修改前失败；
7. 来源追溯与再分发声明和实际发布材料一致。

这些证据只证明已陈述的测试数据与规则，不能把合成事实变成实测数据，也不能自动证明任意工程图纸合格。
:::
