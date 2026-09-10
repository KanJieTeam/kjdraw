import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { projectDimension } from '../src/geometry/annotation.js'
import { createKJDrawSDK } from '../src/index.js'

test('aligned dimensions generate extension lines, two arrows and exact measured text', () => {
  const d = projectDimension({ dimensionType: 'ALIGNED', definitionPoints: [[0, 8], [0, 0], [12, 0]] })
  assert.equal(d.measurement, 12)
  assert.equal(d.lines.length, 3)
  assert.deepEqual(d.lines[2], [[0, 8], [12, 8]])
  assert.equal(d.arrows.length, 2)
  assert.equal(d.label.text, '12')
  assert.equal(projectDimension({ dimensionType: 'ALIGNED', definitionPoints: [[0, 0], [0, 0], [0, 0]] }), null)
})

test('rotated and circular dimensions measure geometry instead of a stale cached value', () => {
  const vertical = projectDimension({ dimensionType: 'ROTATED', rotation: Math.PI / 2, definitionPoints: [[8, 2], [0, 0], [3, 4]], measurement: 900 })
  assert.ok(Math.abs(vertical.measurement - 4) < 1e-10)
  assert.equal(vertical.label.text, '4')
  const radius = projectDimension({ dimensionType: 'RADIUS', definitionPoints: [[0, 0], [3, 4]] })
  assert.equal(radius.label.text, 'R5')
  const diameter = projectDimension({ dimensionType: 'DIAMETER', definitionPoints: [[-3, -4], [3, 4]], textOverride: '<> mm' })
  assert.equal(diameter.measurement, 10)
  assert.equal(diameter.label.text, '⌀10 mm')
})

test('native radius and diameter DXF dimensions write the chord endpoint as group 15', async () => {
  for (const dimensionType of ['RADIUS', 'DIAMETER']) {
    const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: `dimension-${dimensionType}` })
    await sdk.executeCommand('CREATE', { type: 'DIMENSION', payload: { dimensionType, definitionPoints: [[0, 0, 0], [3, 4, 0]], textPosition: [6, 8, 0] } })
    const text = String(await sdk.writeDocument(document, { format: 'DXF' }))
    const lines = text.trimEnd().split(/\r?\n/), tags = []
    for (let index = 0; index < lines.length; index += 2) tags.push([Number(lines[index]), lines[index + 1]])
    const begin = tags.findIndex(([code, value]) => code === 0 && value === 'DIMENSION')
    assert.ok(begin >= 0, 'the exported DXF contains a native DIMENSION')
    const block = tags.slice(begin + 1, tags.findIndex(([code], index) => index > begin && code === 0))
    assert.ok(block.some(([code, value]) => code === 15 && value === '3'))
    assert.ok(block.every(([code]) => code !== 13))
    const reopened = await createKJDrawSDK().readDocument(text, { format: 'DXF' })
    const entity = reopened.listEntities({ type: 'DIMENSION' })[0]
    assert.deepEqual(entity.payload.definitionPoints, [[0, 0, 0], [3, 4, 0]])
    assert.equal(projectDimension(entity.payload).measurement, 5)
  }
})


test('sloped native ALIGNED DXF emits the measured chord direction instead of stale rotation', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument()
  await sdk.executeCommand('CREATE', { type: 'DIMENSION', payload: { dimensionType: 'ALIGNED', definitionPoints: [[5, 10, 0], [0, 0, 0], [3, 4, 0]], rotation: Math.PI / 2 } })
  const before = document.serialize()
  const dxf = String(await sdk.writeDocument(document, { format: 'DXF', version: '2018' }))
  const lines = dxf.trimEnd().split(/\r?\n/), tags = []
  for (let index = 0; index < lines.length; index += 2) tags.push([Number(lines[index]), lines[index + 1]])
  const begin = tags.findIndex(([code, value]) => code === 0 && value === 'DIMENSION')
  const end = tags.findIndex(([code], index) => index > begin && code === 0)
  const angle = Number(tags.slice(begin + 1, end).find(([code]) => code === 50)?.[1]) * Math.PI / 180
  assert.ok(Math.abs(angle - Math.atan2(4, 3)) < 1e-12)
  assert.ok(Math.abs(3 * Math.cos(angle) + 4 * Math.sin(angle) - 5) < 1e-12)
  assert.equal(document.serialize(), before)
  const reopened = await createKJDrawSDK().readDocument(dxf, { format: 'DXF' })
  assert.equal(projectDimension(reopened.listEntities({ type: 'DIMENSION' })[0].payload).measurement, 5)
})


