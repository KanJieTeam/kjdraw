import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { createKJDrawSDK } from '../src/index.js'
import {
  KJDRAW_LOCAL_CORPUS_SCHEMA,
  anonymousFileId,
  canonicalJson,
  classifyDrawingHint,
  compareCanonicalFeatureSummaries,
  createCanonicalFeatureSummary,
} from '../../../scripts/audits/local-drawing-corpus-core.mjs'

const salt = 'private-test-salt-0123456789'

async function drawing(patch = {}) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'corpus-fixture', units: 'millimeter' })
  await document.transact('Corpus fixture', tx => {
    const layer = tx.upsertTableRecord('layers', { id: 'fixture-layer', name: 'Fixture', payload: { color: patch.color ?? 2, lineTypeId: 'linetype-continuous' } })
    tx.createEntity('LINE', { start: [0, 0, 0], end: [100 + (patch.shift ?? 0), 0, 0], layerId: layer.id }, { id: 'line-a' })
    tx.createEntity('LINE', { start: [0, 20, 0], end: [100, 20, 0], layerId: layer.id }, { id: 'line-b' })
    tx.createEntity('LINE', { start: [50, -10, 0], end: [50, 30, 0], layerId: layer.id }, { id: 'line-c' })
    tx.createEntity('CIRCLE', { center: [20, 10, 0], radius: 5, layerId: layer.id }, { id: 'circle-a' })
    if (!patch.missingCircle) tx.createEntity('CIRCLE', { center: [20, 10, 0], radius: patch.radius ?? 10, layerId: layer.id }, { id: 'circle-b' })
    tx.createEntity('HATCH', { solid: false, patternName: 'PRIVATE_TEST', patternScale: 1, patternAngle: 0,
      patternLines: [{ angle: 0, base: [0, 0], offset: [0, patch.patternOffset ?? 2], dashes: [1, -1] }],
      boundaryLoops: [
        { external: true, vertices: [[0, 40], [40, 40], [40, 80], [0, 80]] },
        { external: false, vertices: [[10 + (patch.hatchIslandShift ?? 0), 50], [30, 50], [30, 70], [10 + (patch.hatchIslandShift ?? 0), 70]] },
      ], layerId: layer.id }, { id: 'hatch-a' })
    tx.createEntity('TEXT', { position: [patch.textX ?? 0, 30, 0], alignmentPoint: [patch.alignmentX ?? 0, 30, 0],
      text: patch.text ?? 'Synthetic title', height: 2.5, widthFactor: patch.widthFactor ?? 1,
      horizontalAlignment: patch.horizontalAlignment ?? 0, layerId: layer.id }, { id: 'title' })
  })
  if (patch.page) {
    const layout = document.snapshot().spaces.layoutIds.map(id => document.getObject(id)).find(item => item?.name === 'Model')
    await sdk.executeCommand('PAGESETUP', { layoutId: layout.id, dxf: {
      paperWidth: patch.page.paperWidth ?? 210, paperHeight: patch.page.paperHeight ?? 297,
      paperUnits: 1, rotation: patch.page.rotation ?? 0, plotType: 4,
      windowMinX: patch.page.windowMinX ?? 0, windowMinY: 0,
      windowMaxX: patch.page.windowMaxX ?? 210, windowMaxY: 297,
      flags: 0, scaleNumerator: 1, scaleDenominator: patch.page.scaleDenominator ?? 1,
      marginLeft: 5, marginRight: 5, marginTop: 5, marginBottom: 5,
    } }, { document })
  }
  return document
}

async function largeTopologyDrawing(perpendicular = false) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'large-topology', units: 'millimeter' })
  await document.transact('Large topology fixture', tx => {
    for (let index = 0; index < 300; index += 1) tx.createEntity('LINE', perpendicular && index === 299
      ? { start: [299, 0, 0], end: [299, 10, 0] }
      : { start: [0, index, 0], end: [10, index, 0] }, { id: `line-${index}` })
  })
  return document
}

test('anonymous IDs and canonical manifests are salted, path-free and byte deterministic', () => {
  const bytes = new TextEncoder().encode('private drawing bytes')
  assert.equal(anonymousFileId(bytes, salt, 'geology'), anonymousFileId(bytes, salt, 'geology'))
  assert.notEqual(anonymousFileId(bytes, salt, 'geology'), anonymousFileId(bytes, `${salt}-other`, 'geology'))
  assert.notEqual(anonymousFileId(bytes, salt, 'geology'), anonymousFileId(bytes, salt, 'manufacturing'))
  assert.match(anonymousFileId(bytes, salt, 'geology'), /^cad-[0-9a-f]{32}$/u)
  const value = { z: 2, a: { y: 1, x: 0 } }
  assert.equal(canonicalJson(value), canonicalJson({ a: { x: 0, y: 1 }, z: 2 }))
  assert.equal(canonicalJson(value).includes('generatedAt'), false)
})

