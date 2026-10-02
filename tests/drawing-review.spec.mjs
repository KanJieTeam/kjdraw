import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/index.js'
import { captureDrawing, checkDrawing, compareDrawings, normalizeOptions } from '../examples/drawing-review/analysis.mjs'
import { parseArgs } from '../examples/drawing-review/cli.mjs'
import { csvCell, renderHtml, reviewDrawingFiles, writeReviewReport } from '../examples/drawing-review/report.mjs'

const options = { units: 'millimeter', scope: 'model', identity: 'semantic' }
const capture = (document, overrides = {}) => captureDrawing(document, { ...options, ...overrides })
const compare = (a, b, overrides = {}) => compareDrawings(capture(a, overrides), capture(b, overrides), { ...options, ...overrides })
const source = entities => ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1032', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC',
  '0', 'SECTION', '2', 'ENTITIES', ...entities.flat(), '0', 'ENDSEC', '0', 'EOF', ''].join('\n')
const line = (handle, x = 0) => ['0', 'LINE', '5', handle, '8', '0', '10', String(x), '20', '0', '11', String(x + 10), '21', '0']

async function sample() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await document.transact('Original fixture', tx => {
    tx.createEntity('LINE', { start: [0, 0, 0], end: [10, 0, 0] })
    tx.createEntity('TEXT', { position: [2, 10, 0], text: 'A', height: 2 })
    tx.createEntity('DIMENSION', { dimensionType: 'ALIGNED', definitionPoints: [[0, 5, 0], [0, 0, 0], [10, 0, 0]], textOverride: 'A' })
  })
  return { sdk, document }
}

test('independent DXF imports ignore UUID/owner/resource identity churn', async () => {
  const { sdk, document } = await sample(), text = await sdk.writeDocument(document, { format: 'DXF' })
  const a = await createKJDrawSDK().readDocument(text, { format: 'DXF' }), b = await createKJDrawSDK().readDocument(text, { format: 'DXF' })
  assert.notEqual(a.spaces.modelSpaceId, b.spaces.modelSpaceId)
  const result = compare(a, b)
  assert.equal(result.counts.unchanged, 3)
  assert.equal(result.counts.modified, 0)
  assert.equal(result.counts.unmatchedBefore, 0)
  assert.deepEqual(result.resources.filter(record => record.status === 'modified'), [])
})

test('unique native geometry pairs layer/text/dimension edits without UUID noise', async () => {
  const { sdk, document } = await sample(), text = await sdk.writeDocument(document, { format: 'DXF' })
  const a = await sdk.readDocument(text, { format: 'DXF' }), b = await sdk.readDocument(text, { format: 'DXF' })
  await b.transact('Property changes', tx => {
    const layer = tx.upsertTableRecord('layers', { name: 'Revised' })
    for (const entity of b.listEntities()) tx.updateObject(entity.id, { payload: entity.type === 'LINE' ? { layerId: layer.id } : entity.type === 'TEXT' ? { text: 'B' } : { textOverride: 'B' } })
  })
  const result = compare(a, b)
  assert.equal(result.counts.modified, 3)
  assert.ok(result.pairs.every(pair => pair.matchedBy === 'unique-exact-geometry'))
  assert.ok(result.pairs.flatMap(pair => pair.fields).every(field => !/(?:ownerId|^\/id|handle|source)/u.test(field)))
  assert.ok(result.pairs.some(pair => pair.fields.includes('/payload/textOverride')))
})

test('same handles are never trusted for unrelated drawings without opt-in', async () => {
  const a = await createKJDrawSDK().readDocument(source([line('AB', 0)]), { format: 'DXF' })
  const b = await createKJDrawSDK().readDocument(source([line('AB', 50)]), { format: 'DXF' })
  assert.equal(compare(a, b).pairs.length, 0)
  const result = compare(a, b, { identity: 'same-lineage-handles' })
  assert.equal(result.counts.modified, 1)
  assert.equal(result.pairs[0].matchedBy, 'same-lineage-source-handle')
  assert.deepEqual(result.pairs[0].fields, ['/payload/end/0', '/payload/start/0'])
})

test('missing original DXF handles cannot become false same-lineage runtime matches', async () => {
  const missing = x => line('', x).filter((_, index, values) => index !== 2 && index !== 3)
  const a = await createKJDrawSDK().readDocument(source([missing(0)]), { format: 'DXF' })
  const b = await createKJDrawSDK().readDocument(source([missing(50)]), { format: 'DXF' })
  const result = compare(a, b, { identity: 'same-lineage-handles' })
  assert.equal(result.pairs.length, 0)
  assert.equal(result.counts.unmatchedBefore, 1)
  assert.equal(result.counts.unmatchedAfter, 1)
})

