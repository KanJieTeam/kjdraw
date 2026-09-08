# Architecture

KJDraw separates canonical CAD data from its visual projection, deployment services and the product using it. The same core can run without a server or attach host-selected services through explicit providers.

| Component | Responsibility |
| --- | --- |
| `packages/kjdraw-sdk/src` | Document facade, transactions, commands, extension registration, selections, editing and file adapters |
| `runtime/kjcore-rs` | Rust document validation/revisions, primitive geometry and experimental solid meshes; raw WASM ABI |
| `apps/playground` | Generic Canvas 2D reference workbench; no canonical geometry stored in DOM or framework state |
| `examples` | Original synthetic data and executable integration examples |

```text
Applications · Workbench · AI agents
                 │
       Commands · Documents · Files
                 │
      TypeScript SDK ↔ Rust/WASM
                 │
   Project · Compute · Scene providers
      local / self-hosted / cloud
```

## Deployment providers

Deployment is a host concern. `KJDeploymentRegistry` validates three provider families: project storage, compute and scene streaming. A deployment profile names the providers selected by the host for browser-local, desktop-local, self-hosted, cloud-assisted or hybrid operation. Provider registration never performs implicit network access.

The provider API is not an authentication layer. Hosts remain responsible for identity, authorization, tenant isolation, transport security and disclosure of remote processing. See [Deployment](deployment.md) and [Security architecture](../SECURITY_ARCHITECTURE.md).

## Documents and persistence

A KJD document is a canonical JSON object graph with stable IDs, handles, ownership, tables, spaces, resources and revisions. Transactions operate on a draft, validate, then publish. A rejected transaction must not expose partial changes. Undo/redo is currently session history; reopening a KJP does not recreate the SDK's in-memory undo stack.

A KJP project is a ZIP64 package with a manifest, drawing documents and command journal. It can carry assets and snapshots. The project package is portable; it does not require a Kanjie account. Session management and storage binding are separate. A browser download is not equivalent to fsync/atomic native persistence.

## Commands and agents

Hosts can call SDK commands directly or use versioned envelopes. Envelopes include document ID, expected revision, origin, plan/execute mode, arguments and confirmation metadata. A plan produces a non-mutating receipt; execution uses the same transactional command implementations as UI tools.

The SDK keeps a short-lived in-process Agent plan registry and binds approval to exact arguments, document content and revision before one-shot execution. Hosts own user authentication and durable approval storage. Plugins execute in the host context unless the host adds isolation; permission manifests constrain cooperative registration.

## Geometry authority

Rust/WASM is available for document sessions, primitive geometry queries and specified solid-mesh operations. Portable 2D reference operations are authored in TypeScript. Backend identity is explicit, and the machine-readable acceptance matrix records the current candidate evidence separately from hosted release verification.

The reference workbench calls public SDK commands, reads document state for rendering, and uses the Rust document bridge when available. It does not include downstream domain compilers, proprietary data or enterprise services, and does not certify arbitrary drawing fidelity or printing.
