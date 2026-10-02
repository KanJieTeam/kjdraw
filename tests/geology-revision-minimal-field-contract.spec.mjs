import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession, KJDRAW_AGENT_TOOLS } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { compileGeologySection } from '../packages/kjdraw-sdk/src/geology-engineering.js'
import { readGeologyDrawingRecipe, registerGeologyDrawingRecipe } from '../packages/kjdraw-sdk/src/geology-drawing-update.js'
import { canonicalStringify } from '../packages/kjdraw-sdk/src/utils.js'

// Actual native SDK/host selftests, not provider calls or model-pass evidence.
const clone = structuredClone
const tool = KJDRAW_AGENT_TOOLS.find(item => item.name === 'cad_propose_geology_revision')
const stripDescriptions = value => Array.isArray(value) ? value.map(stripDescriptions)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'description')
    .map(([key, item]) => [key, stripDescriptions(item)])) : value
const content = document => {
  const { objects, tables, spaces, opaquePayloads } = document.snapshot()
  return { objects, tables, spaces, opaquePayloads }
}

test('minimal field descriptions do not alter any existing revision schema shape or required field', () => {
  const hash = createHash('sha256').update(canonicalStringify(stripDescriptions(tool.inputSchema))).digest('hex')
  assert.equal(hash, '53df96611dea141f8efc3e1d3a44d5d0f21575c77c2ca793546a5343ad99ee01')
  assert.deepEqual(tool.inputSchema.required, ['expectedRevision', 'units', 'drawingId', 'updates'])
  assert.deepEqual(Object.keys(tool.inputSchema.properties), ['expectedRevision', 'units', 'drawingId', 'updates',
    'correlations', 'uncorrelatedOccurrences', 'linkChanges'])
  assert.equal(tool.inputSchema.additionalProperties, false)
})

for (const [name, description] of [
  ['tool', tool.description],
  ['updates', tool.inputSchema.properties.updates.description],
  ['correlations', tool.inputSchema.properties.correlations.description],
  ['uncorrelatedOccurrences', tool.inputSchema.properties.uncorrelatedOccurrences.description],
]) test(`${name}: published scalar-only contract omits both complete link lists and distinguishes missing from empty`, () => {
  assert.match(description, /scalar-only/i)
  assert.match(description, /omit/i)
  assert.match(description, /correlations/)
  assert.match(description, /uncorrelatedOccurrences/)
  assert.match(description, /missing[^.]*not[^.]*\[\]/i)
  assert.match(description, /explicitly.*(?:requested|declared)/i)
})

