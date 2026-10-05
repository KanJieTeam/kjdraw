import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'
import { createKJDrawSDK, getEntityGrips, transformEntityPayload, translation3 } from '../src/index.js'
import { exportDrawingSvg } from '../src/svg-export.js'

const rectangle = {
  position: [10, 20, 0], uVector: [20, 0, 0], vVector: [0, 8, 0],
  clipBoundary: [[-0.5, -0.5], [0.5, 0.5]], boundaryType: 1,
}
const polygon = {
  position: [50, 40, 0], uVector: [12, 3, 0], vVector: [-2, 9, 0], boundaryType: 2,
  clipBoundary: Array.from({ length: 128 }, (_, index) => {
    const angle = Math.PI * 2 * index / 128
    return [Math.cos(angle) * 0.5, Math.sin(angle) * 0.5]
  }),
}

const display = entity => {
  const p = entity.payload
  return [p.flags, p.clipping, p.brightness, p.contrast, p.fade, p.clipMode]
}
const points = payload => payload.vertices.map(vertex => Array.isArray(vertex) ? vertex : vertex.point)
const boundarySummary = document => document.listEntities({ type: 'WIPEOUT' }).map(entity => [entity.payload.boundaryType, entity.payload.clipBoundary.length]).sort((a, b) => a[1] - b[1] || a[0] - b[0])

test('native WIPEOUT preserves rectangular and 128-point local clipping through KJD and DXF', async t => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'native-wipeout-roundtrip' })
  await sdk.executeCommand('CREATE', { type: 'WIPEOUT', payload: rectangle }, { document })
  await sdk.executeCommand('CREATE', { type: 'WIPEOUT', payload: polygon }, { document })
  await sdk.executeCommand('CREATE', { type: 'WIPEOUT', payload: {
    ...rectangle, position: [80, 20, 0], flags: 15, clipping: false,
    brightness: 44, contrast: 55, fade: 6, clipMode: true,
  } }, { document })
  const current = document.listEntities({ type: 'WIPEOUT' })
  assert.deepEqual(current.map(entity => [entity.payload.boundaryType, entity.payload.clipBoundary.length, entity.payload.vertices.length]), [[1, 2, 4], [2, 128, 128], [1, 2, 4]])
  assert.deepEqual(display(current[0]), [7, true, 50, 50, 0, false])
  assert.deepEqual(display(current[2]), [15, false, 44, 55, 6, true])

  const kjd = await sdk.readDocument(await sdk.writeDocument(document, { format: 'KJD' }), { format: 'KJD' })
  assert.deepEqual(boundarySummary(kjd), [[1, 2], [1, 2], [2, 128]])

  const dxfText = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  assert.match(dxfText, /AcDbWipeout/u)
  const reopened = await sdk.readDocument(dxfText, { format: 'DXF' }), wipeouts = reopened.listEntities({ type: 'WIPEOUT' })
  assert.deepEqual(boundarySummary(reopened), [[1, 2], [1, 2], [2, 128]])
  assert.deepEqual(display(wipeouts.find(entity => entity.payload.position[0] === 80)), [15, false, 44, 55, 6, true])
  assert.deepEqual(points(wipeouts.find(entity => entity.payload.position[0] === 10).payload), [[10, 28, 0], [30, 28, 0], [30, 20, 0], [10, 20, 0]])
  assert.equal(JSON.stringify(wipeouts).includes('rawTags'), false)

  const independent = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON || 'python', ['-c',
    'import io,json,os,ezdxf; d=ezdxf.read(io.StringIO(open(os.environ["KJDRAW_FILE_STDIN_PATH"],encoding="utf-8").read())); a=d.audit(); w=list(d.modelspace().query("WIPEOUT")); print(json.dumps({"errors":len(a.errors),"fixes":len(a.fixes),"count":len(w),"paths":[len(e.boundary_path) for e in w],"handles":[[e.dxf.image_def_handle,e.dxf.image_def_reactor_handle] for e in w],"display":[w[-1].dxf.flags,w[-1].dxf.clipping,w[-1].dxf.brightness,w[-1].dxf.contrast,w[-1].dxf.fade,w[-1].dxf.clip_mode]}))'],
  dxfText, { encoding: 'utf8', windowsHide: true, env: { ...process.env, PYTHONPATH: process.env.KJDRAW_EZDXF_PATH || process.env.PYTHONPATH || '', PYTHONIOENCODING: 'utf-8' } })
  if (independent.error?.code === 'ENOENT' || /No module named ['"]ezdxf/u.test(independent.stderr || '')) {
    if (process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED === '1') assert.fail(independent.stderr || independent.error?.message)
    t.diagnostic('official ezdxf unavailable; independent check skipped')
  } else {
    assert.equal(independent.status, 0, independent.stderr)
    assert.deepEqual(JSON.parse(independent.stdout), { errors: 0, fixes: 0, count: 3, paths: [2, 128, 2], handles: [['0', '0'], ['0', '0'], ['0', '0']], display: [15, 0, 44, 55, 6, 1] })
  }
})

