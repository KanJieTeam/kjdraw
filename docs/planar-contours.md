# Native planar contour operations

This source feature adds closed line/arc contour offsets and two-region union,
intersection and difference. It is tracked in [Issue #8](https://github.com/KanJieTeam/kjdraw/issues/8).
It requires the contour WASM asset included with this source build; an older npm
release does not include these APIs.

The kernel uses pinned Cavalier Contours Rust code. Circular segments remain
native DXF bulges, including input arcs larger than a semicircle, which are split
into exact circular segments. Offset corners use round joins. Computation uses
floating point coordinates and an explicit absolute tolerance, not symbolic
arithmetic.

## Compute without changing a drawing

```js
import { computePlanarContours } from '@kanjieteam/kjdraw/planar-contours'

const circle = {
  closed: true,
  vertices: [
    { point: [-5, 0, 0], bulge: 1 },
    { point: [5, 0, 0], bulge: 1 },
  ],
}
const result = await computePlanarContours({
  operation: 'offset', contours: [circle], distance: 2, tolerance: 1e-7,
})
// result.area ~= PI * 7 * 7; result.contours contains native circular arcs.
```

Positive distance expands a filled region; negative distance erodes it. A result
can contain several exterior rings and holes, or be empty after erosion. Output
exteriors are counterclockwise with positive signed area; holes are clockwise
with negative signed area. `area` is their signed sum. A single input ring may
have either winding. Multi-ring offset input uses counterclockwise exteriors
and clockwise holes, whose boundaries must not touch or intersect. Boolean
operations accept exactly two simple closed contours, with either winding;
`difference` means the first region minus the second.

## Preview, apply, undo and reopen

```js
import { previewPlanarContourEdit, applyPlanarContourEdit } from '@kanjieteam/kjdraw/planar-contours'

const request = {
  operation: 'offset', ids: [sourceEntityId], distance: 2,
  units: document.toJSON().header.units, expectedRevision: document.revision,
}
const preview = await previewPlanarContourEdit(document, request)
// Display preview.contours and preview.area for the user to review.
const applied = await applyPlanarContourEdit(document, {
  ...request, expectedGeometryDigest: preview.receipt.geometryDigest,
})
await document.undo()
await document.redo()
```

Preview changes neither drawing contents nor history. Apply preserves every
source object and creates result LWPOLYLINEs in one transaction. `sourceIds` and
`resultIds` identify that relationship; each result also records its source IDs,
operation and geometry digest. An empty result creates no entities, revision or
undo entry. A changed revision, source or reviewed geometry refuses the commit.

`CONTOUROFFSET` and `CONTOURBOOLEAN` expose the same operation through
`sdk.executeCommand`. Pass `expectedRevision` both in command arguments and the
execution context, as well as explicit drawing units. The existing `OFFSET`
command retains its single-result behavior.

KJD saves the native geometry and source metadata. DXF exports each ring as a
closed bulged LWPOLYLINE and preserves winding; DXF does not encode the KJDraw
receipt or source-ID relationship. Reopened geometry can be selected and used
for another operation.

## Supported input and limits

The document API accepts live XY `CIRCLE` and explicitly closed `LWPOLYLINE`
entities with zero widths and thickness, zero elevation and normal `[0, 0, 1]`.
Sources must have the same owner and drawing style and a visible, thawed,
unlocked layer. Non-XY geometry, open contours, self intersections, fitted
polylines and degenerate segments are refused before a commit.

The public API bounds requests to 64 rings and 4096 total vertices, and results
to 256 rings and 32768 total vertices,
coordinates and distances to absolute value `1e9`, and bulges to `1e6`.
Nonzero bulges with absolute value below `1e-8` are refused because the pinned
upstream kernel classifies them as lines regardless of the requested tolerance.
Tolerance defaults to `1e-7` drawing units and must be between `1e-9` and `1e-2`.
Choose a tolerance appropriate to the coordinate scale and drawing units.
Inputs and outputs are also checked for numerically resolvable derived arc
radii. A radius whose floating point error bound exceeds the requested
absolute tolerance is refused, even when its vertices fit the coordinate
budget. This prevents an unresolved shallow arc from being reported as a
successful empty result.
The JSON boundary preserves the input floating point values. Input coordinate
localization must be exact; output coordinate changes share one accumulated
native boundary error budget. Returned areas use the actual final vertices.
For document operations, the caller's tolerance covers both CIRCLE endpoint
conversion and the backend operation. Receipts expose `sourceBoundaryError`
and the remaining `backendTolerance`; compute-only receipts have zero source
conversion error. A remaining budget below the minimum tolerance is refused.
Inexact CIRCLE conversion is supported only for a single-circle offset.
Boolean operations and multi-source offsets refuse inexact CIRCLE conversion,
because a small source change can amplify near a tangency. A single-circle
erosion also refuses an ambiguous disappearance within the source error bound.
Geometry whose accumulated boundary rounding exceeds the budget is refused.
Unsupported or over-budget results fail explicitly; no polygon approximation
is substituted.

The default WASM asset is resolved relative to the SDK module in Node and in
direct browser ESM. Bundler integrations should supply `wasmUrl` for a copied
asset or `wasmBytes` from their own asset pipeline. The import itself does not
fetch or instantiate the kernel. Neither the SDK nor this module requires a
remote geometry service.

Script bundles such as IIFE can mount the editor without loading WASM. When a
contour operation is requested, pass `wasmBytes` or a `wasmUrl` for the asset
copied by your build. Relative URLs in a script bundle resolve against the
page's base URL; direct ESM continues to use its module URL. Missing bundle
configuration refuses the contour request before changing the drawing.

For registered commands, configure the asset on the **host SDK**, then pass that
SDK to the editor or workbench. `CONTOUROFFSET`, `CONTOURBOOLEAN` and
`CONTOURBOUNDARIES` use this same configuration through SDK calls, UI command
envelopes and host-confirmed AI envelopes:

```js
import { createKJDrawSDK, createKJDrawEditor, previewPlanarContourEdit } from '@kanjieteam/kjdraw'

const sdk = createKJDrawSDK({
  contourBackend: { wasmUrl: '/assets/kjcontour.wasm' },
  // Alternatively: contourBackend: { wasmBytes: localUint8ArrayOrArrayBuffer }
})
const editor = createKJDrawEditor('#drawing', { sdk, document: 'blank' })
await editor.ready

const drawing = editor.document
const request = {
  operation: 'offset', ids: [sourceEntityId], distance: 2,
  units: drawing.toJSON().header.units, expectedRevision: drawing.revision,
}
const preview = await previewPlanarContourEdit(drawing, request, sdk.contourBackend)
// Present the preview before executing the command.
await editor.execute('CONTOUROFFSET', {
  ...request, expectedGeometryDigest: preview.receipt.geometryDigest,
})
```

`contourBackend` is selected once at SDK construction and accepts either local
bytes or a URL. The SDK copies supplied bytes and URL objects; its read-only
getter returns a detached copy for preview calls. The host must supply the
configuration again when creating a new SDK after reopening a saved drawing.
WASM assets and URLs are not stored in KJD, DXF, command arguments or AI plans.
Existing command revision, preview digest and AI approval checks still apply.
AI integrations can use the command envelope protocol; this does not add new
tools to the agent tool catalog.

For a standalone workbench, use `new KJDrawWorkbench(host, { sdk })` from
`@kanjieteam/kjdraw/workbench`. Direct compute/apply functions still accept their
own backend options. An SDK without `contourBackend` uses the existing default
asset in Node and direct browser ESM; an IIFE command without an asset refuses
atomically. Explicit assets retain the loader's existing instantiation behavior;
this option does not change kernel caching or geometry calculations.

## Build and verification

With Rust 1.88+ and its `wasm32-unknown-unknown` target installed:

```sh
node scripts/build-contour-wasm.mjs
node --no-warnings scripts/build-typescript.mjs
node scripts/build-declarations.mjs
node --test tests/planar-contours.spec.mjs
npx playwright test tests/browser/planar-contours.spec.mjs
node examples/planar-contours.mjs work/planar-contours-example
```

The committed Rust lock file pins the kernel dependencies. The SDK asset
directory includes third-party notices and build provenance. Verification uses
analytic geometry, native arc checks, transaction history and fresh-instance
KJD/DXF reopening. Local drawing corpus results are separate compatibility
evidence; a successful offset does not imply that every entity in an imported
drawing can be edited or exported without loss.

The example creates an annular region from two circles, then expands it by
5 mm: the exterior radius changes from 50 to 55 mm and the hole from 20 to
15 mm. It saves editable KJD, native DXF and the operation receipts. All source
circles and intermediate rings are retained so their IDs can be inspected.
