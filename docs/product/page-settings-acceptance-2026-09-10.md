# DXF scalar page-configuration preservation

Date: 2026-09-10. Source increment after `ba8e1a7`; accepted source is the commit containing this record. No npm or stable 1.0 publication.

Previously, importing a LAYOUT ignored its AcDbPlotSettings subclass and exporting wrote an empty subclass. A non-default paper size, margin or plot scale could silently become the independent reader's defaults. The adapter now preserves 30 scalar fields per layout: setup/printer/media/view/style names, physical dimensions, margins, origin and image offsets, plot window, custom and standard scale, units, rotation, flags and shade-quality values. Names are data; external printer/style resources are not loaded.

`KJDxfPlotSettings` is exported through the package schema/root. Layouts store it in `payload.dxfPlotSettings`; typed `transaction.createLayout` accepts it. `PAGESETUP`/`PLOTSETUP` with `dxf` patches just supplied fields using the existing transaction/history route. Shared validation applies to command edits, transaction commits, KJD loads and DXF import/export. Unknown fields, malformed numbers, out-of-range enums and embedded line breaks reject. R12/R14 export rejects populated page configurations rather than dropping them.

The existing native `plotSettings` contract uses degree rotation, nested scale and output-device preferences, so it remains separate and backward compatible. It is not automatically exported as DXF page data. Hosts explicitly use `dxf` for interchange. DXF physical dimensions/margins/origin are millimeters even when paperUnits selects inches or pixels; rotation uses the DXF 0–3 index. Layout limits/extents are not paper dimensions.

Validation:

- Node 22 and Node 24: **398/398 each**, including installed JS/TypeScript/React/Vue consumers and the new typed page-setting fixture. New tests cover six modern DXF versions, model/populated/empty layouts, KJD roundtrip, partial edits, unchanged native settings, undo/redo, atomic rejection and legacy-version loss prevention.
- Chromium, Firefox and WebKit: **45/45** page-setting, public editor, framework and bilingual documentation cases. The new editor case opens a DXF, edits one sheet, checks history, saves/reopens and verifies the unrelated empty sheet and entity ownership. It does not claim a graphical print preview.
- Independent ezdxf 1.4.4: original three-layout input, all **30 fields per layout**, edit and undo/redo roundtrips compare equal with zero audit errors or repairs. This executable audit is added to CI.
- Six private files, processed only locally: layout counts **3 / 3 / 2 / 2 / 2 / 2**; all page-field values and per-layout entity counts match independent source readings, original hashes unchanged, every exported file has zero audit errors/repairs. The first source already needs **28 independent audit fixes** and initially failed the synthetic audit's clean-source precondition. A separate local diagnostic compares its page fields before auditing and requires a clean exported file; it passes. Source coordinates, text, names, screenshots and raw reports remain private.
- Strict types, 67 generated runtime modules/declarations, API/docs generation and repository link/export/credential checks pass. The docs heading hierarchy was corrected after the browser run; guide generation and local-link checks pass on that final markup.

Scope still open: layout limits/extents/UCS, full viewport projection, standalone named page-setup dictionaries, shade-object handles, transparency XDATA, referenced printer/style assets, the legacy `paper` envelope, native-output conversion, graphical page editing and production printing. Settings preservation does not establish printed-output fidelity or close W05/1.0. The four dense hatches, ellipse/spline boundaries and complex live-model evaluations remain unfinished.

The preceding `ba8e1a70133f729af76d4be8f25a36850b35e20d` is pushed; its [CI](https://github.com/KanJieTeam/kjdraw/actions/runs/34434417267) and [Pages](https://github.com/KanJieTeam/kjdraw/actions/runs/34434417266) completed successfully. These results apply only to that preceding SHA.

Reference: [Autodesk PLOTSETTINGS group codes](https://help.autodesk.com/cloudhelp/2025/ENU/AutoCAD-DXF/files/GUID-1113675E-AB07-4567-801A-310CDE0D56E9.htm).

## Follow-up: workbench page setup

The subsequent increment after `430bc16` adds a real **Page setup** entry to the embedded editor's top bar. Users choose a model or paper layout and edit physical width/height, four margins, plot units, rotation and custom scale with labeled controls. The form reads stored values; blank fields keep existing values. Only changed fields are sent through the existing revision-bound PAGESETUP command. Editing custom scale clears the standard-scale flag and preserves other flags. Native plotting preferences and unexposed DXF fields remain unchanged.

Cancel/Escape and unchanged Apply make no document/history changes. Stale revisions produce an inline alert instead of overwriting concurrent changes. Readonly transitions close the dialog and disable its entry. The layout form uses existing Precision controls, modal focus behavior, a scrollable field area and visible footer actions; the existing theme uses light control surfaces with a dark/light canvas.

Validation: Node 22/24 **398/398 each**; Chromium/Firefox/WebKit **39/39** public-editor, framework, page roundtrip and real page-form cases. The new controls are exercised by clicking, filling, selecting and keyboard submission, with assertions for exact page values/flags, unchanged geometry/other layouts, undo/redo, DXF reopen, cancellation, invalid numbers, stale revisions, readonly changes, no-op history and 390px Chinese layout. Chromium and WebKit screenshots were visually inspected. Generated runtime/declaration/API/docs checks and the 537-file repository check pass.

Initial browser attempts are not counted as acceptance: the new fixture initially inherited the hosted playground's CSP and lost inline SDK styles; it now uses the same `bypassCSP` integration setting as the existing editor fixtures and verifies actual style application. A second run had an incorrect dark-control expectation and lost its shared server when an overlapping earlier test run exited. The corrected final matrix ran alone and passed all 39 cases; the earlier failures were retained in local logs. No hosted CSP policy or theme contract was weakened.

This completes the listed scalar field editor, not graphical plotting preview, all 30 fields in UI, viewport projection or production printing. The [CI](https://github.com/KanJieTeam/kjdraw/actions/runs/34436790656) and [Pages](https://github.com/KanJieTeam/kjdraw/actions/runs/34436790638) for the preceding `430bc1654ee330a744c3aa6bc3aa39b057d663ab` succeeded; these results do not establish the new UI commit's remote status. No npm/stable release.
