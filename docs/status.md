# Developer preview: capability boundaries

The SDK is provider-neutral. Browser-local operation is the verified public default; desktop-local, self-hosted, cloud-assisted and hybrid profiles are explicit host integration contracts. This release does not ship identity, tenancy, collaboration or managed cloud services. Registering a provider never starts network activity by itself.

| Area | Current state | Still needed |
| --- | --- | --- |
| KJD documents | Object graph, validation, transactions, revisions | Long-term migration policy and wider compatibility corpus |
| KJP projects | Pack/open, hashes, snapshots and journals | Crash-injection and durable native file delivery verification |
| 2D editing | Declared entity combinations for transforms, offsets, trim/extend, etc. | Full interactive tool coverage, constraint behavior and UX |
| DXF | Development ASCII adapter, core entities, resource tables and a public 7-version synthetic corpus | Broad independent cross-application certification |
| DWG | No supported backend | Independently verified read/write implementation |
| Browser viewer | Lines, circles/arcs, points, straight polylines, simple text and nested supported block geometry | Bulge polylines, full text/font fidelity, complete hatches, dimensions and layouts |
| Rust/WASM | Primitive queries and document sessions | Complete topology/edit authority |
| 3D | Experimental meshes, primitives and box booleans | General BRep, curved topology, robust general booleans and healing |
| Agent commands | Plan/execute envelopes and revision checking | Host identity, approval binding, model integrations and isolation |
| Plugins | Registries, permissions and version declarations | Strong isolation and broader compatibility tooling |
| Plotting | SDK can store some layout/plot metadata | A certified layout/viewport/PDF/printing pipeline |

## DXF detail

The adapter declares R14, 2000, 2004, 2010, 2013, 2018 and 2024 labels. The last two use AC1032. Every declared label now passes the public [synthetic corpus gate](dxf-compatibility.md), including header verification and semantic read/write/reopen checks. This remains evidence for the exact tested subset, **not a broad certification claim**. R12 is a controlled legacy path; AutoCAD 2007/AC1021 is absent from the inherited target contract. Changing that policy should be discussed with a compatibility fixture.

Known limits include binary DXF, complete layout-object metadata, some opaque/object records, fonts and complex resource behavior. Unsupported export operations reject in known cases, but the adapter is not a proven arbitrary-CAD lossless converter. Keep originals and use KJP for internal editing. The private source repository's historical asset-corpus counts are not public release certification evidence.

## Browser and scale

The playground is a minimal Canvas 2D SDK client. It does not advertise WebGPU, a 200,000-entity rendering guarantee, offline PWA installation or a complete desktop CAD. File bytes remain in the browser; initial page hosting and explicit external documentation links still involve normal HTTP requests.
