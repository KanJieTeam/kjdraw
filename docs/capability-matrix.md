# Capability matrix

This matrix describes executable public code in the current developer preview. It is deliberately narrower than a marketing feature list.

## Verified baseline

- **65 registered commands** backed by SDK implementations and audited capability declarations.
- **28 standard entity contracts**, including `PROXY_ENTITY` preservation and experimental `SOLID3D`.
- **86 automated tests** covering documents, editing, deployment providers, files, projects, plugins, Rust/WASM bridges and public samples.
- **No runtime npm dependencies** for the SDK checkout path.

Run `node scripts/test.mjs` and `node scripts/check.mjs` to reproduce the public gates.

## Capability status

| Area | Current public capability | Status |
| --- | --- | --- |
| Document model | Stable IDs/handles, ownership, tables, model/paper spaces, resources, revisions | Available |
| Transactions | Atomic commit, rollback, undo/redo, expected-revision conflicts | Available |
| 2D editing | Create/erase/properties, transforms, arrays, offset, break, explode, trim/extend, chamfer/fillet | Available for declared combinations |
| Inspection | Length, area, distance, angle, nearest point and intersections | Available for declared combinations |
| Drafting resources | Layers, blocks/inserts, groups, hatches, styles, UCS, layouts, viewports and plot metadata | Available/partial by resource |
| Files | KJD read/write, deterministic ZIP64 KJP, ASCII DXF read/write | Developer preview |
| Extensions | Commands, entities, renderers, file adapters, tools, snaps, properties and workspaces | Available |
| Deployment | Browser, desktop, self-hosted, cloud-assisted and hybrid provider profiles | Contract available |
| Agent interface | Plan/execute envelopes, explicit confirmation, revision binding and receipts | Available |
| Rust/WASM | Document validation, geometry primitives and bounded solid-mesh operations | Partial |
| General BRep | Curved topology, healing and arbitrary solid operations | Not available |
| Certified plotting | Complete layout/font/plot fidelity | Not available |
| DWG | No certified public backend | Blocked |

Unsupported export paths should reject instead of silently dropping known content. This is not yet a promise of lossless conversion for arbitrary CAD files; keep source files and inspect the [status notes](status.md).
