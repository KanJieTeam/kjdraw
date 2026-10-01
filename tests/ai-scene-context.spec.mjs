import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { inspectBuildingCandidates, queryBuildingCandidates, describeBuildingCandidates } from '../apps/playground/ai/scene-context.js'

test('spatial index provides model-queryable geometry without selecting user intent', async () => {
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
  assert.match(describeBuildingCandidates(document), /"index":3/)
  assert.equal(queryBuildingCandidates(document, { expectedRevision: -1, indices: [0] }).ok, false)
  assert.equal(queryBuildingCandidates(document, { expectedRevision: document.revision, indices: [0, 0] }).ok, false)
  const query = queryBuildingCandidates(document, { expectedRevision: document.revision, indices: [0, 1, 2] })
  assert.equal(query.ok, true)
  const selectedIds = query.value.candidates.flatMap(candidate => candidate.memberIds)
  assert.deepEqual(new Set(selectedIds), new Set([
    'building-0', 'label-0', 'building-1', 'label-1', 'building-2', 'label-2',
  ]))
  assert.equal(selectedIds.includes('road'), false)
  const session = new KJAgentToolSession(sdk, document)
  const impact = await session.call('cad_query_impact', {
    expectedRevision: document.revision, units: 'millimeter', operation: 'erase',
    ids: selectedIds, tolerance: 0.01, maxBytes: 262144,
  })
  assert.equal(impact.ok, true)
  assert.equal(impact.value.canErase, true)
  const proposal = await session.call('cad_propose_structural_edit', {
    expectedRevision: document.revision, units: 'millimeter',
    eraseIds: selectedIds, tolerance: 0.01, maxBytes: 262144,
  })
  assert.equal(proposal.ok, true)
  assert.equal(proposal.value.status, 'awaiting-host-approval')
  assert.equal(document.getObject('building-0').erased, false)
  assert.equal(document.getObject('road').erased, false)
})