test('legacy vertex-only WIPEOUT remains compatible through KJD and DXF', async t => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'legacy-wipeout-fallback' })
  const legacyVertices = [[100, 20], [110, 20], [110, 30], [100, 30]]
  await sdk.executeCommand('CREATE', { type: 'WIPEOUT', payload: { vertices: legacyVertices } }, { document })
  const current = document.listEntities({ type: 'WIPEOUT' })[0]
  assert.deepEqual(points(current.payload), legacyVertices.map(([x, y]) => [x, y, 0]))
  assert.equal(current.payload.clipBoundary, undefined)
  const kjd = await sdk.readDocument(await sdk.writeDocument(document, { format: 'KJD' }), { format: 'KJD' })
  assert.deepEqual(points(kjd.listEntities({ type: 'WIPEOUT' })[0].payload), legacyVertices.map(([x, y]) => [x, y, 0]))
  const dxfText = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const reopened = await sdk.readDocument(dxfText, { format: 'DXF' }), wipeout = reopened.listEntities({ type: 'WIPEOUT' })[0]
  assert.equal(wipeout.payload.boundaryType, 2)
  assert.equal(wipeout.payload.clipBoundary.length, 4)
  assert.deepEqual(points(wipeout.payload), legacyVertices.map(([x, y]) => [x, y, 0]))
  const independent = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON || 'python', ['-c',
    'import io,json,os,ezdxf; d=ezdxf.read(io.StringIO(open(os.environ["KJDRAW_FILE_STDIN_PATH"],encoding="utf-8").read())); a=d.audit(); w=list(d.modelspace().query("WIPEOUT")); print(json.dumps({"errors":len(a.errors),"fixes":len(a.fixes),"count":len(w),"paths":[len(e.boundary_path) for e in w]}))'],
  dxfText, { encoding: 'utf8', windowsHide: true, env: { ...process.env, PYTHONPATH: process.env.KJDRAW_EZDXF_PATH || process.env.PYTHONPATH || '', PYTHONIOENCODING: 'utf-8' } })
  if (independent.error?.code === 'ENOENT' || /No module named ['"]ezdxf/u.test(independent.stderr || '')) {
    if (process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED === '1') assert.fail(independent.stderr || independent.error?.message)
    t.diagnostic('official ezdxf unavailable; independent check skipped')
  } else {
    assert.equal(independent.status, 0, independent.stderr)
    assert.deepEqual(JSON.parse(independent.stdout), { errors: 0, fixes: 0, count: 1, paths: [4] })
  }
})
test('native WIPEOUT rejects oversized, degenerate and collinear structured clipping', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'native-wipeout-validation' })
  const create = payload => sdk.executeCommand('CREATE', { type: 'WIPEOUT', payload }, { document })
  await assert.rejects(create({ ...polygon, clipBoundary: Array.from({ length: 129 }, (_, index) => [index, index % 2]) }), /2 to 128 points/u)
  await assert.rejects(create({ ...polygon, clipBoundary: [[0, 0], [1, 0], [2, 0]] }), /nonzero area/u)
  await assert.rejects(create({ ...rectangle, uVector: [1, 0], vVector: [2, 0] }), /nonzero plane/u)
})

test('native WIPEOUT transform and grips keep basis vectors and world vertices consistent', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'native-wipeout-editing' })
  const created = await sdk.executeCommand('CREATE', { type: 'WIPEOUT', payload: rectangle }, { document })
  const before = document.getObject(created.id).payload
  const moved = transformEntityPayload('WIPEOUT', before, translation3(3, 4))
  assert.deepEqual(moved.position, [13, 24, 0])
  assert.deepEqual(moved.uVector, before.uVector)
  assert.deepEqual(moved.vVector, before.vVector)
  assert.deepEqual(moved.clipBoundary, before.clipBoundary)
  assert.deepEqual(points(moved), points(before).map(point => [point[0] + 3, point[1] + 4, point[2]]))
  assert.deepEqual(getEntityGrips(document.getObject(created.id)).map(grip => grip.id), ['position', 'u', 'v', 'uv'])
  await sdk.executeCommand('GRIPEDIT', { id: created.id, gripId: 'position', point: [15, 25, 0] }, { document })
  const translated = document.getObject(created.id).payload
  assert.deepEqual(translated.position, [15, 25, 0])
  assert.deepEqual(translated.uVector, before.uVector)
  assert.deepEqual(translated.vVector, before.vVector)
  assert.deepEqual(points(translated), points(before).map(point => [point[0] + 5, point[1] + 5, point[2]]))
  await sdk.executeCommand('GRIPEDIT', { id: created.id, gripId: 'u', point: [45, 25, 0] }, { document })
  const resized = document.getObject(created.id).payload
  assert.deepEqual(resized.uVector, [30, 0, 0])
  assert.deepEqual(points(resized), [[15, 33, 0], [45, 33, 0], [45, 25, 0], [15, 25, 0]])
})

test('SVG exports native WIPEOUT as a white fill without a frame stroke', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'native-wipeout-svg' })
  const layoutId = document.snapshot().spaces.layoutIds[1], ownerId = document.getObject(layoutId).payload.blockRecordId
  await sdk.executeCommand('PLOTSETUP', { layoutId, dxf: { paperWidth: 210, paperHeight: 297, paperUnits: 1, scaleNumerator: 1, scaleDenominator: 1, plotType: 5, flags: 0, marginLeft: 10, marginRight: 10, marginTop: 10, marginBottom: 10 } }, { document })
  await sdk.executeCommand('CREATE', { type: 'WIPEOUT', payload: rectangle, options: { ownerId } }, { document })
  const output = exportDrawingSvg(document, { layoutId })
  assert.equal(output.report.rendered, 1)
  assert.equal(output.report.diagnostics.length, 0)
  assert.match(output.svg, /<path d="[^"]+" fill="#fff" stroke="none"\/>/u)
})