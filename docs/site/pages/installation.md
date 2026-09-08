---
slug: installation
title.en: Installation
title.zh: 安装
summary.en: Choose the npm channel, runtime and import path that match your application and release policy.
summary.zh: 根据应用形态与发布策略选择正确的 npm 渠道、运行环境和导入路径。
---
:::en
## Requirements {#requirements}

- Node.js 22 or newer for repository tooling and supported Node.js consumers.
- A modern browser with ES modules, Canvas 2D, WebAssembly and Web Crypto for browser products.
- npm, pnpm or another package manager that understands package exports.

KJDraw's core has no runtime npm dependencies. React and Vue are optional peer dependencies: install the framework your application uses when importing `/react` or `/vue`. Headless and plain TypeScript applications do not need either framework.

## Release channels {#release-channels}

| Intent | Command |
| --- | --- |
| Evaluate the current RC | `npm install @kanjieteam/kjdraw@next` |
| Reproduce RC2 exactly | `npm install @kanjieteam/kjdraw@1.0.0-rc.2` |
| Install stable after promotion | `npm install @kanjieteam/kjdraw` |
| Work from a checkout | `npm install /path/to/kjdraw/packages/kjdraw-sdk` |

Do not assume npm `latest` points to a release candidate. Prereleases are intentionally published under `next`.

## Public imports {#public-imports}

Use the root for the common SDK surface and subpaths when you want a smaller, explicit contract.

```ts
import { createKJDrawSDK } from '@kanjieteam/kjdraw'
import { createDXFFileAdapter } from '@kanjieteam/kjdraw/file/dxf'
import { KJDeploymentRegistry } from '@kanjieteam/kjdraw/deployment'
```

Every declared package export appears in the generated API reference and is verified against the package manifest in CI.
:::
:::zh
## 环境要求 {#requirements}

- 仓库工具链和受支持的 Node.js 消费端使用 Node.js 22 或更高版本。
- 浏览器产品需要支持 ES Modules、Canvas 2D、WebAssembly 与 Web Crypto 的现代浏览器。
- npm、pnpm 或其他能够解析 package exports 的包管理器。

KJDraw 核心的 npm 运行时依赖为零。React、Vue 是可选 peer dependency：导入 `/react` 或 `/vue` 时，安装应用所用的框架即可。无界面程序和原生 TypeScript 应用无需安装这两个框架。

## 发布渠道 {#release-channels}

| 目标 | 命令 |
| --- | --- |
| 评估当前候选版 | `npm install @kanjieteam/kjdraw@next` |
| 精确复现 RC2 | `npm install @kanjieteam/kjdraw@1.0.0-rc.2` |
| 稳定版晋级后安装 | `npm install @kanjieteam/kjdraw` |
| 从本地 checkout 使用 | `npm install /path/to/kjdraw/packages/kjdraw-sdk` |

不要假设 npm `latest` 会指向候选版。预发布版本会刻意发布到 `next`。

## 公共导入路径 {#public-imports}

常用 SDK 能力从根入口导入；当你希望边界更小、更明确时使用子路径。

```ts
import { createKJDrawSDK } from '@kanjieteam/kjdraw'
import { createDXFFileAdapter } from '@kanjieteam/kjdraw/file/dxf'
import { KJDeploymentRegistry } from '@kanjieteam/kjdraw/deployment'
```

所有 package exports 都会进入自动生成的 API Reference，并由 CI 对照包清单验证。
:::
