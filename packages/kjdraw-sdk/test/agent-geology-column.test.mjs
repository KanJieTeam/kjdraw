import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { createKJDrawSDK } from '../src/sdk.js'

function intent(expectedRevision = 0) {
  return {
    version: '1.0.0', expectedRevision, units: 'millimeter', verticalScaleDenominator: 125,
    projectName: 'Synthetic engineering log',
    hole: {
      id: 'TEST-BH-01', collarElevation: 105.25, depth: 16, stableWaterDepth: 5.2,
      strata: [
        { intervalId: 'a', code: '1', name: 'Made ground', top: 0, bottom: 3, lithology: 'fill' },
        { intervalId: 'b', code: '2', name: 'Silty clay', top: 3, bottom: 9, lithology: 'clay' },
        { intervalId: 'c', code: '3', name: 'Medium sand', top: 9, bottom: 16, lithology: 'sand' },
      ],
      observations: [
        { kind: 'sample', id: 'S1', depth: 4.1, displayLabel: 'S1' },
        { kind: 'spt', id: 'N1', depth: 11, value: 19 },
      ],
    },
  }
}

function accepted(result) { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }
const sha = value => createHash('sha256').update(value).digest('hex')

test('versioned geology facts compile to a host-only CREATEBATCH proposal, then one editable transaction and KJD/DXF reopen', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const session = new KJAgentToolSession(sdk, document)
  const schema = session.definitions.find(tool => tool.name === 'cad_propose_geology_column')
  assert.equal(schema.effect, 'propose')
  assert.deepEqual(schema.inputSchema.properties.units.enum, ['millimeter'])
  assert.equal(schema.inputSchema.required.includes('verticalScaleDenominator'), false)
  assert.equal(schema.inputSchema.properties.hole.required.includes('initialWaterDepth'), false)
  assert.equal(schema.inputSchema.properties.hole.properties.initialWaterDepth.minimum, 0)
  assert.deepEqual(schema.inputSchema.properties.hole.properties.observations.items.properties.sampleMarker.enum,
    ['filled-circle', 'open-circle'])
  assert.equal(schema.inputSchema.properties.hole.properties.strata.items.properties.patternLabel.maxLength, 24)
  const groundwaterSchema = schema.inputSchema.properties.hole.properties.groundwaterObservations
  assert.deepEqual(groundwaterSchema.items.required, ['depth', 'elevation', 'observedOn', 'marker'])
  assert.deepEqual(groundwaterSchema.items.properties.marker.enum, ['filled-down-triangle'])
  assert.equal(schema.inputSchema.properties.hole.properties.strata.items.properties.description.maxLength, 512)
  assert.equal(session.definitions.some(tool => /approve|save|execute/.test(tool.name)), false)
  const before = document.serialize(), proposal = accepted(await session.call('cad_propose_geology_column', intent()))
  assert.equal(proposal.command, 'CREATEBATCH')
  assert.equal(proposal.status, 'awaiting-host-approval')
  assert.equal(proposal.engineeringEvidence.templateId, 'borehole-column-engineering')
  assert.equal(proposal.engineeringEvidence.packId, 'geology.core')
  assert.ok(proposal.engineeringEvidence.entityCount > 35)
  assert.equal(document.serialize(), before)
  assert.equal(document.revision, 0)
  const { verticalScaleDenominator: _ignored, ...automaticIntent } = intent()
  const automatic = accepted(await session.call('cad_propose_geology_column', automaticIntent))
  assert.equal(automatic.engineeringEvidence.parameters.verticalScaleSource, 'style-standard')
  assert.equal(document.revision, 0)
  const receipt = accepted(await session.approve(proposal.planId, 'synthetic-host-reviewer'))
  assert.equal(receipt.command, 'CREATEBATCH')
  assert.equal(receipt.beforeRevision, 0)
  assert.equal(receipt.afterRevision, 1)
  assert.equal(document.listEntities().length, proposal.engineeringEvidence.entityCount)
  assert.equal(document.listEntities({ type: 'HATCH' }).length, 6)
  assert.equal(document.getTable('layers').records.filter(layer => layer.name.startsWith('GEO_')).length, 5)
  assert.equal((await session.approve(proposal.planId, 'synthetic-host-reviewer')).ok, false, 'A plan is never replayed')
  await document.undo()
  assert.equal(document.listEntities().length, 0)
  await document.redo()
  assert.equal(document.listEntities().length, proposal.engineeringEvidence.entityCount)
  const kjd = await sdk.writeDocument(document, { format: 'KJD' })
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const reopenedKjd = await createKJDrawSDK().readDocument(kjd, { format: 'KJD' })
  const reopenedDxf = await createKJDrawSDK().readDocument(dxf, { format: 'DXF' })
  for (const reopened of [reopenedKjd, reopenedDxf]) {
    assert.equal(reopened.listEntities().length, proposal.engineeringEvidence.entityCount)
    assert.equal(reopened.listEntities({ type: 'HATCH' }).length, 6)
    assert.equal(reopened.validate().valid, true)
  }
})

