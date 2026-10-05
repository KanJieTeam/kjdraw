import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { canonicalStringify, stableHash } from '../src/utils.js'
import { DXF_VIEWPORT_METADATA_KEY } from '../src/dxf-viewport-metadata.js'

async function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await document.transact('Synthetic associative hatch', tx => {
    // Forward references deliberately exercise deferred DXF handle resolution.
    tx.createEntity('HATCH', {
      patternName: 'ANSI31', solid: false, associative: true, patternScale: 0.5,
      boundaryLoops: [
        { external: true, flags: 3, closed: true, vertices: [[0, 0], [20, 0], [20, 20], [0, 20]], sourceBoundaryIds: ['boundary'] },
        { external: false, flags: 0, edges: [{ type: 'ARC', center: [10, 10, 0], radius: 2, startAngle: 0, endAngle: Math.PI * 2, counterClockwise: true }], sourceBoundaryIds: ['island'] },
      ],
    }, { id: 'hatch' })
    tx.createEntity('LWPOLYLINE', { closed: true, vertices: [[0, 0], [20, 0], [20, 20], [0, 20]], dxfReactorIds: ['hatch'] }, { id: 'boundary' })
    tx.createEntity('CIRCLE', { center: [10, 10, 0], radius: 2, dxfReactorIds: ['hatch'] }, { id: 'island' })
  })
  const source = await sdk.writeDocument(document, { format: 'DXF' })
  return { sdk, source, document: await sdk.readDocument(source, { format: 'DXF' }) }
}

function assertAssociations(document, expectedPattern = 'ANSI31') {
  const hatch = document.listEntities({ type: 'HATCH' })[0]
  assert.equal(hatch.payload.patternName, expectedPattern)
  assert.equal(hatch.payload.associative, true)
  assert.equal(hatch.payload.boundaryLoops.length, 2)
  for (const loop of hatch.payload.boundaryLoops) {
    assert.equal(loop.sourceBoundaryIds.length, 1)
    const boundary = document.getObject(loop.sourceBoundaryIds[0])
    assert.ok(boundary && !boundary.erased)
    assert.equal(boundary.ownerId, hatch.ownerId)
    assert.deepEqual(loop.sourceBoundaryHandles, [boundary.handle])
    assert.deepEqual(boundary.payload.dxfReactorIds, [hatch.id])
  }
  return hatch
}

const geometry = hatch => hatch.payload.boundaryLoops.map(({ sourceBoundaryIds, sourceBoundaryHandles, ...loop }) => loop)

const record = (...tags) => `${tags.join('\n')}\n`
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }
async function approvePattern(sdk, document) {
  const fixturePatterns = [{
    name: 'PUBLIC_REPLACEMENT', description: 'Synthetic line families', lines: [
      { angle: 0, base: [0, 0], offset: [0, 4], dashes: [1, -3] },
      { angle: Math.PI / 2, base: [1, 0], offset: [4, 0], dashes: [1, -3] },
    ],
  }]
  const session = new KJAgentToolSession(sdk, document, { hatchPatternCatalogs: [{
    version: '1.0.0', contentHash: stableHash(fixturePatterns), patterns: fixturePatterns,
  }] })
  const patterns = ok(await session.call('cad_read_hatch_patterns', { expectedRevision: document.revision, search: 'PUBLIC_REPLACEMENT' }))
  const proposal = ok(await session.call('cad_propose_hatch_pattern', { expectedRevision: document.revision, units: 'millimeter',
    ids: document.listEntities({ type: 'HATCH' }).map(hatch => hatch.id), patternId: patterns.patterns[0].patternId }))
  ok(await session.approve(proposal.planId, 'synthetic-reviewer'))
  return proposal
}

async function islandFixture(style) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const rectangles = [[0, 0, 20, 20], [3, 3, 7, 7], [12, 12, 16, 16], [4, 4, 6, 6]]
  await document.transact('Two islands and a nested island', tx => {
    const loops = rectangles.map(([x, y, right, top], index) => ({ flags: [3, 18, 18, 2][index], external: index < 3,
      closed: true, vertices: [[x, y], [right, y], [right, top], [x, top]], sourceBoundaryIds: [`boundary-${index}`] }))
    tx.createEntity('HATCH', { patternName: 'ANSI31', associative: true, solid: false, boundaryLoops: loops }, { id: 'hatch' })
    for (const [index, loop] of loops.entries()) tx.createEntity('LWPOLYLINE', { closed: true, vertices: loop.vertices, dxfReactorIds: ['hatch'] }, { id: `boundary-${index}` })
  })
  const source = String(await sdk.writeDocument(document, { format: 'DXF' })).replaceAll('\r\n', '\n').replace(record(75, 0), record(75, style))
  return { sdk, source, document: await sdk.readDocument(source, { format: 'DXF' }) }
}

