# KJDraw 1.0 capability matrix

This matrix maps public promises to executable evidence for `1.0.0-rc.2`; it does not pre-announce a stable release.

Status meanings:

- **Gated** — implemented with repository-owned automated evidence.
- **Release verification** — implementation and local gate exist; the exact public candidate still needs hosted or registry verification.
- **Experimental** — usable only within the stated boundary and outside the stable compatibility promise.
- **Not included** — deliberately outside KJDraw 1.0.

## Product and SDK

| Capability | Public contract | Status | Evidence |
| --- | --- | --- | --- |
| TypeScript SDK | Every runtime module is strict TypeScript-owned; committed ESM is generated for browser and Node.js consumers | Gated | [`typescript-source.test.mjs`](../packages/kjdraw-sdk/test/typescript-source.test.mjs), [`build-typescript.mjs`](../scripts/build-typescript.mjs) |
| Type declarations | Root and exported subpaths receive generated declarations without source drift | Gated | [`typescript-contract.test.mjs`](../packages/kjdraw-sdk/test/typescript-contract.test.mjs), [`build-declarations.mjs`](../scripts/build-declarations.mjs) |
| npm package | ESM-first, zero runtime dependencies, public root/subpath exports and executable quickstart | Gated | [`package.json`](../packages/kjdraw-sdk/package.json), [`npm-quickstart.test.mjs`](../packages/kjdraw-sdk/test/npm-quickstart.test.mjs) |
| Framework consumers | Vanilla TypeScript, React TSX and Vue composable compile from an isolated packed tarball | Gated | [`verify-packed-package.mjs`](../scripts/audits/verify-packed-package.mjs), [`consumer-types`](../fixtures/consumer-types/) |
| Headless CLI | Inspect, validate and convert KJD/KJP/DXF locally | Gated | [`cli.test.mjs`](../packages/kjdraw-sdk/test/cli.test.mjs), [`kjdraw.mjs`](../packages/kjdraw-sdk/bin/kjdraw.mjs) |
| Plugin lifecycle | Versioned manifest, compatibility range, explicit permission grant, declared contributions and disposal | Gated | [`plugin-starter`](../examples/plugin-starter/), [`plugin-starter.test.mjs`](../packages/kjdraw-sdk/test/plugin-starter.test.mjs) |
| Deployment providers | Browser-local, desktop-local, self-hosted, cloud-assisted and hybrid profiles with explicit project/compute/scene providers | Gated | [`product-contract.test.mjs`](../packages/kjdraw-sdk/test/product-contract.test.mjs), [deployment guide](deployment.md) |

## CAD model and editing

| Capability | Public contract | Status | Evidence |
| --- | --- | --- | --- |
| Document graph | Stable IDs/handles, ownership, tables, dictionaries, blocks, model/paper spaces, resources and revisions | Gated | [`sdk.test.mjs`](../packages/kjdraw-sdk/test/sdk.test.mjs), [`schema.ts`](../packages/kjdraw-sdk/src/schema.ts) |
| Transactions | Atomic commit/rollback, expected-revision conflicts, undo/redo and authority rejection without partial mutation | Gated | [`sdk.test.mjs`](../packages/kjdraw-sdk/test/sdk.test.mjs), [`rust-wasm-artifact.test.mjs`](../packages/kjdraw-sdk/test/rust-wasm-artifact.test.mjs) |
| 2D creation/editing | Create/erase/properties, transforms, arrays, offset, break, explode, trim/extend, chamfer/fillet and grips for declared entity combinations | Gated | [`editing-advanced.test.mjs`](../packages/kjdraw-sdk/test/editing-advanced.test.mjs), [`commands.ts`](../packages/kjdraw-sdk/src/commands.ts) |
| Selection and drafting | Multi-selection, named sets, snaps, nearest/intersection queries, grid/ortho settings and layers | Gated | [`contracts-selection.test.mjs`](../packages/kjdraw-sdk/test/contracts-selection.test.mjs), [`snapping-grips.test.mjs`](../packages/kjdraw-sdk/test/snapping-grips.test.mjs), [`layers.test.mjs`](../packages/kjdraw-sdk/test/layers.test.mjs) |
| Inspection | Length, area, distance, angle, nearest point, intersections, document search and handle-based comparison | Gated | [`geometry.test.mjs`](../packages/kjdraw-sdk/test/geometry.test.mjs), [`sdk.test.mjs`](../packages/kjdraw-sdk/test/sdk.test.mjs) |
| Drafting resources | Blocks/inserts, groups, hatches, linetypes, text/dimension styles, UCS, layouts, viewports and plot metadata | Gated for stored/declared semantics | [`sdk.test.mjs`](../packages/kjdraw-sdk/test/sdk.test.mjs) |
| General BRep | Curved topology, healing and arbitrary robust solid operations | Not included | [1.0 scope](1.0-scope.md) |
| Solid meshes | Primitives, mesh validation, transforms, volume and bounded axis-aligned-box booleans | Experimental | [`solid3d.test.mjs`](../packages/kjdraw-sdk/test/solid3d.test.mjs), [`rust-wasm-artifact.test.mjs`](../packages/kjdraw-sdk/test/rust-wasm-artifact.test.mjs) |
| Certified plotting | Complete font/layout fidelity and device-certified PDF/printing | Not included | [1.0 scope](1.0-scope.md) |

