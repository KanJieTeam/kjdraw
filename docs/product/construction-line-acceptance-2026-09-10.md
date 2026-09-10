# Construction-line direction preview — 2026-09-10

After placing the first point, moving the pointer previously rendered an infinite XLINE preview. Although no entity was committed until the second point, the cross-screen line appeared to be a completed object. The shared drafting session now returns a finite LINE guide while collecting the direction. Confirming the second point still creates a native XLINE or RAY, preserving the intended infinite geometry. The playground also resets the preview cursor to the newly accepted point instead of retaining an older pointer position.

Regression coverage checks tool activation, first-point collection, finite preview types, unchanged entity counts, Escape cancellation, one committed XLINE and undo/redo. Shared-core tests cover both XLINE and RAY, exact preview endpoints and cancellation. Node 22 and Node 24 each passed 408 tests before the user requested deferring repeated full-browser matrices. The ongoing three-browser run was stopped at that request; it is not reported as a complete pass. Final multi-browser acceptance remains deferred until the user confirms the accumulated changes.

No file schema, line length or committed construction-line semantics changed. This is a first-point preview fix, not conversion of construction lines into finite geometry. The previous main commit's unrelated workbench/form CI failure remains a separate fix.

The focused Chromium construction-line regression passed on the final source: tool selection and the first click do not create entities; the direction preview contains LINE and no XLINE; the second click creates one undoable XLINE. Source commit: `2cea213`.
