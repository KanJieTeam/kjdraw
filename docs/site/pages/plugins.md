---
slug: plugins
title.en: Plugins
title.zh: 插件
summary.en: Extend commands, entities, files and workbench surfaces through versioned manifests and explicit cooperative grants.
summary.zh: 通过版本化清单和显式协作授权，扩展命令、实体、文件与工作台界面。
---
:::en
## Declare the contract {#declare-the-contract}

```json
{
  "schema": "com.kanjie.kjdraw.plugin",
  "schemaVersion": 1,
  "id": "community.center-marker",
  "name": "Center marker starter",
  "version": "1.0.0",
  "compatibility": { "sdk": ">=1.0.0 <2.0.0", "kernel": "*" },
  "permissions": ["commands.register"],
  "contributes": { "commands": ["KJ_MARK_CENTER"] }
}
```

The host inspects the manifest, checks SDK/kernel compatibility and decides which requested permissions to grant. Contributions must be declared before activation.

## Activate through a scope {#activate-through-a-scope}

```ts
import type {
  KJCommandDefinition,
  KJDrawSDK,
  KJPluginManifest,
} from '@kanjieteam/kjdraw'

export function activate(sdk: KJDrawSDK, manifest: KJPluginManifest) {
  const scope = sdk.createPluginScope(manifest, {
    grantedPermissions: ['commands.register'],
  })

  scope.registerCommand({
    id: 'KJ_MARK_CENTER',
    title: 'Add center marker',
    execute: ({ transaction }, args) => transaction.createEntity('CIRCLE', {
      center: [Number(args.x ?? 0), Number(args.y ?? 0), 0],
      radius: Number(args.radius ?? 5),
    }),
  } satisfies KJCommandDefinition)

  return scope
}
```

Disposing the returned scope removes registrations owned by that plugin. Keep geometry changes inside commands so validation, receipts, revisioning and undo remain intact.

## Extension points {#extension-points}

The 1.0 contract includes commands, entity definitions/renderers, file adapters, algorithms, tools, snaps, property panels, keymaps, workspaces, scene sources, ribbons, panels and symbols. Use only declared public extension points; do not patch SDK internals.

## Security boundary {#security-boundary}

Plugin permissions are cooperative declarations, not hostile-code isolation. Run untrusted third-party code in a host-owned Worker, process or sandbox. Start from the tested [TypeScript plugin starter](https://github.com/KanJieTeam/kjdraw/tree/main/examples/plugin-starter).
:::
:::zh
## 声明插件契约 {#declare-the-contract}

```json
{
  "schema": "com.kanjie.kjdraw.plugin",
  "schemaVersion": 1,
  "id": "community.center-marker",
  "name": "Center marker starter",
  "version": "1.0.0",
  "compatibility": { "sdk": ">=1.0.0 <2.0.0", "kernel": "*" },
  "permissions": ["commands.register"],
  "contributes": { "commands": ["KJ_MARK_CENTER"] }
}
```

宿主先检查清单与 SDK/kernel 兼容范围，再决定授予哪些申请权限。所有贡献项都必须在激活前声明。

## 通过作用域激活 {#activate-through-a-scope}

```ts
import type {
  KJCommandDefinition,
  KJDrawSDK,
  KJPluginManifest,
} from '@kanjieteam/kjdraw'

export function activate(sdk: KJDrawSDK, manifest: KJPluginManifest) {
  const scope = sdk.createPluginScope(manifest, {
    grantedPermissions: ['commands.register'],
  })

  scope.registerCommand({
    id: 'KJ_MARK_CENTER',
    title: 'Add center marker',
    execute: ({ transaction }, args) => transaction.createEntity('CIRCLE', {
      center: [Number(args.x ?? 0), Number(args.y ?? 0), 0],
      radius: Number(args.radius ?? 5),
    }),
  } satisfies KJCommandDefinition)

  return scope
}
```

释放返回的 scope 会移除该插件拥有的注册项。几何修改应始终放在命令中，从而保留校验、回执、修订与撤销。

## 扩展点 {#extension-points}

1.0 契约包括命令、实体定义/渲染器、文件适配器、算法、工具、捕捉、属性面板、快捷键、工作区、场景源、Ribbon、面板与符号。只使用声明过的公共扩展点，不要修改 SDK 内部实现。

## 安全边界 {#security-boundary}

插件权限是协作式声明，不是恶意代码隔离。第三方不可信代码应运行在宿主控制的 Worker、进程或沙箱中。建议从已测试的 [TypeScript 插件起步工程](https://github.com/KanJieTeam/kjdraw/tree/main/examples/plugin-starter)开始。
:::
