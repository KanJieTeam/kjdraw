# KJDraw 1.0 readiness and capability boundaries

This page separates what exists in the repository from what has been verified on an immutable public release. The current source-tree candidate is `1.0.0-rc.3`; the target contract is `1.0.0`.

The checkout version does not establish npm publication. Source-tree improvements below must not be mistaken for capabilities already shipped in a registry package. Query the current tags and the exact checkout version before choosing an artifact:

```sh
npm view @kanjieteam/kjdraw dist-tags
npm view @kanjieteam/kjdraw@1.0.0-rc.3 version
npm install @kanjieteam/kjdraw@next
```

An absent version is not installable from npm; a network or authentication error is not evidence of absence. The `next` tag can advance after a later release. See the [installation and publishing guide](npm-publishing.md) for version pinning, a previously published GitHub tarball alternative and source-checkout evaluation.

For the authoritative gate state, read [`KJDRAW_1_0_ACCEPTANCE_MATRIX.json`](KJDRAW_1_0_ACCEPTANCE_MATRIX.json) or run:

```sh
node scripts/audits/release-readiness.mjs
```

## Ready in the source tree

For the current public npm/source comparison, run `npm run audit:distribution`. Add `-- --require-current` to fail when the source version is unpublished or the expected channel points elsewhere. Registry/network errors are reported as unknown, not as a missing release. This check is read-only and does not replace artifact or stable-release verification.

- Every public SDK runtime module has a strict TypeScript authority file. Browser/Node ESM is generated and checked for parity.
- Generated declarations cover the package root and every documented subpath.
- The public editor and React/Vue components share the canvas renderer, drawing data, commands and original industry samples used by the workbench.
- Bilingual task guides explain setup, framework integration, files, commands, plugins and agents. The main API reference documents editor options, methods and events, with low-level declarations available separately.
- KJD transactions, rollback, revisions, undo/redo and optional Rust/WASM document authority have executable tests.
- KJP packages carry multiple drawings, hashes, snapshots and command journals with bounded ZIP64 decoding.
- The public plugin starter exercises manifest validation, compatibility, explicit permission grants, activation, a real transaction and disposal.
- Agent plans use SHA-256 content binding over exact arguments and complete document content, plus expected revision, expiry, reviewer identity and one-shot consumption.
- The source-tree `drawing-context` entry provides read-only, revision-bound entity/layer queries with native geometry, editing eligibility, pagination and explicit response/geometry omissions. It does not connect a model or authorize data access.
- The source-tree `agent-tools` entry provides six model-neutral starter tool definitions with runtime validation, bound-document queries/measurement and line/circle/move proposals. Approval is a separate trusted-host method; provider adapters, rendered previews, durable task recovery and real model-task verification remain incomplete.
- The synthetic 10,000-line core profile is enforced by a CI budget for batch creation, a single-entity edit, snapshot, KJD/KJP round trips and memory growth.
- The headless CLI inspects, validates and converts KJD, KJP and the supported DXF profile without uploading files.

These statements describe repository-owned evidence. They are not a claim that a future tag, npm artifact or hosted page already passed its release run.

## Verification still required for stable 1.0

Stable promotion remains blocked until the exact release-candidate commit has all required gates green, including:

- the mechanical, building-plan and site-drawing production workflows in the [CAD programme](product/cad-completeness.md), not merely the currently tested command subset;
- the configured Chromium, Firefox and WebKit acceptance journeys in hosted CI;
- live Demo, Docs, search and API deep-link checks against the deployed candidate;
- npm provenance, GitHub artifact attestation, SBOM and checksum verification from the real release run.

The isolated packed artifact already installs and compiles the Vanilla TypeScript, React and Vue consumers locally. The DXF gate also has pinned ezdxf 1.4.4 cross-implementation evidence for the published subset. Both must continue to pass in candidate CI, but they no longer represent missing repository evidence.

Governance policy and release/security responsibilities are documented. A second authorized backup maintainer is still an operational continuity risk that must remain visible before promotion.

The [route to a dependable CAD foundation](product/roadmap-to-core.md) orders the remaining product work and defines user-level acceptance for each stage. GitHub push authorization resumed on 2026-09-09; source commits, deployed pages and npm releases still require separate verification. See the [README and Agent context acceptance](product/readme-agent-context-2026-09-09.md) for this update.

## Exact product boundary

| Area | Current contract | Boundary |
| --- | --- | --- |
| **KJD documents** | Canonical object graph, validation, transactions and revisions | Future schema changes require migration fixtures and compatibility notes |
| **KJP projects** | Multi-drawing ZIP64 package, integrity hashes, snapshots and journals | Browser download/reopen proves artifact portability; native durable replacement/fsync belongs to the selected host provider |
| **2D editing** | Declared combinations for creation, transforms, arrays, offset, break, explode, trim/extend, chamfer/fillet, selection and grips | Not every entity pair or desktop-CAD interaction is implemented |
| **DXF** | Bounded ASCII adapter for the published entities, resources and target labels | Not binary DXF, arbitrary-file losslessness or universal cross-application certification |
| **DWG** | No public backend | Explicitly outside KJDraw 1.0 |
| **Workbench** | Bilingual multi-drawing reference UI for open, inspect, draw, edit, review, save, reopen and undo | The renderer covers the demonstrated profile, not every stored CAD semantic |
| **Rust/WASM** | Document authority, geometry predicates and specified mesh operations | JavaScript/TypeScript reference paths remain explicit; absence of WASM is never reported as Rust authority |
| **3D** | Experimental meshes, primitives, transforms and bounded box booleans | No general BRep, curved topology, healing or arbitrary robust boolean claim |
| **Agent commands** | Review-bound plan/execute protocol, receipts and undo | Host owns identity, authorization, model isolation and durable audit storage |
| **Plugins** | Cooperative permissions, declared contributions and version compatibility | Hostile-code isolation requires a separate process or sandbox |
| **Plotting** | Document model stores selected layout, viewport and plot metadata | No complete font/layout fidelity or device-certified PDF/printing pipeline |
| **Deployment** | Browser-local default plus explicit desktop, self-hosted, cloud-assisted and hybrid provider contracts | KJDraw does not ship tenancy, collaboration, managed cloud or authentication services |

## DXF interpretation

The public target labels are R14, 2000, 2004, 2010, 2013, 2018 and 2024; 2018 and 2024 both map to AC1032. R12 is a controlled legacy-import path rather than a 1.0 output promise. The repository corpus proves the exact fixtures and invariants it runs—header family, supported entities/resources, stable handles and semantic reopen—not all files created by those CAD releases.

Unsupported known exports should reject instead of silently discarding content. Preserve original source files and use KJP as the editable project format while evaluating DXF interoperability.

## Data and network behavior

The public workbench processes opened files in the browser and has no analytics or implicit drawing upload. Normal page and documentation hosting still use HTTP. A remote project, compute or scene provider runs only when an embedding host registers and invokes it; the host is responsible for credentials, policy and disclosure.

Input budgets reduce accidental or adversarial resource exhaustion but are not a complete security sandbox. Review [SECURITY.md](../SECURITY.md), [SECURITY_ARCHITECTURE.md](../SECURITY_ARCHITECTURE.md) and the [1.0 scope](1.0-scope.md) before production use.
