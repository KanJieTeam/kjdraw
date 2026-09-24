---
slug: quickstart
title.en: Quickstart
title.zh: 快速上手
summary.en: Install KJDraw, mount a complete editor in minutes and open one of the editable industry samples.
summary.zh: 安装 KJDraw，几分钟内挂载完整编辑器，并打开一张可编辑的行业示例图纸。
---
:::en
## Run an editor in five minutes {#install}

Start with Node.js 22 or newer and a small TypeScript project:

```sh
npm create vite@latest kjdraw-five-minute -- --template vanilla-ts
cd kjdraw-five-minute
npm install
npm install @kanjieteam/kjdraw@next
```

The `next` tag follows the release-candidate channel. Pin an exact version when you need reproducible builds.

Replace `src/main.ts` with the complete example below. The workbench injects its own component styles; the host element only needs an explicit height.

```ts
import { createKJDrawEditor } from '@kanjieteam/kjdraw'

document.querySelector<HTMLDivElement>('#app')!.innerHTML = '<div id="cad"></div>'
const host = document.querySelector<HTMLElement>('#cad')!
host.style.cssText = 'width:100%;height:720px'

const editor = createKJDrawEditor('#cad', {
  document: 'sample',
  locale: 'en',
  theme: 'dark',
  onSelectionChange: ({ ids }) => console.log(ids),
})

await editor.ready
await editor.execute('CREATE', {
  type: 'CIRCLE',
  payload: { center: [20, 20, 0], radius: 5 },
})
editor.fit()
```

Run `npm run dev`, open the printed local URL, and confirm that the sample drawing and the new 5 mm-radius circle are visible. Use `editor.open(file)` for KJD or DXF input and `editor.save()` to download the current drawing. This closes the first editable create–inspect–save loop without a model or API key. The [Editor API](https://kanjieteam.github.io/kjdraw/docs/latest/api/) lists every option, method and event.

## Verify the headless SDK {#verify-sdk}

Prefer a complete checked-in project? Copy the maintained [Vanilla browser starter](https://github.com/KanJieTeam/kjdraw/tree/main/examples/starters/vanilla-browser), or compare every supported [starter project](https://kanjieteam.github.io/kjdraw/docs/latest/starters/).

The installed package also ships a deterministic Node example. It creates and moves a line, writes KJD, reopens it and prints the verified entity:

```sh
node node_modules/@kanjieteam/kjdraw/examples/quickstart.mjs
```

Use this check first when a browser integration fails: it separates SDK and package problems from bundler or layout problems.

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
## 五分钟运行一个编辑器 {#install}

准备 Node.js 22 或更新版本，然后创建一个小型 TypeScript 工程：

```sh
npm create vite@latest kjdraw-five-minute -- --template vanilla-ts
cd kjdraw-five-minute
npm install
npm install @kanjieteam/kjdraw@next
```

`next` 指向候选版渠道；需要可复现构建时请锁定确切版本。

用下面的完整示例替换 `src/main.ts`。工作台会注入自身组件样式，宿主元素只需要明确的高度。

```ts
import { createKJDrawEditor } from '@kanjieteam/kjdraw'

document.querySelector<HTMLDivElement>('#app')!.innerHTML = '<div id="cad"></div>'
const host = document.querySelector<HTMLElement>('#cad')!
host.style.cssText = 'width:100%;height:720px'

const editor = createKJDrawEditor('#cad', {
  document: 'sample',
  locale: 'zh-CN',
  theme: 'dark',
  onSelectionChange: ({ ids }) => console.log(ids),
})

await editor.ready
await editor.execute('CREATE', {
  type: 'CIRCLE',
  payload: { center: [20, 20, 0], radius: 5 },
})
editor.fit()
```

运行 `npm run dev`，打开命令行显示的本地地址，确认示例图和新建的半径 5 毫米圆均可见。使用 `editor.open(file)` 打开 KJD 或 DXF，使用 `editor.save()` 下载当前图档。这样无需模型或 API Key 就完成了第一个可编辑的创建—检查—保存闭环。[Editor API](https://kanjieteam.github.io/kjdraw/docs/latest/api/)列出了全部选项、方法与事件。

## 验证无界面 SDK {#verify-sdk}

需要可直接复制的完整工程时，可使用仓库维护的[原生浏览器起步工程](https://github.com/KanJieTeam/kjdraw/tree/main/examples/starters/vanilla-browser)，或对比全部[起步工程](https://kanjieteam.github.io/kjdraw/docs/latest/starters/)。

安装包还附带一个确定性的 Node 示例：创建并移动一条直线，写出 KJD，重新打开后打印已验证的图元。

```sh
node node_modules/@kanjieteam/kjdraw/examples/quickstart.mjs
```

浏览器集成失败时先运行此检查，可以把 SDK/安装包问题与构建工具或布局问题分开。

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