test('bundled field-grid knowledge carries notation, sample markers and independent groundwater readings through Agent KJD/DXF', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const session = new KJAgentToolSession(sdk, document), request = intent()
  request.locale = 'zh-CN'
  request.documentFacts = [{ key: 'recordNumber', value: '18' }]
  request.hole.strata[0].stratigraphicNotation = { symbol: 'Q', subscript: '4', superscript: 'ml' }
  request.hole.strata[2].patternLabel = 'SC'
  request.hole.observations[0].sampleMarker = 'filled-circle'
  request.hole.groundwaterObservations = [
    { depth: 6.25, elevation: 99, observedOn: '2026-01-04', marker: 'filled-down-triangle' },
  ]
  const proposal = accepted(await session.call('cad_propose_geology_column', request))
  for (const value of ['Q', '4', 'ml', 'SC', '●', '6.25', '99.00', '▼', '2026-01-04', '记录号:18'])
    assert.ok(proposal.arguments.entities.some(entity => entity.type === 'TEXT' && entity.payload.text === value), value)
  accepted(await session.approve(proposal.planId, 'synthetic-host-reviewer'))
  for (const format of ['KJD', 'DXF']) {
    const bytes = await sdk.writeDocument(document, { format, ...(format === 'DXF' ? { version: '2018' } : {}) })
    const reopened = await createKJDrawSDK().readDocument(bytes, { format, ...(format === 'DXF' ? { version: '2018' } : {}) })
    assert.equal(reopened.validate().valid, true)
    for (const value of ['Q', '4', 'ml', 'SC', '●', '6.25', '99.00', '▼', '2026-01-04', '记录号:18'])
      assert.ok(reopened.listEntities({ type: 'TEXT' }).some(entity => entity.payload.text === value), `${format} ${value}`)
  }
})

test('source-backed boundary-only strata keep boundaries and text while omitting hatch fills across KJD/DXF reopen', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const session = new KJAgentToolSession(sdk, document)
  const base = intent()
  const sourceIntent = {
    ...base,
    hole: { ...base.hole, strata: base.hole.strata.map((layer, index) => index === 1 ? { ...layer, patternVisibility: 'boundary-only' } : layer) },
  }
  const schema = session.definitions.find(tool => tool.name === 'cad_propose_geology_column')
  assert.deepEqual(schema.inputSchema.properties.hole.properties.strata.items.properties.patternVisibility.enum, ['filled', 'boundary-only'])
  const invalid = await session.call('cad_propose_geology_column', {
    ...sourceIntent,
    hole: { ...sourceIntent.hole, strata: sourceIntent.hole.strata.map((layer, index) => index === 1 ? { ...layer, patternVisibility: 'outline-only' } : layer) },
  })
  assert.equal(invalid.ok, false)
  assert.match(invalid.error.message, /patternVisibility|boundary-only|filled/u)
  const proposal = accepted(await session.call('cad_propose_geology_column', sourceIntent))
  assert.equal(proposal.arguments.entities.filter(entity => entity.type === 'HATCH').length, 5)
  assert.equal(proposal.arguments.entities.filter(entity => entity.type === 'LINE').length > 0, true)
  const textValues = proposal.arguments.entities.filter(entity => entity.type === 'TEXT').map(entity => entity.payload.text)
  assert.ok(textValues.includes('Silty clay'))
  accepted(await session.approve(proposal.planId, 'synthetic-host-reviewer'))
  for (const format of ['KJD', 'DXF']) {
    const bytes = await sdk.writeDocument(document, { format, ...(format === 'DXF' ? { version: '2018' } : {}) })
    const reopened = await createKJDrawSDK().readDocument(bytes, { format, ...(format === 'DXF' ? { version: '2018' } : {}) })
    assert.equal(reopened.validate().valid, true)
    assert.equal(reopened.listEntities({ type: 'HATCH' }).length, 5)
    assert.ok(reopened.listEntities({ type: 'LINE' }).length > 0)
    assert.ok(reopened.listEntities({ type: 'TEXT' }).some(entity => entity.payload.text === 'Silty clay'))
  }
})

