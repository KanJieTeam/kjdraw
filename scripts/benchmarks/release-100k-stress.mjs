import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { availableParallelism, cpus, totalmem } from 'node:os'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import process from 'node:process'

import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/sdk.js'
import { KJCanvasRenderer } from '../../packages/kjdraw-sdk/src/canvas-renderer.js'

const ENTITY_COUNT = 100_000
const MODEL_ENTITY_COUNT = 99_958
const BLOCK_COUNT = 10
const BLOCK_MEMBER_COUNT = 40
const PAPER_LAYOUT_COUNT = 2
const CREATE_BATCH_SIZE = 10_000
const FIXTURE_VERSION = 'com.kanjie.kjdraw.release-100k-mixed@1'

// These are release guardrails for a single local Node process, not public hardware
// claims. They deliberately leave headroom for shared CI runners while still
// rejecting hangs, unbounded memory growth and order-of-magnitude regressions.
const budgets = Object.freeze({
  maximumTimingsMs: Object.freeze({
    buildFixtureSpecsMs: 500,
    createDocumentMs: 15_000,
    firstCanvasFrameMs: 2_000,
    completeCanvasFrameMs: 3_000,
    queryEntitiesMs: 500,
    selectByPropertyMs: 750,
    editMove100Ms: 2_000,
    undoMs: 1_500,
    redoMs: 1_500,
    serializeKjdMs: 5_000,
    reopenKjdMs: 8_000,
  }),
  maximumRssMiB: 1_800,
  maximumHeapUsedMiB: 1_450,
  maximumKjdMiB: 64,
})

const timingsMs = {}
const memoryMiB = {}

function round(value) { return Number(value.toFixed(2)) }
function memory() {
  const value = process.memoryUsage()
  return Object.fromEntries(['rss', 'heapUsed', 'heapTotal', 'external'].map(key => [key, round(value[key] / 1024 / 1024)]))
}
function sampleMemory(stage) { memoryMiB[stage] = memory(); return memoryMiB[stage] }
async function measure(name, work) {
  const started = performance.now()
  const value = await work()
  timingsMs[name] = round(performance.now() - started)
  sampleMemory(name)
  return value
}

function noopCanvas(width = 1600, height = 1000) {
  const context = new Proxy({
    measureText(value) {
      const size = Number.parseFloat(this.font) || 12
      return { width: String(value).length * size * 0.58, actualBoundingBoxAscent: size * 0.78 }
    },
    getLineDash() { return [] },
    createPattern() { return null },
  }, {
    get(target, key) { return key in target ? target[key] : () => undefined },
    set(target, key, value) { target[key] = value; return true },
  })
  return {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    style: {},
    getContext: kind => kind === '2d' ? context : null,
    getBoundingClientRect: () => ({ x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height }),
  }
}

function entityId(prefix, index) { return `${prefix}-${String(index).padStart(6, '0')}` }

