import assert from 'node:assert/strict'
import test from 'node:test'
import crypto from 'node:crypto'
import { buildHatchPatternKnowledgePack, compileGeologyColumn, compileGeologySection, createKJDrawSDK, exportDrawingSvg, validateKnowledgePack } from '../src/index.js'
import { layoutCadMText } from '../src/geometry/text-layout.js'

const hole = (id, station, collarElevation, depths = [3, 9, 16]) => ({
  id, station, collarElevation, depth: depths.at(-1),
  strata: [
    { code: '1', name: 'Made ground', top: 0, bottom: depths[0], lithology: 'fill' },
    { code: '2', name: 'Silty clay', top: depths[0], bottom: depths[1], lithology: 'clay' },
    { code: '3', name: 'Medium sand', top: depths[1], bottom: depths[2], lithology: 'sand' },
  ],
})

test('engineering column expands stratigraphy into physical A4 frame, elevations, depth scale and legend', async () => {
  const input = { hole: hole('ZK-01', 0, 105.25), verticalScaleDenominator: 125, expectedRevision: 0 }
  const a = compileGeologyColumn(input), b = compileGeologyColumn(input)
  assert.deepEqual(a, b)
  assert.equal(a.evidence.templateId, 'borehole-column-engineering')
  assert.ok(a.commandArgs.entities.length > 35)
  assert.equal(a.commandArgs.entities.filter(entity => entity.type === 'HATCH').length, 6)
  const labels = a.commandArgs.entities.filter(entity => entity.type === 'TEXT').map(entity => entity.payload.text)
  for (const expected of ['DEPTH m', 'ELEV. m', 'LITHOLOGY LEGEND', '89.25', '16.00', 'VERTICAL SCALE 1:125']) assert.ok(labels.some(label => label.includes(expected)), expected)
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATEBATCH', a.commandArgs, { document })
  assert.equal(document.revision, 1)
  assert.equal(document.listEntities().length, a.evidence.entityCount)
  assert.equal(document.getTable('layers').records.filter(layer => layer.name.startsWith('GEO_')).length, 5)
  await sdk.executeCommand('UNDO', {}, { document })
  assert.equal(document.listEntities().length, 0)
  await sdk.executeCommand('REDO', {}, { document })
  assert.equal(document.listEntities().length, a.evidence.entityCount)
  const kjd = await sdk.writeDocument(document, { format: 'KJD', version: '1' })
  const reopenedKjd = await sdk.readDocument(kjd, { format: 'KJD', version: '1' })
  assert.equal(reopenedKjd.listEntities({ type: 'HATCH' }).length, 6)
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const reopenedDxf = await sdk.readDocument(dxf, { format: 'DXF', version: '2018' })
  assert.equal(reopenedDxf.listEntities({ type: 'HATCH' }).length, 6)
  assert.equal(reopenedDxf.listEntities({ type: 'PROXY_ENTITY' }).length, 0)
  const layout = document.snapshot().spaces.layoutIds.map(id => document.getObject(id)).find(record => record?.name === 'Model')
  await sdk.executeCommand('PAGESETUP', { layoutId: layout.id, dxf: { paperWidth: 210, paperHeight: 297, paperUnits: 1, plotType: 4, windowMinX: 0, windowMinY: 0, windowMaxX: 210, windowMaxY: 297, flags: 0, scaleNumerator: 1, scaleDenominator: 1, marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0 } }, { document })
  const svg = exportDrawingSvg(document, { layoutId: layout.id })
  assert.equal(svg.report.diagnostics.length, 0)
  assert.match(svg.svg, /LITHOLOGY LEGEND/)
})

test('column style drawing origin translates geometry without changing facts, layers or layouts', async () => {
  const pack = validateKnowledgePack({ schema: 'kjdraw.knowledge-pack.v1', id: 'geo-origin-test', version: '1.0.0',
    title: 'Synthetic origin fixture', domain: 'geology',
    license: { spdx: 'MIT', redistributable: true, trainingAllowed: true },
    sources: [{ id: 'layout', title: 'Synthetic origin fixture', license: 'MIT', contentHash: 'a'.repeat(64) }],
    ontology: { objectKinds: ['borehole-log'], relationKinds: [] },
    rules: { 'geology-column-layout': { paperWidth: 210, paperHeight: 297, left: 15, right: 195,
      columns: [32, 51, 67, 92, 147] } } })
  const source = { hole: hole('SYNTHETIC-ORIGIN', 0, 105.25), expectedRevision: 0 }
  const baseline = compileGeologyColumn({ ...source, columnStylePack: pack })
  const offset = [240, -85]
  const shiftedPack = structuredClone(pack)
  shiftedPack.rules['geology-column-layout'].drawingOrigin = offset
  const shifted = compileGeologyColumn({ ...source, columnStylePack: shiftedPack })
  assert.equal(shifted.evidence.entityCount, baseline.evidence.entityCount)
  assert.equal(shifted.evidence.parameters.stratumCount, baseline.evidence.parameters.stratumCount)
  assert.equal(shifted.evidence.parameters.lithologyCount, baseline.evidence.parameters.lithologyCount)
  const pointPairs = (a, b) => {
    if (a.type === 'LINE') return [[a.payload.start, b.payload.start], [a.payload.end, b.payload.end]]
    if (a.type === 'TEXT' || a.type === 'MTEXT') return [[a.payload.position, b.payload.position]]
    if (a.type === 'CIRCLE') return [[a.payload.center, b.payload.center]]
    if (a.type === 'LWPOLYLINE') return a.payload.vertices.map((point, index) => [point, b.payload.vertices[index]])
    if (a.type === 'HATCH') return a.payload.boundaryLoops.flatMap((loop, index) =>
      loop.vertices.map((point, vertexIndex) => [point, b.payload.boundaryLoops[index].vertices[vertexIndex]]))
    throw new Error(`Unverified translated entity type: ${a.type}`)
  }
  for (const [index, before] of baseline.commandArgs.entities.entries()) {
    const after = shifted.commandArgs.entities[index]
    assert.equal(after.type, before.type)
    for (const [a, b] of pointPairs(before, after)) {
      assert.ok(Math.abs(b[0] - a[0] - offset[0]) < 1e-8)
      assert.ok(Math.abs(b[1] - a[1] - offset[1]) < 1e-8)
    }
  }
  const sdk = createKJDrawSDK()
  for (const format of ['KJD', 'DXF']) {
    const drawing = sdk.createDocument({ units: 'millimeter' })
    await sdk.executeCommand('CREATEBATCH', shifted.commandArgs, { document: drawing })
    const reopened = await sdk.readDocument(await sdk.writeDocument(drawing, { format, ...(format === 'DXF' ? { version: '2018' } : {}) }), { format })
    assert.equal(reopened.validate().valid, true)
    assert.equal(reopened.listEntities().length, shifted.evidence.entityCount)
    assert.equal(reopened.getTable('layers').records.filter(layer => layer.name.startsWith('GEO_')).length, 5)
    assert.equal(reopened.snapshot().spaces.layoutIds.length, drawing.snapshot().spaces.layoutIds.length)
  }
  for (const bad of [[1], [0, 0, 0], [Infinity, 0], [1e10, 0]]) {
    const invalid = structuredClone(shiftedPack)
    invalid.rules['geology-column-layout'].drawingOrigin = bad
    assert.throws(() => compileGeologyColumn({ ...source, columnStylePack: invalid }), /column drawing origin/)
  }
})
test('legacy footer legend lays out seven distinct lithologies without merging source strata', () => {
  const kinds = ['fill', 'clay', 'silt', 'sand', 'gravel', 'rock', 'weathered-rock']
  const input = { hole: { id: 'LEGEND-7', collarElevation: 120, depth: 14,
    strata: kinds.map((lithology, index) => ({ code: String(index + 1), name: `Unit ${index + 1}`,
      top: index * 2, bottom: (index + 1) * 2, lithology })) },
    verticalScaleDenominator: 100, expectedRevision: 0 }
  const compiled = compileGeologyColumn(input)
  assert.equal(compiled.commandArgs.entities.filter(entity => entity.type === 'HATCH').length, 14,
    'seven exact strata and seven legend swatches are retained')
  const labels = compiled.commandArgs.entities.filter(entity => entity.type === 'TEXT').map(entity => entity.payload.text)
  for (const expected of ['fill', 'clay', 'silt', 'sand', 'gravel', 'rock', 'weathered rock'])
    assert.ok(labels.includes(expected), expected)
})

