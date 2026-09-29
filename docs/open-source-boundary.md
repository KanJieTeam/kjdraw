# Open-source boundary

KJDraw is the general-purpose CAD foundation maintained in this repository. Its public API, tests and examples must remain useful without access to Kanjie products, customer systems or proprietary engineering assets.

## Included here

- CAD documents, transactions, revision history and command envelopes.
- General geometry, selection, snapping, grips and editing operations.
- KJD/KJP project formats and the documented DXF subset.
- Rust/WebAssembly kernel bridges and reproducible build inputs.
- The generic browser workbench, deployment-provider contracts and synthetic examples.
- Extension points that let any domain build on the same public SDK.

## Maintained separately

- Private downstream engineering compilers, calculations and decision rules.
- MDB/ACCDB field mappings, report knowledge and historical case corpora.
- Customer projects, organization data, private services and operational configuration.
- Proprietary or third-party templates, title blocks, symbols, fonts and compatibility assets.
- Enterprise identity, authorization, billing and managed hosting implementations.

The boundary is about implementation and data, not favoritism: official and third-party extensions use the same public SDK contracts. A downstream product may provide local, self-hosted or cloud services through explicit providers without making those services part of KJDraw Core.

## Current package boundary

The 1.0 RC npm artifact still **co-ships** several public, synthetic domain planners (mechanical, geology, architecture, site and road) with the CAD engine. They are separate source modules that compile domain facts into ordinary, reviewable CAD commands; they are **not** geometry authority, and their presence does not mean every industry workflow is production-validated. Private downstream rules and customer knowledge remain outside this repository.

The public plugin contract, [generic command starter](../examples/plugin-starter/README.md) and [runnable domain planner starter](../examples/domain-planner-starter/README.md) are the current extension route. Extracting co-shipped planners into separately versioned packages is planned, not complete. Until a documented major-version migration, keep existing package exports, tool names, proposal/review behavior and file formats compatible; an extraction must leave forwarding entry points for existing users. A third-party planner should take explicit, validated facts, emit a bounded transaction through the public SDK, and test approval, undo and KJD/DXF reopen without privileged access to internal model state.

## Contribution rule

Public changes must use synthetic or clearly redistributable fixtures. Never copy an entire downstream checkout or its Git history into this repository. Shared fixes land here first, pass public release gates, receive a version, and are then consumed downstream as a pinned dependency.
