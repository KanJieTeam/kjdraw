---
slug: quickstart
title.en: Quickstart
title.zh: 快速上手
summary.en: Install KJDraw, mount a complete editor in minutes and open one of the editable industry samples.
summary.zh: 安装 KJDraw，几分钟内挂载完整编辑器，并打开一张可编辑的行业示例图纸。
---
:::en
## Install {#install}

```sh
npm install @kanjieteam/kjdraw@next
```

Use version **1.0.0-rc.3 or newer** for interactive moves and switchable layouts. Check with `npm list @kanjieteam/kjdraw`; `next` is the release-candidate channel.

## Mount a complete editor {#mount-editor}

Give the container a height, then create the editor:

```html
<div id="cad"></div>
<style>#cad { width: 100%; height: 720px; }</style>
```

```ts
import { createKJDrawEditor } from '@kanjieteam/kjdraw'

const editor = createKJDrawEditor('#cad', {
  document: 'sample',
  locale: 'en',
  theme: 'dark',
  onSelectionChange: ({ ids }) => console.log(ids),
})

await editor.ready
await editor.execute('CREATE', {
  type: 'LINE',
  payload: { start: [0, 0, 0], end: [100, 40, 0] },
})
editor.fit()
```

Use `editor.open(file)` for KJD or DXF input and `editor.save()` to download the current drawing. The [Editor API](https://kanjieteam.github.io/kjdraw/docs/latest/api/) lists every option, method and event.

## Open an industry sample {#industry-samples}

```ts
import { createKJDrawEditor, createKJDrawSDK } from '@kanjieteam/kjdraw'
import {
  INDUSTRY_SAMPLES,
  createIndustrySample,
} from '@kanjieteam/kjdraw/samples'

const sdk = createKJDrawSDK()
console.table(INDUSTRY_SAMPLES)

const drawing = await createIndustrySample(sdk, 'sample-architecture')
const editor = createKJDrawEditor('#cad', { sdk, document: drawing })
await editor.ready
```

The sample catalogue also includes a site plan, road profile and mechanical manufacturing drawing. Each result is a normal editable `KJDocument`, so the same file, command and plugin APIs apply.

## Use multiple editors {#multiple-editors}

Pass the same `sdk` to share plugins and commands, and give each editor its own container with a height. Use `editor.execute()` to target a specific editor, or pass an explicit `document` when calling the SDK directly. See **Commands and transactions** for background editing examples.

Blank and sample drawings created by an editor are released after their last editor view closes. A drawing supplied through `document` remains owned by your application. Two views can display the same drawing; replacing it by reopening a file with the same ID is rejected while another view still uses it, so that view keeps its drawing and selection.

Continue to **React** or **Vue** for framework components, **Files** for KJD/KJP/DXF, or **Commands** for programmatic editing.
:::
:::zh
## 安装 {#install}

```sh
npm install @kanjieteam/kjdraw@next
```

交互移动与布局切换需要 **1.0.0-rc.3 或更新版本**。可用 `npm list @kanjieteam/kjdraw` 核对，`next` 为候选版渠道。

## 挂载完整编辑器 {#mount-editor}

先为容器设置高度，再创建编辑器：

```html
<div id="cad"></div>
<style>#cad { width: 100%; height: 720px; }</style>
```

```ts
import { createKJDrawEditor } from '@kanjieteam/kjdraw'

const editor = createKJDrawEditor('#cad', {
  document: 'sample',
  locale: 'zh-CN',
  theme: 'dark',
  onSelectionChange: ({ ids }) => console.log(ids),
})

await editor.ready
await editor.execute('CREATE', {
  type: 'LINE',
  payload: { start: [0, 0, 0], end: [100, 40, 0] },
})
editor.fit()
```

使用 `editor.open(file)` 打开 KJD 或 DXF，使用 `editor.save()` 下载当前图档。[Editor API](https://kanjieteam.github.io/kjdraw/docs/latest/api/)列出了全部选项、方法与事件。

## 打开行业示例 {#industry-samples}

```ts
import { createKJDrawEditor, createKJDrawSDK } from '@kanjieteam/kjdraw'
import {
  INDUSTRY_SAMPLES,
  createIndustrySample,
} from '@kanjieteam/kjdraw/samples'

const sdk = createKJDrawSDK()
console.table(INDUSTRY_SAMPLES)

const drawing = await createIndustrySample(sdk, 'sample-architecture')
const editor = createKJDrawEditor('#cad', { sdk, document: drawing })
await editor.ready
```

示例目录还包含场地总图、道路纵断面和机械制造图。每个结果都是普通、可编辑的 `KJDocument`，可以继续使用同一套文件、命令与插件 API。

## 使用多个编辑器 {#multiple-editors}

传入同一个 `sdk` 可以共享插件和命令；每个编辑器分别使用设置了高度的容器。操作指定编辑器时调用 `editor.execute()`，直接使用 SDK 时显式传入 `document`。后台编辑示例见**命令与事务**。

编辑器自动创建的空白图或示例图，会在最后一个编辑器视图关闭后释放。通过 `document` 传入的图纸仍由应用管理。两个视图可以显示同一图纸；如果另一视图仍在使用它，重新打开同 ID 文件来替换图纸的操作会被拒绝，已有图纸和选择集保持不变。

接着阅读 **React** 或 **Vue** 使用框架组件，阅读**文件**了解 KJD/KJP/DXF，或阅读**命令与事务**进行程序化编辑。
:::