function buildFixture() {
  const continuousId = 'stress-lt-continuous'
  const layers = [
    ['STRESS-LINES', 7, 18],
    ['STRESS-CIRCLES', 3, 18],
    ['STRESS-POLYLINES', 1, 25],
    ['STRESS-TEXT', 2, 18],
    ['STRESS-HATCH', 8, 13],
    ['STRESS-BLOCKS', 5, 25],
    ['STRESS-PAPER', 7, 25],
  ].map(([name, color, lineweight], index) => ({ id: `stress-layer-${index}`, name, color, linetypeId: continuousId, lineweight }))
  const layerId = Object.fromEntries(layers.map(layer => [layer.name, layer.id]))
  const blocks = Array.from({ length: BLOCK_COUNT }, (_, index) => {
    const id = `stress-block-${index}`
    const size = 6 + index
    return {
      id,
      name: `STRESS_SYMBOL_${String(index).padStart(2, '0')}`,
      basePoint: [0, 0, 0],
      entities: [
        { type: 'LINE', payload: { start: [-size, 0, 0], end: [size, 0, 0], layerId: layerId['STRESS-BLOCKS'] }, options: { id: `${id}-member-0` } },
        { type: 'LINE', payload: { start: [0, -size, 0], end: [0, size, 0], layerId: layerId['STRESS-BLOCKS'] }, options: { id: `${id}-member-1` } },
        { type: 'CIRCLE', payload: { center: [0, 0, 0], radius: size * 0.7, layerId: layerId['STRESS-BLOCKS'] }, options: { id: `${id}-member-2` } },
        { type: 'TEXT', payload: { position: [size + 1, 0, 0], text: `S${index}`, height: 2.5, layerId: layerId['STRESS-TEXT'] }, options: { id: `${id}-member-3` } },
      ],
    }
  })
  const entities = []
  for (let index = 0; index < 60_000; index += 1) {
    const column = index % 400, row = Math.floor(index / 400)
    entities.push({
      type: 'LINE',
      payload: { start: [column * 25, row * 25, 0], end: [column * 25 + 20, row * 25 + (index % 5), 0], layerId: layerId['STRESS-LINES'] },
      options: { id: entityId('line', index) },
    })
  }
  for (let index = 0; index < 15_000; index += 1) {
    const column = index % 250, row = Math.floor(index / 250)
    entities.push({
      type: 'CIRCLE',
      payload: { center: [column * 40 + 5, 4_000 + row * 36, 0], radius: 4 + index % 4, layerId: layerId['STRESS-CIRCLES'] },
      options: { id: entityId('circle', index) },
    })
  }
  for (let index = 0; index < 10_000; index += 1) {
    const column = index % 200, row = Math.floor(index / 200), x = column * 50, y = 6_300 + row * 32
    entities.push({
      type: 'LWPOLYLINE',
      payload: { vertices: [[x, y, 0], [x + 35, y, 0], [x + 30, y + 18, 0], [x + 4, y + 20, 0]], closed: true, layerId: layerId['STRESS-POLYLINES'] },
      options: { id: entityId('polyline', index) },
    })
  }
  for (let index = 0; index < 3_000; index += 1) {
    entities.push({
      type: 'TEXT',
      payload: { position: [(index % 150) * 65, 8_200 + Math.floor(index / 150) * 35, 0], text: `GRID ${String(index).padStart(4, '0')}`, height: 3, layerId: layerId['STRESS-TEXT'] },
      options: { id: entityId('text', index) },
    })
  }
  for (let index = 0; index < 1_000; index += 1) {
    entities.push({
      type: 'MTEXT',
      payload: { position: [(index % 100) * 95, 9_000 + Math.floor(index / 100) * 55, 0], text: `ASSEMBLY ${index}\\PZONE ${index % 20}`, height: 3, width: 80, layerId: layerId['STRESS-TEXT'] },
      options: { id: entityId('mtext', index) },
    })
  }
  for (let index = 0; index < 1_000; index += 1) {
    const x = (index % 100) * 95, y = 9_700 + Math.floor(index / 100) * 45
    entities.push({
      type: 'HATCH',
      payload: { boundaryLoops: [{ vertices: [[x, y, 0], [x + 35, y, 0], [x + 35, y + 20, 0], [x, y + 20, 0]], closed: true }], patternName: 'SOLID', solid: true, layerId: layerId['STRESS-HATCH'] },
      options: { id: entityId('hatch', index) },
    })
  }
  for (let index = 0; index < 9_958; index += 1) {
    entities.push({
      type: 'INSERT',
      payload: {
        blockRecordId: blocks[index % blocks.length].id,
        position: [(index % 250) * 40, 10_500 + Math.floor(index / 250) * 32, 0],
        scale: [1, 1, 1], rotation: (index % 8) * Math.PI / 4,
        attributes: {}, attributeIds: [], sequenceEndId: null,
        layerId: layerId['STRESS-BLOCKS'],
      },
      options: { id: entityId('insert', index) },
    })
  }
  assert.equal(entities.length, MODEL_ENTITY_COUNT)
  assert.equal(blocks.reduce((sum, block) => sum + block.entities.length, 0), BLOCK_MEMBER_COUNT)
  return {
    entities,
    resources: { linetypes: [{ id: continuousId, name: 'STRESS_CONTINUOUS', pattern: [] }], layers, blocks },
    layout: {
      id: 'stress-layout-a1-overview',
      blockRecordId: 'stress-paper-a1-overview',
      name: 'Stress A1 Overview 1-20',
      dxfPlotSettings: {
        paperWidth: 841, paperHeight: 594,
        marginLeft: 0, marginBottom: 0, marginRight: 0, marginTop: 0,
        originX: 0, originY: 0, scaleNumerator: 1, scaleDenominator: 1,
        flags: 0, paperUnits: 1, rotation: 0, plotType: 5,
      },
      viewport: {
        id: 'stress-viewport-a1-overview', center: [420.5, 297, 0], width: 800, height: 550,
        viewCenter: [5_000, 5_500, 0], viewHeight: 11_000,
        twistAngle: 0, modelUnits: 'millimeter', scaleDenominator: 20,
      },
    },
  }
}

function typeCounts(document) {
  const counts = {}
  for (const entity of document.listEntities()) counts[entity.type] = (counts[entity.type] ?? 0) + 1
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)))
}

