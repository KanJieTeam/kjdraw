import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createKJDrawSDK } from '../src/sdk.js'
import { createAgentGeometryPreview } from '../src/agent-preview.js'
import { reviewLedger } from '../bin/kjdraw-review.mjs'

const cli = fileURLToPath(new URL('../bin/kjdraw.mjs', import.meta.url))

function run(root, args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
}

test('Skill-facing CLI lists tool schemas without MCP client registration or workspace writes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'kjdraw-agent-tools-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const child = run(root, ['agent', 'tools', 'cad_propose_circles'])
  assert.equal(child.status, 0, child.stderr)
  const output = JSON.parse(child.stdout)
  assert.equal(output.tool.name, 'cad_propose_circles')
  assert.deepEqual(output.tool.inputSchema.required, ['expectedRevision', 'units', 'circles'])
  const meter = run(root, ['agent', 'tools', 'cad_propose_circles', '--units', 'meter'])
  assert.equal(meter.status, 0, meter.stderr)
  assert.deepEqual(JSON.parse(meter.stdout).tool.inputSchema.properties.units.enum, ['meter'])
  assert.deepEqual(await readdir(root), [])
})

test('Skill-facing basic drawing uses one small schema and produces reviewed KJD and DXF', async t => {
  const root = await mkdtemp(join(tmpdir(), 'kjdraw-agent-basic-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const listed = run(root, ['agent', 'tools', 'cad_propose_drawing_basic'])
  assert.equal(listed.status, 0, listed.stderr)
  assert.deepEqual(JSON.parse(listed.stdout).tool.inputSchema.required, ['expectedRevision', 'units'])
  await writeFile(join(root, 'basic.json'), JSON.stringify({
    expectedRevision: 0, units: 'millimeter',
    lines: [[0, 0, 40, 0]], circles: [[20, 10, 4]],
  }))
  const proposed = run(root, ['agent', 'call', 'cad_propose_drawing_basic', '--blank', 'source.kjd', '--units', 'millimeter', '--args-file', 'basic.json'])
  assert.equal(proposed.status, 0, proposed.stderr)
  const response = JSON.parse(proposed.stdout)
  assert.equal(response.ok, true, JSON.stringify(response))
  assert.equal(response.value.status, 'awaiting-host-approval')
  const original = await readFile(join(root, 'source.kjd'))
  const receipt = await reviewLedger({ workspace: root, ledger: response.ledger, sequence: 1, candidate: 'basic-candidate.kjd', reviewer: 'automated-test-fixture' }, async () => true)
  assert.equal(receipt.execution.liveUndoRedoVerified, true)
  assert.deepEqual(await readFile(join(root, 'source.kjd')), original)
  const sdk = createKJDrawSDK()
  for (const [filename, format] of [['basic-candidate.kjd', 'KJD'], ['basic-candidate.dxf', 'DXF']]) {
    const drawing = await sdk.readDocument(await readFile(join(root, filename)), { format })
    assert.deepEqual(drawing.listEntities().map(entity => entity.type).sort(), ['CIRCLE', 'LINE'])
  }
})

test('Skill-facing CLI creates only a review proposal; host review produces new CAD candidates', async t => {
  const root = await mkdtemp(join(tmpdir(), 'kjdraw-agent-call-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'circle.json'), JSON.stringify({ expectedRevision: 0, units: 'millimeter', circles: [{ center: { x: 0, y: 0 }, radius: 5 }] }))
  const child = run(root, ['agent', 'call', 'cad_propose_circles', '--blank', 'host.kjd', '--units', 'millimeter', '--args-file', 'circle.json'])
  assert.equal(child.status, 0, child.stderr)
  const output = JSON.parse(child.stdout)
  assert.equal(output.ok, true)
  assert.equal(output.value.status, 'awaiting-host-approval')
  assert.equal(output.ledger.startsWith('.kjdraw/proposals/'), true)
  const sdk = createKJDrawSDK()
  const sourceBefore = await readFile(join(root, 'host.kjd'))
  const source = await sdk.readDocument(sourceBefore.toString('utf8'), { format: 'KJD' })
  assert.equal(source.revision, 0)
  assert.equal(source.listEntities().length, 0)
  const readOnly = run(root, ['agent', 'call', 'cad_read_drawing', '--input', 'host.kjd'])
  assert.equal(readOnly.status, 0, readOnly.stderr)
  assert.equal(JSON.parse(readOnly.stdout).value.revision, 0)
  assert.deepEqual(await readFile(join(root, 'host.kjd')), sourceBefore)
  const ledger = JSON.parse(await readFile(join(root, output.ledger), 'utf8'))
  assert.equal(ledger.proposals.length, 1)
  assert.equal(ledger.proposals[0].tool, 'cad_propose_circles')
  const receipt = await reviewLedger({ workspace: root, ledger: output.ledger, sequence: 1, candidate: 'candidate.kjd', reviewer: 'test' }, async () => true)
  assert.equal(receipt.execution.afterRevision, 1)
  assert.deepEqual(await readFile(join(root, 'host.kjd')), sourceBefore)
  const candidate = await sdk.readDocument(await readFile(join(root, 'candidate.kjd'), 'utf8'), { format: 'KJD' })
  assert.equal(candidate.listEntities().length, 1)
})

test('Skill-facing CLI compiles a mechanical flange and host review reopens KJD and DXF', async t => {
  const root = await mkdtemp(join(tmpdir(), 'kjdraw-agent-flange-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const request = {
    version: '1.0.0', expectedRevision: 0, units: 'millimeter', locale: 'zh-CN',
    drawingId: 'SKILL-FLANGE-SMOKE', title: '六孔法兰零件图',
    outerDiameter: 120, boreDiameter: 40, thickness: 20,
    boltCount: 6, boltCircleDiameter: 90, boltHoleDiameter: 10,
  }
  await writeFile(join(root, 'request.json'), JSON.stringify(request))
  const proposed = run(root, [
    'agent', 'call', 'cad_propose_mechanical_flange', '--blank', 'source.kjd',
    '--units', 'millimeter', '--args-file', 'request.json',
  ])
  assert.equal(proposed.status, 0, proposed.stderr)
  const response = JSON.parse(proposed.stdout)
  assert.equal(response.ok, true, JSON.stringify(response))
  assert.equal(response.value.status, 'awaiting-host-approval')
  assert.equal(response.value.engineeringEvidence.parameters.holeCount, 6)
  const sourceBytes = await readFile(join(root, 'source.kjd'))
  const sdk = createKJDrawSDK()
  const source = await sdk.readDocument(sourceBytes.toString('utf8'), { format: 'KJD' })
  assert.equal(source.revision, 0)
  assert.equal(source.listEntities().length, 0)
  const recomputed = await createAgentGeometryPreview(source, 'CREATEBATCH', response.value.arguments, { maxCreatedEntities: 512 })
  assert.deepEqual(JSON.parse(JSON.stringify(recomputed)), response.value.preview)

  const receipt = await reviewLedger({
    workspace: root, ledger: response.ledger, sequence: 1,
    candidate: 'reviewed-flange.kjd', reviewer: 'automated-test-fixture',
  }, async () => true)
  assert.equal(receipt.hostConfirmed, false)
  assert.equal(receipt.confirmationMethod, 'internal-test-fixture')
  assert.equal(receipt.execution.afterRevision, 1)
  assert.equal(receipt.execution.liveUndoRedoVerified, true)
  assert.deepEqual(await readFile(join(root, 'source.kjd')), sourceBytes)
  for (const [name, format] of [['reviewed-flange.kjd', 'KJD'], ['reviewed-flange.dxf', 'DXF']]) {
    const drawing = await sdk.readDocument(await readFile(join(root, name)), { format })
    assert.equal(drawing.validate().valid, true)
    assert.equal(drawing.listEntities({ type: 'CIRCLE' }).length, 9)
    assert.equal(drawing.listEntities({ type: 'DIMENSION' }).length, 4)
  }
})

test('host review rejects a changed mechanical sheet layout after proposal', async t => {
  const root = await mkdtemp(join(tmpdir(), 'kjdraw-agent-layout-tamper-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'request.json'), JSON.stringify({
    version: '1.0.0', expectedRevision: 0, units: 'millimeter',
    drawingId: 'LAYOUT-TAMPER', title: 'Flange', outerDiameter: 120,
    boreDiameter: 40, thickness: 20, boltCount: 6,
    boltCircleDiameter: 90, boltHoleDiameter: 10,
  }))
  const proposed = run(root, [
    'agent', 'call', 'cad_propose_mechanical_flange', '--blank', 'source.kjd',
    '--units', 'millimeter', '--args-file', 'request.json',
  ])
  assert.equal(proposed.status, 0, proposed.stderr)
  const ledgerPath = JSON.parse(proposed.stdout).ledger
  const ledger = JSON.parse(await readFile(join(root, ledgerPath), 'utf8'))
  ledger.proposals[0].result.arguments.layout.dxfPlotSettings.paperWidth = 999
  await writeFile(join(root, ledgerPath), JSON.stringify(ledger))
  await assert.rejects(reviewLedger({
    workspace: root, ledger: ledgerPath, sequence: 1,
    candidate: 'forged.kjd', reviewer: 'automated-test-fixture',
  }, async () => true), /Native layout arguments disagree/u)
  await assert.rejects(readFile(join(root, 'forged.kjd')), { code: 'ENOENT' })
})

test('Skill-facing CLI reviews a ten-point illustrative geology plan as editable CAD', async t => {
  const root = await mkdtemp(join(tmpdir(), 'kjdraw-agent-geology-plan-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'request.json'), JSON.stringify({
    expectedRevision: 0, units: 'millimeter', pointCount: 10,
    depthMeters: 30, spacingMeters: 30, locale: 'zh-CN',
  }))
  const proposed = run(root, [
    'agent', 'call', 'cad_propose_geology_plan_example', '--blank', 'source.kjd',
    '--units', 'millimeter', '--args-file', 'request.json',
  ])
  assert.equal(proposed.status, 0, proposed.stderr)
  const response = JSON.parse(proposed.stdout)
  assert.equal(response.ok, true, JSON.stringify(response))
  const ledger = JSON.parse(await readFile(join(root, response.ledger), 'utf8'))
  assert.equal(ledger.proposals[0].result.status, 'awaiting-host-approval')
  const sourceBytes = await readFile(join(root, 'source.kjd'))
  const receipt = await reviewLedger({
    workspace: root, ledger: response.ledger, sequence: 1,
    candidate: 'reviewed-geology-plan.kjd', reviewer: 'automated-test-fixture',
  }, async () => true)
  assert.equal(receipt.execution.liveUndoRedoVerified, true)
  assert.deepEqual(await readFile(join(root, 'source.kjd')), sourceBytes)
  const sdk = createKJDrawSDK()
  for (const [name, format] of [['reviewed-geology-plan.kjd', 'KJD'], ['reviewed-geology-plan.dxf', 'DXF']]) {
    const drawing = await sdk.readDocument(await readFile(join(root, name)), { format })
    assert.equal(drawing.validate().valid, true)
    assert.ok(drawing.listEntities().length >= 10)
  }
})

test('Skill-facing CLI rejects escaping argument paths and unknown approval tools', async t => {
  const root = await mkdtemp(join(tmpdir(), 'kjdraw-agent-boundary-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const escaped = run(root, ['agent', 'call', 'cad_read_drawing', '--blank', 'host.kjd', '--units', 'millimeter', '--args-file', '../outside.json'])
  assert.equal(escaped.status, 1)
  assert.match(escaped.stderr, /--args-file must be an unambiguous path/u)
  const fake = run(root, ['agent', 'call', 'cad_approve', '--blank', 'host.kjd', '--units', 'millimeter'])
  assert.equal(fake.status, 1)
  assert.match(fake.stderr, /Unknown KJDraw agent tool/u)
  assert.deepEqual(await readdir(root), [])
})