test('classification covers geology, manufacturing, architecture and construction site hints without exporting them', () => {
  assert.equal(classifyDrawingHint('项目/钻孔柱状图/01.dwg'), 'geology-column')
  assert.equal(classifyDrawingHint('项目/工程地质剖面图.dxf'), 'geology-section')
  assert.equal(classifyDrawingHint('勘探点平面位置图.dxf'), 'geology-plan')
  assert.equal(classifyDrawingHint('带公差齿轮零件.dwg'), 'manufacturing')
  assert.equal(classifyDrawingHint('办公楼建筑施工图.dwg'), 'architecture')
  assert.equal(classifyDrawingHint('施工现场平面布置图.dwg'), 'construction-site-plan')
})

test('canonical feature summaries are stable and the strict comparator catches known error classes', async () => {
  const reference = createCanonicalFeatureSummary(await drawing(), { salt })
  const repeat = createCanonicalFeatureSummary(await drawing(), { salt })
  assert.equal(canonicalJson(reference), canonicalJson(repeat))
  assert.equal(compareCanonicalFeatureSummaries(reference, repeat).passed, true)
  assert.equal(reference.relations.counts.parallel, 1)
  assert.equal(reference.relations.counts.perpendicular, 2)
  assert.equal(reference.relations.counts.concentric, 1)

  const cases = [
    ['geometry', { shift: 1 }],
    ['style', { color: 5 }],
    ['text', { text: 'Changed title' }],
    ['structure', { missingCircle: true }],
    ['topology', { radius: 5 }],
    ['geometry', { hatchIslandShift: 1 }],
    ['geometry', { patternOffset: 3 }],
    ['geometry', { textX: 1 }],
    ['geometry', { alignmentX: 2, horizontalAlignment: 1 }],
    ['geometry', { widthFactor: 0.8 }],
  ]
  for (const [category, patch] of cases) {
    const comparison = compareCanonicalFeatureSummaries(reference, createCanonicalFeatureSummary(await drawing(patch), { salt }))
    assert.equal(comparison.passed, false, category)
    assert.ok(comparison.categoryCounts[category] > 0, `${category}: ${JSON.stringify(comparison)}`)
  }
})

test('strict comparison rejects physical sheet, rotation, plot scale and plot-window drift', async () => {
  const reference = createCanonicalFeatureSummary(await drawing({ page: {} }), { salt })
  assert.equal(reference.layouts[0].plotSettings.numeric.paperWidth, 210)
  assert.equal(reference.layouts[0].plotSettings.numeric.paperHeight, 297)
  assert.equal(reference.layouts[0].plotSettings.numeric.scaleDenominator, 1)
  const cases = [
    { paperWidth: 237.067, paperHeight: 362.568, windowMaxX: 237.067 },
    { rotation: 1 },
    { scaleDenominator: 100 },
    { windowMinX: 12 },
  ]
  for (const page of cases) {
    const actual = createCanonicalFeatureSummary(await drawing({ page }), { salt })
    const comparison = compareCanonicalFeatureSummaries(reference, actual)
    assert.equal(comparison.passed, false, JSON.stringify(page))
    assert.ok(comparison.categoryCounts.layout > 0, JSON.stringify(comparison))
  }
})

test('topology comparison remains active beyond 256 primitives', async () => {
  const parallel = createCanonicalFeatureSummary(await largeTopologyDrawing(), { salt })
  const changed = createCanonicalFeatureSummary(await largeTopologyDrawing(true), { salt })
  assert.equal(parallel.relations.omitted, 0)
  assert.equal(parallel.relations.counts.parallel, 44850)
  assert.equal(changed.relations.counts.perpendicular, 299)
  const comparison = compareCanonicalFeatureSummaries(parallel, changed)
  assert.ok(comparison.categoryCounts.topology > 0, JSON.stringify(comparison))
})

test('local corpus CLI emits no path or raw SHA, marks DWG blocked and repeats byte-for-byte', async t => {
  const root = await mkdtemp(join(tmpdir(), 'kjdraw-private-corpus-'))
  const privateName = '客户甲柱状图.dwg', source = new TextEncoder().encode('AC1032private-payload')
  await writeFile(join(root, privateName), source)
  const script = fileURLToPath(new URL('../../../scripts/audits/inspect-local-drawing-corpus.mjs', import.meta.url))
  const run = output => spawnSync(process.execPath, [script, '--root', root, '--corpus-id', 'geology-private', '--output', output], {
    encoding: 'utf8', env: { ...process.env, KJDRAW_CORPUS_SALT: salt },
  })
  const firstPath = join(root, 'first.json'), first = run(firstPath)
  assert.equal(first.status, 0, first.stderr)
  const secondPath = join(root, 'second.json'), second = run(secondPath)
  assert.equal(second.status, 0, second.stderr)
  const firstBytes = await readFile(firstPath), secondBytes = await readFile(secondPath)
  assert.deepEqual(firstBytes, secondBytes)
  const report = JSON.parse(firstBytes)
  assert.equal(report.deterministic, true)
  assert.equal(report.totals.blocked, 1)
  assert.equal(report.files[0].parseStatus, 'blocked')
  assert.deepEqual(report.files[0].blockingReasons, ['dwg-converter-required'])
  assert.equal(firstBytes.includes(Buffer.from(privateName)), false)
  assert.equal(firstBytes.includes(Buffer.from(root)), false)
  assert.equal(Object.hasOwn(report.files[0], 'sha256'), false)
  assert.equal(Object.hasOwn(report, 'generatedAt'), false)
  t.after(async () => {})
})