test('A4 footer legend retains nine distinct lithologies and reports their exact count', () => {
  const kinds = ['fill', 'cultivated-soil', 'clay', 'silty-clay', 'silt', 'sand', 'gravel', 'loess', 'paleosol']
  const result = compileGeologyColumn({ hole: { id: 'LEGEND-9', collarElevation: 300, depth: 30,
    strata: kinds.map((lithology, index) => ({ code: String(index + 1), name: `Unit ${index + 1}`,
      top: index * 30 / 9, bottom: (index + 1) * 30 / 9, lithology })) }, expectedRevision: 0 })
  assert.equal(result.evidence.parameters.stratumCount, 9)
  assert.equal(result.evidence.parameters.lithologyCount, 9)
  assert.equal(result.evidence.parameters.verticalScaleDenominator, 200)
  assert.equal(result.commandArgs.entities.filter(entity => entity.type === 'HATCH').length, 18,
    'all nine strata and all nine separate legend swatches must remain native hatches')
  const labels = result.commandArgs.entities.filter(entity => entity.type === 'TEXT').map(entity => entity.payload.text)
  for (const kind of kinds) assert.ok(labels.includes(kind.replaceAll('-', ' ')), kind)
})

test('Chinese geology inputs produce Chinese compiler labels for columns and sections', () => {
  const columnHole = hole('ZK-中文-01', 0, 105.25)
  columnHole.strata[0].name = '杂填土'
  columnHole.strata[1].name = '粉质黏土'
  columnHole.strata[2].name = '中砂'
  const column = compileGeologyColumn({ hole: columnHole, expectedRevision: 0 })
  const columnText = column.commandArgs.entities.filter(entity => entity.type === 'TEXT').map(entity => entity.payload.text)
  for (const expected of ['钻孔柱状图', '勘探点编号', 'ZK-中文-01', '深度', '柱状图图例', '地  层  描  述']) assert.ok(columnText.some(value => value.includes(expected)), expected)
  assert.ok(columnText.includes('1:100'), 'the physical column header carries the selected vertical scale')
  assert.ok(!columnText.some(value => /ENGINEERING BOREHOLE LOG|LITHOLOGY LEGEND|VERTICAL SCALE/u.test(value)))
  const verticalRules = column.commandArgs.entities.filter(entity => entity.type === 'LINE' &&
    entity.payload.start[0] === entity.payload.end[0] && entity.payload.start[1] === 15 && entity.payload.end[1] === 245)
  assert.deepEqual(verticalRules.map(entity => entity.payload.start[0]).sort((a, b) => a - b), [25, 43, 55, 65, 75, 95, 145, 170],
    'the public style preserves the measured nine-column proportions of the accepted CAD form')
  for (const hatch of column.commandArgs.entities.filter(entity => entity.type === 'HATCH')) {
    const xs = hatch.payload.boundaryLoops[0].vertices.map(point => point[0])
    assert.equal(Math.min(...xs), 75)
    assert.equal(Math.max(...xs), 95)
  }
  assert.equal(column.commandArgs.entities.filter(entity => entity.type === 'CIRCLE').length, columnHole.strata.length,
    'the formal style emits editable CAD circles for layer numbers')
  assert.ok(column.commandArgs.entities.some(entity => entity.type === 'LWPOLYLINE' && entity.payload.closed &&
    entity.payload.vertices.some(point => point[0] === 15 && point[1] === 5) &&
    entity.payload.vertices.some(point => point[0] === 195 && point[1] === 282)), 'formal frame follows the 180 mm CAD form instead of the paper edge')

  const left = hole('ZK1', 0, 105.25), right = hole('ZK2', 20, 104.8)
  for (const item of [...left.strata, ...right.strata]) item.name = item.code === '1' ? '填土' : item.code === '2' ? '粉质黏土' : '中砂'
  const section = compileGeologySection({ holes: [left, right], correlations: [
    { fromHoleId: 'ZK1', toHoleId: 'ZK2', fromStratumCode: '1', toStratumCode: '1' },
  ], horizontalScaleDenominator: 500, verticalScaleDenominator: 200, datumElevation: 80,
  surfaceRule: 'straight-between-supplied-collars', expectedRevision: 0 })
  const sectionText = section.commandArgs.entities.filter(entity => entity.type === 'TEXT').map(entity => entity.payload.text)
  for (const expected of ['工程地质剖面图', '水平比例尺', '里程', '仅显示已提供的地层与对比关系']) assert.ok(sectionText.some(value => value.includes(expected)), expected)
  assert.ok(!sectionText.some(value => /ENGINEERING GEOLOGICAL SECTION|HORIZONTAL 1:|Only supplied strata/u.test(value)))

  const forcedEnglish = compileGeologyColumn({ hole: columnHole, locale: 'en', expectedRevision: 0 })
  assert.ok(forcedEnglish.commandArgs.entities.some(entity => entity.type === 'TEXT' && entity.payload.text === 'ENGINEERING BOREHOLE LOG'))
})

test('column selects the smallest fitting standard vertical scale and records whether it was automatic or explicit', () => {
  for (const [depths, expected] of [
    [[3, 9, 15], 100],
    [[6, 18, 30], 200],
    [[12, 36, 60], 500],
  ]) {
    const compiled = compileGeologyColumn({ hole: hole(`AUTO-${depths[2]}`, 0, 105.25, depths), expectedRevision: 0 })
    assert.equal(compiled.evidence.parameters.verticalScaleDenominator, expected)
    assert.equal(compiled.evidence.parameters.verticalScaleSource, 'style-standard')
    const labels = compiled.commandArgs.entities.filter(entity => entity.type === 'TEXT').map(entity => entity.payload.text)
    assert.ok(labels.some(label => label.includes(`1:${expected}`)))
  }
  const explicit = compileGeologyColumn({ hole: hole('EXPLICIT', 0, 105.25), verticalScaleDenominator: 125, expectedRevision: 0 })
  assert.equal(explicit.evidence.parameters.verticalScaleDenominator, 125)
  assert.equal(explicit.evidence.parameters.verticalScaleSource, 'explicit')
})

test('real projected coordinates are accepted as metadata while unsafe magnitudes are refused', () => {
  const input = { hole: { ...hole('1', 0, 1780.5, [1.5, 3.6, 15]), x: 4017268.61, y: 641811.24 },
    verticalScaleDenominator: 100, expectedRevision: 0 }
  const drawing = compileGeologyColumn(input)
  const texts = drawing.commandArgs.entities.filter(entity => entity.type === 'TEXT').map(entity => entity.payload.text)
  assert.ok(texts.some(value => value.includes('4017268.61')))
  const unsafe = structuredClone(input)
  unsafe.hole.x = 1e10
  assert.throws(() => compileGeologyColumn(unsafe), /invalid borehole X coordinate/)
})

