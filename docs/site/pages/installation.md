---
slug: installation
title.en: Installation
title.zh: 安装
summary.en: Choose the npm channel, runtime and import path that match your application.
summary.zh: 根据应用形态选择 npm 渠道、运行环境和导入路径。
---
:::en
## Requirements {#requirements}

- Node.js 22 or newer for server-side and command-line applications.
- A modern browser with ES modules, Canvas 2D, WebAssembly and Web Crypto for browser products.
- npm, pnpm or another package manager that understands package exports.

KJDraw's core has no runtime npm dependencies. React and Vue are optional peer dependencies: install the framework your application uses when importing `/react` or `/vue`. Headless and plain TypeScript applications do not need either framework.

## Release channels {#release-channels}

| Intent | Command |
| --- | --- |
| Try the current release candidate | `npm install @kanjieteam/kjdraw@next` |
| Pin this documented release | `npm install @kanjieteam/kjdraw@1.0.0-rc.3` |
| Install the stable channel | `npm install @kanjieteam/kjdraw@latest` |
| Install a local checkout | `npm install /path/to/kjdraw/packages/kjdraw-sdk` |

Use `next` for prereleases and `latest` for stable releases. Pin an exact version when builds must remain reproducible, and confirm the resolved version with `npm list @kanjieteam/kjdraw`.

## Verify the installation {#verify-installation}

Run the packaged quickstart directly from a clean project:

```sh
node node_modules/@kanjieteam/kjdraw/examples/quickstart.mjs
```

A successful run prints JSON containing the installed SDK version, document ID and one created line. It needs no browser, model or API key.

## Public imports {#public-imports}

Use the root for the common SDK surface and subpaths when you want a smaller, explicit contract.

```ts
import { createKJDrawSDK } from '@kanjieteam/kjdraw'
import { createDXFFileAdapter } from '@kanjieteam/kjdraw/file/dxf'
import { KJDeploymentRegistry } from '@kanjieteam/kjdraw/deployment'
```

The [API Reference](https://kanjieteam.github.io/kjdraw/docs/latest/api/) lists every supported package entry and its public types.
:::
:::zh
## 环境要求 {#requirements}

- 服务端与命令行应用使用 Node.js 22 或更高版本。
- 浏览器产品需要支持 ES Modules、Canvas 2D、WebAssembly 与 Web Crypto 的现代浏览器。
- npm、pnpm 或其他能够解析 package exports 的包管理器。

KJDraw 核心的 npm 运行时依赖为零。React、Vue 是可选 peer dependency：导入 `/react` 或 `/vue` 时，安装应用所用的框架即可。无界面程序和原生 TypeScript 应用无需安装这两个框架。

## 发布渠道 {#release-channels}

| 目标 | 命令 |
| --- | --- |
| 试用当前候选版 | `npm install @kanjieteam/kjdraw@next` |
| 锁定本文档对应版本 | `npm install @kanjieteam/kjdraw@1.0.0-rc.3` |
| 安装稳定渠道 | `npm install @kanjieteam/kjdraw@latest` |
| 安装本地 checkout | `npm install /path/to/kjdraw/packages/kjdraw-sdk` |

预发布版本使用 `next`，稳定版本使用 `latest`。需要可复现构建时应锁定确切版本，并用 `npm list @kanjieteam/kjdraw` 核对实际安装结果。

## 验证安装 {#verify-installation}

在干净工程中直接运行安装包自带的快速示例：

```sh
node node_modules/@kanjieteam/kjdraw/examples/quickstart.mjs
```

运行成功后会输出 JSON，其中包含已安装的 SDK 版本、图档 ID 和一条创建完成的直线。该示例不需要浏览器、模型或 API Key。

## 公共导入路径 {#public-imports}

常用 SDK 能力从根入口导入；当你希望边界更小、更明确时使用子路径。

```ts
import { createKJDrawSDK } from '@kanjieteam/kjdraw'
import { createDXFFileAdapter } from '@kanjieteam/kjdraw/file/dxf'
import { KJDeploymentRegistry } from '@kanjieteam/kjdraw/deployment'
```

[API Reference](https://kanjieteam.github.io/kjdraw/docs/latest/api/)列出了全部受支持的包入口及其公开类型。
:::
