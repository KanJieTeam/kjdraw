import { createKJDrawSDK, KJAgentToolSession as RootSession } from '@kanjieteam/kjdraw'
import { KJAgentToolSession, type KJAgentToolDefinition, type KJAgentToolResult } from '@kanjieteam/kjdraw/agent-tools'

const sdk = createKJDrawSDK()
const drawing = sdk.createDocument({ units: 'millimeter' })
const session: RootSession = new KJAgentToolSession(sdk, drawing)
const definitions: readonly KJAgentToolDefinition[] = session.definitions
const result: KJAgentToolResult = await session.call('cad_read_drawing', {})
if (!result.ok) console.log(result.error.code)
// @ts-expect-error Tool descriptors cannot be mutated by provider adapters.
definitions[0]!.name = 'execute_anything'
import type { KJAgentDrawingInput, KJAgentGeometryPreview } from '@kanjieteam/kjdraw/agent-tools'
import type { KJCanvasRenderer } from '@kanjieteam/kjdraw/renderer/canvas'

const composedInput: KJAgentDrawingInput = {
  expectedRevision: 0, units: 'millimeter', lines: [], arcs: [],
  circles: [{ center: { x: 20, y: 20 }, radius: 3 }],
  polylines: [{ vertices: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 40 }, { x: 0, y: 40 }], closed: true }],
}
function paintGeometry(renderer: KJCanvasRenderer, preview: KJAgentGeometryPreview) {
  renderer.render()
  renderer.drawPreview(preview.before, '#e87979')
  renderer.drawPreview(preview.after, '#52c99b')
}
void composedInput
void paintGeometry
