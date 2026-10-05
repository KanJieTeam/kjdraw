import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { compileGeologySection } from '../packages/kjdraw-sdk/src/geology-engineering.js'
import { readGeologyDrawingRecipe, registerGeologyDrawingRecipe } from '../packages/kjdraw-sdk/src/geology-drawing-update.js'
import { KJValidationError } from '../packages/kjdraw-sdk/src/errors.js'

// Actual native engine/approval selftests. No provider request or model-pass claim.
const clone = value => structuredClone(value)
const prefix = 'Geology: complete occurrence map requires exact interval-ID correlations'
const exactFields = 'fromHoleId, toHoleId, fromIntervalId, toIntervalId'
function input() {
  return { expectedRevision: 0, sourceFactMode: 'complete-occurrence-map', locale: 'en',
    holes: ['DIAG-A', 'DIAG-B'].map((id, index) => ({ id, station: index * 20, collarElevation: 106 + index,
      depth: 18, stableWaterDepth: 4, observations: [{ kind: 'sample', id: `${id}-SAMPLE`, depth: 5 }],
      strata: [
        { intervalId: `${id}-FILL`, code: '1', name: 'Fill', top: 0, bottom: 3, lithology: 'fill' },
        { intervalId: `${id}-CLAY`, code: '2', name: 'Clay', top: 3, bottom: 10, lithology: 'clay' },
        { intervalId: `${id}-SAND`, code: '3', name: 'Sand', top: 10, bottom: 18, lithology: 'sand' },
      ],
    })),
    correlations: ['FILL', 'CLAY', 'SAND'].map(suffix => ({ fromHoleId: 'DIAG-A', toHoleId: 'DIAG-B',
      fromIntervalId: `DIAG-A-${suffix}`, toIntervalId: `DIAG-B-${suffix}` })),
    horizontalScaleDenominator: 200, verticalScaleDenominator: 200, datumElevation: 85,
    surfaceRule: 'straight-between-supplied-collars',
  }
}
function unlinkedSand(facts) {
  return { correlations: clone(facts.correlations.slice(0, 2)),
    uncorrelatedOccurrences: [
      { holeId: 'DIAG-A', adjacentHoleId: 'DIAG-B', intervalId: 'DIAG-A-SAND' },
      { holeId: 'DIAG-B', adjacentHoleId: 'DIAG-A', intervalId: 'DIAG-B-SAND' },
    ],
  }
}
const variants = [
  { name: 'mixed exact and both legacy selectors', index: 0, legacy: ['fromStratumCode', 'toStratumCode'],
    change: facts => Object.assign(facts.correlations[0], { fromStratumCode: '1', toStratumCode: '1' }) },
  { name: 'mixed exact and only fromStratumCode', index: 1, legacy: ['fromStratumCode'],
    change: facts => Object.assign(facts.correlations[1], { fromStratumCode: '2' }) },
  { name: 'mixed exact and only toStratumCode', index: 1, legacy: ['toStratumCode'],
    change: facts => Object.assign(facts.correlations[1], { toStratumCode: '2' }) },
  { name: 'pure legacy selectors', index: 0, legacy: ['fromStratumCode', 'toStratumCode'], missing: ['fromIntervalId', 'toIntervalId'],
    change: facts => { facts.correlations[0] = { fromHoleId: 'DIAG-A', toHoleId: 'DIAG-B', fromStratumCode: '1', toStratumCode: '1' } } },
  { name: 'missing fromIntervalId', index: 1, legacy: [], missing: ['fromIntervalId'],
    change: facts => { delete facts.correlations[1].fromIntervalId } },
  { name: 'missing both interval IDs', index: 0, legacy: [], missing: ['fromIntervalId', 'toIntervalId'],
    change: facts => { delete facts.correlations[0].fromIntervalId; delete facts.correlations[0].toIntervalId } },
]
function assertDiagnostic(message, variant) {
  assert.ok(message.startsWith(prefix), message)
  assert.ok(message.includes(`correlations[${variant.index}]`), message)
  assert.ok(message.includes(`Allowed exact correlation fields: ${exactFields}`), message)
  if (variant.legacy.length) {
    assert.ok(message.includes(`remove legacy selector fields ${variant.legacy.join(', ')}`), message)
    assert.match(message, /keep the actual source interval IDs/)
  } else assert.doesNotMatch(message, /remove legacy selector fields/)
  if (variant.missing?.length) {
    assert.ok(message.includes(`missing interval-ID fields ${variant.missing.join(', ')}`), message)
    assert.match(message, /read the actual source interval IDs; never guess them/)
  }
  // Paths and field names are actionable; raw user source values are not echoed.
  assert.doesNotMatch(message, /DIAG-A|DIAG-B|RAW-SOURCE-VALUE/)
}

for (const variant of variants) test(`compiler correlation diagnostic: ${variant.name}; caller source is never corrected`, () => {
  const facts = input()
  variant.change(facts)
  const before = clone(facts)
  assert.throws(() => compileGeologySection(facts), error => {
    assert.ok(error instanceof KJValidationError)
    assert.equal(error.code, 'KJDOCUMENT_INVALID')
    assertDiagnostic(error.message, variant)
    return true
  })
  assert.deepEqual(facts, before)
})

test('diagnostic reports the first invalid correlation index without exposing legacy values or rewriting later links', () => {
  const facts = input()
  facts.correlations[2].fromStratumCode = 'RAW-SOURCE-VALUE'
  const before = clone(facts)
  assert.throws(() => compileGeologySection(facts), error => {
    assertDiagnostic(error.message, { index: 2, legacy: ['fromStratumCode'] })
    assert.doesNotMatch(error.message, /correlations\[0\]|correlations\[1\]/)
    return true
  })
  assert.deepEqual(facts, before)
})