test('source-backed major groups keep every thin lens boundary and depth while aggregating major thickness', async () => {
  const style = validateKnowledgePack({ schema: 'kjdraw.knowledge-pack.v1', id: 'geo-major-group-test', version: '1.0.0',
    title: 'Test-authored major log geometry', domain: 'geology',
    license: { spdx: 'MIT', redistributable: true, trainingAllowed: true },
    sources: [{ id: 'layout', title: 'Test-authored physical columns', license: 'MIT', contentHash: crypto.createHash('sha256').update('260x340 six-column group QA').digest('hex') }],
    ontology: { objectKinds: ['borehole-log'], relationKinds: [] },
    rules: { 'geology-column-layout': { paperWidth: 260, paperHeight: 340, left: 5, right: 255, columns: [20, 40, 60, 82, 100, 145] } } })
  const input = { hole: { id: 'SYNTHETIC-1', collarElevation: 1111.04, depth: 6.8, strata: [
    { intervalId: 'a', groupId: '1', groupRole: 'principal', code: '1_0', name: 'Fill', top: 0, bottom: 0.2, lithology: 'fill' },
    { intervalId: 'b', groupId: '2', groupRole: 'principal', code: '2_0', name: 'Silty clay', top: 0.2, bottom: 1.2, lithology: 'clay' },
    { intervalId: 'c', groupId: '2', groupRole: 'lens', code: '2_1', name: 'Silt lens', top: 1.2, bottom: 2.9, lithology: 'silt' },
    { intervalId: 'd', groupId: '2', groupRole: 'principal', code: '2_0', name: 'Silty clay', top: 2.9, bottom: 6.8, lithology: 'clay' },
  ] }, verticalScaleDenominator: 250, expectedRevision: 0, columnStylePack: style }
  const compiled = compileGeologyColumn(input)
  const texts = compiled.commandArgs.entities.filter(entity => entity.type === 'TEXT').map(entity => entity.payload.text)
  for (const value of ['0.20', '1.20', '2.90', '6.80', '6.60', '1104.24']) assert.ok(texts.includes(value), value)
  const lines = compiled.commandArgs.entities.filter(entity => entity.type === 'LINE').map(entity => entity.payload)
  assert.ok(lines.some(line => line.start[0] === 20 && line.end[0] === 145 && Math.abs(line.start[1] - 269.2) < 1e-6))
  assert.ok(lines.some(line => line.start[0] === 5 && line.end[0] === 255 && Math.abs(line.start[1] - 246.8) < 1e-6))
  assert.equal(compiled.commandArgs.entities.filter(entity => entity.type === 'HATCH').length, 7)
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATEBATCH', compiled.commandArgs, { document: drawing })
  const dxf = await sdk.writeDocument(drawing, { format: 'DXF', version: '2018' })
  assert.equal((await sdk.readDocument(dxf, { format: 'DXF' })).listEntities().length, compiled.evidence.entityCount)
  const crowded = structuredClone(input)
  crowded.hole.strata.splice(3, 0, { intervalId: 'c2', groupId: '2', groupRole: 'lens', code: '2_2',
    name: 'Thin lens', top: 2.9, bottom: 3.1, lithology: 'silt' })
  crowded.hole.strata[4].top = 3.1
  const crowdedEntities = compileGeologyColumn(crowded).commandArgs.entities
  const depthAt = value => crowdedEntities.find(entity => entity.type === 'TEXT' && entity.payload.text === value).payload.position[1]
  assert.ok(depthAt('2.90') - depthAt('3.10') >= 2.3 - 1e-6, 'Adjacent thin-lens depths must not overlap')
  assert.ok(crowdedEntities.some(entity => entity.type === 'LINE' && entity.payload.start[0] === 15 && entity.payload.end[0] === 19 && entity.payload.start[1] !== entity.payload.end[1]), 'A displaced exact depth needs a leader')
  const incomplete = structuredClone(input); delete incomplete.hole.strata[2].groupRole
  assert.throws(() => compileGeologyColumn(incomplete), /principal\/lens role/)
  const reappearing = structuredClone(input); reappearing.hole.strata[3].groupId = '1'
  assert.throws(() => compileGeologyColumn(reappearing), /may not reappear/)
})

test('versioned header grid uses only present borehole facts and keeps a deep-log legend below the body', async () => {
  const style = validateKnowledgePack({ schema: 'kjdraw.knowledge-pack.v1', id: 'geo-fact-grid-test', version: '1.0.0',
    title: 'Test-authored fact role grid', domain: 'geology', license: { spdx: 'MIT', redistributable: true, trainingAllowed: true },
    sources: [{ id: 'layout', title: 'Original synthetic role geometry', license: 'MIT', contentHash: crypto.createHash('sha256').update('synthetic grid 260x340').digest('hex') }],
    ontology: { objectKinds: ['borehole-log'], relationKinds: [] },
    rules: { 'geology-column-layout': { paperWidth: 260, paperHeight: 340, left: 5, right: 255,
      columns: [20, 40, 60, 82, 100, 145], headerDepth: 56, footerReserve: 30,
      headerGrid: { rows: [
        [{ role: 'projectName', label: '工程名称' }],
        [{ role: 'x', label: 'X坐标' }, { role: 'y', label: 'Y坐标' }, { role: 'holeId', label: '钻孔编号' }],
        [{ role: 'endDate', label: '终孔日期' }, { role: 'collarElevation', label: '孔口标高' }, { role: 'stableWaterDepth', label: '稳定水位' }],
      ] } } } })
  const source = { ...hole('QA-1', 0, 1111.04, [6.8, 15.4, 60]), x: 59333.05, y: 5168.5,
    endDate: '2013-05-12', stableWaterDepth: 5.2 }
  const input = { hole: source, projectName: 'Synthetic project', columnStylePack: style,
    verticalScaleDenominator: 250, expectedRevision: 0 }
  const compiled = compileGeologyColumn(input)
  const texts = compiled.commandArgs.entities.filter(entity => entity.type === 'TEXT')
  for (const value of ['Synthetic project', '59333.05', '5168.50', 'QA-1', '2013-05-12', '1111.04', '5.20'])
    assert.ok(texts.some(entity => entity.payload.text === value), value)
  const legend = texts.find(entity => entity.payload.text === 'LITHOLOGY LEGEND')
  assert.ok(legend.payload.position[1] < 34 - 3, 'Legend must not cross a 60 m log body ending at 34 mm')
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATEBATCH', compiled.commandArgs, { document })
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  assert.equal((await sdk.readDocument(dxf, { format: 'DXF' })).listEntities().length, compiled.evidence.entityCount)
  const missing = structuredClone(input); delete missing.hole.stableWaterDepth
  assert.throws(() => compileGeologyColumn(missing), /declared header fact stableWaterDepth is missing/)
})

test('bundled Chinese column header renders the selected physical vertical scale as visible native text', () => {
  const source = hole('比例-1', 0, 1111.04, [6.8, 15.4, 30])
  source.strata[0].name = '填土'
  const compiled = compileGeologyColumn({ hole: source, projectName: '比例尺回归', expectedRevision: 0 })
  const texts = compiled.commandArgs.entities.filter(entity => entity.type === 'TEXT').map(entity => entity.payload.text)
  assert.equal(compiled.evidence.parameters.verticalScaleDenominator, 150)
  assert.ok(texts.includes('垂直比例尺'))
  assert.ok(texts.includes('1:150'))
})

test('a versioned SPT chart cap affects visible text only, never the raw measured input', () => {
  const pack = validateKnowledgePack({ schema: 'kjdraw.knowledge-pack.v1', id: 'geo-spt-chart-cap', version: '1.0.0',
    title: 'Original synthetic display convention', domain: 'geology', license: { spdx: 'MIT', redistributable: true, trainingAllowed: true },
    sources: [{ id: 'display-rule', title: 'Synthetic observed chart cap', license: 'MIT', contentHash: crypto.createHash('sha256').update('SPT visible cap 50').digest('hex') }],
    ontology: { objectKinds: ['borehole-log'], relationKinds: [] },
    rules: { 'geology-column-layout': { paperWidth: 260, paperHeight: 340, left: 5, right: 255,
      columns: [20, 40, 60, 82, 100, 145], observationColumns: [205, 228], footerReserve: 30, sptDisplayCap: 50 } } })
  const source = hole('QA-N', 0, 1111.04, [6.8, 15.4, 60])
  source.observations = [{ kind: 'spt', id: 'measured-83', depth: 48.5, value: 83 }]
  const input = { hole: source, columnStylePack: pack, verticalScaleDenominator: 250, expectedRevision: 0 }
  const visible = compileGeologyColumn(input).commandArgs.entities.filter(entity => entity.type === 'TEXT').map(entity => entity.payload.text)
  assert.ok(visible.includes('N=50'))
  assert.ok(!visible.includes('N=83'))
  assert.equal(input.hole.observations[0].value, 83)
  const noCap = structuredClone(input); delete noCap.columnStylePack.rules['geology-column-layout'].sptDisplayCap
  assert.ok(compileGeologyColumn(noCap).commandArgs.entities.some(entity => entity.type === 'TEXT' && entity.payload.text === 'N=83'))
  const bypass = structuredClone(input); bypass.hole.observations[0].displayLabel = 'N=83'
  assert.throws(() => compileGeologyColumn(bypass), /display cap cannot coexist/)
})