test('HATCHPATTERN retains native island styles 0/1/2 and all double-island geometry through approval, history and repeated reopen', async () => {
  for (const style of [0, 1, 2]) {
    const { sdk, document } = await islandFixture(style)
    const hatch = document.listEntities({ type: 'HATCH' })[0], before = document.listEntities(), loops = canonicalStringify(hatch.payload.boundaryLoops)
    assert.equal(hatch.payload.hatchStyle ?? 0, style)
    if (style === 0) assert.equal(Object.hasOwn(hatch.payload, 'hatchStyle'), false)
    const unchanged = await sdk.readDocument(await sdk.writeDocument(document, { format: 'DXF' }), { format: 'DXF' })
    assert.equal(unchanged.listEntities({ type: 'HATCH' })[0].payload.hatchStyle ?? 0, style)
    const proposal = await approvePattern(sdk, document)
    assert.equal(proposal.preview.after[0].payload.hatchStyle ?? 0, style)
    assert.equal(canonicalStringify(document.getObject(hatch.id).payload.boundaryLoops), loops)
    const after = document.listEntities()
    await document.undo(); assert.deepEqual(document.listEntities(), before)
    await document.redo(); assert.deepEqual(document.listEntities(), after)
    let current = document
    for (const format of ['KJD', 'DXF', 'DXF']) {
      current = await sdk.readDocument(await sdk.writeDocument(current, { format }), { format })
      const actual = current.listEntities({ type: 'HATCH' })[0]
      assert.equal(actual.payload.hatchStyle ?? 0, style)
      assert.equal(actual.payload.patternName, 'PUBLIC_REPLACEMENT')
      assert.equal(canonicalStringify(geometry(actual)), canonicalStringify(geometry(hatch)))
      assert.deepEqual(actual.payload.boundaryLoops.map(loop => loop.flags), [3, 18, 18, 2])
      for (const loop of actual.payload.boundaryLoops) assert.deepEqual(current.getObject(loop.sourceBoundaryIds[0]).payload.dxfReactorIds, [actual.id])
      assert.equal(current.validate().valid, true)
    }
    const legacyState = JSON.parse(document.serialize())
    delete legacyState.objects[hatch.id].payload.hatchStyle
    const legacy = await sdk.readDocument(await sdk.writeDocument(sdk.openDocument(legacyState), { format: 'DXF' }), { format: 'DXF' })
    assert.equal(legacy.listEntities({ type: 'HATCH' })[0].payload.hatchStyle ?? 0, style)
  }
})

test('illegal, duplicate and malformed island styles fail closed on import and native/raw export', async () => {
  const { sdk, source, document } = await islandFixture(1)
  for (const invalid of ['-1', '3', 'NaN', '1.5', '', '1\n75\n2']) {
    await assert.rejects(sdk.readDocument(source.replace(record(75, 1), record(75, invalid)), { format: 'DXF' }), error => /island style/.test(error.cause?.message ?? error.message))
  }
  for (const value of [null, '1', -1, 3, 1.5]) {
    const state = JSON.parse(document.serialize()), hatch = Object.values(state.objects).find(object => object.type === 'HATCH')
    hatch.payload.hatchStyle = value
    await assert.rejects(sdk.writeDocument(sdk.openDocument(state), { format: 'DXF' }), error => /island style/.test(error.cause?.message ?? error.message))
  }
})

test('independent ezdxf verifies island-style filled boundaries and catches the former default-style rewrite', { skip: !process.env.KJDRAW_PYTHON }, async () => {
  const check = `
import io,json,sys,ezdxf
data=json.load(sys.stdin)
def measure(text, expected_style):
    doc=ezdxf.read(io.StringIO(text,newline=None))
    hatch,=doc.modelspace().query('HATCH')
    assert hatch.dxf.hatch_style == expected_style
    assert [path.path_type_flags for path in hatch.paths] == [3,18,18,2]
    def area(path):
        v=path.vertices
        return abs(sum(v[i][0]*v[(i+1)%len(v)][1]-v[(i+1)%len(v)][0]*v[i][1] for i in range(len(v)))/2)
    def filled(style):
        paths=list(hatch.paths.rendering_paths(style))
        return sum(area(path)*(1 if path.path_type_flags & 1 or not path.path_type_flags & 16 else -1) for path in paths)
    assert [area(path) for path in hatch.paths] == [400,16,16,4]
    expected=[372,368,400][expected_style]
    assert filled(expected_style) == expected
    if expected_style: assert filled(0) != expected # negative control: the former bug changes real filled area
    for path in hatch.paths:
        boundary=doc.entitydb[path.source_boundary_objects[0]]
        assert boundary.get_reactors() == [hatch.dxf.handle]
    audit=doc.audit()
    assert not audit.errors and not audit.fixes
    return {'style':expected_style,'area':expected,'paths':len(list(hatch.paths.rendering_paths(expected_style))),'errors':len(audit.errors),'fixes':len(audit.fixes)}
print(json.dumps([measure(data['source'],data['style']),measure(data['edited'],data['style'])]))
`
  for (const style of [1, 2]) {
    const { sdk, source, document } = await islandFixture(style)
    await approvePattern(sdk, document)
    const edited = await sdk.writeDocument(document, { format: 'DXF' })
    const result = spawnSync(process.env.KJDRAW_PYTHON, ['-c', check], { encoding: 'utf8', input: JSON.stringify({ source, edited, style }) })
    assert.equal(result.status, 0, result.stderr)
    const expected = { style, area: style === 1 ? 368 : 400, paths: style === 1 ? 3 : 1, errors: 0, fixes: 0 }
    assert.deepEqual(JSON.parse(result.stdout), [expected, expected])
  }
})

test('unchanged and pattern-edited HATCH retain each loop source and boundary reactor through repeated KJD/DXF reopen and undo', async () => {
  const { sdk, document } = await fixture()
  const hatch = assertAssociations(document), boundaryGeometry = canonicalStringify(geometry(hatch))
  const before = canonicalStringify(document.listEntities())
  let unchanged = await sdk.readDocument(await sdk.writeDocument(document, { format: 'DXF' }), { format: 'DXF' })
  assertAssociations(unchanged)
  assert.equal(canonicalStringify(geometry(unchanged.listEntities({ type: 'HATCH' })[0])), boundaryGeometry)
  await document.transact('Change the actual pattern families', tx => tx.updateObject(hatch.id, { payload: {
    patternName: 'PUBLIC_CUSTOM', patternDefinitionAngle: 0, patternDefinitionScale: 1,
    patternLines: [
      { angle: 0, base: [0, 0], offset: [0, 4], dashes: [2, -3] },
      { angle: Math.PI / 2, base: [1, 0], offset: [5, 0], dashes: [1, -4] },
    ],
  } }))
  const after = canonicalStringify(document.listEntities())
  let current = document
  for (const format of ['KJD', 'DXF', 'DXF']) {
    current = await sdk.readDocument(await sdk.writeDocument(current, { format }), { format })
    const actual = assertAssociations(current, 'PUBLIC_CUSTOM')
    assert.equal(canonicalStringify(geometry(actual)), boundaryGeometry)
    assert.equal(actual.payload.patternLines.length, 2)
    assert.equal(current.listEntities().length, 3)
    assert.equal(current.validate().valid, true)
  }
  await document.undo()
  assert.equal(canonicalStringify(document.listEntities()), before)
  await document.redo()
  assert.equal(canonicalStringify(document.listEntities()), after)
})