test('Chinese loess-region lithologies remain explicit and scale labels use engineering integer notation', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const session = new KJAgentToolSession(sdk, document)
  const schema = session.definitions.find(tool => tool.name === 'cad_propose_geology_column')
  for (const value of ['loess', 'loess-collapsible', 'loess-like', 'paleosol', 'silty-clay', 'calcareous-nodule']) {
    assert.ok(schema.inputSchema.properties.hole.properties.strata.items.properties.lithology.enum.includes(value), value)
  }
  const proposal = accepted(await session.call('cad_propose_geology_column', {
    version: '1.0.0', expectedRevision: 0, units: 'millimeter', locale: 'zh-CN', verticalScaleDenominator: 50,
    projectName: '陇东黄土工程', hole: { id: 'ZK-01', collarElevation: 1188.6, depth: 5, strata: [
      { code: '1', name: '湿陷性黄土', top: 0, bottom: 1, lithology: 'loess-collapsible' },
      { code: '2', name: '古土壤', top: 1, bottom: 2, lithology: 'paleosol' },
      { code: '3', name: '黄土状土', top: 2, bottom: 3, lithology: 'loess-like' },
      { code: '4', name: '粉质黏土', top: 3, bottom: 4, lithology: 'silty-clay' },
      { code: '5', name: '钙质结核层', top: 4, bottom: 5, lithology: 'calcareous-nodule' },
    ] },
  }))
  const visible = proposal.arguments.entities.filter(entity => ['TEXT', 'MTEXT'].includes(entity.type)).map(entity => entity.payload.text)
  for (const label of ['钻孔柱状图', '陇东黄土工程', '湿陷性黄土', '古土壤', '黄土状土', '粉质黏土', '钙质结核层']) {
    assert.ok(visible.some(text => String(text).includes(label)), label)
  }
  assert.ok(visible.some(text => String(text) === '1:50'))
  assert.ok(!visible.some(text => String(text).includes('1:50.00')))
  const patterns = proposal.arguments.entities.filter(entity => entity.type === 'HATCH').map(entity => entity.payload.patternName)
  for (const name of ['GEO_COLLAPSIBLE_LOESS', 'GEO_PALEOSOL', 'GEO_LOESS_LIKE', 'GEO_SILTY_CLAY', 'GEO_NODULE']) assert.ok(patterns.includes(name), name)
  assert.equal(new Set(patterns).size, 5)
})

test('a 30 m Chinese loess log keeps seven lithologies, descriptions, samples and SPT in one candidate', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const session = new KJAgentToolSession(sdk, document)
  const result = await session.call('cad_propose_geology_column', {
    version: '1.0.0', expectedRevision: 0, units: 'millimeter', locale: 'zh-CN',
    projectName: '黄土塬工程', hole: { id: 'ZK1', collarElevation: 1128.5, depth: 30, stableWaterDepth: 25.5,
      strata: [
        { code: '1', name: '耕土', top: 0, bottom: 0.5, lithology: 'cultivated-soil', description: '植物根系发育' },
        { code: '2', name: '湿陷性黄土', top: 0.5, bottom: 5.5, lithology: 'loess-collapsible', description: '大孔隙发育' },
        { code: '3', name: '黄土', top: 5.5, bottom: 12.5, lithology: 'loess', description: '垂直节理发育' },
        { code: '4', name: '古土壤', top: 12.5, bottom: 14.8, lithology: 'paleosol', description: '棕红色' },
        { code: '5', name: '钙质结核层', top: 14.8, bottom: 18, lithology: 'calcareous-nodule', description: '钙质结核富集' },
        { code: '6', name: '黄土状土', top: 18, bottom: 23.5, lithology: 'loess-like', description: '黄褐色' },
        { code: '7', name: '粉质黏土', top: 23.5, bottom: 30, lithology: 'silty-clay', description: '可塑' },
      ], observations: [
        { kind: 'sample', id: 'S1', depth: 4.1, displayLabel: 'S1' },
        { kind: 'spt', id: 'N1', depth: 11, value: 19 },
        { kind: 'sample', id: 'S2', depth: 20, displayLabel: 'S2' },
        { kind: 'spt', id: 'N2', depth: 27, value: 28 },
      ] },
  })
  const proposal = accepted(result), visible = proposal.arguments.entities
    .filter(entity => ['TEXT', 'MTEXT'].includes(entity.type)).map(entity => String(entity.payload.text))
  assert.equal(proposal.engineeringEvidence.parameters.verticalScaleDenominator, 150)
  for (const label of ['耕土', '湿陷性黄土', '黄土', '古土壤', '钙质结核层', '黄土状土', '粉质黏土', 'S1', 'S2', 'N=19', 'N=28'])
    assert.ok(visible.some(value => value.includes(label)), label)
  assert.equal(proposal.arguments.entities.filter(entity => entity.type === 'HATCH').length, 7)
  assert.equal(document.revision, 0)
})

