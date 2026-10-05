# KJDraw contour WASM

This independent module uses **Cavalier Contours 0.9.0**, pinned by an exact
Cargo dependency and registry checksum in the workspace lockfile. Native
line and circular arc segments remain lines and arcs; no polygon
tessellation is used. It has no host imports or npm runtime dependencies.

Build with Rust 1.88 or later:

```sh
rustup target add wasm32-unknown-unknown
node scripts/build-contour-wasm.mjs
cargo test --locked --manifest-path runtime/kjcore-rs/Cargo.toml -p kjcontour-wasm
```

The script emits the SDK asset `src/assets/kjcontour.wasm` and a provenance
file with binary, input-source and bundled-license SHA-256 hashes. The old
KJCore module is unchanged.

## ABI version 1

- `kjcontour_abi_version()` returns `1`.
- `kjcontour_alloc(len)` allocates an owned UTF-8 request buffer; zero means
  allocation was refused. The caller writes into exported `memory`.
- `kjcontour_run(ptr, len)` returns zero on success and one on error.
- `kjcontour_result_ptr()` and `kjcontour_result_len()` expose the UTF-8 JSON
  result. Copy it before the next run or any operation that grows memory.
- `kjcontour_free(ptr, len)` releases a request allocation. Mismatched or
  stale buffers are rejected without reading unowned memory.

```json
{
  "operation": "offset",
  "contours": [[[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]]],
  "distance": 2,
  "tolerance": 0.0000001
}
```

Contours are implicitly closed. Each vertex is `[x, y, bulge]`, where bulge
belongs to the segment from that vertex to the next. Bulges larger than a
semicircle are split into exact circular arcs for the upstream algorithm.
Offset distance is positive outward from the filled region. A single
outline may have either winding; multiple offset boundaries require CCW
outer/island rings and CW holes, consistent with actual nesting. Touching,
intersecting and self-intersecting offset boundaries are rejected.

Boolean `union`, `intersection` and `difference` require exactly two simple
closed outlines. Difference subtracts the second outline from the first.
Input winding does not affect these filled regions. Output outer rings are
CCW and holes are CW. Each output has `vertices`, signed `area`, and `hole`;
the top-level `area` is the sum. Empty results are valid. Errors use
`{"error":"..."}` and are distinct from empty results.

Offsets have rounded outside joins. Miter and bevel joins, ellipses,
splines, variable-width paths and open contours are outside this contract.
Nonzero bulges smaller than `1e-8` are explicitly rejected because the
upstream library treats them as straight lines regardless of positional
tolerance; significant shallow arcs are never silently flattened.
Derived arc radii must also be representable at the requested absolute
tolerance (`radius * f64::EPSILON * 16 <= tolerance`). Large, shallow arcs
that cannot satisfy this bound are rejected explicitly rather than returning
an incorrect area or a false empty result. Boolean area classification uses
per-ring local Green integration and stable small-angle segment areas.
Independent offset regions are evaluated in separate local coordinate
groups; grouping uses expanded exact curve bounds so merging islands and
their holes still share one upstream shape operation.
JSON decimals use serde_json's `float_roundtrip` parser so caller f64 values
retain their bits before validation. Coordinate-frame changes use actual
TwoSum residual vectors and a native line/arc boundary-error bound, accumulated
across the output frame path of each region group. Input localization must be
exact: any source-frame rounding is refused before the algorithm because
near-tangent intersections or merging offsets can amplify source perturbations.
A small result
far from the world origin is refused when cumulative frame error would exceed
the requested absolute tolerance; exactly representable integer coordinates
remain supported.
Receipt areas are recomputed from the final world-coordinate vertices that
are returned and persisted, not from an earlier local intermediate.
The JSON adapter validates coordinate, tolerance, topology and allocation
bounds before invoking the algorithms and limits output contour/vertex
counts. The SDK also validates the public request and result contracts.

License terms for the distributed binary and its Rust build dependencies
are in `packages/kjdraw-sdk/src/assets/kjcontour-LICENSES.txt`. Cavalier
Contours is dual licensed MIT or Apache-2.0; this distribution retains its
MIT copyright and permission notice from upstream revision
`22887a824d22cd8ab50968a551f34cdb4508127f`.
