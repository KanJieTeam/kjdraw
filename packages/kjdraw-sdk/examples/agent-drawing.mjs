import assert from 'node:assert/strict'
import { createKJDrawSDK } from '@kanjieteam/kjdraw'
import { KJAgentToolSession } from '@kanjieteam/kjdraw/agent-tools'
import { mountingProfile } from './fixtures/mounting-profile.mjs'

const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units: 'millimeter' })
const session = new KJAgentToolSession(sdk, drawing)
const proposal = await session.call('cad_propose_drawing', mountingProfile())
assert.equal(proposal.ok, true, JSON.stringify(proposal))
assert.equal(drawing.revision, 0)
assert.equal(proposal.value.preview.after.length, 9)
// Test-only approval. An application must show the preview and authenticate
// its reviewer before calling this host-only method. Never expose it as a tool.
assert.equal((await session.approve(proposal.value.planId, 'example-reviewer')).ok, true)
assert.equal(drawing.revision, 1)
assert.equal(drawing.listEntities().length, 9)
for (const format of ['KJD', 'DXF']) {
  const data = await sdk.writeDocument(drawing, { format })
  const reopened = await createKJDrawSDK().readDocument(data, { format })
  assert.equal(reopened.listEntities().length, 9)
  assert.equal(reopened.listEntities().filter(entity => entity.type === 'CIRCLE').length, 4)
}
await sdk.executeCommand('UNDO')
assert.equal(drawing.listEntities().length, 0)
await sdk.executeCommand('REDO')
assert.equal(drawing.listEntities().length, 9)
console.log(JSON.stringify({ agentDrawing: true, entities: 9, preview: true, kjd: true, dxf: true, undo: true, redo: true, offline: true }))