test('nine Chinese lithologies are proposed, approved and reopened without an A4 five-class truncation', async t => {
  const names = ['素填土', '耕植土', '黏土', '粉质黏土', '粉土', '砂土', '砾石', '黄土', '古土壤']
  const lithologies = ['fill', 'cultivated-soil', 'clay', 'silty-clay', 'silt', 'sand', 'gravel', 'loess', 'paleosol']
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const session = new KJAgentToolSession(sdk, document)
  assert.match(session.definitions.find(tool => tool.name === 'cad_propose_geology_column').description, /no five-class limit/u)
  const proposal = accepted(await session.call('cad_propose_geology_column', {
    version: '1.0.0', expectedRevision: 0, units: 'millimeter', locale: 'zh-CN',
    hole: { id: 'ZK09', collarElevation: 300, depth: 30,
      strata: names.map((name, index) => ({ code: String(index + 1), name, top: index * 30 / 9,
        bottom: (index + 1) * 30 / 9, lithology: lithologies[index] })) },
  }))
  assert.equal(proposal.engineeringEvidence.parameters.stratumCount, 9)
  assert.equal(proposal.engineeringEvidence.parameters.lithologyCount, 9)
  assert.equal(proposal.arguments.entities.filter(entity => entity.type === 'HATCH').length, 9)
  const texts = proposal.arguments.entities.filter(entity => entity.type === 'TEXT').map(entity => entity.payload.text)
  for (const name of names) assert.equal(texts.filter(text => text === name).length, 1, name)
  accepted(await session.approve(proposal.planId, 'synthetic-host-reviewer'))
  let dxf
  for (const format of ['KJD', 'DXF']) {
    const bytes = await sdk.writeDocument(document, { format, ...(format === 'DXF' ? { version: '2018' } : {}) })
    if (format === 'DXF') dxf = bytes
    const reopened = await sdk.readDocument(bytes,
      { format, ...(format === 'DXF' ? { version: '2018' } : {}) })
    assert.equal(reopened.listEntities({ type: 'HATCH' }).length, 9)
    const visible = reopened.listEntities({ type: 'TEXT' }).map(entity => entity.payload.text)
    for (const name of names) assert.equal(visible.filter(text => text === name).length, 1, `${format}: ${name}`)
  }
  const independent = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON || 'python', ['-c',
    'import io,json,os,ezdxf; from ezdxf.tools.text import plain_text; d=ezdxf.read(io.StringIO(open(os.environ["KJDRAW_FILE_STDIN_PATH"],encoding="utf-8").read())); a=d.audit(); m=d.modelspace(); print(json.dumps({"errors":len(a.errors),"fixes":len(a.fixes),"hatches":len(m.query("HATCH")),"texts":[plain_text(e.dxf.text) for e in m.query("TEXT")]},ensure_ascii=False))'],
  dxf, { encoding: 'utf8', windowsHide: true, env: { ...process.env,
    PYTHONPATH: process.env.KJDRAW_EZDXF_PATH || process.env.PYTHONPATH || '', PYTHONIOENCODING: 'utf-8' } })
  if (independent.error?.code === 'ENOENT' || /No module named ['"]ezdxf/u.test(independent.stderr || '')) {
    if (process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED === '1') assert.fail(independent.stderr || independent.error?.message)
    t.diagnostic('official ezdxf unavailable; independent check skipped')
  } else {
    assert.equal(independent.status, 0, independent.stderr)
    const report = JSON.parse(independent.stdout)
    assert.deepEqual([report.errors, report.fixes, report.hatches], [0, 0, 9])
    for (const name of names) assert.equal(report.texts.filter(text => text === name).length, 1, `ezdxf: ${name}`)
  }
})