function sourceInput(locale, state) {
  const input = { expectedRevision: 0, sourceFactMode: 'complete-occurrence-map', locale,
    holes: ['MIN-A', 'MIN-B'].map((id, index) => ({ id, station: index * 20, collarElevation: 106 + index,
      depth: 18, stableWaterDepth: 4,
      strata: [
        { intervalId: `${id}-FILL`, code: '1', name: 'Fill', top: 0, bottom: 3, lithology: 'fill' },
        { intervalId: `${id}-CLAY`, code: '2', name: 'Clay', top: 3, bottom: 10, lithology: 'clay', description: 'Retained caller description' },
        { intervalId: `${id}-SAND`, code: '3', name: 'Sand', top: 10, bottom: 18, lithology: 'sand' },
      ], observations: [{ kind: 'sample', id: `${id}-S`, depth: 5, rangeTop: 4, rangeBottom: 6,
        measurements: { density: 1.84, waterContent: 22 } }, { kind: 'spt', id: `${id}-N`, depth: 12, value: 16 }],
    })),
    correlations: ['SAND', 'FILL', 'CLAY'].map(suffix => ({ fromHoleId: 'MIN-A', toHoleId: 'MIN-B',
      fromIntervalId: `MIN-A-${suffix}`, toIntervalId: `MIN-B-${suffix}` })),
    horizontalScaleDenominator: 200, verticalScaleDenominator: 200, datumElevation: 85,
    surfaceRule: 'straight-between-supplied-collars',
  }
  if (state === 'empty') input.uncorrelatedOccurrences = []
  if (state === 'nonempty') {
    input.correlations = input.correlations.slice(1)
    input.uncorrelatedOccurrences = [
      { holeId: 'MIN-A', adjacentHoleId: 'MIN-B', intervalId: 'MIN-A-SAND' },
      { holeId: 'MIN-B', adjacentHoleId: 'MIN-A', intervalId: 'MIN-B-SAND' },
    ]
  }
  return input
}
async function setup(locale, state = 'absent') {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const input = sourceInput(locale, state)
  await sdk.executeCommand('CREATEBATCH', clone(compileGeologySection(input).commandArgs), { document })
  await registerGeologyDrawingRecipe(document, { kind: 'section', input }, { expectedRevision: document.revision })
  await sdk.executeCommand('CREATEBATCH', { entities: [{ type: 'CIRCLE', options: { id: 'MIN-UNTOUCHED' },
    payload: { center: [460, 160, 0], radius: 3, layerId: document.getTable('layers').currentId } }] }, { document })
  const session = new KJAgentToolSession(sdk, document)
  const listing = await session.call('cad_read_geology_source', { drawingId: '', expectedRevision: document.revision, maxBytes: 8192 })
  assert.equal(listing.ok, true)
  assert.equal(listing.value.drawingIds.length, 1)
  const drawingId = listing.value.drawingIds[0]
  const sourceRead = await session.call('cad_read_geology_source', { drawingId, expectedRevision: document.revision, maxBytes: 262144 })
  assert.equal(sourceRead.ok, true)
  assert.equal(sourceRead.value.documentId, document.id)
  assert.equal(sourceRead.value.revision, document.revision)
  return { sdk, document, session, drawingId, sourceRead,
    dispose: () => { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) } }
}
const request = fixture => ({ expectedRevision: fixture.document.revision, units: 'millimeter', drawingId: fixture.drawingId,
  updates: [{ holeId: 'MIN-A', stableWaterDepth: 4.5 }] })
const source = fixture => readGeologyDrawingRecipe(fixture.document, fixture.drawingId).source

