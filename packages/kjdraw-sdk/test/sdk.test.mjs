import assert from 'node:assert/strict'
import test from 'node:test'
import {
  KJDocument,
  KJ_EVENT_NAMES,
  KJValidationError,
  auditRoundTrip,
  createKJDrawSDK,
  defineFileAdapter,
  executeRoundTrip,
} from '../src/index.js'

test('creates a valid KJDocument object graph with spaces, layouts and tables', () => {
  const document = KJDocument.create({ documentId: 'drawing-1', title: 'SDK contract' })
  const state = document.snapshot()
  assert.equal(document.validate().valid, true)
  assert.equal(state.schemaVersion, 1)
  assert.equal(state.objects[state.spaces.modelSpaceId].kind, 'block-record')
  assert.equal(state.objects[state.spaces.activeLayoutId].kind, 'layout')
  assert.equal(document.getTable('layers').records[0].name, '0')
  assert.equal(document.listEntities().length, 0)
})

test('commits entity, resource and XData changes as one atomic revision', async () => {
  const document = KJDocument.create({ documentId: 'drawing-2' })
  let changeCount = 0
  document.on(KJ_EVENT_NAMES.CHANGE, () => { changeCount += 1 })
  const entity = await document.transact('Create surveyed line', transaction => {
    const line = transaction.createEntity('LINE', { start: [0, 0, 0], end: [10, 5, 0], layerId: document.snapshot().tables.layers.currentId })
    transaction.setXData(line.id, 'KJSURVEY', [{ code: 1000, value: 'borehole-link' }])
    transaction.putResource('hatches', 'soil-clay', { kind: 'vector-pattern', angle: 45, spacing: 2 })
    return line
  }, { author: 'test', source: 'unit-test' })
  assert.equal(document.revision, 1)
  assert.equal(document.getObject(entity.id).extension.xdata.KJSURVEY[0].value, 'borehole-link')
  assert.equal(document.snapshot().resources.hatches['soil-clay'].spacing, 2)
  assert.equal(document.snapshot().objects[document.snapshot().spaces.modelSpaceId].payload.entityIds[0], entity.id)
  assert.equal(changeCount, 1)
})

test('rolls back the entire transaction when an operation is invalid', async () => {
  const document = KJDocument.create({ documentId: 'drawing-rollback' })
  const before = document.serialize()
  await assert.rejects(
    document.transact('Invalid owner', transaction => transaction.createEntity('LINE', {}, { ownerId: 'missing-space' })),
    KJValidationError,
  )
  assert.equal(document.serialize(), before)
  assert.equal(document.revision, 0)
})

test('transaction draft inspection cannot mutate structurally shared document state', async () => {
  const document = KJDocument.create({ documentId: 'readonly-transaction-draft' })
  const created = await document.transact('Create source', transaction => transaction.createEntity('LINE', { start: [0, 0, 0], end: [5, 0, 0] }))
  const before = document.serialize()
  await assert.rejects(
    document.transact('Attempt hidden mutation', transaction => {
      transaction._draft().objects[created.id].payload.start[0] = 99
    }),
    /draft views are read-only/i,
  )
  assert.equal(document.serialize(), before)
  assert.deepEqual(document.getObject(created.id).payload.start, [0, 0, 0])
})

test('undo and redo preserve the original CAD handle and ownership', async () => {
  const document = KJDocument.create({ documentId: 'drawing-history' })
  const entity = await document.transact('Add circle', transaction => transaction.createEntity('CIRCLE', { center: [2, 3, 0], radius: 4 }))
  const handle = document.getObject(entity.id).handle
  const ownerId = document.getObject(entity.id).ownerId
  assert.equal(await document.undo(), true)
  assert.equal(document.getObject(entity.id), null)
  assert.equal(await document.redo(), true)
  assert.equal(document.getObject(entity.id).handle, handle)
  assert.equal(document.getObject(entity.id).ownerId, ownerId)
  assert.equal(document.revision, 3)
})

test('imports the former flat entities/layers scene through a compatibility migration', () => {
  const document = KJDocument.open({
    id: 'legacy',
    layers: [{ id: 'GEO', name: 'GEO', color: '#ffaa00' }],
    entities: [{ entityId: 'line-1', type: 'line', layer: 'GEO', x1: 0, y1: 0, x2: 10, y2: 0 }],
  })
  const entity = document.getObject('line-1')
  assert.equal(entity.type, 'LINE')
  assert.equal(entity.kind, 'entity')
  assert.equal(document.getTable('layers').records.length, 2)
  assert.equal(document.validate().valid, true)
})

