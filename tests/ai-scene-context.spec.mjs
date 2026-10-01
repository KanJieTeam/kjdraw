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

test('complete extreme-edge evidence does not omit a tall outline with a lower center', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await document.transact('Mixed-height public spatial fixture', tx => {
    const outlines = [
      { x: 0, top: 120, height: 50, label: '17F' },
      { x: 40, top: 120, height: 20, label: '12F' },
      { x: 80, top: 120, height: 20, label: '12F' },
      { x: 120, top: 120, height: 20, label: '10F' },
      { x: 160, top: 122.1, height: 20, label: '9F' },
      // Near another outline, but outside the extreme-anchored band. It must
      // not become a top-edge member by transitive neighbor clustering.
      { x: 200, top: 118.2, height: 20, label: '3F' },
      { x: 40, top: 20, height: 20, label: '5F' },
      { x: 80, top: 20.01, height: 20, label: '5F' },
    ]
    for (const [index, outline] of outlines.entries()) {
      const { x, top, height, label } = outline
      tx.createEntity('LWPOLYLINE', {
        vertices: [[x, top - height], [x + 24, top - height], [x + 24, top], [x, top]], closed: true,
      }, { id: 'public-outline-' + index })
      tx.createEntity('TEXT', { position: [x + 4, top - height / 2], text: label, height: 2 },
        { id: 'public-floor-label-' + index })
    }
  })
  const candidates = inspectBuildingCandidates(document)
  const description = describeBuildingCandidates(document)
  const evidence = JSON.parse(description.slice(description.indexOf('{')))
  assert.equal(evidence.total, 8)
  assert.equal(evidence.returned, 8)
  assert.equal(evidence.truncated, false)
  const upper = evidence.extremeEdgeBands.top
  assert.equal(upper.edge, 'maxY')
  assert.equal(upper.tolerance, 2.4)
  assert.equal(upper.indices.length, 5)
  assert.deepEqual(upper.indices.map(index => candidates[index].labels[0]).sort(), ['10F', '12F', '12F', '17F', '9F'])
  const tallIndex = candidates.findIndex(candidate => candidate.labels[0] === '17F')
  const smallIndex = candidates.findIndex(candidate => candidate.labels[0] === '3F')
  assert.ok(candidates[tallIndex].center[1] < candidates[smallIndex].center[1])
  assert.ok(upper.indices.includes(tallIndex))
  assert.ok(!upper.indices.includes(smallIndex))
  assert.equal(evidence.extremeEdgeBands.bottom.indices.length, 2)
  assert.match(evidence.extremeEdgeBands.rule, /not a confirmed row or ownership group/)

  const partialDescription = describeBuildingCandidates(document, 3)
  const partial = JSON.parse(partialDescription.slice(partialDescription.indexOf('{')))
  assert.equal(partial.returned, 3)
  assert.equal(partial.truncated, true)
  assert.deepEqual(partial.extremeEdgeBands, evidence.extremeEdgeBands)
  const query = queryBuildingCandidates(document, { expectedRevision: document.revision, indices: [0] })
  assert.equal(query.value.returned, 1)
  assert.equal(query.value.completeInventory, false)
  assert.deepEqual(query.value.extremeEdgeBands, evidence.extremeEdgeBands)
  assert.equal(document.history.undoCount, 1)
})

test('geometric band tolerance scales with drawing coordinates rather than a source-specific number', async () => {
  const summaries = []
  for (const scale of [0.5, 1, 100]) {
    const document = createKJDrawSDK().createDocument()
    await document.transact('Scale-invariant public spatial fixture', tx => {
      for (const [index, top] of [120, 122, 116].entries()) {
        const x = index * 80
        tx.createEntity('LWPOLYLINE', { vertices: [[x, top - 40], [x + 48, top - 40], [x + 48, top], [x, top]]
          .map(point => point.map(coordinate => coordinate * scale)), closed: true })
        tx.createEntity('TEXT', { position: [(x + 8) * scale, (top - 20) * scale], text: '5F', height: 2 * scale })
      }
    })
    const description = describeBuildingCandidates(document)
    const evidence = JSON.parse(description.slice(description.indexOf('{')))
    summaries.push(evidence.extremeEdgeBands.top.indices)
    assert.ok(Math.abs(evidence.extremeEdgeBands.top.tolerance - 4.8 * scale) < 1e-9)
  }
  assert.deepEqual(summaries, [[0, 1], [0, 1], [0, 1]])
})