test('duplicate candidates remain ambiguous and are never arbitrarily paired', async () => {
  const text = source([line('AB'), line('AB')])
  const a = await createKJDrawSDK().readDocument(text, { format: 'DXF' }), b = await createKJDrawSDK().readDocument(text, { format: 'DXF' })
  const result = compare(a, b, { identity: 'same-lineage-handles' })
  assert.equal(result.pairs.length, 0)
  assert.equal(result.counts.unmatchedBefore, 2)
  assert.ok(result.ambiguous.some(group => group.matchedBy === 'same-lineage-source-handle'))
})

test('exact diagnostics include CAD properties and owner boundaries', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const paperOwner = document.getObject(document.spaces.layoutIds[1]).payload.blockRecordId
  await document.transact('Diagnostics', tx => {
    const layer = tx.upsertTableRecord('layers', { name: 'Other' })
    const payload = { start: [0, 0, 0], end: [10, 0, 0] }
    tx.createEntity('LINE', payload); tx.createEntity('LINE', payload)
    tx.createEntity('LINE', { ...payload, layerId: layer.id })
    tx.createEntity('LINE', { start: [10, 0, 0], end: [0, 0, 0] })
    tx.createEntity('LINE', payload, { ownerId: paperOwner })
    tx.createEntity('LINE', { start: [20, 0, 0], end: [20, 0, 0] })
  })
  const result = checkDrawing(capture(document), options)
  assert.equal(result.findings.filter(item => item.code === 'exact-duplicate').length, 1)
  assert.equal(result.findings.find(item => item.code === 'exact-duplicate').entities.length, 2)
  assert.equal(result.findings.filter(item => item.code === 'zero-length-line').length, 1)
  assert.equal(capture(document).coverage.excludedEntities, 1)
  assert.equal(capture(document, { scope: 'all' }).coverage.selectedEntities, 6)
  assert.equal(capture(document, { layers: ['Other'] }).coverage.selectedEntities, 1)
})

test('entity budget fails closed and diagnostic truncation is explicit', async () => {
  const document = createKJDrawSDK().createDocument({ units: 'millimeter' })
  await document.transact('Many findings', tx => {
    for (let x = 0; x < 3; x++) tx.createEntity('LINE', { start: [x, 0, 0], end: [x, 0, 0] })
  })
  assert.throws(() => capture(document, { maxEntities: 2 }), /Entity budget exceeded/u)
  const result = checkDrawing(capture(document), { ...options, maxFindings: 1 })
  assert.equal(result.findings.length, 1)
  assert.equal(result.omittedFindings, 2)
  assert.equal(result.complete, false)
})

test('proxy imports, raw payload exclusions and missing scope remain explicit', async () => {
  const document = await createKJDrawSDK().readDocument(source([['0', 'UNSUPPORTED_SAMPLE', '5', 'AB', '8', '0']]), { format: 'DXF' })
  const state = capture(document)
  assert.equal(state.coverage.totalImportedEntities, 1)
  assert.equal(state.coverage.unsupported.length, 1)
  assert.equal(state.coverage.ignoredOpaquePayloads.length, 1)
  assert.equal(state.coverage.unsupported[0].type, 'PROXY_ENTITY')
  assert.throws(() => capture(document, { scope: 'layout:Absent' }), /absent or ambiguous/u)
  assert.throws(() => capture(document, { layers: ['Absent'] }), /Requested layer is absent/u)
})

test('different anonymous XRECORD contents remain distinct in diff and duplicate checks', async () => {
  const document = createKJDrawSDK().createDocument({ units: 'millimeter' })
  let first, second, line
  await document.transact('Anonymous reference contents', tx => {
    first = tx.createObject({ kind: 'xrecord', type: 'XRECORD', payload: { value: 1 } })
    second = tx.createObject({ kind: 'xrecord', type: 'XRECORD', payload: { value: 2 } })
    line = tx.createEntity('LINE', { start: [0, 0, 0], end: [10, 0, 0] }, { extension: { xrecordIds: [first.id] } })
  })
  const after = document.fork()
  await after.transact('Different reference', tx => tx.updateObject(line.id, { extension: { xrecordIds: [second.id] } }))
  const result = compare(document, after)
  assert.equal(result.counts.modified, 1)
  assert.deepEqual(result.pairs[0].fields, ['/extension/xrecordIds/0/payload/value'])
  await after.transact('Different coincident metadata', tx => tx.createEntity('LINE', { start: [0, 0, 0], end: [10, 0, 0] }, { extension: { xrecordIds: [first.id] } }))
  assert.equal(checkDrawing(capture(after), options).findings.filter(item => item.code === 'exact-duplicate').length, 0)
})