test('versioned layout aliases adapt visible unit codes and names without altering source intervals', () => {
  const style = validateKnowledgePack({ schema: 'kjdraw.knowledge-pack.v1', id: 'geo-visible-aliases', version: '1.0.0',
    title: 'Test-authored display vocabulary', domain: 'geology',
    license: { spdx: 'MIT', redistributable: true, trainingAllowed: true },
    sources: [{ id: 'synthetic-layout', title: 'Test-authored display mapping', license: 'MIT',
      contentHash: crypto.createHash('sha256').update('synthetic display aliases').digest('hex') }],
    ontology: { objectKinds: ['borehole-log'], relationKinds: [] },
    rules: { 'geology-column-layout': { paperWidth: 190, paperHeight: 340, left: 5, right: 185,
      columns: [20, 40, 55, 79, 100], observationColumns: [140, 160],
      displayAliases: { codes: { '1_0': '1' }, names: { '黄土状土': '黄土' } } } } })
  const source = hole('1', 0, 1780.5, [1.5, 3.6, 15])
  source.strata[0].code = '1_0'
  source.strata[0].name = '黄土状土'
  const drawing = compileGeologyColumn({ hole: source, verticalScaleDenominator: 100,
    expectedRevision: 0, columnStylePack: style })
  const texts = drawing.commandArgs.entities.filter(entity => entity.type === 'TEXT').map(entity => entity.payload.text)
  assert.ok(texts.includes('黄土'))
  assert.ok(texts.includes('1'))
  assert.ok(!texts.includes('黄土状土'))
  assert.equal(source.strata[0].code, '1_0')
  assert.equal(source.strata[0].name, '黄土状土')
  const invalid = structuredClone(style)
  invalid.rules['geology-column-layout'].displayAliases.names['黄土状土'] = '\u0000bad'
  assert.throws(() => compileGeologyColumn({ hole: source, verticalScaleDenominator: 100,
    expectedRevision: 0, columnStylePack: invalid }), /invalid visible names alias/)
})

test('engineering section only connects declared compatible strata, with independent physical scales', async () => {
  const input = {
    holes: [hole('ZK-03', 80, 101.2, [4, 11, 18]), hole('ZK-01', 0, 105.25), hole('ZK-02', 40, 103.3, [3.5, 10, 17])],
    correlations: [
      { fromHoleId: 'ZK-01', toHoleId: 'ZK-02', fromStratumCode: '2', toStratumCode: '2' },
      { fromHoleId: 'ZK-02', toHoleId: 'ZK-03', fromStratumCode: '2', toStratumCode: '2' },
    ],
    horizontalScaleDenominator: 500, verticalScaleDenominator: 200, datumElevation: 80,
    surfaceRule: 'straight-between-supplied-collars', expectedRevision: 0,
  }
  const result = compileGeologySection(input)
  assert.equal(result.evidence.templateId, 'geology-section-engineering')
  assert.equal(result.commandArgs.entities.filter(entity => entity.type === 'HATCH').length, 11)
  assert.ok(result.commandArgs.entities.some(entity => entity.type === 'TEXT' && entity.payload.text.includes('HORIZONTAL 1:500')))
  assert.ok(result.commandArgs.entities.some(entity => entity.type === 'TEXT' && entity.payload.text.includes('VERTICAL 1:200')))
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATEBATCH', result.commandArgs, { document })
  assert.equal(document.revision, 1)
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const reopened = await sdk.readDocument(dxf, { format: 'DXF', version: '2018' })
  assert.equal(reopened.listEntities({ type: 'HATCH' }).length, 11)
  assert.equal(reopened.listEntities({ type: 'PROXY_ENTITY' }).length, 0)
  const layout = document.snapshot().spaces.layoutIds.map(id => document.getObject(id)).find(record => record?.name === 'Model')
  await sdk.executeCommand('PAGESETUP', { layoutId: layout.id, dxf: { paperWidth: 420, paperHeight: 297, paperUnits: 1, plotType: 4, windowMinX: 0, windowMinY: 0, windowMaxX: 420, windowMaxY: 297, flags: 0, scaleNumerator: 1, scaleDenominator: 1, marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0 } }, { document })
  assert.equal(exportDrawingSvg(document, { layoutId: layout.id }).report.diagnostics.length, 0)
})

test('long engineering log preserves 31 numeric intervals, repeated codes and physical 841 mm bounds', () => {
  const depths = [5.3, 6.5, 13, 17.8, 20.7, 22, 25.2, 26.5, 29.3, 33, 34.1, 37, 40.2, 47.5, 48.6, 49.5, 55.5, 58, 58.7, 60.5, 62, 63.3, 66, 70, 74.2, 77.5, 81.4, 83.5, 85, 100.5, 120]
  const codes = ['2_0', '2_2', '3_0', '5_0', '6_0', '6_1', '6_0', '6_1', '6_0', '7_0', '7_1', '7_0', '7_2', '7_0', '7_1', '7_0', '8_0', '9_0', '9_1', '9_0', '9_1', '9_0', '9_1', '9_0', '10_0', '10_1', '10_0', '10_1', '10_0', '11_0', '12_0']
  const strata = depths.map((bottom, index) => ({ code: codes[index], name: `UNIT ${codes[index]}`, top: index ? depths[index - 1] : 0, bottom, lithology: codes[index].endsWith('_1') ? 'sand' : 'clay' }))
  const result = compileGeologyColumn({ hole: { id: 'ZK-18', collarElevation: 409.68, depth: 120, strata }, verticalScaleDenominator: 200, pageHeightMillimeters: 841, expectedRevision: 0 })
  const texts = result.commandArgs.entities.filter(entity => entity.type === 'TEXT').map(entity => entity.payload.text)
  assert.equal(result.commandArgs.entities.filter(entity => entity.type === 'HATCH').length, 33)
  assert.equal(texts.filter(text => text === '120.00').length, 1)
  assert.ok(texts.includes('289.68'))
  assert.equal(texts.filter(text => text === '6_0').length, 3)
  for (const entity of result.commandArgs.entities) for (const point of [entity.payload.start, entity.payload.end, entity.payload.position, ...(entity.payload.vertices ?? [])].filter(Boolean)) assert.ok(point[1] >= 0 && point[1] <= 841)
})

test('versioned external pattern pack changes geology style as data, without changing depth geometry', async () => {
  const patSource = '*GEO_FILL,original fill\n0,0,0,0,3\n*GEO_CLAY,original clay\n45,0,0,0,3\n*GEO_SAND,original sand\n0,0,0,0,3,0,-3'
  const pack = buildHatchPatternKnowledgePack({
    id: 'geo-test-patterns', version: '1.0.0', title: 'Original test patterns', domain: 'geology',
    license: { spdx: 'MIT', redistributable: true, trainingAllowed: true },
    sources: [{ id: 'original-pat', title: 'Test-authored pattern lines', license: 'MIT', contentHash: crypto.createHash('sha256').update(patSource).digest('hex') }],
    patSource, selectedPatterns: ['GEO_FILL', 'GEO_CLAY', 'GEO_SAND'],
    mappings: { fill: 'GEO_FILL', clay: 'GEO_CLAY', sand: 'GEO_SAND' },
  })
  const input = { hole: hole('ZK-01', 0, 105.25), verticalScaleDenominator: 125, expectedRevision: 0 }
  const defaultDrawing = compileGeologyColumn(input), styledDrawing = compileGeologyColumn({ ...input, hatchPack: pack })
  assert.notEqual(defaultDrawing.evidence.packHash, styledDrawing.evidence.packHash)
  assert.equal(defaultDrawing.evidence.entityCount, styledDrawing.evidence.entityCount)
  assert.ok(styledDrawing.commandArgs.entities.filter(entity => entity.type === 'HATCH').every(entity => entity.payload.patternLines?.length === 1))
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATEBATCH', styledDrawing.commandArgs, { document })
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const reopened = await sdk.readDocument(dxf, { format: 'DXF', version: '2018' })
  assert.equal(reopened.listEntities({ type: 'HATCH' }).length, 6)
  assert.equal(reopened.listEntities({ type: 'PROXY_ENTITY' }).length, 0)
  const layout = document.snapshot().spaces.layoutIds.map(id => document.getObject(id)).find(record => record?.name === 'Model')
  await sdk.executeCommand('PAGESETUP', { layoutId: layout.id, dxf: { paperWidth: 210, paperHeight: 297, paperUnits: 1,
    plotType: 4, windowMinX: 0, windowMinY: 0, windowMaxX: 210, windowMaxY: 297, flags: 0,
    scaleNumerator: 1, scaleDenominator: 1, marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0 } }, { document })
  const preview = exportDrawingSvg(document, { layoutId: layout.id })
  assert.equal(preview.report.diagnostics.length, 0)
  assert.match(preview.svg, /kj-pat-clip-/)
  assert.match(preview.svg, /stroke-dasharray=/)
})