test('routes every command through the document transaction boundary', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'command-document' })
  const entity = await sdk.executeCommand('CREATE', { type: 'ARC', payload: { center: [0, 0, 0], radius: 10, startAngle: 0, endAngle: 90 } })
  assert.equal(document.getObject(entity.id).type, 'ARC')
  await sdk.executeCommand('PROPERTIES', { id: entity.id, patch: { payload: { radius: 12 } } })
  assert.equal(document.getObject(entity.id).payload.radius, 12)
  await sdk.executeCommand('ERASE', { id: entity.id })
  assert.equal(document.getObject(entity.id), null)
  assert.equal(document.getObject(entity.id, { includeErased: true }).erased, true)
  assert.equal(document.revision, 3)
})

test('copy command applies host metadata in the same atomic revision', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'copy-metadata' })
  const source = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [2, 0], manualInsertId: 'source-group' } })
  const revision = document.revision
  const [copy] = await sdk.executeCommand('COPY', { id: source.id, dx: 5, dy: 2, payloadPatch: { manualInsertId: 'copy-group' } })
  assert.equal(document.revision, revision + 1)
  assert.equal(copy.payload.manualInsertId, 'copy-group')
  assert.deepEqual(copy.payload.start, [5, 2, 0])
  assert.deepEqual(document.getObject(source.id).payload.start, [0, 0, 0])
})

test('undo, redo and named selections are available through the public command protocol', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'command-history-selection' })
  const line = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [1, 0] } })
  await sdk.executeCommand('MOVE', { id: line.id, dx: 9, dy: 0 })
  await sdk.executeCommand('UNDO')
  assert.deepEqual(document.getObject(line.id).payload.start, [0, 0, 0])
  await sdk.executeCommand('REDO')
  assert.deepEqual(document.getObject(line.id).payload.start, [9, 0, 0])

  assert.deepEqual(await sdk.executeCommand('SELECT', { id: line.id }), [line.id])
  await sdk.executeCommand('SELECTIONSAVE', { name: 'Primary', description: 'SDK command set' })
  await sdk.executeCommand('SELECT', { operation: 'clear' })
  assert.deepEqual(await sdk.executeCommand('SELECTIONRESTORE', { name: 'Primary' }), [line.id])
})

test('block definitions preserve world placement, support inserts and validate references', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'blocks' })
  const line = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [10, 20], end: [30, 20] } })
  const result = await sdk.executeCommand('BLOCKCREATE', { name: 'Beam', id: line.id, basePoint: [10, 20] })
  assert.equal(result.block.kind, 'block-record')
  assert.deepEqual(document.getObject(line.id).payload.start, [0, 0, 0])
  assert.equal(document.getObject(line.id).ownerId, result.block.id)
  assert.deepEqual(result.insert.payload.position, [10, 20, 0])
  const second = await sdk.executeCommand('BLOCKINSERT', { name: 'Beam', position: [100, 200], scale: [2, 2, 2], rotation: Math.PI / 2 })
  assert.equal(second.payload.blockRecordId, result.block.id)
  assert.deepEqual(second.payload.scale, [2, 2, 2])
  assert.equal(document.validate().valid, true)
  await assert.rejects(sdk.executeCommand('PROPERTIES', { id: second.id, patch: { payload: { blockRecordId: 'missing' } } }), KJValidationError)
})

test('drafting settings and persistent object groups use transactional document state', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'drafting-group' })
  const line = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [1, 0] } })
  await sdk.executeCommand('ORTHO', { enabled: true })
  await sdk.executeCommand('SNAPSETTINGS', { modes: ['endpoint', 'intersection'], radius: 18 })
  const group = await sdk.executeCommand('GROUP', { name: 'Axis', id: line.id })
  assert.equal(document.snapshot().header.systemVariables.ORTHOMODE, 1)
  assert.deepEqual(document.snapshot().header.systemVariables.OSMODE, ['endpoint', 'intersection'])
  assert.equal(document.getObject(group.id).payload.memberIds[0], line.id)
  assert.equal(document.validate().valid, true)
})

