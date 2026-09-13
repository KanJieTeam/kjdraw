import test from 'node:test'
import assert from 'node:assert/strict'
import {
  KJDRAW_MANUFACTURING_SHEET_VERSION,
  buildAgentManufacturingSheet,
  createKJDrawSDK,
  exportDrawingSvg,
  multiply3,
  transformPoint3,
} from '../src/index.js'
import { independentlyInspectProductionDxf } from './production-workflow-independent.mjs'

const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`)
const xy = point => point.slice(0, 2)
const distance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1])

const input = () => ({
  version: KJDRAW_MANUFACTURING_SHEET_VERSION,
  expectedRevision: 0,
  units: 'millimeter',
  drawingId: 'MECH-PLATE-240-A',
  title: 'MACHINED MOUNTING PLATE',
  revision: 'A',
  material: '6061-T6 ALUMINUM',
  quantity: 4,
  length: 240,
  width: 140,
  thickness: 12,
  holePatterns: [
    { rows: 2, columns: 3, origin: [30, 30], spacing: [90, 80], throughDiameter: 10, counterboreDiameter: 18, counterboreDepth: 5 },
    { rows: 1, columns: 2, origin: [70, 70], spacing: [100, 0], throughDiameter: 6.5 },
  ],
  slots: [
    { center: [120, 40], length: 42, width: 12, orientationDegrees: 0 },
    { center: [120, 100], length: 30, width: 10, orientationDegrees: 90 },
  ],
  sheet: { origin: [15, 25], size: [420, 297] },
  textHeight: 3.5,
})

function horizontalSlot(document, ids) {
  const entities = ids.map(id => document.getObject(id)).filter(Boolean)
  const arcs = entities.filter(entity => entity.type === 'ARC').sort((a, b) => a.payload.center[0] - b.payload.center[0])
  assert.equal(arcs.length, 2)
  near(arcs[0].payload.radius, 6); near(arcs[1].payload.radius, 6)
  near(arcs[0].payload.center[1], arcs[1].payload.center[1])
  near(arcs[1].payload.center[0] - arcs[0].payload.center[0], 30)
  const centerY = arcs[0].payload.center[1]
  const tangents = entities.filter(entity => entity.type === 'LINE'
    && nearBoolean(entity.payload.start[1], entity.payload.end[1])
    && nearBoolean(Math.abs(entity.payload.start[1] - centerY), 6)
    && nearBoolean(Math.abs(entity.payload.end[0] - entity.payload.start[0]), 30))
  assert.equal(tangents.length, 2)
  for (const tangent of tangents) {
    const endpoints = [tangent.payload.start[0], tangent.payload.end[0]].sort((a, b) => a - b)
    near(endpoints[0], arcs[0].payload.center[0]); near(endpoints[1], arcs[1].payload.center[0])
  }
  const dimension = entities.find(entity => entity.type === 'DIMENSION')
  assert.ok(dimension)
  const anchors = dimension.payload.definitionPoints.slice(1, 3)
  near(distance(xy(anchors[0]), xy(anchors[1])), 42)
  return { center: [(arcs[0].payload.center[0] + arcs[1].payload.center[0]) / 2, centerY], arcs, tangents }
}

function nearBoolean(actual, expected, tolerance = 1e-9) {
  return Math.abs(actual - expected) <= tolerance
}

function verifyHolePattern(document) {
  const through = document.listEntities({ type: 'CIRCLE' }).filter(entity => nearBoolean(entity.payload.radius, 5))
  const counterbores = document.listEntities({ type: 'CIRCLE' }).filter(entity => nearBoolean(entity.payload.radius, 9))
  assert.equal(through.length, 6); assert.equal(counterbores.length, 6)
  const xs = [...new Set(through.map(entity => entity.payload.center[0]))].sort((a, b) => a - b)
  const ys = [...new Set(through.map(entity => entity.payload.center[1]))].sort((a, b) => a - b)
  assert.equal(xs.length, 3); assert.equal(ys.length, 2)
  near(xs[1] - xs[0], 90); near(xs[2] - xs[1], 90); near(ys[1] - ys[0], 80)
  for (const hole of through) {
    near(hole.payload.radius * 2, 10)
    assert.ok(counterbores.some(counterbore => distance(xy(counterbore.payload.center), xy(hole.payload.center)) <= 1e-9))
  }
}

function findMovedHorizontalSlot(document) {
  const arcs = document.listEntities({ type: 'ARC' }).filter(entity => nearBoolean(entity.payload.radius, 6))
  assert.equal(arcs.length, 2)
  const center = [(arcs[0].payload.center[0] + arcs[1].payload.center[0]) / 2, (arcs[0].payload.center[1] + arcs[1].payload.center[1]) / 2]
  return center
}

test('blank-document mechanical workflow builds, edits, verifies, reopens and plots a measured A3 viewport', async t => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'production-mechanical-workflow', units: 'millimeter' })
  assert.equal(document.listEntities().length, 0)

  const compiled = buildAgentManufacturingSheet(document, input())
  await sdk.executeCommand('CREATEBATCH', compiled.commandArgs, { document })
  assert.equal(document.validate().valid, true)
  verifyHolePattern(document)

  const specs = compiled.commandArgs.entities
  const firstSlotArc = specs.findIndex(entity => entity.type === 'ARC' && nearBoolean(entity.payload.radius, 6))
  assert.ok(firstSlotArc >= 2)
  const slotIds = specs.slice(firstSlotArc - 2, firstSlotArc + 8).map(entity => entity.options.id)
  const before = horizontalSlot(document, slotIds)

  await sdk.executeCommand('MOVE', { ids: slotIds, dx: 5, dy: 0 }, { document })
  const moved = horizontalSlot(document, slotIds)
  near(moved.center[0], before.center[0] + 5); near(moved.center[1], before.center[1])
  assert.equal(document.validate().valid, true)

  await sdk.executeCommand('UNDO', {}, { document })
  const undone = horizontalSlot(document, slotIds)
  near(undone.center[0], before.center[0]); near(undone.center[1], before.center[1])
  await sdk.executeCommand('REDO', {}, { document })
  const redone = horizontalSlot(document, slotIds)
  near(redone.center[0], moved.center[0]); near(redone.center[1], moved.center[1])

  const layout = await sdk.executeCommand('LAYOUT', { operation: 'create', name: 'A3 MECHANICAL 1:2' }, { document })
  await sdk.executeCommand('PAGESETUP', { layoutId: layout.id, dxf: {
    paperWidth: 420, paperHeight: 297, paperUnits: 1,
    marginLeft: 10, marginRight: 10, marginTop: 10, marginBottom: 10,
    originX: 0, originY: 0, scaleNumerator: 1, scaleDenominator: 1,
    plotType: 5, rotation: 0, flags: 0,
  } }, { document })
  const viewport = await sdk.executeCommand('VIEWPORT', {
    layoutId: layout.id, center: [210, 148.5], width: 210, height: 148.5,
    viewCenter: [225, 173.5], viewHeight: 297,
  }, { document })

  const serialized = document.serialize()
  const output = exportDrawingSvg(document, { layoutId: layout.id })
  assert.equal(document.serialize(), serialized)
  assert.deepEqual(output.paper, { widthMm: 420, heightMm: 297, millimetersPerDrawingUnit: 1 })
  const viewportReport = output.report.viewports.find(item => item.entityId === viewport.id)
  assert.ok(viewportReport)
  near(viewportReport.millimetersPerModelUnit, 0.5)
  const physicalTransform = multiply3(output.plot.drawingToPaperMatrix, viewportReport.matrix)
  const start = transformPoint3(physicalTransform, [0, 0, 0])
  const end = transformPoint3(physicalTransform, [240, 0, 0])
  near(distance(start, end), 120)
  assert.match(output.svg, /width="420mm"/); assert.match(output.svg, /height="297mm"/)

  const kjd = await sdk.writeDocument(document, { format: 'KJD', version: '1' })
  const reopenedKjd = await createKJDrawSDK().readDocument(kjd, { format: 'KJD', version: '1' })
  assert.equal(reopenedKjd.validate().valid, true)
  verifyHolePattern(reopenedKjd)
  near(findMovedHorizontalSlot(reopenedKjd)[0], redone.center[0])
  const kjdLayout = reopenedKjd.listObjects({ kind: 'layout' }).find(item => item.name === 'A3 MECHANICAL 1:2')
  assert.ok(kjdLayout)
  const kjdOutput = exportDrawingSvg(reopenedKjd, { layoutId: kjdLayout.id })
  near(kjdOutput.report.viewports[0].millimetersPerModelUnit, 0.5)

  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const external = independentlyInspectProductionDxf('mechanical', dxf)
  if (external) {
    assert.equal(external.units, 4)
    assert.equal(external.circles >= 14, true); assert.equal(external.r5, 6); assert.equal(external.r9, 6)
    assert.equal(external.r6arcs, 2)
    assert.equal(external.dimensions, document.listEntities({ type: 'DIMENSION' }).length)
    assert.equal(external.dimensions >= 8, true)
    near(external.paper[0], 420); near(external.paper[1], 297)
    assert.equal(external.errors, 0); assert.equal(external.fixes, 0)
  } else t.diagnostic('Independent ezdxf unavailable; candidate CI must provide KJDRAW_PYTHON')
  const reopenedDxf = await createKJDrawSDK().readDocument(dxf, { format: 'DXF', version: '2018' })
  assert.equal(reopenedDxf.validate().valid, true)
  assert.equal(reopenedDxf.listEntities({ type: 'PROXY_ENTITY' }).length, 0)
  verifyHolePattern(reopenedDxf)
  near(findMovedHorizontalSlot(reopenedDxf)[0], redone.center[0])
  const dxfLayout = reopenedDxf.listObjects({ kind: 'layout' }).find(item => item.name === 'A3 MECHANICAL 1:2')
  assert.ok(dxfLayout)
  const dxfOutput = exportDrawingSvg(reopenedDxf, { layoutId: dxfLayout.id })
  near(dxfOutput.report.viewports[0].millimetersPerModelUnit, 0.5)
})