test('declared layout separates project descriptions from measured samples and SPT at exact depths', async () => {
  const source = '300x720 authored seven-column QA layout'
  const style = validateKnowledgePack({ schema: 'kjdraw.knowledge-pack.v1', id: 'geo-seven-column-test', version: '1.0.0',
    title: 'Original test layout', domain: 'geology',
    license: { spdx: 'MIT', redistributable: true, trainingAllowed: true },
    sources: [{ id: 'layout', title: 'Test-authored layout', license: 'MIT', contentHash: crypto.createHash('sha256').update(source).digest('hex') }],
    ontology: { objectKinds: ['borehole-log'], relationKinds: [] },
    rules: { 'geology-column-layout': { paperWidth: 300, paperHeight: 720, left: 5, right: 295,
      columns: [20, 40, 55, 79, 130], observationColumns: [245, 270] } } })
  const input = { hole: { ...hole('18', 0, 409.68), observations: [
    { kind: 'sample', id: '18-1', depth: 2, displayLabel: '1(2.00)' }, { kind: 'spt', id: '18-SPT-1', depth: 11, value: 50 } ] },
    verticalScaleDenominator: 200, expectedRevision: 0, columnStylePack: style }
  input.hole.strata[0].description = 'Silty clay, measured field description'
  assert.throws(() => compileGeologyColumn({ ...input, columnStylePack: undefined }), /separate declared columns/)
  const result = compileGeologyColumn(input)
  const labels = result.commandArgs.entities.filter(entity => entity.type === 'TEXT')
  assert.ok(labels.some(entity => entity.payload.text === '1(2.00)' && entity.payload.position[0] === 247))
  assert.ok(labels.some(entity => entity.payload.text === 'N=50' && entity.payload.position[0] === 272))
  assert.ok(result.commandArgs.entities.some(entity => entity.type === 'MTEXT' && entity.payload.text.includes('Silty clay') && entity.payload.position[0] === 132 && entity.payload.width > 0))
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATEBATCH', result.commandArgs, { document })
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const reopened = await sdk.readDocument(dxf, { format: 'DXF', version: '2018' })
  assert.equal(reopened.listEntities().length, result.evidence.entityCount)
  assert.equal(reopened.listEntities({ type: 'MTEXT' }).length, 1)
  const wide = structuredClone(input); wide.hole.observations[0].displayLabel = 'too-wide-sample-label'
  assert.throws(() => compileGeologyColumn(wide), /label does not fit/)
})

test('repeated project-definition descriptions anchor once, while interval descriptions remain distinct', () => {
  const strata = [
    { intervalId: 'a', code: '7', name: '粉质粘土', top: 0, bottom: 4, lithology: 'clay',
      description: '项目地层定义描述', descriptionSource: 'layer-definition' },
    { intervalId: 'lens', code: '7_1', name: '中砂', top: 4, bottom: 5, lithology: 'sand' },
    { intervalId: 'b', code: '7', name: '粉质粘土', top: 5, bottom: 10, lithology: 'clay',
      description: '项目地层定义描述', descriptionSource: 'layer-definition' },
  ]
  const input = { hole: { id: '18', collarElevation: 409.68, depth: 10, strata },
    verticalScaleDenominator: 200, expectedRevision: 0 }
  const project = compileGeologyColumn(input)
  assert.equal(project.commandArgs.entities.filter(entity => entity.type === 'MTEXT' && entity.payload.text === '项目地层定义描述').length, 1)
  const interval = structuredClone(input)
  interval.hole.strata[0].descriptionSource = 'interval'
  interval.hole.strata[2].descriptionSource = 'interval'
  assert.equal(compileGeologyColumn(interval).commandArgs.entities.filter(entity => entity.type === 'MTEXT' && entity.payload.text === '项目地层定义描述').length, 2)
  const unproven = structuredClone(input); unproven.hole.strata[0].description = undefined
  assert.throws(() => compileGeologyColumn(unproven), /description source requires/)
})

test('long unspaced Chinese geology descriptions remain native bounded MTEXT through DXF reopen', async () => {
  const style = validateKnowledgePack({ schema: 'kjdraw.knowledge-pack.v1', id: 'geo-cjk-mtext-test', version: '1.0.0',
    title: 'Original synthetic CJK role layout', domain: 'geology', license: { spdx: 'MIT', redistributable: true, trainingAllowed: true },
    sources: [{ id: 'text-layout', title: 'Test-authored CJK MTEXT cell', license: 'MIT', contentHash: crypto.createHash('sha256').update('native CJK description').digest('hex') }],
    ontology: { objectKinds: ['borehole-log'], relationKinds: [] },
    rules: { 'geology-column-layout': { paperWidth: 260, paperHeight: 340, left: 5, right: 255,
      columns: [20, 40, 60, 82, 100, 145], observationColumns: [205, 228], footerReserve: 30 } } })
  const source = hole('CJK-1', 0, 1111.04, [6.8, 15.4, 60])
  const paragraph = '黄褐色中密细砂含少量云母碎片'.repeat(5)
  source.strata[1].description = paragraph
  const compiled = compileGeologyColumn({ hole: source, verticalScaleDenominator: 250, expectedRevision: 0, columnStylePack: style })
  const text = compiled.commandArgs.entities.find(entity => entity.type === 'MTEXT' && entity.payload.text === paragraph)
  assert.ok(text)
  assert.equal(text.payload.width, 56)
  assert.ok(layoutCadMText(text.payload).lines.length > 1, 'CJK without spaces must wrap inside the declared CAD width')
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATEBATCH', compiled.commandArgs, { document })
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const reopened = await sdk.readDocument(dxf, { format: 'DXF', version: '2018' })
  assert.ok(reopened.listEntities({ type: 'MTEXT' }).some(entity => entity.payload.text === paragraph && entity.payload.width === 56))
})