test('hatches, drafting tables, layouts and viewports persist in the document graph', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'paper-space' })
  const hatch = await sdk.executeCommand('HATCH', { boundaryLoops: [{ vertices: [[0, 0], [10, 0], [10, 10], [0, 10]] }], patternName: 'ANSI31', patternScale: 2 })
  await sdk.executeCommand('LINETYPE', { name: 'CENTER', description: 'Center line', pattern: [12, -3, 2, -3] })
  await sdk.executeCommand('TEXTSTYLE', { name: 'KJ-CN', fontFamily: 'SimSun', widthFactor: 0.8 })
  await sdk.executeCommand('DIMSTYLE', { name: 'KJ-100', properties: { textHeight: 3.5, arrowSize: 2.5 } })
  await sdk.executeCommand('UCS', { name: 'Site', origin: [1000, 2000, 0] })
  const layout = await sdk.executeCommand('LAYOUT', { operation: 'create', name: 'A3', paper: { width: 420, height: 297, unit: 'mm' } })
  const viewport = await sdk.executeCommand('VIEWPORT', { layoutId: layout.id, center: [210, 148.5], width: 390, height: 267, viewHeight: 1000 })
  assert.equal(hatch.payload.patternName, 'ANSI31')
  assert.equal(document.getTable('linetypes').records.some(record => record.name === 'CENTER'), true)
  assert.equal(document.getTable('textStyles').records.some(record => record.name === 'KJ-CN'), true)
  assert.equal(document.getTable('dimensionStyles').records.some(record => record.name === 'KJ-100'), true)
  assert.equal(document.getTable('ucs').records.some(record => record.name === 'Site'), true)
  assert.equal(document.getObject(layout.id).payload.viewportIds[0], viewport.id)
  assert.equal(viewport.ownerId, layout.payload.blockRecordId)
  assert.equal(document.validate().valid, true)
})

test('local external references reject remote authority and survive detach undo', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'local-xrefs' })
  await assert.rejects(sdk.executeCommand('XREFATTACH', { id: 'remote', source: 'https://example.com/base.dwg' }), /remote URLs/)
  assert.equal(document.revision, 0)
  await sdk.executeCommand('XREFATTACH', { id: 'survey-base', name: '勘察总平', source: { kind: 'project-asset', path: 'assets/xrefs/survey-base.dxf' }, referenceType: 'overlay' })
  assert.equal(document.snapshot().resources.externalReferences['survey-base'].source.kind, 'project-asset')
  await sdk.executeCommand('XREFRELOAD', { id: 'survey-base', status: 'loaded', sha256: 'abcd' })
  assert.equal(document.snapshot().resources.externalReferences['survey-base'].status, 'loaded')
  await sdk.executeCommand('XREFDETACH', { id: 'survey-base' })
  assert.equal(document.snapshot().resources.externalReferences['survey-base'], undefined)
  await document.undo()
  assert.equal(document.snapshot().resources.externalReferences['survey-base'].status, 'loaded')
})

test('layout plot settings, plot styles and viewport updates form a reopenable delivery state', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'plot-delivery' })
  const style = await sdk.executeCommand('PLOTSTYLE', { id: 'kj-monochrome', name: 'KJ 黑白出图', mappings: { 1: { color: '#000000', lineweight: 0.25 } } })
  const layout = await sdk.executeCommand('LAYOUT', { operation: 'create', name: '成果图-A3', paper: { width: 420, height: 297, unit: 'mm' } })
  await sdk.executeCommand('PLOTSETUP', { layoutId: layout.id, device: 'pdf', media: 'ISO_A3', area: 'layout', scale: 'fit', plotStyleId: style.id, outputQualityDpi: 600 })
  const viewport = await sdk.executeCommand('VIEWPORT', { layoutId: layout.id, center: [210, 148.5], width: 390, height: 267, viewHeight: 100 })
  await sdk.executeCommand('VIEWPORT', { operation: 'update', id: viewport.id, patch: { twistAngle: Math.PI / 6, frozenLayerIds: [] } })
  const reopened = KJDocument.open(document.serialize())
  assert.equal(reopened.getObject(layout.id).payload.plotSettings.plotStyleId, 'kj-monochrome')
  assert.equal(reopened.getObject(layout.id).payload.plotSettings.scale.mode, 'fit')
  assert.equal(reopened.getObject(viewport.id).payload.twistAngle, Math.PI / 6)
})

test('drawing search and handle-based comparison return auditable structured results', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'search-compare' })
  const line = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [10, 0] }, options: { name: 'Tunnel axis' } })
  await document.transact('Attach evidence', tx => tx.setXData(line.id, 'KJSURVEY', [{ code: 1000, value: 'Borehole ZK-17' }]))
  const byName = await sdk.executeCommand('SEARCH', { query: 'tunnel' })
  const byEvidence = await sdk.executeCommand('SEARCH', { query: 'zk-17' })
  assert.equal(byName.matches[0].id, line.id)
  assert.equal(byEvidence.matches[0].matchedFields.includes('xdata'), true)
  const other = document.toJSON()
  other.objects[line.id].payload.end = [20, 0, 0]
  const comparison = await sdk.executeCommand('COMPARE', { other })
  assert.equal(comparison.identical, false)
  assert.equal(comparison.changed.some(row => row.handle === line.handle), true)
})