test('equal anonymous contents survive cross-file UUID regeneration without a false change', async () => {
  const make = async () => {
    const document = createKJDrawSDK().createDocument({ units: 'millimeter' })
    await document.transact('Independent contents', tx => {
      const record = tx.createObject({ kind: 'xrecord', type: 'XRECORD', payload: { value: 7, description: 'original data' } })
      tx.createEntity('LINE', { start: [0, 0, 0], end: [10, 0, 0] }, { extension: { xrecordIds: [record.id] } })
    })
    return document
  }
  const a = await make(), b = await make()
  assert.notEqual(a.listEntities()[0].extension.xrecordIds[0], b.listEntities()[0].extension.xrecordIds[0])
  assert.equal(compare(a, b).counts.unchanged, 1)
  assert.equal(compare(a, b).counts.modified, 0)
})

test('resource reparenting compares native dictionary owners rather than collapsing them to null', async () => {
  const document = createKJDrawSDK().createDocument({ units: 'millimeter' })
  let first, second, record
  await document.transact('Named resource owners', tx => {
    first = tx.createObject({ kind: 'dictionary', type: 'DICTIONARY', name: 'A', payload: { entries: {} } })
    second = tx.createObject({ kind: 'dictionary', type: 'DICTIONARY', name: 'B', payload: { entries: {} } })
    record = tx.createObject({ kind: 'xrecord', type: 'XRECORD', name: 'notes', ownerId: first.id, payload: { value: 'Metadata' } })
  })
  const after = document.fork()
  await after.transact('Resource owner change', tx => tx.reparentObject(record.id, second.id))
  assert.equal(document.validate().valid, true)
  assert.equal(after.validate().valid, true)
  const result = compare(document, after)
  assert.ok(result.resources.some(resource => resource.logicalKey === 'xrecord:XRECORD:notes' && resource.status === 'modified' && resource.fields.includes('/owner/$ref')))
})

test('cyclic or deeply nested native references are unknown rather than confidently equal', async () => {
  const document = createKJDrawSDK().createDocument({ units: 'millimeter' })
  await document.transact('Cyclic and deep references', tx => {
    const cycle = tx.createObject({ kind: 'xrecord', type: 'XRECORD', payload: { value: 7 } })
    tx.updateObject(cycle.id, { extension: { reactorIds: [cycle.id] } })
    let data = { value: 7 }
    for (let depth = 0; depth < 50; depth++) data = { nested: data }
    const deep = tx.createObject({ kind: 'xrecord', type: 'XRECORD', payload: data })
    for (const record of [cycle, cycle, deep]) tx.createEntity('LINE', { start: [0, 0, 0], end: [10, 0, 0] }, { extension: { xrecordIds: [record.id] } })
  })
  const captured = capture(document)
  assert.equal(captured.coverage.unsupported.length, 3)
  assert.ok(captured.entities.every(entity => entity.uncertain))
  assert.equal(checkDrawing(captured, options).checkedDuplicates, 0)
  assert.equal(compare(document, document.fork()).pairs.length, 0)
  assert.equal(compare(document, document.fork()).counts.unmatchedBefore, 3)
})

test('one shared normalization budget bounds the entire capture and excludes exhausted semantics', async () => {
  const { document } = await sample()
  const captured = capture(document, { maxNormalizationNodes: 10 })
  assert.equal(captured.coverage.normalization.exhausted, true)
  assert.equal(captured.coverage.normalization.consumedNodes, 10)
  assert.ok(captured.entities.every(entity => entity.uncertain))
  assert.equal(checkDrawing(captured, options).checkedDuplicates, 0)
  assert.equal(compare(document, document.fork(), { maxNormalizationNodes: 10 }).pairs.length, 0)
  assert.throws(() => normalizeOptions({ ...options, maxNormalizationNodes: 1000001 }), /1\.\.1000000/u)
})

test('explicit CLI choices reject missing/unknown/duplicate options', () => {
  assert.deepEqual(parseArgs(['--help']), { help: true })
  assert.throws(() => parseArgs(['--before', 'a.dxf']), /Missing --out/u)
  assert.throws(() => parseArgs(['--wat', 'x']), /Unknown argument/u)
  assert.throws(() => parseArgs(['--units', 'meter', '--units', 'inch']), /Duplicate/u)
  assert.throws(() => normalizeOptions({ ...options, window: [0, 0, 0, 1] }), /positive dimensions/u)
  assert.throws(() => normalizeOptions({ ...options, identity: undefined }), /Explicit identity/u)
})

test('CSV quotes and neutralizes formula-like or control-prefixed cells', () => {
  assert.equal(csvCell('a,"b"\nc'), '"a,""b""\nc"')
  for (const value of ['=1+1', '+cmd', '-1', '@sum(A1)', ' \t=1', '\uFEFF=1', '\tordinary']) assert.ok(csvCell(value).startsWith('"\''), value)
  assert.equal(csvCell('ordinary'), '"ordinary"')
})