test('a versioned fourteen-field grid charts direct sample measurements without per-project drawing code', async () => {
  const fieldGrid = [
    { start: 5, role: 'layerNumber', label: '层号' }, { start: 21, role: 'layerName', label: '地层名称' },
    { start: 41, role: 'baseElevation', label: '底标高' }, { start: 56, role: 'thickness', label: '厚度' },
    { start: 71, role: 'depth', label: '层底深度' }, { start: 83, role: 'pattern', label: '岩性花纹' },
    { start: 102, role: 'description', label: '地层描述' }, { start: 171, role: 'sample', label: '取样编号' },
    { start: 186, role: 'measurement', key: 'moisture', decimals: 1, label: '含水率' },
    { start: 195, role: 'measurement', key: 'voidRatio', decimals: 3, label: '孔隙比' },
    { start: 205, role: 'measurement', key: 'liquidIndex', decimals: 2, label: '液性指数' },
    { start: 214, role: 'measurement', key: 'plasticityIndex', decimals: 1, label: '塑性指数' },
    { start: 223, role: 'spt', label: '标贯N' },
    { start: 242, role: 'measurement', key: 'collapseCoefficient', decimals: 3, label: '湿陷系数' },
  ]
  const style = validateKnowledgePack({ schema: 'kjdraw.knowledge-pack.v1', id: 'geo-fourteen-field-test', version: '1.0.0',
    title: 'Test-authored measurement role schema', domain: 'geology', license: { spdx: 'MIT', redistributable: true, trainingAllowed: true },
    sources: [{ id: 'role-grid', title: 'Synthetic fourteen-field grid', license: 'MIT', contentHash: crypto.createHash('sha256').update('synthetic14fieldgrid').digest('hex') }],
    ontology: { objectKinds: ['borehole-log'], relationKinds: [] },
    rules: { 'geology-column-layout': { paperWidth: 260, paperHeight: 340, left: 5, right: 255,
      fieldGrid, footerReserve: 30, sptDisplayCap: 50, legendMode: 'none', titleHeight: 9 } } })
  const source = hole('GRID-1', 0, 1111.04, [6.8, 15.4, 60])
  source.observations = [
    { kind: 'sample', id: 'R1', depth: 2, displayLabel: '1(2.00)', measurements: {
      moisture: 19.4, voidRatio: 0.715, liquidIndex: 0.43, plasticityIndex: 8.9, collapseCoefficient: 0.003 } },
    { kind: 'spt', id: 'P2', depth: 6.8, value: 12 },
    { kind: 'spt', id: 'P1', depth: 42.5, value: 83 },
  ]
  const input = { hole: source, verticalScaleDenominator: 250, expectedRevision: 0, columnStylePack: style }
  const compiled = compileGeologyColumn(input)
  const visible = compiled.commandArgs.entities.filter(entity => entity.type === 'TEXT').map(entity => entity.payload.text)
  for (const value of ['19.4', '0.715', '0.43', '8.9', '0.003', 'N=12', 'N=50']) assert.ok(visible.includes(value), value)
  assert.ok(compiled.commandArgs.entities.some(entity => entity.type === 'TEXT' &&
    entity.payload.text === 'ENGINEERING BOREHOLE LOG' && entity.payload.height === 9))
  assert.equal(input.hole.observations[2].value, 83)
  const boundaryY = 340 - 56 - 10 - 6.8 * 4
  const spt = compiled.commandArgs.entities.find(entity => entity.type === 'TEXT' && entity.payload.text === 'N=12')
  assert.ok(!compiled.commandArgs.entities.some(entity => entity.type === 'LINE' &&
    Math.abs(entity.payload.start[1] - boundaryY) < 1e-6 && Math.abs(entity.payload.end[1] - boundaryY) < 1e-6 &&
    entity.payload.start[0] <= spt.payload.position[0] + 1 && entity.payload.end[0] >= spt.payload.position[0] + 1))
  assert.ok(compiled.commandArgs.entities.some(entity => entity.type === 'HATCH' &&
    Math.min(...entity.payload.boundaryLoops[0].vertices.map(point => point[0])) === 83 &&
    Math.max(...entity.payload.boundaryLoops[0].vertices.map(point => point[0])) === 102))
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATEBATCH', compiled.commandArgs, { document })
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  assert.equal((await sdk.readDocument(dxf, { format: 'DXF' })).listEntities().length, compiled.evidence.entityCount)
  const missing = structuredClone(input)
  missing.columnStylePack.rules['geology-column-layout'].fieldGrid = fieldGrid.filter(field => field.role !== 'description')
  assert.throws(() => compileGeologyColumn(missing), /misses a core role/)
  const unsafe = structuredClone(input)
  unsafe.hole.observations[0].measurements.__proto__ = { untracked: 4 }
  unsafe.hole.observations[0].measurements['not-safe!'] = 4
  assert.throws(() => compileGeologyColumn(unsafe), /invalid sampled measurement key/)
  const badTitle = structuredClone(input)
  badTitle.columnStylePack.rules['geology-column-layout'].titleHeight = 30
  assert.throws(() => compileGeologyColumn(badTitle), /title height must be 3–12/)
  const ranged = structuredClone(input)
  ranged.hole.observations[0].depth = 2.075
  ranged.hole.observations[0].rangeTop = 2
  ranged.hole.observations[0].rangeBottom = 2.15
  const rangedCompiled = compileGeologyColumn(ranged)
  assert.ok(rangedCompiled.commandArgs.entities.some(entity => entity.type === 'TEXT' &&
    entity.payload.text === '2.00–2.15'), 'only source-supplied sample endpoints may be charted')
  for (const endpoint of [2, 2.15]) {
    const endpointY = 340 - 56 - 10 - endpoint * 4
    assert.ok(rangedCompiled.commandArgs.entities.some(entity => entity.type === 'LINE' &&
      Math.abs(entity.payload.start[1] - endpointY) < 1e-6 &&
      Math.abs(entity.payload.end[1] - endpointY) < 1e-6 &&
      entity.payload.start[0] >= 171 && entity.payload.end[0] <= 186), `sample endpoint ${endpoint}`)
  }
  const rangedDocument = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATEBATCH', rangedCompiled.commandArgs, { document: rangedDocument })
  const rangedDxf = await sdk.writeDocument(rangedDocument, { format: 'DXF', version: '2018' })
  const rangedReopen = await sdk.readDocument(rangedDxf, { format: 'DXF', version: '2018' })
  assert.ok(rangedReopen.listEntities({ type: 'TEXT' }).some(entity => entity.payload.text === '2.00–2.15'))
  assert.ok(!visible.some(value => value.includes('–')), 'a point sample without measured endpoints has no invented interval')
  const incomplete = structuredClone(ranged)
  delete incomplete.hole.observations[0].rangeBottom
  assert.throws(() => compileGeologyColumn(incomplete), /require both measured endpoints/)
  const outside = structuredClone(ranged)
  outside.hole.observations[0].rangeTop = 2.1
  assert.throws(() => compileGeologyColumn(outside), /outside its point/)
  const overlap = structuredClone(ranged)
  overlap.hole.observations.push({ kind: 'sample', id: 'R2', depth: 2.13, rangeTop: 2.1, rangeBottom: 2.2 })
  assert.throws(() => compileGeologyColumn(overlap), /intervals overlap/)
})

test('a declared text lane borrows space for a sourced thin first group without moving depth or hatch boundaries', async () => {
  const grid = [
    { start: 5, role: 'layerNumber', label: 'No' }, { start: 20, role: 'layerName', label: 'Name' },
    { start: 40, role: 'baseElevation', label: 'Base' }, { start: 55, role: 'thickness', label: 'Thick' },
    { start: 70, role: 'depth', label: 'Depth' }, { start: 82, role: 'pattern', label: 'Pattern' },
    { start: 100, role: 'description', label: 'Description' }, { start: 170, role: 'sample', label: 'Sample' },
    { start: 190, role: 'spt', label: 'SPT' },
  ]
  const rule = { paperWidth: 260, paperHeight: 340, left: 5, right: 255, fieldGrid: grid,
    legendMode: 'none', textFlow: { firstGroupBorrowMm: 8, firstGroupUnruled: true,
      firstBaselineMm: 3.4, labelPitchMm: 5, labelHeightMm: 2.7, paragraphGapMm: 1.5 } }
  const style = validateKnowledgePack({ schema: 'kjdraw.knowledge-pack.v1', id: 'geo-thin-text-flow', version: '1.0.0',
    title: 'Synthetic source-backed thin text lane', domain: 'geology',
    license: { spdx: 'MIT', redistributable: true, trainingAllowed: true },
    sources: [{ id: 'synthetic-text', title: 'Synthetic layer paragraphs', license: 'MIT',
      contentHash: crypto.createHash('sha256').update('synthetic-thin-text-flow').digest('hex') }],
    ontology: { objectKinds: ['borehole-log'], relationKinds: [] }, rules: { 'geology-column-layout': rule } })
  const input = { hole: { id: 'FLOW-1', collarElevation: 1111.04, depth: 10, strata: [
    { intervalId: 'a', groupId: '1', groupRole: 'principal', code: '1', name: 'Fill', top: 0, bottom: 0.2,
      lithology: 'fill', description: '土'.repeat(40) },
    { intervalId: 'b', groupId: '2', groupRole: 'principal', code: '2', name: 'Clay', top: 0.2, bottom: 5,
      lithology: 'clay', description: '黏'.repeat(55) },
    { intervalId: 'c', groupId: '3', groupRole: 'principal', code: '3', name: 'Sand', top: 5, bottom: 10,
      lithology: 'sand' },
  ] }, verticalScaleDenominator: 250, expectedRevision: 0, columnStylePack: style }
  const compiled = compileGeologyColumn(input)
  const firstBottom = 340 - 56 - 10 - 0.2 * 4
  const firstName = compiled.commandArgs.entities.find(entity => entity.type === 'TEXT' && entity.payload.text === 'Fill')
  const secondName = compiled.commandArgs.entities.find(entity => entity.type === 'TEXT' && entity.payload.text === 'Clay')
  assert.ok(firstName.payload.position[1] < firstBottom)
  assert.ok(secondName.payload.position[1] <= firstName.payload.position[1] - 5)
  assert.equal(compiled.commandArgs.entities.filter(entity => entity.type === 'MTEXT').length, 2)
  const firstBoundaryLines = compiled.commandArgs.entities.filter(entity => entity.type === 'LINE' &&
    Math.abs(entity.payload.start[1] - firstBottom) < 1e-6 && Math.abs(entity.payload.end[1] - firstBottom) < 1e-6)
  assert.ok(firstBoundaryLines.some(entity => entity.payload.start[0] >= 70 && entity.payload.end[0] <= 82))
  assert.ok(firstBoundaryLines.some(entity => entity.payload.start[0] === 82 && entity.payload.end[0] === 100))
  assert.ok(!firstBoundaryLines.some(entity => entity.payload.start[0] <= 20 && entity.payload.end[0] >= 170))
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATEBATCH', compiled.commandArgs, { document })
  const reopened = await sdk.readDocument(await sdk.writeDocument(document, { format: 'DXF', version: '2018' }), { format: 'DXF' })
  assert.equal(reopened.listEntities({ type: 'MTEXT' }).length, 2)
  const noFlow = structuredClone(input)
  delete noFlow.columnStylePack.rules['geology-column-layout'].textFlow
  assert.throws(() => compileGeologyColumn(noFlow), /core labels collide with a boundary/)
  const noBorrow = structuredClone(input)
  noBorrow.columnStylePack.rules['geology-column-layout'].textFlow.firstGroupBorrowMm = 0
  assert.throws(() => compileGeologyColumn(noBorrow), /core labels collide|description collides/)
})

