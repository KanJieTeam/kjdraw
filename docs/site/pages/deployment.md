---
slug: deployment
title.en: Deployment
title.zh: 部署
summary.en: Keep browser-local operation simple or attach explicit project, compute and scene providers for other product topologies.
summary.zh: 既可保持浏览器本地运行，也可为其他产品形态显式连接工程、计算与场景 Provider。
---
:::en
## Supported profiles {#supported-profiles}

| Profile | Where project data lives | Typical use |
| --- | --- | --- |
| `browser-local` | KJP file or browser storage | Zero-install tools and offline review |
| `desktop-local` | Application-managed project file | Desktop engineering products |
| `self-hosted` | Organization-selected providers | Private networks and regulated environments |
| `cloud-assisted` | Host-selected remote services | Managed compute or conversion |
| `hybrid` | Explicit local and remote providers | Local editing with selected acceleration |

KJDraw uses the same editor, document and file APIs in every profile. A registered provider runs only when the application invokes it.

## Register a project provider {#register-a-provider}

```ts
import {
  KJDeploymentRegistry,
  KJ_PROVIDER_TYPES,
  createDeploymentProfile,
  validateDeploymentProfile,
} from '@kanjieteam/kjdraw/deployment'

const providers = new KJDeploymentRegistry()

providers.register(KJ_PROVIDER_TYPES.PROJECT_STORE, {
  id: 'acme.projects',
  locality: 'self-hosted',
  loadProject: id => projectApi.load(id),
  saveProject: (id, bytes) => projectApi.save(id, bytes),
})

const deployment = validateDeploymentProfile(createDeploymentProfile({
  mode: 'self-hosted',
  projectAuthority: 'acme.projects',
  providers: { 'project-store': 'acme.projects' },
}), providers)
```

## Provider families {#provider-families}

- `project-store` loads and saves project artifacts.
- `compute` executes a named host operation.
- `scene` opens a scene and answers viewport queries.

Profiles select providers, while credentials stay in application configuration. Your application decides when to invoke a provider and how to authenticate the request.

## Connect your application {#connect-your-application}

Keep credentials, encryption, authorization, tenancy, retry and storage choices in your application layer. A platform-specific project provider can add atomic replacement and durable writes where the product needs them.

See the runnable [deployment provider example](https://github.com/KanJieTeam/kjdraw/blob/main/examples/deployment-providers.mjs).
:::
:::zh
## 支持的部署形态 {#supported-profiles}

| 形态 | 工程数据位置 | 常见用途 |
| --- | --- | --- |
| `browser-local` | KJP 文件或浏览器存储 | 零安装工具与离线审核 |
| `desktop-local` | 应用管理的工程文件 | 桌面工程产品 |
| `self-hosted` | 组织选择的 Provider | 内网与合规环境 |
| `cloud-assisted` | 宿主选择的远程服务 | 托管计算或转换 |
| `hybrid` | 显式本地与远程 Provider | 本地编辑加选择性加速 |

KJDraw 在每种形态下都使用同一套编辑器、图档与文件 API。已注册的 Provider 只会在应用主动调用时运行。

## 注册工程 Provider {#register-a-provider}

```ts
import {
  KJDeploymentRegistry,
  KJ_PROVIDER_TYPES,
  createDeploymentProfile,
  validateDeploymentProfile,
} from '@kanjieteam/kjdraw/deployment'

const providers = new KJDeploymentRegistry()

providers.register(KJ_PROVIDER_TYPES.PROJECT_STORE, {
  id: 'acme.projects',
  locality: 'self-hosted',
  loadProject: id => projectApi.load(id),
  saveProject: (id, bytes) => projectApi.save(id, bytes),
})

const deployment = validateDeploymentProfile(createDeploymentProfile({
  mode: 'self-hosted',
  projectAuthority: 'acme.projects',
  providers: { 'project-store': 'acme.projects' },
}), providers)
```

## Provider 类型 {#provider-families}

- `project-store` 读取与保存工程产物。
- `compute` 执行宿主定义的命名操作。
- `scene` 打开场景并响应视口查询。

部署 Profile 选择所需 Provider，凭据保存在应用配置中。何时调用、怎样认证都由你的应用决定。

## 连接你的应用 {#connect-your-application}

凭据、加密、授权、租户隔离、重试与存储选择都保留在你的应用层。平台专用的工程 Provider 可以按产品需要增加原子替换与持久写入。

参见可运行的 [部署 Provider 示例](https://github.com/KanJieTeam/kjdraw/blob/main/examples/deployment-providers.mjs)。
:::