test('unit mismatch remains visible before previews even when stored coordinates match', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kjdraw-review-units-')); t.after(() => rm(directory, { recursive: true, force: true }))
  const before = path.join(directory, 'a.kjd'), after = path.join(directory, 'b.kjd')
  for (const [file, units] of [[before, 'millimeter'], [after, 'inch']]) {
    const sdk = createKJDrawSDK(), document = sdk.createDocument({ units })
    await document.transact('Equal stored coordinates', tx => tx.createEntity('LINE', { start: [0, 0, 0], end: [10, 0, 0] }))
    await writeFile(file, await sdk.writeDocument(document, { format: 'KJD' }), 'utf8')
  }
  const report = await reviewDrawingFiles({ before, after, ...options, window: [-5, -5, 15, 15] })
  assert.equal(report.comparison.counts.unchanged, 1)
  const html = renderHtml(report), banner = html.indexOf('<strong>Unit mismatch</strong>')
  assert.ok(banner > 0 && banner < html.indexOf('<div class="previews">'))
  assert.ok(html.includes('after: declared inch, caller asserted millimeter.'))
  assert.ok(html.includes('Stored coordinate comparison only; no unit conversion is performed and no physical equivalence is claimed.'))
})

test('reports preserve input files, escape CAD content, and expose generated SVG coverage', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kjdraw-review-')); t.after(() => rm(directory, { recursive: true, force: true }))
  const { sdk, document } = await sample()
  await document.transact('Untrusted CAD strings', tx => {
    tx.createEntity('TEXT', { position: [3, 20, 0], height: 2, text: '</script><script>globalThis.PWNED=1</script>' })
    const layer = tx.upsertTableRecord('layers', { name: '=HYPERLINK("bad")', payload: structuredClone(document.getTable('layers').records[0].payload) })
    const payload = { start: [5, 5, 0], end: [5, 5, 0], layerId: layer.id }
    tx.createEntity('LINE', payload)
  })
  const before = path.join(directory, 'a.kjd'), after = path.join(directory, 'b.dxf')
  await writeFile(before, await sdk.writeDocument(document, { format: 'KJD' }), 'utf8')
  await writeFile(after, await sdk.writeDocument(document, { format: 'DXF' }), 'utf8')
  const rawBefore = await readFile(before), rawAfter = await readFile(after)
  const report = await reviewDrawingFiles({ before, after, ...options, identity: 'same-lineage-handles', window: [-10, -10, 40, 40] })
  assert.ok(report.drawings.every(drawing => drawing.previews[0].svg.includes('data-entity-id=')))
  assert.ok(report.drawings.every(drawing => drawing.previews[0].windowPolicy === 'caller-explicit'))
  const html = renderHtml(report)
  assert.ok(!html.includes('</script><script>globalThis.PWNED=1</script>'))
  assert.ok(html.includes('Content-Security-Policy'))
  assert.ok(html.includes('script-src \'sha256-'))
  assert.ok(html.includes('data-row="'))
  assert.ok(html.includes('id="before-1-kj-paper"'))
  assert.ok(html.includes('id="after-1-kj-paper"'))
  assert.ok(html.includes('url(#before-1-kj-plot-range)'))
  assert.ok(html.includes('url(#after-1-kj-plot-range)'))
  await writeReviewReport(report, path.join(directory, 'report'))
  const json = JSON.parse(await readFile(path.join(directory, 'report/report.json'), 'utf8'))
  assert.equal(json.drawings[0].source.sha256, createHash('sha256').update(rawBefore).digest('hex'))
  assert.equal(json.drawings[0].previews[0].svg, undefined)
  assert.equal(json.drawings[0].previews[0].file, 'before-1.svg')
  assert.deepEqual(await readFile(before), rawBefore)
  assert.deepEqual(await readFile(after), rawAfter)
})

test('CLI creates a browsable report in one command and rejects DWG clearly', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kjdraw-review-cli-')); t.after(() => rm(directory, { recursive: true, force: true }))
  const before = path.join(directory, 'a.dxf'), out = path.join(directory, 'report')
  await writeFile(before, source([line('AB')]), 'utf8')
  const command = ['examples/drawing-review/cli.mjs', '--before', before, '--out', out, '--units', 'millimeter', '--scope', 'model', '--identity', 'semantic']
  const result = spawnSync(process.execPath, command, { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).sources[0].imported, 1)
  assert.match(await readFile(path.join(out, 'report.html'), 'utf8'), /<svg/u)
  assert.match(await readFile(path.join(out, 'report.json'), 'utf8'), /coordinate-hints-only/u)
  const failure = spawnSync(process.execPath, command.map(value => value === before ? path.join(directory, 'a.dwg') : value), { encoding: 'utf8' })
  assert.equal(failure.status, 1)
  assert.match(failure.stderr, /convert DWG locally/u)
})