test('source boundaries and reactors export current handles instead of raw source handles on both HATCH routes', async () => {
  const { sdk, document } = await fixture()
  const state = JSON.parse(document.serialize())
  const entities = Object.values(state.objects).filter(object => object.kind === 'entity')
  for (const [index, entity] of entities.entries()) entity.handle = (0xff0001 + index).toString(16).toUpperCase()
  state.header.handseed = 'FF0010'
  const remapped = sdk.openDocument(state)
  for (const edited of [false, true]) {
    const hatch = remapped.listEntities({ type: 'HATCH' })[0]
    if (edited) await remapped.transact('Pattern angle forces native rewrite', tx => tx.updateObject(hatch.id, { payload: { patternAngle: 0.25 } }))
    const reopened = await sdk.readDocument(await sdk.writeDocument(remapped, { format: 'DXF' }), { format: 'DXF' })
    const actual = assertAssociations(reopened)
    assert.equal(actual.handle, hatch.handle)
    for (const loop of actual.payload.boundaryLoops) assert.ok(loop.sourceBoundaryHandles[0].startsWith('FF000'))
  }
})

test('unavailable source boundaries and reactor handles remain readable but block lossy DXF export', async () => {
  const { sdk, document, source } = await fixture()
  const hatch = document.listEntities({ type: 'HATCH' })[0]
  const boundary = document.getObject(hatch.payload.boundaryLoops[0].sourceBoundaryIds[0])
  for (const handle of [boundary.handle, hatch.handle]) {
    const normalized = String(source).replaceAll('\r\n', '\n')
    const damaged = normalized.replaceAll(`330\n${handle}\n`, '330\nDEAD\n')
    assert.notEqual(damaged, normalized)
    const imported = await sdk.readDocument(damaged, { format: 'DXF' })
    assert.equal(imported.listEntities().length, 3)
    await assert.rejects(sdk.writeDocument(imported, { format: 'DXF' }), error => /unresolved.*(source boundary|reactor)/i.test(error.cause?.message ?? error.message))
  }
})

test('erased and wrong-owner association targets are rejected rather than emitted as stale handles', async () => {
  for (const kind of ['erase', 'wrong-owner']) {
    const { sdk, document } = await fixture()
    const hatch = document.listEntities({ type: 'HATCH' })[0], boundaryId = hatch.payload.boundaryLoops[0].sourceBoundaryIds[0]
    await document.transact('Invalid source target', tx => kind === 'erase'
      ? tx.updateObject(boundaryId, { erased: true })
      : tx.reparentObject(boundaryId, document.spaces.paperSpaceIds[0]))
    await assert.rejects(sdk.writeDocument(document, { format: 'DXF' }), error => /live entity in the same owner space|unavailable.*source boundary/i.test(error.cause?.message ?? error.message))
  }
})

test('generic reactors preserve exported layouts, tables, block records and cross-space entities using current handles', async () => {
  const { sdk, document } = await fixture()
  const hatch = document.listEntities({ type: 'HATCH' })[0]
  const boundaryId = hatch.payload.boundaryLoops[0].sourceBoundaryIds[0]
  const paperLayout = document.getObject(document.spaces.layoutIds[1])
  let expectedIds
  await document.transact('Reactors are persistent object references, not hatch boundaries', tx => {
    const paperLine = tx.createEntity('LINE', { start: [100, 0], end: [101, 0] }, { ownerId: paperLayout.payload.blockRecordId })
    expectedIds = [hatch.id, paperLayout.id, document.getTable('layers').records[0].id, document.spaces.modelSpaceId, paperLine.id]
    tx.updateObject(boundaryId, { payload: { dxfReactorIds: expectedIds } })
  })
  const state = JSON.parse(document.serialize())
  for (const [index, object] of Object.values(state.objects).entries()) object.handle = (0xff0001 + index).toString(16).toUpperCase()
  state.header.handseed = 'FF1000'
  const remapped = sdk.openDocument(state)
  const output = await sdk.writeDocument(remapped, { format: 'DXF' })
  assert.ok(output.includes(['102', '{ACAD_REACTORS', ...expectedIds.flatMap(id => ['330', remapped.getObject(id).handle]), '102', '}'].join('\r\n')))
  let reopened = await sdk.readDocument(output, { format: 'DXF' })
  for (const format of ['KJD', 'DXF', 'DXF']) {
    reopened = await sdk.readDocument(await sdk.writeDocument(reopened, { format }), { format })
    const actualHatch = reopened.listEntities({ type: 'HATCH' })[0]
    const boundary = reopened.getObject(actualHatch.payload.boundaryLoops[0].sourceBoundaryIds[0])
    const targets = boundary.payload.dxfReactorIds.map(id => reopened.getObject(id))
    assert.deepEqual(targets.map(target => target.type), ['HATCH', 'LAYOUT', 'LAYER', 'BLOCK_RECORD', 'LINE'])
    assert.equal(targets[1].name, 'Layout1')
    assert.notEqual(targets[4].ownerId, boundary.ownerId)
    assert.equal(reopened.validate().valid, true)
  }
  await assert.rejects(sdk.writeDocument(remapped, { format: 'DXF', version: 'R14' }), error => /live exported DXF object/.test(error.cause?.message ?? error.message))
})

