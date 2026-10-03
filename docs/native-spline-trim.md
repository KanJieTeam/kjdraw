# Native SPLINE break and trim

`BREAK` and `TRIM` retain native control-point SPLINE geometry. They insert
knots in homogeneous coordinates and keep the degree, rational weights and
original knot parameter domain. Results are SPLINE entities, not sampled
polylines. The mathematical subdivision uses native NURBS knot insertion;
the implementation uses bounded floating point arithmetic.

## Break at a native parameter or curve point

```js
const pieces = await sdk.executeCommand('BREAK', {
  id: splineId,
  parameter: 0.5,
  tolerance: 1e-7,
}, { document, expectedRevision: document.revision })
```

`parameter` is a value in the source's native knot domain. It is not a length
fraction or an automatically normalized value. `parameters: [first, second]`
removes the intervening interval and retains the two outside pieces; input
order does not reverse source direction. Both cuts must be resolvable and
strictly interior. Alternatively, pass `point`, or `points: [first, second]`,
with points on the source curve within tolerance. Do not mix points and
explicit parameters. A point occurring on several parameter branches is
refused; select its native parameter explicitly.

The leading result keeps the original ID, handle, owner, extension and source
record. The trailing result uses the existing derived-entity convention:
the original owner, name and extension plus `derivedFromId` and
`derivedFromHandle`. Both preserve non-geometric payload fields. Persistent
group and saved-selection memberships include both results. Unsupported
associative dimension references are not invented or rebound; existing
document and command validation remains enforced.

## Trim the picked native interval

```js
await sdk.executeCommand('TRIM', {
  id: splineId,
  boundaryIds: cuttingEntityIds,
  pickPoint: [x, y, 0],
  tolerance: 1e-7,
  // pickParameter: 0.5, // required if the point has multiple branches
}, { document, expectedRevision: document.revision })
```

For a SPLINE target, boundaries may be LINE, RAY, XLINE, CIRCLE, ARC, ELLIPSE
or another supported SPLINE. Finite boundary domains are honored. The existing
native intersection query supplies candidate locations; a rational Bezier
control-hull interval search recovers every matching target parameter. A
sampled nearest-point query is not used to select a destructive cut.

The interval containing the pick is removed, and every remaining outside
interval is retained in source parameter order. A pick must lie on the curve;
`pickParameter` resolves multiple branches and must match the pick point.
Picks on a cutting boundary, overlaps, tangent or uncertain intersections,
corner contacts and unresolved nearby cuts are refused. Recovered cuts are
also checked against the actual finite cutting boundary within the requested
absolute tolerance. Trimming must retain at least one nonempty native piece.

The primary result keeps its original identity. Derived results and membership
updates use the same conventions as BREAK. Each successful command is one
transaction and one undo entry. Layer editing policy and expected revision
remain enforced; failures keep drawing state and undo/redo unchanged.

`breakEntityPayloads` and `trimEntityPayloads` provide pure geometry previews.
The latter accepts an optional fourth argument `{ tolerance, pickParameter }`
for SPLINE targets. Existing other-curve behavior is unchanged. This addition
is a SDK geometry/command feature; the existing boundary-edit UI retains its
current target and boundary restrictions.
Standard Agent proposal tools do not expose BREAK or TRIM; this SDK addition
does not grant models new write permissions or bypass host approval.

## Supported representation and precision

- Complete explicit controls and knots, clamped at both ends; degree 1–8,
  `degree + 1` to 256 controls, weights from `1e-12` to `1e12` with a ratio
  at most `1e8`. The absolute weight bound prevents homogeneous underflow.
- Open, nonperiodic XY geometry at zero elevation, with absent normal or
  `[0, 0, 1]`. Closed/periodic flags, fit-only data, mixed fit/control data and
  fit tangents are refused rather than rewritten.
- Nondecreasing finite knots with resolvable spans and interior multiplicity
  no greater than the degree. Original knot values are retained.
- Coordinates and native parameters within absolute value `1e9`; tolerance
  `1e-9` to `1e-2` drawing units, default `1e-7`; at most 64 boundaries.
- Constant/tolerance-sized spans, tiny retained pieces, unresolved weight or
  coordinate conditioning, exhausted interval budgets and ambiguous parameter
  branches cause explicit refusal. Large coordinates can require a looser
  tolerance; the absolute coordinate ceiling alone does not promise support.

KJD retains native geometry and source metadata. DXF exports native SPLINE
degree, controls, knots and weights. Both formats can reopen the retained
geometry and perform another native cut. DXF does not encode all arbitrary
KJDraw metadata. Independent tests use a recursive basis evaluator, analytic
rational circular arcs and a required ezdxf audit/evaluator; a missing ezdxf
environment is a test failure, not a skip. This feature does not add NURBS
offsets, fitted or periodic spline editing, or symbolic exact arithmetic.
