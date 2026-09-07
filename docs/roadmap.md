# Roadmap

The goal is extensible CAD infrastructure that engineering applications can embed, deploy anywhere and expose safely to AI agents. Offline-capable local operation remains a first-class profile, not the only architecture. Milestones are priorities, not delivery-date promises.

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
