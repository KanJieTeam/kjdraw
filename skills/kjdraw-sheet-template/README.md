# Original sheet-template resource pack

A small drafting workflow that turns an original A4-landscape frame/title-block template and layer/symbol rules into a native, reviewable CAD proposal. It uses existing LINE, LWPOLYLINE and TEXT operations; it adds no runtime primitive. [中文说明](README.zh-CN.md).

The resources are original community examples, distributed under this repository's Apache-2.0 license. They are **not a certified industry standard**. Nominal A4 dimensions do not certify margins, title blocks, symbols or plotting compliance.

## Resources actually used

| Resource | Effect on the output |
| --- | --- |
| [assets/a4-landscape.json](assets/a4-landscape.json) | Nominal 297 × 210 mm size, 10 mm inset frame, 180 × 32 mm title grid, four field cells and revision-triangle vertices. |
| [references/layer-rules.json](references/layer-rules.json) | Four layer roles, their names/colors/lineweights and allowed symbol names. |
| [scripts/sheet-template.mjs](scripts/sheet-template.mjs) | Loads those exact files, validates facts, compiles tool arguments and calls the existing native proposal tool. |

`planSheetTemplate` is read-only. `proposeSheetTemplate` registers a native `cad_propose_drawing_annotated` plan; neither approves, executes, exports, installs dependencies nor overwrites files. Changing an accepted resource changes actual geometry/style, not just a prompt. Receipts include SHA-256 digests of `JSON.stringify` of the parsed resources, not original file-byte hashes.

## Inputs and outputs

Use a blank millimeter drawing with no existing template layer names. The helper verifies that the injected tool session is bound to that same document. Required input is version `1.0.0`, template ID `community-a4-landscape-v1`, caller-assigned ASCII `sheetId`, current `expectedRevision`, `units: 'millimeter'`, finite `[x,y]` origin and four explicit single-line field values: `title`, `drawingNumber`, `revision`, `scaleLabel`. Unknown fields are rejected.

Optional `size: [width,height]` replaces the selected template's declared nominal size, within 240–600 by 160–450 mm and subject to frame/title-block fit. Optional `symbols` lists up to 16 explicit `{name: 'revision-triangle', position: [x,y]}` marks. Positions are absolute drawing coordinates. Every mark must fit the frame and not overlap the title block. Omitting symbols inserts none; there is no inferred revision marker.

The return value has `status: 'awaiting-host-approval'`, `proposal` with native plan ID/CREATEBATCH arguments/preview, and `evidence` with the sheet ID, dimensions, frame/title bounds, counts and resource digests. With one example triangle, the default preview contains 5 lines, 8 texts and 2 closed polylines across four dedicated layers.

```js
// Run in an existing Node host with a compatible KJDraw SDK installed.
// This example only prepares a proposal. It does not approve or save it.
import { createKJDrawSDK, KJAgentToolSession } from '@kanjieteam/kjdraw'
import { proposeSheetTemplate } from './scripts/sheet-template.mjs'

const sdk = createKJDrawSDK()
const document = sdk.createDocument({ documentId: 'public-sheet', units: 'millimeter' })
const session = new KJAgentToolSession(sdk, document)
const result = await proposeSheetTemplate(session, document, {
  version: '1.0.0', templateId: 'community-a4-landscape-v1', sheetId: 'public-a4',
  expectedRevision: document.revision, units: 'millimeter', origin: [0, 0],
  fields: { title: 'PUBLIC A4 FRAME', drawingNumber: 'EXAMPLE-001', revision: 'A', scaleLabel: '1:1' },
  symbols: [{ name: 'revision-triangle', position: [35, 60] }],
})
console.log(result.status, result.proposal.planId, result.evidence)
// Render result.proposal.preview with the host's existing review UI.
```

## Review and delivery

The host, following explicit user approval, owns execution. The model/helper must never self-approve or supply invented approval evidence. Until host execution, source DXF bytes, geometry and history stay unchanged. Check current revision again at execution. Invalid input/native proposals fail closed without a registered plan or document mutation.

DXF is the primary deliverable after approval: export to a **new** user-selected destination, validate, reopen independently, and compare native geometry/layer meaning. DXF does not preserve internal object IDs, approval state or undo history. The helper deliberately has no file writer. Never replace an existing source drawing to insert this template; start with a new blank document instead.

This is model-space XY geometry, not a paper layout, viewport or print configuration. `scaleLabel` has no geometric effect. Text-fit checks use conservative character-width estimation, so fonts/appearance still need visual host review. No certification, engineering calculation or regulatory symbol semantics are implied.

## Reproducible checks

From the source repository, run the public synthetic cases below. They use actual SDK proposal/approval/history and DXF read/write, with a deterministic test host; they are not a real-model or human-review acceptance claim. See [acceptance](references/acceptance.md) for observed properties and refusal cases.

```sh
npm run check:skill -- skills/kjdraw-sheet-template
```

The pack needs an existing compatible SDK exposing `KJAgentToolSession` and `cad_propose_drawing_annotated`. Installing the Skill alone does not install that runtime or prove compatibility with every published SDK/host version.