async function metadataFixture({ hatchOwned = false, capture = true, pixelSize = 0.1 } = {}) {
  const { sdk, document } = await fixture()
  const hatch = document.listEntities({ type: 'HATCH' })[0]
  const layout = document.getObject(document.spaces.layoutIds[1])
  const viewport = record(0, 'VIEWPORT', 5, 'F01', 102, hatchOwned ? '{ACAD_REACTORS' : '{ACAD_XDICTIONARY', hatchOwned ? 330 : 360, 'F02', 102, '}',
    330, document.getObject(layout.payload.blockRecordId).handle, 100, 'AcDbEntity', 8, '0', 67, 1, 410, 'Layout1', 100, 'AcDbViewport',
    10, 50, 20, 50, 30, 0, 40, 90, 41, 80, 68, 1, 69, 2, 12, 0, 22, 0, 16, 0, 26, 0, 36, 1, 17, 0, 27, 0, 37, 0, 45, 80, 90, 0)
  const objects = record(0, 'DICTIONARY', 5, 'F02', 330, hatchOwned ? hatch.handle : 'F01', 100, 'AcDbDictionary', 281, 1, 3, 'SYNTHETIC_DATA', 360, 'F03') +
    record(0, 'XRECORD', 5, 'F03', 330, 'F02', 100, 'AcDbXrecord', 280, 1, 1, 'synthetic reactor data')
  const normalized = String(await sdk.writeDocument(document, { format: 'DXF' })).replaceAll('\r\n', '\n')
  let modified = normalized
    .replace(record(102, '{ACAD_REACTORS', 330, hatch.handle, 102, '}'), record(102, '{ACAD_REACTORS', 330, hatch.handle, 330, 'F03', 330, layout.handle, 102, '}'))
    .replace('0\nENDSEC\n0\nSECTION\n2\nOBJECTS\n', `${capture ? viewport : ''}0\nENDSEC\n0\nSECTION\n2\nOBJECTS\n`)
    .replace('0\nENDSEC\n0\nEOF\n', `${objects}0\nENDSEC\n0\nEOF\n`)
  if (hatchOwned) {
    const boundary = document.getObject(hatch.payload.boundaryLoops[0].sourceBoundaryIds[0])
    const xdata = record(1001, 'PUBLIC_METADATA', 1000, 'synthetic metadata', 1002, '{', 1070, 17, 1071, 123456, 1040, 2.5, 1041, 3, 1042, 4, 1010, 1.5, 1020, 2.5, 1030, 0,
      1004, '0AFF', 1005, boundary.handle, 1005, 'F03', 1005, '0', 1002, '}')
    const appid = record(0, 'TABLE', 2, 'APPID', 5, 'F10', 330, 0, 100, 'AcDbSymbolTable', 70, 1,
      0, 'APPID', 5, 'F11', 330, 'F10', 100, 'AcDbSymbolTableRecord', 100, 'AcDbRegAppTableRecord', 2, 'PUBLIC_METADATA', 70, 0, 0, 'ENDTAB')
    modified = modified
      .replace(record(0, 'HATCH', 5, hatch.handle), record(0, 'HATCH', 5, hatch.handle, 102, '{ACAD_XDICTIONARY', 360, 'F02', 102, '}'))
      .replace(record(100, 'AcDbHatch'), record(430, 'PUBLIC$COLOR', 440, 33554560, 284, 2, 100, 'AcDbHatch'))
      .replace(record(77, 0), record(77, 1))
      .replace(record(0, 'LWPOLYLINE'), record(47, pixelSize, 98, 1, 10, 1, 20, 1) + xdata + record(0, 'LWPOLYLINE'))
      .replace('0\nENDSEC\n0\nSECTION\n2\nBLOCKS\n', `${appid}0\nENDSEC\n0\nSECTION\n2\nBLOCKS\n`)
  }
  return { sdk, source: modified, document: await sdk.readDocument(modified, { format: 'DXF' }) }
}

test('approved HATCHPATTERN preserves validated extension dictionary, scalar XDATA and common header metadata with remapped handles', async () => {
  const { sdk, document } = await metadataFixture({ hatchOwned: true })
  const state = JSON.parse(document.serialize())
  for (const [index, object] of Object.values(state.objects).entries()) object.handle = (0xff0001 + index).toString(16).toUpperCase()
  state.header.handseed = 'FF1000'
  const remapped = sdk.openDocument(state), before = remapped.listEntities()
  const metadataBefore = canonicalStringify(remapped.snapshot().opaquePayloads[DXF_VIEWPORT_METADATA_KEY])
  await approvePattern(sdk, remapped)
  assert.equal(canonicalStringify(remapped.snapshot().opaquePayloads[DXF_VIEWPORT_METADATA_KEY]), metadataBefore)
  const after = remapped.listEntities()
  await remapped.undo(); assert.deepEqual(remapped.listEntities(), before)
  await remapped.redo(); assert.deepEqual(remapped.listEntities(), after)
  let current = remapped
  for (const format of ['KJD', 'DXF', 'DXF']) {
    current = await sdk.readDocument(await sdk.writeDocument(current, { format }), { format })
    const hatch = current.listEntities({ type: 'HATCH' })[0], tags = hatch.payload.rawTags
    const dictionary = current.snapshot().opaquePayloads[DXF_VIEWPORT_METADATA_KEY].records.find(record => record.type === 'DICTIONARY')
    assert.equal(tags.filter(tag => tag.code === 360).length, 1)
    assert.equal(tags.find(tag => tag.code === 360).value, 'F02')
    assert.equal(tags.findIndex(tag => tag.code === 360) < tags.findIndex(tag => tag.code === 100 && tag.value === 'AcDbEntity'), true)
    if (format !== 'KJD') {
      assert.equal(dictionary.tags.find(tag => tag.code === 330).value, hatch.handle)
      assert.deepEqual(tags.filter(tag => tag.code === 1005).map(tag => tag.value), [current.getObject(hatch.payload.boundaryLoops[0].sourceBoundaryIds[0]).handle, 'F03', '0'])
    }
    assert.deepEqual(tags.filter(tag => [430, 440, 284].includes(tag.code)), [{ code: 430, value: 'PUBLIC$COLOR' }, { code: 440, value: '33554560' }, { code: 284, value: '2' }])
    assert.equal(tags.find(tag => tag.code === 77).value, '1')
    assert.equal(tags.find(tag => tag.code === 47).value, '0.1')
    assert.equal(tags.find(tag => tag.code === 98).value, '1')
    assert.equal(tags.find(tag => tag.code === 1000).value, 'synthetic metadata')
    assert.equal(current.validate().valid, true)
  }
})