test('MIT synthetic style renders an appendix document fact only when explicitly supplied and preserves atomic roundtrips', async () => {
  const pack = {
    schema: 'kjdraw.knowledge-pack.v1', id: 'synthetic-appendix-header', version: '1.0.0',
    title: 'MIT synthetic appendix header', domain: 'geology',
    license: { spdx: 'MIT', redistributable: true, trainingAllowed: true },
    sources: [{ id: 'synthetic-layout', title: 'Original synthetic appendix header grid', license: 'MIT',
      contentHash: sha('synthetic appendix header grid 260x340') }],
    ontology: { objectKinds: ['borehole-log'], relationKinds: [] },
    rules: { 'geology-column-layout': { paperWidth: 260, paperHeight: 340, left: 5, right: 255,
      columns: [20, 40, 60, 82, 100, 145], headerDepth: 56, footerReserve: 30,
      headerGrid: { rows: [
        [{ role: 'projectName', label: 'PROJECT' }, { role: 'holeId', label: 'HOLE' }],
        [{ role: 'documentFact', key: 'appendixNumber', label: 'APPENDIX' }],
      ] } } },
  }
  const input = { ...intent(), documentFacts: [{ key: 'appendixNumber', value: 'APP-A-07' }] }
  const packBefore = JSON.stringify(pack), inputBefore = JSON.stringify(input)
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const session = new KJAgentToolSession(sdk, document, { geologyColumnKnowledge: { pack, sha256: sha(JSON.stringify(pack)) } })
  const schema = session.definitions.find(tool => tool.name === 'cad_propose_geology_column').inputSchema.properties.documentFacts
  assert.equal(schema.maxItems, 8)
  assert.equal(schema.items.additionalProperties, false)
  assert.deepEqual(schema.items.required, ['key', 'value'])

  const missing = await session.call('cad_propose_geology_column', intent())
  assert.equal(missing.ok, false)
  assert.match(missing.error.message, /declared header fact appendixNumber is missing/u)
  assert.equal(document.listEntities().length, 0)
  for (const documentFacts of [
    [{ key: 'appendixNumber', value: 'A' }, { key: 'AppendixNumber', value: 'B' }],
    [{ key: 'appendix-number', value: 'A' }],
    [{ key: 'appendixNumber', value: 'A\nB' }],
    [{ key: 'unrequestedFact', value: 'A' }],
  ]) {
    const rejected = await session.call('cad_propose_geology_column', { ...intent(), documentFacts })
    assert.equal(rejected.ok, false)
  }

  const proposal = accepted(await session.call('cad_propose_geology_column', input))
  assert.equal(proposal.command, 'CREATEBATCH')
  const proposedTexts = proposal.arguments.entities.filter(entity => entity.type === 'TEXT').map(entity => entity.payload.text)
  assert.equal(proposedTexts.filter(value => value === 'APP-A-07').length, 1)
  assert.equal(document.listEntities().length, 0)
  accepted(await session.approve(proposal.planId, 'synthetic-host-reviewer'))
  const visibleAppendix = drawing => drawing.listEntities({ type: 'TEXT' }).filter(entity => entity.payload.text === 'APP-A-07').length
  assert.equal(visibleAppendix(document), 1)
  await document.undo()
  assert.equal(document.listEntities().length, 0)
  await document.redo()
  assert.equal(visibleAppendix(document), 1)

  const kjd = await sdk.writeDocument(document, { format: 'KJD' })
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  for (const [bytes, format] of [[kjd, 'KJD'], [dxf, 'DXF']]) {
    const reopened = await createKJDrawSDK().readDocument(bytes, { format })
    assert.equal(reopened.validate().valid, true)
    assert.equal(visibleAppendix(reopened), 1)
  }
  assert.equal(JSON.stringify(pack), packBefore)
  assert.equal(JSON.stringify(input), inputBefore)
})