## Files and projects

| Capability | Public contract | Status | Evidence |
| --- | --- | --- | --- |
| KJD | Canonical read/write, validation, revisions and configurable byte/object limits | Gated | [`resource-limits.test.mjs`](../packages/kjdraw-sdk/test/resource-limits.test.mjs), [`kjd-adapter.ts`](../packages/kjdraw-sdk/src/kjd-adapter.ts) |
| KJP | Deterministic ZIP64 package, multiple drawings, hashes, snapshots, journal and bounded decoding | Gated | [`project-package.test.mjs`](../packages/kjdraw-sdk/test/project-package.test.mjs), [`file-safety.test.mjs`](../packages/kjdraw-sdk/test/file-safety.test.mjs) |
| Browser save/reopen | Download a KJP, reopen it and verify document fingerprint/content | Gated locally | [`launch-journey.spec.mjs`](../tests/browser/launch-journey.spec.mjs) |
| ASCII DXF | Published entity/resource/version subset, deterministic corpus and pinned ezdxf cross-implementation audit | Gated | [`dxf-compatibility.md`](dxf-compatibility.md), [`audit-dxf-corpus.mjs`](../scripts/audit-dxf-corpus.mjs), [`dxf-interop.mjs`](../scripts/audits/dxf-interop.mjs) |
| Binary DXF | Binary DXF parsing or writing | Not included | [status](status.md) |
| DWG | Public read/write backend | Not included | [1.0 scope](1.0-scope.md) |

## Workbench, agents and operations

| Capability | Public contract | Status | Evidence |
| --- | --- | --- | --- |
| Browser workbench | Bilingual multi-drawing UI for open, inspect, draw, edit, measure, review, save, reopen and undo | Release verification | [`playground-experience.test.mjs`](../packages/kjdraw-sdk/test/playground-experience.test.mjs), [`launch-journey.spec.mjs`](../tests/browser/launch-journey.spec.mjs) |
| Agent review protocol | Exact arguments and full document digest, SHA-256 binding, revision, expiry, reviewer, single consumption, receipt and undo | Gated | [`agent-plans.test.mjs`](../packages/kjdraw-sdk/test/agent-plans.test.mjs), [Agent protocol](agent-protocol.md) |
| Input budgets | Configurable KJD/DXF/KJP byte, object, tag, entity and archive limits plus abort handling | Gated | [`resource-limits.test.mjs`](../packages/kjdraw-sdk/test/resource-limits.test.mjs), [`file-safety.test.mjs`](../packages/kjdraw-sdk/test/file-safety.test.mjs) |
| Large-document core budget | Synthetic 10,000-line batch/create/edit/snapshot/KJD/KJP profile with memory ceiling | Gated | [`performance-budgets.json`](performance-budgets.json), [`core-readiness.mjs`](../scripts/benchmarks/core-readiness.mjs) |
| Versioned Docs/API | Bilingual multi-page guides plus generated API deep links sourced from declarations | Release verification | [`docs-site.test.mjs`](../packages/kjdraw-sdk/test/docs-site.test.mjs), [`api-docs.test.mjs`](../packages/kjdraw-sdk/test/api-docs.test.mjs), [`build-docs-site.mjs`](../scripts/build-docs-site.mjs), [`build-api-docs.mjs`](../scripts/build-api-docs.mjs) |
| Release supply chain | Pinned Actions, exact-tag package, SBOM, SHA-256 checksums, npm provenance and GitHub artifact attestation | Release verification | [`release.yml`](../.github/workflows/release.yml), [`npm-publish.yml`](../.github/workflows/npm-publish.yml), [`release-artifacts.mjs`](../scripts/release-artifacts.mjs) |

## Reproduce the gates

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
node --no-warnings scripts/build-typescript.mjs --check
node scripts/build-declarations.mjs --check
node scripts/build-docs-site.mjs --check
node scripts/build-api-docs.mjs --check
node scripts/audits/verify-packed-package.mjs
node scripts/audit-dxf-corpus.mjs
node scripts/benchmarks/core-readiness.mjs --entities=10000 --assert-budget
npm run test:browser
node scripts/audits/release-readiness.mjs
```

The stable tag requires every `requiredForStable` item in the [machine-readable acceptance matrix](KJDRAW_1_0_ACCEPTANCE_MATRIX.json) to pass on one immutable release-candidate commit.
