# KJDraw CAD completeness programme

The product target is an open-source CAD application kit that people can use for real drafting and developers can embed without rebuilding the application. A polished canvas, an entity schema, a command registration or a large export count is not a completed CAD feature.

## External baseline

Reviewed on 2026-09-08:

- [LibreCAD drawing manual](https://docs.librecad.org/en/latest/ref/tools.html): the main open-source 2D drafting workflow baseline.
- [QCAD reference](https://www.qcad.org/doc/qcad/latest/reference/en/qcad_reference_manual_en.html) and [edition-labelled feature list](https://www.qcad.org/en/documentation/features): construction, modification and production-drawing workflow references. QCAD Professional/CAM capabilities must not be presented as Community Edition features.
- [CurrentCAD product](https://home.currentcad.com/product/cad/): a commercial browser-CAD usability benchmark, not an open-source competitor. Its feature claims are vendor claims, not independently measured interoperability or performance results.
- [FreeCAD features](https://www.freecad.org/features.php): the broader parametric/3D ecosystem reference. FreeCAD's modelling, assembly and analysis scope is different from a 2D drawing workbench.

The supplied CurrentCAD gear-video URL returned HTTP 403 during review. The video has **not** been fully inspected; no workflow or performance claim below is attributed to its contents.

## Acceptance rule

Every feature needs a user-accessible operation, editable native geometry, cancel/error handling, undo/redo, file reopen verification, and the same capability in the embedded editor where applicable. “Core only” is a remaining implementation task, not a check mark. Status must be backed by an executable test or a named manual verification.

The following is the implementation baseline, not a claim that the listed work is already delivered. Newly implemented rows move to verified only after end-to-end tests. Global popularity is an outcome to earn after product quality, not a release test that can be asserted by the maintainers.

## Complete workstreams

| ID | Required workflow | Baseline gap / implementation work | Acceptance exercise |
| --- | --- | --- | --- |
| G01 | Point, line, ray, construction line | Unify the point-driven tools in hosted and embedded editors | Place exact coordinates; save and reopen |
| G02 | Unlimited open/closed polylines | Demo previously finished at three vertices; shared drafting session replaces this | Draw eight vertices, undo a vertex, close; verify segment count |
| G03 | Rectangle and regular polygon | Add polygon side count and inscribed/circumscribed construction | Draw dimensioned six-sided and twelve-sided profiles |
| G04 | Circle by center/radius, two points, three points | Add actual construction modes and degenerate-input checks | Verify radii and all defining points; reject collinear three-point input |
| G05 | Arcs by center/start/end and three points | Unify point order and signed sweep semantics | Minor/major and clockwise cases pass through the picked middle point |
| G06 | Ellipse by axes, elliptical arc | Remove hard-coded ellipse ratio; add true axes input; arc mode remains to integrate | Verify axis lengths, orientation and DXF geometry |
| G07 | Spline from control points | Renderer previously joined the control polygon; evaluate the curve and expose construction | Curve differs from control polygon and survives DXF/KJD reopen |
| G08 | Tangent/perpendicular constructions | General construction solvers and UI remain to implement | Construct tangent line/circle and check residuals |
| G09 | Hatch and solid fill | Boundary data exists; real patterns, islands and editing need complete UI/rendering | Fill profile with a hole; confirm no fill in the hole and correct scale |
| G10 | Single/multiline text | Complete height, rotation, alignment, content editing and multiline layout | Draw notes, edit in place and reopen without losing content |
| P01 | Absolute/relative/polar coordinate entry | Shared coordinate parser and point prompts | Mix `10,20`, `@25,0`, `@10<45` in one drawing |
| P02 | Endpoint/midpoint/center/intersection snaps | Core queries exist; expose mode selection and clear indicators consistently | Pick known geometry and assert exact resulting coordinates |
| P03 | Tangent/perpendicular/quadrant/grid snaps | Audit per-entity query coverage and integrate missing modes | Dedicated numeric tests plus mouse capture tests |
| P04 | Orthographic/polar tracking and distances | Add explicit tool options; avoid arbitrary dimensions | Constrain a direction and enter a distance |
| S01 | Single, Shift-multiple and select all | Shared add/remove and active-space editable selection are implemented | Modify precisely the selected set |
| S02 | Window/crossing/fence selection | Shared geometric queries and mouse workflows are implemented | Left-to-right contains; right-to-left crosses; open fence does not close itself |
| S03 | Grips and vertex editing | Visible endpoint, radius and vertex handles are implemented; advanced polyline insert/remove editing remains | Preview, cancel, drag and undo; preserve elevation |
| S04 | Layer/hidden/locked-object selection rules | Common editing-command layer protection and unlock/thaw UI are implemented | Locked objects cannot change through editing tools, transactional commands or agents; import transactions remain low-level |
| M01 | Move/copy with base point and drag | Implemented this iteration; gesture race/cancellation regressions under test | Switch document or revision mid-gesture; no unintended edit |
| M02 | Rotate/scale about chosen origin | Core exists; remove fixed-value-only toolbar behaviour | Rotate by a chosen angle around an explicit base point |
| M03 | Mirror with source retained/deleted | Core exists; complete axis picking and options | Mirror a profile and check handedness and source retention |
| M04 | Rectangular/polar arrays | Core exists; expose count, spacing, center and rotation options | Create a bolt circle and a repeated component grid |
| M05 | Offset of lines/circles/arcs/polylines | Core supports a bounded subset; complete UI and extend geometry coverage | Offset inner/outer boundaries by exact distance |
| M06 | Trim/extend | Core line-target implementation exists; add pick workflow and curved-target operations | Trim a mechanical profile against lines and circular boundaries |
| M07 | Fillet/chamfer | Core line-pair implementation exists; expose picked sides/parameters and expand geometry | Radius/tangency and setback tests plus visible undo |
| M08 | Break/join/explode | Some core operations exist; complete selection/point UI and joining semantics | Split and recombine a contour without accidental topology loss |
| M09 | Stretch/lengthen/polyline editing | End-to-end work remains | Edit one part of a profile without moving the rest |
| A01 | Linear/aligned dimensions | Native type exists but projection was incomplete; add construction and proper graphics | Dimensions include extension lines, arrows and measured text |
| A02 | Radius/diameter/angular dimensions | Add construction and correct DXF point codes; angular workflow remains | Verify a bore and arc dimensions before/after export |
| A03 | Leaders, styles and precision | Core data exists; full drafting control needs UI | Change style, scale and precision without changing geometry |
| L01 | Layers: create/current/rename/color/visibility | Hosted controls are ahead of embedded controls | Same layer tasks in Vanilla, React, Vue and Demo |
| L02 | Line type, lineweight, lock/freeze | Complete consistent properties and mutation rules | Edit/print with preserved layer attributes |
| B01 | Block create/insert/explode | Core block data/commands exist; usable block workflow remains | Create one reusable part and insert it at several transforms |
| B02 | Attributes and part library | Schemas are not a library/editor; build actual reusable assets and editing | Edit attribute values per insert and reopen |
| F01 | New/open/save/save-as/multiple drawings | Demo KJP and embedded DXF/KJD differ; converge project capabilities | Start empty, edit, save, reopen and switch without data leakage |
| F02 | DXF interoperability | Expand external fixture corpus and native entity coverage | Compare geometry, annotations, layers and blocks across independent readers |
| F03 | DWG input/output | No native DWG engine is established; implement an explicitly licensed provider path | Verify real DWG versions with a selected provider; never rename a DXF as DWG |
| F04 | Undo/redo/autosave/recovery | Core history and project store exist; complete product recovery experience | Recover after tab interruption and verify saved revision |
| O01 | Paper/model space, scale and print preview | Viewport data alone is insufficient; usable page setup remains | Produce an A3 drawing at a chosen physical scale |
| O02 | PDF/SVG/image output | Snapshot exists; vector production output needs implementation | Check lineweights, fonts, dimensions and plotted scale |
| U01 | Classic/Compact/Focus and navigation | Implemented this iteration; verify responsive canvas, control visibility and state preservation | Switch layouts mid-session, undo, save and reopen |
| U02 | Command prompts, help and keyboard | Replace silent no-ops and invalid defaults; shared typed tool flow | New user finishes a drawing using prompts, without source inspection |
| U03 | Bilingual UI/accessibility | Every new control/prompt needs both languages and keyboard access | Complete the same drawing in English and Chinese |
| E01 | Ready-to-use Vanilla/React/Vue editor | Existing adapters now gain layout updates; every new common tool must ship here | Install packed/registry package in isolated apps and draw immediately |
| E02 | Custom UI, tool/options/events APIs | Document stable high-level operations; keep internals out of the main guide | Host extends a command without copying the workbench source |
| E03 | Plugins and AI operations | Common command/history path exists; product integration still needs normal tool parity | Agent and human edits produce the same undoable geometry |
| Q01 | Large drawings and interaction latency | Establish a reproducible corpus, frame/selection/load/memory budgets | Publish hardware, fixture size and measured results |
| Q02 | File safety, malformed inputs and limits | Existing checks must cover new tools and adapters | Fuzz inputs, cancel large loads and verify resource bounds |
| Q03 | Distribution, provenance and documentation | Release checks exist; verify the exact artifact users install | Clean install, browser tests, hosted asset match and reproducible build |
| X01 | Parametric sketches, 3D solids/assemblies | Existing bounded solid operations are not a complete FreeCAD-class modeller | Separate solver/kernel/model-history programme with independent acceptance |

## Implemented in 1.0.0-rc.3

This delivery closes usable slices of the programme; it does not mark an entire workstream complete when part of that row is still missing.

| Area | Available in the Demo and shared editor | Evidence / remaining scope |
| --- | --- | --- |
| Construction | Point, line, ray, xline, rectangle, regular polygon, continuous open/closed polyline, three circle modes, two arc modes, three-point ellipse and control-point spline | `drafting.test.mjs`, `tests/browser/drafting.spec.mjs`; circumscribed polygons, elliptical arcs and tangent constructions remain |
| Exact input | Absolute, relative and polar coordinates; finish/close/undo-point/cancel | Draft validation, retry and bilingual UI tests; full tracking and snap-mode controls remain |
| Moving objects | Select-first or command-first move/copy, direct dragging, frozen gesture targets, preview and cancellation | `tests/browser/cad-workflow.spec.mjs`, `tests/browser/workbench.spec.mjs` |
| Selecting and reshaping | Directional window/crossing selection, open fence, add/remove/all selection, visible endpoint/radius/vertex grips | `spatial-selection.test.mjs`, `tests/browser/workbench-selection-grips.spec.mjs`, `tests/browser/playground-selection-grips.spec.mjs`; advanced topology and polyline insert/remove editing remain |
| Layer protection | Locked/frozen/hidden layers block editing commands atomically; unlock/thaw controls in both workbenches | `edit-policy.test.mjs` plus browser layer tests; direct import/migration transactions remain low-level data operations, not an authorization system |
| Editing | Parameterized rotate, scale, mirror, rectangular/polar array, offset, break/explode, line trim/extend and line-pair fillet/chamfer | `modification-controls.test.mjs` verifies all 12 controls and invalid input; broader curve targets, joining, stretch and block explode remain |
| Polyline decomposition | Exploding a polyline preserves its layer, drawing properties and planar elevation in the resulting native lines/arcs, through undo and file reopen | `explode-preservation.test.mjs` and the real-toolbar flow in `tests/browser/drafting.spec.mjs`; tilted extrusion and non-planar bulge arcs are rejected, not flattened |
| DXF drawing properties | Per-entity ACI/RGB color, named linetype, linetype scale, lineweight and visibility survive supported DXF round trips | `dxf-drawing-properties.test.mjs`; older DXF versions that cannot represent explicit RGB color or lineweight reject that downgrade |
| Annotation and fill | Aligned, rotated, radius and diameter dimensions; SOLID, ANSI31 and ANSI37 hatch construction | `annotation.test.mjs`, `hatch-pattern.test.mjs`; angular dimensions, complete styles and island-picking UI remain |
| Layout and navigation | Classic, Compact and Focus; Select/Pan/Fit/Zoom navigation; layout changes retain the mounted drawing and history | Three-browser UI tests include language changes and ribbon hit areas; complete layer/property editing remains |
| Developer integration | Same workbench in Vanilla TypeScript, React and Vue; reactive layout updates; typed drafting and modification APIs | Packed-package consumption, framework browser tests and the bilingual workbench guide |
| First-use demonstration | Empty millimeter drawing → mounting outline → bolt-circle array → dimensions → undo/redo → save/reopen | Browser acceptance drawing and both README recordings are created through actual controls, not injected finished geometry |

The `cad.production-workflows` stable-release gate remains partial until the remaining everyday CAD workflows are implemented and accepted. Publishing this candidate cannot pass that gate automatically.

## Implementation order

1. Shared geometric construction, exact input, real curve/dimension rendering and reliable selection/edit transactions.
2. Complete everyday modification tools, annotation, layers, blocks and reusable parts in the same workbench used by consumers.
3. Production drawings: external-file fidelity, paper/print/PDF, recovery and large-drawing performance.
4. First-run developer experience, complete tutorials and independent-user validation; release 1.0 only against the accepted scope and evidence.
5. Continue towards broad ecosystem leadership with measured adoption, contributed extensions and separately validated parametric/3D capabilities.

The first acceptance drawing should be created from an **empty document**, not loaded as a finished sample: construct a mechanical mounting profile, build a polar bolt pattern, edit the outline, dimension it, and save/reopen it. Then repeat with a small building plan and a site drawing. A screenshot of a pre-generated sample does not pass this gate.
