# Roadmap

The goal is extensible CAD infrastructure that engineering applications can embed, deploy anywhere and expose safely to AI agents. Offline-capable local operation remains a first-class profile, not the only architecture. Milestones are priorities, not delivery-date promises.

## From public RC to stable 1.0

The public RC is for evaluation, not a declaration that every engineering workflow is production-ready. The stable release depends on evidence in this order:

1. Keep the README, npm `next` package, Skill, CLI, browser AI page and optional pinned-source installer consistent. A first-time user must be able to create a review proposal, approve it, save the drawing and reopen the exact KJD/DXF output. The browser AI page must use a real user-selected model and label fixture-only demonstrations as fixtures.
2. Validate representative mechanical, architectural/site and geology drawings against redistributable source facts. A visual preview alone is insufficient: geometry, layers, annotations, hatches, dimensions and file reopen must be checked. Private customer drawings stay outside this repository.
3. Freeze the tool surface, task manifest, model settings and independent validators before a [three-arm, ten-round correctness study](benchmarks/multiround-correctness-protocol.md). Compare KJDraw with both a capable file-editing `ezdxf` agent and a declarative `ezdxf` compiler. Publish every attempt and failure; correctness and untouched-object preservation are primary, token use and time secondary.
4. Collect independent first-use results on clean systems and verify the exact release candidate across supported browsers and installation paths. The [release-readiness audit](../scripts/audits/release-readiness.mjs) records gates but cannot substitute synthetic fixtures or green CI for human acceptance.

Contribution work proceeds alongside these gates: expand scoped formatting/lint without a whole-repository rewrite, keep generated JS in sync until the pinned-source installer is migrated, and use the [domain planner starter](../examples/domain-planner-starter/README.md) as a first external extension. Public domain planners are still co-shipped with the core package; a future extraction must retain compatible exports and review semantics. Remote knowledge updates remain off unless a release can authenticate a signed manifest with a pinned verification key; bundled knowledge remains usable offline.

## First public preview

- Standalone, framework-independent SDK and buildable Rust/WASM sources.
- Working reference playground, synthetic samples and bilingual introduction.
- Public capability limits and release checks.
- Pinned downstream adoption by Kanjie.

## Make deployment composable

- Stabilize project-store, compute and scene-provider contracts.
- Supply reference local and self-hosted adapters without embedding accounts or tenancy in the CAD core.
- Define collaboration and remote-revision semantics on top of the existing command protocol.
- Test that browser-only builds make no implicit network requests.

## Make embedding dependable

- Move the SDK to TypeScript-first source with strict public types while continuing to publish browser- and Node-compatible ESM.
- Document the public API and provide focused Vue/React integration examples.
- Grow the playground into a product-shaped reference workbench with richer drawing tools, property editing, layers, measurements and a command bar.
- Publish the workbench continuously on GitHub Pages; keep the public deployment browser-local and every sample synthetic.
- Strengthen command-plan binding and clarify host security responsibilities.
- Add source-owned plugin examples and schema/version compatibility checks.
- Improve renderer coverage, picking, drafting interaction and accessibility.
- Publish registry packages once release ownership and workflow are established.

## Close engineering workflows

- Expand the shipped synthetic DXF version corpus with independent, redistributable cross-application fixtures.
- Improve dimensions, fonts, hatches, layouts and plotting.
- Verify local persistence and recovery under interruption.
- Add realistic, openly redistributable performance fixtures and multiple-device results.

## Grow an ecosystem

- Support third-party engineering data adapters and domain plugins.
- Integrate real model providers through host-owned approval workflows.
- Invite downstream maintainers into API and format decisions.
- Evaluate DWG and general 3D work separately; neither is a prerequisite for useful 2D embedding.