test('twelve sourced CJK layer-name characters reject a 20 mm lane and survive a 39 mm knowledge-pack lane without truncation', async () => {
  const name = '灰黄含砾粉质黏土夹层细砂'
  assert.equal([...name].length, 12)
  const patSource = '*SYNTH_CLAY,synthetic test hatch\n45,0,0,0,3'
  const hatchPack = buildHatchPatternKnowledgePack({ id: 'geo-cjk-lane-pat-test', version: '1.0.0', title: 'Synthetic clay hatch',
    domain: 'geology', license: { spdx: 'MIT', redistributable: true, trainingAllowed: true },
    sources: [{ id: 'synthetic-pat', title: 'MIT-authored hatch line', license: 'MIT', contentHash: crypto.createHash('sha256').update(patSource).digest('hex') }],
    patSource, selectedPatterns: ['SYNTH_CLAY'], mappings: { clay: 'SYNTH_CLAY' } })
  const grid = nameEnd => [
    { start: 5, role: 'layerNumber', label: '层号' }, { start: 20, role: 'layerName', label: '地层名' },
    { start: nameEnd, role: 'baseElevation', label: '底标高' }, { start: nameEnd + 15, role: 'thickness', label: '厚度' },
    { start: nameEnd + 30, role: 'depth', label: '层底深度' }, { start: nameEnd + 42, role: 'pattern', label: '花纹' },
    { start: nameEnd + 60, role: 'description', label: '描述' }, { start: nameEnd + 130, role: 'sample', label: '取样' },
    { start: nameEnd + 150, role: 'spt', label: '标贯' },
  ]
  const style = (id, nameEnd) => validateKnowledgePack({ schema: 'kjdraw.knowledge-pack.v1', id, version: '1.0.0',
    title: 'MIT synthetic CJK field lane', domain: 'geology', license: { spdx: 'MIT', redistributable: true, trainingAllowed: true },
    sources: [{ id: 'synthetic-grid', title: 'MIT-authored CJK lane widths', license: 'MIT',
      contentHash: crypto.createHash('sha256').update(`synthetic CJK name lane ${nameEnd - 20} mm`).digest('hex') }],
    ontology: { objectKinds: ['borehole-log'], relationKinds: [] },
    rules: { 'geology-column-layout': { paperWidth: 300, paperHeight: 340, left: 5, right: 295,
      fieldGrid: grid(nameEnd), legendMode: 'none' } } })
  const narrow = style('geo-cjk-name-lane-20-test', 40), wide = style('geo-cjk-name-lane-39-test', 59)
  const originalNarrow = structuredClone(narrow), originalWide = structuredClone(wide), originalHatch = structuredClone(hatchPack)
  const input = { hole: { id: 'SYN-CJK-12', collarElevation: 105, depth: 10,
    strata: [{ code: '1', name, top: 0, bottom: 10, lithology: 'clay' }] },
  verticalScaleDenominator: 125, expectedRevision: 0, hatchPack }
  assert.throws(() => compileGeologyColumn({ ...input, columnStylePack: narrow }), /layerName text does not fit its declared field/u)
  const compiled = compileGeologyColumn({ ...input, columnStylePack: wide })
  const sourceLabels = compiled.commandArgs.entities.filter(entity => entity.type === 'TEXT' && entity.payload.text === name)
  assert.equal(sourceLabels.length, 1)
  const wideFields = grid(59), layerNameField = wideFields.find(field => field.role === 'layerName')
  const baseElevationField = wideFields.find(field => field.role === 'baseElevation')
  assert.equal(sourceLabels[0].payload.position[0], (layerNameField.start + baseElevationField.start) / 2,
    'formal field values are centred inside their declared physical lane')
  assert.equal(sourceLabels[0].payload.horizontalAlignment, 1)
  assert.ok(compiled.commandArgs.entities.some(entity => entity.type === 'HATCH' && entity.payload.patternLines?.length === 1))
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATEBATCH', compiled.commandArgs, { document })
  assert.equal(document.revision, 1)
  assert.equal(document.listEntities().length, compiled.evidence.entityCount)
  assert.equal(document.validate().valid, true)
  await sdk.executeCommand('UNDO', {}, { document })
  assert.equal(document.listEntities().length, 0)
  assert.equal(document.validate().valid, true)
  await sdk.executeCommand('REDO', {}, { document })
  assert.equal(document.listEntities().length, compiled.evidence.entityCount)
  assert.equal(document.validate().valid, true)
  for (const format of ['KJD', 'DXF']) {
    const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format }), { format })
    assert.equal(reopened.validate().valid, true)
    assert.equal(reopened.listEntities().length, compiled.evidence.entityCount)
    assert.equal(reopened.listEntities({ type: 'TEXT' }).filter(entity => entity.payload.text === name).length, 1)
    assert.ok(reopened.listEntities({ type: 'HATCH' }).some(entity => entity.payload.patternLines?.length === 1))
  }
  assert.equal(input.hole.strata[0].name, name)
  assert.deepEqual(narrow, originalNarrow)
  assert.deepEqual(wide, originalWide)
  assert.deepEqual(hatchPack, originalHatch)
})

test('section targets repeated layer codes by exact interval identity, never an arbitrary first match', () => {
  const repeated = (id, station) => ({ id, station, collarElevation: 105, depth: 10, strata: [
    { intervalId: `${id}-a`, code: '7', name: 'Clay', top: 0, bottom: 3, lithology: 'clay' },
    { intervalId: `${id}-lens`, code: '7_1', name: 'Sand lens', top: 3, bottom: 4, lithology: 'sand' },
    { intervalId: `${id}-b`, code: '7', name: 'Clay', top: 4, bottom: 10, lithology: 'clay' },
  ] })
  const base = { holes: [repeated('A', 0), repeated('B', 20)], horizontalScaleDenominator: 500,
    verticalScaleDenominator: 200, datumElevation: 80, surfaceRule: 'straight-between-supplied-collars', expectedRevision: 0 }
  assert.throws(() => compileGeologySection({ ...base, correlations: [{ fromHoleId: 'A', toHoleId: 'B', fromStratumCode: '7', toStratumCode: '7' }] }), /unambiguous interval/)
  const exact = compileGeologySection({ ...base, correlations: [{ fromHoleId: 'A', toHoleId: 'B', fromIntervalId: 'A-b', toIntervalId: 'B-b' }] })
  assert.equal(exact.commandArgs.entities.filter(entity => entity.type === 'HATCH').length, 7)
  assert.equal(exact.commandArgs.entities.filter(entity => entity.type === 'HATCH' && Math.max(...entity.payload.boundaryLoops[0].vertices.map(point => point[0])) - Math.min(...entity.payload.boundaryLoops[0].vertices.map(point => point[0])) > 20).length, 1)
})