test('wrong version, unlicensed pattern request, missing engineering facts and host rejection never change the drawing', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' }), session = new KJAgentToolSession(sdk, document)
  const before = document.serialize()
  for (const bad of [
    { ...intent(), version: '2.0.0' },
    { ...intent(), pageHeightMillimeters: 500 },
    { ...intent(), hole: { ...intent().hole, strata: intent().hole.strata.map((layer, index) => index ? layer : { ...layer, patternKey: 'purchased-private-pattern' }) } },
    { ...intent(), hole: { ...intent().hole, strata: intent().hole.strata.slice(0, 2) } },
  ]) assert.equal((await session.call('cad_propose_geology_column', bad)).ok, false)
  assert.equal(document.serialize(), before)
  const plan = accepted(await session.call('cad_propose_geology_column', intent()))
  assert.equal(accepted(session.reject(plan.planId, 'synthetic-host-reviewer')).status, 'rejected')
  assert.equal((await session.approve(plan.planId, 'synthetic-host-reviewer')).ok, false)
  assert.equal(document.serialize(), before)
  const meterSdk = createKJDrawSDK(), meterDrawing = meterSdk.createDocument({ units: 'meter' })
  assert.equal(new KJAgentToolSession(meterSdk, meterDrawing).definitions.some(tool => tool.name === 'cad_propose_geology_column'), false)
})

test('MCP stdio lists and calls geology intent as a pending ledger entry without approving or changing its source KJD', async t => {
  const root = await mkdtemp(join(tmpdir(), 'kjdraw-mcp-geology-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'pending'))
  const sdk = createKJDrawSDK(), source = await sdk.writeDocument(sdk.createDocument({ units: 'millimeter' }), { format: 'KJD' })
  const inputPath = join(root, 'blank.kjd')
  await writeFile(inputPath, source)
  const sourceSha = sha(await readFile(inputPath))
  const messages = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'cad_propose_geology_column', arguments: intent() } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'cad_approve', arguments: { planId: 'forbidden' } } },
  ]
  const mcp = fileURLToPath(new URL('../bin/kjdraw-mcp.mjs', import.meta.url))
  const launched = spawnSync(process.execPath, [mcp, '--workspace', root, '--input', 'blank.kjd', '--proposal-dir', 'pending'], {
    input: `${messages.map(message => JSON.stringify(message)).join('\n')}\n`, encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024,
  })
  assert.equal(launched.status, 0, launched.stderr)
  const replies = launched.stdout.trim().split('\n').map(line => JSON.parse(line))
  assert.deepEqual(replies.map(reply => reply.id), [1, 2, 3, 4])
  assert.ok(replies[1].result.tools.some(tool => tool.name === 'cad_propose_geology_column' && tool.annotations.readOnlyHint === false))
  const proposal = accepted(replies[2].result.structuredContent)
  assert.equal(proposal.command, 'CREATEBATCH')
  assert.equal(proposal.status, 'awaiting-host-approval')
  assert.equal(proposal.product, 'KJDraw')
  assert.equal(proposal.responseKind, 'compact-engineering-proposal@1')
  assert.equal(Object.hasOwn(proposal, 'arguments'), false)
  assert.equal(Object.hasOwn(proposal, 'preview'), false)
  assert.ok(proposal.nativeGeometry.entityCount > 35)
  assert.ok(Buffer.byteLength(JSON.stringify(replies[2].result.structuredContent)) < 2048)
  assert.equal(replies[3].error.code, -32602)
  const ledgers = await readdir(join(root, 'pending'))
  assert.equal(ledgers.length, 1)
  const ledger = JSON.parse(await readFile(join(root, 'pending', ledgers[0]), 'utf8'))
  assert.equal(ledger.proposals.length, 1)
  assert.equal(ledger.proposals[0].tool, 'cad_propose_geology_column')
  assert.equal(ledger.proposals[0].result.planId, proposal.planId)
  assert.equal(ledger.proposals[0].result.arguments.entities.length, proposal.nativeGeometry.entityCount)
  assert.equal(ledger.proposals[0].result.preview.after.length, proposal.nativeGeometry.entityCount)
  assert.ok(Buffer.byteLength(JSON.stringify(ledger.proposals[0].result)) >
    Buffer.byteLength(JSON.stringify(replies[2].result.structuredContent)) * 8,
  'the host keeps the full plan while the model receives less than one eighth of its serialized bytes')
  assert.equal(sha(await readFile(inputPath)), sourceSha)
})
