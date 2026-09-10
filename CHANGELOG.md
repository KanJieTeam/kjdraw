# Changelog

## 1.0.0-rc.2 — 2026-09-08

- Added a public editor API and lifecycle-safe React/Vue components with real framework types.
- Added a reusable Canvas renderer and four editable industry sample drawings, including architectural model-unit verification and DXF round-trip tests.
- Reorganized the demo into a CAD ribbon, left layer panel, right Properties/Agent tabs and a five-drawing sample library.
- Replaced the API landing page's declaration dump with editor examples, options, methods and events; retained full declarations in a separate reference.
- Added bilingual task guides and updated README examples for Vanilla TypeScript, React and Vue.
- Fixed input-field keyboard isolation, repeated sample creation, camera bounds and editor cleanup.
- Added the pinned DXF audit requirements file required by `setup-python` caching on clean GitHub runners.
- Limited push CI to branches so an annotated release tag does not duplicate the exact branch run.
- Regenerated runtime, declarations and API documentation from the corrected candidate version.

## 1.0.0-rc.1 — 2026-09-08

- Completed strict TypeScript source ownership for every public SDK runtime module and added reproducible ESM/declaration drift gates.
- Added isolated packed-package compilation for Vanilla TypeScript, React and Vue, plus a zero-service CLI for KJD/KJP/DXF inspection, validation and conversion.
- Added the TypeScript plugin starter and executable compatibility lifecycle covering permissions, activation, a real transaction and disposal.
- Hardened Agent plans with Web Crypto SHA-256 binding over canonical exact arguments and complete document content, replay protection, expiry and fail-closed concurrent consumption.
- Added configurable KJD, DXF and KJP resource budgets and abort handling.
- Reworked large-document transactions around structural sharing and added an enforced synthetic 10,000-entity performance budget.
- Added pinned ezdxf 1.4.4 bidirectional interoperability evidence for the published ASCII DXF subset alongside the seven-version synthetic corpus.
- Rebuilt the browser launch journey around a large original engineering drawing, natural-language diff, explicit approval, atomic receipt, KJP fingerprint reopen and undo.
- Added repository-owned Chromium/Firefox/WebKit journeys, generated API reference/search/deep links, governance/support policy, issue forms, SBOM/checksum generation and artifact-attestation workflows.
- Rewrote the bilingual project home, capability/status pages and 1.0 release notes around the testable product contract rather than raw repository counts.

Stable promotion remains pending the external gates in the [1.0 acceptance matrix](docs/KJDRAW_1_0_ACCEPTANCE_MATRIX.json). Release notes: [1.0.0-rc.2](docs/releases/1.0.0-rc.2.md).

## 0.7.2-preview.1

- Rebuilt the public demo as a full-height, familiar CAD workbench instead of a marketing landing page.
- Added automatic Chinese/English UI selection with an explicit language switch.
- Added real React hook and Vue composable integration examples.
- Added npm package assets to tagged GitHub releases and tightened release-to-commit binding.

## 0.7.1-preview.1

- Published the zero-runtime-dependency SDK to npm as `@kanjieteam/kjdraw`.
- Verified installation and the executable quickstart from a clean registry consumer directory.

## 0.7.0-preview.1

- Added an SDK-native agent plan registry that binds review to exact arguments, document identity, revision and fingerprint.
- Added host-controlled expiry, reviewer identity, rejection and one-shot consumption with replay protection.
- Exposed the binding digest in the real browser workbench and documented the enforced protocol boundary.
- Added a publishable npm package layout, executable package self-import quickstart and guarded manual npm publishing workflow.
- Migrated the new Agent plan module as the second TypeScript-owned source slice.

## 0.6.0-preview.1

- Began the real TypeScript source migration with the deployment Provider vertical slice.
- Added typed project-store, compute and scene-provider contracts in the authoritative source.
- Added a dependency-free TypeScript-to-ESM build and CI parity gate while retaining zero-install browser execution.
- Added release version alignment tests and a documented migration policy for remaining SDK modules.

## 0.5.0-preview.1

- Added an original, redistributable ASCII DXF corpus across every declared R14–2024 target label.
- Added a machine-readable corpus audit with per-file SHA-256, header verification, entity/resource invariants and semantic read/write/reopen checks.
- Added the corpus as a dedicated CI gate and public compatibility evidence page.
- Aligned the SDK package and runtime-reported preview version with the repository release.

## 0.4.0-preview.1

- Added real multi-drawing project tabs, drawing creation and packaged project snapshots to the browser workbench.
- Added Shift multi-selection with group move/copy/rotate/delete behavior.
- Added Grid and Ortho drafting controls and status feedback.
- Added nested block-insert rendering for supported public entity geometry.
- Extended real-browser QA across the new project and drafting workflows.

## 0.3.1-preview.1

- Repositioned KJDraw as extensible, deployment-neutral CAD infrastructure: browser-native, server-accelerated and deployable locally, self-hosted or cloud-assisted.
- Added executable project-store, compute and scene-provider contracts with validated deployment profiles.
- Added capability, deployment, security and open-source-boundary documentation.
- Removed downstream domain-family definitions from the public product contract and strengthened release leakage checks.
- Rebuilt the English and Chinese project narrative around verified capabilities and an explicit commercial boundary.

## 0.3.0-preview.1

- Expanded the browser playground into a usable general CAD workbench with DXF/KJD/KJP open and drag-drop, common drawing and modify tools, measurements, layers, property editing and a command bar.
- Added broader 2D entity rendering and a continuously deployed GitHub Pages demo.
- Added TypeScript declarations, a TypeScript authoring entry and strict migration configuration while retaining browser-compatible ESM.
- Updated the project contact to `kanjieteam@163.com`.

## 0.2.0-preview.1

First standalone developer preview of KJDraw. The SDK retains its existing 0.2.0 API baseline.

- Extract the framework-independent SDK and dependency-free Rust/WASM kernel.
- Add a browser-local playground using the public SDK and original synthetic drawings.
- Demonstrate plan, user confirmation, revision-bound commit and undo for an agent-origin move.
- Add bilingual project documentation, public capability boundaries and contribution guidance.
- Provide cross-platform SDK CI, Rust/WASM build checks, static-site output and a downstream versioning policy.

This release does not certify DWG, complete DXF fidelity, CAD plotting, or general BRep. Existing Kanjie application functionality is not automatically part of this public preview.
