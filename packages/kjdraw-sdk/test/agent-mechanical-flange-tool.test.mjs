import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'
import { createKJDrawSDK, KJAgentToolSession } from '../src/index.js'

const accepted = result => {
  assert.equal(result.ok, true, JSON.stringify(result))
  return result.value
}

const input = expectedRevision => ({
  version: '1.0.0',
  expectedRevision,
  units: 'millimeter',
  locale: 'zh-CN',
  drawingId: 'PUBLIC-SIMPLE-FLANGE',
  title: '简单法兰零件图',
  outerDiameter: 120,
  boreDiameter: 40,
  thickness: 20,
  boltCount: 6,
  boltCircleDiameter: 90,
  boltHoleDiameter: 10,
})

test('agent proposes, approves and reopens one native simple flange drawing', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const session = new KJAgentToolSession(sdk, document)
  const proposal = accepted(await session.call('cad_propose_mechanical_flange', input(document.revision)))
  assert.equal(document.revision, 0)
  assert.equal(proposal.status, 'awaiting-host-approval')
  assert.equal(proposal.command, 'CREATEBATCH')
  assert.equal(proposal.engineeringEvidence.knowledgePackId, 'mechanical-flange-core')
  assert.equal(proposal.engineeringEvidence.parameters.holeCount, 6)
  assert.equal(proposal.engineeringEvidence.parameters.dimensionCount, 4)
  assert.ok(proposal.preview.after.some(entity => entity.type === 'CIRCLE'))
  assert.ok(proposal.preview.after.some(entity => entity.type === 'DIMENSION'))
  accepted(await session.approve(proposal.planId, 'mechanical-reviewer'))
  assert.equal(document.revision, 1)
  assert.equal(document.listEntities({ type: 'DIMENSION' }).length, 4)
  assert.equal(document.listEntities({ type: 'CIRCLE' }).length, 9)

  const kjd = await sdk.writeDocument(document, { format: 'KJD' })
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const layout = document.listObjects({ kind: 'layout' }).find(item => item.name?.startsWith('KJ_MECH_'))
  assert.ok(layout)
  assert.deepEqual([layout.payload.dxfPlotSettings.paperWidth, layout.payload.dxfPlotSettings.paperHeight], [420, 297])
  const svg = await sdk.writeDocument(document, { format: 'SVG', layoutId: layout.id })
  for (const [format, bytes] of [['KJD', kjd], ['DXF', dxf]]) {
    const reopened = await sdk.readDocument(bytes, { format })
    assert.equal(reopened.validate().valid, true)
    assert.equal(reopened.listEntities({ type: 'DIMENSION' }).length, 4)
  }
  const svgText = typeof svg === 'string' ? svg : new TextDecoder().decode(svg)
  assert.match(svgText, /<svg/u)

  const audit = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON || 'python', ['-c',
    'import io,json,os,ezdxf; d=ezdxf.read(io.StringIO(open(os.environ["KJDRAW_FILE_STDIN_PATH"],encoding="utf-8").read())); a=d.audit(); m=d.modelspace(); print(json.dumps({"errors":len(a.errors),"fixes":len(a.fixes),"circles":len(m.query("CIRCLE")),"dimensions":len(m.query("DIMENSION"))}))'],
  dxf, { encoding: 'utf8', windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
  assert.equal(audit.status, 0, audit.stderr)
  assert.deepEqual(JSON.parse(audit.stdout), { errors: 0, fixes: 0, circles: 9, dimensions: 4 })
})

test('simple flange tool rejects impossible dimensions and nonblank drawings', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const session = new KJAgentToolSession(sdk, document)
  const impossible = await session.call('cad_propose_mechanical_flange', { ...input(0), boltCircleDiameter: 48 })
  assert.equal(impossible.ok, false)
  assert.equal(document.revision, 0)
  await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0, 0], end: [1, 0, 0] } }, { document })
  const occupied = await session.call('cad_propose_mechanical_flange', input(document.revision))
  assert.equal(occupied.ok, false)
  assert.equal(document.listEntities().length, 1)
})