function paperLayouts(document) {
  return document.snapshot().spaces.layoutIds
    .map(id => document.getObject(id))
    .filter(layout => layout?.payload.blockRecordId !== document.snapshot().spaces.modelSpaceId && layout.name.startsWith('Stress '))
}

function layoutEvidence(document) {
  return paperLayouts(document).map(layout => {
    const viewport = document.listEntities({ ownerId: layout.payload.blockRecordId, type: 'VIEWPORT' })[0]
    assert.ok(viewport, `Missing VIEWPORT in ${layout.name}`)
    return {
      name: layout.name,
      paper: [layout.payload.dxfPlotSettings.paperWidth, layout.payload.dxfPlotSettings.paperHeight],
      viewport: {
        size: [viewport.payload.width, viewport.payload.height],
        viewHeight: viewport.payload.viewHeight,
        millimetersPerModelUnit: viewport.payload.height / viewport.payload.viewHeight,
      },
    }
  }).sort((left, right) => left.name.localeCompare(right.name))
}

sampleMemory('start')
const sdk = createKJDrawSDK()
const document = sdk.createDocument({
  documentId: 'release-100k-mixed',
  title: 'KJDraw 100k mixed release stress fixture',
  units: 'millimeter',
  createdAt: '2026-09-13T00:00:00.000Z',
})
const fixture = await measure('buildFixtureSpecsMs', async () => buildFixture())
const created = await measure('createDocumentMs', async () => {
  const result = []
  for (let offset = 0; offset < fixture.entities.length; offset += CREATE_BATCH_SIZE) {
    const entities = fixture.entities.slice(offset, offset + CREATE_BATCH_SIZE)
    const batch = offset === 0
      ? { entities, resources: fixture.resources, layout: fixture.layout }
      : { entities }
    result.push(...await sdk.executeCommand('CREATEBATCH', batch, { document }))
  }
  const secondLayout = await sdk.executeCommand('LAYOUT', { operation: 'create', name: 'Stress A3 Detail 1-5' }, { document })
  await sdk.executeCommand('PAGESETUP', {
    layoutId: secondLayout.id,
    dxf: {
      paperWidth: 420, paperHeight: 297,
      marginLeft: 0, marginBottom: 0, marginRight: 0, marginTop: 0,
      originX: 0, originY: 0, scaleNumerator: 1, scaleDenominator: 1,
      flags: 0, paperUnits: 1, rotation: 0, plotType: 5,
    },
  }, { document })
  await sdk.executeCommand('VIEWPORT', {
    layoutId: secondLayout.id, center: [210, 148.5, 0], width: 400, height: 277,
    viewCenter: [1_000, 1_000, 0], viewHeight: 1_385, twistAngle: 0,
  }, { document })
  return result
})
assert.equal(created.length, MODEL_ENTITY_COUNT + BLOCK_MEMBER_COUNT + 1)
assert.equal(document.listEntities().length, ENTITY_COUNT)
assert.equal(paperLayouts(document).length, PAPER_LAYOUT_COUNT)
const expectedLayouts = [
  { name: 'Stress A1 Overview 1-20', paper: [841, 594], viewport: { size: [800, 550], viewHeight: 11_000, millimetersPerModelUnit: 0.05 } },
  { name: 'Stress A3 Detail 1-5', paper: [420, 297], viewport: { size: [400, 277], viewHeight: 1_385, millimetersPerModelUnit: 0.2 } },
]
assert.deepEqual(layoutEvidence(document), expectedLayouts)

const renderer = new KJCanvasRenderer(noopCanvas(), { document: null, grid: false, pixelRatio: 1, padding: 20 })
const firstFrame = await measure('firstCanvasFrameMs', async () => {
  renderer.setDocument(document)
  return renderer.report
})
const completeFrame = await measure('completeCanvasFrameMs', async () => {
  renderer.fit()
  return renderer.report
})
renderer.dispose()
assert.equal(firstFrame.total, MODEL_ENTITY_COUNT)
assert.equal(completeFrame.total, MODEL_ENTITY_COUNT)
assert.equal(completeFrame.unsupported, 0)
assert.equal(completeFrame.hidden, 0)
assert.equal(completeFrame.culled, 0)

