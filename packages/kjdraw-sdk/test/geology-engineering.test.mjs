import assert from 'node:assert/strict'
import test from 'node:test'
import crypto from 'node:crypto'
import { buildHatchPatternKnowledgePack, compileGeologyColumn, compileGeologySection, createKJDrawSDK, exportDrawingSvg, validateKnowledgePack } from '../src/index.js'

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
  for (const expected of ['DEPTH m', 'ELEV. m', 'LITHOLOGY LEGEND', '89.25', '16.00', 'VERTICAL SCALE 1:125.00']) assert.ok(labels.some(label => label.includes(expected)), expected)
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
  assert.ok(result.commandArgs.entities.some(entity => entity.type === 'TEXT' && entity.payload.text.includes('HORIZONTAL 1:500.00')))
  assert.ok(result.commandArgs.entities.some(entity => entity.type === 'TEXT' && entity.payload.text.includes('VERTICAL 1:200.00')))
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
  assert.ok(labels.some(entity => entity.payload.text.includes('Silty clay') && entity.payload.position[0] === 132))
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATEBATCH', result.commandArgs, { document })
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const reopened = await sdk.readDocument(dxf, { format: 'DXF', version: '2018' })
  assert.equal(reopened.listEntities().length, result.evidence.entityCount)
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
  assert.equal(project.commandArgs.entities.filter(entity => entity.type === 'TEXT' && entity.payload.text === '项目地层定义描述').length, 1)
  const interval = structuredClone(input)
  interval.hole.strata[0].descriptionSource = 'interval'
  interval.hole.strata[2].descriptionSource = 'interval'
  assert.equal(compileGeologyColumn(interval).commandArgs.entities.filter(entity => entity.type === 'TEXT' && entity.payload.text === '项目地层定义描述').length, 2)
  const unproven = structuredClone(input); unproven.hole.strata[0].description = undefined
  assert.throws(() => compileGeologyColumn(unproven), /description source requires/)
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
