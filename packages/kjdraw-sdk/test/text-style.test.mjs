import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK, KJProjectSession } from '../src/index.js'
import { layoutCadText } from '../src/geometry/text-layout.js'
import { exportDrawingSvg } from '../src/svg-export.js'

test('current text style drives new native text and survives undo, redo, KJD and KJP reopen', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'text-style-current', units: 'millimeter' })
  const standard = document.getTable('textStyles').currentId
  const style = await sdk.executeCommand('TEXTSTYLE', { name: '工程中文', fontFamily: 'Noto Sans CJK SC', fixedHeight: 4, widthFactor: .8, obliqueAngle: .1, current: true })
  assert.equal(document.getTable('textStyles').currentId, style.id)
  const text = await sdk.executeCommand('CREATE', { type: 'TEXT', payload: { position: [10, 20, 0], text: '泵房 P-01', height: 5 } })
  assert.equal(text.payload.styleId, style.id)
  assert.match(layoutCadText(text.payload, style.payload).family, /^"Noto Sans CJK SC",/)
  await document.undo(); assert.equal(document.listEntities({ type: 'TEXT' }).length, 0)
  await document.undo(); assert.equal(document.getTable('textStyles').currentId, standard)
  await document.redo(); await document.redo()
  const kjd = await createKJDrawSDK().readDocument(document.serialize(), { format: 'KJD' })
  assert.equal(kjd.getTable('textStyles').records.find(record => record.name === '工程中文').id, kjd.getTable('textStyles').currentId)
  assert.equal(kjd.listEntities({ type: 'TEXT' })[0].payload.styleId, kjd.getTable('textStyles').currentId)
  const project = KJProjectSession.create({ sdk, documents: [document], activeDocumentId: document.id })
  const reopened = await KJProjectSession.open(await project.package(), { sdk: createKJDrawSDK() })
  assert.equal(reopened.activeDocument.getTable('textStyles').records.find(record => record.name === '工程中文').id, reopened.activeDocument.getTable('textStyles').currentId)
})

test('text style changes affect editable SVG geometry and invalid definitions roll back', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const style = await sdk.executeCommand('TEXTSTYLE', { name: 'CONDENSED', fontFamily: 'Arial', widthFactor: .5, obliqueAngle: .2, current: true })
  const text = await sdk.executeCommand('CREATE', { type: 'TEXT', payload: { position: [0, 0, 0], text: 'AB', height: 10 } })
  const initial = layoutCadText(text.payload, style.payload)
  assert.match(initial.family, /^"Arial",/); assert.ok(initial.corners[1][0] < 13)
  const layoutId = document.snapshot().spaces.layoutIds[0]
  await sdk.executeCommand('PLOTSETUP', { layoutId, dxf: { paperWidth: 420, paperHeight: 297, paperUnits: 1, plotType: 4, flags: 0, windowMinX: -10, windowMinY: -10, windowMaxX: 40, windowMaxY: 30, scaleNumerator: 1, scaleDenominator: 1 } })
  const svg = exportDrawingSvg(document, { layoutId }).svg
  assert.match(svg, /font-family="&quot;Arial&quot;,/); assert.match(svg, /matrix\(0\.5 0 -0\.202/)
  const before = document.serialize(), revision = document.revision
  for (const args of [{ name: 'BAD', widthFactor: 0 }, { name: 'BAD', fixedHeight: -1 }, { name: 'BAD', obliqueAngle: Infinity }, { name: 'BAD', operation: 'delete' }]) {
    await assert.rejects(sdk.executeCommand('TEXTSTYLE', args))
    assert.equal(document.serialize(), before); assert.equal(document.revision, revision)
  }
  await assert.rejects(sdk.executeCommand('CREATE', { type: 'TEXT', payload: { position: [0, 0], text: 'bad style', styleId: 'missing-style' } }))
  assert.equal(document.serialize(), before); assert.equal(document.revision, revision)
})
