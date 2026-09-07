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

- Domain-specific engineering compilers, calculations and decision rules.
- MDB/ACCDB field mappings, report knowledge and historical case corpora.
- Customer projects, organization data, private services and operational configuration.
- Proprietary or third-party templates, title blocks, symbols, fonts and compatibility assets.
- Enterprise identity, authorization, billing and managed hosting implementations.

The boundary is about implementation and data, not favoritism: official and third-party extensions use the same public SDK contracts. A downstream product may provide local, self-hosted or cloud services through explicit providers without making those services part of KJDraw Core.

## Contribution rule

Public changes must use synthetic or clearly redistributable fixtures. Never copy an entire downstream checkout or its Git history into this repository. Shared fixes land here first, pass public release gates, receive a version, and are then consumed downstream as a pinned dependency.
