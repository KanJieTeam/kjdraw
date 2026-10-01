import test from 'node:test'
import assert from 'node:assert/strict'
import { createDXFFileAdapter, createKJDrawSDK, KJAgentToolSession } from '../src/index.js'

// Synthetic cases only: no customer geometry, labels or metadata.
test('far-away HATCH family origins survive DXF while spacing and numeric guards remain bounded', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const patternLines = [{ angle: 0, base: [-8e13, -5e14], offset: [0, 2], dashes: [] }]
  await document.transact('synthetic remote pattern origin', tx => tx.createEntity('HATCH', {
    solid: false, patternName: 'REMOTE', patternScale: 1, patternAngle: 0,
    patternLines, patternDefinitionScale: 1, patternDefinitionAngle: 0,
    boundaryLoops: [{ external: true, closed: true, vertices: [[0, 0], [20, 0], [20, 30], [0, 30]] }],
  }))
  const adapter = createDXFFileAdapter(), source = adapter.write(document)
  for (const bad of [source.replace('43\r\n-80000000000000', '43\r\nNaN'),
    source.replace('43\r\n-80000000000000', '43\r\n1e18'),
    source.replace('46\r\n2', '46\r\n1e13')]) {
    assert.notEqual(bad, source)
    await assert.rejects(adapter.read(bad), /HATCH pattern group/)
  }
  let reopened = await adapter.read(source)
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(reopened.listEntities({ type: 'HATCH' })[0].payload.patternLines, patternLines)
    reopened = await adapter.read(adapter.write(reopened))
  }
})

test('MOVE keeps the exact stored survey text angle and non-placement fields', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATE', { type: 'TEXT', payload: {
    position: [25000, 19000, 0], text: 'TEST', height: 1.2, rotation: 6.075613044181257,
  } })
  const before = structuredClone(document.listEntities()[0])
  const session = new KJAgentToolSession(sdk, document)
  const proposal = await session.call('cad_propose_move', {
    expectedRevision: document.revision, units: 'millimeter', ids: [before.id], dx: 2, dy: 1,
  })
  assert.equal(proposal.ok, true)
  assert.equal((await session.approve(proposal.value.planId, 'synthetic-review')).ok, true)
  const expected = structuredClone(before)
  expected.payload.position = [25002, 19001, 0]
  assert.deepEqual(JSON.parse(JSON.stringify(document.getObject(before.id))), JSON.parse(JSON.stringify(expected)))
  await document.undo(); assert.deepEqual(document.getObject(before.id), before)
  await document.redo(); assert.equal(document.getObject(before.id).payload.rotation, before.payload.rotation)
})

test('default proxy export preserves source DXF format; explicit unsafe conversion remains rejected', async () => {
  const adapter = createDXFFileAdapter()
  const source = [0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1018', 0, 'ENDSEC',
    0, 'SECTION', 2, 'ENTITIES', 0, 'ACAD_PROXY_ENTITY', 5, 'A1', 8, '0',
    100, 'AcDbProxyEntity', 90, 1, 91, 0, 92, 0, 93, 0, 0, 'ENDSEC', 0, 'EOF', ''].join('\n')
  const document = await adapter.read(source)
  assert.equal(document.listEntities({ type: 'PROXY_ENTITY' }).length, 1)
  const output = adapter.write(document)
  assert.match(output, /\$ACADVER\r\n1\r\nAC1018/)
  assert.equal((await adapter.read(output)).listEntities({ type: 'PROXY_ENTITY' }).length, 1)
  assert.throws(() => adapter.write(document, { version: '2018' }), /source format code AC1018/)
})
