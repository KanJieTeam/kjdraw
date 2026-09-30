import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { inspectBuildingCandidates, resolveTopBuildingRemoval } from '../apps/playground/ai/scene-context.js'

test('top-building edit identifies exact geometry, clarifies ambiguity, and remains pending', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'scene-candidates', units: 'millimeter' })
  await document.transact('Four top buildings', tx => {
    for (let index = 0; index < 4; index++) {
      const x = index * 40
      tx.createEntity('LWPOLYLINE', {
        vertices: [[x, 100], [x + 24, 100], [x + 24, 120], [x, 120]], closed: true,
      }, { id: 'building-' + index })
      tx.createEntity('TEXT', {
        position: [x + 4, 110], text: String(index + 3) + 'F', height: 2,
      }, { id: 'label-' + index })
    }
    tx.createEntity('LINE', { start: [0, 80], end: [144, 80] }, { id: 'road' })
  })
  const candidates = inspectBuildingCandidates(document)
  assert.equal(candidates.length, 4)
  const ambiguous = resolveTopBuildingRemoval(document, '删掉顶部三个楼')
  assert.equal(ambiguous.status, 'clarify')
  assert.match(ambiguous.text, /4 栋候选/)
  const selected = resolveTopBuildingRemoval(document, '删掉顶部从左数三个楼')
  assert.equal(selected.status, 'proposal')
  assert.deepEqual(new Set(selected.ids), new Set([
    'building-0', 'label-0', 'building-1', 'label-1', 'building-2', 'label-2',
  ]))
  assert.equal(selected.ids.includes('road'), false)
  const session = new KJAgentToolSession(sdk, document)
  const proposal = await session.call('cad_propose_structural_edit', {
    expectedRevision: document.revision, units: 'millimeter',
    eraseIds: selected.ids, tolerance: 0.01, maxBytes: 262144,
  })
  assert.equal(proposal.ok, true)
  assert.equal(proposal.value.status, 'awaiting-host-approval')
  assert.equal(document.getObject('building-0').erased, false)
  assert.equal(document.getObject('road').erased, false)
})