test('disposes all command and extension contributions owned by one plugin scope', () => {
  const sdk = createKJDrawSDK()
  const manifest = {
    schema: 'com.kanjie.kjdraw.plugin', schemaVersion: 1,
    id: 'example.plugin', name: 'Example plugin', version: '1.0.0',
    compatibility: { sdk: '>=0.2.0 <1.0.0', kernel: '*' },
    permissions: ['commands.register', 'extensions.register'],
    contributes: { commands: ['EXAMPLE'], extensions: ['entity-type/EXAMPLE_ENTITY'] },
  }
  const plugin = sdk.createPluginScope(manifest, { grantedPermissions: manifest.permissions })
  plugin.registerExtension('entity-type', { id: 'EXAMPLE_ENTITY', schema: { points: 'Point2[]' } })
  plugin.registerCommand({ id: 'EXAMPLE', transactional: false, execute: () => 42 })
  assert.ok(sdk.extensions.get('entity-type', 'EXAMPLE_ENTITY'))
  assert.ok(sdk.commands.resolve('EXAMPLE'))
  plugin.dispose()
  assert.equal(sdk.extensions.get('entity-type', 'EXAMPLE_ENTITY'), null)
  assert.equal(sdk.commands.resolve('EXAMPLE'), null)
})

test('keeps executable extension hooks and rejects command aliases atomically', () => {
  const sdk = createKJDrawSDK()
  const render = () => 'frame'
  sdk.extensions.register('renderer', { id: 'test-renderer', render })
  assert.equal(sdk.extensions.get('renderer', 'test-renderer').render(), 'frame')
  sdk.commands.register({ id: 'FIRST', aliases: ['ZZ'], transactional: false, execute: () => 1 })
  assert.throws(() => sdk.commands.register({ id: 'SECOND', aliases: ['ZZ'], transactional: false, execute: () => 2 }))
  assert.equal(sdk.commands.resolve('SECOND'), null)
  assert.equal(sdk.commands.resolve('ZZ').id, 'FIRST')
})

test('declares file capabilities and passes an exact KJD round-trip audit', async () => {
  const sdk = createKJDrawSDK()
  sdk.fileAdapters.register(defineFileAdapter({
    id: 'kjd-json',
    vendor: 'Kanjie',
    formats: { KJD: { read: ['1'], write: ['1'] } },
    preservation: { handles: 'exact', ownership: 'exact', opaqueObjects: 'exact' },
    read: source => JSON.parse(source),
    write: document => document.serialize(),
  }))
  const document = sdk.createDocument({ documentId: 'roundtrip' })
  await document.transact('Create line', transaction => transaction.createEntity('LINE', { start: [0, 0, 0], end: [1, 1, 0] }))
  const result = await executeRoundTrip(sdk.fileAdapters, document, { format: 'KJD', version: '1' })
  assert.equal(result.audit.passed, true)
  assert.equal(result.audit.findings.length, 0)
  assert.equal(sdk.fileAdapters.capabilityMatrix()[0].preservation.handles, 'exact')
})

test('ships a default KJD adapter with browser-safe read, write and sniff paths', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'default-kjd' })
  await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [2, 3], radius: 5 } })
  const artifact = await sdk.writeDocument(document, { format: 'KJD', version: '1' })
  assert.equal(await sdk.fileAdapters.get('kanjie.kjd.v1').sniff(new TextEncoder().encode(artifact)), true)
  sdk.closeDocument(document.id)
  const reopened = await sdk.readDocument(artifact, { format: 'KJD', version: '1' })
  assert.equal(reopened.id, 'default-kjd')
  assert.equal(reopened.listEntities({ type: 'CIRCLE' }).length, 1)
  assert.equal(sdk.activeDocument.id, 'default-kjd')
})

test('round-trip audit blocks silent entity and opaque payload loss', async () => {
  const source = KJDocument.create({ documentId: 'audit-source' })
  await source.transact('Add protected data', transaction => {
    transaction.createEntity('SPLINE', { controlPoints: [[0, 0], [1, 2], [3, 1]], degree: 2 })
    transaction.putOpaquePayload('dwg:unknown:AA', { className: 'AcDbFutureObject', bytes: '010203' })
  })
  const damagedState = source.toJSON()
  const entityId = Object.values(damagedState.objects).find(object => object.kind === 'entity').id
  delete damagedState.objects[entityId]
  damagedState.objects[damagedState.spaces.modelSpaceId].payload.entityIds = []
  damagedState.opaquePayloads = {}
  const audit = auditRoundTrip(source, KJDocument.open(damagedState), { format: 'DWG' })
  assert.equal(audit.passed, false)
  assert.ok(audit.findings.some(finding => finding.code === 'ENTITYTYPES_MISMATCH'))
  assert.ok(audit.findings.some(finding => finding.code === 'OPAQUEPAYLOADCOUNT_MISMATCH'))
})