test('zero HATCH pixel metadata survives unchanged and approved native pattern routes, history and repeated KJD/DXF reopen without dropping metadata', async () => {
  const assertLinkedMetadata = (document, expectedPattern = 'ANSI31') => {
    const hatch = document.listEntities({ type: 'HATCH' })[0]
    assert.equal(hatch.payload.patternName, expectedPattern)
    assert.equal(hatch.payload.associative, true)
    assert.equal(hatch.payload.boundaryLoops.length, 2)
    for (const [index, loop] of hatch.payload.boundaryLoops.entries()) {
      assert.equal(loop.sourceBoundaryIds.length, 1)
      const boundary = document.getObject(loop.sourceBoundaryIds[0])
      assert.ok(boundary && !boundary.erased)
      assert.equal(boundary.ownerId, hatch.ownerId)
      assert.deepEqual(loop.sourceBoundaryHandles, [boundary.handle])
      if (index === 0) {
        const layout = document.getObject(document.spaces.layoutIds[1])
        assert.deepEqual(boundary.payload.dxfReactorIds, [hatch.id, layout.id])
        assert.deepEqual(boundary.payload.dxfReactorReferences, [{ id: hatch.id }, { metadataHandle: 'F03' }, { id: layout.id }])
      } else assert.deepEqual(boundary.payload.dxfReactorIds, [hatch.id])
    }
    return hatch
  }
  for (const edited of [false, true]) {
    const { sdk, document } = await metadataFixture({ hatchOwned: true, pixelSize: 0 })
    const hatch = assertLinkedMetadata(document), originalGeometry = canonicalStringify(geometry(hatch))
    const before = document.listEntities(), originalObjects = document.snapshot().objects
    const opaqueBefore = canonicalStringify(document.snapshot().opaquePayloads)
    if (edited) {
      await approvePattern(sdk, document)
      for (const [id, object] of Object.entries(originalObjects)) {
        if (id !== hatch.id) assert.deepEqual(document.getObject(id), object, `untargeted record ${id}`)
      }
      assert.equal(canonicalStringify(document.snapshot().opaquePayloads), opaqueBefore)
      const after = document.listEntities()
      await document.undo(); assert.deepEqual(document.listEntities(), before)
      assert.equal(canonicalStringify(document.snapshot().opaquePayloads), opaqueBefore)
      await document.redo(); assert.deepEqual(document.listEntities(), after)
    }
    const expectedPattern = edited ? 'PUBLIC_REPLACEMENT' : 'ANSI31'
    const expectedLines = canonicalStringify(document.getObject(hatch.id).payload.patternLines)
    // KJD retains the definition basis; native DXF line data is scaled by the
    // unchanged 0.5 HATCH scale. Compare the exact physical PAT on DXF routes.
    const expectedNativeLines = edited ? canonicalStringify([
      { angle: 0, base: [0, 0], offset: [0, 2], dashes: [0.5, -1.5] },
      { angle: Math.PI / 2, base: [0.5, 0], offset: [2, 0], dashes: [0.5, -1.5] },
    ]) : expectedLines
    let current = document
    for (const format of ['KJD', 'DXF', 'DXF']) {
      current = await sdk.readDocument(await sdk.writeDocument(current, { format }), { format })
      const actual = assertLinkedMetadata(current, expectedPattern), tags = actual.payload.rawTags
      assert.equal(canonicalStringify(geometry(actual)), originalGeometry)
      assert.equal(actual.payload.patternScale, 0.5)
      assert.equal(canonicalStringify(actual.payload.patternLines), format === 'KJD' ? expectedLines : expectedNativeLines)
      assert.deepEqual(tags.filter(tag => tag.code === 47), [{ code: 47, value: '0' }])
      assert.equal(tags.find(tag => tag.code === 77).value, '1')
      const seeds = tags.findIndex(tag => tag.code === 98)
      assert.deepEqual(tags.slice(seeds, seeds + 3), [{ code: 98, value: '1' }, { code: 10, value: '1' }, { code: 20, value: '1' }])
      assert.deepEqual(tags.filter(tag => [430, 440, 284].includes(tag.code)), [{ code: 430, value: 'PUBLIC$COLOR' }, { code: 440, value: '33554560' }, { code: 284, value: '2' }])
      const dictionary = current.snapshot().opaquePayloads[DXF_VIEWPORT_METADATA_KEY].records.find(record => record.type === 'DICTIONARY')
      assert.deepEqual(tags.filter(tag => tag.code === 360), [{ code: 360, value: 'F02' }])
      assert.equal(dictionary.tags.find(tag => tag.code === 330).value, actual.handle)
      assert.deepEqual(tags.filter(tag => tag.code >= 1000), [
        { code: 1001, value: 'PUBLIC_METADATA' }, { code: 1000, value: 'synthetic metadata' },
        { code: 1002, value: '{' }, { code: 1070, value: '17' }, { code: 1071, value: '123456' },
        { code: 1040, value: '2.5' }, { code: 1041, value: '3' }, { code: 1042, value: '4' },
        { code: 1010, value: '1.5' }, { code: 1020, value: '2.5' }, { code: 1030, value: '0' },
        { code: 1004, value: '0AFF' },
        { code: 1005, value: current.getObject(actual.payload.boundaryLoops[0].sourceBoundaryIds[0]).handle },
        { code: 1005, value: 'F03' }, { code: 1005, value: '0' }, { code: 1002, value: '}' },
      ])
      assert.equal(current.listEntities().length, before.length)
      assert.equal(current.validate().valid, true)
    }
  }
})