test('batch comparator consumes explicit one-to-one anonymous mappings and fails on geometry drift', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kjdraw-corpus-compare-'))
  const reference = createCanonicalFeatureSummary(await drawing(), { salt })
  const changed = createCanonicalFeatureSummary(await drawing({ shift: 2 }), { salt })
  const wrap = (corpusId, anonymousId, featureSummary) => ({
    schema: KJDRAW_LOCAL_CORPUS_SCHEMA, corpusId, deterministic: true,
    files: [{ anonymousId, parseStatus: 'parsed', featureSummary }],
  })
  const expected = join(root, 'expected.json'), actual = join(root, 'actual.json'), matching = join(root, 'matching.json'), pairs = join(root, 'pairs.json')
  await writeFile(expected, canonicalJson(wrap('expected', 'cad-expected', reference)))
  await writeFile(actual, canonicalJson(wrap('actual', 'cad-actual', changed)))
  await writeFile(matching, canonicalJson(wrap('matching', 'cad-actual', reference)))
  await writeFile(pairs, canonicalJson([{ expectedId: 'cad-expected', actualId: 'cad-actual' }]))
  const script = fileURLToPath(new URL('../../../scripts/audits/compare-local-drawing-features.mjs', import.meta.url))
  const failed = spawnSync(process.execPath, [script, '--expected', expected, '--actual', actual, '--pairs', pairs], { encoding: 'utf8' })
  assert.equal(failed.status, 1)
  const report = JSON.parse(failed.stdout)
  assert.equal(report.passed, false)
  assert.ok(report.totals.categories.geometry > 0)
  const passed = spawnSync(process.execPath, [script, '--expected', expected, '--actual', matching, '--pairs', pairs], { encoding: 'utf8' })
  assert.equal(passed.status, 0, passed.stderr)
  assert.equal(JSON.parse(passed.stdout).passed, true)
  const missing = spawnSync(process.execPath, [script, '--expected', expected, '--actual', expected, '--pairs', pairs], { encoding: 'utf8' })
  assert.equal(missing.status, 1, 'mismatched anonymous ID must fail closed even when manifests are otherwise identical')
})

test('sharded manifests release feature summaries and remain directly comparable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kjdraw-corpus-sharded-'))
  const sdk = createKJDrawSDK(), source = await drawing({ page: {} })
  await writeFile(join(root, 'candidate.dxf'), await sdk.writeDocument(source, { format: 'DXF', version: '2018' }))
  const manifestPath = join(root, 'manifest.json'), featureDir = join(root, 'features')
  const inspect = fileURLToPath(new URL('../../../scripts/audits/inspect-local-drawing-corpus.mjs', import.meta.url))
  const run = spawnSync(process.execPath, [inspect, '--root', root, '--corpus-id', 'sharded-test', '--format', 'DXF', '--output', manifestPath, '--feature-dir', featureDir], {
    encoding: 'utf8', env: { ...process.env, KJDRAW_CORPUS_SALT: salt },
  })
  assert.equal(run.status, 0, run.stderr)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')), entry = manifest.files[0]
  assert.equal(manifest.schema, KJDRAW_LOCAL_CORPUS_SCHEMA)
  assert.equal(manifest.featureStorage, 'sharded')
  assert.equal(Object.hasOwn(entry, 'featureSummary'), false)
  assert.match(entry.featureSummaryRef, /^features\/cad-[0-9a-f]{32}\.json$/u)
  const shard = JSON.parse(await readFile(join(root, entry.featureSummaryRef), 'utf8'))
  assert.equal(shard.digest, entry.featureDigest)
  const pairs = join(root, 'pairs.json')
  await writeFile(pairs, canonicalJson([{ expectedId: entry.anonymousId, actualId: entry.anonymousId }]))
  const compare = fileURLToPath(new URL('../../../scripts/audits/compare-local-drawing-features.mjs', import.meta.url))
  const compared = spawnSync(process.execPath, [compare, '--expected', manifestPath, '--actual', manifestPath, '--pairs', pairs], { encoding: 'utf8' })
  assert.equal(compared.status, 0, compared.stderr)
  assert.equal(JSON.parse(compared.stdout).passed, true)
})
