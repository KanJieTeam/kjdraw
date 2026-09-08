---
slug: architecture
title.en: Architecture
title.zh: 架构
summary.en: Understand where document truth lives, how commands cross boundaries and which responsibilities remain with the embedding host.
summary.zh: 理解图档真相保存在哪里、命令如何跨越边界，以及哪些职责始终属于嵌入宿主。
---
:::en
## Layer model {#layer-model}

```text
Product UI · Reference workbench · Plugins · AI agents
                         │
              Commands + transactions
                         │
       Typed document model + KJD / KJP / DXF
                         │
       TypeScript reference path ↔ optional Rust/WASM
                         │
        Project · Compute · Scene providers
```

The document is canonical. Component state, canvas display lists and selection overlays are projections that can be rebuilt. File and compute services enter through explicit adapters instead of becoming hidden global dependencies.

## Documents and transactions {#documents-and-transactions}

A `KJDocument` owns stable IDs and handles, object ownership, tables, blocks, model/paper spaces, resources and a monotonically changing revision. A transaction edits a draft, validates the result and then publishes it atomically. Undo/redo is session history; reopening a KJP does not claim to reconstruct the in-memory undo stack.

## TypeScript and Rust authority {#typescript-and-rust-authority}

Every public runtime module is authored in strict TypeScript. Browser/Node ESM and declarations are generated and checked for drift. The TypeScript path provides the portable reference implementation.

Rust/WebAssembly can provide document authority, geometry predicates and explicitly bounded solid-mesh operations. Backend identity is observable. Missing WASM is never silently described as Rust-authoritative output.

## Host responsibilities {#host-responsibilities}

KJDraw provides capability wiring. The embedding product supplies authentication, authorization, tenant isolation, transport policy, durable audit storage, model isolation and the sandbox policy for third-party plugin code.

Remote activity begins when the host invokes a configured remote provider, keeping data flow explicit and observable.
:::
:::zh
## 分层模型 {#layer-model}

```text
产品 UI · 参考工作台 · 插件 · AI Agent
                    │
               命令 + 事务
                    │
       类型化图档模型 + KJD / KJP / DXF
                    │
    TypeScript 参考路径 ↔ 可选 Rust/WASM
                    │
       工程 · 计算 · 场景 Provider
```

图档是规范真相。组件状态、Canvas 显示列表和选择覆盖层都只是可以重建的投影。文件与计算服务通过显式适配器进入系统，而不是变成隐藏的全局依赖。

## 图档与事务 {#documents-and-transactions}

`KJDocument` 管理稳定 ID 与 handle、对象所有权、表、块、模型/图纸空间、资源和单调变化的修订号。事务先编辑草稿，再校验结果，最后原子发布。撤销/重做属于当前会话历史；重新打开 KJP 不会冒充已经恢复 SDK 的内存撤销栈。

## TypeScript 与 Rust 权威 {#typescript-and-rust-authority}

每个公共运行时模块都以严格 TypeScript 为权威源。浏览器/Node ESM 与类型声明自动生成，并检查漂移。TypeScript 路径提供可移植的参考实现。

Rust/WebAssembly 可以承担图档权威、几何判定和边界明确的实体网格运算。后端身份可观察；WASM 缺失时，系统绝不会把参考结果伪装成 Rust 权威结果。

## 宿主职责 {#host-responsibilities}

KJDraw 提供能力连接。嵌入产品负责认证、授权、租户隔离、传输策略、持久审计、模型隔离，以及第三方插件代码的沙箱策略。

宿主调用已配置的远程 Provider 时才开始远程处理，让数据流保持显式、可观察。
:::