test('negative, nonfinite, malformed and duplicate HATCH pixel metadata fail closed on unchanged and approved native pattern export', async () => {
  const { sdk, source } = await metadataFixture({ hatchOwned: true })
  for (const invalid of ['-1', '-0.1', 'NaN', 'Infinity', '-Infinity', '1e999', 'invalid', '', '0\n47\n0']) {
    const damaged = source.replace(record(47, 0.1), record(47, invalid))
    assert.notEqual(damaged, source)
    const document = await sdk.readDocument(damaged, { format: 'DXF' })
    for (const edited of [false, true]) {
      if (edited) await approvePattern(sdk, document)
      const before = document.serialize()
      await assert.rejects(sdk.writeDocument(document, { format: 'DXF' }), error =>
        error.code === 'KJFILE_ADAPTER_FAILED' && error.cause?.code === 'KJDOCUMENT_INVALID' &&
        error.cause.message === 'DXF HATCH source metadata cannot be exported without loss: invalid pixel size', `${JSON.stringify(invalid)}/${edited}`)
      assert.equal(document.serialize(), before)
    }
  }
})

test('uncaptured/unknown extension dictionaries, header references and unsafe XDATA never disappear on either export route', async () => {
  for (const kind of ['uncaptured', 'unknown-dictionary', 'unknown-xdata', 'malformed-spatial-xdata', 'header-reference', 'unknown-group']) {
    const value = await metadataFixture({ hatchOwned: true, capture: kind !== 'uncaptured' })
    let source = value.source
    if (kind === 'unknown-dictionary') source = source.replace(record(102, '{ACAD_XDICTIONARY', 360, 'F02'), record(102, '{ACAD_XDICTIONARY', 360, 'DEAD'))
    if (kind === 'unknown-xdata') source = source.replace(record(1005, 'F03'), record(1005, 'DEAD'))
    if (kind === 'malformed-spatial-xdata') source = source.replace(record(1010, 1.5, 1020, 2.5, 1030, 0), record(1010, 1, 1030, 3))
    if (kind === 'header-reference') source = source.replace(record(100, 'AcDbHatch'), record(347, 'DEAD', 100, 'AcDbHatch'))
    if (kind === 'unknown-group') source = source.replace(record(100, 'AcDbHatch'), record(102, '{UNKNOWN_METADATA', 1, 'opaque', 102, '}', 100, 'AcDbHatch'))
    const document = await value.sdk.readDocument(source, { format: 'DXF' })
    for (const edited of [false, true]) {
      if (edited) await approvePattern(value.sdk, document)
      await assert.rejects(value.sdk.writeDocument(document, { format: 'DXF' }), error => /HATCH source metadata|unresolved reactor/.test(error.cause?.message ?? error.message), `${kind}/${edited}`)
    }
  }
})

test('spatial XDATA is preserved for a pattern-only edit but refuses stale geometry/coordinate-system rewrites', async () => {
  for (const kind of ['boundary', 'normal', 'elevation']) {
    const { sdk, document } = await metadataFixture({ hatchOwned: true })
    const hatch = document.listEntities({ type: 'HATCH' })[0]
    await document.transact('An XDATA-aware geometry editor is required', tx => tx.updateObject(hatch.id, { payload: kind === 'boundary'
      ? { boundaryLoops: hatch.payload.boundaryLoops.map(loop => loop.vertices ? { ...loop, vertices: loop.vertices.map(vertex => ({ ...vertex, point: [vertex.point[0] + 1, vertex.point[1], 0] })) } : loop) }
      : kind === 'normal' ? { normal: [0, 1, 0] } : { elevation: 1 } }))
    await assert.rejects(sdk.writeDocument(document, { format: 'DXF' }), error => /spatial XDATA requires unchanged boundary geometry/.test(error.cause?.message ?? error.message))
  }
})

test('native hatch rewrite refuses unsupported subclass metadata rather than discarding it', async () => {
  const { sdk, source } = await fixture()
  const modified = String(source).replaceAll('\r\n', '\n').replace(record(0, 'LWPOLYLINE'), record(450, 1) + record(0, 'LWPOLYLINE'))
  const document = await sdk.readDocument(modified, { format: 'DXF' })
  const unchanged = await sdk.readDocument(await sdk.writeDocument(document, { format: 'DXF' }), { format: 'DXF' })
  assert.equal(unchanged.listEntities({ type: 'HATCH' })[0].payload.rawTags.find(tag => tag.code === 450).value, '1')
  await approvePattern(sdk, document)
  await assert.rejects(sdk.writeDocument(document, { format: 'DXF' }), error => /unsupported hatch subclass field/.test(error.cause?.message ?? error.message))
})

test('independent ezdxf validates extension-dictionary ownership, APPID/XDATA and header metadata before and after native rewrite without repairs', { skip: !process.env.KJDRAW_PYTHON }, async () => {
  const check = `
import io,json,sys,ezdxf
doc=ezdxf.read(io.StringIO(sys.stdin.buffer.read().decode('utf-8'),newline=None))
hatch,=doc.modelspace().query('HATCH')
assert hatch.has_extension_dict
dictionary=hatch.extension_dict.dictionary
assert dictionary.dxf.owner == hatch.dxf.handle
assert dictionary['SYNTHETIC_DATA'].dxftype() == 'XRECORD'
assert dictionary['SYNTHETIC_DATA'].dxf.owner == dictionary.dxf.handle
assert doc.appids.has_entry('PUBLIC_METADATA')
xdata=hatch.get_xdata('PUBLIC_METADATA')
assert [value for code,value in xdata if code == 1005] == [hatch.paths[0].source_boundary_objects[0],'F03','0']
assert [value for code,value in xdata if code == 1000] == ['synthetic metadata']
assert [value for code,value in xdata if code == 1010] == [(1.5,2.5,0)]
assert hatch.dxf.color_name == 'PUBLIC$COLOR'
assert hatch.dxf.transparency == 33554560
assert hatch.dxf.shadow_mode == 2
assert hatch.dxf.pattern_double == 1
assert hatch.dxf.pixel_size == 0.1
assert hatch.seeds == [(1,1)]
audit=doc.audit()
print(json.dumps({'errors':len(audit.errors),'fixes':len(audit.fixes),'dictionary':dictionary.dxf.handle,'xrecord':dictionary['SYNTHETIC_DATA'].dxf.handle}))
`
  const { sdk, source, document } = await metadataFixture({ hatchOwned: true })
  const state = JSON.parse(document.serialize())
  for (const [index, object] of Object.values(state.objects).entries()) object.handle = (0xff0001 + index).toString(16).toUpperCase()
  state.header.handseed = 'FF1000'
  const remapped = sdk.openDocument(state)
  for (const route of ['source', 'raw-remap', 'edited-remap']) {
    if (route === 'edited-remap') await approvePattern(sdk, remapped)
    const output = route === 'source' ? source : await sdk.writeDocument(remapped, { format: 'DXF' })
    const result = spawnSync(process.env.KJDRAW_PYTHON, ['-c', check], { encoding: 'utf8', input: output })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout), { errors: 0, fixes: 0, dictionary: 'F02', xrecord: 'F03' })
  }
})