test('valid complete exact interval tuples compile unchanged and create native HATCH geometry', () => {
  const facts = input(), before = clone(facts)
  const compiled = compileGeologySection(facts)
  assert.ok(compiled.commandArgs.entities.some(entity => entity.type === 'HATCH'))
  assert.deepEqual(facts, before)
  for (const correlation of facts.correlations) assert.deepEqual(Object.keys(correlation).sort(), exactFields.split(', ').sort())
})

test('illustrative legacy-code correlations remain compatible; complete-only diagnostic does not change that API', () => {
  const facts = input()
  facts.sourceFactMode = 'illustrative'
  facts.correlations = ['1', '2', '3'].map(code => ({ fromHoleId: 'DIAG-A', toHoleId: 'DIAG-B', fromStratumCode: code, toStratumCode: code }))
  const before = clone(facts), compiled = compileGeologySection(facts)
  assert.ok(compiled.commandArgs.entities.some(entity => entity.type === 'HATCH'))
  assert.deepEqual(facts, before)
})

async function setup() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const facts = input()
  await sdk.executeCommand('CREATEBATCH', clone(compileGeologySection(facts).commandArgs), { document })
  await registerGeologyDrawingRecipe(document, { kind: 'section', input: facts }, { expectedRevision: document.revision })
  await sdk.executeCommand('CREATEBATCH', { entities: [{ id: 'DIAG-MANUAL', type: 'CIRCLE',
    payload: { center: [460, 150, 0], radius: 4, layerId: document.getTable('layers').currentId } }] }, { document })
  const session = new KJAgentToolSession(sdk, document)
  const listing = await session.call('cad_read_geology_source', { drawingId: '', expectedRevision: document.revision, maxBytes: 8192 })
  assert.equal(listing.ok, true)
  assert.equal(listing.value.drawingIds.length, 1)
  return { sdk, document, session, drawingId: listing.value.drawingIds[0],
    dispose: () => { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) } }
}
const request = (fixture, lists) => ({ drawingId: fixture.drawingId, expectedRevision: fixture.document.revision,
  units: 'millimeter', updates: [], ...clone(lists) })

for (const variant of variants) test(`actual SDK rejection: ${variant.name}; no plan, source/object/history/resource mutation`, async () => {
  const fixture = await setup()
  const { document, session, sdk, drawingId } = fixture
  try {
    const before = document.snapshot(), history = clone(document.history), fingerprint = document.fingerprint()
    const archive = document.exportHistory(), plans = sdk.agentPlans.list()
    const originalSource = clone(readGeologyDrawingRecipe(document, drawingId).source)
    const lists = unlinkedSand(originalSource.input)
    variant.change(lists)
    const args = request(fixture, lists), originalArgs = clone(args)
    const result = await session.call('cad_propose_geology_revision', args)
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'KJDOCUMENT_INVALID')
    assertDiagnostic(result.error.message, variant)
    assert.equal(Object.hasOwn(result, 'value'), false)
    assert.deepEqual(args, originalArgs)
    assert.deepEqual(document.snapshot(), before)
    assert.deepEqual(document.history, history)
    assert.deepEqual(document.exportHistory(), archive)
    assert.equal(document.fingerprint(), fingerprint)
    assert.deepEqual(sdk.agentPlans.list(), plans)
    assert.deepEqual(readGeologyDrawingRecipe(document, drawingId).source, originalSource)
  } finally { fixture.dispose() }
})

test('actual SDK accepts explicit valid exact replacement only as a pending plan; host approval then changes only declared source links', async () => {
  const fixture = await setup()
  const { sdk, document, session, drawingId } = fixture
  try {
    const sourceRead = await session.call('cad_read_geology_source', { drawingId, expectedRevision: document.revision, maxBytes: 262144 })
    assert.equal(sourceRead.ok, true)
    const originalSource = clone(readGeologyDrawingRecipe(document, drawingId).source)
    const lists = unlinkedSand(originalSource.input), before = document.snapshot(), history = clone(document.history)
    const manual = clone(document.getObject('DIAG-MANUAL'))
    const tables = clone(document.snapshot().tables), spaces = clone(document.snapshot().spaces)
    const result = await session.call('cad_propose_geology_revision', request(fixture, lists))
    assert.equal(result.ok, true, JSON.stringify(result.error))
    assert.equal(result.value.status, 'awaiting-host-approval')
    assert.equal(result.value.command, 'GEOLOGY_DRAWING_UPDATE')
    assert.deepEqual(document.snapshot(), before)
    assert.deepEqual(document.history, history)
    assert.deepEqual(result.value.engineeringEvidence.afterSource.facts.holes, originalSource.input.holes)
    assert.deepEqual(result.value.engineeringEvidence.afterSource.facts.correlations, lists.correlations)
    assert.deepEqual(result.value.engineeringEvidence.afterSource.facts.uncorrelatedOccurrences, lists.uncorrelatedOccurrences)
    const approved = await session.approve(result.value.planId, 'native-diagnostic-selftest-reviewer')
    assert.equal(approved.ok, true, JSON.stringify(approved.error))
    assert.equal(approved.value.status, 'committed')
    assert.equal(document.revision, before.revision + 1)
    assert.equal(document.history.undoCount, history.undoCount + 1)
    assert.deepEqual(readGeologyDrawingRecipe(document, drawingId).source, {
      ...originalSource, input: { ...originalSource.input, ...lists },
    })
    assert.deepEqual(document.getObject('DIAG-MANUAL'), manual)
    assert.deepEqual(document.snapshot().tables, tables)
    assert.deepEqual(document.snapshot().spaces, spaces)
    assert.ok(document.listEntities({ type: 'HATCH' }).length > 0)
  } finally { fixture.dispose() }
})
