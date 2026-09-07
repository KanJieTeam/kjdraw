# Architecture

KJDraw separates canonical CAD data from its visual projection and from the product using it.

| Component | Responsibility |
| --- | --- |
| `packages/kjdraw-sdk/src` | Document facade, transactions, commands, extension registration, selections, editing and file adapters |
| `runtime/kjcore-rs` | Rust document validation/revisions, primitive geometry and experimental solid meshes; raw WASM ABI |
| `apps/playground` | Small Canvas 2D reference client; no canonical geometry stored in DOM or framework state |
| `examples` | Original synthetic data and executable integration examples |

## Documents and persistence

A KJD document is a canonical JSON object graph with stable IDs, handles, ownership, tables, spaces, resources and revisions. Transactions operate on a draft, validate, then publish. A rejected transaction must not expose partial changes. Undo/redo is currently session history; reopening a KJP does not recreate the SDK's in-memory undo stack.

A KJP project is a ZIP64 package with a manifest, drawing documents and command journal. It can carry assets and snapshots. The project package is portable; it does not require a Kanjie account. Session management and storage binding are separate. A browser download is not equivalent to fsync/atomic native persistence.

## Commands and agents

Hosts can call SDK commands directly or use versioned envelopes. Envelopes include document ID, expected revision, origin, plan/execute mode, arguments and confirmation metadata. A plan produces a non-mutating receipt; execution uses the same transactional command implementations as UI tools.

Hosts must bind user approval to exact plan arguments, document and revision. The SDK does not persist a trusted plan registry or authenticate confirmation metadata. Plugins execute JavaScript in the host context unless the host adds isolation. Permission manifests document and constrain cooperative registration; they are not a hostile-code sandbox.

## Geometry authority

Rust/WASM is available for document sessions, primitive geometry queries, and specified solid-mesh operations. Many 2D edits still compute in JavaScript. Backend identity is explicit; reference geometry is not promoted to authoritative export by missing-backend fallback. The older machine-readable 1.0 contract describes a target architecture; it does not mean the developer preview has fulfilled all of it.

The minimal playground calls public SDK commands, reads document state for rendering, and uses the Rust document bridge when available. It is not the full private Kanjie Studio and does not certify drawing fidelity or printing.
