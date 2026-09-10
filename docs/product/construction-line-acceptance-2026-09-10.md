# Construction-line direction preview — 2026-09-10

After placing the first point, moving the pointer previously rendered an infinite XLINE preview. Although no entity was committed until the second point, the cross-screen line appeared to be a completed object. The shared drafting session now returns a finite LINE guide while collecting the direction. Confirming the second point still creates a native XLINE or RAY, preserving the intended infinite geometry. The playground also resets the preview cursor to the newly accepted point instead of retaining an older pointer position.

Regression coverage checks tool activation, first-point collection, finite preview types, unchanged entity counts, Escape cancellation, one committed XLINE and undo/redo. Shared-core tests cover both XLINE and RAY, exact preview endpoints and cancellation. Node 22 and Node 24 each passed 408 tests before the user requested deferring repeated full-browser matrices. The ongoing three-browser run was stopped at that request; it is not reported as a complete pass. Final multi-browser acceptance remains deferred until the user confirms the accumulated changes.

No file schema, line length or committed construction-line semantics changed. This is a first-point preview fix, not conversion of construction lines into finite geometry. The previous main commit's unrelated workbench/form CI failure remains a separate fix.

The focused Chromium construction-line regression passed on the final source: tool selection and the first click do not create entities; the direction preview contains LINE and no XLINE; the second click creates one undoable XLINE. Source commit: `2cea213`.

## Native interchange and viewport clipping

The follow-up replaces an arbitrary origin-centered rendering span with the actual viewport intersection. Distant XLINE origins and inward-facing RAY origins remain visible; outward rays and parallel lines outside the viewport are culled. Dash phase remains anchored to the origin. This does not change finite geometry or document history.

The DXF adapter now reads and writes native XLINE/RAY for the supported 2000–2024 targets. Export normalizes finite directions without overflowing for large vectors. Invalid input directions retain raw tags and a proxy diagnostic. R12/R14 targets reject the unsupported downgrade. Existing unsupported-entity export rejection remains tested with a custom entity.

Validation: 43 targeted core tests passed; strict TypeScript passed. The Chromium viewport test passed at DPR 1 and 2, measuring actual pixels after DXF reopening, pan and zoom, checking hit selection and unchanged source serialization. The independent ezdxf 1.4.4 audit passed four native lines across model/paper/block spaces, 3D direction and ray sense, styles, insert preservation, move/rotate/undo/redo and zero audit errors or fixes. The audit is included in CI. Full browser acceptance is still deferred by the user's instruction; this is not a stable 1.0 release gate result.

## Fit view with distant guides

A separate regression reproduced a finite 100 × 40 detail shrinking from scale 5.44 to 0.000272 after adding guides with origins at ±1,000,000. Fit now measures finite geometry independently of XLINE/RAY origins, including nested blocks. With only unbounded geometry, it centers the first visible guide origin and keeps the current zoom. Hidden block children do not contribute to fit bounds.

Validation: all 14 renderer core tests passed, including nested guide-only blocks, unchanged document/history, responsive fitting and the guide-only fallback. Both Chromium construction-line tests passed: DPR 1/2 pixels after DXF reopen and navigation, plus opening a real DXF in the playground and clicking **Fit view**, which keeps the finite detail over 400 pixels wide. Strict TypeScript and generated declarations passed. Full multi-browser acceptance remains deferred.

## Reviewed AI moves of guides

`cad_propose_move` now accepts visible editable model-space XLINE/RAY objects. The isolated preview and the approved core MOVE preserve direction vectors and Z coordinates. Creation tools retain their existing entity scope. Hidden, locked, paper-space and stale selections remain rejected. Rejection and preview leave source history untouched; approval is single-use and the resulting move supports undo/redo and native DXF reopening.

Validation: 79 related core/plan/query/adapter tests passed, including four offline protocol conversations that read guides, propose a move and stop for host approval. All three Chromium agent-preview tests passed; the new case measures a distant construction line's temporary overlay, removal, committed pixels and undo. These are executable tool and protocol checks, not live-model complex drawing acceptance. Strict TypeScript passed.