test('independent ezdxf reads, writes and audits zero-pixel HATCH metadata on source, raw-remap and approved native-remap routes without repairs', { skip: !process.env.KJDRAW_PYTHON }, async () => {
  const check = `
import io,json,sys,ezdxf
data=json.load(sys.stdin)
def facts(doc, expected_pattern):
    hatch,=doc.modelspace().query('HATCH')
    assert hatch.dxf.pixel_size == 0
    assert hatch.dxf.pattern_name == expected_pattern
    assert hatch.dxf.associative == 1
    assert hatch.dxf.pattern_double == 1
    assert len(hatch.paths) == 2
    assert [path.path_type_flags for path in hatch.paths] == [3,0]
    assert hatch.paths[0].vertices == [(0,0,0),(20,0,0),(20,20,0),(0,20,0)]
    edge,=hatch.paths[1].edges
    assert tuple(edge.center) == (10,10)
    assert (edge.radius,edge.start_angle,edge.end_angle,edge.ccw) == (2,0,360,True)
    for index,path in enumerate(hatch.paths):
        assert len(path.source_boundary_objects) == 1
        boundary=doc.entitydb[path.source_boundary_objects[0]]
        assert boundary.is_alive and boundary.dxf.owner == hatch.dxf.owner
        reactors=[doc.entitydb[handle] for handle in boundary.get_reactors()]
        assert all(target.is_alive for target in reactors)
        if index == 0:
            # ezdxf's Reactors API sorts by numeric handle; native wire order is
            # checked separately by the SDK test above. Require all exact targets.
            layout_handle=doc.layouts.get('Layout1').dxf_layout.dxf.handle
            assert sorted(boundary.get_reactors()) == sorted([hatch.dxf.handle,'F03',layout_handle])
            assert sorted(target.dxftype() for target in reactors) == ['HATCH','LAYOUT','XRECORD']
        else: assert boundary.get_reactors() == [hatch.dxf.handle]
    dictionary=hatch.extension_dict.dictionary
    assert dictionary.dxf.handle == 'F02' and dictionary.dxf.owner == hatch.dxf.handle
    xrecord=dictionary['SYNTHETIC_DATA']
    assert xrecord.dxftype() == 'XRECORD' and xrecord.dxf.handle == 'F03' and xrecord.dxf.owner == 'F02'
    assert doc.appids.has_entry('PUBLIC_METADATA')
    xdata=hatch.get_xdata('PUBLIC_METADATA')
    assert [(c,tuple(v) if c==1010 else v) for c,v in xdata] == [
        (1000,'synthetic metadata'),(1002,'{'),(1070,17),(1071,123456),
        (1040,2.5),(1041,3),(1042,4),(1010,(1.5,2.5,0)),(1004,bytes.fromhex('0AFF')),
        (1005,hatch.paths[0].source_boundary_objects[0]),(1005,'F03'),(1005,'0'),(1002,'}')]
    assert hatch.dxf.color_name == 'PUBLIC$COLOR'
    assert hatch.dxf.transparency == 33554560 and hatch.dxf.shadow_mode == 2
    assert hatch.seeds == [(1,1)]
    lines=[(line.angle,tuple(line.base_point),tuple(line.offset),line.dash_length_items) for line in hatch.pattern.lines]
    assert len(lines) == (1 if expected_pattern == 'ANSI31' else 2)
    audit=doc.audit()
    assert not audit.errors and not audit.fixes
    assert len(doc.modelspace().query('HATCH')) == 1
    return {'pixel':hatch.dxf.pixel_size,'pattern':lines,'loops':str(hatch.paths[0].vertices),
        'edge':(tuple(edge.center),edge.radius,edge.start_angle,edge.end_angle,edge.ccw),
        'sources':[path.source_boundary_objects for path in hatch.paths],
        'reactors':[sorted(doc.entitydb[path.source_boundary_objects[0]].get_reactors()) for path in hatch.paths],'seeds':hatch.seeds}
results=[]
for case in data:
    doc=ezdxf.read(io.StringIO(case['text'],newline=None))
    expected=facts(doc,case['pattern'])
    for index in range(2):
        stream=io.StringIO(newline=None)
        doc.write(stream)
        doc=ezdxf.read(io.StringIO(stream.getvalue(),newline=None))
        assert facts(doc,case['pattern']) == expected
    results.append({'route':case['route'],'pixel':0,'linkedLoops':2,'audits':3,'errors':0,'fixes':0})
print(json.dumps(results))
`
  const { sdk, source, document } = await metadataFixture({ hatchOwned: true, pixelSize: 0 })
  const state = JSON.parse(document.serialize())
  for (const [index, object] of Object.values(state.objects).entries()) object.handle = (0xff0001 + index).toString(16).toUpperCase()
  state.header.handseed = 'FF1000'
  const remapped = sdk.openDocument(state), cases = [{ route: 'source', text: source, pattern: 'ANSI31' }]
  cases.push({ route: 'raw-remap', text: await sdk.writeDocument(remapped, { format: 'DXF' }), pattern: 'ANSI31' })
  await approvePattern(sdk, remapped)
  cases.push({ route: 'edited-remap', text: await sdk.writeDocument(remapped, { format: 'DXF' }), pattern: 'PUBLIC_REPLACEMENT' })
  const result = spawnSync(process.env.KJDRAW_PYTHON, ['-c', check], { encoding: 'utf8', input: JSON.stringify(cases) })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), cases.map(({ route }) => ({ route, pixel: 0, linkedLoops: 2, audits: 3, errors: 0, fixes: 0 })))
})