test('native dimension text height and precision survive style overrides, edit, reopen and independent regeneration', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument()
  const style = await sdk.executeCommand('DIMSTYLE', { name: 'PRINT', properties: { overallScale: 2, textHeight: 2.5, decimalPlaces: 4 } })
  const entity = await sdk.executeCommand('CREATE', { type: 'DIMENSION', payload: { dimensionType: 'ALIGNED', definitionPoints: [[0, 8, 0], [0, 0, 0], [12.34567, 0, 0]], textHeight: 3, precision: 3, styleId: style.id, styleName: 'PRINT' } })
  const before = document.serialize()
  const artifact = String(await sdk.writeDocument(document, { format: 'DXF', version: '2018' }))
  assert.equal(document.serialize(), before)
  const other = createKJDrawSDK(), reopened = await other.readDocument(artifact, { format: 'DXF' })
  const dimension = reopened.listEntities({ type: 'DIMENSION' })[0], reopenedStyle = reopened.getObject(dimension.payload.styleId)
  assert.equal(dimension.payload.textHeight, 3); assert.equal(dimension.payload.precision, 3)
  assert.equal(reopenedStyle.name, 'PRINT'); assert.equal(reopenedStyle.payload.decimalPlaces, 4)
  const projection = projectDimension(dimension.payload, reopenedStyle.payload)
  assert.equal(projection.label.height, 6); assert.equal(projection.label.text, '12.346')
  await reopened.transact('Change dimension text format', tx => tx.updateObject(dimension.id, { payload: { textHeight: 4, precision: 1 } }))
  const edited = String(await other.writeDocument(reopened, { format: 'DXF', version: '2018' }))
  const again = await createKJDrawSDK().readDocument(edited, { format: 'DXF' })
  const updated = again.listEntities({ type: 'DIMENSION' })[0]
  assert.equal(updated.payload.textHeight, 4); assert.equal(updated.payload.precision, 1)
  assert.ok(again.listEntities({ type: 'TEXT' }).some(text => text.payload.text === '12.3' && text.payload.height === 8))
  await assert.rejects(sdk.writeDocument(document, { format: 'DXF', version: 'R14' }), error => /precision|decimalPlaces/.test(error.cause?.message ?? error.message))
  if (process.env.KJDRAW_PYTHON) {
    const script = 'import sys,io,json,ezdxf; d=ezdxf.read(io.StringIO(sys.stdin.read())); e=list(d.modelspace().query("DIMENSION"))[0]; o=e.override(); before=[o.get("dimtxt"),o.get("dimdec"),o.get("dimscale"),o.get("dimlfac")]; o.render(); labels=[{"text":x.dxf.text,"height":x.dxf.char_height} for x in d.blocks[e.dxf.geometry].query("MTEXT")]; a=d.audit(); print(json.dumps({"format":before,"labels":labels,"errors":len(a.errors),"fixes":len(a.fixes)}))'
    for (const [dxf, expected, label, height] of [[artifact, [3, 3, 2, 1], '12.346', 6], [edited, [4, 1, 2, 1], '12.3', 8]]) {
      const result = spawnSync(process.env.KJDRAW_PYTHON, ['-c', script], { input: dxf, encoding: 'utf8', timeout: 30000 })
      assert.equal(result.status, 0, result.stderr)
      const observed = JSON.parse(result.stdout)
      assert.deepEqual(observed.format, expected)
      assert.ok(observed.labels.some(item => item.text === label && item.height === height), JSON.stringify(observed))
      assert.equal(observed.errors, 0); assert.equal(observed.fixes, 0)
    }
  }
  assert.equal(document.getObject(entity.id).payload.textHeight, 3)
})
