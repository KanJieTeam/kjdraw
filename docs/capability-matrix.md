# Capability matrix

This matrix describes executable public code in the current developer preview. It is deliberately narrower than a marketing feature list.

## Verified baseline

- **65 registered commands** backed by SDK implementations and audited capability declarations.
- **28 standard entity contracts**, including `PROXY_ENTITY` preservation and experimental `SOLID3D`.
- **93 automated tests** covering documents, editing, deployment providers, files, projects, plugins, Rust/WASM bridges and public samples.
- **7 synthetic DXF target fixtures** with reproducible hashes and semantic read/write/reopen evidence.
- **No runtime npm dependencies** for the SDK checkout path.

Run `node scripts/test.mjs` and `node scripts/check.mjs` to reproduce the public gates.

## Capability status

| Area | Current public capability | Status |
| --- | --- | --- |
| Document model | Stable IDs/handles, ownership, tables, model/paper spaces, resources, revisions | Available |
| Browser workbench | Multi-drawing tabs, project snapshots, Shift multi-select, grouped transforms, grid/snap/ortho controls and nested supported block geometry | Available for the demonstrated entity subset |
| Transactions | Atomic commit, rollback, undo/redo, expected-revision conflicts | Available |
| 2D editing | Create/erase/properties, transforms, arrays, offset, break, explode, trim/extend, chamfer/fillet | Available for declared combinations |
| Inspection | Length, area, distance, angle, nearest point and intersections | Available for declared combinations |
| Drafting resources | Layers, blocks/inserts, groups, hatches, styles, UCS, layouts, viewports and plot metadata | Available/partial by resource |
| Files | KJD read/write, deterministic ZIP64 KJP, ASCII DXF read/write and [7-version synthetic corpus](dxf-compatibility.md) | Developer preview |
| Extensions | Commands, entities, renderers, file adapters, tools, snaps, properties and workspaces | Available |
| Deployment | Browser, desktop, self-hosted, cloud-assisted and hybrid provider profiles | Contract available |
| TypeScript source | Deployment Provider and Agent plan slices with generated ESM parity gate; declarations cover the public SDK | Migration in progress |
| Agent interface | One-shot plans bound to exact arguments, document fingerprint/revision, expiry and reviewer; receipts and undo | Available in one SDK host process |
| npm consumption | Published `@kanjieteam/kjdraw`, package self-import quickstart and guarded release workflow | `0.7.1-preview.1` installed and executed from a clean directory |
| Rust/WASM | Document validation, geometry primitives and bounded solid-mesh operations | Partial |
| General BRep | Curved topology, healing and arbitrary solid operations | Not available |
| Certified plotting | Complete layout/font/plot fidelity | Not available |
| DWG | No certified public backend | Blocked |

Unsupported export paths should reject instead of silently dropping known content. This is not yet a promise of lossless conversion for arbitrary CAD files; keep source files and inspect the [status notes](status.md).