test('section correlations stay between adjacent holes and preserve one-to-one stratigraphic order', () => {
  const sectionHole = (id, station, order = ['clay', 'clay', 'clay']) => ({
    id, station, collarElevation: 105, depth: 12,
    strata: order.map((lithology, index) => ({
      intervalId: `${id}-${index + 1}`, code: `${index + 1}`, name: lithology,
      top: index * 4, bottom: (index + 1) * 4, lithology,
    })),
  })
  const holes = [sectionHole('A', 0), sectionHole('B', 20), sectionHole('C', 40)]
  const base = { holes, horizontalScaleDenominator: 500, verticalScaleDenominator: 200,
    datumElevation: 80, surfaceRule: 'straight-between-supplied-collars', expectedRevision: 0 }
  assert.throws(() => compileGeologySection({ ...base, correlations: [
    { fromHoleId: 'A', toHoleId: 'C', fromIntervalId: 'A-1', toIntervalId: 'C-1' },
  ] }), /adjacent station-ordered holes/)
  assert.throws(() => compileGeologySection({ ...base, correlations: [
    { fromHoleId: 'A', toHoleId: 'B', fromIntervalId: 'A-1', toIntervalId: 'B-2' },
    { fromHoleId: 'A', toHoleId: 'B', fromIntervalId: 'A-2', toIntervalId: 'B-1' },
  ] }), /cross or reverse stratigraphic order/)
  assert.throws(() => compileGeologySection({ ...base, correlations: [
    { fromHoleId: 'A', toHoleId: 'B', fromIntervalId: 'A-1', toIntervalId: 'B-1' },
    { fromHoleId: 'A', toHoleId: 'B', fromIntervalId: 'A-1', toIntervalId: 'B-2' },
  ] }), /cannot branch into multiple correlations/)
  const compiled = compileGeologySection({ ...base, correlations: [
    { fromHoleId: 'A', toHoleId: 'B', fromIntervalId: 'A-1', toIntervalId: 'B-1' },
    { fromHoleId: 'A', toHoleId: 'B', fromIntervalId: 'A-2', toIntervalId: 'B-2' },
    { fromHoleId: 'B', toHoleId: 'C', fromIntervalId: 'B-1', toIntervalId: 'C-1' },
  ] })
  assert.equal(compiled.commandArgs.entities.filter(entity => entity.type === 'HATCH').length, 12,
    'nine borehole bands plus three non-crossing correlation polygons are preserved')
})

test('complete section occurrence map fails closed on absent or guessed cross-hole facts', () => {
  const left = hole('LEFT', 0, 105.25), right = hole('RIGHT', 20, 104.8)
  for (const source of [left, right]) source.strata.forEach((stratum, index) => { stratum.intervalId = `${source.id}-${index}` })
  const input = { holes: [left, right], correlations: [0, 1].map(index => ({
    fromHoleId: left.id, toHoleId: right.id,
    fromIntervalId: left.strata[index].intervalId, toIntervalId: right.strata[index].intervalId,
  })), uncorrelatedOccurrences: [
    { holeId: left.id, adjacentHoleId: right.id, intervalId: left.strata[2].intervalId },
    { holeId: right.id, adjacentHoleId: left.id, intervalId: right.strata[2].intervalId },
  ], sourceFactMode: 'complete-occurrence-map', horizontalScaleDenominator: 500,
  verticalScaleDenominator: 200, datumElevation: 80, surfaceRule: 'straight-between-supplied-collars', expectedRevision: 0 }
  const compiled = compileGeologySection(input)
  assert.equal(compiled.evidence.parameters.sourceFactMode, 'caller-declared-complete-occurrence-map')
  assert.equal(compiled.evidence.parameters.occurrenceCount, 6)
  assert.equal(compiled.evidence.parameters.linkedOccurrenceCount, 4)
  assert.equal(compiled.evidence.parameters.unlinkedOccurrenceCount, 2)
  const absent = structuredClone(input); absent.uncorrelatedOccurrences.pop()
  assert.throws(() => compileGeologySection(absent), /incomplete adjacent-hole occurrence map/)
  const duplicate = structuredClone(input); duplicate.uncorrelatedOccurrences.push(duplicate.uncorrelatedOccurrences[0])
  assert.throws(() => compileGeologySection(duplicate), /duplicate or conflicting interval occurrence/)
  const guessed = structuredClone(input)
  delete guessed.correlations[0].fromIntervalId; delete guessed.correlations[0].toIntervalId
  guessed.correlations[0].fromStratumCode = '1'; guessed.correlations[0].toStratumCode = '1'
  assert.throws(() => compileGeologySection(guessed), /exact interval-ID correlations/)
  const inferred = structuredClone(input); inferred.correlationMode = 'source-group-topology'; inferred.correlations = []
  assert.throws(() => compileGeologySection(inferred), /not inferred groups/)
  const depthOnly = structuredClone(input); depthOnly.manualConnections = [
    { fromHoleId: left.id, toHoleId: right.id, fromDepth: 3, toDepth: 3 },
  ]
  assert.throws(() => compileGeologySection(depthOnly), /not inferred groups or depth-only connections/)
  const unknown = structuredClone(input); unknown.uncorrelatedOccurrences[0].intervalId = 'unknown'
  assert.throws(() => compileGeologySection(unknown), /unknown or nonadjacent interval/)
  const repeated = structuredClone(input); repeated.holes[0].strata[1].intervalId = repeated.holes[0].strata[0].intervalId
  assert.throws(() => compileGeologySection(repeated), /repeated interval id|unique source interval IDs/)
  const noMode = structuredClone(input); delete noMode.sourceFactMode
  assert.throws(() => compileGeologySection(noMode), /uncorrelated occurrences require complete occurrence-map mode/)
})
test('engineering geography refuses invented, discontinuous or visually unreadable layers and correlations', () => {
  const base = { hole: hole('ZK-01', 0, 105.25), verticalScaleDenominator: 125, expectedRevision: 0 }
  const gap = structuredClone(base); gap.hole.strata[1].top = 3.1
  assert.throws(() => compileGeologyColumn(gap), /gap, overlap/)
  const thin = structuredClone(base); thin.hole.strata[0].bottom = 0.1; thin.hole.strata[1].top = 0.1
  assert.throws(() => compileGeologyColumn(thin), /too thin/)
  const unknown = structuredClone(base); unknown.hole.strata[1].lithology = 'imaginary-rock'
  assert.throws(() => compileGeologyColumn(unknown), /undeclared lithology/)
  const noRule = { holes: [hole('ZK-01', 0, 105.25), hole('ZK-02', 40, 103.3)], correlations: [], horizontalScaleDenominator: 500, verticalScaleDenominator: 200, datumElevation: 80, expectedRevision: 0 }
  assert.throws(() => compileGeologySection(noRule), /explicit surface connection rule/)
  const noLink = { ...noRule, surfaceRule: 'straight-between-supplied-collars' }
  assert.ok(compileGeologySection(noLink).commandArgs.entities.every(entity => entity.type !== 'HATCH' || entity.payload.boundaryLoops[0].vertices.length === 4))
  const badLink = { ...noLink, correlations: [{ fromHoleId: 'ZK-01', toHoleId: 'ZK-02', fromStratumCode: '2', toStratumCode: 'missing' }] }
  assert.throws(() => compileGeologySection(badLink), /unambiguous interval/)
})
