import {
  createKJDrawSDK,
  type KJCommandReceipt,
  type KJDocument,
  type KJEntity,
} from '@kanjieteam/kjdraw'
import { createKJDrawEditor, type KJWorkbenchLayout } from '@kanjieteam/kjdraw/editor'
import { trimEntityPayloads, extendEntityPayload, type KJDerivedEntityPayload } from '@kanjieteam/kjdraw/editing'
import { createBoundaryEditSession, type KJBoundaryEditPreview } from '@kanjieteam/kjdraw/boundary-edit'

// Compiled from the installed package, not from workspace source aliases.
function mountEditor(host: HTMLElement, layout: KJWorkbenchLayout) {
  const editor = createKJDrawEditor(host, { document: 'sample', layout })
  editor.setLayout('compact').setOptions({ layout: 'focus' })
  const current: KJWorkbenchLayout = editor.layout
  return { editor, current }
}
void mountEditor

const preview: KJDerivedEntityPayload[] = trimEntityPayloads(
  { type: 'CIRCLE', payload: { center: [0, 0, 0], radius: 10 } },
  [{ type: 'LINE', payload: { start: [-15, 0, 0], end: [15, 0, 0] } }], [0, 10],
)
const extension = extendEntityPayload(
  { type: 'ARC', payload: { center: [0, 0, 0], radius: 10, startAngle: 0, endAngle: Math.PI / 4 } },
  [{ type: 'LINE', payload: { start: [0, 0, 0], end: [0, 15, 0] } }], [7, 7],
)
void preview
void extension

const sdk = createKJDrawSDK()
const drawing: KJDocument = sdk.createDocument({
  documentId: 'vanilla-consumer',
  title: 'Vanilla TypeScript consumer',
  units: 'millimeter',
})

const created = await sdk.executeCommand<KJEntity>('CREATE', {
  type: 'LINE',
  payload: { start: [0, 0, 0], end: [100, 0, 0] },
})
const envelope = sdk.createCommandEnvelope('MOVE', { id: created.id, dx: 25, dy: 10 })
const receipt: KJCommandReceipt | unknown = await sdk.executeCommandEnvelope(envelope)

console.log(drawing.revision, receipt)

// Hosts can use a normal command envelope for mouse-driven operations, or bind
// the same preview.command to a reviewed AI plan before applying it.
async function trimWithPreview(targetId: string, boundaryIds: readonly string[]) {
  const session = createBoundaryEditSession('trim', { document: drawing, boundaryIds })
  session.confirmBoundaries()
  const geometry: KJBoundaryEditPreview = session.preview(targetId, [25, 0])
  const applied = await session.apply(geometry, request => sdk.executeCommandEnvelope(sdk.createCommandEnvelope(
    request.command, request.arguments, { document: drawing, expectedRevision: request.expectedRevision, origin: 'ui' },
  ), { document: drawing }))
  session.finish()
  return applied
}
void trimWithPreview

// A tool host must be able to read native geometry without recursive type
// expansion errors, while accidental writes remain compile-time errors.
import { createDrawingContext } from '@kanjieteam/kjdraw/drawing-context'
const agentContext = createDrawingContext(drawing, { maxLayers: 0, expectedRevision: drawing.revision })
const queriedRadius = agentContext.entities[0]?.geometry?.radius
if (typeof queriedRadius === 'number') console.log(queriedRadius)
if (false) {
  // @ts-expect-error Read results are immutable snapshots.
  agentContext.revision = 0
  // @ts-expect-error Returned entity collections cannot be changed.
  agentContext.entities.push(agentContext.entities[0]!)
  // @ts-expect-error Native geometry cannot be changed through a read result.
  agentContext.entities[0]!.geometry!.radius = 42
}