test('generic reactors retain ordered mixed native and validated opaque metadata references', async () => {
  const { sdk, document } = await metadataFixture()
  assert.ok(document.snapshot().opaquePayloads[DXF_VIEWPORT_METADATA_KEY])
  const state = JSON.parse(document.serialize())
  for (const [index, object] of Object.values(state.objects).entries()) object.handle = (0xff0001 + index).toString(16).toUpperCase()
  state.header.handseed = 'FF1000'
  let current = sdk.openDocument(state)
  for (const format of ['KJD', 'DXF', 'DXF']) {
    current = await sdk.readDocument(await sdk.writeDocument(current, { format }), { format })
    const hatch = current.listEntities({ type: 'HATCH' })[0]
    const boundary = current.getObject(hatch.payload.boundaryLoops[0].sourceBoundaryIds[0])
    const layout = current.getObject(current.spaces.layoutIds[1])
    assert.deepEqual(boundary.payload.dxfReactorIds, [hatch.id, layout.id])
    assert.deepEqual(boundary.payload.dxfReactorReferences, [{ id: hatch.id }, { metadataHandle: 'F03' }, { id: layout.id }])
    const metadata = current.snapshot().opaquePayloads[DXF_VIEWPORT_METADATA_KEY]
    assert.equal(metadata.records.find(record => record.type === 'XRECORD').tags.find(tag => tag.code === 5).value, 'F03')
    assert.equal(current.validate().valid, true)
  }
  const hatch = current.listEntities({ type: 'HATCH' })[0]
  const boundary = current.getObject(hatch.payload.boundaryLoops[0].sourceBoundaryIds[0])
  await current.transact('Unresolved opaque reactor', tx => tx.updateObject(boundary.id, { payload: {
    dxfReactorReferences: boundary.payload.dxfReactorReferences.map(reference => 'metadataHandle' in reference ? { metadataHandle: 'DEAD' } : reference),
  } }))
  await assert.rejects(sdk.writeDocument(current, { format: 'DXF' }), error => /reactor metadata target is unavailable/.test(error.cause?.message ?? error.message))
})

test('generic reactors reject erased or non-exported native objects without dropping their references', async () => {
  for (const kind of ['erased', 'unsupported']) {
    const { sdk, document } = await fixture()
    const boundaryId = document.listEntities({ type: 'HATCH' })[0].payload.boundaryLoops[0].sourceBoundaryIds[0]
    await document.transact('Unavailable persistent target', tx => {
      const target = kind === 'erased' ? tx.createEntity('LINE', { start: [30, 0], end: [31, 0] }) : tx.createObject({ kind: 'custom', type: 'UNSUPPORTED_METADATA', payload: {} })
      tx.updateObject(boundaryId, { payload: { dxfReactorIds: [target.id] } })
      if (kind === 'erased') tx.updateObject(target.id, { erased: true })
    })
    await assert.rejects(sdk.writeDocument(document, { format: 'DXF' }), error => /live exported DXF object/.test(error.cause?.message ?? error.message))
  }
})

test('independent ezdxf validates mixed entity, layout and opaque-object reactor graph without repairs', { skip: !process.env.KJDRAW_PYTHON }, async () => {
  const { sdk, document } = await metadataFixture()
  const check = `
import io,json,sys,ezdxf
doc=ezdxf.read(io.StringIO(sys.stdin.buffer.read().decode('utf-8'),newline=None))
hatch,=doc.modelspace().query('HATCH')
boundary=doc.entitydb[hatch.paths[0].source_boundary_objects[0]]
targets=[doc.entitydb[handle] for handle in boundary.get_reactors()]
assert [target.dxftype() for target in targets] == ['HATCH','XRECORD','LAYOUT']
assert all(target.is_alive for target in targets)
audit=doc.audit()
print(json.dumps({'errors':len(audit.errors),'fixes':len(audit.fixes)}))
`
  const result = spawnSync(process.env.KJDRAW_PYTHON, ['-c', check], { encoding: 'utf8', input: await sdk.writeDocument(document, { format: 'DXF' }) })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { errors: 0, fixes: 0 })
})

test('independent ezdxf accepts untouched and edited HATCH source links and reactors without repairs', { skip: !process.env.KJDRAW_PYTHON }, async () => {
  const { sdk, document } = await fixture()
  const check = `
import io,json,sys,ezdxf
doc=ezdxf.read(io.StringIO(sys.stdin.buffer.read().decode('utf-8'),newline=None))
hatch,=doc.modelspace().query('HATCH')
assert hatch.dxf.associative == 1
assert len(hatch.paths) == 2
for path in hatch.paths:
    assert len(path.source_boundary_objects) == 1
    boundary=doc.entitydb[path.source_boundary_objects[0]]
    assert boundary.is_alive
    assert boundary.dxf.owner == hatch.dxf.owner
    assert boundary.get_reactors() == [hatch.dxf.handle]
audit=doc.audit()
print(json.dumps({'errors':len(audit.errors),'fixes':len(audit.fixes),'linkedLoops':len(hatch.paths)}))
`
  for (const edited of [false, true]) {
    if (edited) {
      const hatch = document.listEntities({ type: 'HATCH' })[0]
      await document.transact('Change pattern without boundary repair', tx => tx.updateObject(hatch.id, { payload: { patternAngle: 0.25 } }))
    }
    const result = spawnSync(process.env.KJDRAW_PYTHON, ['-c', check], { encoding: 'utf8', input: await sdk.writeDocument(document, { format: 'DXF' }) })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout), { errors: 0, fixes: 0, linkedLoops: 2 })
  }
})