const queried = await measure('queryEntitiesMs', async () => document.listEntities({ type: 'HATCH' }))
assert.equal(queried.length, 1_000)
const selected = await measure('selectByPropertyMs', () => sdk.executeCommand('SELECTBYPROPERTY', { property: 'layer', value: 'STRESS-HATCH' }, { document }))
assert.equal(selected.length, 1_000)
const editedIds = Array.from({ length: 100 }, (_, index) => entityId('line', index))
const originalFirstLine = document.getObject(editedIds[0]).payload.start
await measure('editMove100Ms', () => sdk.executeCommand('MOVE', { ids: editedIds, dx: 3, dy: -2 }, { document }))
assert.deepEqual(document.getObject(editedIds[0]).payload.start, [originalFirstLine[0] + 3, originalFirstLine[1] - 2, 0])
await measure('undoMs', () => sdk.executeCommand('UNDO', {}, { document }))
assert.deepEqual(document.getObject(editedIds[0]).payload.start, originalFirstLine)
await measure('redoMs', () => sdk.executeCommand('REDO', {}, { document }))
assert.deepEqual(document.getObject(editedIds[0]).payload.start, [originalFirstLine[0] + 3, originalFirstLine[1] - 2, 0])

const kjd = await measure('serializeKjdMs', () => sdk.writeDocument(document, { format: 'KJD' }))
const reopenedSdk = createKJDrawSDK()
const reopened = await measure('reopenKjdMs', () => reopenedSdk.readDocument(kjd, { format: 'KJD' }))
assert.equal(reopened.validate().valid, true)
assert.equal(reopened.listEntities().length, ENTITY_COUNT)
assert.equal(paperLayouts(reopened).length, PAPER_LAYOUT_COUNT)
assert.deepEqual(typeCounts(reopened), typeCounts(document))
assert.deepEqual(layoutEvidence(reopened), expectedLayouts)
assert.deepEqual(reopened.getObject(editedIds[0]).payload.start, [originalFirstLine[0] + 3, originalFirstLine[1] - 2, 0])
for (const layout of paperLayouts(reopened)) {
  assert.equal(reopened.listEntities({ ownerId: layout.payload.blockRecordId, type: 'VIEWPORT' }).length, 1)
}

sampleMemory('finish')
const sampledPeakMemory = Object.fromEntries(['rss', 'heapUsed', 'heapTotal', 'external'].map(key => [
  key,
  Math.max(...Object.values(memoryMiB).map(stage => stage[key])),
]))
const processPeakRssMiB = round(process.resourceUsage().maxRSS / 1024)
const kjdMiB = round(Buffer.byteLength(kjd) / 1024 / 1024)
const failures = []
for (const [name, maximum] of Object.entries(budgets.maximumTimingsMs)) {
  const actual = timingsMs[name]
  if (!Number.isFinite(actual) || actual > maximum) failures.push(`${name}: ${actual}ms > ${maximum}ms`)
}
if (processPeakRssMiB > budgets.maximumRssMiB) failures.push(`process peak RSS: ${processPeakRssMiB}MiB > ${budgets.maximumRssMiB}MiB`)
if (sampledPeakMemory.heapUsed > budgets.maximumHeapUsedMiB) failures.push(`sampled peak heap: ${sampledPeakMemory.heapUsed}MiB > ${budgets.maximumHeapUsedMiB}MiB`)
if (kjdMiB > budgets.maximumKjdMiB) failures.push(`KJD size: ${kjdMiB}MiB > ${budgets.maximumKjdMiB}MiB`)

const report = {
  schema: 'com.kanjie.kjdraw.benchmark.release-100k-stress@1',
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    cpu: cpus()[0]?.model ?? 'unknown',
    logicalCpus: availableParallelism(),
    systemMemoryMiB: round(totalmem() / 1024 / 1024),
  },
  fixture: {
    schema: FIXTURE_VERSION,
    entityCount: ENTITY_COUNT,
    modelEntityCount: MODEL_ENTITY_COUNT,
    blockCount: BLOCK_COUNT,
    blockMemberCount: BLOCK_MEMBER_COUNT,
    createBatchSize: CREATE_BATCH_SIZE,
    paperLayoutCount: PAPER_LAYOUT_COUNT,
    layouts: expectedLayouts,
    typeCounts: typeCounts(document),
    kjdBytes: Buffer.byteLength(kjd),
    kjdSha256: createHash('sha256').update(kjd).digest('hex'),
  },
  rendering: {
    kind: 'KJCanvasRenderer projection with deterministic Canvas 2D command sink',
    firstFrame,
    completeFrame,
  },
  timingsMs,
  memoryMiB: { stages: memoryMiB, sampledPeak: sampledPeakMemory, processPeakRss: processPeakRssMiB },
  budgets,
  budgetResult: { passed: failures.length === 0, failures },
  scope: 'Deterministic local release guardrail. Results are not cross-device or cross-library performance claims.',
}

const outputArgument = process.argv.find(value => value.startsWith('--output='))
if (outputArgument) {
  const outputPath = resolve(outputArgument.slice('--output='.length))
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)
}
console.log(JSON.stringify(report, null, 2))
if (failures.length) {
  console.error(`100k release stress budget failed:\n- ${failures.join('\n- ')}`)
  process.exitCode = 1
}