for (const locale of ['zh-CN', 'en']) for (const mode of ['absent', 'empty', 'nonempty', 'caller-explicit-empty'])
  test(`${locale} ${mode}: scalar proposal → approval → undo/redo → actual KJD/history reopen preserves exact optional source state`, async () => {
    const fixture = await setup(locale, mode === 'caller-explicit-empty' ? 'absent' : mode)
    const { sdk, document, session, drawingId } = fixture
    try {
      const before = document.snapshot(), beforeContent = content(document), beforeHistory = clone(document.history)
      const beforeSource = clone(source(fixture)), expectedSource = clone(beforeSource), args = request(fixture)
      expectedSource.input.holes[0].stableWaterDepth = 4.5
      if (mode === 'caller-explicit-empty') {
        args.correlations = clone(beforeSource.input.correlations)
        args.uncorrelatedOccurrences = []
        expectedSource.input.uncorrelatedOccurrences = []
      }
      const originalArgs = clone(args), result = await session.call(tool.name, args)
      assert.equal(result.ok, true, JSON.stringify(result.error))
      const proposal = result.value
      assert.equal(proposal.status, 'awaiting-host-approval')
      assert.equal(proposal.command, 'GEOLOGY_DRAWING_UPDATE')
      assert.deepEqual(args, originalArgs, 'No model argument stripping, defaulting or correction')
      assert.deepEqual(document.snapshot(), before)
      assert.deepEqual(document.history, beforeHistory)
      assert.deepEqual(source(fixture), beforeSource)
      assert.deepEqual(proposal.engineeringEvidence.beforeSource.facts, fixture.sourceRead.value.facts)
      assert.deepEqual(proposal.engineeringEvidence.afterSource.facts, expectedSource.input)
      assert.equal(Object.hasOwn(proposal.engineeringEvidence.afterSource.facts, 'uncorrelatedOccurrences'), mode !== 'absent')
      assert.deepEqual(proposal.engineeringEvidence.afterSource.facts.correlations, beforeSource.input.correlations)
      const untouched = Object.values(before.objects).filter(record => !proposal.preview.before.some(entity => entity.id === record.id) && record.kind === 'entity')
      assert.ok(untouched.some(record => record.id === 'MIN-UNTOUCHED'))
      assert.ok(untouched.some(record => record.type === 'HATCH'))
      const approval = await session.approve(proposal.planId, 'minimal-field-public-host')
      assert.equal(approval.ok, true, JSON.stringify(approval.error))
      assert.equal(approval.value.status, 'committed')
      assert.equal(approval.value.beforeRevision, before.revision)
      assert.equal(approval.value.afterRevision, before.revision + 1)
      assert.equal(document.history.undoCount, beforeHistory.undoCount + 1)
      assert.deepEqual(source(fixture), expectedSource)
      for (const record of untouched) assert.deepEqual(document.getObject(record.id), record, 'Unrequested payload/ID/handle stays exact')
      assert.deepEqual(document.snapshot().tables, before.tables)
      assert.deepEqual(document.snapshot().spaces, before.spaces)
      const afterContent = content(document)
      const undoRead = await session.call('cad_read_history', { expectedRevision: document.revision })
      const undo = await session.call('cad_propose_undo', { expectedRevision: document.revision, units: 'millimeter', targetHistoryId: undoRead.value.history.undoTarget.id })
      assert.equal(undo.ok, true)
      assert.equal((await session.approve(undo.value.planId, 'minimal-field-public-host')).ok, true)
      assert.deepEqual(content(document), beforeContent)
      assert.deepEqual(source(fixture), beforeSource)
      const redoRead = await session.call('cad_read_history', { expectedRevision: document.revision })
      const redo = await session.call('cad_propose_redo', { expectedRevision: document.revision, units: 'millimeter', targetHistoryId: redoRead.value.history.redoTarget.id })
      assert.equal(redo.ok, true)
      assert.equal((await session.approve(redo.value.planId, 'minimal-field-public-host')).ok, true)
      assert.deepEqual(content(document), afterContent)
      assert.deepEqual(source(fixture), expectedSource)
      const reopenedSdk = createKJDrawSDK()
      try {
        const reopened = await reopenedSdk.readDocument(await sdk.writeDocument(document, { format: 'KJD' }), { format: 'KJD' })
        assert.equal(canonicalStringify(reopened.snapshot()), canonicalStringify(document.snapshot()))
        assert.deepEqual(readGeologyDrawingRecipe(reopened, drawingId).source, expectedSource)
        assert.equal(reopened.history.undoCount, 0)
        await reopened.restoreHistory(document.exportHistory())
        assert.notEqual(reopened.history.undoTarget.id, document.history.undoTarget.id)
        await reopened.undo()
        assert.equal(canonicalStringify(content(reopened)), canonicalStringify(beforeContent))
        assert.deepEqual(readGeologyDrawingRecipe(reopened, drawingId).source, beforeSource)
        await reopened.redo()
        assert.equal(canonicalStringify(content(reopened)), canonicalStringify(afterContent))
        assert.deepEqual(readGeologyDrawingRecipe(reopened, drawingId).source, expectedSource)
      } finally { for (const id of [...reopenedSdk.documents.keys()]) reopenedSdk.closeDocument(id) }
    } finally { fixture.dispose() }
  })

for (const edit of [
  { name: 'explicit empty list removes required unlinked coverage', change: args => { args.uncorrelatedOccurrences = [] } },
  { name: 'null is not omitted source', change: args => { args.uncorrelatedOccurrences = null } },
]) test(`${edit.name}: caller arguments are not silently sanitized, invalid request has no plan or native mutation`, async () => {
  const fixture = await setup('en', 'nonempty')
  try {
    const args = request(fixture)
    edit.change(args)
    const originalArgs = clone(args), before = fixture.document.snapshot(), archive = fixture.document.exportHistory()
    const plans = fixture.sdk.agentPlans.list(), originalSource = clone(source(fixture))
    const result = await fixture.session.call(tool.name, args)
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'KJDOCUMENT_INVALID')
    assert.equal(Object.hasOwn(result, 'value'), false)
    assert.deepEqual(args, originalArgs)
    assert.deepEqual(fixture.document.snapshot(), before)
    assert.deepEqual(fixture.document.exportHistory(), archive)
    assert.deepEqual(fixture.sdk.agentPlans.list(), plans)
    assert.deepEqual(source(fixture), originalSource)
  } finally { fixture.dispose() }
})
