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

Every planned retained piece must satisfy the same representation and numeric
contract at the requested tolerance before the command commits. In particular,
an explicit cut very close to an existing knot can create an unresolvable knot
span and is refused atomically. Explicit parameters are never silently snapped
to another knot; choosing the exact existing native knot can avoid that new
span. Future requested cuts are still checked independently.

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
is available through the shared workbench controls: point BREAK, two-point
BREAK and TRIM retain native SPLINE pieces. Continuous boundary TRIM previews
the same native pieces before applying one undoable command. Workbench cutting
boundaries remain LINE/RAY/XLINE/CIRCLE/ARC; ELLIPSE/SPLINE boundaries and explicit
native parameters are SDK options. BREAK controls preserve the existing `0.1`
pick tolerance for non-spline targets and use `1e-7` for SPLINE. SPLINE retains
the supported `1e-9` to `1e-2` range; explicit values are validated rather than
replaced by defaults.

Hosts can pass `targetEntityType` to `buildKJModificationCommand`, or the target
type as the second argument of `getKJModificationDefinition`, to select the same
form defaults. Without a type hint or an explicit tolerance, BREAK controls
emit the serializable `toleranceMode: 'entity-default'` policy. The command
registry resolves it using the actual entity: `0.1` for existing non-spline
targets and the native `1e-7` default for SPLINE. An explicit tolerance always
takes precedence. Bare SDK commands without this policy retain their existing
defaults, including `1e-8` for non-spline BREAK. Unsupported policy values are
refused before changing the drawing.

Mouse picks within the existing nine-pixel hit aperture are projected onto
the selected native spline before certification. The core still recovers all
matching branches and rejects ambiguous points; it does not use the nearest
query's parameter to authorize a cut. Typed coordinates retain their exact
values and must lie on the curve within the requested tolerance.
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
