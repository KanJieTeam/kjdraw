# Executable geometry checks — 2026-09-10

`validateDrawingGeometry` and the model-neutral `cad_check_geometry` tool measure actual document entities at an exact revision. They return actual values, supplied expectations, absolute errors, tolerances and individual pass/fail results. Supported checks are native 3D LINE length, intrinsic CIRCLE radius, supported entity point distances in the same owner space, and a canonical polyline closed flag with valid vertices. The public SDK exports `/drawing-validation` with strict TypeScript declarations.

Checks are read-only, bounded to 64 requirements, and reject stale revisions, unit mismatches, unsupported references, cross-space distances, nonfinite values and accessor-bearing inputs. A failed requirement returns a successful tool read with `passed: false`; it does not create an edit or approval receipt. Closure is not a proof of topology, and expected values/tolerances supplied by a model are not automatically the user's intended design constraints.

The conversation displays a structured geometry card independently of model prose. It shows the measured revision, drawing units, actual values, expected values and tolerances, including failures. It is evidence for the supplied checks at that revision, not certification of the complete drawing.

Validation performed:

- Seven core cases cover native 3D measurements, tolerance boundaries, MOVE/undo/redo, owner and plane restrictions, malformed inputs, bounded vertex inspection and real SDK DXF save/reopen.
- Five tool integration cases and the 47-case model adapter suite passed. All four protocol fixtures read real object IDs, execute a failing geometry check and receive the actual failed result. Fixtures do not call live external models.
- The complete SDK run passed 471 of 472 cases; the remaining isolated npm installation case initially could not access the local npm executable under the sandbox. It passed when rerun with access to the installed npm and local dependency cache. This run also included six tests for a separately developed HATCH sampler; renderer integration is outside this increment.
- One focused Chromium case passed: a real 10 mm LINE checked against 12±0.01 mm remains Failed even when the synthetic model response claims success. Document revision and KJP save/reopen payload remain unchanged. The 1440 px screenshot was inspected. No local three-browser matrix was run.
- Strict declarations, isolated JavaScript/TypeScript consumers, generated bilingual documentation/API reference and repository link/export checks passed.

These checks provide a measurable foundation for drawing-quality benchmarks. They do not establish token savings, live-model speedups, complete complex-drawing generation or stable 1.0 readiness.
